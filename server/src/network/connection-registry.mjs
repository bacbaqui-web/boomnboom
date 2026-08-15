import { randomBytes } from "node:crypto";

export const DEFAULT_PLAYER_LEASE_MS = 10_000;

function defaultTokenFactory() {
  return randomBytes(16).toString("hex");
}

export function createConnectionRegistry({
  leaseMs = DEFAULT_PLAYER_LEASE_MS,
  createToken = defaultTokenFactory,
  schedule = setTimeout,
  cancel = clearTimeout,
  onLeaseExpired = () => undefined,
} = {}) {
  const byPlayer = new Map();
  const byToken = new Map();
  const metrics = {
    resumeSuccess: 0,
    resumeRejected: 0,
    resumeExpired: 0,
  };

  function freshToken() {
    let token;
    do token = createToken(); while (byToken.has(token));
    return token;
  }

  function bindNew(session, playerId) {
    if (byPlayer.has(playerId)) throw new Error("player_already_registered");
    const token = freshToken();
    const lease = { playerId, token, session, timer: null };
    byPlayer.set(playerId, lease);
    byToken.set(token, lease);
    session.playerId = playerId;
    session.bindingToken = token;
    return { playerId, resumeToken: token };
  }

  function resume(session, token) {
    const lease = byToken.get(token);
    if (!lease || lease.token !== token) {
      metrics.resumeRejected += 1;
      return { accepted: false, reason: "resume_rejected" };
    }
    if (lease.timer) cancel(lease.timer);
    const replacedSession = lease.session;
    byToken.delete(token);
    const nextToken = freshToken();
    lease.token = nextToken;
    lease.timer = null;
    lease.session = session;
    byToken.set(nextToken, lease);
    session.playerId = lease.playerId;
    session.bindingToken = nextToken;
    if (replacedSession) replacedSession.bindingToken = null;
    metrics.resumeSuccess += 1;
    return {
      accepted: true,
      playerId: lease.playerId,
      resumeToken: nextToken,
      replacedSession,
    };
  }

  function disconnect(session) {
    if (!isCurrent(session)) return false;
    const lease = byPlayer.get(session.playerId);
    lease.session = null;
    session.bindingToken = null;
    lease.timer = schedule(() => {
      if (lease.session || byPlayer.get(lease.playerId) !== lease) return;
      byPlayer.delete(lease.playerId);
      byToken.delete(lease.token);
      lease.timer = null;
      metrics.resumeExpired += 1;
      onLeaseExpired(lease.playerId);
    }, leaseMs);
    lease.timer?.unref?.();
    return true;
  }

  function isCurrent(session) {
    if (!session?.playerId || !session.bindingToken) return false;
    const lease = byPlayer.get(session.playerId);
    return lease?.session === session && lease.token === session.bindingToken;
  }

  function close() {
    for (const lease of byPlayer.values()) {
      if (lease.timer) cancel(lease.timer);
    }
    byPlayer.clear();
    byToken.clear();
  }

  return {
    bindNew,
    resume,
    disconnect,
    isCurrent,
    close,
    readMetrics() {
      let connectedLeases = 0;
      for (const lease of byPlayer.values()) {
        if (lease.session) connectedLeases += 1;
      }
      return {
        playerLeases: byPlayer.size,
        disconnectedLeases: byPlayer.size - connectedLeases,
        ...metrics,
      };
    },
  };
}

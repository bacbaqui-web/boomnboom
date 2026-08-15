export function createWebSocketSession({ socket, playerId, protocol = 2 }) {
  return {
    socket,
    playerId: playerId ?? null,
    bindingToken: null,
    protocol,
    initialized: false,
    ready: false,
    interest: new Set(),
    knownChunkRevisions: new Map(),
    knownChunkSnapshots: new Map(),
    previousEntities: new Map(),
    lastClientSeq: -1,
    acks: new Map(),
    v3ActionResults: new Map(),
    snapshotSeq: 0xffff_ffff,
    baselineTick: null,
    rateWindowStartedAt: 0,
    rateWindowMessages: 0,
  };
}

export function rememberV3ActionResult(session, commandSeq, payload, limit = 32) {
  session.v3ActionResults.set(commandSeq, payload);
  if (session.v3ActionResults.size > limit) {
    session.v3ActionResults.delete(session.v3ActionResults.keys().next().value);
  }
}

export function rememberAcknowledgement(session, clientSeq, payload, limit = 32) {
  session.acks.set(clientSeq, payload);
  if (session.acks.size > limit) session.acks.delete(session.acks.keys().next().value);
}

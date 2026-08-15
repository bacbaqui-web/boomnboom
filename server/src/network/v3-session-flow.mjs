import { createChunkPublisher } from "./chunk-publisher.mjs";
import { createConnectionRegistry } from "./connection-registry.mjs";
import { createEntitySnapshotPublisher } from "./entity-snapshot-publisher.mjs";
import { validateV3ClientMessage } from "./protocol-v3.mjs";
import {
  createWebSocketSession,
  rememberV3ActionResult,
} from "./websocket-session.mjs";

export function createV3SessionFlow({
  world,
  simulation,
  commandBuffer,
  movementSystem,
  send,
  currentTick,
  publishWorld,
  worldId,
  preloadRadius,
  simulationTickRate,
  snapshotRate,
  tickMs,
  worldEpochMs,
  bgmDurationMs,
  bgmSnareOffsetMs,
  leaseMs = 10_000,
  maxMessagesPerSecond = 120,
  now = Date.now,
  registryOptions = {},
}) {
  const sessions = new Map();
  const connections = new Set();
  let nextConnectionId = 1;
  const metrics = { rateLimitRejects: 0 };
  const registry = createConnectionRegistry({
    leaseMs,
    ...registryOptions,
    onLeaseExpired(playerId) {
      sessions.delete(playerId);
      commandBuffer.removePlayer(playerId);
      simulation.removePlayer(playerId);
      publishWorld();
      registryOptions.onLeaseExpired?.(playerId);
    },
  });
  const publisher = createEntitySnapshotPublisher({
    world,
    sessions,
    commandBuffer,
    send,
    tickRate: simulationTickRate,
  });
  const chunkPublisher = createChunkPublisher({
    world,
    sessions,
    send,
    preloadRadius,
  });

  function sendError(session, error, recoverable = true) {
    send(session, "error", { ...error, recoverable });
  }

  function initialize(session, resultType, resumeToken) {
    const baselineTick = currentTick();
    session.baselineTick = baselineTick;
    session.ready = false;
    session.snapshotSeq = 0xffff_ffff;
    session.interest.clear();
    session.knownChunkRevisions.clear();
    session.knownChunkSnapshots.clear();
    session.v3ActionResults.clear();
    send(session, resultType, {
      accepted: true,
      playerId: session.playerId,
      resumeToken,
    }, baselineTick);
    send(session, "world_init", {
      worldId,
      baselineTick,
      seed: world.metadata.seed,
      generatorVersion: world.metadata.generatorVersion,
      chunkSize: world.metadata.chunkSize,
      preloadRadius,
      tickRate: simulationTickRate,
      snapshotRate,
      visibleWidth: 15,
      visibleHeight: 11,
      tickMs,
      playerId: session.playerId,
      worldEpochMs,
      bgmDurationMs,
      bgmSnareOffsetMs,
    }, baselineTick);
    chunkPublisher.initializeSession(session, baselineTick);
    publisher.sendBaseline(session, baselineTick);
    session.initialized = true;
  }

  function join(session, nickname, color) {
    if (session.initialized || session.playerId) {
      sendError(session, { code: "already_joined", message: "이미 참가했습니다." });
      return;
    }
    const player = simulation.addPlayer();
    const result = simulation.joinPlayer(player.id, nickname, color);
    if (!result.accepted) {
      simulation.removePlayer(player.id);
      sendError(session, { code: "join_rejected", message: "참가할 수 없습니다." });
      return;
    }
    movementSystem.initializePlayer(player.id);
    commandBuffer.registerPlayer(player.id);
    const binding = registry.bindNew(session, player.id);
    sessions.set(player.id, session);
    initialize(session, "join_result", binding.resumeToken);
    publishWorld({ refreshEntities: false });
  }

  function resume(session, resumeToken) {
    if (session.initialized || session.playerId) {
      sendError(session, { code: "already_joined", message: "이미 참가했습니다." });
      return;
    }
    const result = registry.resume(session, resumeToken);
    if (!result.accepted || !world.getPlayer(result.playerId)) {
      send(session, "resume_result", {
        accepted: false,
        reason: result.reason ?? "resume_expired",
      });
      return;
    }
    commandBuffer.resetPlayerSession(result.playerId);
    sessions.set(result.playerId, session);
    if (result.replacedSession && result.replacedSession !== session) {
      result.replacedSession.socket.close(4001, "session_replaced");
    }
    initialize(session, "resume_result", result.resumeToken);
  }

  function withinRateLimit(session) {
    const receivedAt = now();
    if (receivedAt - session.rateWindowStartedAt >= 1000) {
      session.rateWindowStartedAt = receivedAt;
      session.rateWindowMessages = 0;
    }
    session.rateWindowMessages += 1;
    if (session.rateWindowMessages <= maxMessagesPerSecond) return true;
    metrics.rateLimitRejects += 1;
    session.socket.close(1008, "rate_limit");
    return false;
  }

  function handleBoundMessage(session, message) {
    if (!registry.isCurrent(session)) return;
    if (message.type === "ready") {
      if (message.baselineTick !== session.baselineTick) {
        sendError(session, { code: "baseline_mismatch", message: "초기 상태를 다시 받아주세요." });
        return;
      }
      chunkPublisher.markSessionReady(
        session,
        message.knownChunkRevisions,
        currentTick(),
      );
      return;
    }
    if (!session.ready && (message.type === "input_state" || message.type === "action_command")) {
      sendError(session, { code: "not_ready", message: "초기 월드 로딩이 필요합니다." });
      return;
    }
    if (message.type === "input_state") {
      const result = commandBuffer.enqueue(session.playerId, message, currentTick());
      if (!result.accepted) {
        sendError(session, {
          code: result.reason,
          message: "입력 command를 적용할 수 없습니다.",
          commandSeq: message.commandSeq,
        });
      }
      return;
    }
    if (message.type === "action_command") {
      const cached = session.v3ActionResults.get(message.commandSeq);
      if (cached) {
        send(session, "action_result", cached);
        return;
      }
      const result = commandBuffer.enqueue(session.playerId, message, currentTick());
      if (!result.accepted && result.reason !== "duplicate") {
        const payload = {
          commandSeq: message.commandSeq,
          action: message.action,
          accepted: false,
          reason: result.reason,
        };
        rememberV3ActionResult(session, message.commandSeq, payload);
        send(session, "action_result", payload);
      }
      return;
    }
    if (message.type === "chunk_resync") {
      if (!session.interest.has(message.chunkKey)) {
        sendError(session, { code: "outside_interest", message: "구독하지 않은 청크입니다." });
        return;
      }
      chunkPublisher.sendChunkSnapshot(
        session,
        message.chunkKey,
        "client_resync",
        currentTick(),
      );
    }
  }

  function attach(socket) {
    const session = createWebSocketSession({ socket, protocol: 3 });
    connections.add(session);
    session.connectionId = `C${nextConnectionId++}`;
    send(session, "hello", {
      sessionId: session.connectionId,
      supportedProtocols: [2, 3],
      tickRate: simulationTickRate,
      snapshotRate,
      defaultCommandLeadTicks: 2,
    });
    socket.on("message", (raw) => {
      if (!withinRateLimit(session)) return;
      const parsed = validateV3ClientMessage(raw.toString());
      if (!parsed.ok) {
        sendError(session, parsed.error, parsed.error.code !== "unsupported_protocol");
        return;
      }
      const message = parsed.value;
      if (message.type === "join") return join(session, message.nickname, message.color);
      if (message.type === "resume") return resume(session, message.resumeToken);
      if (message.type === "ping") {
        send(session, "pong", { clientTimeMs: message.clientTimeMs });
        return;
      }
      if (!session.initialized) {
        sendError(session, { code: "join_required", message: "먼저 월드에 참가해주세요." });
        return;
      }
      handleBoundMessage(session, message);
    });
    socket.on("close", () => {
      connections.delete(session);
      if (!registry.disconnect(session)) return;
      sessions.delete(session.playerId);
      commandBuffer.resetPlayerIntent(session.playerId);
    });
    return session;
  }

  return {
    attach,
    publishSnapshots(serverTick = currentTick()) {
      const chunkSessions = chunkPublisher.publish(serverTick);
      const entityMessages = publisher.publish(serverTick);
      return { chunkSessions, entityMessages };
    },
    publishActionResults(results, serverTick = currentTick()) {
      let sent = 0;
      for (const result of results) {
        const session = sessions.get(result.playerId);
        if (!session?.ready || !registry.isCurrent(session)) continue;
        const payload = { ...result };
        delete payload.playerId;
        rememberV3ActionResult(session, result.commandSeq, payload);
        if (send(session, "action_result", payload, serverTick)) sent += 1;
      }
      return sent;
    },
    publishWorldEvents(events, serverTick = currentTick()) {
      let sent = 0;
      for (const event of events) {
        for (const session of sessions.values()) {
          if (session.ready && send(session, "world_event", event, serverTick)) sent += 1;
        }
      }
      return sent;
    },
    close() {
      registry.close();
      sessions.clear();
      connections.clear();
    },
    readMetrics() {
      return {
        v3: connections.size,
        activeV3Players: sessions.size,
        ...publisher.readMetrics(),
        ...registry.readMetrics(),
        ...metrics,
      };
    },
  };
}

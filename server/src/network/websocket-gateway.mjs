import { WebSocketServer } from "ws";
import {
  DEFAULT_MAX_BUFFERED_AMOUNT,
  sendWithBackpressure,
} from "./backpressure-sender.mjs";
import { serverMessage, validateV2ClientMessage } from "./protocol-v2.mjs";
import {
  createWebSocketSession,
  rememberAcknowledgement,
} from "./websocket-session.mjs";
import { createWorldPublisher } from "./world-publisher.mjs";

export function createWebSocketGateway({
  server,
  world,
  simulation,
  getClock,
  tickMs,
  worldEpochMs,
  bgmDurationMs,
  bgmSnareOffsetMs,
  worldId = "ENDLESS_WORLD_V2",
  preloadRadius = 2,
  maxBufferedAmount = DEFAULT_MAX_BUFFERED_AMOUNT,
}) {
  const wss = new WebSocketServer({ noServer: true });
  const sessions = new Map();
  let closed = false;
  const networkMetrics = {
    outboundMessages: 0,
    outboundBytes: 0,
    backpressureDisconnects: 0,
    unsupportedProtocolRejects: 0,
  };

  function clock() {
    const value = getClock();
    return { tick: value.tick, serverTime: Date.now(), nextTickAt: value.nextTickAt };
  }

  function sendEnvelope(session, message) {
    return sendWithBackpressure(session.socket, message, {
      maxBufferedAmount,
      metrics: networkMetrics,
    });
  }

  function send(session, type, payload = {}) {
    return sendEnvelope(session, serverMessage(type, payload, clock()));
  }

  function sendError(session, error, recoverable = true) {
    send(session, "error", { ...error, recoverable });
  }

  const publisher = createWorldPublisher({
    world,
    sessions,
    send,
    sendEnvelope,
    clock,
    worldId,
    preloadRadius,
    tickMs,
    worldEpochMs,
    bgmDurationMs,
    bgmSnareOffsetMs,
  });

  function sendAck(session, clientSeq, result, duplicate = false) {
    const payload = {
      ackClientSeq: clientSeq,
      accepted: Boolean(result.accepted),
      changed: Boolean(result.changed),
      reason: result.reason ?? null,
      duplicate,
      entityRevision: publisher.entityRevision,
      correction: publisher.correctionFor(session.playerId),
    };
    send(session, "input_ack", payload);
    if (!duplicate) rememberAcknowledgement(session, clientSeq, payload);
  }

  function publish(options) {
    if (closed) return;
    publisher.publish(options);
    simulation.markPublishedPositions();
  }

  function processSequencedCommand(session, message) {
    const cached = session.acks.get(message.clientSeq);
    if (cached) {
      send(session, "input_ack", { ...cached, duplicate: true });
      return;
    }
    if (message.clientSeq <= session.lastClientSeq) {
      sendAck(
        session,
        message.clientSeq,
        { accepted: false, changed: false, reason: "stale_sequence" },
      );
      return;
    }
    session.lastClientSeq = message.clientSeq;
    const result =
      message.type === "respawn"
        ? simulation.respawnPlayer(session.playerId)
        : simulation.applyAction(
            session.playerId,
            message.action === "stop" ? "wait" : message.action,
          );
    publisher.refreshEntityRevision();
    sendAck(session, message.clientSeq, result);
    if (result.publish) publish({ refreshEntities: false });
  }

  function handleMessage(session, raw) {
    const parsed = validateV2ClientMessage(raw.toString());
    if (!parsed.ok) {
      sendError(session, parsed.error, parsed.error.code !== "unsupported_protocol");
      return;
    }
    const message = parsed.value;

    if (message.type === "join") {
      if (session.initialized) {
        sendError(session, { code: "already_joined", message: "이미 참가했습니다." });
        return;
      }
      const result = simulation.joinPlayer(session.playerId, message.nickname);
      if (!result.accepted) {
        sendError(session, { code: "join_rejected", message: "참가할 수 없습니다." });
        return;
      }
      publisher.initializeSession(session);
      publish({ refreshEntities: false });
      return;
    }

    if (!session.initialized) {
      sendError(session, { code: "join_required", message: "먼저 월드에 참가해주세요." });
      return;
    }
    if (message.type === "ready") {
      publisher.markSessionReady(session, message.knownChunkRevisions);
      return;
    }
    if (message.type === "input" || message.type === "respawn") {
      if (!session.ready) {
        sendError(session, { code: "not_ready", message: "초기 월드 로딩이 필요합니다." });
        return;
      }
      processSequencedCommand(session, message);
      return;
    }
    if (message.type === "chunk_resync") {
      if (!session.interest.has(message.chunkKey)) {
        sendError(session, { code: "outside_interest", message: "구독하지 않은 청크입니다." });
        return;
      }
      publisher.sendChunkSnapshot(session, message.chunkKey, "client_resync");
      return;
    }
    if (message.type === "ping") {
      send(session, "pong", { clientTime: message.clientTime });
    }
  }

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/boom-ws" && url.pathname !== "/") return socket.destroy();
    const requestedProtocols = String(request.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((value) => value.trim());
    const queryProtocol = url.searchParams.get("protocol");
    const requestsV2 =
      queryProtocol === "2" ||
      (queryProtocol === null && requestedProtocols.includes("boom-v2"));
    if (!requestsV2) {
      networkMetrics.unsupportedProtocolRejects += 1;
      socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, request);
    });
  });

  wss.on("connection", (socket) => {
    const player = simulation.addPlayer();
    const session = createWebSocketSession({ socket, playerId: player.id });
    sessions.set(player.id, session);
    send(session, "hello", {
      sessionId: player.id,
      supportedProtocols: [2],
      tickMs,
    });

    socket.on("message", (raw) => handleMessage(session, raw));
    socket.on("close", () => {
      sessions.delete(player.id);
      simulation.removePlayer(player.id);
      if (!closed) publish();
    });
  });

  return {
    publish,
    close() {
      closed = true;
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
    readMetrics() {
      return {
        connections: sessions.size,
        v2: sessions.size,
        ...publisher.readMetrics(),
        ...networkMetrics,
      };
    },
  };
}

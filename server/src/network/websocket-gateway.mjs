import { WebSocket, WebSocketServer } from "ws";
import { worldToChunk } from "../world/coordinates.mjs";
import {
  chunkSnapshotPayload,
  diffChunkSnapshots,
  serverMessage,
  validateV2ClientMessage,
} from "./protocol-v2.mjs";

const DEFAULT_MAX_BUFFERED_AMOUNT = 512 * 1024;

export function sendWithBackpressure(
  socket,
  message,
  { maxBufferedAmount = DEFAULT_MAX_BUFFERED_AMOUNT, metrics = null } = {},
) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  if (socket.bufferedAmount > maxBufferedAmount) {
    if (metrics) metrics.backpressureDisconnects += 1;
    socket.close(1013, "backpressure");
    return false;
  }
  const serialized = typeof message === "string" ? message : JSON.stringify(message);
  socket.send(serialized);
  if (metrics) {
    metrics.outboundMessages += 1;
    metrics.outboundBytes += Buffer.byteLength(serialized);
  }
  return true;
}

function parseChunkKey(key) {
  const [chunkX, chunkY] = key.split(",").map(Number);
  return { chunkX, chunkY };
}

function interestForPlayer(player, chunkSize, radius) {
  const center = worldToChunk(player.x, player.y, chunkSize);
  const keys = new Set();
  for (let chunkY = center.chunkY - radius; chunkY <= center.chunkY + radius; chunkY += 1) {
    for (let chunkX = center.chunkX - radius; chunkX <= center.chunkX + radius; chunkX += 1) {
      keys.add(`${chunkX},${chunkY}`);
    }
  }
  return keys;
}

function playerEntity(player) {
  return {
    kind: "player",
    id: player.id,
    x: player.x,
    y: player.y,
    isAI: player.isAI,
    action: player.action,
    score: player.score,
    power: player.power,
    range: player.range,
    shield: player.shield,
    nickname: player.nickname,
    joined: player.joined,
    alive: player.alive,
  };
}

function bombEntity(bomb) {
  return { kind: "bomb", ...bomb };
}

function itemEntity(item) {
  return { kind: "item", id: `${item.x},${item.y}`, ...item };
}

function flameEntity(flame) {
  return { kind: "flame", id: `${flame.x},${flame.y}`, ...flame };
}

function entityKey(entity) {
  return `${entity.kind}:${entity.id}`;
}

function entityChunkKey(entity, chunkSize) {
  return worldToChunk(entity.x, entity.y, chunkSize).chunkKey;
}

function readEntityMap(world, chunkSize, interest = null, localPlayerId = null) {
  const entities = [
    ...world
      .readPlayers()
      .filter((player) => player.alive || player.id === localPlayerId)
      .map(playerEntity),
    ...world.readBombs().map(bombEntity),
    ...world.readItems().map(itemEntity),
    ...world.readFlames().map(flameEntity),
  ];
  return new Map(
    entities
      .filter(
        (entity) =>
          (entity.kind === "player" && entity.id === localPlayerId) ||
          !interest ||
          interest.has(entityChunkKey(entity, chunkSize)),
      )
      .map((entity) => [entityKey(entity), entity]),
  );
}

function entityCollections(entityMap) {
  const values = [...entityMap.values()];
  return {
    players: values.filter((entity) => entity.kind === "player"),
    bombs: values.filter((entity) => entity.kind === "bomb"),
    items: values.filter((entity) => entity.kind === "item"),
    flames: values.filter((entity) => entity.kind === "flame"),
  };
}

function enemySummaries(world, localPlayerId) {
  const localPlayer = world.getPlayer(localPlayerId);
  if (!localPlayer) return [];
  return world
    .readPlayers()
    .filter((player) => player.id !== localPlayerId && player.alive)
    .map((player) => ({
      id: player.id,
      dx: player.x - localPlayer.x,
      dy: player.y - localPlayer.y,
      distance: Math.abs(player.x - localPlayer.x) + Math.abs(player.y - localPlayer.y),
      nickname: player.nickname,
      isAI: player.isAI,
    }));
}

function diffEntityMaps(before, after) {
  const created = [];
  const updated = [];
  const removed = [];
  for (const [key, entity] of after) {
    const previous = before.get(key);
    if (!previous) created.push(entity);
    else if (JSON.stringify(previous) !== JSON.stringify(entity)) updated.push(entity);
  }
  for (const key of before.keys()) {
    if (!after.has(key)) removed.push(key);
  }
  return { created, updated, removed };
}

function hasEntityChanges(diff) {
  return diff.created.length > 0 || diff.updated.length > 0 || diff.removed.length > 0;
}

export function createWebSocketGateway({
  server,
  world,
  simulation,
  v1Serializer,
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
  const chunkSize = world.metadata.chunkSize;
  let frame = 0;
  let entityRevision = 1;
  let publishedEntities = readEntityMap(world, chunkSize);
  let closed = false;
  const networkMetrics = {
    outboundMessages: 0,
    outboundBytes: 0,
    backpressureDisconnects: 0,
  };

  function clock() {
    const value = getClock();
    return { tick: value.tick, serverTime: Date.now(), nextTickAt: value.nextTickAt };
  }

  function sendV2(session, type, payload = {}) {
    const current = clock();
    return sendWithBackpressure(
      session.socket,
      serverMessage(type, payload, current),
      { maxBufferedAmount, metrics: networkMetrics },
    );
  }

  function sendError(session, error, recoverable = true) {
    sendV2(session, "error", { ...error, recoverable });
  }

  function refreshEntityRevision() {
    const current = readEntityMap(world, chunkSize);
    if (hasEntityChanges(diffEntityMaps(publishedEntities, current))) entityRevision += 1;
    publishedEntities = current;
  }

  function readChunk(key) {
    const { chunkX, chunkY } = parseChunkKey(key);
    return world.readChunkSnapshot(chunkX, chunkY);
  }

  function sendChunkSnapshot(session, key, reason = "initial") {
    const snapshot = readChunk(key);
    sendV2(session, "chunk_snapshot", {
      ...chunkSnapshotPayload(snapshot, chunkSize),
      reason,
    });
    session.knownChunkRevisions.set(key, snapshot.revision);
    session.knownChunkSnapshots.set(key, snapshot);
    return snapshot;
  }

  function syncInterest(session, { initial = false } = {}) {
    const player = world.getPlayer(session.playerId);
    if (!player) return;
    const nextInterest = interestForPlayer(player, chunkSize, preloadRadius);
    const added = [...nextInterest].filter((key) => !session.interest.has(key));
    const removed = [...session.interest].filter((key) => !nextInterest.has(key));
    if (!initial && (added.length > 0 || removed.length > 0)) {
      sendV2(session, "interest_update", { added, removed });
    }
    session.interest = nextInterest;
    for (const key of removed) {
      session.knownChunkRevisions.delete(key);
      session.knownChunkSnapshots.delete(key);
    }
    for (const key of added) sendChunkSnapshot(session, key, initial ? "initial" : "interest");
  }

  function initializeV2(session) {
    refreshEntityRevision();
    const player = world.getPlayer(session.playerId);
    sendV2(session, "world_init", {
      worldId,
      seed: world.metadata.seed,
      generatorVersion: world.metadata.generatorVersion,
      chunkSize,
      preloadRadius,
      visibleWidth: 15,
      visibleHeight: 11,
      tickMs,
      worldEpochMs,
      bgmDurationMs,
      bgmSnareOffsetMs,
      nextTickAt: clock().nextTickAt,
      entityRevision,
      player: playerEntity(player),
    });
    syncInterest(session, { initial: true });
    const entities = readEntityMap(world, chunkSize, session.interest, session.playerId);
    sendV2(session, "entity_snapshot", {
      entityRevision,
      ...entityCollections(entities),
      enemies: enemySummaries(world, session.playerId),
    });
    session.previousEntities = entities;
    session.initialized = true;
  }

  function correctionFor(playerId) {
    const player = world.getPlayer(playerId);
    return player
      ? { x: player.x, y: player.y, action: player.action, alive: player.alive }
      : null;
  }

  function sendAck(session, clientSeq, result, duplicate = false) {
    const payload = {
      ackClientSeq: clientSeq,
      accepted: Boolean(result.accepted),
      changed: Boolean(result.changed),
      reason: result.reason ?? null,
      duplicate,
      entityRevision,
      correction: correctionFor(session.playerId),
    };
    sendV2(session, "input_ack", payload);
    if (!duplicate) {
      session.acks.set(clientSeq, payload);
      if (session.acks.size > 32) session.acks.delete(session.acks.keys().next().value);
    }
  }

  function publishChunkDeltas() {
    const subscribedKeys = new Set();
    for (const session of sessions.values()) {
      if (session.mode !== 2 || !session.ready) continue;
      for (const key of session.interest) subscribedKeys.add(key);
    }
    for (const key of subscribedKeys) {
      const current = readChunk(key);
      const messagesByRevision = new Map();
      for (const session of sessions.values()) {
        if (session.mode !== 2 || !session.ready || !session.interest.has(key)) continue;
        const previous = session.knownChunkSnapshots.get(key);
        if (!previous || session.knownChunkRevisions.get(key) !== previous.revision) {
          sendChunkSnapshot(session, key, "server_resync");
          continue;
        }
        if (previous.revision === current.revision) continue;
        let message = messagesByRevision.get(previous.revision);
        if (!message) {
          message = serverMessage(
            "chunk_delta",
            diffChunkSnapshots(previous, current),
            clock(),
          );
          messagesByRevision.set(previous.revision, message);
        }
        if (
          sendWithBackpressure(session.socket, message, {
            maxBufferedAmount,
            metrics: networkMetrics,
          })
        ) {
          session.knownChunkRevisions.set(key, current.revision);
          session.knownChunkSnapshots.set(key, current);
        }
      }
    }
  }

  function publishEntityDeltas() {
    for (const session of sessions.values()) {
      if (session.mode !== 2 || !session.ready) continue;
      const entities = readEntityMap(world, chunkSize, session.interest, session.playerId);
      const diff = diffEntityMaps(session.previousEntities, entities);
      if (hasEntityChanges(diff)) {
        sendV2(session, "entity_delta", { entityRevision, ...diff });
        session.previousEntities = entities;
      }
      sendV2(session, "enemy_summary", {
        entityRevision,
        enemies: enemySummaries(world, session.playerId),
      });
    }
  }

  function publish({ refreshEntities = true, heartbeat = false } = {}) {
    if (closed) return;
    frame += 1;
    if (refreshEntities) refreshEntityRevision();

    for (const session of sessions.values()) {
      if (session.mode === 1 && session.socket.readyState === WebSocket.OPEN) {
        const current = getClock();
        sendWithBackpressure(
          session.socket,
          v1Serializer.stateFor(session.playerId, {
            tick: current.tick,
            frame,
            nextTickAt: current.nextTickAt,
          }),
          { maxBufferedAmount, metrics: networkMetrics },
        );
      }
    }
    for (const session of sessions.values()) {
      if (session.mode === 2 && session.ready) syncInterest(session);
    }
    publishChunkDeltas();
    publishEntityDeltas();
    if (heartbeat) {
      for (const session of sessions.values()) {
        if (session.mode === 2 && session.ready) {
          sendV2(session, "world_heartbeat", { nextTickAt: clock().nextTickAt, entityRevision });
        }
      }
    }
    simulation.markPublishedPositions();
  }

  function processSequencedCommand(session, message) {
    const cached = session.acks.get(message.clientSeq);
    if (cached) {
      sendV2(session, "input_ack", { ...cached, duplicate: true });
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
    refreshEntityRevision();
    sendAck(session, message.clientSeq, result);
    if (result.publish) publish({ refreshEntities: false });
  }

  function handleV2Message(session, raw) {
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
      initializeV2(session);
      publish({ refreshEntities: false });
      return;
    }
    if (!session.initialized) {
      sendError(session, { code: "join_required", message: "먼저 월드에 참가해주세요." });
      return;
    }
    if (message.type === "ready") {
      for (const key of session.interest) {
        const actual = readChunk(key);
        const known = message.knownChunkRevisions[key];
        if (known !== undefined && known !== actual.revision) {
          sendChunkSnapshot(session, key, "ready_resync");
        }
      }
      session.ready = true;
      session.previousEntities = readEntityMap(
        world,
        chunkSize,
        session.interest,
        session.playerId,
      );
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
      sendChunkSnapshot(session, message.chunkKey, "client_resync");
      return;
    }
    if (message.type === "ping") {
      sendV2(session, "pong", { clientTime: message.clientTime });
    }
  }

  function handleV1Message(session, raw) {
    try {
      const message = JSON.parse(raw.toString());
      let result = { publish: false };
      if (message.type === "join") {
        result = simulation.joinPlayer(session.playerId, message.nickname);
      } else if (message.type === "respawn") {
        result = simulation.respawnPlayer(session.playerId);
      } else if (message.type === "action") {
        result = simulation.applyAction(session.playerId, message.action);
      }
      if (result.publish) publish();
    } catch {
      // V1 malformed input remains non-fatal for compatibility.
    }
  }

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/boom-ws" && url.pathname !== "/") return socket.destroy();
    const requestedProtocols = String(request.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((value) => value.trim());
    request.boomProtocol =
      url.searchParams.get("protocol") === "2" || requestedProtocols.includes("boom-v2")
        ? 2
        : 1;
    wss.handleUpgrade(request, socket, head, (webSocket) =>
      wss.emit("connection", webSocket, request),
    );
  });

  wss.on("connection", (socket, request) => {
    const player = simulation.addPlayer();
    const mode = request.boomProtocol === 2 ? 2 : 1;
    const session = {
      socket,
      playerId: player.id,
      mode,
      initialized: false,
      ready: false,
      interest: new Set(),
      knownChunkRevisions: new Map(),
      knownChunkSnapshots: new Map(),
      previousEntities: new Map(),
      lastClientSeq: -1,
      acks: new Map(),
    };
    sessions.set(player.id, session);
    if (mode === 2) {
      sendV2(session, "hello", {
        sessionId: player.id,
        supportedProtocols: [1, 2],
        tickMs,
      });
    } else {
      sendWithBackpressure(
        socket,
        { type: "welcome", id: player.id, tickMs },
        { maxBufferedAmount, metrics: networkMetrics },
      );
      const current = getClock();
      sendWithBackpressure(
        socket,
        v1Serializer.stateFor(player.id, {
          tick: current.tick,
          frame,
          nextTickAt: current.nextTickAt,
        }),
        { maxBufferedAmount, metrics: networkMetrics },
      );
    }

    socket.on("message", (raw) =>
      mode === 2 ? handleV2Message(session, raw) : handleV1Message(session, raw),
    );
    socket.on("close", () => {
      sessions.delete(player.id);
      v1Serializer.forgetViewer(player.id);
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
        v1: [...sessions.values()].filter((session) => session.mode === 1).length,
        v2: [...sessions.values()].filter((session) => session.mode === 2).length,
        entityRevision,
        chunkSubscriptions: [...sessions.values()]
          .filter((session) => session.mode === 2 && session.ready)
          .reduce((total, session) => total + session.interest.size, 0),
        ...networkMetrics,
      };
    },
  };
}

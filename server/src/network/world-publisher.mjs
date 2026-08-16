import { chunkInterestForPlayer, parseChunkKey } from "./chunk-interest.mjs";
import {
  diffEntityMaps,
  groupProjectedEntities,
  hasEntityChanges,
  projectEnemySummaries,
  projectEntityMap,
  projectPlayer,
} from "./entity-projector.mjs";
import {
  chunkSnapshotPayload,
  diffChunkSnapshots,
  serverMessage,
} from "./protocol-v2.mjs";

export function createWorldPublisher({
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
}) {
  const chunkSize = world.metadata.chunkSize;
  let entityRevision = 1;
  let publishedEntities = projectEntityMap(world, chunkSize);

  function readChunk(key) {
    const { chunkX, chunkY } = parseChunkKey(key);
    return world.readChunkSnapshot(chunkX, chunkY);
  }

  function sendChunkSnapshot(session, key, reason = "initial") {
    const snapshot = readChunk(key);
    send(session, "chunk_snapshot", {
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
    const nextInterest = chunkInterestForPlayer(
      player,
      chunkSize,
      preloadRadius,
      world.metadata,
    );
    const added = [...nextInterest].filter((key) => !session.interest.has(key));
    const removed = [...session.interest].filter((key) => !nextInterest.has(key));
    if (!initial && (added.length > 0 || removed.length > 0)) {
      send(session, "interest_update", { added, removed });
    }
    session.interest = nextInterest;
    for (const key of removed) {
      session.knownChunkRevisions.delete(key);
      session.knownChunkSnapshots.delete(key);
    }
    for (const key of added) sendChunkSnapshot(session, key, initial ? "initial" : "interest");
  }

  function refreshEntityRevision() {
    const current = projectEntityMap(world, chunkSize);
    if (hasEntityChanges(diffEntityMaps(publishedEntities, current))) entityRevision += 1;
    publishedEntities = current;
  }

  function initializeSession(session) {
    refreshEntityRevision();
    const player = world.getPlayer(session.playerId);
    send(session, "world_init", {
      worldId,
      seed: world.metadata.seed,
      generatorVersion: world.metadata.generatorVersion,
      chunkSize,
      worldWidth: world.metadata.worldWidth,
      worldHeight: world.metadata.worldHeight,
      preloadRadius,
      visibleWidth: 15,
      visibleHeight: 11,
      tickMs,
      worldEpochMs,
      bgmDurationMs,
      bgmSnareOffsetMs,
      nextTickAt: clock().nextTickAt,
      entityRevision,
      player: projectPlayer(player),
    });
    syncInterest(session, { initial: true });
    const entities = projectEntityMap(world, chunkSize, session.interest, session.playerId);
    send(session, "entity_snapshot", {
      entityRevision,
      ...groupProjectedEntities(entities),
      enemies: projectEnemySummaries(world, session.playerId),
    });
    session.previousEntities = entities;
    session.initialized = true;
  }

  function markSessionReady(session, knownChunkRevisions) {
    for (const key of session.interest) {
      const actual = readChunk(key);
      const known = knownChunkRevisions[key];
      if (known !== undefined && known !== actual.revision) {
        sendChunkSnapshot(session, key, "ready_resync");
      }
    }
    session.ready = true;
    session.previousEntities = projectEntityMap(
      world,
      chunkSize,
      session.interest,
      session.playerId,
    );
  }

  function publishChunkDeltas() {
    const subscribedKeys = new Set();
    for (const session of sessions.values()) {
      if (!session.ready) continue;
      for (const key of session.interest) subscribedKeys.add(key);
    }
    for (const key of subscribedKeys) {
      const current = readChunk(key);
      const messagesByRevision = new Map();
      for (const session of sessions.values()) {
        if (!session.ready || !session.interest.has(key)) continue;
        const previous = session.knownChunkSnapshots.get(key);
        if (!previous || session.knownChunkRevisions.get(key) !== previous.revision) {
          sendChunkSnapshot(session, key, "server_resync");
          continue;
        }
        if (previous.revision === current.revision) continue;
        let message = messagesByRevision.get(previous.revision);
        if (!message) {
          message = serverMessage("chunk_delta", diffChunkSnapshots(previous, current), clock());
          messagesByRevision.set(previous.revision, message);
        }
        if (sendEnvelope(session, message)) {
          session.knownChunkRevisions.set(key, current.revision);
          session.knownChunkSnapshots.set(key, current);
        }
      }
    }
  }

  function publishEntityDeltas() {
    for (const session of sessions.values()) {
      if (!session.ready) continue;
      const entities = projectEntityMap(world, chunkSize, session.interest, session.playerId);
      const diff = diffEntityMaps(session.previousEntities, entities);
      if (hasEntityChanges(diff)) {
        send(session, "entity_delta", { entityRevision, ...diff });
        session.previousEntities = entities;
      }
      send(session, "enemy_summary", {
        entityRevision,
        enemies: projectEnemySummaries(world, session.playerId),
      });
    }
  }

  return {
    get entityRevision() {
      return entityRevision;
    },
    initializeSession,
    markSessionReady,
    sendChunkSnapshot,
    refreshEntityRevision,
    correctionFor(playerId) {
      const player = world.getPlayer(playerId);
      return player
        ? { x: player.x, y: player.y, action: player.action, alive: player.alive }
        : null;
    },
    publish({ refreshEntities = true, heartbeat = false } = {}) {
      if (refreshEntities) refreshEntityRevision();
      for (const session of sessions.values()) {
        if (session.ready) syncInterest(session);
      }
      publishChunkDeltas();
      publishEntityDeltas();
      if (heartbeat) {
        for (const session of sessions.values()) {
          if (session.ready) {
            send(session, "world_heartbeat", {
              nextTickAt: clock().nextTickAt,
              entityRevision,
            });
          }
        }
      }
    },
    readMetrics() {
      return {
        entityRevision,
        chunkSubscriptions: [...sessions.values()]
          .filter((session) => session.ready)
          .reduce((total, session) => total + session.interest.size, 0),
      };
    },
  };
}

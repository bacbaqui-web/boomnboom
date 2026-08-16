import { chunkInterestForPlayer, parseChunkKey } from "./chunk-interest.mjs";
import { chunkSnapshotPayload, diffChunkSnapshots } from "./protocol-v2.mjs";

export function createChunkPublisher({
  world,
  sessions,
  send,
  preloadRadius = 2,
} = {}) {
  const chunkSize = world.metadata.chunkSize;

  function readChunk(key) {
    const { chunkX, chunkY } = parseChunkKey(key);
    return world.readChunkSnapshot(chunkX, chunkY);
  }

  function readRevision(key) {
    const { chunkX, chunkY } = parseChunkKey(key);
    return world.readChunkRevision(chunkX, chunkY);
  }

  function sendChunkSnapshot(session, key, reason, serverTick) {
    const snapshot = readChunk(key);
    send(session, "chunk_snapshot", {
      ...chunkSnapshotPayload(snapshot, chunkSize),
      reason,
    }, serverTick);
    session.knownChunkRevisions.set(key, snapshot.revision);
    session.knownChunkSnapshots.set(key, snapshot);
    return snapshot;
  }

  function nextInterest(session) {
    const player = world.getPlayer(session.playerId);
    return player
      ? chunkInterestForPlayer(player, chunkSize, preloadRadius, world.metadata)
      : new Set();
  }

  function syncInterest(session, serverTick) {
    const next = nextInterest(session);
    const added = [...next].filter((key) => !session.interest.has(key));
    const removed = [...session.interest].filter((key) => !next.has(key));
    if (added.length > 0 || removed.length > 0) {
      send(session, "interest_update", { added, removed }, serverTick);
    }
    session.interest = next;
    for (const key of removed) {
      session.knownChunkRevisions.delete(key);
      session.knownChunkSnapshots.delete(key);
    }
    for (const key of added) sendChunkSnapshot(session, key, "interest", serverTick);
  }

  function publishDeltas(session, serverTick) {
    for (const key of session.interest) {
      const before = session.knownChunkSnapshots.get(key);
      if (!before) {
        sendChunkSnapshot(session, key, "server_resync", serverTick);
        continue;
      }
      if (before.revision === readRevision(key)) continue;
      const current = readChunk(key);
      send(session, "chunk_delta", diffChunkSnapshots(before, current), serverTick);
      session.knownChunkRevisions.set(key, current.revision);
      session.knownChunkSnapshots.set(key, current);
    }
  }

  return {
    initializeSession(session, serverTick) {
      session.interest = nextInterest(session);
      for (const key of session.interest) {
        sendChunkSnapshot(session, key, "initial", serverTick);
      }
    },
    markSessionReady(session, knownChunkRevisions, serverTick) {
      for (const key of session.interest) {
        const current = readChunk(key);
        const known = knownChunkRevisions[key];
        if (known !== undefined && known !== current.revision) {
          sendChunkSnapshot(session, key, "ready_resync", serverTick);
        }
      }
      session.ready = true;
    },
    sendChunkSnapshot,
    publish(serverTick) {
      let publishedSessions = 0;
      for (const session of sessions.values()) {
        if (!session.ready) continue;
        syncInterest(session, serverTick);
        publishDeltas(session, serverTick);
        publishedSessions += 1;
      }
      return publishedSessions;
    },
  };
}

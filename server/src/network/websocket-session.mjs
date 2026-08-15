export function createWebSocketSession({ socket, playerId }) {
  return {
    socket,
    playerId,
    initialized: false,
    ready: false,
    interest: new Set(),
    knownChunkRevisions: new Map(),
    knownChunkSnapshots: new Map(),
    previousEntities: new Map(),
    lastClientSeq: -1,
    acks: new Map(),
  };
}

export function rememberAcknowledgement(session, clientSeq, payload, limit = 32) {
  session.acks.set(clientSeq, payload);
  if (session.acks.size > limit) session.acks.delete(session.acks.keys().next().value);
}

export const PROTOCOL_V2 = 2;
export const V2_ACTIONS = new Set(["up", "down", "left", "right", "bomb", "wait", "stop"]);

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

export function validateV2ClientMessage(raw) {
  let message;
  try {
    message = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return failure("malformed_json", "JSON 메시지를 확인해주세요.");
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return failure("invalid_message", "메시지 객체가 필요합니다.");
  }
  if (message.protocol !== PROTOCOL_V2) {
    return failure("unsupported_protocol", "Protocol 2 연결이 필요합니다.");
  }
  if (typeof message.type !== "string") {
    return failure("invalid_type", "메시지 type이 필요합니다.");
  }

  if (message.type === "join") {
    if (typeof message.nickname !== "string") {
      return failure("invalid_nickname", "닉네임 문자열이 필요합니다.");
    }
    return { ok: true, value: { protocol: 2, type: "join", nickname: message.nickname } };
  }
  if (message.type === "ready") {
    const known = message.knownChunkRevisions ?? {};
    if (
      !known ||
      typeof known !== "object" ||
      Array.isArray(known) ||
      Object.keys(known).some((key) => !/^-?\d+,-?\d+$/.test(key)) ||
      Object.values(known).some((revision) => !Number.isInteger(revision) || revision < 1)
    ) {
      return failure("invalid_revisions", "청크 revision을 확인해주세요.");
    }
    return { ok: true, value: { protocol: 2, type: "ready", knownChunkRevisions: known } };
  }
  if (message.type === "input") {
    if (!Number.isInteger(message.clientSeq) || message.clientSeq < 0) {
      return failure("invalid_sequence", "clientSeq가 필요합니다.");
    }
    if (!V2_ACTIONS.has(message.action)) {
      return failure("invalid_action", "지원하지 않는 행동입니다.");
    }
    return {
      ok: true,
      value: {
        protocol: 2,
        type: "input",
        clientSeq: message.clientSeq,
        action: message.action,
      },
    };
  }
  if (message.type === "respawn") {
    if (!Number.isInteger(message.clientSeq) || message.clientSeq < 0) {
      return failure("invalid_sequence", "clientSeq가 필요합니다.");
    }
    return { ok: true, value: { protocol: 2, type: "respawn", clientSeq: message.clientSeq } };
  }
  if (message.type === "chunk_resync") {
    if (typeof message.chunkKey !== "string" || !/^-?\d+,-?\d+$/.test(message.chunkKey)) {
      return failure("invalid_chunk_key", "chunkKey를 확인해주세요.");
    }
    if (
      message.revision !== undefined &&
      (!Number.isInteger(message.revision) || message.revision < 0)
    ) {
      return failure("invalid_revision", "revision을 확인해주세요.");
    }
    return {
      ok: true,
      value: {
        protocol: 2,
        type: "chunk_resync",
        chunkKey: message.chunkKey,
        revision: message.revision ?? 0,
      },
    };
  }
  if (message.type === "ping") {
    return {
      ok: true,
      value: { protocol: 2, type: "ping", clientTime: Number(message.clientTime) || 0 },
    };
  }
  return failure("unsupported_type", "지원하지 않는 메시지 type입니다.");
}

export function serverMessage(type, payload, { tick, serverTime = Date.now() }) {
  return { protocol: 2, type, serverTime, worldTick: tick, ...payload };
}

export function chunkSnapshotPayload(snapshot, chunkSize) {
  return {
    chunkKey: snapshot.key,
    chunkX: snapshot.chunkX,
    chunkY: snapshot.chunkY,
    originX: snapshot.chunkX * chunkSize,
    originY: snapshot.chunkY * chunkSize,
    revision: snapshot.revision,
    tiles: snapshot.tiles,
  };
}

export function diffChunkSnapshots(before, after) {
  const changes = [];
  for (let index = 0; index < after.tiles.length; index += 1) {
    if (before.tiles[index] !== after.tiles[index]) {
      changes.push({ index, tile: after.tiles[index] });
    }
  }
  return {
    chunkKey: after.key,
    fromRevision: before.revision,
    revision: after.revision,
    changes,
  };
}

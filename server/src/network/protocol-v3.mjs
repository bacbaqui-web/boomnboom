import { isHumanPlayerColor, normalizeHumanPlayerColor } from "../../../shared/player-colors.mjs";

export const PROTOCOL_V3 = 3;
export const V3_DIRECTIONS = new Set(["up", "down", "left", "right", "neutral"]);
export const V3_ACTIONS = new Set(["bomb", "respawn"]);
export const DEFAULT_MAX_V3_MESSAGE_BYTES = 4096;

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function isUint32(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function validKnownRevisions(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => /^-?\d+,-?\d+$/.test(key)) &&
    Object.values(value).every((revision) => Number.isInteger(revision) && revision >= 1)
  );
}

export function validateV3ClientMessage(
  raw,
  { maxBytes = DEFAULT_MAX_V3_MESSAGE_BYTES } = {},
) {
  const text = typeof raw === "string" ? raw : raw?.toString?.() ?? "";
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return failure("message_too_large", "메시지 크기 제한을 초과했습니다.");
  }
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return failure("malformed_json", "JSON 메시지를 확인해주세요.");
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return failure("invalid_message", "메시지 객체가 필요합니다.");
  }
  if (message.protocol !== PROTOCOL_V3) {
    return failure("unsupported_protocol", "Protocol 3 연결이 필요합니다.");
  }
  if (typeof message.type !== "string") {
    return failure("invalid_type", "메시지 type이 필요합니다.");
  }

  if (message.type === "join") {
    if (typeof message.nickname !== "string" || message.nickname.length > 24) {
      return failure("invalid_nickname", "닉네임 문자열을 확인해주세요.");
    }
    if (message.color !== undefined && !isHumanPlayerColor(message.color)) {
      return failure("invalid_player_color", "플레이어 색상을 확인해주세요.");
    }
    return {
      ok: true,
      value: {
        protocol: 3,
        type: "join",
        nickname: message.nickname,
        color: normalizeHumanPlayerColor(message.color),
      },
    };
  }
  if (message.type === "resume") {
    if (typeof message.resumeToken !== "string" || !/^[a-f0-9]{32}$/.test(message.resumeToken)) {
      return failure("invalid_resume_token", "재접속 토큰을 확인해주세요.");
    }
    return {
      ok: true,
      value: { protocol: 3, type: "resume", resumeToken: message.resumeToken },
    };
  }
  if (message.type === "ready") {
    if (!isUint32(message.baselineTick)) {
      return failure("invalid_tick", "baselineTick을 확인해주세요.");
    }
    const knownChunkRevisions = message.knownChunkRevisions ?? {};
    if (!validKnownRevisions(knownChunkRevisions)) {
      return failure("invalid_revisions", "청크 revision을 확인해주세요.");
    }
    return {
      ok: true,
      value: { protocol: 3, type: "ready", baselineTick: message.baselineTick, knownChunkRevisions },
    };
  }
  if (message.type === "input_state") {
    if (!isUint32(message.commandSeq)) {
      return failure("invalid_sequence", "commandSeq를 확인해주세요.");
    }
    if (!isUint32(message.targetTick)) {
      return failure("invalid_tick", "targetTick을 확인해주세요.");
    }
    if (!V3_DIRECTIONS.has(message.direction)) {
      return failure("invalid_direction", "이동 방향을 확인해주세요.");
    }
    return {
      ok: true,
      value: {
        protocol: 3,
        type: "input_state",
        commandSeq: message.commandSeq,
        targetTick: message.targetTick,
        direction: message.direction,
      },
    };
  }
  if (message.type === "action_command") {
    if (!isUint32(message.commandSeq)) {
      return failure("invalid_sequence", "commandSeq를 확인해주세요.");
    }
    if (!isUint32(message.targetTick)) {
      return failure("invalid_tick", "targetTick을 확인해주세요.");
    }
    if (!V3_ACTIONS.has(message.action)) {
      return failure("invalid_action", "행동을 확인해주세요.");
    }
    return {
      ok: true,
      value: {
        protocol: 3,
        type: "action_command",
        commandSeq: message.commandSeq,
        targetTick: message.targetTick,
        action: message.action,
      },
    };
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
        protocol: 3,
        type: "chunk_resync",
        chunkKey: message.chunkKey,
        revision: Number.isInteger(message.revision) ? message.revision : 0,
      },
    };
  }
  if (message.type === "ping") {
    return {
      ok: true,
      value: { protocol: 3, type: "ping", clientTimeMs: Number(message.clientTimeMs) || 0 },
    };
  }
  return failure("unsupported_type", "지원하지 않는 메시지 type입니다.");
}

export function v3ServerMessage(
  type,
  payload,
  { tick, serverTimeMs = Date.now() },
) {
  return { protocol: 3, type, serverTick: tick, serverTimeMs, ...payload };
}

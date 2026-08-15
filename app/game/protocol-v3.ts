import type {
  BombEntity,
  FlameEntity,
  ItemEntity,
  PlayerEntity,
  ServerMessage,
} from "./protocol.ts";

export type V3Direction = "up" | "down" | "left" | "right" | "neutral";

export type V3InputCommand = {
  protocol: 3;
  type: "input_state";
  commandSeq: number;
  targetTick: number;
  direction: V3Direction;
};

export type V3ActionCommand = {
  protocol: 3;
  type: "action_command";
  commandSeq: number;
  targetTick: number;
  action: "bomb" | "respawn";
};

export type V3ClientCommand = V3InputCommand | V3ActionCommand;

export type V3PlayerSample = {
  id: string;
  px: number;
  py: number;
  vx: number;
  vy: number;
  direction: V3Direction;
  targetCellX: number | null;
  targetCellY: number | null;
  x: number;
  y: number;
  alive: boolean;
  joined: boolean;
  isAI: boolean;
  nickname: string;
  power: number;
  range: number;
  shield: number;
  lifeId: number;
  teleport: boolean;
};

export type V3ServerMessage = {
  protocol: 3;
  type: string;
  serverTick: number;
  serverTimeMs: number;
  worldTick?: number;
  nextTickAt?: number;
  [key: string]: unknown;
};

export type V3OwnerSnapshot = V3ServerMessage & {
  type: "owner_snapshot";
  snapshotSeq: number;
  lastProcessedCommandSeq: number | null;
  player: V3PlayerSample;
};

export type V3EntitySnapshot = V3ServerMessage & {
  type: "entity_snapshot";
  snapshotSeq: number;
  players: V3PlayerSample[];
  bombs?: Omit<BombEntity, "kind">[];
  items?: Omit<ItemEntity, "kind">[];
  flames?: Omit<FlameEntity, "kind">[];
};

export type V3ActionResult = V3ServerMessage & {
  type: "action_result";
  commandSeq: number;
  action: "bomb" | "respawn";
  accepted: boolean;
  reason: string | null;
  bombId?: string | number;
  cell?: { x: number; y: number };
  spawnTick?: number;
  explodeTick?: number;
};

export type V3WorldEvent = V3ServerMessage & {
  type: "world_event";
  eventSeq: number;
  eventType: string;
  eventTick: number;
  expireTick: number;
  cells?: { x: number; y: number }[];
};

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseV3ServerMessage(raw: unknown): V3ServerMessage | null {
  let value = raw;
  try {
    if (typeof raw === "string") value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Partial<V3ServerMessage>;
  if (
    message.protocol !== 3 ||
    typeof message.type !== "string" ||
    !Number.isInteger(message.serverTick) ||
    !Number.isFinite(message.serverTimeMs)
  ) {
    return null;
  }
  return message as V3ServerMessage;
}

export function isV3OwnerSnapshot(message: V3ServerMessage): message is V3OwnerSnapshot {
  const player = message.player as Partial<V3PlayerSample> | undefined;
  return (
    message.type === "owner_snapshot" &&
    Number.isInteger(message.snapshotSeq) &&
    Boolean(player) &&
    typeof player?.id === "string" &&
    Number.isSafeInteger(player.px) &&
    Number.isSafeInteger(player.py) &&
    Number.isSafeInteger(player.vx) &&
    Number.isSafeInteger(player.vy) &&
    (player.targetCellX == null || Number.isSafeInteger(player.targetCellX)) &&
    (player.targetCellY == null || Number.isSafeInteger(player.targetCellY))
  );
}

function isV3PlayerSample(value: unknown): value is V3PlayerSample {
  const player = value as Partial<V3PlayerSample> | undefined;
  return (
    Boolean(player) &&
    typeof player?.id === "string" &&
    Number.isSafeInteger(player.px) &&
    Number.isSafeInteger(player.py) &&
    Number.isSafeInteger(player.vx) &&
    Number.isSafeInteger(player.vy) &&
    (player.targetCellX == null || Number.isSafeInteger(player.targetCellX)) &&
    (player.targetCellY == null || Number.isSafeInteger(player.targetCellY)) &&
    Number.isInteger(player.lifeId) &&
    typeof player.teleport === "boolean"
  );
}

export function isV3EntitySnapshot(message: V3ServerMessage): message is V3EntitySnapshot {
  return (
    message.type === "entity_snapshot" &&
    Number.isInteger(message.snapshotSeq) &&
    Array.isArray(message.players) &&
    message.players.every(isV3PlayerSample) &&
    (message.bombs === undefined || Array.isArray(message.bombs)) &&
    (message.items === undefined || Array.isArray(message.items)) &&
    (message.flames === undefined || Array.isArray(message.flames))
  );
}

export function isV3ActionResult(message: V3ServerMessage): message is V3ActionResult {
  return (
    message.type === "action_result" &&
    Number.isInteger(message.commandSeq) &&
    (message.action === "bomb" || message.action === "respawn") &&
    typeof message.accepted === "boolean"
  );
}

export function isV3WorldEvent(message: V3ServerMessage): message is V3WorldEvent {
  return (
    message.type === "world_event" &&
    Number.isInteger(message.eventSeq) &&
    Number.isInteger(message.eventTick) &&
    Number.isInteger(message.expireTick)
  );
}

export function v3SampleToPlayer(sample: V3PlayerSample): PlayerEntity {
  return {
    kind: "player",
    id: sample.id,
    x: Math.floor(sample.px / 1024),
    y: Math.floor(sample.py / 1024),
    px: sample.px,
    py: sample.py,
    vx: sample.vx,
    vy: sample.vy,
    lifeId: sample.lifeId,
    teleport: sample.teleport,
    isAI: sample.isAI,
    action: sample.direction === "neutral" ? "wait" : sample.direction,
    score: 0,
    power: sample.power,
    range: sample.range,
    shield: sample.shield,
    nickname: sample.nickname,
    joined: sample.joined,
    alive: sample.alive,
  };
}

function envelope(message: V3ServerMessage, type = message.type): ServerMessage {
  return {
    ...message,
    protocol: 2,
    type,
    serverTime: message.serverTimeMs,
    worldTick: finiteNumber(message.worldTick),
  };
}

export function projectV3StoreMessage(message: V3ServerMessage): ServerMessage | null {
  if (message.type === "hello") return envelope(message);
  if (message.type === "world_init") {
    const playerId = typeof message.playerId === "string" ? message.playerId : "";
    return {
      ...envelope(message),
      visibleWidth: finiteNumber(message.visibleWidth, 15),
      visibleHeight: finiteNumber(message.visibleHeight, 11),
      tickMs: finiteNumber(message.tickMs, 1000),
      player: {
        kind: "player",
        id: playerId,
        x: 0,
        y: 0,
        isAI: false,
        action: "wait",
        score: 0,
        power: 1,
        range: 2,
        shield: 0,
        nickname: "",
        joined: true,
        alive: true,
      },
    };
  }
  if (message.type === "owner_snapshot" && isV3OwnerSnapshot(message)) {
    return {
      ...envelope(message, "v3_owner_snapshot"),
      player: v3SampleToPlayer(message.player),
    };
  }
  if (message.type === "entity_snapshot") {
    if (!isV3EntitySnapshot(message)) return null;
    return {
      ...envelope(message, "v3_entity_snapshot"),
      players: message.players.map(v3SampleToPlayer),
      bombs: (message.bombs ?? []).map((bomb) => ({ kind: "bomb", ...bomb })),
      items: (message.items ?? []).map((item) => ({ kind: "item", ...item })),
      flames: (message.flames ?? []).map((flame) => ({ kind: "flame", ...flame })),
    };
  }
  if (["chunk_snapshot", "chunk_delta", "interest_update", "error"].includes(message.type)) {
    return envelope(message);
  }
  return null;
}

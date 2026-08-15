export const PROTOCOL_VERSION = 2 as const;
export const CHUNK_SIZE = 16;
export const PRELOAD_CHUNK_COUNT = 25;

export type Tile = "floor" | "wall" | "crate";
export type Action = "up" | "down" | "left" | "right" | "bomb" | "wait" | "stop";
export type MoveAction = Extract<Action, "up" | "down" | "left" | "right">;
export type ConnectionStatus = "connecting" | "online" | "offline";

export type PlayerEntity = {
  kind: "player";
  id: string;
  x: number;
  y: number;
  isAI: boolean;
  action: Action;
  score: number;
  power: number;
  range: number;
  shield: number;
  nickname: string;
  joined: boolean;
  alive: boolean;
};

export type BombEntity = {
  kind: "bomb";
  id: number;
  x: number;
  y: number;
  owner: string;
  fuse: number;
  bornTick: number;
  range: number;
};

export type ItemEntity = {
  kind: "item";
  id: string;
  x: number;
  y: number;
  type: "bomb" | "shield" | "flame";
};

export type FlameEntity = {
  kind: "flame";
  id: string;
  x: number;
  y: number;
};

export type WorldEntity = PlayerEntity | BombEntity | ItemEntity | FlameEntity;

export type EnemySummary = {
  id: string;
  dx: number;
  dy: number;
  distance: number;
  nickname: string;
  isAI: boolean;
};

export type ServerMessage = {
  protocol: 2;
  type: string;
  serverTime: number;
  worldTick: number;
  [key: string]: unknown;
};

export function parseServerMessage(raw: unknown): ServerMessage | null {
  let value: unknown = raw;
  try {
    if (typeof raw === "string") value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Partial<ServerMessage>;
  if (
    message.protocol !== PROTOCOL_VERSION ||
    typeof message.type !== "string" ||
    !Number.isFinite(message.serverTime) ||
    !Number.isInteger(message.worldTick)
  ) {
    return null;
  }
  return message as ServerMessage;
}

export function entityKey(entity: WorldEntity) {
  return `${entity.kind}:${entity.id}`;
}

export function withProtocolQuery(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("protocol", String(PROTOCOL_VERSION));
  return parsed.toString();
}

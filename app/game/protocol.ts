import type { PlayerColorId } from "./player-color";

export const PROTOCOL_VERSION = 2 as const;
export const CHUNK_SIZE = 16;
export const PRELOAD_CHUNK_COUNT = 25;

export type Tile = "floor" | "wall" | "crate" | "crate_warning";
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
  speedLevel?: number;
  nickname: string;
  color?: PlayerColorId;
  joined: boolean;
  alive: boolean;
  px?: number;
  py?: number;
  vx?: number;
  vy?: number;
  lifeId?: number;
  teleport?: boolean;
};

export type BombEntity = {
  kind: "bomb";
  id: string | number;
  x: number;
  y: number;
  owner: string;
  fuse: number;
  bornTick: number;
  range: number;
  spawnTick?: number;
  explodeTick?: number | null;
};

export type ItemEntity = {
  kind: "item";
  id: string;
  x: number;
  y: number;
  type: "bomb" | "shield" | "flame" | "speed";
};

export type FlameEntity = {
  kind: "flame";
  id: string;
  x: number;
  y: number;
  eventSeq?: number;
  startTick?: number;
  expireTick?: number;
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

export function withProtocolQuery(url: string, protocol: 2 | 3 = PROTOCOL_VERSION) {
  const parsed = new URL(url);
  parsed.searchParams.set("protocol", String(protocol));
  return parsed.toString();
}

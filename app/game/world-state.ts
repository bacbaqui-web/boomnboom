import type {
  ConnectionStatus,
  EnemySummary,
  Tile,
  WorldEntity,
} from "./protocol.ts";

export type ChunkState = {
  chunkKey: string;
  chunkX: number;
  chunkY: number;
  originX: number;
  originY: number;
  revision: number;
  tiles: readonly Tile[];
};

export type WorldMetadata = {
  worldId: string;
  seed: number;
  generatorVersion: string | number;
  chunkSize: number;
  preloadRadius: number;
  visibleWidth: number;
  visibleHeight: number;
  tickMs: number;
  worldEpochMs: number;
  bgmDurationMs: number;
  bgmSnareOffsetMs: number;
};

export type WorldSnapshot = {
  version: number;
  connection: ConnectionStatus;
  initialized: boolean;
  localPlayerId: string;
  metadata: WorldMetadata | null;
  chunkKeys: readonly string[];
  entityRevision: number;
  worldTick: number;
  serverTime: number;
  nextTickAt: number;
  ackClientSeq: number;
  lastError: string;
};

export type EntitySnapshot = {
  revision: number;
  entities: readonly WorldEntity[];
  enemies: readonly EnemySummary[];
};

export type WorldRuntimeState = {
  chunks: Map<string, ChunkState>;
  entities: Map<string, WorldEntity>;
  initializing: boolean;
  initialChunkKeys: Set<string>;
  snapshot: WorldSnapshot;
  entitySnapshot: EntitySnapshot;
};

export function createWorldRuntimeState(): WorldRuntimeState {
  return {
    chunks: new Map(),
    entities: new Map(),
    initializing: false,
    initialChunkKeys: new Set(),
    snapshot: {
      version: 0,
      connection: "connecting",
      initialized: false,
      localPlayerId: "",
      metadata: null,
      chunkKeys: [],
      entityRevision: 0,
      worldTick: 0,
      serverTime: 0,
      nextTickAt: 0,
      ackClientSeq: -1,
      lastError: "",
    },
    entitySnapshot: { revision: 0, entities: [], enemies: [] },
  };
}

export function updateWorldSnapshot(
  state: WorldRuntimeState,
  changes: Partial<WorldSnapshot>,
) {
  state.snapshot = {
    ...state.snapshot,
    ...changes,
    version: state.snapshot.version + 1,
  };
}

export function updateEntitySnapshot(
  state: WorldRuntimeState,
  enemies = state.entitySnapshot.enemies,
) {
  state.entitySnapshot = {
    revision: state.snapshot.entityRevision,
    entities: [...state.entities.values()],
    enemies,
  };
}

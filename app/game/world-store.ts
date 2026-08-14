import {
  type ConnectionStatus,
  type EnemySummary,
  entityKey,
  type RespawnProjection,
  type ServerMessage,
  type Tile,
  type PlayerEntity,
  type WorldEntity,
} from "./protocol.ts";

export type ChunkState = {
  chunkKey: string;
  chunkX: number;
  chunkY: number;
  originX: number;
  originY: number;
  revision: number;
  tiles: readonly Tile[];
  respawns: readonly RespawnProjection[];
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

export type ApplyResult =
  | { applied: true }
  | { applied: false; reason: "stale" | "invalid" }
  | { applied: false; reason: "chunk_gap"; chunkKey: string; revision: number };

type Listener = () => void;

function numberField(message: ServerMessage, key: string, fallback = 0) {
  const value = message[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringField(message: ServerMessage, key: string, fallback = "") {
  const value = message[key];
  return typeof value === "string" ? value : fallback;
}

function identityField(message: ServerMessage, key: string, fallback: string | number = "") {
  const value = message[key];
  return typeof value === "string" || typeof value === "number" ? value : fallback;
}

function entityArray(value: unknown): WorldEntity[] {
  return Array.isArray(value)
    ? value.filter(
        (entity): entity is WorldEntity =>
          Boolean(entity) &&
          typeof entity === "object" &&
          typeof (entity as WorldEntity).kind === "string" &&
          (typeof (entity as WorldEntity).id === "string" ||
            typeof (entity as WorldEntity).id === "number"),
      )
    : [];
}

function enemiesArray(value: unknown): EnemySummary[] {
  return Array.isArray(value)
    ? value.filter(
        (enemy): enemy is EnemySummary =>
          Boolean(enemy) &&
          typeof enemy === "object" &&
          typeof (enemy as EnemySummary).id === "string",
      )
    : [];
}

export class ClientWorldStore {
  #chunks = new Map<string, ChunkState>();
  #entities = new Map<string, WorldEntity>();
  #listeners = new Set<Listener>();
  #chunkListeners = new Map<string, Set<Listener>>();
  #entityListeners = new Set<Listener>();
  #entitySnapshot: EntitySnapshot = { revision: 0, entities: [], enemies: [] };
  #initializing = false;
  #initialChunkKeys = new Set<string>();
  #snapshot: WorldSnapshot = {
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
  };

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  subscribeEntities = (listener: Listener) => {
    this.#entityListeners.add(listener);
    return () => this.#entityListeners.delete(listener);
  };

  subscribeChunk(chunkKey: string, listener: Listener) {
    const listeners = this.#chunkListeners.get(chunkKey) ?? new Set<Listener>();
    listeners.add(listener);
    this.#chunkListeners.set(chunkKey, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#chunkListeners.delete(chunkKey);
    };
  }

  getSnapshot = () => this.#snapshot;
  getServerSnapshot = () => this.#snapshot;
  getEntitySnapshot = () => this.#entitySnapshot;
  getChunk = (chunkKey: string) => this.#chunks.get(chunkKey) ?? null;

  canEnterCell(x: number, y: number, localPlayerId = this.#snapshot.localPlayerId) {
    const chunkSize = this.#snapshot.metadata?.chunkSize ?? 16;
    const chunkX = Math.floor(x / chunkSize);
    const chunkY = Math.floor(y / chunkSize);
    const chunk = this.#chunks.get(`${chunkX},${chunkY}`);
    if (!chunk) return false;
    const localX = ((x % chunkSize) + chunkSize) % chunkSize;
    const localY = ((y % chunkSize) + chunkSize) % chunkSize;
    const tile = chunk.tiles[localY * chunkSize + localX];
    if (tile === "wall" || tile === "crate" || !tile) return false;
    return ![...this.#entities.values()].some((entity) => {
      if (entity.x !== x || entity.y !== y) return false;
      if (entity.kind === "bomb") return true;
      return entity.kind === "player" && entity.id !== localPlayerId && entity.alive;
    });
  }

  getKnownChunkRevisions() {
    return Object.fromEntries([...this.#chunks].map(([key, chunk]) => [key, chunk.revision]));
  }

  setConnection(connection: ConnectionStatus) {
    if (this.#snapshot.connection === connection) return;
    this.#commit({ connection });
  }

  #commit(changes: Partial<WorldSnapshot>) {
    this.#snapshot = {
      ...this.#snapshot,
      ...changes,
      version: this.#snapshot.version + 1,
    };
    for (const listener of this.#listeners) listener();
  }

  #emitChunk(chunkKey: string) {
    for (const listener of this.#chunkListeners.get(chunkKey) ?? []) listener();
  }

  #emitEntities(enemies = this.#entitySnapshot.enemies) {
    this.#entitySnapshot = {
      revision: this.#snapshot.entityRevision,
      entities: [...this.#entities.values()],
      enemies,
    };
    for (const listener of this.#entityListeners) listener();
  }

  #updateClock(message: ServerMessage) {
    return {
      worldTick: message.worldTick,
      serverTime: message.serverTime,
      nextTickAt: numberField(message, "nextTickAt", this.#snapshot.nextTickAt),
    };
  }

  apply(message: ServerMessage): ApplyResult {
    if (message.type === "hello") {
      this.#commit({ ...this.#updateClock(message), initialized: false });
      return { applied: true };
    }

    if (message.type === "world_init") {
      const metadata: WorldMetadata = {
        worldId: stringField(message, "worldId"),
        seed: numberField(message, "seed"),
        generatorVersion: identityField(message, "generatorVersion"),
        chunkSize: numberField(message, "chunkSize", 16),
        preloadRadius: numberField(message, "preloadRadius", 2),
        visibleWidth: numberField(message, "visibleWidth", 15),
        visibleHeight: numberField(message, "visibleHeight", 11),
        tickMs: numberField(message, "tickMs", 1000),
        worldEpochMs: numberField(message, "worldEpochMs"),
        bgmDurationMs: numberField(message, "bgmDurationMs", 209995.5),
        bgmSnareOffsetMs: numberField(message, "bgmSnareOffsetMs", 255),
      };
      const previous = this.#snapshot.metadata;
      const sameWorld =
        previous?.worldId === metadata.worldId &&
        previous.generatorVersion === metadata.generatorVersion &&
        previous.chunkSize === metadata.chunkSize;
      if (!sameWorld) {
        const removed = [...this.#chunks.keys()];
        this.#chunks.clear();
        for (const key of removed) this.#emitChunk(key);
      }
      this.#entities.clear();
      this.#initialChunkKeys.clear();
      const player = message.player as WorldEntity | undefined;
      if (player?.kind === "player") this.#entities.set(entityKey(player), player);
      this.#initializing = true;
      this.#commit({
        ...this.#updateClock(message),
        metadata,
        initialized: false,
        localPlayerId: player?.kind === "player" ? player.id : "",
        chunkKeys: [...this.#chunks.keys()],
        entityRevision: 0,
        ackClientSeq: -1,
        lastError: "",
      });
      this.#emitEntities([]);
      return { applied: true };
    }

    if (message.type === "chunk_snapshot") {
      const chunkKey = stringField(message, "chunkKey");
      const revision = numberField(message, "revision");
      const current = this.#chunks.get(chunkKey);
      if (!chunkKey || revision < 1) return { applied: false, reason: "invalid" };
      if (!this.#initializing && current && revision <= current.revision) {
        return { applied: false, reason: "stale" };
      }
      const tiles = Array.isArray(message.tiles) ? (message.tiles as Tile[]) : [];
      const respawns = Array.isArray(message.respawns)
        ? (message.respawns as RespawnProjection[])
        : [];
      const isNew = !current;
      if (this.#initializing) this.#initialChunkKeys.add(chunkKey);
      this.#chunks.set(chunkKey, {
        chunkKey,
        chunkX: numberField(message, "chunkX"),
        chunkY: numberField(message, "chunkY"),
        originX: numberField(message, "originX"),
        originY: numberField(message, "originY"),
        revision,
        tiles: [...tiles],
        respawns: respawns.map((respawn) => ({ ...respawn })),
      });
      this.#emitChunk(chunkKey);
      this.#commit({
        ...this.#updateClock(message),
        chunkKeys: isNew ? [...this.#chunks.keys()] : this.#snapshot.chunkKeys,
      });
      return { applied: true };
    }

    if (message.type === "chunk_delta") {
      const chunkKey = stringField(message, "chunkKey");
      const fromRevision = numberField(message, "fromRevision");
      const revision = numberField(message, "revision");
      const current = this.#chunks.get(chunkKey);
      if (current && revision <= current.revision) return { applied: false, reason: "stale" };
      if (!current || current.revision !== fromRevision) {
        return {
          applied: false,
          reason: "chunk_gap",
          chunkKey,
          revision: current?.revision ?? 0,
        };
      }
      const tiles = [...current.tiles];
      for (const change of Array.isArray(message.changes) ? message.changes : []) {
        const cell = change as { index?: number; tile?: Tile };
        if (Number.isInteger(cell.index) && cell.tile) tiles[cell.index as number] = cell.tile;
      }
      const respawns = new Map(current.respawns.map((respawn) => [respawn.index, respawn]));
      for (const change of Array.isArray(message.respawnChanges)
        ? message.respawnChanges
        : []) {
        const respawn = change as RespawnProjection;
        if (Number.isInteger(respawn.index)) respawns.set(respawn.index, { ...respawn });
      }
      for (const index of Array.isArray(message.removedRespawnIndexes)
        ? message.removedRespawnIndexes
        : []) {
        if (Number.isInteger(index)) respawns.delete(index as number);
      }
      this.#chunks.set(chunkKey, {
        ...current,
        revision,
        tiles,
        respawns: [...respawns.values()],
      });
      this.#emitChunk(chunkKey);
      this.#commit(this.#updateClock(message));
      return { applied: true };
    }

    if (message.type === "interest_update") {
      const removed = Array.isArray(message.removed) ? message.removed : [];
      let changed = false;
      for (const key of removed) {
        if (typeof key !== "string" || !this.#chunks.delete(key)) continue;
        changed = true;
        this.#emitChunk(key);
      }
      this.#commit({
        ...this.#updateClock(message),
        chunkKeys: changed ? [...this.#chunks.keys()] : this.#snapshot.chunkKeys,
      });
      return { applied: true };
    }

    if (message.type === "entity_snapshot") {
      const revision = numberField(message, "entityRevision");
      let chunkKeysChanged = false;
      for (const chunkKey of this.#chunks.keys()) {
        if (this.#initialChunkKeys.has(chunkKey)) continue;
        this.#chunks.delete(chunkKey);
        this.#emitChunk(chunkKey);
        chunkKeysChanged = true;
      }
      this.#entities.clear();
      const entities = [
        ...entityArray(message.players),
        ...entityArray(message.bombs),
        ...entityArray(message.items),
        ...entityArray(message.flames),
      ];
      for (const entity of entities) this.#entities.set(entityKey(entity), entity);
      this.#initializing = false;
      this.#commit({
        ...this.#updateClock(message),
        initialized: true,
        entityRevision: revision,
        chunkKeys: chunkKeysChanged ? [...this.#chunks.keys()] : this.#snapshot.chunkKeys,
      });
      this.#emitEntities(enemiesArray(message.enemies));
      return { applied: true };
    }

    if (message.type === "entity_delta") {
      const revision = numberField(message, "entityRevision");
      if (revision <= this.#snapshot.entityRevision) {
        return { applied: false, reason: "stale" };
      }
      for (const entity of [
        ...entityArray(message.created),
        ...entityArray(message.updated),
      ]) {
        this.#entities.set(entityKey(entity), entity);
      }
      for (const key of Array.isArray(message.removed) ? message.removed : []) {
        if (typeof key === "string") this.#entities.delete(key);
      }
      this.#commit({ ...this.#updateClock(message), entityRevision: revision });
      this.#emitEntities();
      return { applied: true };
    }

    if (message.type === "enemy_summary") {
      const revision = numberField(message, "entityRevision");
      if (revision < this.#snapshot.entityRevision) return { applied: false, reason: "stale" };
      this.#commit(this.#updateClock(message));
      this.#emitEntities(enemiesArray(message.enemies));
      return { applied: true };
    }

    if (message.type === "input_ack") {
      const ackClientSeq = numberField(message, "ackClientSeq", -1);
      if (ackClientSeq < this.#snapshot.ackClientSeq) {
        return { applied: false, reason: "stale" };
      }
      const correction = message.correction as
        | { x: number; y: number; action: PlayerEntity["action"]; alive: boolean }
        | null;
      const player = [...this.#entities.values()].find(
        (entity) => entity.kind === "player" && entity.id === this.#snapshot.localPlayerId,
      );
      if (player?.kind === "player" && correction) {
        this.#entities.set(entityKey(player), { ...player, ...correction });
      }
      this.#commit({ ...this.#updateClock(message), ackClientSeq });
      this.#emitEntities();
      return { applied: true };
    }

    if (message.type === "error") {
      this.#commit({
        ...this.#updateClock(message),
        lastError: stringField(message, "message", "서버 메시지를 확인해주세요."),
      });
      return { applied: true };
    }

    this.#commit(this.#updateClock(message));
    return { applied: true };
  }
}

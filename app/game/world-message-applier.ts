import {
  type EnemySummary,
  entityKey,
  type PlayerEntity,
  type ServerMessage,
  type Tile,
  type WorldEntity,
} from "./protocol.ts";
import {
  type WorldMetadata,
  type WorldRuntimeState,
  updateEntitySnapshot,
  updateWorldSnapshot,
} from "./world-state.ts";
import { isNetTickAfter } from "../../shared/net-tick.mjs";

export type ApplyResult =
  | { applied: true }
  | { applied: false; reason: "stale" | "invalid" }
  | { applied: false; reason: "chunk_gap"; chunkKey: string; revision: number };

export type ApplyEffects = {
  result: ApplyResult;
  globalChanged: boolean;
  changedChunks: readonly string[];
  entitiesChanged: boolean;
};

function ignored(result: ApplyResult): ApplyEffects {
  return { result, globalChanged: false, changedChunks: [], entitiesChanged: false };
}

function applied({
  changedChunks = [],
  entitiesChanged = false,
}: {
  changedChunks?: readonly string[];
  entitiesChanged?: boolean;
} = {}): ApplyEffects {
  return {
    result: { applied: true },
    globalChanged: true,
    changedChunks,
    entitiesChanged,
  };
}

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

function clockChanges(state: WorldRuntimeState, message: ServerMessage) {
  return {
    worldTick: message.worldTick,
    serverTime: message.serverTime,
    nextTickAt: numberField(message, "nextTickAt", state.snapshot.nextTickAt),
  };
}

export function applyWorldMessage(
  state: WorldRuntimeState,
  message: ServerMessage,
): ApplyEffects {
  if (message.type === "hello") {
    updateWorldSnapshot(state, { ...clockChanges(state, message), initialized: false });
    return applied();
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
    const previous = state.snapshot.metadata;
    const sameWorld =
      previous?.worldId === metadata.worldId &&
      previous.generatorVersion === metadata.generatorVersion &&
      previous.chunkSize === metadata.chunkSize;
    const removedChunks = sameWorld ? [] : [...state.chunks.keys()];
    if (!sameWorld) state.chunks.clear();
    state.entities.clear();
    state.initialChunkKeys.clear();
    const player = message.player as WorldEntity | undefined;
    if (player?.kind === "player") state.entities.set(entityKey(player), player);
    state.initializing = true;
    updateWorldSnapshot(state, {
      ...clockChanges(state, message),
      metadata,
      initialized: false,
      localPlayerId: player?.kind === "player" ? player.id : "",
      chunkKeys: [...state.chunks.keys()],
      entityRevision: 0,
      ackClientSeq: -1,
      lastError: "",
      serverTick: numberField(message, "serverTick"),
      v3OwnerSnapshotSeq: null,
      v3EntitySnapshotSeq: null,
    });
    updateEntitySnapshot(state, []);
    return applied({ changedChunks: removedChunks, entitiesChanged: true });
  }

  if (message.type === "chunk_snapshot") {
    const chunkKey = stringField(message, "chunkKey");
    const revision = numberField(message, "revision");
    const current = state.chunks.get(chunkKey);
    if (!chunkKey || revision < 1) return ignored({ applied: false, reason: "invalid" });
    if (!state.initializing && current && revision <= current.revision) {
      return ignored({ applied: false, reason: "stale" });
    }
    const tiles = Array.isArray(message.tiles) ? (message.tiles as Tile[]) : [];
    const isNew = !current;
    if (state.initializing) state.initialChunkKeys.add(chunkKey);
    state.chunks.set(chunkKey, {
      chunkKey,
      chunkX: numberField(message, "chunkX"),
      chunkY: numberField(message, "chunkY"),
      originX: numberField(message, "originX"),
      originY: numberField(message, "originY"),
      revision,
      tiles: [...tiles],
    });
    updateWorldSnapshot(state, {
      ...clockChanges(state, message),
      chunkKeys: isNew ? [...state.chunks.keys()] : state.snapshot.chunkKeys,
    });
    return applied({ changedChunks: [chunkKey] });
  }

  if (message.type === "chunk_delta") {
    const chunkKey = stringField(message, "chunkKey");
    const fromRevision = numberField(message, "fromRevision");
    const revision = numberField(message, "revision");
    const current = state.chunks.get(chunkKey);
    if (current && revision <= current.revision) {
      return ignored({ applied: false, reason: "stale" });
    }
    if (!current || current.revision !== fromRevision) {
      return ignored({
        applied: false,
        reason: "chunk_gap",
        chunkKey,
        revision: current?.revision ?? 0,
      });
    }
    const tiles = [...current.tiles];
    for (const change of Array.isArray(message.changes) ? message.changes : []) {
      const cell = change as { index?: number; tile?: Tile };
      if (Number.isInteger(cell.index) && cell.tile) tiles[cell.index as number] = cell.tile;
    }
    state.chunks.set(chunkKey, {
      ...current,
      revision,
      tiles,
    });
    updateWorldSnapshot(state, clockChanges(state, message));
    return applied({ changedChunks: [chunkKey] });
  }

  if (message.type === "interest_update") {
    const changedChunks = [];
    for (const key of Array.isArray(message.removed) ? message.removed : []) {
      if (typeof key !== "string" || !state.chunks.delete(key)) continue;
      changedChunks.push(key);
    }
    updateWorldSnapshot(state, {
      ...clockChanges(state, message),
      chunkKeys: changedChunks.length > 0
        ? [...state.chunks.keys()]
        : state.snapshot.chunkKeys,
    });
    return applied({ changedChunks });
  }

  if (message.type === "entity_snapshot") {
    const changedChunks = [];
    for (const chunkKey of state.chunks.keys()) {
      if (state.initialChunkKeys.has(chunkKey)) continue;
      state.chunks.delete(chunkKey);
      changedChunks.push(chunkKey);
    }
    state.entities.clear();
    const entities = [
      ...entityArray(message.players),
      ...entityArray(message.bombs),
      ...entityArray(message.items),
      ...entityArray(message.flames),
    ];
    for (const entity of entities) state.entities.set(entityKey(entity), entity);
    state.initializing = false;
    updateWorldSnapshot(state, {
      ...clockChanges(state, message),
      initialized: true,
      entityRevision: numberField(message, "entityRevision"),
      chunkKeys: changedChunks.length > 0
        ? [...state.chunks.keys()]
        : state.snapshot.chunkKeys,
    });
    updateEntitySnapshot(state, enemiesArray(message.enemies));
    return applied({ changedChunks, entitiesChanged: true });
  }

  if (message.type === "v3_owner_snapshot") {
    const snapshotSeq = numberField(message, "snapshotSeq");
    const previousSeq = state.snapshot.v3OwnerSnapshotSeq;
    if (previousSeq !== null && !isNetTickAfter(snapshotSeq, previousSeq)) {
      return ignored({ applied: false, reason: "stale" });
    }
    const player = message.player as PlayerEntity | undefined;
    if (!player || player.kind !== "player") {
      return ignored({ applied: false, reason: "invalid" });
    }
    state.entities.set(entityKey(player), player);
    updateWorldSnapshot(state, {
      serverTime: message.serverTime,
      serverTick: numberField(message, "serverTick"),
      v3OwnerSnapshotSeq: snapshotSeq,
    });
    updateEntitySnapshot(state);
    return applied({ entitiesChanged: true });
  }

  if (message.type === "v3_entity_snapshot") {
    const snapshotSeq = numberField(message, "snapshotSeq");
    const previousSeq = state.snapshot.v3EntitySnapshotSeq;
    if (previousSeq !== null && !isNetTickAfter(snapshotSeq, previousSeq)) {
      return ignored({ applied: false, reason: "stale" });
    }
    const localPlayerId = state.snapshot.localPlayerId;
    const players = entityArray(message.players).filter(
      (entity): entity is PlayerEntity => entity.kind === "player",
    );
    const remotePlayers = players.filter((player) => player.id !== localPlayerId);
    const nonPlayers = [
      ...entityArray(message.bombs),
      ...entityArray(message.items),
      ...entityArray(message.flames),
    ];
    const receivedIds = new Set(remotePlayers.map((player) => player.id));
    for (const [key, entity] of state.entities) {
      if (
        entity.kind === "player" &&
        entity.id !== localPlayerId &&
        !receivedIds.has(entity.id)
      ) {
        state.entities.delete(key);
      }
    }
    for (const player of remotePlayers) state.entities.set(entityKey(player), player);
    for (const [key, entity] of state.entities) {
      if (entity.kind !== "player") state.entities.delete(key);
    }
    for (const entity of nonPlayers) state.entities.set(entityKey(entity), entity);
    state.initializing = false;
    updateWorldSnapshot(state, {
      serverTime: message.serverTime,
      serverTick: numberField(message, "serverTick"),
      initialized: true,
      entityRevision: snapshotSeq,
      v3EntitySnapshotSeq: snapshotSeq,
    });
    updateEntitySnapshot(state);
    return applied({ entitiesChanged: true });
  }

  if (message.type === "entity_delta") {
    const revision = numberField(message, "entityRevision");
    if (revision <= state.snapshot.entityRevision) {
      return ignored({ applied: false, reason: "stale" });
    }
    for (const entity of [...entityArray(message.created), ...entityArray(message.updated)]) {
      state.entities.set(entityKey(entity), entity);
    }
    for (const key of Array.isArray(message.removed) ? message.removed : []) {
      if (typeof key === "string") state.entities.delete(key);
    }
    updateWorldSnapshot(state, { ...clockChanges(state, message), entityRevision: revision });
    updateEntitySnapshot(state);
    return applied({ entitiesChanged: true });
  }

  if (message.type === "enemy_summary") {
    const revision = numberField(message, "entityRevision");
    if (revision < state.snapshot.entityRevision) {
      return ignored({ applied: false, reason: "stale" });
    }
    updateWorldSnapshot(state, clockChanges(state, message));
    updateEntitySnapshot(state, enemiesArray(message.enemies));
    return applied({ entitiesChanged: true });
  }

  if (message.type === "input_ack") {
    const ackClientSeq = numberField(message, "ackClientSeq", -1);
    if (ackClientSeq < state.snapshot.ackClientSeq) {
      return ignored({ applied: false, reason: "stale" });
    }
    const correction = message.correction as
      | { x: number; y: number; action: PlayerEntity["action"]; alive: boolean }
      | null;
    const player = [...state.entities.values()].find(
      (entity) => entity.kind === "player" && entity.id === state.snapshot.localPlayerId,
    );
    if (player?.kind === "player" && correction) {
      state.entities.set(entityKey(player), { ...player, ...correction });
    }
    updateWorldSnapshot(state, { ...clockChanges(state, message), ackClientSeq });
    updateEntitySnapshot(state);
    return applied({ entitiesChanged: true });
  }

  if (message.type === "error") {
    updateWorldSnapshot(state, {
      ...clockChanges(state, message),
      lastError: stringField(message, "message", "서버 메시지를 확인해주세요."),
    });
    return applied();
  }

  updateWorldSnapshot(state, clockChanges(state, message));
  return applied();
}

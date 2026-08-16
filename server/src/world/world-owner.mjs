import {
  chunkKey,
  DEFAULT_CHUNK_SIZE,
  worldToChunk,
} from "./coordinates.mjs";
import {
  DEFAULT_GENERATOR_VERSION,
  DEFAULT_WORLD_SEED,
  generateChunk as generateBaseChunk,
} from "./chunk-generator.mjs";

function cloneEntity(entity) {
  return entity ? { ...entity } : null;
}

export class WorldOwner {
  #chunkSize;
  #seed;
  #generatorVersion;
  #generateChunk;
  #chunks = new Map();
  #players = new Map();
  #bombs = new Map();
  #items = new Map();
  #flames = [];
  #destroyedCrates = [];
  #accessClock = 0;
  #materializationCount = 0;

  constructor({
    chunkSize = DEFAULT_CHUNK_SIZE,
    seed = DEFAULT_WORLD_SEED,
    generatorVersion = DEFAULT_GENERATOR_VERSION,
    generateChunk = generateBaseChunk,
  } = {}) {
    this.#chunkSize = chunkSize;
    this.#seed = seed;
    this.#generatorVersion = generatorVersion;
    this.#generateChunk = generateChunk;
  }

  get metadata() {
    return {
      chunkSize: this.#chunkSize,
      seed: this.#seed,
      generatorVersion: this.#generatorVersion,
    };
  }

  #ensureChunk(chunkX, chunkY) {
    const key = chunkKey(chunkX, chunkY);
    let chunk = this.#chunks.get(key);
    if (!chunk) {
      const tiles = this.#generateChunk({
        chunkX,
        chunkY,
        chunkSize: this.#chunkSize,
        seed: this.#seed,
        generatorVersion: this.#generatorVersion,
      });
      if (!Array.isArray(tiles) || tiles.length !== this.#chunkSize * this.#chunkSize) {
        throw new Error(`Generator returned an invalid tile payload for ${key}`);
      }
      chunk = {
        key,
        chunkX,
        chunkY,
        revision: 1,
        generatorVersion: this.#generatorVersion,
        tiles: [...tiles],
        lastActiveAt: 0,
      };
      this.#chunks.set(key, chunk);
      this.#materializationCount += 1;
    }
    chunk.lastActiveAt = ++this.#accessClock;
    return chunk;
  }

  #chunkAndCell(x, y) {
    const location = worldToChunk(x, y, this.#chunkSize);
    return { ...location, chunk: this.#ensureChunk(location.chunkX, location.chunkY) };
  }

  materializeAround(x, y, radius = 2) {
    const center = worldToChunk(x, y, this.#chunkSize);
    const snapshots = [];
    for (let chunkY = center.chunkY - radius; chunkY <= center.chunkY + radius; chunkY += 1) {
      for (let chunkX = center.chunkX - radius; chunkX <= center.chunkX + radius; chunkX += 1) {
        const chunk = this.#ensureChunk(chunkX, chunkY);
        snapshots.push({ key: chunk.key, revision: chunk.revision });
      }
    }
    return snapshots;
  }

  readChunkSnapshot(chunkX, chunkY) {
    const chunk = this.#ensureChunk(chunkX, chunkY);
    return {
      key: chunk.key,
      chunkX,
      chunkY,
      revision: chunk.revision,
      generatorVersion: chunk.generatorVersion,
      tiles: [...chunk.tiles],
    };
  }

  readChunkRevision(chunkX, chunkY) {
    return this.#ensureChunk(chunkX, chunkY).revision;
  }

  readMaterializedChunkKeys() {
    return [...this.#chunks.keys()];
  }

  readTerrainTile(x, y) {
    const { chunk, index } = this.#chunkAndCell(x, y);
    return chunk.tiles[index];
  }

  readTile(x, y) {
    return this.readTerrainTile(x, y);
  }

  readTileRectangle({ originX, originY, width, height }) {
    return Array.from({ length: height }, (_, localY) =>
      Array.from({ length: width }, (_, localX) =>
        this.readTile(originX + localX, originY + localY),
      ),
    );
  }

  isPermanentWall(x, y) {
    return this.readTerrainTile(x, y) === "wall";
  }

  hasCrate(x, y) {
    return this.readTerrainTile(x, y) === "crate";
  }

  destroyCrate(x, y) {
    const { chunk, index } = this.#chunkAndCell(x, y);
    if (chunk.tiles[index] !== "crate") return false;
    chunk.tiles[index] = "floor";
    chunk.revision += 1;
    this.#destroyedCrates.push({ x, y });
    return true;
  }

  drainDestroyedCrates() {
    const destroyed = this.#destroyedCrates.map(cloneEntity);
    this.#destroyedCrates = [];
    return destroyed;
  }

  markCrateRespawnWarning(x, y) {
    const { chunk, index } = this.#chunkAndCell(x, y);
    if (chunk.tiles[index] !== "floor") return false;
    chunk.tiles[index] = "crate_warning";
    chunk.revision += 1;
    return true;
  }

  restoreCrate(x, y) {
    const { chunk, index } = this.#chunkAndCell(x, y);
    if (chunk.tiles[index] !== "crate_warning") return false;
    chunk.tiles[index] = "crate";
    chunk.revision += 1;
    return true;
  }

  addPlayer(player) {
    if (!player?.id || this.#players.has(player.id)) return false;
    this.#players.set(player.id, cloneEntity(player));
    return true;
  }

  updatePlayer(id, changes) {
    const player = this.#players.get(id);
    if (!player) return false;
    Object.assign(player, changes);
    return true;
  }

  commitPlayerMovement(
    id,
    movement,
    { unitsPerTile = 1024, action = movement.desiredDirection, lifeId = 1 } = {},
  ) {
    const player = this.#players.get(id);
    if (!player) return false;
    for (const key of ["px", "py", "vx", "vy", "queuedTurnUntilTick"]) {
      if (!Number.isSafeInteger(movement[key])) return false;
    }
    if (
      (movement.targetCellX !== null && !Number.isSafeInteger(movement.targetCellX)) ||
      (movement.targetCellY !== null && !Number.isSafeInteger(movement.targetCellY)) ||
      (movement.targetCellX === null) !== (movement.targetCellY === null)
    ) {
      return false;
    }
    const x = Math.floor(movement.px / unitsPerTile);
    const y = Math.floor(movement.py / unitsPerTile);
    Object.assign(player, {
      prevX: player.x,
      prevY: player.y,
      x,
      y,
      px: movement.px,
      py: movement.py,
      vx: movement.vx,
      vy: movement.vy,
      desiredDirection: movement.desiredDirection,
      queuedTurn: movement.queuedTurn,
      queuedTurnUntilTick: movement.queuedTurnUntilTick,
      targetCellX: movement.targetCellX,
      targetCellY: movement.targetCellY,
      action,
      lifeId,
    });
    return true;
  }

  removePlayer(id) {
    return this.#players.delete(id);
  }

  getPlayer(id) {
    return cloneEntity(this.#players.get(id));
  }

  readPlayers() {
    return [...this.#players.values()].map(cloneEntity);
  }

  addBomb(bomb) {
    if (bomb?.id === undefined || this.#bombs.has(bomb.id)) return false;
    this.#bombs.set(bomb.id, cloneEntity(bomb));
    return true;
  }

  updateBomb(id, changes) {
    const bomb = this.#bombs.get(id);
    if (!bomb) return false;
    Object.assign(bomb, changes);
    return true;
  }

  removeBomb(id) {
    return this.#bombs.delete(id);
  }

  readBombs() {
    return [...this.#bombs.values()].map(cloneEntity);
  }

  setItem(item) {
    this.#items.set(`${item.x},${item.y}`, cloneEntity(item));
  }

  getItemAt(x, y) {
    return cloneEntity(this.#items.get(`${x},${y}`));
  }

  removeItemAt(x, y) {
    return this.#items.delete(`${x},${y}`);
  }

  readItems() {
    return [...this.#items.values()].map(cloneEntity);
  }

  replaceFlames(flames) {
    this.#flames = flames.map(cloneEntity);
  }

  replaceFlamesForDomain(clockDomain, flames) {
    const belongsToDomain = (flame) =>
      (flame.clockDomain ?? "legacy") === clockDomain;
    this.#flames = [
      ...this.#flames.filter((flame) => !belongsToDomain(flame)),
      ...flames.map(cloneEntity),
    ];
  }

  readFlames() {
    return this.#flames.map(cloneEntity);
  }

  trimColdChunks({ maxChunks = 512, retentionRadius = 3 } = {}) {
    if (this.#chunks.size <= maxChunks) return 0;
    const protectedKeys = new Set();
    for (const player of this.#players.values()) {
      if (!player.alive) continue;
      const center = worldToChunk(player.x, player.y, this.#chunkSize);
      for (let dy = -retentionRadius; dy <= retentionRadius; dy += 1) {
        for (let dx = -retentionRadius; dx <= retentionRadius; dx += 1) {
          protectedKeys.add(chunkKey(center.chunkX + dx, center.chunkY + dy));
        }
      }
    }
    for (const entity of [
      ...this.#bombs.values(),
      ...this.#items.values(),
      ...this.#flames,
    ]) {
      protectedKeys.add(worldToChunk(entity.x, entity.y, this.#chunkSize).chunkKey);
    }

    const removable = [...this.#chunks.values()]
      .filter((chunk) => chunk.revision === 1 && !protectedKeys.has(chunk.key))
      .sort((left, right) => left.lastActiveAt - right.lastActiveAt);
    let removed = 0;
    for (const chunk of removable) {
      if (this.#chunks.size <= maxChunks) break;
      this.#chunks.delete(chunk.key);
      removed += 1;
    }
    return removed;
  }

  readMetrics() {
    const activeKeys = new Set();
    for (const player of this.#players.values()) {
      if (!player.alive) continue;
      const center = worldToChunk(player.x, player.y, this.#chunkSize);
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          activeKeys.add(chunkKey(center.chunkX + dx, center.chunkY + dy));
        }
      }
    }
    const pinnedKeys = new Set();
    for (const chunk of this.#chunks.values()) {
      if (chunk.revision > 1) pinnedKeys.add(chunk.key);
    }
    for (const entity of [
      ...this.#bombs.values(),
      ...this.#items.values(),
      ...this.#flames,
    ]) {
      pinnedKeys.add(worldToChunk(entity.x, entity.y, this.#chunkSize).chunkKey);
    }
    const activeChunks = [...activeKeys].filter((key) => this.#chunks.has(key)).length;
    const pinnedChunks = [...pinnedKeys].filter((key) => this.#chunks.has(key)).length;
    const retainedChunks = [...this.#chunks.keys()].filter(
      (key) => !activeKeys.has(key) && !pinnedKeys.has(key),
    ).length;
    const players = [...this.#players.values()];
    const humans = players.filter((player) => !player.isAI).length;
    const bots = players.length - humans;
    const entities =
      players.length + this.#bombs.size + this.#items.size + this.#flames.length;
    return {
      chunks: this.#chunks.size,
      activeChunks,
      pinnedChunks,
      retainedChunks,
      materializations: this.#materializationCount,
      players: players.length,
      humans,
      bots,
      bombs: this.#bombs.size,
      items: this.#items.size,
      flames: this.#flames.length,
      entities,
    };
  }
}

export function createWorldOwner(options) {
  return new WorldOwner(options);
}

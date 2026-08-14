import { chunkOrigin, DEFAULT_CHUNK_SIZE } from "./coordinates.mjs";

export const DEFAULT_WORLD_SEED = 0x9e3779b9;
export const DEFAULT_GENERATOR_VERSION = 1;

export function isPermanentWall(x, y) {
  return x % 2 === 0 && y % 2 === 0;
}

export function hashWorldCell(
  x,
  y,
  seed = DEFAULT_WORLD_SEED,
  generatorVersion = DEFAULT_GENERATOR_VERSION,
) {
  let value =
    Math.imul(x, 374761393) +
    Math.imul(y, 668265263) +
    Math.imul(seed | 0, 69069) +
    Math.imul(generatorVersion | 0, 362437);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) >>> 0;
}

function rawCrateCandidate(x, y, seed, generatorVersion) {
  return (
    !isPermanentWall(x, y) &&
    hashWorldCell(x, y, seed, generatorVersion) % 100 < 58
  );
}

function isHighestScoreInRawLine(x, y, dx, dy, offset, seed, generatorVersion) {
  const cells = [0, 1, 2].map((step) => ({
    x: x + (offset + step) * dx,
    y: y + (offset + step) * dy,
  }));
  if (!cells.every((cell) => rawCrateCandidate(cell.x, cell.y, seed, generatorVersion))) {
    return false;
  }
  const ownScore = hashWorldCell(x, y, seed, generatorVersion);
  return cells.every((cell) => {
    const score = hashWorldCell(cell.x, cell.y, seed, generatorVersion);
    return ownScore > score || (ownScore === score && (x > cell.x || (x === cell.x && y >= cell.y)));
  });
}

export function isBaseCrate(
  x,
  y,
  seed = DEFAULT_WORLD_SEED,
  generatorVersion = DEFAULT_GENERATOR_VERSION,
) {
  if (!rawCrateCandidate(x, y, seed, generatorVersion)) return false;

  let nearbyRawCrates = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (rawCrateCandidate(x + dx, y + dy, seed, generatorVersion)) {
        nearbyRawCrates += 1;
      }
    }
  }
  if (nearbyRawCrates >= 7 && hashWorldCell(x, y, seed, generatorVersion) % 3 !== 0) {
    return false;
  }

  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    for (const offset of [-2, -1, 0]) {
      if (isHighestScoreInRawLine(x, y, dx, dy, offset, seed, generatorVersion)) {
        return false;
      }
    }
  }
  return true;
}

export function baseTileAt(
  x,
  y,
  { seed = DEFAULT_WORLD_SEED, generatorVersion = DEFAULT_GENERATOR_VERSION } = {},
) {
  if (isPermanentWall(x, y)) return "wall";
  return isBaseCrate(x, y, seed, generatorVersion) ? "crate" : "floor";
}

export function generateChunk({
  chunkX,
  chunkY,
  chunkSize = DEFAULT_CHUNK_SIZE,
  seed = DEFAULT_WORLD_SEED,
  generatorVersion = DEFAULT_GENERATOR_VERSION,
}) {
  const origin = chunkOrigin(chunkX, chunkY, chunkSize);
  const tiles = new Array(chunkSize * chunkSize);
  for (let localY = 0; localY < chunkSize; localY += 1) {
    for (let localX = 0; localX < chunkSize; localX += 1) {
      tiles[localY * chunkSize + localX] = baseTileAt(origin.x + localX, origin.y + localY, {
        seed,
        generatorVersion,
      });
    }
  }
  return tiles;
}

export const DEFAULT_WORLD_WIDTH = 256;
export const DEFAULT_WORLD_HEIGHT = 256;

export function hasFiniteWorldBounds(metadata) {
  return (
    Number.isSafeInteger(metadata?.worldWidth) &&
    metadata.worldWidth > 0 &&
    Number.isSafeInteger(metadata?.worldHeight) &&
    metadata.worldHeight > 0
  );
}

export function isWorldCellInBounds(x, y, metadata) {
  if (!hasFiniteWorldBounds(metadata)) return true;
  return x >= 0 && y >= 0 && x < metadata.worldWidth && y < metadata.worldHeight;
}

export function isWorldBoundaryCell(x, y, metadata) {
  if (!hasFiniteWorldBounds(metadata)) return false;
  return (
    x === 0 ||
    y === 0 ||
    x === metadata.worldWidth - 1 ||
    y === metadata.worldHeight - 1
  );
}

export function finiteChunkRange(metadata) {
  if (!hasFiniteWorldBounds(metadata)) return null;
  const chunkSize = metadata.chunkSize;
  return {
    minChunkX: 0,
    minChunkY: 0,
    maxChunkX: Math.ceil(metadata.worldWidth / chunkSize) - 1,
    maxChunkY: Math.ceil(metadata.worldHeight / chunkSize) - 1,
  };
}

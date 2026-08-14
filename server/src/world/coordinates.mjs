export const DEFAULT_CHUNK_SIZE = 16;

export function floorDiv(value, divisor) {
  if (!Number.isInteger(value) || !Number.isInteger(divisor) || divisor <= 0) {
    throw new TypeError("floorDiv expects an integer value and a positive integer divisor");
  }
  return Math.floor(value / divisor);
}

export function positiveMod(value, divisor) {
  if (!Number.isInteger(value) || !Number.isInteger(divisor) || divisor <= 0) {
    throw new TypeError("positiveMod expects an integer value and a positive integer divisor");
  }
  return ((value % divisor) + divisor) % divisor;
}

export function chunkKey(chunkX, chunkY) {
  return `${chunkX},${chunkY}`;
}

export function cellKey(x, y) {
  return `${x},${y}`;
}

export function worldToChunk(x, y, chunkSize = DEFAULT_CHUNK_SIZE) {
  const chunkX = floorDiv(x, chunkSize);
  const chunkY = floorDiv(y, chunkSize);
  const localX = positiveMod(x, chunkSize);
  const localY = positiveMod(y, chunkSize);
  return {
    chunkX,
    chunkY,
    chunkKey: chunkKey(chunkX, chunkY),
    localX,
    localY,
    index: localY * chunkSize + localX,
  };
}

export function chunkOrigin(chunkX, chunkY, chunkSize = DEFAULT_CHUNK_SIZE) {
  return { x: chunkX * chunkSize, y: chunkY * chunkSize };
}

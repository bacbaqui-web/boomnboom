import { worldToChunk } from "../world/coordinates.mjs";
import { finiteChunkRange } from "../world/world-bounds.mjs";

export function parseChunkKey(key) {
  const [chunkX, chunkY] = key.split(",").map(Number);
  return { chunkX, chunkY };
}

export function chunkInterestForPlayer(player, chunkSize, radius, worldMetadata = null) {
  const center = worldToChunk(player.x, player.y, chunkSize);
  const range = finiteChunkRange(worldMetadata);
  const keys = new Set();
  for (let chunkY = center.chunkY - radius; chunkY <= center.chunkY + radius; chunkY += 1) {
    for (let chunkX = center.chunkX - radius; chunkX <= center.chunkX + radius; chunkX += 1) {
      if (
        range &&
        (chunkX < range.minChunkX || chunkX > range.maxChunkX ||
          chunkY < range.minChunkY || chunkY > range.maxChunkY)
      ) continue;
      keys.add(`${chunkX},${chunkY}`);
    }
  }
  return keys;
}

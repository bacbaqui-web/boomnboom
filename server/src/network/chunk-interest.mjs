import { worldToChunk } from "../world/coordinates.mjs";

export function parseChunkKey(key) {
  const [chunkX, chunkY] = key.split(",").map(Number);
  return { chunkX, chunkY };
}

export function chunkInterestForPlayer(player, chunkSize, radius) {
  const center = worldToChunk(player.x, player.y, chunkSize);
  const keys = new Set();
  for (let chunkY = center.chunkY - radius; chunkY <= center.chunkY + radius; chunkY += 1) {
    for (let chunkX = center.chunkX - radius; chunkX <= center.chunkX + radius; chunkX += 1) {
      keys.add(`${chunkX},${chunkY}`);
    }
  }
  return keys;
}

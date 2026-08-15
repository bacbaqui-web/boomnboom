import type { WorldRuntimeState } from "./world-state.ts";

export function canEnterWorldCell(
  state: WorldRuntimeState,
  x: number,
  y: number,
  localPlayerId = state.snapshot.localPlayerId,
) {
  const chunkSize = state.snapshot.metadata?.chunkSize ?? 16;
  const chunkX = Math.floor(x / chunkSize);
  const chunkY = Math.floor(y / chunkSize);
  const chunk = state.chunks.get(`${chunkX},${chunkY}`);
  if (!chunk) return false;
  const localX = ((x % chunkSize) + chunkSize) % chunkSize;
  const localY = ((y % chunkSize) + chunkSize) % chunkSize;
  const tile = chunk.tiles[localY * chunkSize + localX];
  if (tile === "wall" || tile === "crate" || !tile) return false;
  return ![...state.entities.values()].some((entity) => {
    if (entity.x !== x || entity.y !== y) return false;
    if (entity.kind === "bomb") return true;
    return entity.kind === "player" && entity.id !== localPlayerId && entity.alive;
  });
}

export function knownChunkRevisions(state: WorldRuntimeState) {
  return Object.fromEntries(
    [...state.chunks].map(([key, chunk]) => [key, chunk.revision]),
  );
}

export function selectNearbyChunkKeys(
  chunkKeys: readonly string[],
  worldX: number,
  worldY: number,
  chunkSize = 16,
  radius = 1,
) {
  const centerX = Math.floor(worldX / chunkSize);
  const centerY = Math.floor(worldY / chunkSize);
  return chunkKeys.filter((chunkKey) => {
    if (!/^-?\d+,-?\d+$/.test(chunkKey)) return false;
    const [chunkX, chunkY] = chunkKey.split(",").map(Number);
    return (
      Math.abs(chunkX - centerX) <= radius &&
      Math.abs(chunkY - centerY) <= radius
    );
  });
}

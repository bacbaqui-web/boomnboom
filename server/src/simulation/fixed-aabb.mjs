import { DEFAULT_MOVEMENT_CONFIG } from "../../../shared/movement-config.mjs";

export function playerOverlapsCell(
  player,
  cellX,
  cellY,
  config = DEFAULT_MOVEMENT_CONFIG,
) {
  const px = Number.isSafeInteger(player?.px)
    ? player.px
    : player?.x * config.unitsPerTile + config.unitsPerTile / 2;
  const py = Number.isSafeInteger(player?.py)
    ? player.py
    : player?.y * config.unitsPerTile + config.unitsPerTile / 2;
  if (!Number.isSafeInteger(px) || !Number.isSafeInteger(py)) return false;
  const left = cellX * config.unitsPerTile;
  const top = cellY * config.unitsPerTile;
  const right = left + config.unitsPerTile;
  const bottom = top + config.unitsPerTile;
  return (
    px + config.collisionHalfExtent > left &&
    px - config.collisionHalfExtent < right &&
    py + config.collisionHalfExtent > top &&
    py - config.collisionHalfExtent < bottom
  );
}

/**
 * @typedef {object} MovementConfig
 * @property {number} unitsPerTile
 * @property {number} tickRate
 * @property {number} maxSpeedPerTick
 * @property {number} accelerationPerTick
 * @property {number} decelerationPerTick
 * @property {number} collisionHalfExtent
 * @property {number} turnCenterTolerance
 * @property {number} turnGraceTicks
 * @property {boolean} [carryRemainderAcrossCells]
 */

/** @type {Readonly<MovementConfig>} */
export const DEFAULT_MOVEMENT_CONFIG = Object.freeze({
  unitsPerTile: 1024,
  tickRate: 30,
  maxSpeedPerTick: 256,
  accelerationPerTick: 64,
  decelerationPerTick: 96,
  collisionHalfExtent: 320,
  turnCenterTolerance: 320,
  turnGraceTicks: 3,
});

export const BASE_SPEED_TILES_PER_SECOND = 3;
export const SPEED_ITEM_BONUS_TILES_PER_SECOND = 0.5;

export function speedTilesPerSecond(speedLevel = 0) {
  const level = Number.isSafeInteger(speedLevel) && speedLevel > 0 ? speedLevel : 0;
  return BASE_SPEED_TILES_PER_SECOND + level * SPEED_ITEM_BONUS_TILES_PER_SECOND;
}

/** @returns {Readonly<MovementConfig>} */
export function movementConfigForSpeedLevel(speedLevel = 0) {
  const maxSpeedPerTick = Math.round(
    speedTilesPerSecond(speedLevel) *
      DEFAULT_MOVEMENT_CONFIG.unitsPerTile /
      DEFAULT_MOVEMENT_CONFIG.tickRate,
  );
  return Object.freeze({
    ...DEFAULT_MOVEMENT_CONFIG,
    maxSpeedPerTick,
    accelerationPerTick: maxSpeedPerTick,
    decelerationPerTick: maxSpeedPerTick,
    carryRemainderAcrossCells: true,
  });
}

export const BASE_GAMEPLAY_MOVEMENT_CONFIG = movementConfigForSpeedLevel(0);

import { addNetTicks, isNetTickAtOrAfter } from "../../../shared/net-tick.mjs";

const DEFAULT_TICK_RATE = 30;
const DEFAULT_RESPAWN_SECONDS = 12;
const DEFAULT_WARNING_SECONDS = 3;
const DEFAULT_PLAYER_SAFE_RADIUS = 4;

function cellKey(x, y) {
  return `${x},${y}`;
}

function playerBlocksWarning(player, x, y, radius) {
  return (
    player.alive &&
    Math.abs(player.x - x) <= radius &&
    Math.abs(player.y - y) <= radius
  );
}

export function createCrateRespawnSystem({
  world,
  tickRate = DEFAULT_TICK_RATE,
  respawnSeconds = DEFAULT_RESPAWN_SECONDS,
  warningSeconds = DEFAULT_WARNING_SECONDS,
  playerSafeRadius = DEFAULT_PLAYER_SAFE_RADIUS,
} = {}) {
  const warningDelayTicks = Math.round((respawnSeconds - warningSeconds) * tickRate);
  const warningDurationTicks = Math.round(warningSeconds * tickRate);
  if (warningDelayTicks < 0 || warningDurationTicks < 1) {
    throw new RangeError("Crate respawn timing must include a positive warning duration");
  }
  const scheduled = new Map();

  function scheduleDestroyedCrates(tick) {
    for (const crate of world.drainDestroyedCrates()) {
      const key = cellKey(crate.x, crate.y);
      if (scheduled.has(key)) continue;
      scheduled.set(key, {
        ...crate,
        warningTick: addNetTicks(tick, warningDelayTicks),
        respawnTick: null,
      });
    }
  }

  function step(tick) {
    scheduleDestroyedCrates(tick);
    const players = world.readPlayers();
    const warned = [];
    const restored = [];

    for (const [key, crate] of scheduled) {
      if (crate.respawnTick === null) {
        if (!isNetTickAtOrAfter(tick, crate.warningTick)) continue;
        if (players.some((player) => playerBlocksWarning(
          player,
          crate.x,
          crate.y,
          playerSafeRadius,
        ))) continue;
        if (!world.markCrateRespawnWarning(crate.x, crate.y)) {
          if (world.hasCrate(crate.x, crate.y)) scheduled.delete(key);
          continue;
        }
        crate.respawnTick = addNetTicks(tick, warningDurationTicks);
        warned.push({ x: crate.x, y: crate.y, respawnTick: crate.respawnTick });
        continue;
      }
      if (!isNetTickAtOrAfter(tick, crate.respawnTick)) continue;
      if (world.restoreCrate(crate.x, crate.y)) {
        restored.push({ x: crate.x, y: crate.y });
      }
      scheduled.delete(key);
    }

    return {
      changed: warned.length > 0 || restored.length > 0,
      warned,
      restored,
      scheduled: scheduled.size,
    };
  }

  function readMetrics() {
    let warningTiles = 0;
    for (const crate of scheduled.values()) {
      if (crate.respawnTick !== null) warningTiles += 1;
    }
    return { scheduled: scheduled.size, warningTiles };
  }

  return { step, readMetrics };
}

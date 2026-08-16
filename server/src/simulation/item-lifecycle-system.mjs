import { addNetTicks, isNetTickAtOrAfter } from "../../../shared/net-tick.mjs";

const DEFAULT_TICK_RATE = 30;
const DEFAULT_ITEM_LIFETIME_SECONDS = 10;

export function createItemLifecycleSystem({
  world,
  tickRate = DEFAULT_TICK_RATE,
  lifetimeSeconds = DEFAULT_ITEM_LIFETIME_SECONDS,
} = {}) {
  const lifetimeTicks = Math.round(tickRate * lifetimeSeconds);
  if (lifetimeTicks < 1) {
    throw new RangeError("Item lifetime must be at least one simulation tick");
  }

  function step(tick) {
    const stamped = [];
    const expired = [];
    for (const item of world.readItems()) {
      if (!Number.isSafeInteger(item.expireTick)) {
        const expireTick = addNetTicks(tick, lifetimeTicks);
        world.updateItemAt(item.x, item.y, { spawnTick: tick, expireTick });
        stamped.push({ id: item.id ?? `${item.x},${item.y}`, expireTick });
        continue;
      }
      if (!isNetTickAtOrAfter(tick, item.expireTick)) continue;
      if (world.removeItemAt(item.x, item.y)) {
        expired.push({ id: item.id ?? `${item.x},${item.y}`, x: item.x, y: item.y });
      }
    }
    return {
      changed: stamped.length > 0 || expired.length > 0,
      stamped,
      expired,
    };
  }

  return { step };
}

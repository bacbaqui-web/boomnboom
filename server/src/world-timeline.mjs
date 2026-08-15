export function createWorldTimeline({ epochMs, tickMs }) {
  return {
    at(now = Date.now()) {
      const elapsed = Math.max(0, now - epochMs);
      const tick = Math.floor(elapsed / tickMs);
      return { tick, nextTickAt: epochMs + (tick + 1) * tickMs };
    },
  };
}

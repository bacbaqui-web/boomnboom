export function createSimulationScheduler({
  simulation,
  botController,
  timeline,
  aiIntervalMs,
  publish,
}) {
  let nextTickAt = timeline.at().nextTickAt;
  let lastTickDurationMs = 0;
  let lastEventLoopLagMs = 0;
  let lastCompletedTickAt = Date.now();
  let tickTimer = null;
  let aiTimer = null;

  function runTick() {
    const startedAt = Date.now();
    lastEventLoopLagMs = Math.max(0, startedAt - nextTickAt);
    const current = timeline.at();
    const result = simulation.advanceToTick(current.tick);
    nextTickAt = current.nextTickAt;
    if (result.publish) publish({ heartbeat: true });
    lastTickDurationMs = Date.now() - startedAt;
    lastCompletedTickAt = Date.now();
  }

  function scheduleTick() {
    tickTimer = setTimeout(() => {
      runTick();
      scheduleTick();
    }, Math.max(1, nextTickAt - Date.now()));
    tickTimer.unref();
  }

  return {
    start() {
      if (tickTimer || aiTimer) return;
      scheduleTick();
      aiTimer = setInterval(() => {
        let changed = false;
        for (const intent of botController.decideAll()) {
          const result = simulation.applyAction(intent.botId, intent.action);
          changed = result.changed || changed;
        }
        if (changed) publish();
      }, aiIntervalMs);
      aiTimer.unref();
    },
    stop() {
      if (tickTimer) clearTimeout(tickTimer);
      if (aiTimer) clearInterval(aiTimer);
      tickTimer = null;
      aiTimer = null;
    },
    readClock() {
      return { tick: simulation.tick, nextTickAt };
    },
    readMetrics() {
      return {
        lastTickDurationMs,
        lastEventLoopLagMs,
        lastCompletedTickAt,
        nextTickAt,
      };
    },
  };
}

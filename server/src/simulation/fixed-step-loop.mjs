import { addNetTicks, normalizeNetTick } from "../../../shared/net-tick.mjs";

export function createFixedStepLoop({
  onStep,
  tickRate = 30,
  initialTick = 0,
  maxCatchUpSteps = 5,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof onStep !== "function") throw new TypeError("onStep must be a function");
  if (!Number.isInteger(tickRate) || tickRate <= 0) {
    throw new TypeError("tickRate must be a positive integer");
  }
  if (!Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps <= 0) {
    throw new TypeError("maxCatchUpSteps must be a positive integer");
  }

  const stepMs = 1000 / tickRate;
  let tick = normalizeNetTick(initialTick);
  let nextStepAt = now() + stepMs;
  let timer = null;
  let running = false;
  let totalSteps = 0;
  let catchUpBacklog = 0;
  let lastStepDurationMs = 0;

  function runDueSteps(currentTime = now()) {
    let executed = 0;
    const startedAt = now();
    while (currentTime >= nextStepAt && executed < maxCatchUpSteps) {
      tick = addNetTicks(tick, 1);
      onStep(tick);
      nextStepAt += stepMs;
      executed += 1;
      totalSteps += 1;
    }
    catchUpBacklog = currentTime >= nextStepAt
      ? Math.floor((currentTime - nextStepAt) / stepMs) + 1
      : 0;
    lastStepDurationMs = Math.max(0, now() - startedAt);
    return { executed, catchUpBacklog, tick };
  }

  function schedule() {
    if (!running) return;
    const delay = catchUpBacklog > 0 ? 0 : Math.max(1, nextStepAt - now());
    timer = setTimer(() => {
      timer = null;
      runDueSteps();
      schedule();
    }, delay);
    timer?.unref?.();
  }

  return {
    start() {
      if (running) return;
      running = true;
      catchUpBacklog = 0;
      nextStepAt = now() + stepMs;
      schedule();
    },
    stop() {
      running = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    runDueSteps,
    readClock() {
      return { tick, tickRate, stepMs, nextStepAt };
    },
    readMetrics() {
      return {
        tick,
        tickRate,
        totalSteps,
        catchUpBacklog,
        lastStepDurationMs,
        maxCatchUpSteps,
      };
    },
  };
}

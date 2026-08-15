import type { MoveAction } from "./protocol.ts";
import type { V3Direction } from "./protocol-v3.ts";

type TimerId = ReturnType<typeof setInterval>;
type SamplerTimers = {
  setInterval: (callback: () => void, delay: number) => TimerId;
  clearInterval: (timer: TimerId) => void;
};

const browserTimers: SamplerTimers = {
  setInterval: (callback, delay) => setInterval(callback, delay),
  clearInterval: (timer) => clearInterval(timer),
};

export class InputSampler {
  #sendDirection: (direction: V3Direction) => void;
  #sendBomb: () => void;
  #direction: V3Direction = "neutral";
  #timers: SamplerTimers;
  #heartbeatMs: number;
  #timer: TimerId | null = null;

  constructor(
    sendDirection: (direction: V3Direction) => void,
    sendBomb: () => void,
    {
      timers = browserTimers,
      heartbeatMs = 250,
    }: { timers?: SamplerTimers; heartbeatMs?: number } = {},
  ) {
    this.#sendDirection = sendDirection;
    this.#sendBomb = sendBomb;
    this.#timers = timers;
    this.#heartbeatMs = heartbeatMs;
  }

  start(direction: MoveAction) {
    if (direction === this.#direction && this.#timer) return;
    this.#clearTimer();
    this.#direction = direction;
    this.#sendDirection(direction);
    this.#timer = this.#timers.setInterval(() => {
      if (this.#direction !== "neutral") this.#sendDirection(this.#direction);
    }, this.#heartbeatMs);
  }

  stop() {
    if (this.#direction === "neutral" && !this.#timer) return;
    this.#clearTimer();
    this.#direction = "neutral";
    this.#sendDirection("neutral");
  }

  bomb() {
    this.#sendBomb();
  }

  destroy() {
    this.stop();
  }

  #clearTimer() {
    if (this.#timer) this.#timers.clearInterval(this.#timer);
    this.#timer = null;
  }
}

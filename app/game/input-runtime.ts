import type { Action, MoveAction } from "./protocol.ts";

type TimerId = ReturnType<typeof setInterval>;
type InputTimers = {
  setInterval: (callback: () => void, delay: number) => TimerId;
  clearInterval: (timer: TimerId) => void;
};

const browserTimers: InputTimers = {
  setInterval: (callback, delay) => setInterval(callback, delay),
  clearInterval: (timer) => clearInterval(timer),
};

export class InputRuntime {
  #send: (action: Action) => void;
  #timers: InputTimers;
  #cadenceMs: number;
  #timer: TimerId | null = null;
  #direction: MoveAction | null = null;

  constructor(
    send: (action: Action) => void,
    { timers = browserTimers, cadenceMs = 145 }: { timers?: InputTimers; cadenceMs?: number } = {},
  ) {
    this.#send = send;
    this.#timers = timers;
    this.#cadenceMs = cadenceMs;
  }

  start(direction: MoveAction) {
    if (this.#direction === direction && this.#timer) return;
    this.#clear();
    this.#direction = direction;
    this.#send(direction);
    this.#timer = this.#timers.setInterval(() => this.#send(direction), this.#cadenceMs);
  }

  stop() {
    if (!this.#direction) return;
    this.#clear();
    this.#send("stop");
  }

  bomb() {
    this.#send("bomb");
  }

  destroy() {
    this.#clear();
  }

  #clear() {
    if (this.#timer) this.#timers.clearInterval(this.#timer);
    this.#timer = null;
    this.#direction = null;
  }
}

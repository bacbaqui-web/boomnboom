export type Position = { x: number; y: number };

export class PositionInterpolator {
  #ready = false;
  #start: Position = { x: 0, y: 0 };
  #target: Position = { x: 0, y: 0 };
  #visual: Position = { x: 0, y: 0 };
  #startAt = 0;
  #durationMs: number;

  constructor(durationMs = 175) {
    this.#durationMs = durationMs;
  }

  get target() {
    return { ...this.#target };
  }

  setTarget(x: number, y: number, now: number, { teleport = false } = {}) {
    const current = this.sample(now);
    if (!this.#ready || teleport) {
      this.#ready = true;
      this.#start = { x, y };
      this.#target = { x, y };
      this.#visual = { x, y };
      this.#startAt = now;
      return;
    }
    if (x === this.#target.x && y === this.#target.y) return;
    this.#start = current;
    this.#target = { x, y };
    this.#startAt = now;
  }

  sample(now: number): Position {
    if (!this.#ready) return { ...this.#visual };
    const progress = Math.min(1, Math.max(0, (now - this.#startAt) / this.#durationMs));
    this.#visual = {
      x: this.#start.x + (this.#target.x - this.#start.x) * progress,
      y: this.#start.y + (this.#target.y - this.#start.y) * progress,
    };
    return { ...this.#visual };
  }
}

import type { Position } from "./position-interpolator.ts";

export class CorrectionSmoother {
  #offset: Position = { x: 0, y: 0 };
  #startedAt = 0;
  #durationMs = 0;

  reconcile(
    previousRender: Position,
    nextSimulation: Position,
    now: number,
    { forceSnap = false, collisionCrossing = false } = {},
  ) {
    const offset = {
      x: previousRender.x - nextSimulation.x,
      y: previousRender.y - nextSimulation.y,
    };
    const distance = Math.hypot(offset.x, offset.y);
    const snap = forceSnap || collisionCrossing || distance > 0.5;
    this.#offset = snap ? { x: 0, y: 0 } : offset;
    this.#startedAt = now;
    this.#durationMs = distance <= 0.1 ? 80 : 150;
    return { distance, snap };
  }

  sample(simulation: Position, now: number): Position {
    if (this.#durationMs <= 0) return { ...simulation };
    const progress = Math.min(1, Math.max(0, (now - this.#startedAt) / this.#durationMs));
    const remaining = 1 - progress;
    if (progress >= 1) {
      this.#offset = { x: 0, y: 0 };
      this.#durationMs = 0;
    }
    return {
      x: simulation.x + this.#offset.x * remaining,
      y: simulation.y + this.#offset.y * remaining,
    };
  }

  reset() {
    this.#offset = { x: 0, y: 0 };
    this.#durationMs = 0;
  }
}

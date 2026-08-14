import type { MoveAction } from "./protocol.ts";
import type { Position } from "./camera-runtime.ts";

const movement: Record<MoveAction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

type PendingMove = { seq: number; action: MoveAction };

export class MovementPrediction {
  #authoritative: Position | null = null;
  #pending: PendingMove[] = [];

  reset(position: Position) {
    this.#authoritative = { ...position };
    this.#pending = [];
    return this.target;
  }

  enqueue(seq: number, action: MoveAction) {
    if (!Number.isInteger(seq) || seq < 0) return this.target;
    this.#pending.push({ seq, action });
    return this.target;
  }

  reconcile(ackClientSeq: number, position: Position) {
    this.#authoritative = { ...position };
    this.#pending = this.#pending.filter((move) => move.seq > ackClientSeq);
    return this.target;
  }

  get target(): Position | null {
    if (!this.#authoritative) return null;
    const next = this.#pending[0];
    if (!next) return { ...this.#authoritative };
    const offset = movement[next.action];
    return {
      x: this.#authoritative.x + offset.x,
      y: this.#authoritative.y + offset.y,
    };
  }
}

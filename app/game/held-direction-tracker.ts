import type { MoveAction } from "./protocol.ts";

export class HeldDirectionTracker {
  #keys = new Map<string, MoveAction>();
  #pointer: MoveAction | null = null;

  pressKey(keyId: string, direction: MoveAction) {
    if (!this.#keys.has(keyId)) this.#keys.set(keyId, direction);
    return this.activeDirection;
  }

  releaseKey(keyId: string) {
    this.#keys.delete(keyId);
    return this.activeDirection;
  }

  pressPointer(direction: MoveAction) {
    this.#pointer = direction;
    return this.activeDirection;
  }

  releasePointer() {
    this.#pointer = null;
    return this.activeDirection;
  }

  reset() {
    this.#keys.clear();
    this.#pointer = null;
  }

  get activeDirection() {
    if (this.#pointer) return this.#pointer;
    return [...this.#keys.values()].at(-1) ?? null;
  }
}

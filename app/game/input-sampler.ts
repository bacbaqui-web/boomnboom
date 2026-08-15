import type { MoveAction } from "./protocol.ts";
import type { V3Direction } from "./protocol-v3.ts";

export class InputSampler {
  #sendDirection: (direction: V3Direction) => void;
  #sendBomb: () => void;
  #direction: V3Direction = "neutral";

  constructor(sendDirection: (direction: V3Direction) => void, sendBomb: () => void) {
    this.#sendDirection = sendDirection;
    this.#sendBomb = sendBomb;
  }

  start(direction: MoveAction) {
    if (direction === this.#direction) return;
    this.#direction = direction;
    this.#sendDirection(direction);
  }

  stop() {
    if (this.#direction === "neutral") return;
    this.#direction = "neutral";
    this.#sendDirection("neutral");
  }

  bomb() {
    this.#sendBomb();
  }

  destroy() {
    this.stop();
  }
}

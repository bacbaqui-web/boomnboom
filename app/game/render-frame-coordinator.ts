import type { Position } from "./position-interpolator.ts";

export type RenderFrame = {
  now: number;
  center: Position;
  visibleWidth: number;
  visibleHeight: number;
};

export type RenderFrameListener = (frame: RenderFrame) => void;

export class RenderFrameCoordinator {
  #listeners = new Set<RenderFrameListener>();

  subscribe(listener: RenderFrameListener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  paint(frame: RenderFrame) {
    for (const listener of this.#listeners) listener(frame);
  }

  clear() {
    this.#listeners.clear();
  }
}

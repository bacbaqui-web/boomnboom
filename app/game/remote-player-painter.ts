import { clearPlayerTravelPose, paintPlayerTravelPose } from "./player-animation.ts";
import { PositionInterpolator, type Position } from "./position-interpolator.ts";
import type { RemotePositionSource } from "./remote-snapshot-buffer.ts";
import type { RenderFrame } from "./render-frame-coordinator.ts";
import { isWithinRenderBounds } from "./render-visibility.ts";

type PlayerNodes = {
  element: HTMLElement;
  avatar: HTMLElement;
};

type PlayerPaintRuntime = PlayerNodes & {
  motion: PositionInterpolator;
  previousTarget: Position;
  previousVisual: Position | null;
  lastPainted: Position | null;
  travelPoseActive: boolean;
};

const MIN_PIXEL_DELTA = 0.02;

export class RemotePlayerPainter {
  #players = new Map<string, PlayerPaintRuntime>();

  register(playerId: string, position: Position, nodes: PlayerNodes, now: number) {
    const motion = new PositionInterpolator(135);
    motion.setTarget(position.x, position.y, now, { teleport: true });
    this.#players.set(playerId, {
      ...nodes,
      motion,
      previousTarget: { ...position },
      previousVisual: null,
      lastPainted: null,
      travelPoseActive: false,
    });
  }

  updateTarget(playerId: string, position: Position, now: number) {
    const runtime = this.#players.get(playerId);
    if (!runtime) return;
    const distance = Math.hypot(
      position.x - runtime.previousTarget.x,
      position.y - runtime.previousTarget.y,
    );
    runtime.motion.setTarget(position.x, position.y, now, { teleport: distance > 2 });
    if (distance > 2) runtime.previousVisual = null;
    runtime.previousTarget = { ...position };
  }

  unregister(playerId: string) {
    const runtime = this.#players.get(playerId);
    if (!runtime) return;
    clearPlayerTravelPose(runtime.avatar);
    this.#players.delete(playerId);
  }

  paint(
    frame: RenderFrame,
    source: RemotePositionSource | null,
    tileSize: number,
  ) {
    for (const [playerId, runtime] of this.#players) {
      const visual = source?.sample(playerId, frame.now) ?? runtime.motion.sample(frame.now);
      const visible = isWithinRenderBounds(
        visual,
        frame.center,
        frame.visibleWidth,
        frame.visibleHeight,
      );
      if (!visible) {
        runtime.element.hidden = true;
        runtime.previousVisual = visual;
        continue;
      }
      runtime.element.hidden = false;
      const x = Math.round((visual.x + 0.14) * tileSize * 1000) / 1000;
      const y = Math.round((visual.y + 0.14) * tileSize * 1000) / 1000;
      const previous = runtime.lastPainted;
      if (
        !previous ||
        Math.abs(x - previous.x) >= MIN_PIXEL_DELTA ||
        Math.abs(y - previous.y) >= MIN_PIXEL_DELTA
      ) {
        runtime.element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        runtime.lastPainted = { x, y };
      }
      const moving = paintPlayerTravelPose(
        runtime.avatar,
        runtime.previousVisual,
        visual,
      );
      if (!moving && runtime.travelPoseActive) clearPlayerTravelPose(runtime.avatar);
      runtime.travelPoseActive = moving;
      runtime.previousVisual = visual;
    }
  }

  clear() {
    for (const playerId of [...this.#players.keys()]) this.unregister(playerId);
  }

  get size() {
    return this.#players.size;
  }
}

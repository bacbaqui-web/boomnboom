import { PositionInterpolator } from "./position-interpolator.ts";

export class CameraRuntime extends PositionInterpolator {
  static transformFor(
    visual: { x: number; y: number },
    boardWidth: number,
    boardHeight: number,
    tileSize: number,
  ) {
    const x = boardWidth / 2 - (visual.x + 0.5) * tileSize;
    const y = boardHeight / 2 - (visual.y + 0.5) * tileSize;
    return `translate3d(${x}px, ${y}px, 0)`;
  }

  transformAt(now: number, boardWidth: number, boardHeight: number, tileSize: number) {
    return CameraRuntime.transformFor(this.sample(now), boardWidth, boardHeight, tileSize);
  }
}

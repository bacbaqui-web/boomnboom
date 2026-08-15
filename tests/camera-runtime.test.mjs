import assert from "node:assert/strict";
import test from "node:test";
import { CameraRuntime } from "../app/game/camera-runtime.ts";

test("camera runtime converts a visual world position into a centered transform", () => {
  const camera = new CameraRuntime(100);
  camera.setTarget(4, 3, 0, { teleport: true });
  assert.equal(camera.transformAt(0, 150, 110, 10), "translate3d(30px, 20px, 0)");
});

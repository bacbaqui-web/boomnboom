import assert from "node:assert/strict";
import test from "node:test";
import { PositionInterpolator } from "../app/game/position-interpolator.ts";

test("position interpolation is monotonic and exactly reaches the approved tile", () => {
  const camera = new PositionInterpolator(100);
  camera.setTarget(0, 0, 0, { teleport: true });
  camera.setTarget(1, 0, 0);
  const samples = [0, 20, 40, 60, 80, 100].map((now) => camera.sample(now).x);
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index] >= samples[index - 1]);
  }
  assert.equal(samples.at(-1), 1);
  assert.equal(samples[1], 0.2);
  assert.deepEqual(camera.sample(200), { x: 1, y: 0 });
});

test("a new target continues from the current visual position and teleport snaps", () => {
  const camera = new PositionInterpolator(100);
  camera.setTarget(0, 0, 0, { teleport: true });
  camera.setTarget(1, 0, 0);
  const midway = camera.sample(50).x;
  camera.setTarget(2, 0, 50);
  assert.equal(camera.sample(50).x, midway);
  assert.ok(camera.sample(75).x > midway);
  assert.equal(camera.sample(150).x, 2);
  camera.setTarget(20, -5, 160, { teleport: true });
  assert.deepEqual(camera.sample(160), { x: 20, y: -5 });
});

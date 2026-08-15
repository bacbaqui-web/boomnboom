import assert from "node:assert/strict";
import test from "node:test";
import { CorrectionSmoother } from "../app/game/correction-smoother.ts";

test("correction changes only render offset and never delays simulation state", () => {
  const smoother = new CorrectionSmoother();
  const simulation = Object.freeze({ x: 1, y: 0 });
  const result = smoother.reconcile({ x: 0.9, y: 0 }, simulation, 0);
  assert.equal(result.snap, false);
  assert.deepEqual(simulation, { x: 1, y: 0 });
  assert.deepEqual(smoother.sample(simulation, 0), { x: 0.9, y: 0 });
  assert.deepEqual(smoother.sample(simulation, 80), simulation);
});

test("large, lifecycle, and collision corrections snap immediately", () => {
  const smoother = new CorrectionSmoother();
  assert.equal(smoother.reconcile({ x: 0, y: 0 }, { x: 0.51, y: 0 }, 0).snap, true);
  assert.deepEqual(smoother.sample({ x: 0.51, y: 0 }, 0), { x: 0.51, y: 0 });
  assert.equal(smoother.reconcile(
    { x: 0, y: 0 },
    { x: 0.1, y: 0 },
    0,
    { collisionCrossing: true },
  ).snap, true);
});

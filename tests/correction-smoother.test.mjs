import assert from "node:assert/strict";
import test from "node:test";
import { CorrectionSmoother } from "../app/game/correction-smoother.ts";

test("a small authority correction changes only the temporary render offset", () => {
  const smoother = new CorrectionSmoother();
  const simulation = Object.freeze({ x: 1, y: 0 });
  const result = smoother.reconcile({ x: 0.9, y: 0 }, simulation, 0);
  assert.equal(result.snap, false);
  assert.deepEqual(simulation, { x: 1, y: 0 });
  assert.deepEqual(smoother.sample(simulation, 0), { x: 0.9, y: 0 });
  assert.deepEqual(smoother.sample(simulation, 200), simulation);
});

test("a large or lifecycle correction snaps the render position", () => {
  const smoother = new CorrectionSmoother();
  assert.equal(smoother.reconcile({ x: 0, y: 0 }, { x: 0.76, y: 0 }, 0).snap, true);
  assert.deepEqual(smoother.sample({ x: 0.76, y: 0 }, 0), { x: 0.76, y: 0 });
  assert.equal(smoother.reconcile(
    { x: 0, y: 0 },
    { x: 0.1, y: 0 },
    0,
    { forceSnap: true },
  ).snap, true);
});

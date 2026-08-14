import assert from "node:assert/strict";
import test from "node:test";
import { MovementPrediction } from "../app/game/movement-prediction.ts";

test("first pending input immediately targets the adjacent grid cell", () => {
  const prediction = new MovementPrediction();
  prediction.reset({ x: 4, y: -2 });
  assert.deepEqual(prediction.enqueue(1, "right"), { x: 5, y: -2 });
});

test("acknowledged movement keeps the same visual target without a backward snap", () => {
  const prediction = new MovementPrediction();
  prediction.reset({ x: 0, y: 0 });
  prediction.enqueue(1, "right");
  assert.deepEqual(prediction.reconcile(1, { x: 1, y: 0 }), { x: 1, y: 0 });
});

test("continuous input stays one cell ahead and settles on the final acknowledged cell", () => {
  const prediction = new MovementPrediction();
  prediction.reset({ x: 0, y: 0 });
  prediction.enqueue(1, "right");
  prediction.enqueue(2, "right");
  assert.deepEqual(prediction.target, { x: 1, y: 0 });
  assert.deepEqual(prediction.reconcile(1, { x: 1, y: 0 }), { x: 2, y: 0 });
  assert.deepEqual(prediction.reconcile(2, { x: 2, y: 0 }), { x: 2, y: 0 });
});

test("a rejected move returns to the authoritative cell", () => {
  const prediction = new MovementPrediction();
  prediction.reset({ x: 3, y: 3 });
  prediction.enqueue(7, "up");
  assert.deepEqual(prediction.reconcile(7, { x: 3, y: 3 }), { x: 3, y: 3 });
});

test("reset clears pending input at a reconnect or life boundary", () => {
  const prediction = new MovementPrediction();
  prediction.reset({ x: 0, y: 0 });
  prediction.enqueue(4, "right");
  assert.deepEqual(prediction.reset({ x: 20, y: -8 }), { x: 20, y: -8 });
  assert.deepEqual(prediction.authoritative, { x: 20, y: -8 });
});

import assert from "node:assert/strict";
import test from "node:test";
import { findBotPath } from "../src/ai/bot-pathfinder.mjs";

test("bounded pathfinder routes around a blocked or dangerous direct cell", () => {
  const path = findBotPath({
    start: { x: 0, y: 0 },
    isGoal: (x, y) => x === 2 && y === 0,
    canEnter: (x, y) => !(x === 1 && y === 0),
    maxSteps: 5,
    maxVisited: 64,
  });

  assert.deepEqual(path.directions, ["up", "right", "right", "down"]);
  assert.ok(path.visited <= 64);
});

test("bounded pathfinder returns null when its search budget cannot reach the goal", () => {
  const path = findBotPath({
    start: { x: 0, y: 0 },
    isGoal: (x, y) => x === 20 && y === 0,
    canEnter: () => true,
    maxSteps: 4,
    maxVisited: 32,
  });
  assert.equal(path, null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createFixedStepLoop } from "../src/simulation/fixed-step-loop.mjs";

test("fixed loop bounds catch-up without dropping overdue ticks", () => {
  let now = 0;
  const ticks = [];
  const loop = createFixedStepLoop({
    onStep: (tick) => ticks.push(tick),
    maxCatchUpSteps: 5,
    now: () => now,
  });
  now = 1000;
  const first = loop.runDueSteps(now);
  assert.equal(first.executed, 5);
  assert.equal(first.catchUpBacklog, 25);
  assert.deepEqual(ticks, [1, 2, 3, 4, 5]);
  const second = loop.runDueSteps(now);
  assert.equal(second.executed, 5);
  assert.equal(second.catchUpBacklog, 20);
  assert.deepEqual(ticks.slice(-2), [9, 10]);
});

test("fixed loop increments uint32 ticks safely across wrap", () => {
  let now = 0;
  const ticks = [];
  const loop = createFixedStepLoop({
    onStep: (tick) => ticks.push(tick),
    initialTick: 0xffff_fffe,
    now: () => now,
  });
  now = 67;
  assert.equal(loop.runDueSteps(now).executed, 2);
  assert.deepEqual(ticks, [0xffff_ffff, 0]);
});

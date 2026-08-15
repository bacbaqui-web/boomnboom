import assert from "node:assert/strict";
import test from "node:test";
import { InputSampler } from "../app/game/input-sampler.ts";

test("V3 input sampler emits key state changes immediately without a repeat timer", () => {
  const directions = [];
  let bombs = 0;
  const sampler = new InputSampler(
    (direction) => directions.push(direction),
    () => { bombs += 1; },
  );
  sampler.start("right");
  sampler.start("right");
  sampler.stop();
  sampler.bomb();
  assert.deepEqual(directions, ["right", "neutral"]);
  assert.equal(bombs, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { InputSampler } from "../app/game/input-sampler.ts";

function fakeTimers() {
  const callbacks = new Map();
  let nextId = 1;
  return {
    timers: {
      setInterval(callback) {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      clearInterval(id) {
        callbacks.delete(id);
      },
    },
    tick() {
      for (const callback of [...callbacks.values()]) callback();
    },
    count() {
      return callbacks.size;
    },
  };
}

test("V3 input sampler emits immediately and keeps a held direction alive", () => {
  const clock = fakeTimers();
  const directions = [];
  let bombs = 0;
  const sampler = new InputSampler(
    (direction) => directions.push(direction),
    () => { bombs += 1; },
    { timers: clock.timers },
  );
  sampler.start("right");
  sampler.start("right");
  clock.tick();
  sampler.stop();
  clock.tick();
  sampler.bomb();
  assert.deepEqual(directions, ["right", "right", "neutral"]);
  assert.equal(clock.count(), 0);
  assert.equal(bombs, 1);
});

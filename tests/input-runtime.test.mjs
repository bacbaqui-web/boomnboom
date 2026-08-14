import assert from "node:assert/strict";
import test from "node:test";
import { InputRuntime } from "../app/game/input-runtime.ts";

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

test("movement sends immediately, repeats, and stop clears the hold timer", () => {
  const clock = fakeTimers();
  const actions = [];
  const input = new InputRuntime((action) => actions.push(action), { timers: clock.timers });
  input.start("right");
  clock.tick();
  input.stop();
  clock.tick();
  assert.deepEqual(actions, ["right", "right", "stop"]);
  assert.equal(clock.count(), 0);
});

test("bomb is immediate and destroy cleans up without another movement", () => {
  const clock = fakeTimers();
  const actions = [];
  const input = new InputRuntime((action) => actions.push(action), { timers: clock.timers });
  input.start("up");
  input.bomb();
  input.destroy();
  clock.tick();
  assert.deepEqual(actions, ["up", "bomb"]);
  assert.equal(clock.count(), 0);
});

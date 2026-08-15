import assert from "node:assert/strict";
import test from "node:test";
import { HeldDirectionTracker } from "../app/game/held-direction-tracker.ts";

test("releasing a newer direction resumes the key that is still held", () => {
  const held = new HeldDirectionTracker();
  assert.equal(held.pressKey("ArrowRight", "right"), "right");
  assert.equal(held.pressKey("ArrowUp", "up"), "up");
  assert.equal(held.releaseKey("ArrowUp"), "right");
  assert.equal(held.releaseKey("ArrowRight"), null);
});

test("pointer movement temporarily overrides and then resumes keyboard movement", () => {
  const held = new HeldDirectionTracker();
  held.pressKey("ArrowRight", "right");
  assert.equal(held.pressPointer("down"), "down");
  assert.equal(held.releasePointer(), "right");
  held.reset();
  assert.equal(held.activeDirection, null);
});

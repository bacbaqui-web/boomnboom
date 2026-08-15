import assert from "node:assert/strict";
import test from "node:test";
import { createPlayerCommandBuffer } from "../src/simulation/player-command-buffer.mjs";

function input(commandSeq, targetTick, direction = "right") {
  return { type: "input_state", commandSeq, targetTick, direction };
}

function action(commandSeq, targetTick, value = "bomb") {
  return { type: "action_command", commandSeq, targetTick, action: value };
}

test("command buffer holds missing input and applies a future command on its target tick", () => {
  const buffer = createPlayerCommandBuffer();
  buffer.registerPlayer("P1");
  assert.deepEqual(buffer.enqueue("P1", input(1, 12), 10), {
    accepted: true,
    status: "queued",
    targetTick: 12,
  });
  assert.deepEqual(buffer.consumeTick(11).get("P1"), {
    direction: "neutral",
    lastProcessedCommandSeq: null,
    actions: [],
  });
  assert.deepEqual(buffer.consumeTick(12).get("P1"), {
    direction: "right",
    lastProcessedCommandSeq: 1,
    actions: [],
  });
  assert.equal(buffer.consumeTick(13).get("P1").direction, "right");
});

test("movement and actions share one sequence and target-tick domain", () => {
  const buffer = createPlayerCommandBuffer();
  buffer.registerPlayer("P1");
  assert.equal(buffer.enqueue("P1", input(1, 2), 0).accepted, true);
  assert.equal(buffer.enqueue("P1", action(2, 2), 0).accepted, true);
  const consumed = buffer.consumeTick(2).get("P1");
  assert.equal(consumed.direction, "right");
  assert.deepEqual(consumed.actions, [
    { commandSeq: 2, targetTick: 2, action: "bomb" },
  ]);
  assert.equal(consumed.lastProcessedCommandSeq, 2);
  assert.equal(buffer.enqueue("P1", action(2, 3), 2).reason, "duplicate");
});

test("late clamp, expired rejection, future rejection, duplicate, and stale are distinct", () => {
  const buffer = createPlayerCommandBuffer({ maxPastTicks: 6, maxFutureTicks: 15 });
  buffer.registerPlayer("P1");
  assert.deepEqual(buffer.enqueue("P1", input(1, 97), 100), {
    accepted: true,
    status: "late_clamped",
    targetTick: 101,
  });
  assert.equal(buffer.enqueue("P1", input(1, 101), 100).reason, "duplicate");
  assert.equal(buffer.enqueue("P1", input(0, 101), 100).reason, "stale_sequence");
  assert.equal(buffer.enqueue("P1", input(2, 90), 100).reason, "late_tick");
  assert.equal(buffer.enqueue("P1", input(2, 116), 100).reason, "future_tick");
  assert.equal(buffer.consumeTick(101).get("P1").lastProcessedCommandSeq, 1);
});

test("queue length stays bounded and sequence/target ordering crosses uint32 wrap", () => {
  const bounded = createPlayerCommandBuffer({ maxQueueLength: 1 });
  bounded.registerPlayer("P1");
  assert.equal(bounded.enqueue("P1", input(1, 2), 0).accepted, true);
  assert.equal(bounded.enqueue("P1", input(2, 3), 0).reason, "queue_full");

  const wrapped = createPlayerCommandBuffer();
  wrapped.registerPlayer("P2");
  assert.equal(wrapped.enqueue("P2", input(0xffff_ffff, 0xffff_ffff), 0xffff_fffe).accepted, true);
  assert.equal(wrapped.enqueue("P2", input(0, 0), 0xffff_fffe).accepted, true);
  assert.equal(wrapped.consumeTick(0xffff_ffff).get("P2").lastProcessedCommandSeq, 0xffff_ffff);
  assert.equal(wrapped.consumeTick(0).get("P2").lastProcessedCommandSeq, 0);
});

test("life reset clears pre-life movement and action queues without rewinding sequence", () => {
  const buffer = createPlayerCommandBuffer();
  buffer.registerPlayer("P1");
  buffer.enqueue("P1", action(1, 1, "respawn"), 0);
  buffer.enqueue("P1", input(2, 3, "right"), 0);
  assert.equal(buffer.consumeTick(1).get("P1").actions[0].action, "respawn");
  buffer.resetPlayerIntent("P1");
  const after = buffer.consumeTick(3).get("P1");
  assert.equal(after.direction, "neutral");
  assert.deepEqual(after.actions, []);
  assert.equal(buffer.enqueue("P1", action(3, 4), 3).accepted, true);
});

test("respawn session reset accepts a fresh command sequence from zero", () => {
  const buffer = createPlayerCommandBuffer();
  buffer.registerPlayer("P1");
  assert.equal(buffer.enqueue("P1", action(7, 1, "respawn"), 0).accepted, true);
  assert.equal(buffer.consumeTick(1).get("P1").lastProcessedCommandSeq, 7);

  assert.equal(buffer.resetPlayerSession("P1"), true);
  assert.equal(buffer.enqueue("P1", input(0, 2, "right"), 1).accepted, true);
  assert.deepEqual(buffer.consumeTick(2).get("P1"), {
    direction: "right",
    lastProcessedCommandSeq: 0,
    actions: [],
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { CommandTimeline } from "../app/game/command-timeline.ts";

test("only successfully committed commands enter the bounded pending timeline", () => {
  const timeline = new CommandTimeline({ maxPending: 2 });
  const failedSend = timeline.prepareDirection("right", 5);
  assert.equal(timeline.size, 0);
  assert.equal(failedSend.commandSeq, 0);

  assert.equal(timeline.commit(failedSend), true);
  const second = timeline.prepareDirection("neutral", 7);
  assert.equal(timeline.commit(second), true);
  assert.equal(timeline.prepareDirection("left", 8), null);
  assert.equal(timeline.acknowledge(0), 1);
  assert.equal(timeline.pending[0].direction, "neutral");
  assert.equal(timeline.reject(1), true);
  assert.equal(timeline.size, 0);
  timeline.reset();
  assert.equal(timeline.prepareDirection("up", 1).commandSeq, 0);
});

test("movement and bomb commands share one client sequence timeline", () => {
  const timeline = new CommandTimeline();
  const move = timeline.prepareDirection("right", 5);
  timeline.commit(move);
  const bomb = timeline.prepareAction("bomb", 6);
  timeline.commit(bomb);
  assert.deepEqual(
    timeline.pending.map((command) => [command.commandSeq, command.type]),
    [[0, "input_state"], [1, "action_command"]],
  );
  timeline.acknowledge(1);
  assert.equal(timeline.size, 0);
});

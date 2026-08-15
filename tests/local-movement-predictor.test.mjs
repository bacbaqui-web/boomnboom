import assert from "node:assert/strict";
import test from "node:test";
import { CommandTimeline } from "../app/game/command-timeline.ts";
import { LocalMovementPredictor } from "../app/game/local-movement-predictor.ts";

const openWorld = { isBlockedCell: () => false };

function owner({ tick = 0, seq = 0, px = 512, vx = 0, lifeId = 1, ack = null } = {}) {
  return {
    protocol: 3,
    type: "owner_snapshot",
    serverTick: tick,
    serverTimeMs: tick * (1000 / 30),
    snapshotSeq: seq,
    lastProcessedCommandSeq: ack,
    player: {
      id: "P1", px, py: 512, vx, vy: 0, direction: vx ? "right" : "neutral",
      x: Math.floor(px / 1024), y: 0, alive: true, joined: true, isAI: false,
      nickname: "P1", power: 1, range: 2, shield: 0, lifeId, teleport: false,
    },
  };
}

test("keydown predicts exactly one shared step in-frame and scheduler cannot duplicate its tick", () => {
  const predictor = new LocalMovementPredictor();
  const timeline = new CommandTimeline();
  predictor.reset(owner());
  const command = timeline.prepareDirection("right", 1);
  timeline.commit(command);
  assert.equal(predictor.advanceTo(1, timeline.pending, openWorld).position.x, 0.0625);
  assert.equal(predictor.advanceTo(1, timeline.pending, openWorld).position.x, 0.0625);
  assert.equal(predictor.advanceTo(2, timeline.pending, openWorld).position.x, 0.1875);
});

test("owner reconciliation drops ACKed input, replays all pending ticks, and rejects reorder", () => {
  const predictor = new LocalMovementPredictor();
  const timeline = new CommandTimeline();
  predictor.reset(owner({ seq: 1 }));
  const right = timeline.prepareDirection("right", 1);
  timeline.commit(right);
  const neutral = timeline.prepareDirection("neutral", 4);
  timeline.commit(neutral);
  predictor.advanceTo(6, timeline.pending, openWorld);
  timeline.acknowledge(0);
  const result = predictor.reconcile(
    owner({ tick: 2, seq: 2, px: 576, vx: 64, ack: 0 }),
    timeline.pending,
    openWorld,
  );
  assert.equal(result.applied, true);
  assert.equal(result.replayTicks, 4);
  assert.equal(predictor.reconcile(owner({ tick: 1, seq: 1 }), timeline.pending, openWorld).reason, "stale");
});

test("reconnect and lifecycle reset clear prediction history", () => {
  const predictor = new LocalMovementPredictor();
  predictor.reset(owner({ lifeId: 1 }));
  predictor.clear();
  assert.equal(predictor.position, null);
  predictor.reset(owner({ lifeId: 2, px: -512 }));
  assert.deepEqual(predictor.position, { x: -1, y: 0 });
});

test("prediction uses the shared collision reader and never crosses a blocked cell", () => {
  const predictor = new LocalMovementPredictor();
  const timeline = new CommandTimeline();
  predictor.reset(owner());
  const command = timeline.prepareDirection("right", 1);
  timeline.commit(command);
  const result = predictor.advanceTo(12, timeline.pending, {
    isBlockedCell: (x, y) => x === 1 && y === 0,
  });
  assert.equal(result.collisionCrossing, true);
  assert.ok(result.position.x < 0.5);
});

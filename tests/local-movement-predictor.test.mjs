import assert from "node:assert/strict";
import test from "node:test";
import { CommandTimeline } from "../app/game/command-timeline.ts";
import { LocalMovementPredictor } from "../app/game/local-movement-predictor.ts";

const openWorld = { isBlockedCell: () => false };

function owner({ tick = 0, seq = 0, px = 512, vx = 0, lifeId = 1, ack = null, speedLevel = 0 } = {}) {
  return {
    protocol: 3,
    type: "owner_snapshot",
    serverTick: tick,
    serverTimeMs: tick * (1000 / 30),
    snapshotSeq: seq,
    lastProcessedCommandSeq: ack,
    player: {
      id: "P1", px, py: 512, vx, vy: 0, direction: vx ? "right" : "neutral",
      targetCellX: null, targetCellY: null,
      x: Math.floor(px / 1024), y: 0, alive: true, joined: true, isAI: false,
      nickname: "P1", power: 1, range: 2, shield: 0, lifeId, teleport: false,
      ...(speedLevel === null ? {} : { speedLevel }),
    },
  };
}

test("keydown predicts exactly one shared step in-frame and scheduler cannot duplicate its tick", () => {
  const predictor = new LocalMovementPredictor();
  const timeline = new CommandTimeline();
  predictor.reset(owner());
  const command = timeline.prepareDirection("right", 1);
  timeline.commit(command);
  assert.equal(predictor.advanceTo(1, timeline.pending, openWorld).position.x, 0.099609375);
  assert.equal(predictor.advanceTo(1, timeline.pending, openWorld).position.x, 0.099609375);
  assert.equal(predictor.advanceTo(2, timeline.pending, openWorld).position.x, 0.19921875);
});

test("prediction uses the authoritative speed level while old snapshots keep legacy speed", () => {
  function cruiseDistance(speedLevel) {
    const predictor = new LocalMovementPredictor({ maxReplayTicks: 64 });
    const timeline = new CommandTimeline();
    predictor.reset(owner({ speedLevel }));
    timeline.commit(timeline.prepareDirection("right", 1));
    predictor.advanceTo(10, timeline.pending, openWorld);
    const start = predictor.position.x;
    predictor.advanceTo(40, timeline.pending, openWorld);
    return predictor.position.x - start;
  }

  assert.ok(Math.abs(cruiseDistance(0) - 3) < 0.02);
  assert.ok(Math.abs(cruiseDistance(1) - 3.5) < 0.02);
  assert.ok(cruiseDistance(null) > 7);
});

test("render preview fills the next fixed tick without mutating prediction", () => {
  const predictor = new LocalMovementPredictor();
  const timeline = new CommandTimeline();
  predictor.reset(owner());
  const command = timeline.prepareDirection("right", 1);
  timeline.commit(command);
  predictor.advanceTo(1, timeline.pending, openWorld);

  assert.deepEqual(predictor.position, { x: 0.099609375, y: 0 });
  assert.deepEqual(predictor.previewNext(timeline.pending, openWorld).position, {
    x: 0.19921875,
    y: 0,
  });
  assert.deepEqual(predictor.position, { x: 0.099609375, y: 0 });
  assert.equal(predictor.predictedTick, 1);
});

test("owner snapshots restore authority and replay still-pending input", () => {
  const predictor = new LocalMovementPredictor();
  const timeline = new CommandTimeline();
  predictor.reset(owner({ seq: 1 }));
  const right = timeline.prepareDirection("right", 1);
  timeline.commit(right);
  const neutral = timeline.prepareDirection("neutral", 4);
  timeline.commit(neutral);
  predictor.advanceTo(6, timeline.pending, openWorld);
  const localPosition = predictor.position;
  timeline.acknowledge(0);
  const result = predictor.reconcile(
    owner({ tick: 2, seq: 2, px: 512, vx: 0, ack: 0, speedLevel: 1 }),
    timeline.pending,
    openWorld,
  );
  assert.equal(result.applied, true);
  assert.notDeepEqual(predictor.position, localPosition);
  assert.deepEqual(predictor.position, { x: 0, y: 0 });
  assert.equal(
    predictor.reconcile(owner({ tick: 1, seq: 1 }), timeline.pending, openWorld).reason,
    "stale",
  );
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
  assert.equal(result.collisionCrossing, false);
  assert.deepEqual(result.position, { x: 0, y: 0 });
});

test("prediction uses the body-majority cell for bombs and finishes after keyup", () => {
  const predictor = new LocalMovementPredictor();
  const timeline = new CommandTimeline();
  predictor.reset(owner());
  const right = timeline.prepareDirection("right", 1);
  timeline.commit(right);
  predictor.advanceTo(2, timeline.pending, openWorld);
  assert.deepEqual(predictor.bombCell, { x: 0, y: 0 });

  const neutral = timeline.prepareDirection("neutral", 3);
  timeline.commit(neutral);
  predictor.advanceTo(12, timeline.pending, openWorld);
  assert.deepEqual(predictor.position, { x: 1, y: 0 });
  assert.deepEqual(predictor.bombCell, { x: 1, y: 0 });
});

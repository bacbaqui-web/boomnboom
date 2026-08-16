import assert from "node:assert/strict";
import test from "node:test";
import { ClockSync } from "../app/game/clock-sync.ts";
import { CommandTimeline } from "../app/game/command-timeline.ts";
import { LocalMovementPredictor } from "../app/game/local-movement-predictor.ts";
import { stepMovement } from "../shared/movement-step.mjs";

const openWorld = { isBlockedCell: () => false };

function ownerSnapshot(state, tick, snapshotSeq, ack) {
  return {
    protocol: 3,
    type: "owner_snapshot",
    serverTick: tick,
    serverTimeMs: tick * (1000 / 30),
    snapshotSeq,
    lastProcessedCommandSeq: ack,
    player: {
      id: "P1", px: state.px, py: state.py, vx: state.vx, vy: state.vy,
      direction: state.desiredDirection, x: Math.floor(state.px / 1024),
      targetCellX: state.targetCellX, targetCellY: state.targetCellY,
      y: Math.floor(state.py / 1024), alive: true, joined: true, isAI: false,
      nickname: "P1", power: 1, range: 2, shield: 0, lifeId: 1, teleport: false,
      speedLevel: 0,
    },
  };
}

function runNetworkScenario(rttMs, { stallFrom = null, stallTo = null } = {}) {
  const clock = new ClockSync();
  clock.recordEnvelope(0, 0, 0);
  for (let index = 0; index < 30; index += 1) {
    clock.recordPong({ clientTimeMs: 0, receivedAt: rttMs, serverTimeMs: rttMs / 2, serverTick: 0 });
  }
  const lead = clock.commandLeadTicks();
  const timeline = new CommandTimeline();
  const predictor = new LocalMovementPredictor({ maxReplayTicks: 16 });
  let serverState = {
    px: 512, py: 512, vx: 0, vy: 0, desiredDirection: "neutral",
    queuedTurn: null, queuedTurnUntilTick: 0,
    targetCellX: null, targetCellY: null,
  };
  predictor.reset(ownerSnapshot(serverState, 0, 0, null));
  const command = timeline.prepareDirection("right", lead);
  timeline.commit(command);
  predictor.advanceTo(lead, timeline.pending, openWorld);

  const baseOneWayTicks = Math.ceil((rttMs / 2) / (1000 / 30));
  const jitter = [-1, 2, 0, -2, 1, 0];
  const commandArrivalTick = Math.max(1, baseOneWayTicks + jitter[0]);
  let commandArrived = false;
  let serverDirection = "neutral";
  let ack = null;
  let snapshotSeq = 1;
  const transit = [];
  const errors = [];
  let observedSnapshots = 0;

  for (let tick = 1; tick <= 90; tick += 1) {
    if (tick >= commandArrivalTick) commandArrived = true;
    if (commandArrived && tick >= lead) {
      serverDirection = "right";
      ack = 0;
    }
    serverState = stepMovement(
      serverState,
      { tick, direction: serverDirection },
      openWorld,
    ).state;
    const delay = Math.max(1, baseOneWayTicks + jitter[snapshotSeq % jitter.length]);
    const nominalDeliveryTick = tick + delay;
    transit.push({
      deliverTick:
        stallFrom !== null &&
        nominalDeliveryTick >= stallFrom &&
        nominalDeliveryTick < stallTo
          ? stallTo
          : nominalDeliveryTick,
      snapshot: ownerSnapshot(serverState, tick, snapshotSeq, ack),
    });
    snapshotSeq += 1;

    predictor.advanceTo(tick + lead, timeline.pending, openWorld);
    for (const packet of transit.filter((candidate) => candidate.deliverTick === tick)) {
      if (!predictor.canApplySnapshot(packet.snapshot)) continue;
      const before = predictor.position;
      timeline.acknowledge(packet.snapshot.lastProcessedCommandSeq);
      const result = predictor.reconcile(packet.snapshot, timeline.pending, openWorld);
      if (!result.applied) continue;
      const after = predictor.position;
      errors.push(Math.hypot(before.x - after.x, before.y - after.y));
      observedSnapshots += 1;
    }
  }
  return { errors, observedSnapshots, lead, pending: timeline.size };
}

test("300ms receive stall keeps authoritative replay corrections bounded", () => {
  const result = runNetworkScenario(300, { stallFrom: 30, stallTo: 39 });
  assert.ok(result.observedSnapshots >= 30);
  assert.ok(result.errors.every((distance) => distance <= 0.5), JSON.stringify(result));
  assert.equal(result.pending, 0);
  assert.ok(result.lead <= 12);
});

for (const rttMs of [200, 300]) {
  test(`${rttMs}ms RTT and 50ms-class jitter keep authoritative replay bounded`, () => {
    const result = runNetworkScenario(rttMs);
    assert.ok(result.observedSnapshots >= 40);
    assert.ok(result.errors.every((distance) => distance <= 0.5), JSON.stringify(result));
    assert.equal(result.pending, 0);
    assert.ok(result.lead >= (rttMs === 200 ? 5 : 7));
  });
}

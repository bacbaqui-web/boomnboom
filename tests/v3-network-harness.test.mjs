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
      y: Math.floor(state.py / 1024), alive: true, joined: true, isAI: false,
      nickname: "P1", power: 1, range: 2, shield: 0, lifeId: 1, teleport: false,
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
  const replayTicks = [];

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
    if (tick % 2 === 0) {
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
    }

    predictor.advanceTo(tick + lead, timeline.pending, openWorld);
    for (const packet of transit.filter((candidate) => candidate.deliverTick === tick)) {
      if (!predictor.canApplySnapshot(packet.snapshot)) continue;
      const before = predictor.position;
      timeline.acknowledge(packet.snapshot.lastProcessedCommandSeq);
      const result = predictor.reconcile(packet.snapshot, timeline.pending, openWorld);
      if (!result.applied) continue;
      const after = predictor.position;
      errors.push(Math.hypot(before.x - after.x, before.y - after.y));
      replayTicks.push(result.replayTicks);
    }
  }
  return { errors, replayTicks, lead };
}

test("300ms receive stall keeps prediction replay and pending input bounded", () => {
  const result = runNetworkScenario(300, { stallFrom: 30, stallTo: 39 });
  assert.ok(result.errors.length >= 15);
  assert.ok(result.replayTicks.every((count) => count <= 16));
  assert.ok(result.lead <= 12);
});

for (const rttMs of [200, 300]) {
  test(`${rttMs}ms RTT and 50ms-class jitter keep replay bounded and straight correction small`, () => {
    const result = runNetworkScenario(rttMs);
    assert.ok(result.errors.length >= 20);
    assert.ok(result.replayTicks.every((count) => count <= 16));
    const small = result.errors.filter((distance) => distance <= 0.1).length;
    assert.ok(small / result.errors.length >= 0.9);
    assert.ok(result.lead >= (rttMs === 200 ? 5 : 7));
  });
}

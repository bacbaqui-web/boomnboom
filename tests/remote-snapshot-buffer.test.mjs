import assert from "node:assert/strict";
import test from "node:test";
import { projectV3StoreMessage } from "../app/game/protocol-v3.ts";
import { RemoteSnapshotBuffer } from "../app/game/remote-snapshot-buffer.ts";
import { ClientWorldStore } from "../app/game/world-store.ts";

function player(id, tick, overrides = {}) {
  return {
    id,
    px: 512 + tick * 128,
    py: 512,
    vx: 128,
    vy: 0,
    direction: "right",
    x: 0,
    y: 0,
    alive: true,
    joined: true,
    isAI: false,
    nickname: id,
    power: 1,
    range: 2,
    shield: 0,
    lifeId: 1,
    teleport: false,
    ...overrides,
  };
}

function snapshot(seq, tick, players = [player("R1", tick)]) {
  return {
    protocol: 3,
    type: "entity_snapshot",
    snapshotSeq: seq,
    serverTick: tick,
    serverTimeMs: tick * (1000 / 30),
    players,
  };
}

for (const fps of [60, 120]) {
  test(`15Hz snapshots render at constant speed at ${fps}Hz`, () => {
    const buffer = new RemoteSnapshotBuffer();
    let nextSnapshotTick = 0;
    let seq = 0;
    const positions = [];
    const renderStep = 30 / fps;
    for (let renderTick = 0; renderTick <= 60; renderTick += renderStep) {
      while (nextSnapshotTick <= renderTick) {
        buffer.ingest(snapshot(seq, nextSnapshotTick), "LOCAL");
        seq += 1;
        nextSnapshotTick += 2;
      }
      const position = buffer.sample("R1", renderTick, 100);
      if (renderTick >= 5 && position) {
        positions.push(position.x);
        assert.ok(Math.abs(position.x - (renderTick - 3) * 0.125) < 1e-8);
      }
    }
    const steps = positions.slice(1).map((value, index) => value - positions[index]);
    assert.ok(steps.every((value) => Math.abs(value - 0.125 * renderStep) < 1e-8));
  });
}

test("stale, duplicate, delay growth, drop, and stall never rewind or extrapolate without bound", () => {
  const buffer = new RemoteSnapshotBuffer({ maxHistory: 4 });
  assert.equal(buffer.ingest(snapshot(0, 0), "LOCAL").accepted, true);
  assert.equal(buffer.ingest(snapshot(1, 2), "LOCAL").accepted, true);
  assert.equal(buffer.ingest(snapshot(3, 6), "LOCAL").accepted, true);
  assert.equal(buffer.ingest(snapshot(2, 4), "LOCAL").reason, "stale");
  assert.equal(buffer.ingest(snapshot(3, 6), "LOCAL").reason, "duplicate");

  const beforeDelayGrowth = buffer.sample("R1", 9, 100);
  const afterDelayGrowth = buffer.sample("R1", 9, 150);
  assert.ok(afterDelayGrowth.x >= beforeDelayGrowth.x);
  const extrapolated = buffer.sample("R1", 20, 0);
  const frozen = buffer.sample("R1", 100, 0);
  assert.deepEqual(frozen, extrapolated);

  for (let seq = 4; seq < 14; seq += 1) buffer.ingest(snapshot(seq, seq * 2), "LOCAL");
  assert.equal(buffer.historySize("R1"), 4);
});

test("local owner is never buffered and accepted removal cannot be undone by a stale packet", () => {
  const buffer = new RemoteSnapshotBuffer();
  buffer.ingest(snapshot(0, 0, [player("LOCAL", 0), player("R1", 0)]), "LOCAL");
  assert.deepEqual(buffer.entityIds, ["R1"]);
  buffer.ingest(snapshot(1, 2, [player("LOCAL", 2)]), "LOCAL");
  assert.deepEqual(buffer.entityIds, []);
  buffer.ingest(snapshot(0, 0, [player("LOCAL", 0), player("R1", 0)]), "LOCAL");
  assert.deepEqual(buffer.entityIds, []);
});

test("life, teleport, and impossible speed snap instead of interpolating", () => {
  for (const discontinuity of [
    { px: 2560 },
    { px: 768, lifeId: 2 },
    { px: 768, teleport: true },
  ]) {
    const buffer = new RemoteSnapshotBuffer();
    buffer.ingest(snapshot(0, 0), "LOCAL");
    buffer.ingest(snapshot(1, 2, [player("R1", 2, discontinuity)]), "LOCAL");
    assert.deepEqual(buffer.sample("R1", 1, 0), { x: 0, y: 0 });
    assert.equal(buffer.sample("R1", 2, 0).x, discontinuity.px / 1024 - 0.5);
  }
});

test("remote runtime updates do not notify terrain chunk selectors", () => {
  const store = new ClientWorldStore();
  store.apply(projectV3StoreMessage({
    protocol: 3,
    type: "world_init",
    serverTick: 0,
    serverTimeMs: 0,
    worldId: "WORLD",
    playerId: "LOCAL",
    baselineTick: 0,
    chunkSize: 16,
  }));
  let chunkNotifications = 0;
  store.subscribeChunk("0,0", () => { chunkNotifications += 1; });
  const message = snapshot(0, 0);
  store.apply(projectV3StoreMessage(message));
  new RemoteSnapshotBuffer().ingest(message, "LOCAL");
  assert.equal(chunkNotifications, 0);
});

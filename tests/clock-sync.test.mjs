import assert from "node:assert/strict";
import test from "node:test";
import { ClockSync } from "../app/game/clock-sync.ts";

test("clock sync derives a bounded future command lead from RTT and jitter", () => {
  const clock = new ClockSync();
  clock.recordEnvelope(100, 1000, 0);
  for (let index = 0; index < 20; index += 1) {
    clock.recordPong({ clientTimeMs: 0, receivedAt: 300, serverTimeMs: 150, serverTick: 100 });
  }
  assert.ok(clock.commandLeadTicks() >= 7 && clock.commandLeadTicks() <= 9);
  assert.equal(clock.estimatedServerTick(400), 103);
  assert.ok(clock.targetTick(400, 102) > 102);
});

test("clock sync ignores stale server ticks and accepts uint32 wrap", () => {
  const clock = new ClockSync();
  clock.recordEnvelope(200, 2000, 0);
  clock.recordEnvelope(199, 1990, 100);
  assert.equal(clock.estimatedServerTick(100), 203);

  const wrapped = new ClockSync();
  wrapped.recordEnvelope(0xffff_ffff, 0, 0);
  wrapped.recordEnvelope(0, 1, 10);
  assert.equal(wrapped.estimatedServerTick(10), 0);
});

test("remote interpolation clock stays fractional and adapts delay within bounds", () => {
  const clock = new ClockSync();
  clock.recordEnvelope(10, 0, 100);
  const estimated = clock.estimatedServerTickFloat(150);
  assert.ok(estimated > 14 && estimated < 15);
  for (let index = 0; index < 40; index += 1) {
    const receivedAt = index % 2 === 0 ? 60 : 240;
    clock.recordPong({ clientTimeMs: 0, serverTimeMs: 0, serverTick: 10, receivedAt });
  }
  assert.ok(clock.interpolationDelayMs >= 80 && clock.interpolationDelayMs <= 150);
});

test("clock sync ignores impossible RTT outliers without moving its anchor", () => {
  const clock = new ClockSync();
  clock.recordEnvelope(30, 1000, 100);
  const beforeRtt = clock.rttMs;
  clock.recordPong({
    clientTimeMs: 0,
    receivedAt: 3000,
    serverTimeMs: 5000,
    serverTick: 1000,
  });
  assert.equal(clock.rttMs, beforeRtt);
  assert.equal(clock.estimatedServerTick(100), 30);
});

test("clock reset accepts a restarted server tick after a high previous tick", () => {
  const clock = new ClockSync();
  clock.recordEnvelope(500_000, 1000, 100);
  clock.reset();
  clock.recordEnvelope(0, 0, 200);
  assert.equal(clock.estimatedServerTick(200), 0);
  assert.equal(clock.commandLeadTicks(), 5);
});

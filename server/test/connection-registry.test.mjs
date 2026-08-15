import assert from "node:assert/strict";
import test from "node:test";
import { createConnectionRegistry } from "../src/network/connection-registry.mjs";

function session() {
  return { playerId: null, bindingToken: null };
}

test("resume rotates the token and only the newest socket remains authoritative", () => {
  let tokenNumber = 0;
  const registry = createConnectionRegistry({
    createToken: () => String(++tokenNumber).padStart(32, "0"),
  });
  const first = session();
  const initial = registry.bindNew(first, "P1");
  assert.equal(registry.isCurrent(first), true);

  const second = session();
  const resumed = registry.resume(second, initial.resumeToken);
  assert.equal(resumed.accepted, true);
  assert.equal(resumed.playerId, "P1");
  assert.notEqual(resumed.resumeToken, initial.resumeToken);
  assert.equal(registry.isCurrent(first), false);
  assert.equal(registry.isCurrent(second), true);
  assert.equal(registry.resume(session(), initial.resumeToken).accepted, false);
  registry.close();
});

test("disconnect keeps a bounded lease and expiry removes token and player once", () => {
  const scheduled = [];
  const expired = [];
  const registry = createConnectionRegistry({
    leaseMs: 10_000,
    createToken: () => "a".repeat(32),
    schedule(callback, delay) {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
    cancel() {},
    onLeaseExpired: (playerId) => expired.push(playerId),
  });
  const first = session();
  const binding = registry.bindNew(first, "P1");
  assert.equal(registry.disconnect(first), true);
  assert.equal(scheduled[0].delay, 10_000);
  assert.deepEqual(registry.readMetrics(), {
    playerLeases: 1,
    disconnectedLeases: 1,
    resumeSuccess: 0,
    resumeRejected: 0,
    resumeExpired: 0,
  });
  scheduled[0].callback();
  assert.deepEqual(expired, ["P1"]);
  assert.equal(registry.resume(session(), binding.resumeToken).accepted, false);
  assert.equal(registry.readMetrics().resumeExpired, 1);
  registry.close();
});

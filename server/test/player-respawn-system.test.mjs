import assert from "node:assert/strict";
import test from "node:test";
import { createPlayerRespawnSystem } from "../src/simulation/player-respawn-system.mjs";

test("respawn starts a fresh movement command session", () => {
  const updates = [];
  const calls = [];
  const system = createPlayerRespawnSystem({
    world: {
      getPlayer: () => ({ id: "P1", lifeId: 3 }),
      updatePlayer: (playerId, changes) => updates.push({ playerId, changes }),
    },
    simulation: {
      respawnPlayer: () => ({ accepted: true }),
    },
    movementSystem: {
      initializePlayer: (playerId, options) => calls.push(["movement", playerId, options]),
    },
    commandBuffer: {
      resetPlayerSession: (playerId) => calls.push(["session", playerId]),
      resetPlayerIntent: () => assert.fail("respawn must reset the sequence domain"),
    },
  });

  const result = system.step(10, new Map([
    ["P1", { actions: [{ commandSeq: 7, action: "respawn" }] }],
  ]));

  assert.equal(result.changed, true);
  assert.deepEqual(updates, [{
    playerId: "P1",
    changes: { lifeId: 4, teleportTick: 10 },
  }]);
  assert.deepEqual(calls, [
    ["movement", "P1", { resetToCell: true }],
    ["session", "P1"],
  ]);
  assert.deepEqual(result.results, [{
    playerId: "P1",
    commandSeq: 7,
    action: "respawn",
    accepted: true,
    reason: null,
  }]);
});

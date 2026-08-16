import assert from "node:assert/strict";
import test from "node:test";
import { createCrateRespawnSystem } from "../src/simulation/crate-respawn-system.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

function createCrateWorld() {
  return createWorldOwner({
    generateChunk({ chunkX, chunkY, chunkSize }) {
      return Array.from({ length: chunkSize * chunkSize }, (_, index) => {
        const x = chunkX * chunkSize + (index % chunkSize);
        const y = chunkY * chunkSize + Math.floor(index / chunkSize);
        return x === 1 && y === 1 ? "crate" : "floor";
      });
    },
  });
}

test("a destroyed crate warns three seconds before its twelve second restore", () => {
  const world = createCrateWorld();
  const system = createCrateRespawnSystem({ world, tickRate: 30 });
  world.destroyCrate(1, 1);
  assert.equal(system.step(0).scheduled, 1);
  assert.equal(system.step(269).changed, false);
  assert.equal(world.readTerrainTile(1, 1), "floor");
  const warning = system.step(270);
  assert.deepEqual(warning.warned, [{ x: 1, y: 1, respawnTick: 360 }]);
  assert.equal(world.readTerrainTile(1, 1), "crate_warning");
  assert.equal(system.step(359).changed, false);
  assert.deepEqual(system.step(360).restored, [{ x: 1, y: 1 }]);
  assert.equal(world.readTerrainTile(1, 1), "crate");
});

test("warning waits outside every live player's 9 by 9 safety area", () => {
  const world = createCrateWorld();
  const system = createCrateRespawnSystem({ world, tickRate: 30 });
  world.addPlayer({ id: "P1", x: 5, y: 5, alive: true });
  world.destroyCrate(1, 1);
  system.step(0);
  assert.equal(system.step(270).changed, false);
  assert.equal(world.readTerrainTile(1, 1), "floor");
  world.updatePlayer("P1", { x: 6, y: 6 });
  const warning = system.step(271);
  assert.equal(warning.warned.length, 1);
  world.updatePlayer("P1", { x: 1, y: 1 });
  assert.equal(system.step(360).changed, false);
  assert.equal(system.step(361).restored.length, 1);
  assert.equal(world.readTerrainTile(1, 1), "crate");
});

test("crate respawn tick comparisons stay correct across uint32 wrap", () => {
  const world = createCrateWorld();
  const system = createCrateRespawnSystem({
    world,
    tickRate: 1,
    respawnSeconds: 4,
    warningSeconds: 3,
  });
  world.destroyCrate(1, 1);
  system.step(0xffff_fffe);
  assert.equal(system.step(0xffff_ffff).warned.length, 1);
  assert.equal(system.step(1).restored.length, 0);
  assert.equal(system.step(2).restored.length, 1);
});

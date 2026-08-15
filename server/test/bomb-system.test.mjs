import assert from "node:assert/strict";
import test from "node:test";
import { createBombSystem } from "../src/simulation/bomb-system.mjs";
import { createGameSimulation } from "../src/simulation/game-simulation.mjs";
import { createExplosionSystem } from "../src/simulation/explosion-system.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

function flatWorld() {
  return createWorldOwner({
    generateChunk: ({ chunkSize }) => new Array(chunkSize * chunkSize).fill("floor"),
  });
}

function addPlayer(world, id = "P1") {
  world.addPlayer({
    id, x: 2, y: 3, px: 2560, py: 3584, vx: 0, vy: 0,
    joined: true, alive: true, isAI: false, action: "wait", nickname: id,
    power: 1, range: 2, shield: 0,
  });
}

function commands(commandSeq = 1) {
  return new Map([["P1", {
    direction: "neutral",
    actions: [{ commandSeq, targetTick: 10, action: "bomb" }],
  }]]);
}

test("fixed bomb placement uses the authoritative tick position and exact 90 tick fuse", () => {
  const world = flatWorld();
  addPlayer(world);
  const system = createBombSystem({ world, fuseTicks: 90, tickRate: 30 });
  const placed = system.step(10, commands());
  assert.deepEqual(placed.results[0], {
    playerId: "P1",
    commandSeq: 1,
    action: "bomb",
    accepted: true,
    reason: null,
    bombId: "V3-B1",
    cell: { x: 2, y: 3 },
    spawnTick: 10,
    explodeTick: 100,
  });
  assert.equal(system.step(11, new Map()).changed, false);
  assert.equal(system.step(40, new Map()).changed, true);
  assert.equal(world.readBombs()[0].fuse, 2);
});

test("legacy world clock never decrements a fixed V3 bomb", () => {
  const world = flatWorld();
  addPlayer(world);
  const fixed = createBombSystem({ world });
  fixed.step(0, commands());
  const legacy = createGameSimulation({ world, initialTick: 0, bombFuseTicks: 3 });
  legacy.advanceToTick(3);
  assert.equal(world.readBombs()[0].fuse, 3);
  assert.equal(world.readBombs()[0].explodeTick, 90);
  const explosion = createExplosionSystem({ world });
  assert.equal(explosion.step(90).events.length, 1);
  assert.equal(explosion.step(90).events.length, 0);
});

test("occupied cells and shared owner power reject placement authoritatively", () => {
  const world = flatWorld();
  addPlayer(world);
  const system = createBombSystem({ world });
  assert.equal(system.step(1, commands(1)).results[0].accepted, true);
  assert.equal(system.step(2, commands(2)).results[0].reason, "cell_occupied");
});

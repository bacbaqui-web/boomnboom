import assert from "node:assert/strict";
import test from "node:test";
import { createExplosionSystem } from "../src/simulation/explosion-system.mjs";
import { createGameSimulation } from "../src/simulation/game-simulation.mjs";
import { createPlayerCommandBuffer } from "../src/simulation/player-command-buffer.mjs";
import { createPlayerMovementSystem } from "../src/simulation/player-movement-system.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

function worldWithCrates(crates = []) {
  const keys = new Set(crates.map(([x, y]) => `${x},${y}`));
  return createWorldOwner({
    generateChunk({ chunkX, chunkY, chunkSize }) {
      return Array.from({ length: chunkSize * chunkSize }, (_, index) => {
        const x = chunkX * chunkSize + index % chunkSize;
        const y = chunkY * chunkSize + Math.floor(index / chunkSize);
        return keys.has(`${x},${y}`) ? "crate" : "floor";
      });
    },
  });
}

function addPlayer(world, id, x, y, overrides = {}) {
  world.addPlayer({
    id, x, y, px: x * 1024 + 512, py: y * 1024 + 512, vx: 0, vy: 0,
    joined: true, alive: true, isAI: false, action: "wait", nickname: id,
    power: 1, range: 2, shield: 0, lifeId: 1, ...overrides,
  });
}

function fixedBomb(world, overrides = {}) {
  world.addBomb({
    id: "V3-B1", x: 0, y: 0, owner: "OWNER", range: 2, fuse: 1,
    bornTick: 0, spawnTick: 0, explodeTick: 3, clockDomain: "v3",
    ownerPassThrough: false, ...overrides,
  });
}

test("explosion uses current fixed positions, destroys crates, and applies shield once", () => {
  const world = worldWithCrates([[1, 0]]);
  addPlayer(world, "OWNER", 8, 8);
  addPlayer(world, "ESCAPED", 1, 0);
  addPlayer(world, "DOOMED", -1, 0);
  addPlayer(world, "SHIELD", 0, 1, { shield: 1 });
  fixedBomb(world);
  world.updatePlayer("ESCAPED", { x: 7, y: 7, px: 7680, py: 7680 });
  const system = createExplosionSystem({ world, flameTicks: 15 });
  const result = system.step(3);
  assert.equal(world.getPlayer("ESCAPED").alive, true);
  assert.equal(world.getPlayer("DOOMED").alive, false);
  assert.deepEqual(
    [world.getPlayer("SHIELD").alive, world.getPlayer("SHIELD").shield],
    [true, 0],
  );
  assert.equal(world.readTerrainTile(1, 0), "floor");
  assert.equal(result.events[0].eventTick, 3);
  assert.equal(result.events[0].expireTick, 18);
  system.step(4);
  assert.equal(world.getPlayer("SHIELD").alive, true);
});

test("V3 and legacy flame clocks preserve each other's active flames", () => {
  const world = worldWithCrates();
  addPlayer(world, "OWNER", 8, 8);
  world.replaceFlamesForDomain("legacy", [{ x: 9, y: 9 }]);
  fixedBomb(world, { explodeTick: 1 });
  const system = createExplosionSystem({ world, flameTicks: 2 });
  system.step(1);
  assert.ok(world.readFlames().some((flame) => flame.clockDomain === "v3"));
  assert.ok(world.readFlames().some((flame) => flame.x === 9 && flame.y === 9));
  const legacy = createGameSimulation({ world, initialTick: 0 });
  legacy.advanceToTick(1);
  assert.ok(world.readFlames().some((flame) => flame.clockDomain === "v3"));
  world.replaceFlamesForDomain("legacy", [{ x: 8, y: 8 }]);
  system.step(3);
  assert.equal(world.readFlames().some((flame) => flame.clockDomain === "v3"), false);
  assert.ok(world.readFlames().some((flame) => flame.x === 8 && flame.y === 8));
});

test("AI death drops an item then safely respawns with reset fixed motion", () => {
  const world = worldWithCrates();
  addPlayer(world, "OWNER", 8, 8);
  addPlayer(world, "BOT-1", 1, 0, { isAI: true });
  for (let index = 2; index <= 6; index += 1) {
    addPlayer(world, `BOT-${index}`, 8 + index, 8, { isAI: true });
  }
  const simulation = createGameSimulation({ world });
  const movement = createPlayerMovementSystem({ world });
  const commands = createPlayerCommandBuffer();
  commands.registerPlayer("BOT-1");
  fixedBomb(world);
  const system = createExplosionSystem({
    world,
    respawnAI(playerId, tick) {
      const before = world.getPlayer(playerId);
      const respawn = simulation.respawnPlayer(playerId);
      if (!respawn.accepted) return false;
      world.updatePlayer(playerId, {
        lifeId: before.lifeId + 1,
        teleportTick: tick % 2 === 0 ? tick : (tick + 1) >>> 0,
      });
      movement.initializePlayer(playerId, { resetToCell: true });
      commands.resetPlayerIntent(playerId);
      return true;
    },
  });
  system.step(3);
  const bot = world.getPlayer("BOT-1");
  assert.equal(bot.alive, true);
  assert.equal(bot.lifeId, 2);
  assert.deepEqual([bot.vx, bot.vy, bot.desiredDirection], [0, 0, "neutral"]);
  assert.ok(world.getItemAt(1, 0));
  assert.equal(world.readPlayers().filter((player) => player.isAI && player.alive).length, 6);
});

test("continuous fixed movement into a live V3 flame uses the same damage rule", () => {
  const world = worldWithCrates();
  addPlayer(world, "RUNNER", 1, 1);
  const movement = createPlayerMovementSystem({ world });
  movement.initializePlayer("RUNNER");
  world.replaceFlamesForDomain("v3", [{
    id: "F1", x: 1, y: 0, clockDomain: "v3", eventSeq: 7,
    startTick: 0, expireTick: 20,
  }]);
  const explosion = createExplosionSystem({ world });
  for (let tick = 1; tick <= 5 && world.getPlayer("RUNNER").alive; tick += 1) {
    movement.step(tick, new Map([["RUNNER", { direction: "up", actions: [] }]]));
    explosion.step(tick);
  }
  assert.equal(world.getPlayer("RUNNER").alive, false);
});

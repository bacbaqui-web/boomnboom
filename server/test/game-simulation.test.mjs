import assert from "node:assert/strict";
import test from "node:test";
import { createGameSimulation } from "../src/simulation/game-simulation.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

function createTestWorld({ crates = [], walls = [] } = {}) {
  const crateKeys = new Set(crates.map(([x, y]) => `${x},${y}`));
  const wallKeys = new Set(walls.map(([x, y]) => `${x},${y}`));
  return createWorldOwner({
    generateChunk({ chunkX, chunkY, chunkSize }) {
      const tiles = [];
      for (let localY = 0; localY < chunkSize; localY += 1) {
        for (let localX = 0; localX < chunkSize; localX += 1) {
          const x = chunkX * chunkSize + localX;
          const y = chunkY * chunkSize + localY;
          const key = `${x},${y}`;
          tiles.push(wallKeys.has(key) ? "wall" : crateKeys.has(key) ? "crate" : "floor");
        }
      }
      return tiles;
    },
  });
}

function addPlayer(world, {
  id,
  x,
  y,
  isAI = false,
  power = 1,
  range = 2,
  shield = 0,
  alive = true,
} = {}) {
  world.addPlayer({
    id,
    x,
    y,
    prevX: x,
    prevY: y,
    isAI,
    action: "wait",
    score: 0,
    power,
    range,
    shield,
    lastMoveAt: 0,
    nickname: id,
    joined: true,
    alive,
  });
}

test("movement uses the authoritative 140ms cadence and one canonical tile per accepted input", () => {
  const world = createTestWorld({ walls: [[3, 1]] });
  addPlayer(world, { id: "P1", x: 0, y: 1 });
  const simulation = createGameSimulation({ world, moveIntervalMs: 140 });

  assert.equal(simulation.applyAction("P1", "right", { now: 1000 }).accepted, true);
  assert.deepEqual([world.getPlayer("P1").x, world.getPlayer("P1").y], [1, 1]);
  const duplicate = simulation.applyAction("P1", "right", { now: 1050 });
  assert.equal(duplicate.reason, "rate_limited");
  assert.deepEqual([world.getPlayer("P1").x, world.getPlayer("P1").y], [1, 1]);

  assert.equal(simulation.applyAction("P1", "right", { now: 1140 }).accepted, true);
  assert.deepEqual([world.getPlayer("P1").x, world.getPlayer("P1").y], [2, 1]);
  const blocked = simulation.applyAction("P1", "right", { now: 1280 });
  assert.equal(blocked.accepted, true);
  assert.equal(blocked.changed, false);
  assert.deepEqual([world.getPlayer("P1").x, world.getPlayer("P1").y], [2, 1]);
});

test("movement collects items through the same simulation command", () => {
  const world = createTestWorld();
  addPlayer(world, { id: "P1", x: 0, y: 1 });
  world.setItem({ x: 1, y: 1, type: "bomb" });
  const simulation = createGameSimulation({ world });

  simulation.applyAction("P1", "right", { now: 1000 });
  assert.equal(world.getPlayer("P1").power, 2);
  assert.equal(world.getItemAt(1, 1), null);
});

test("legacy rollback movement gains half a tile per second from a speed item", () => {
  const world = createTestWorld();
  addPlayer(world, { id: "P1", x: 0, y: 1 });
  world.updatePlayer("P1", { speedLevel: 0 });
  world.setItem({ x: 1, y: 1, type: "speed" });
  const simulation = createGameSimulation({ world, moveIntervalMs: 1000 / 3 });

  assert.equal(simulation.applyAction("P1", "right", { now: 1000 }).changed, true);
  assert.equal(world.getPlayer("P1").speedLevel, 1);
  assert.equal(
    simulation.applyAction("P1", "right", { now: 1280 }).accepted,
    false,
  );
  assert.equal(
    simulation.applyAction("P1", "right", { now: 1286 }).accepted,
    true,
  );
});

test("bomb placement is immediate and respects the owner bomb limit", () => {
  const world = createTestWorld();
  addPlayer(world, { id: "P1", x: 4, y: 5 });
  const simulation = createGameSimulation({ world, initialTick: 10 });

  const first = simulation.applyAction("P1", "bomb");
  const second = simulation.applyAction("P1", "bomb");
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(world.readBombs().length, 1);
  assert.deepEqual(
    [world.readBombs()[0].x, world.readBombs()[0].y, world.readBombs()[0].bornTick],
    [4, 5, 10],
  );
});

test("damage uses player positions at the explosion tick", () => {
  const world = createTestWorld();
  addPlayer(world, { id: "OWNER", x: 0, y: 1, range: 2 });
  addPlayer(world, { id: "ESCAPED", x: 1, y: 1 });
  addPlayer(world, { id: "DOOMED", x: 2, y: 1 });
  addPlayer(world, { id: "SHIELDED", x: -1, y: 1, shield: 1 });
  addPlayer(world, { id: "BOT-1", x: 0, y: 2, isAI: true });
  const simulation = createGameSimulation({ world, initialTick: 0, bombFuseTicks: 3 });

  simulation.applyAction("OWNER", "bomb");
  world.updatePlayer("OWNER", { x: 10, y: 10, prevX: 10, prevY: 10 });
  simulation.advanceToTick(2);
  assert.equal(world.readBombs()[0].fuse, 1);
  world.updatePlayer("ESCAPED", { x: 8, y: 8, prevX: 8, prevY: 8 });
  simulation.advanceToTick(3);

  assert.equal(world.getPlayer("ESCAPED").alive, true);
  assert.equal(world.getPlayer("DOOMED").alive, false);
  assert.equal(world.getPlayer("SHIELDED").alive, true);
  assert.equal(world.getPlayer("SHIELDED").shield, 0);
  assert.ok(world.getItemAt(0, 2));
  assert.notDeepEqual(
    [world.getPlayer("BOT-1").x, world.getPlayer("BOT-1").y],
    [0, 2],
  );
});

test("moving into a live flame applies the same damage and shield rules", () => {
  const world = createTestWorld();
  addPlayer(world, { id: "OWNER", x: 0, y: 1, range: 2 });
  addPlayer(world, { id: "RUNNER", x: 2, y: 2 });
  addPlayer(world, { id: "SHIELDED", x: 1, y: 2, shield: 1 });
  const simulation = createGameSimulation({ world, initialTick: 0, bombFuseTicks: 1 });

  simulation.applyAction("OWNER", "bomb");
  world.updatePlayer("OWNER", { x: 10, y: 10, prevX: 10, prevY: 10 });
  simulation.advanceToTick(1);
  assert.ok(world.readFlames().some((flame) => flame.x === 2 && flame.y === 1));

  simulation.applyAction("RUNNER", "up", { now: 1000 });
  simulation.applyAction("SHIELDED", "up", { now: 1000 });
  assert.equal(world.getPlayer("RUNNER").alive, false);
  assert.equal(world.getPlayer("SHIELDED").alive, true);
  assert.equal(world.getPlayer("SHIELDED").shield, 0);
});

test("a crate destroyed by an explosion remains floor on later world ticks", () => {
  const world = createTestWorld({ crates: [[1, 1]] });
  addPlayer(world, { id: "P1", x: 0, y: 1, range: 2 });
  const simulation = createGameSimulation({ world, initialTick: 0, bombFuseTicks: 1 });

  simulation.applyAction("P1", "bomb");
  world.updatePlayer("P1", { x: 10, y: 10, prevX: 10, prevY: 10 });
  simulation.advanceToTick(1);
  assert.equal(world.readTerrainTile(1, 1), "floor");
  const revision = world.readChunkSnapshot(0, 0).revision;

  simulation.advanceToTick(20);
  assert.equal(world.readTerrainTile(1, 1), "floor");
  assert.equal(world.readChunkSnapshot(0, 0).revision, revision);
});

test("late timer catch-up advances each missed bomb tick exactly once", () => {
  const world = createTestWorld();
  addPlayer(world, { id: "P1", x: 0, y: 1 });
  const simulation = createGameSimulation({ world, initialTick: 0, bombFuseTicks: 3 });
  simulation.applyAction("P1", "bomb");
  world.updatePlayer("P1", { x: 10, y: 10, prevX: 10, prevY: 10 });

  const result = simulation.advanceToTick(3);
  assert.equal(result.advancedTicks, 3);
  assert.equal(world.readBombs().length, 0);
  assert.ok(world.readFlames().length > 0);
  assert.equal(simulation.advanceToTick(3).advancedTicks, 0);
});

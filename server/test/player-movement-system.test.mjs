import assert from "node:assert/strict";
import test from "node:test";
import { createPlayerMovementSystem } from "../src/simulation/player-movement-system.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

function createFlatWorld(blocked = []) {
  const blockedCells = new Set(blocked.map(([x, y]) => `${x},${y}`));
  return createWorldOwner({
    generateChunk({ chunkX, chunkY, chunkSize }) {
      return Array.from({ length: chunkSize * chunkSize }, (_, index) => {
        const x = chunkX * chunkSize + (index % chunkSize);
        const y = chunkY * chunkSize + Math.floor(index / chunkSize);
        return blockedCells.has(`${x},${y}`) ? "wall" : "floor";
      });
    },
  });
}

function addJoinedPlayer(world, id = "P1") {
  world.addPlayer({
    id,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    joined: true,
    alive: true,
    isAI: false,
    action: "wait",
    nickname: id,
    power: 1,
    range: 2,
    shield: 0,
  });
}

test("movement system commits fixed motion through World Owner and keeps V2 cells integral", () => {
  const world = createFlatWorld();
  addJoinedPlayer(world);
  const system = createPlayerMovementSystem({ world });
  assert.equal(system.initializePlayer("P1"), true);
  for (let tick = 1; tick <= 4; tick += 1) {
    system.step(tick, new Map([["P1", { direction: "right" }]]));
  }
  const player = world.getPlayer("P1");
  assert.deepEqual([player.px, player.py, player.vx, player.vy], [1152, 512, 256, 0]);
  assert.deepEqual([player.x, player.y], [1, 0]);
  assert.equal(Number.isInteger(player.x), true);
});

test("movement system uses the shared sweep and cannot enter a blocking cell", () => {
  const world = createFlatWorld([[1, 0]]);
  addJoinedPlayer(world);
  const system = createPlayerMovementSystem({ world });
  system.initializePlayer("P1");
  for (let tick = 1; tick <= 5; tick += 1) {
    system.step(tick, new Map([["P1", { direction: "right" }]]));
  }
  const player = world.getPlayer("P1");
  assert.equal(player.px, 704);
  assert.equal(player.vx, 0);
  assert.deepEqual([player.x, player.y], [0, 0]);
});

test("owner exits its bomb AABB once, then the same cell blocks re-entry", () => {
  const world = createFlatWorld();
  addJoinedPlayer(world);
  const system = createPlayerMovementSystem({ world });
  system.initializePlayer("P1");
  world.addBomb({
    id: "V3-B1", x: 0, y: 0, owner: "P1", range: 2, fuse: 3,
    clockDomain: "v3", ownerPassThrough: true, explodeTick: 90,
  });
  for (let tick = 1; tick <= 6; tick += 1) {
    system.step(tick, new Map([["P1", { direction: "right", actions: [] }]]));
  }
  assert.equal(world.readBombs()[0].ownerPassThrough, false);
  for (let tick = 7; tick <= 16; tick += 1) {
    system.step(tick, new Map([["P1", { direction: "left", actions: [] }]]));
  }
  const player = world.getPlayer("P1");
  assert.equal(player.px, 1344);
  assert.equal(player.vx, 0);
});

for (const [type, field] of [["bomb", "power"], ["shield", "shield"], ["flame", "range"]]) {
  test(`fixed movement collects ${type} and applies its server-authoritative stat`, () => {
    const world = createFlatWorld();
    addJoinedPlayer(world);
    const before = world.getPlayer("P1")[field];
    const system = createPlayerMovementSystem({ world });
    system.initializePlayer("P1");
    world.setItem({ id: "DROP", x: 1, y: 0, type });
    let collected = null;
    for (let tick = 1; tick <= 4; tick += 1) {
      const result = system.step(
        tick,
        new Map([["P1", { direction: "right", actions: [] }]]),
      );
      if (result.itemChanged) collected = result.collectedItems[0];
    }
    assert.equal(world.getPlayer("P1")[field], before + 1);
    assert.equal(world.getItemAt(1, 0), null);
    assert.equal(collected.item.id, "DROP");
  });
}

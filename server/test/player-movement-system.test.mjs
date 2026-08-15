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
  assert.deepEqual([player.targetCellX, player.targetCellY], [1, 0]);
  assert.equal(Number.isInteger(player.x), true);
});

test("movement system never commits a blocking adjacent cell", () => {
  const world = createFlatWorld([[1, 0]]);
  addJoinedPlayer(world);
  const system = createPlayerMovementSystem({ world });
  system.initializePlayer("P1");
  for (let tick = 1; tick <= 5; tick += 1) {
    system.step(tick, new Map([["P1", { direction: "right" }]]));
  }
  const player = world.getPlayer("P1");
  assert.equal(player.px, 512);
  assert.equal(player.vx, 0);
  assert.equal(player.targetCellX, null);
  assert.deepEqual([player.x, player.y], [0, 0]);
});

test("movement system completes the committed destination after keyup", () => {
  const world = createFlatWorld();
  addJoinedPlayer(world);
  const system = createPlayerMovementSystem({ world });
  system.initializePlayer("P1");
  system.step(1, new Map([["P1", { direction: "right" }]]));
  for (let tick = 2; tick <= 7; tick += 1) {
    system.step(tick, new Map([["P1", { direction: "neutral" }]]));
  }
  const player = world.getPlayer("P1");
  assert.deepEqual(
    [player.px, player.py, player.vx, player.targetCellX, player.targetCellY],
    [1536, 512, 0, null, null],
  );
});

test("movement system commits the same bounded moving corner assist as client prediction", () => {
  const world = createFlatWorld([[2, -1]]);
  addJoinedPlayer(world);
  const system = createPlayerMovementSystem({ world });
  system.initializePlayer("P1");
  for (let tick = 1; tick <= 7; tick += 1) {
    system.step(tick, new Map([["P1", { direction: "right" }]]));
  }
  system.step(8, new Map([["P1", { direction: "up" }]]));
  const player = world.getPlayer("P1");
  assert.deepEqual(
    [player.px, player.py, player.vx, player.vy, player.targetCellX, player.targetCellY],
    [1536, 448, 0, -64, 1, -1],
  );
});

test("two players cannot commit the same destination cell", () => {
  const world = createFlatWorld();
  addJoinedPlayer(world, "P1");
  addJoinedPlayer(world, "P2");
  world.updatePlayer("P2", { x: 2, y: 0, prevX: 2, prevY: 0 });
  const system = createPlayerMovementSystem({ world });
  system.initializePlayer("P1", { resetToCell: true });
  system.initializePlayer("P2", { resetToCell: true });
  system.step(1, new Map([
    ["P1", { direction: "right" }],
    ["P2", { direction: "left" }],
  ]));
  assert.deepEqual(
    [world.getPlayer("P1").targetCellX, world.getPlayer("P2").targetCellX],
    [1, null],
  );
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
  for (let tick = 7; tick <= 20; tick += 1) {
    system.step(tick, new Map([["P1", { direction: "left", actions: [] }]]));
  }
  const player = world.getPlayer("P1");
  assert.equal(player.px, 1536);
  assert.equal(player.vx, 0);
});

for (const [type, field] of [["bomb", "power"], ["shield", "shield"], ["flame", "range"], ["speed", "speedLevel"]]) {
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
    assert.equal(world.getPlayer("P1")[field], (before ?? 0) + 1);
    assert.equal(world.getItemAt(1, 0), null);
    assert.equal(collected.item.id, "DROP");
  });
}

test("speedLevel zero cruises near three tiles per second and each item adds half", () => {
  function cruiseDistance(speedLevel) {
    const world = createFlatWorld();
    addJoinedPlayer(world);
    world.updatePlayer("P1", { speedLevel });
    const system = createPlayerMovementSystem({ world });
    system.initializePlayer("P1");
    for (let tick = 1; tick <= 10; tick += 1) {
      system.step(tick, new Map([["P1", { direction: "right", actions: [] }]]));
    }
    const start = world.getPlayer("P1").px;
    for (let tick = 11; tick <= 40; tick += 1) {
      system.step(tick, new Map([["P1", { direction: "right", actions: [] }]]));
    }
    return (world.getPlayer("P1").px - start) / 1024;
  }

  assert.ok(Math.abs(cruiseDistance(0) - 3) < 0.02);
  assert.ok(Math.abs(cruiseDistance(1) - 3.5) < 0.02);
});

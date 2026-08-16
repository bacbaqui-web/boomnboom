import assert from "node:assert/strict";
import test from "node:test";
import { findSpawn } from "../src/world/spawn-finder.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

test("spawn search never mutates existing terrain or chunk revisions", () => {
  const world = createWorldOwner();
  world.materializeAround(1, 1, 2);
  const before = new Map(
    world.readMaterializedChunkKeys().map((key) => {
      const [chunkX, chunkY] = key.split(",").map(Number);
      return [key, world.readChunkSnapshot(chunkX, chunkY)];
    }),
  );

  const [x, y] = findSpawn({
    world,
    players: [],
    bombs: [],
    spawnNumber: 1,
    isAI: true,
  });
  assert.equal(world.readTile(x, y), "floor");
  for (const [key, snapshot] of before) {
    const [chunkX, chunkY] = key.split(",").map(Number);
    const after = world.readChunkSnapshot(chunkX, chunkY);
    assert.equal(after.revision, snapshot.revision);
    assert.deepEqual(after.tiles, snapshot.tiles);
  }
});

test("human and AI spawns stay near an active human while preserving safe spacing", () => {
  const world = { readTile: () => "floor" };
  const players = [
    { id: "BOT-1", x: 0, y: 0, isAI: true, joined: true, alive: true },
    { id: "P1", x: 100, y: 50, isAI: false, joined: true, alive: true },
  ];

  for (const isAI of [false, true]) {
    const [x, y] = findSpawn({ world, players, spawnNumber: 2, isAI });
    const distanceFromHuman = Math.hypot(x - 100, y - 50);
    const manhattanFromHuman = Math.abs(x - 100) + Math.abs(y - 50);
    assert.ok(distanceFromHuman >= 6 && distanceFromHuman <= 13);
    assert.ok(manhattanFromHuman >= 5);
    assert.ok(Math.hypot(x, y) > 50);
  }
});

test("finite-world spawn stays inside the fixed perimeter", () => {
  const world = createWorldOwner({ worldWidth: 32, worldHeight: 32 });
  world.materializeAll();
  for (let spawnNumber = 1; spawnNumber <= 12; spawnNumber += 1) {
    const [x, y] = findSpawn({ world, spawnNumber, isAI: true });
    assert.ok(x > 0 && x < 31);
    assert.ok(y > 0 && y < 31);
    assert.equal(world.readTile(x, y), "floor");
  }
});

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

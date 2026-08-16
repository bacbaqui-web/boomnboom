import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CHUNK_SIZE } from "../src/world/coordinates.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

test("a chunk is materialized once while resident", () => {
  const calls = new Map();
  const generate = ({ chunkX, chunkY, chunkSize }) => {
    const key = `${chunkX},${chunkY}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
    return new Array(chunkSize * chunkSize).fill("floor");
  };
  const world = createWorldOwner({ generateChunk: generate });
  world.readTerrainTile(1, 1);
  world.readTerrainTile(15, 15);
  world.readChunkSnapshot(0, 0);
  assert.equal(calls.get("0,0"), 1);
  assert.equal(world.readMetrics().materializations, 1);
});

test("two viewers read the same canonical chunk revision", () => {
  const world = createWorldOwner();
  world.addPlayer({ id: "P1", x: 1, y: 1, alive: true });
  world.addPlayer({ id: "P2", x: 2, y: 1, alive: true });
  const firstViewer = world.readChunkSnapshot(0, 0);
  const secondViewer = world.readChunkSnapshot(0, 0);
  assert.equal(firstViewer.revision, secondViewer.revision);
  assert.deepEqual(firstViewer.tiles, secondViewer.tiles);

  world.updatePlayer("P1", { x: 2, y: 1 });
  world.materializeAround(2, 1, 2);
  assert.equal(world.readChunkSnapshot(0, 0).revision, firstViewer.revision);

  const crateIndex = firstViewer.tiles.indexOf("crate");
  assert.notEqual(crateIndex, -1);
  const x = crateIndex % DEFAULT_CHUNK_SIZE;
  const y = Math.floor(crateIndex / DEFAULT_CHUNK_SIZE);
  world.destroyCrate(x, y);
  const changed = world.readChunkSnapshot(0, 0);
  assert.equal(changed.revision, firstViewer.revision + 1);
});

test("destroyed crates publish one mutation and restore through a warning tile", () => {
  const world = createWorldOwner({
    generateChunk: ({ chunkSize }) => new Array(chunkSize * chunkSize).fill("crate"),
  });
  assert.equal(world.destroyCrate(2, 3), true);
  assert.deepEqual(world.drainDestroyedCrates(), [{ x: 2, y: 3 }]);
  assert.deepEqual(world.drainDestroyedCrates(), []);
  assert.equal(world.markCrateRespawnWarning(2, 3), true);
  assert.equal(world.readTerrainTile(2, 3), "crate_warning");
  assert.equal(world.hasCrate(2, 3), false);
  assert.equal(world.restoreCrate(2, 3), true);
  assert.equal(world.readTerrainTile(2, 3), "crate");
});

test("world metrics expose bounded chunk and entity categories", () => {
  const world = createWorldOwner({
    generateChunk: ({ chunkSize }) => new Array(chunkSize * chunkSize).fill("floor"),
  });
  world.addPlayer({ id: "P1", x: 1, y: 1, alive: true, isAI: false });
  world.addPlayer({ id: "BOT-1", x: 1, y: 1, alive: false, isAI: true });
  world.materializeAround(1, 1, 2);
  world.readChunkSnapshot(10, 10);
  world.addBomb({ id: 1, x: 1, y: 1 });
  world.setItem({ x: 2, y: 1, type: "shield" });
  world.replaceFlames([{ x: 1, y: 2 }]);

  const metrics = world.readMetrics();
  assert.equal(metrics.chunks, 26);
  assert.equal(metrics.activeChunks, 25);
  assert.equal(metrics.pinnedChunks, 1);
  assert.equal(metrics.retainedChunks, 1);
  assert.equal(metrics.players, 2);
  assert.equal(metrics.humans, 1);
  assert.equal(metrics.bots, 1);
  assert.equal(metrics.entities, 5);
});

test("item metadata updates only the item at the addressed cell", () => {
  const world = createWorldOwner({
    generateChunk: ({ chunkSize }) => new Array(chunkSize * chunkSize).fill("floor"),
  });
  world.setItem({ id: "A", x: 1, y: 1, type: "bomb" });
  world.setItem({ id: "B", x: 2, y: 1, type: "shield" });
  assert.equal(world.updateItemAt(1, 1, { expireTick: 300 }), true);
  assert.equal(world.getItemAt(1, 1).expireTick, 300);
  assert.equal(world.getItemAt(2, 1).expireTick, undefined);
  assert.equal(world.updateItemAt(9, 9, { expireTick: 300 }), false);
});

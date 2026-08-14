import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CHUNK_SIZE,
  worldToChunk,
} from "../src/world/coordinates.mjs";
import {
  baseTileAt,
  generateChunk,
} from "../src/world/chunk-generator.mjs";
import { findSpawn } from "../src/world/spawn.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

test("world coordinates round-trip across negative chunk boundaries", () => {
  for (const coordinate of [-33, -32, -17, -16, -1, 0, 1, 15, 16, 31, 32]) {
    const result = worldToChunk(coordinate, coordinate, DEFAULT_CHUNK_SIZE);
    assert.equal(result.chunkX * DEFAULT_CHUNK_SIZE + result.localX, coordinate);
    assert.equal(result.chunkY * DEFAULT_CHUNK_SIZE + result.localY, coordinate);
    assert.ok(result.localX >= 0 && result.localX < DEFAULT_CHUNK_SIZE);
    assert.ok(result.localY >= 0 && result.localY < DEFAULT_CHUNK_SIZE);
  }
});

test("chunk generation is deterministic and has no chunk-edge empty strip", () => {
  const first = generateChunk({ chunkX: -1, chunkY: 2 });
  const second = generateChunk({ chunkX: -1, chunkY: 2 });
  assert.deepEqual(first, second);

  for (const boundaryX of [-32, -16, 0, 16, 32]) {
    let cratesAcrossBoundary = 0;
    for (let y = -64; y < 64; y += 1) {
      for (const x of [boundaryX - 1, boundaryX]) {
        if (baseTileAt(x, y) === "crate") cratesAcrossBoundary += 1;
      }
    }
    assert.ok(cratesAcrossBoundary > 0, `boundary ${boundaryX} became an empty strip`);
  }
});

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
  world.destroyCrate(x, y, 20);
  const changed = world.readChunkSnapshot(0, 0);
  assert.equal(changed.revision, firstViewer.revision + 1);
});

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

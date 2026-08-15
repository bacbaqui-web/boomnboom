import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CHUNK_SIZE, worldToChunk } from "../src/world/coordinates.mjs";

test("world coordinates round-trip across negative chunk boundaries", () => {
  for (const coordinate of [-33, -32, -17, -16, -1, 0, 1, 15, 16, 31, 32]) {
    const result = worldToChunk(coordinate, coordinate, DEFAULT_CHUNK_SIZE);
    assert.equal(result.chunkX * DEFAULT_CHUNK_SIZE + result.localX, coordinate);
    assert.equal(result.chunkY * DEFAULT_CHUNK_SIZE + result.localY, coordinate);
    assert.ok(result.localX >= 0 && result.localX < DEFAULT_CHUNK_SIZE);
    assert.ok(result.localY >= 0 && result.localY < DEFAULT_CHUNK_SIZE);
  }
});

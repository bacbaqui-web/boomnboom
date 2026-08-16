import assert from "node:assert/strict";
import test from "node:test";
import { chunkInterestForPlayer } from "../src/network/chunk-interest.mjs";

test("finite world interest never requests chunks beyond the fixed map", () => {
  const metadata = { chunkSize: 16, worldWidth: 256, worldHeight: 256 };
  const corner = chunkInterestForPlayer({ x: 1, y: 1 }, 16, 2, metadata);
  assert.equal(corner.size, 9);
  assert.ok([...corner].every((key) => !key.startsWith("-") && !key.includes(",-")));

  const center = chunkInterestForPlayer({ x: 128, y: 128 }, 16, 2, metadata);
  assert.equal(center.size, 25);
});

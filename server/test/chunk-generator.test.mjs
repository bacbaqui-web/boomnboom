import assert from "node:assert/strict";
import test from "node:test";
import { baseTileAt, generateChunk } from "../src/world/chunk-generator.mjs";

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

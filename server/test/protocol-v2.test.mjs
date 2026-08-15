import assert from "node:assert/strict";
import test from "node:test";
import {
  diffChunkSnapshots,
  validateV2ClientMessage,
} from "../src/network/protocol-v2.mjs";

test("Protocol V2 rejects malformed, unsupported, and invalid-schema messages", () => {
  assert.equal(validateV2ClientMessage("{").error.code, "malformed_json");
  assert.equal(
    validateV2ClientMessage({ protocol: 1, type: "join", nickname: "P1" }).error.code,
    "unsupported_protocol",
  );
  assert.equal(
    validateV2ClientMessage({ protocol: 2, type: "input", clientSeq: 1, action: "warp" })
      .error.code,
    "invalid_action",
  );
  assert.equal(
    validateV2ClientMessage({ protocol: 2, type: "chunk_resync", chunkKey: "bad" }).error
      .code,
    "invalid_chunk_key",
  );
  assert.equal(
    validateV2ClientMessage({
      protocol: 2,
      type: "ready",
      knownChunkRevisions: { bad: 1 },
    }).error.code,
    "invalid_revisions",
  );
});

test("chunk delta carries the exact revision gap and changed cells", () => {
  const before = {
    key: "-1,2",
    revision: 4,
    tiles: ["floor", "crate", "floor"],
    respawns: [],
  };
  const after = {
    key: "-1,2",
    revision: 5,
    tiles: ["floor", "floor", "floor"],
    respawns: [{ index: 1, x: -15, y: 32, respawnTick: 10, committed: false }],
  };
  assert.deepEqual(diffChunkSnapshots(before, after), {
    chunkKey: "-1,2",
    fromRevision: 4,
    revision: 5,
    changes: [{ index: 1, tile: "floor" }],
    respawnChanges: [
      { index: 1, x: -15, y: 32, respawnTick: 10, committed: false },
    ],
    removedRespawnIndexes: [],
  });
});

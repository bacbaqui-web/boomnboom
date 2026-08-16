import assert from "node:assert/strict";
import test from "node:test";
import {
  botProfile,
  readBotProfiles,
  shouldUseImperfectMove,
} from "../src/ai/bot-personality.mjs";

test("bot profiles cycle deterministically across the six AI players", () => {
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => botProfile(`BOT-${index + 1}`).id),
    ["rookie", "balanced", "hunter", "rookie", "balanced", "hunter"],
  );
  assert.equal(readBotProfiles().length, 3);
});

test("imperfect movement is deterministic and never random process state", () => {
  const first = Array.from({ length: 20 }, (_, index) =>
    shouldUseImperfectMove("BOT-1", index, 5),
  );
  const second = Array.from({ length: 20 }, (_, index) =>
    shouldUseImperfectMove("BOT-1", index, 5),
  );
  assert.deepEqual(first, second);
  assert.ok(first.some(Boolean));
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_DROP_ITEM_TYPES,
  itemStatUpdate,
} from "../src/simulation/item-rules.mjs";

test("AI drops include speed and every item changes only its owned stat", () => {
  assert.deepEqual(AI_DROP_ITEM_TYPES, ["bomb", "shield", "flame", "speed"]);
  const player = { power: 1, shield: 0, range: 2, speedLevel: 0 };
  assert.deepEqual(itemStatUpdate(player, "bomb"), { power: 2 });
  assert.deepEqual(itemStatUpdate(player, "shield"), { shield: 1 });
  assert.deepEqual(itemStatUpdate(player, "flame"), { range: 3 });
  assert.deepEqual(itemStatUpdate(player, "speed"), { speedLevel: 1 });
  assert.equal(itemStatUpdate(player, "unknown"), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HUMAN_PLAYER_COLOR,
  HUMAN_PLAYER_COLORS,
  isHumanPlayerColor,
  normalizeHumanPlayerColor,
} from "../shared/player-colors.mjs";

test("human palette exposes eight non-AI colors and defaults safely", () => {
  assert.equal(HUMAN_PLAYER_COLORS.length, 8);
  assert.equal(new Set(HUMAN_PLAYER_COLORS.map((color) => color.id)).size, 8);
  assert.equal(HUMAN_PLAYER_COLORS.some((color) => color.id === "ai-red"), false);
  assert.equal(isHumanPlayerColor("purple"), true);
  assert.equal(isHumanPlayerColor("ai-red"), false);
  assert.equal(normalizeHumanPlayerColor("purple"), "purple");
  assert.equal(normalizeHumanPlayerColor("red"), DEFAULT_HUMAN_PLAYER_COLOR);
});

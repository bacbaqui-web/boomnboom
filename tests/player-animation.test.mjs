import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PLAYER_JUMP_DURATION_MS,
  PLAYER_JUMP_HEIGHT_PX,
  PLAYER_JUMP_KEYFRAMES,
} from "../app/game/player-animation.ts";

test("player motion keeps the requested floor-anchored squash and jump poses", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /transform-origin:\s*50% 100%/);
  assert.match(css, /fighterIdleSquash 500ms/);
  assert.match(css, /scale\(1\.02, 0\.98\)/);
  assert.match(css, /scale\(0\.98, 1\.02\)/);
  assert.equal(PLAYER_JUMP_DURATION_MS, 175);
  assert.equal(PLAYER_JUMP_HEIGHT_PX, 10);
  assert.deepEqual(PLAYER_JUMP_KEYFRAMES, [
    { offset: 0, transform: "translateY(0px) scale(1.05, 0.9)" },
    { offset: 0.5, transform: "translateY(-10px) scale(0.9, 1.05)" },
    { offset: 0.8, transform: "translateY(0px) scale(1.05, 0.9)" },
    { offset: 1, transform: "translateY(0px) scale(1.05, 0.9)" },
  ]);
});

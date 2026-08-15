import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PLAYER_JUMP_HEIGHT_PX,
  crossedAdjacentCell,
  playerCell,
  playerTravelPose,
} from "../app/game/player-animation.ts";

test("player motion keeps the requested floor-anchored squash and jump poses", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /transform-origin:\s*50% 100%/);
  assert.match(css, /fighterIdleSquash 500ms/);
  assert.match(css, /scale\(1\.02, 0\.98\)/);
  assert.match(css, /scale\(0\.98, 1\.02\)/);
  assert.equal(PLAYER_JUMP_HEIGHT_PX, 10);
  assert.deepEqual(playerTravelPose({ x: -0.01, y: 0 }, { x: 0, y: 0 }), {
    translateY: 0,
    scaleX: 1.05,
    scaleY: 0.9,
  });
  assert.deepEqual(playerTravelPose({ x: 0.49, y: 0 }, { x: 0.5, y: 0 }), {
    translateY: -10,
    scaleX: 0.9,
    scaleY: 1.05,
  });
  assert.deepEqual(playerTravelPose({ x: 0.99, y: 0 }, { x: 1, y: 0 }), {
    translateY: 0,
    scaleX: 1.05,
    scaleY: 0.9,
  });
  assert.equal(playerTravelPose({ x: 1, y: 0 }, { x: 1, y: 0 }), null);
});

test("local step sound triggers only when an adjacent tile boundary is crossed", () => {
  assert.deepEqual(playerCell({ x: 3.49, y: -1.5 }), { x: 3, y: -1 });
  assert.deepEqual(playerCell({ x: 3.5, y: -1.51 }), { x: 4, y: -2 });
  assert.equal(crossedAdjacentCell({ x: 3, y: 2 }, { x: 4, y: 2 }), true);
  assert.equal(crossedAdjacentCell({ x: 3, y: 2 }, { x: 5, y: 2 }), false);
  assert.equal(crossedAdjacentCell(null, { x: 4, y: 2 }), false);
});

test("death motion bursts from the hit position before the avatar disappears", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.fighter\.dying\s*\{[^}]*fighterDeath 650ms/);
  assert.match(css, /@keyframes fighterDeath/);
  assert.match(css, /translateY\(-10px\)/);
  assert.match(css, /scale\(0\.08\)/);
  assert.match(css, /@keyframes deathRing/);
  assert.match(css, /@keyframes deathSpark/);
});

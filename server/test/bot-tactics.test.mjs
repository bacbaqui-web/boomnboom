import assert from "node:assert/strict";
import test from "node:test";
import { createBotDangerMap } from "../src/ai/bot-danger-map.mjs";
import { chooseBotTactic } from "../src/ai/bot-tactics.mjs";

const PROFILE = {
  searchSteps: 10,
  maxVisited: 384,
  escapeLookaheadTicks: 105,
  bombCooldownTicks: 24,
};

function player(id, x, y, isAI = false, overrides = {}) {
  return {
    id,
    x,
    y,
    isAI,
    alive: true,
    joined: true,
    power: 1,
    range: 2,
    speedLevel: 0,
    ...overrides,
  };
}

function scenario({ bot, target, bombs = [], items = [], flames = [], walls = [], crates = [] }) {
  const wallKeys = new Set(walls.map(([x, y]) => `${x},${y}`));
  const crateKeys = new Set(crates.map(([x, y]) => `${x},${y}`));
  const terrain = {
    isPermanentWall: (x, y) => wallKeys.has(`${x},${y}`),
    hasCrate: (x, y) => crateKeys.has(`${x},${y}`),
  };
  const currentTick = 10;
  const dangerMap = createBotDangerMap({
    bombs,
    flames,
    currentTick,
    isPermanentWall: terrain.isPermanentWall,
  });
  return chooseBotTactic({
    bot,
    target,
    players: [bot, target],
    bombs,
    items,
    flames,
    currentTick,
    terrain,
    dangerMap,
    profile: PROFILE,
  });
}

test("survival overrides every objective when the current cell will explode", () => {
  const bot = player("BOT-1", 0, 0, true);
  const target = player("P1", 8, 8);
  const result = scenario({
    bot,
    target,
    bombs: [{ id: "B1", x: 0, y: 0, owner: "P1", range: 2, explodeTick: 40 }],
  });
  assert.equal(result.reason, "escape");
  assert.notEqual(result.action, "wait");
});

test("a nearby item does not distract an AI from its human target", () => {
  const bot = player("BOT-1", 0, 0, true);
  const result = scenario({
    bot,
    target: player("P1", 7, 0),
    items: [{ id: "I1", x: 1, y: 0, type: "flame" }],
  });
  assert.notEqual(result.reason, "item");
});

test("AI bombs a target or crate only when a post-placement escape exists", () => {
  const bot = player("BOT-1", 0, 0, true);
  const attack = scenario({ bot, target: player("P1", 2, 0) });
  assert.equal(attack.reason, "attack_bomb");
  assert.equal(attack.action, "bomb");

  const crate = scenario({
    bot,
    target: player("P1", 8, 8),
    crates: [[1, 0]],
  });
  assert.equal(crate.reason, "crate_bomb");
  assert.equal(crate.action, "bomb");

  const trapped = scenario({
    bot,
    target: player("P1", 1, 0),
    walls: [[-1, 0], [0, -1], [0, 1]],
  });
  assert.notEqual(trapped.action, "bomb");
});

test("pathfinding approaches an attack line around a wall", () => {
  const result = scenario({
    bot: player("BOT-1", 0, 0, true),
    target: player("P1", 3, 0),
    walls: [[1, 0]],
  });
  assert.equal(result.reason, "chase");
  assert.equal(result.action, "up");
});

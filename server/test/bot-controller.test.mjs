import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseBotIntent,
  createBotController,
} from "../src/ai/bot-controller.mjs";
import { createGameSimulation } from "../src/simulation/game-simulation.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

function floorWorld() {
  return createWorldOwner({
    generateChunk({ chunkSize }) {
      return new Array(chunkSize * chunkSize).fill("floor");
    },
  });
}

function player(id, x, y, isAI) {
  return {
    id,
    x,
    y,
    prevX: x,
    prevY: y,
    isAI,
    action: "wait",
    power: 1,
    range: 2,
    shield: 0,
    lastMoveAt: 0,
    nickname: id,
    joined: true,
    alive: true,
  };
}

test("AI returns no intent and performs no mutation when no human is alive", () => {
  const world = floorWorld();
  world.addPlayer(player("BOT-1", 1, 1, true));
  const controller = createBotController({ world });
  const before = world.getPlayer("BOT-1");

  assert.deepEqual(controller.decideAll(), []);
  assert.deepEqual(world.getPlayer("BOT-1"), before);
  assert.equal(world.readMetrics().chunks, 0);
});

test("AI chooses an intent from a read snapshot and uses the shared action command", () => {
  const world = floorWorld();
  world.addPlayer(player("BOT-1", 1, 1, true));
  world.addPlayer(player("P1", 2, 1, false));
  const controller = createBotController({ world });
  const simulation = createGameSimulation({ world, initialTick: 7 });

  const [intent] = controller.decideAll();
  assert.deepEqual(intent, { botId: "BOT-1", action: "bomb" });
  const result = simulation.applyAction(intent.botId, intent.action, { now: 1000 });
  assert.equal(result.changed, true);
  assert.equal(world.readBombs()[0].owner, "BOT-1");
  assert.equal(world.readBombs()[0].bornTick, 7);
});

test("nearest-human heuristic preserves the current preferred direction", () => {
  const intent = chooseBotIntent({
    bot: player("BOT-1", 0, 0, true),
    players: [player("BOT-1", 0, 0, true), player("P1", 5, 2, false)],
    bombs: [],
    isBlocked: () => false,
  });
  assert.equal(intent, "right");
});

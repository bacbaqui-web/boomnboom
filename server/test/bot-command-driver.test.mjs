import assert from "node:assert/strict";
import test from "node:test";
import { createBotCommandDriver } from "../src/ai/bot-command-driver.mjs";
import { createPlayerCommandBuffer } from "../src/simulation/player-command-buffer.mjs";
import { createPlayerMovementSystem } from "../src/simulation/player-movement-system.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

function floorWorld() {
  return createWorldOwner({
    generateChunk({ chunkSize }) {
      return new Array(chunkSize * chunkSize).fill("floor");
    },
  });
}

test("bot directions enter the same fixed-tick command stream as players", () => {
  const commandBuffer = createPlayerCommandBuffer();
  let tick = 10;
  const driver = createBotCommandDriver({
    commandBuffer,
    currentTick: () => tick,
  });
  driver.registerPlayer("BOT-1");

  assert.deepEqual(driver.apply([{ botId: "BOT-1", action: "right" }]), {
    accepted: 1,
    targetTick: 11,
  });
  assert.equal(commandBuffer.consumeTick(10).get("BOT-1").direction, "neutral");
  assert.equal(commandBuffer.consumeTick(11).get("BOT-1").direction, "right");

  tick = 12;
  driver.apply([]);
  assert.equal(commandBuffer.consumeTick(13).get("BOT-1").direction, "neutral");
});

test("a bot bomb decision stops movement and queues an authority action together", () => {
  const commandBuffer = createPlayerCommandBuffer();
  const driver = createBotCommandDriver({
    commandBuffer,
    currentTick: () => 20,
  });
  driver.registerPlayer("BOT-1");

  assert.deepEqual(driver.apply([{ botId: "BOT-1", action: "bomb" }]), {
    accepted: 2,
    targetTick: 21,
  });
  const commands = commandBuffer.consumeTick(21).get("BOT-1");
  assert.equal(commands.direction, "neutral");
  assert.deepEqual(commands.actions, [
    { commandSeq: 1, targetTick: 21, action: "bomb" },
  ]);
});

test("bot movement advances by fixed-point sub-tile steps instead of teleporting a cell", () => {
  const world = floorWorld();
  world.addPlayer({
    id: "BOT-1",
    x: 1,
    y: 1,
    isAI: true,
    joined: true,
    alive: true,
    action: "wait",
    power: 1,
    range: 2,
    shield: 0,
    nickname: "BOT-1",
  });
  const commandBuffer = createPlayerCommandBuffer();
  const movementSystem = createPlayerMovementSystem({ world });
  const driver = createBotCommandDriver({
    commandBuffer,
    currentTick: () => 10,
  });
  driver.registerPlayer("BOT-1");
  movementSystem.initializePlayer("BOT-1", { resetToCell: true });

  driver.apply([{ botId: "BOT-1", action: "right" }]);
  movementSystem.step(11, commandBuffer.consumeTick(11));
  const bot = world.getPlayer("BOT-1");
  assert.equal(bot.x, 1);
  assert.ok(bot.px > 1.5 * 1024);
  assert.ok(bot.px < 2.5 * 1024);
});

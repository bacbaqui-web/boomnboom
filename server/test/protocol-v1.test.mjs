import assert from "node:assert/strict";
import test from "node:test";
import { createV1StateSerializer } from "../src/network/protocol-v1.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

test("V1 serializer preserves the public state shape", () => {
  const world = createWorldOwner();
  world.addPlayer({
    id: "P1",
    x: 1,
    y: 1,
    prevX: 1,
    prevY: 1,
    isAI: false,
    action: "wait",
    score: 0,
    power: 1,
    range: 2,
    shield: 0,
    nickname: "테스터",
    joined: true,
    alive: true,
  });
  world.addPlayer({
    id: "BOT-1",
    x: 100,
    y: 100,
    prevX: 100,
    prevY: 100,
    isAI: true,
    action: "wait",
    score: 0,
    power: 1,
    range: 2,
    shield: 0,
    nickname: "AI",
    joined: true,
    alive: true,
  });
  world.addBomb({ id: 1, x: 1, y: 1, owner: "P1", fuse: 3, bornTick: 10, range: 2 });
  world.setItem({ x: 2, y: 1, type: "shield" });
  world.replaceFlames([{ x: 1, y: 2 }]);

  const serializer = createV1StateSerializer({
    world,
    worldEpochMs: 1000,
    bgmDurationMs: 200000,
    bgmSnareOffsetMs: 255,
  });
  const state = serializer.stateFor("P1", {
    tick: 10,
    frame: 3,
    nextTickAt: 12000,
    serverNow: 11500,
  });

  assert.deepEqual(Object.keys(state).sort(), [
    "bgmDurationMs",
    "bgmSnareOffsetMs",
    "bombs",
    "cameraDx",
    "cameraDy",
    "cameraOffsetX",
    "cameraOffsetY",
    "enemyDirections",
    "flames",
    "frame",
    "height",
    "items",
    "nextTickAt",
    "nextTickInMs",
    "originX",
    "originY",
    "players",
    "serverNow",
    "tick",
    "tiles",
    "type",
    "viewHeight",
    "viewWidth",
    "width",
    "worldEpochMs",
    "worldX",
    "worldY",
  ].sort());
  assert.equal(state.type, "state");
  assert.equal(state.tiles.length, 19);
  assert.ok(state.tiles.every((row) => row.length === 23));
  assert.equal(state.players.find((player) => player.id === "P1")?.nickname, "테스터");
  assert.equal(state.bombs.length, 1);
  assert.equal(state.items.length, 1);
  assert.equal(state.flames.length, 1);
  assert.equal(state.enemyDirections[0]?.id, "BOT-1");
  assert.equal(state.nextTickInMs, 500);
});

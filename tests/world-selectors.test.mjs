import assert from "node:assert/strict";
import test from "node:test";
import { entityKey } from "../app/game/protocol.ts";
import { canEnterWorldCell } from "../app/game/world-selectors.ts";
import { createWorldRuntimeState } from "../app/game/world-state.ts";

test("cell selector refuses terrain, bombs, and other players", () => {
  const state = createWorldRuntimeState();
  state.snapshot.metadata = {
    worldId: "WORLD-A",
    seed: 1,
    generatorVersion: "v1",
    chunkSize: 16,
    preloadRadius: 2,
    visibleWidth: 15,
    visibleHeight: 11,
    tickMs: 1000,
    worldEpochMs: 0,
    bgmDurationMs: 200000,
    bgmSnareOffsetMs: 255,
  };
  state.snapshot.localPlayerId = "P1";
  state.chunks.set("0,0", {
    chunkKey: "0,0",
    chunkX: 0,
    chunkY: 0,
    originX: 0,
    originY: 0,
    revision: 1,
    tiles: ["wall", ...new Array(255).fill("floor")],
  });
  const rival = {
    kind: "player",
    id: "P2",
    x: 2,
    y: 1,
    isAI: false,
    action: "wait",
    score: 0,
    power: 1,
    range: 2,
    shield: 0,
    nickname: "P2",
    joined: true,
    alive: true,
  };
  const bomb = {
    kind: "bomb",
    id: 1,
    x: 3,
    y: 1,
    owner: "P2",
    fuse: 3,
    bornTick: 0,
    range: 2,
  };
  state.entities.set(entityKey(rival), rival);
  state.entities.set(entityKey(bomb), bomb);

  assert.equal(canEnterWorldCell(state, 0, 0), false);
  assert.equal(canEnterWorldCell(state, 1, 1), true);
  assert.equal(canEnterWorldCell(state, 2, 1), false);
  assert.equal(canEnterWorldCell(state, 3, 1), false);
  assert.equal(canEnterWorldCell(state, -1, -1), false);
});

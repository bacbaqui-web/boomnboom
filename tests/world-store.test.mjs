import assert from "node:assert/strict";
import test from "node:test";
import { ClientWorldStore } from "../app/game/world-store.ts";

function message(type, payload = {}, worldTick = 1) {
  return { protocol: 2, type, serverTime: 1000, worldTick, ...payload };
}

function initialize(store, worldId = "WORLD-A") {
  store.apply(message("world_init", {
    worldId,
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
    player: {
      kind: "player",
      id: "P1",
      x: 1,
      y: 1,
      isAI: false,
      action: "wait",
      score: 0,
      power: 1,
      range: 2,
      shield: 0,
      nickname: "P1",
      joined: true,
      alive: true,
    },
  }));
}

function chunkSnapshot(revision = 1, tile = "crate") {
  return message("chunk_snapshot", {
    chunkKey: "0,0",
    chunkX: 0,
    chunkY: 0,
    originX: 0,
    originY: 0,
    revision,
    tiles: [tile, ...new Array(255).fill("floor")],
    respawns: [],
  });
}

test("World Store applies snapshot and matching delta but requests resync on a gap", () => {
  const store = new ClientWorldStore();
  initialize(store);
  assert.equal(store.apply(chunkSnapshot()).applied, true);
  store.apply(message("entity_snapshot", {
    entityRevision: 1,
    players: [], bombs: [], items: [], flames: [], enemies: [],
  }));

  const applied = store.apply(message("chunk_delta", {
    chunkKey: "0,0",
    fromRevision: 1,
    revision: 2,
    changes: [{ index: 0, tile: "floor" }],
    respawnChanges: [{ index: 0, x: 0, y: 0, respawnTick: 10, committed: true }],
    removedRespawnIndexes: [],
  }));
  assert.deepEqual(applied, { applied: true });
  assert.equal(store.getChunk("0,0").revision, 2);
  assert.equal(store.getChunk("0,0").tiles[0], "floor");
  assert.equal(store.getChunk("0,0").respawns[0].committed, true);

  const gap = store.apply(message("chunk_delta", {
    chunkKey: "0,0",
    fromRevision: 3,
    revision: 4,
    changes: [],
  }));
  assert.deepEqual(gap, {
    applied: false,
    reason: "chunk_gap",
    chunkKey: "0,0",
    revision: 2,
  });
});

test("stale chunk and entity deltas are discarded", () => {
  const store = new ClientWorldStore();
  initialize(store);
  store.apply(chunkSnapshot(2, "floor"));
  store.apply(message("entity_snapshot", {
    entityRevision: 5,
    players: [], bombs: [], items: [], flames: [], enemies: [],
  }));
  assert.equal(store.apply(message("chunk_delta", {
    chunkKey: "0,0",
    fromRevision: 1,
    revision: 2,
    changes: [{ index: 0, tile: "wall" }],
  })).reason, "stale");
  assert.equal(store.apply(message("entity_delta", {
    entityRevision: 4,
    created: [{ kind: "item", id: "1,1", x: 1, y: 1, type: "bomb" }],
    updated: [], removed: [],
  })).reason, "stale");
  assert.equal(store.getEntitySnapshot().entities.length, 0);
});

test("only the changed chunk selector is notified", () => {
  const store = new ClientWorldStore();
  initialize(store);
  store.apply(chunkSnapshot());
  store.apply(message("chunk_snapshot", {
    ...chunkSnapshot(),
    chunkKey: "1,0",
    chunkX: 1,
    originX: 16,
  }));
  store.apply(message("entity_snapshot", {
    entityRevision: 1,
    players: [], bombs: [], items: [], flames: [], enemies: [],
  }));
  let first = 0;
  let second = 0;
  store.subscribeChunk("0,0", () => first += 1);
  store.subscribeChunk("1,0", () => second += 1);
  store.apply(message("entity_delta", {
    entityRevision: 2,
    created: [{ kind: "item", id: "2,2", x: 2, y: 2, type: "shield" }],
    updated: [],
    removed: [],
  }));
  store.apply(message("world_heartbeat", { nextTickAt: 2000 }, 2));
  assert.deepEqual([first, second], [0, 0]);
  store.apply(message("chunk_delta", {
    chunkKey: "0,0",
    fromRevision: 1,
    revision: 2,
    changes: [{ index: 0, tile: "floor" }],
    respawnChanges: [], removedRespawnIndexes: [],
  }));
  assert.equal(first, 1);
  assert.equal(second, 0);
});

test("reconnect validates world identity and authoritative initial revisions", () => {
  const store = new ClientWorldStore();
  initialize(store, "WORLD-A");
  store.apply(chunkSnapshot(3, "floor"));
  store.apply(message("chunk_snapshot", {
    ...chunkSnapshot(2, "floor"),
    chunkKey: "1,0",
    chunkX: 1,
    originX: 16,
  }));
  store.apply(message("entity_snapshot", {
    entityRevision: 3,
    players: [], bombs: [], items: [], flames: [], enemies: [],
  }));

  initialize(store, "WORLD-A");
  store.apply(chunkSnapshot(1, "crate"));
  store.apply(message("entity_snapshot", {
    entityRevision: 1,
    players: [], bombs: [], items: [], flames: [], enemies: [],
  }));
  assert.equal(store.getChunk("0,0").revision, 1);
  assert.equal(store.getChunk("0,0").tiles[0], "crate");
  assert.equal(store.getChunk("1,0"), null);

  initialize(store, "WORLD-B");
  assert.equal(store.getChunk("0,0"), null);
  assert.deepEqual(store.getSnapshot().chunkKeys, []);
});

test("client prediction refuses terrain, bombs, and other players", () => {
  const store = new ClientWorldStore();
  initialize(store);
  store.apply(chunkSnapshot(1, "wall"));
  store.apply(message("entity_snapshot", {
    entityRevision: 1,
    players: [{
      kind: "player", id: "P2", x: 2, y: 1, isAI: false, action: "wait",
      score: 0, power: 1, range: 2, shield: 0, nickname: "P2", joined: true, alive: true,
    }],
    bombs: [{ kind: "bomb", id: 1, x: 3, y: 1, owner: "P2", fuse: 3, bornTick: 0, range: 2 }],
    items: [], flames: [], enemies: [],
  }));
  assert.equal(store.canEnterCell(0, 0), false);
  assert.equal(store.canEnterCell(1, 1), true);
  assert.equal(store.canEnterCell(2, 1), false);
  assert.equal(store.canEnterCell(3, 1), false);
  assert.equal(store.canEnterCell(-1, -1), false);
});

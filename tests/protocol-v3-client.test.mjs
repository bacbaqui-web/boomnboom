import assert from "node:assert/strict";
import test from "node:test";
import {
  parseV3ServerMessage,
  projectV3StoreMessage,
} from "../app/game/protocol-v3.ts";
import { ClientWorldStore } from "../app/game/world-store.ts";

function message(type, payload = {}) {
  return { protocol: 3, type, serverTick: 5, serverTimeMs: 1000, worldTick: 1, ...payload };
}

function sample(overrides = {}) {
  return {
    id: "P1", px: 1536, py: -512, vx: 64, vy: 0, direction: "right",
    x: 999, y: 999, alive: true, joined: true, isAI: false, nickname: "P1",
    power: 1, range: 2, shield: 0, lifeId: 1, teleport: false, ...overrides,
  };
}

function initializedStore() {
  const store = new ClientWorldStore();
  store.apply(projectV3StoreMessage(message("world_init", {
    worldId: "WORLD", playerId: "P1", baselineTick: 5, chunkSize: 16,
  })));
  return store;
}

test("V3 world init presents the one-tile starting bomb range before the first snapshot", () => {
  const projected = projectV3StoreMessage(message("world_init", {
    worldId: "WORLD", playerId: "P1", baselineTick: 5, chunkSize: 16,
  }));
  assert.equal(projected.player.range, 1);
});

test("V3 player projection keeps fixed fields while terrain coordinates stay integer cells", () => {
  const store = initializedStore();
  store.apply(projectV3StoreMessage(message("owner_snapshot", {
    snapshotSeq: 7,
    lastProcessedCommandSeq: 2,
    player: sample(),
  })));
  const player = store.getEntitySnapshot().entities.find((entity) => entity.kind === "player");
  assert.deepEqual([player.x, player.y], [1, -1]);
  assert.deepEqual([player.px, player.py, player.vx], [1536, -512, 64]);
});

test("V3 player projection preserves the authoritative speed item level", () => {
  const store = initializedStore();
  store.apply(projectV3StoreMessage(message("owner_snapshot", {
    snapshotSeq: 8,
    lastProcessedCommandSeq: 2,
    player: sample({ speedLevel: 3 }),
  })));
  const player = store.getEntitySnapshot().entities.find((entity) => entity.kind === "player");
  assert.equal(player.speedLevel, 3);
});

test("owner/entity snapshots use independent sequence domains in either arrival order", () => {
  for (const order of ["owner-first", "entity-first"]) {
    const store = initializedStore();
    const owner = projectV3StoreMessage(message("owner_snapshot", {
      snapshotSeq: 9,
      lastProcessedCommandSeq: 1,
      player: sample(),
    }));
    const entities = projectV3StoreMessage(message("entity_snapshot", {
      snapshotSeq: 9,
      players: [sample({ px: 512, vx: 0 })],
    }));
    const sequence = order === "owner-first" ? [owner, entities] : [entities, owner];
    assert.equal(store.apply(sequence[0]).applied, true);
    assert.equal(store.apply(sequence[1]).applied, true);
    const local = store.getEntitySnapshot().entities.find(
      (entity) => entity.kind === "player" && entity.id === "P1",
    );
    assert.equal(local.px, 1536);
    assert.equal(store.apply(owner).applied, false);
  }
});

test("V3 parser rejects malformed envelopes", () => {
  assert.equal(parseV3ServerMessage("{"), null);
  assert.equal(parseV3ServerMessage(JSON.stringify({ protocol: 2, type: "hello" })), null);
  assert.equal(parseV3ServerMessage(JSON.stringify(message("hello"))).protocol, 3);
});

test("V3 entity snapshot projects bombs, items, and flames into authoritative store entities", () => {
  const store = initializedStore();
  store.apply(projectV3StoreMessage(message("entity_snapshot", {
    snapshotSeq: 1,
    players: [sample()],
    bombs: [{ id: "V3-B1", x: 1, y: 0, owner: "P1", fuse: 3, bornTick: 5, range: 2 }],
    items: [{ id: "I1", x: 2, y: 0, type: "shield" }],
    flames: [{ id: "F1", x: 3, y: 0 }],
  })));
  assert.deepEqual(
    store.getEntitySnapshot().entities.map((entity) => entity.kind).sort(),
    ["bomb", "flame", "item", "player"],
  );
});

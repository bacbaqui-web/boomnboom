import assert from "node:assert/strict";
import test from "node:test";
import { createEntitySnapshotPublisher } from "../src/network/entity-snapshot-publisher.mjs";
import { createPlayerCommandBuffer } from "../src/simulation/player-command-buffer.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

test("entity snapshot publisher sends zero frames without a ready V3 client", () => {
  const world = createWorldOwner();
  const commandBuffer = createPlayerCommandBuffer();
  let sends = 0;
  const publisher = createEntitySnapshotPublisher({
    world,
    sessions: new Map(),
    commandBuffer,
    send: () => { sends += 1; },
  });
  assert.equal(publisher.publish(2), 0);
  assert.equal(sends, 0);
  assert.equal(publisher.readMetrics().publishedSnapshots, 0);
});

test("entity snapshot includes exact fixed bomb, item, and flame state", () => {
  const world = createWorldOwner({
    generateChunk: ({ chunkSize }) => new Array(chunkSize * chunkSize).fill("floor"),
  });
  world.addPlayer({
    id: "P1", x: 0, y: 0, joined: true, alive: true, isAI: false,
    action: "wait", nickname: "P1", power: 1, range: 2, shield: 0, speedLevel: 2,
    targetCellX: 1, targetCellY: 0,
  });
  world.addBomb({
    id: "V3-B1", x: 0, y: 0, owner: "P1", range: 2, fuse: 3,
    bornTick: 10, spawnTick: 10, explodeTick: 100, clockDomain: "v3",
  });
  world.setItem({ id: "I1", x: 1, y: 0, type: "shield" });
  world.replaceFlamesForDomain("v3", [{
    id: "F1", x: 2, y: 0, clockDomain: "v3", eventSeq: 0,
    startTick: 10, expireTick: 25,
  }]);
  const commandBuffer = createPlayerCommandBuffer();
  commandBuffer.registerPlayer("P1");
  const sent = [];
  const session = { playerId: "P1", ready: true, snapshotSeq: 0xffff_ffff };
  const publisher = createEntitySnapshotPublisher({
    world,
    sessions: new Map([["P1", session]]),
    commandBuffer,
    send: (_session, type, payload) => sent.push({ type, ...payload }),
  });
  publisher.publish(40);
  const owner = sent.find((message) => message.type === "owner_snapshot");
  const entities = sent.find((message) => message.type === "entity_snapshot");
  assert.deepEqual(
    [owner.player.targetCellX, owner.player.targetCellY],
    [1, 0],
  );
  assert.deepEqual(
    [entities.players[0].targetCellX, entities.players[0].targetCellY],
    [1, 0],
  );
  assert.equal(owner.player.speedLevel, 2);
  assert.equal(entities.players[0].speedLevel, 2);
  assert.equal(entities.bombs[0].fuse, 2);
  assert.equal(entities.bombs[0].explodeTick, 100);
  assert.equal(entities.items[0].id, "I1");
  assert.equal(entities.flames[0].eventSeq, 0);
});

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { createWebSocketGateway } from "../src/network/websocket-gateway.mjs";
import { createGameSimulation } from "../src/simulation/game-simulation.mjs";
import { createPlayerCommandBuffer } from "../src/simulation/player-command-buffer.mjs";
import { createPlayerMovementSystem } from "../src/simulation/player-movement-system.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

function collect(socket) {
  const messages = [];
  const waiters = new Set();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (const waiter of waiters) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(message);
    }
  });
  return {
    messages,
    waitFor(predicate, timeoutMs = 1000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`Timed out after ${messages.map(({ type }) => type)}`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}

function createHarness(options = {}) {
  const world = createWorldOwner({
    generateChunk: ({ chunkSize }) => new Array(chunkSize * chunkSize).fill("floor"),
  });
  const simulation = createGameSimulation({ world, moveIntervalMs: 0 });
  const commandBuffer = createPlayerCommandBuffer();
  const movementSystem = createPlayerMovementSystem({ world });
  const server = http.createServer();
  let currentTick = 40;
  const gateway = createWebSocketGateway({
    server,
    world,
    simulation,
    commandBuffer,
    movementSystem,
    getV3Clock: () => ({ tick: currentTick }),
    getClock: () => ({ tick: 1, nextTickAt: 1000 }),
    tickMs: 1000,
    worldEpochMs: 0,
    bgmDurationMs: 1000,
    bgmSnareOffsetMs: 0,
    ...options,
  });
  return { world, simulation, commandBuffer, movementSystem, server, gateway };
}

async function listen(harness) {
  await new Promise((resolve) => harness.server.listen(0, "127.0.0.1", resolve));
  return `ws://127.0.0.1:${harness.server.address().port}/boom-ws?protocol=3`;
}

async function open(url) {
  const socket = new WebSocket(url, "boom-v3");
  const collector = collect(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  await collector.waitFor((message) => message.type === "hello");
  return { socket, collector };
}

async function join(url, nickname = "테스터") {
  const client = await open(url);
  client.socket.send(JSON.stringify({ protocol: 3, type: "join", nickname }));
  const result = await client.collector.waitFor((message) => message.type === "join_result");
  const worldInit = await client.collector.waitFor((message) => message.type === "world_init");
  const owner = await client.collector.waitFor((message) => message.type === "owner_snapshot");
  const entities = await client.collector.waitFor((message) => message.type === "entity_snapshot");
  return { ...client, result, worldInit, owner, entities };
}

async function closeHarness(harness) {
  harness.gateway.close();
  await new Promise((resolve) => harness.server.close(resolve));
}

test("V3 creates no provisional player and late join receives one-tick full baseline", async (t) => {
  const harness = createHarness();
  t.after(() => closeHarness(harness));
  harness.world.addBomb({
    id: "B1", x: 3, y: 4, owner: "BOT", spawnTick: 10, explodeTick: 100,
  });
  harness.world.setItem({ id: "I1", x: 5, y: 4, type: "shield" });
  harness.world.replaceFlamesForDomain("v3", [{
    id: "F1", x: 6, y: 4, clockDomain: "v3", expireTick: 55,
  }]);
  const url = await listen(harness);
  const pending = await open(url);
  t.after(() => pending.socket.terminate());
  assert.equal(harness.world.readPlayers().length, 0);

  pending.socket.send(JSON.stringify({ protocol: 3, type: "join", nickname: "late" }));
  const result = await pending.collector.waitFor((message) => message.type === "join_result");
  const worldInit = await pending.collector.waitFor((message) => message.type === "world_init");
  const entities = await pending.collector.waitFor((message) => message.type === "entity_snapshot");
  const initialChunks = pending.collector.messages.filter(
    (message) => message.type === "chunk_snapshot" && message.reason === "initial",
  );
  assert.match(result.resumeToken, /^[a-f0-9]{32}$/);
  assert.equal(harness.world.readPlayers().length, 1);
  assert.equal(initialChunks.length, 25);
  assert.ok(initialChunks.every((message) => message.serverTick === worldInit.baselineTick));
  assert.equal(entities.serverTick, worldInit.baselineTick);
  assert.equal(entities.bombs[0].explodeTick, 100);
  assert.equal(entities.flames[0].expireTick, 55);
  assert.equal(entities.items[0].id, "I1");
});

test("actual 1013 backpressure reconnect resumes the same player with a rotated token", async (t) => {
  let forceBackpressure = false;
  const harness = createHarness({
    maxBufferedAmount: 10,
    readBufferedAmount: () => (forceBackpressure ? 11 : 0),
  });
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const first = await join(url, "resume");
  const playerId = first.result.playerId;
  harness.world.updatePlayer(playerId, { x: 7, y: 9, lifeId: 4 });
  harness.movementSystem.initializePlayer(playerId, { resetToCell: true });
  const firstRevisions = Object.fromEntries(first.collector.messages
    .filter((message) => message.type === "chunk_snapshot")
    .map((message) => [message.chunkKey, message.revision]));
  first.socket.send(JSON.stringify({
    protocol: 3,
    type: "ready",
    baselineTick: first.worldInit.baselineTick,
    knownChunkRevisions: firstRevisions,
  }));
  first.socket.send(JSON.stringify({
    protocol: 3, type: "input_state", commandSeq: 0, targetTick: 50, direction: "right",
  }));
  first.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 41 }));
  await first.collector.waitFor(
    (message) => message.type === "pong" && message.clientTimeMs === 41,
  );
  assert.equal(harness.commandBuffer.queueDepth(playerId), 1);

  forceBackpressure = true;
  const closed = new Promise((resolve) => first.socket.once("close", resolve));
  first.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 42 }));
  assert.equal(await closed, 1013);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.commandBuffer.queueDepth(playerId), 0);
  forceBackpressure = false;

  const second = await open(url);
  t.after(() => second.socket.terminate());
  second.socket.send(JSON.stringify({
    protocol: 3,
    type: "resume",
    resumeToken: first.result.resumeToken,
  }));
  const resumed = await second.collector.waitFor((message) => message.type === "resume_result");
  const baseline = await second.collector.waitFor((message) => message.type === "world_init");
  const owner = await second.collector.waitFor((message) => message.type === "owner_snapshot");
  assert.equal(resumed.accepted, true);
  assert.equal(resumed.playerId, playerId);
  assert.notEqual(resumed.resumeToken, first.result.resumeToken);
  assert.equal(owner.serverTick, baseline.baselineTick);
  assert.equal(owner.player.teleport, true);
  assert.deepEqual({ x: owner.player.x, y: owner.player.y, lifeId: owner.player.lifeId }, {
    x: 7, y: 9, lifeId: 4,
  });
  const secondRevisions = Object.fromEntries(second.collector.messages
    .filter((message) => message.type === "chunk_snapshot")
    .map((message) => [message.chunkKey, message.revision]));
  second.socket.send(JSON.stringify({
    protocol: 3,
    type: "ready",
    baselineTick: baseline.baselineTick,
    knownChunkRevisions: secondRevisions,
  }));
  second.socket.send(JSON.stringify({
    protocol: 3, type: "input_state", commandSeq: 0, targetTick: 50, direction: "left",
  }));
  second.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 43 }));
  await second.collector.waitFor(
    (message) => message.type === "pong" && message.clientTimeMs === 43,
  );
  assert.equal(harness.commandBuffer.queueDepth(playerId), 1);

  const rejected = await open(url);
  t.after(() => rejected.socket.terminate());
  rejected.socket.send(JSON.stringify({
    protocol: 3,
    type: "resume",
    resumeToken: first.result.resumeToken,
  }));
  const rejection = await rejected.collector.waitFor(
    (message) => message.type === "resume_result",
  );
  assert.equal(rejection.accepted, false);
  assert.equal(harness.gateway.readMetrics().backpressureDisconnects, 1);
  assert.equal(harness.gateway.readMetrics().resumeSuccess, 1);
  assert.equal(harness.gateway.readMetrics().resumeRejected, 1);
});

test("expired V3 lease removes the player and invalidates its token", async (t) => {
  const harness = createHarness({ v3LeaseMs: 10 });
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const client = await join(url, "expire");
  const playerId = client.result.playerId;
  const closed = new Promise((resolve) => client.socket.once("close", resolve));
  client.socket.close();
  await closed;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(harness.world.getPlayer(playerId), null);
  assert.equal(harness.gateway.readMetrics().resumeExpired, 1);

  const reconnect = await open(url);
  t.after(() => reconnect.socket.terminate());
  reconnect.socket.send(JSON.stringify({
    protocol: 3, type: "resume", resumeToken: client.result.resumeToken,
  }));
  const result = await reconnect.collector.waitFor((message) => message.type === "resume_result");
  assert.equal(result.accepted, false);
});

test("V3 rate limit is bounded and reported without player or token labels", async (t) => {
  const harness = createHarness({ v3MaxMessagesPerSecond: 2 });
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const client = await open(url);
  client.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 1 }));
  await client.collector.waitFor((message) => message.type === "pong");
  const closed = new Promise((resolve) => client.socket.once("close", resolve));
  client.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 2 }));
  client.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 3 }));
  assert.equal(await closed, 1008);
  const metrics = harness.gateway.readMetrics();
  assert.equal(metrics.rateLimitRejects, 1);
  assert.equal("resumeToken" in metrics, false);
  assert.equal("playerId" in metrics, false);
});

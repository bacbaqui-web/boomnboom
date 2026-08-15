import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { createWebSocketGateway } from "../src/network/websocket-gateway.mjs";
import { createGameSimulation } from "../src/simulation/game-simulation.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

function createHarness({ crates = [] } = {}) {
  const crateKeys = new Set(crates.map(([x, y]) => `${x},${y}`));
  const world = createWorldOwner({
    generateChunk({ chunkX, chunkY, chunkSize }) {
      return Array.from({ length: chunkSize * chunkSize }, (_, index) => {
        const x = chunkX * chunkSize + (index % chunkSize);
        const y = chunkY * chunkSize + Math.floor(index / chunkSize);
        return crateKeys.has(`${x},${y}`) ? "crate" : "floor";
      });
    },
  });
  const simulation = createGameSimulation({ world, moveIntervalMs: 0 });
  const server = http.createServer();
  const gateway = createWebSocketGateway({
    server,
    world,
    simulation,
    getClock: () => ({ tick: simulation.tick, nextTickAt: 1000 }),
    tickMs: 1000,
    worldEpochMs: 0,
    bgmDurationMs: 1000,
    bgmSnareOffsetMs: 0,
  });
  return { server, gateway, world, simulation };
}

async function listen(harness) {
  await new Promise((resolve, reject) => {
    harness.server.once("error", reject);
    harness.server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = harness.server.address();
  return `ws://127.0.0.1:${port}/boom-ws`;
}

async function closeHarness(harness) {
  harness.gateway.close();
  await new Promise((resolve) => harness.server.close(resolve));
}

function collect(socket) {
  const messages = [];
  const waiters = new Set();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (const waiter of waiters) {
      if (!waiter.predicate(message, messages)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(message);
    }
  });
  return {
    messages,
    waitFor(predicate, timeoutMs = 1500) {
      const existing = messages.find((message) => predicate(message, messages));
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`Timed out waiting for message; received: ${messages.map((m) => m.type)}`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}

async function openSocket(url, protocols) {
  const socket = new WebSocket(url, protocols);
  const collector = collect(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, collector };
}

async function rejectedUpgradeStatus(url, protocols) {
  const socket = new WebSocket(url, protocols);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for upgrade rejection")), 1500);
    socket.once("open", () => {
      clearTimeout(timer);
      socket.terminate();
      reject(new Error("Unsupported upgrade unexpectedly opened"));
    });
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      const statusCode = response.statusCode;
      response.resume();
      resolve(statusCode);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function joinV2(harness, url, nickname = "테스터") {
  const { socket, collector } = await openSocket(`${url}?protocol=2`);
  const hello = await collector.waitFor((message) => message.type === "hello");
  harness.world.updatePlayer(hello.sessionId, {
    x: 1,
    y: 1,
    prevX: 1,
    prevY: 1,
  });
  socket.send(JSON.stringify({ protocol: 2, type: "join", nickname }));
  await collector.waitFor((message) => message.type === "entity_snapshot");
  return { socket, collector, hello };
}

function initialChunkRevisions(messages) {
  return Object.fromEntries(
    messages
      .filter((message) => message.type === "chunk_snapshot" && message.reason === "initial")
      .map((message) => [message.chunkKey, message.revision]),
  );
}

async function sendReady(client) {
  client.socket.send(
    JSON.stringify({
      protocol: 2,
      type: "ready",
      knownChunkRevisions: initialChunkRevisions(client.collector.messages),
    }),
  );
  client.socket.send(JSON.stringify({ protocol: 2, type: "ping", clientTime: 42 }));
  await client.collector.waitFor(
    (message) => message.type === "pong" && message.clientTime === 42,
  );
}

test("V2 init is ordered and preloads the complete radius-2 chunk set", async (t) => {
  const harness = createHarness();
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const client = await joinV2(harness, url);
  t.after(() => client.socket.terminate());

  const types = client.collector.messages.map((message) => message.type);
  assert.equal(types[0], "hello");
  assert.equal(types[1], "world_init");
  assert.deepEqual(types.slice(2, 27), new Array(25).fill("chunk_snapshot"));
  assert.equal(types[27], "entity_snapshot");
  const chunks = client.collector.messages.filter((message) => message.type === "chunk_snapshot");
  assert.equal(chunks.length, 25);
  assert.equal(new Set(chunks.map((message) => message.chunkKey)).size, 25);
  assert.ok(client.collector.messages.every((message) => message.protocol === 2));
});

test("V2 movement sends correction and entity delta without any tile matrix", async (t) => {
  const harness = createHarness();
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const client = await joinV2(harness, url);
  t.after(() => client.socket.terminate());
  const initialEntityRevision = client.collector.messages.find(
    (message) => message.type === "entity_snapshot",
  ).entityRevision;
  await sendReady(client);
  const start = client.collector.messages.length;

  client.socket.send(JSON.stringify({ protocol: 2, type: "input", clientSeq: 1, action: "right" }));
  const ack = await client.collector.waitFor(
    (message) => message.type === "input_ack" && message.ackClientSeq === 1,
  );
  const entityDelta = await client.collector.waitFor(
    (message) => message.type === "entity_delta",
  );
  assert.equal(ack.accepted, true);
  assert.deepEqual([ack.correction.x, ack.correction.y], [2, 1]);
  assert.ok(entityDelta.entityRevision > initialEntityRevision);
  assert.equal(ack.entityRevision, entityDelta.entityRevision);
  assert.equal(client.collector.messages.slice(start).filter((message) => "tiles" in message).length, 0);

  client.socket.send(JSON.stringify({ protocol: 2, type: "input", clientSeq: 1, action: "right" }));
  const duplicate = await client.collector.waitFor(
    (message) => message.type === "input_ack" && message.ackClientSeq === 1 && message.duplicate,
  );
  assert.deepEqual(duplicate.correction, ack.correction);
  assert.deepEqual(
    [harness.world.getPlayer(client.hello.sessionId).x, harness.world.getPlayer(client.hello.sessionId).y],
    [2, 1],
  );

  client.socket.send(JSON.stringify({ protocol: 2, type: "input", clientSeq: 0, action: "right" }));
  const stale = await client.collector.waitFor(
    (message) => message.type === "input_ack" && message.ackClientSeq === 0,
  );
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, "stale_sequence");
});

test("two subscribers receive the same chunk revision delta after one snapshot", async (t) => {
  const harness = createHarness({ crates: [[5, 5]] });
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const first = await joinV2(harness, url, "첫째");
  const second = await joinV2(harness, url, "둘째");
  t.after(() => first.socket.terminate());
  t.after(() => second.socket.terminate());
  await Promise.all([sendReady(first), sendReady(second)]);
  const firstStart = first.collector.messages.length;
  const secondStart = second.collector.messages.length;

  assert.equal(harness.world.destroyCrate(5, 5), true);
  harness.gateway.publish();
  const [firstDelta, secondDelta] = await Promise.all([
    first.collector.waitFor((message) => message.type === "chunk_delta" && message.chunkKey === "0,0"),
    second.collector.waitFor((message) => message.type === "chunk_delta" && message.chunkKey === "0,0"),
  ]);
  assert.equal(firstDelta.fromRevision, 1);
  assert.equal(firstDelta.revision, 2);
  assert.deepEqual(
    { ...firstDelta, serverTime: 0 },
    { ...secondDelta, serverTime: 0 },
  );
  assert.equal(first.collector.messages.slice(firstStart).filter((message) => message.type === "chunk_snapshot").length, 0);
  assert.equal(second.collector.messages.slice(secondStart).filter((message) => message.type === "chunk_snapshot").length, 0);
});

test("chunk gaps recover with a fresh snapshot", async (t) => {
  const harness = createHarness({ crates: [[5, 5]] });
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const client = await joinV2(harness, url);
  t.after(() => client.socket.terminate());
  await sendReady(client);
  harness.world.destroyCrate(5, 5);
  harness.gateway.publish();
  await client.collector.waitFor((message) => message.type === "chunk_delta" && message.chunkKey === "0,0");

  client.socket.send(
    JSON.stringify({ protocol: 2, type: "chunk_resync", chunkKey: "0,0", revision: 0 }),
  );
  const snapshot = await client.collector.waitFor(
    (message) => message.type === "chunk_snapshot" && message.reason === "client_resync",
  );
  assert.equal(snapshot.revision, 2);
  assert.equal(snapshot.tiles[5 * 16 + 5], "floor");
});

test("interest changes preload new chunks before entity publication", async (t) => {
  const harness = createHarness();
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const client = await joinV2(harness, url);
  t.after(() => client.socket.terminate());
  await sendReady(client);
  const start = client.collector.messages.length;
  harness.world.updatePlayer(client.hello.sessionId, { x: 17, prevX: 1 });
  harness.gateway.publish();
  const update = await client.collector.waitFor((message) => message.type === "interest_update");
  await client.collector.waitFor(
    (_message, messages) => messages.slice(start).filter((message) => message.reason === "interest").length === 5,
  );
  assert.equal(update.added.length, 5);
  assert.equal(update.removed.length, 5);
  const after = client.collector.messages.slice(start);
  const lastPreload = after.map((message) => message.reason).lastIndexOf("interest");
  const entityDelta = after.findIndex((message) => message.type === "entity_delta");
  assert.ok(entityDelta > lastPreload);
});

test("V2 reports schema errors and rejects unversioned or protocol-1 upgrades", async (t) => {
  const harness = createHarness();
  t.after(() => closeHarness(harness));
  const url = await listen(harness);

  const { socket: v2, collector: v2Collector } = await openSocket(`${url}?protocol=2`);
  t.after(() => v2.terminate());
  await v2Collector.waitFor((message) => message.type === "hello");
  v2.send("{");
  assert.equal((await v2Collector.waitFor((message) => message.type === "error")).code, "malformed_json");
  v2.send(JSON.stringify({ protocol: 1, type: "join", nickname: "old" }));
  assert.equal(
    (await v2Collector.waitFor((message) => message.type === "error" && message.code === "unsupported_protocol")).recoverable,
    false,
  );

  const beforeRejects = harness.gateway.readMetrics();
  assert.equal(await rejectedUpgradeStatus(url), 426);
  assert.equal(await rejectedUpgradeStatus(`${url}?protocol=1`), 426);
  const afterRejects = harness.gateway.readMetrics();
  assert.equal(afterRejects.connections, beforeRejects.connections);
  assert.equal(
    afterRejects.unsupportedProtocolRejects,
    beforeRejects.unsupportedProtocolRejects + 2,
  );

  const { socket: subprotocol, collector: subprotocolCollector } = await openSocket(
    url,
    "boom-v2",
  );
  t.after(() => subprotocol.terminate());
  const hello = await subprotocolCollector.waitFor((message) => message.type === "hello");
  assert.deepEqual(hello.supportedProtocols, [2]);
});

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { createWebSocketGateway } from "../src/network/websocket-gateway.mjs";
import { createFixedStepLoop } from "../src/simulation/fixed-step-loop.mjs";
import { createBombSystem } from "../src/simulation/bomb-system.mjs";
import { createExplosionSystem } from "../src/simulation/explosion-system.mjs";
import { createGameSimulation } from "../src/simulation/game-simulation.mjs";
import { createPlayerCommandBuffer } from "../src/simulation/player-command-buffer.mjs";
import { createPlayerMovementSystem } from "../src/simulation/player-movement-system.mjs";
import { createPlayerRespawnSystem } from "../src/simulation/player-respawn-system.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

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
            reject(new Error(`Timed out; received ${messages.map((message) => message.type)}`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}

function createHarness() {
  const world = createWorldOwner({
    generateChunk: ({ chunkSize }) => new Array(chunkSize * chunkSize).fill("floor"),
  });
  const simulation = createGameSimulation({ world, moveIntervalMs: 0 });
  const commandBuffer = createPlayerCommandBuffer();
  const movementSystem = createPlayerMovementSystem({ world });
  const bombSystem = createBombSystem({ world });
  const explosionSystem = createExplosionSystem({ world });
  const respawnSystem = createPlayerRespawnSystem({
    world, simulation, movementSystem, commandBuffer,
  });
  const server = http.createServer();
  let gateway;
  let currentTick = 0;

  function step(serverTick) {
    currentTick = serverTick;
    const commands = commandBuffer.consumeTick(serverTick);
    const movement = movementSystem.step(serverTick, commands);
    const respawn = respawnSystem.step(serverTick, commands);
    const bombs = bombSystem.step(serverTick, commands, {
      blockedPlayerIds: respawn.respawnedPlayerIds,
    });
    const explosion = explosionSystem.step(serverTick);
    gateway.publishV3ActionResults([...respawn.results, ...bombs.results], serverTick);
    gateway.publishV3WorldEvents(explosion.events, serverTick);
    if (serverTick % 2 === 0) {
      if (movement.cellChanged || bombs.changed || explosion.changed || respawn.changed) {
        gateway.publish();
      }
      gateway.publishV3Snapshots(serverTick);
    }
  }

  const fixedStepLoop = createFixedStepLoop({ onStep: step });
  gateway = createWebSocketGateway({
    server,
    world,
    simulation,
    commandBuffer,
    movementSystem,
    getV3Clock: () => ({ tick: currentTick }),
    getClock: () => ({ tick: simulation.tick, nextTickAt: 1000 }),
    tickMs: 1000,
    worldEpochMs: 0,
    bgmDurationMs: 1000,
    bgmSnareOffsetMs: 0,
  });
  return {
    world, simulation, commandBuffer, movementSystem, bombSystem, explosionSystem,
    respawnSystem, server, gateway, fixedStepLoop, step,
  };
}

async function listen(harness) {
  await new Promise((resolve, reject) => {
    harness.server.once("error", reject);
    harness.server.listen(0, "127.0.0.1", resolve);
  });
  return `ws://127.0.0.1:${harness.server.address().port}/boom-ws`;
}

async function closeHarness(harness) {
  harness.fixedStepLoop.stop();
  harness.gateway.close();
  await new Promise((resolve) => harness.server.close(resolve));
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

async function joinV3(harness, url) {
  const client = await openSocket(`${url}?protocol=3`);
  const hello = await client.collector.waitFor((message) => message.type === "hello");
  client.socket.send(JSON.stringify({ protocol: 3, type: "join", nickname: "V3 테스터" }));
  const joinResult = await client.collector.waitFor((message) => message.type === "join_result");
  const worldInit = await client.collector.waitFor((message) => message.type === "world_init");
  const playerId = worldInit.playerId;
  await client.collector.waitFor((message) => message.type === "entity_snapshot");
  const revisions = Object.fromEntries(
    client.collector.messages
      .filter((message) => message.type === "chunk_snapshot" && message.reason === "initial")
      .map((message) => [message.chunkKey, message.revision]),
  );
  client.socket.send(JSON.stringify({
    protocol: 3,
    type: "ready",
    baselineTick: worldInit.baselineTick,
    knownChunkRevisions: revisions,
  }));
  client.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 42 }));
  await client.collector.waitFor(
    (message) => message.type === "pong" && message.clientTimeMs === 42,
  );
  return { ...client, hello, joinResult, worldInit, playerId };
}

async function joinV2(harness, url) {
  const client = await openSocket(`${url}?protocol=2`);
  const hello = await client.collector.waitFor((message) => message.type === "hello");
  harness.world.updatePlayer(hello.sessionId, { x: 10, y: 10, prevX: 10, prevY: 10 });
  client.socket.send(JSON.stringify({ protocol: 2, type: "join", nickname: "V2 테스터" }));
  await client.collector.waitFor((message) => message.type === "entity_snapshot");
  const revisions = Object.fromEntries(
    client.collector.messages
      .filter((message) => message.type === "chunk_snapshot" && message.reason === "initial")
      .map((message) => [message.chunkKey, message.revision]),
  );
  client.socket.send(JSON.stringify({
    protocol: 2,
    type: "ready",
    knownChunkRevisions: revisions,
  }));
  client.socket.send(JSON.stringify({ protocol: 2, type: "ping", clientTime: 44 }));
  await client.collector.waitFor(
    (message) => message.type === "pong" && message.clientTime === 44,
  );
  return { ...client, hello };
}

test("V3 gateway runs join, ready, 30Hz movement, and 15Hz absolute snapshots", async (t) => {
  const harness = createHarness();
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const client = await joinV3(harness, url);
  t.after(() => client.socket.terminate());

  assert.equal(client.collector.messages.filter(
    (message) => message.type === "chunk_snapshot" && message.reason === "initial",
  ).length, 25);
  client.socket.send(JSON.stringify({
    protocol: 3,
    type: "input_state",
    commandSeq: 1,
    targetTick: 2,
    direction: "right",
  }));
  harness.fixedStepLoop.start();
  await client.collector.waitFor(
    (_message, messages) => messages.filter(
      (candidate) => candidate.type === "owner_snapshot" && candidate.lastProcessedCommandSeq === 1,
    ).length >= 3,
    1000,
  );
  const snapshots = client.collector.messages.filter(
    (message) => message.type === "owner_snapshot" && message.lastProcessedCommandSeq === 1,
  ).slice(0, 3);
  assert.deepEqual(snapshots.map((message) => message.serverTick), [2, 4, 6]);
  const wallIntervals = snapshots.slice(1).map(
    (message, index) => message.serverTimeMs - snapshots[index].serverTimeMs,
  );
  assert.ok(wallIntervals.every((interval) => interval >= 20 && interval < 250));
  assert.ok(snapshots[1].player.px > snapshots[0].player.px);
  assert.ok(snapshots.every((message) => Number.isInteger(message.player.px)));
  assert.equal(harness.gateway.readMetrics().v3, 1);

  client.socket.send(JSON.stringify({
    protocol: 3,
    type: "action_command",
    commandSeq: 2,
    targetTick: 8,
    action: "bomb",
  }));
  const action = await client.collector.waitFor((message) => message.type === "action_result");
  assert.equal(action.accepted, true);
  assert.equal(action.explodeTick - action.spawnTick, 90);
});

test("V3 movement crossing a chunk boundary sends interest chunks before entity samples", async (t) => {
  const harness = createHarness();
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const client = await joinV3(harness, url);
  t.after(() => client.socket.terminate());
  const start = client.collector.messages.length;
  client.socket.send(JSON.stringify({
    protocol: 3,
    type: "input_state",
    commandSeq: 1,
    targetTick: 1,
    direction: "right",
  }));
  client.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 43 }));
  await client.collector.waitFor(
    (message) => message.type === "pong" && message.clientTimeMs === 43,
  );
  for (let tick = 1; tick <= 180; tick += 1) harness.step(tick);

  await client.collector.waitFor((message) => message.type === "interest_update");
  await client.collector.waitFor(
    (_message, messages) => messages.slice(start).filter(
      (candidate) => candidate.type === "chunk_snapshot" && candidate.reason === "interest",
    ).length >= 5,
  );
  const after = client.collector.messages.slice(start);
  const interestIndex = after.findIndex((message) => message.type === "interest_update");
  const nextEntityIndex = after.findIndex(
    (message, index) => index > interestIndex && message.type === "entity_snapshot",
  );
  const preloaded = after.slice(interestIndex + 1, nextEntityIndex).filter(
    (message) => message.type === "chunk_snapshot" && message.reason === "interest",
  );
  assert.equal(preloaded.length, 5);
});

test("boom-v3 subprotocol selects V3 explicitly", async (t) => {
  const harness = createHarness();
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const client = await openSocket(url, "boom-v3");
  t.after(() => client.socket.terminate());
  const hello = await client.collector.waitFor((message) => message.type === "hello");
  assert.equal(hello.protocol, 3);
  assert.deepEqual(hello.supportedProtocols, [2, 3]);
});

test("explicit V2 and V3 clients remain isolated while connected together", async (t) => {
  const harness = createHarness();
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const [v2, v3] = await Promise.all([joinV2(harness, url), joinV3(harness, url)]);
  t.after(() => v2.socket.terminate());
  t.after(() => v3.socket.terminate());

  v2.socket.send(JSON.stringify({
    protocol: 2,
    type: "input",
    clientSeq: 1,
    action: "right",
  }));
  const v2Ack = await v2.collector.waitFor(
    (message) => message.type === "input_ack" && message.ackClientSeq === 1,
  );
  assert.equal(v2Ack.protocol, 2);

  v3.socket.send(JSON.stringify({
    protocol: 3,
    type: "input_state",
    commandSeq: 1,
    targetTick: 1,
    direction: "right",
  }));
  v3.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 45 }));
  await v3.collector.waitFor(
    (message) => message.type === "pong" && message.clientTimeMs === 45,
  );
  harness.step(1);
  harness.step(2);
  const owner = await v3.collector.waitFor(
    (message) => message.type === "owner_snapshot" && message.lastProcessedCommandSeq === 1,
  );
  assert.equal(owner.protocol, 3);
  assert.deepEqual(
    { v2: harness.gateway.readMetrics().v2, v3: harness.gateway.readMetrics().v3 },
    { v2: 1, v3: 1 },
  );
});

test("two V3 clients receive the same bomb tick, explosion event, flames, and damage", async (t) => {
  const harness = createHarness();
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const [owner, victim] = await Promise.all([
    joinV3(harness, url),
    joinV3(harness, url),
  ]);
  t.after(() => owner.socket.terminate());
  t.after(() => victim.socket.terminate());
  harness.world.updatePlayer(owner.playerId, { x: 0, y: 0 });
  harness.world.updatePlayer(victim.playerId, { x: 1, y: 0 });
  harness.movementSystem.initializePlayer(owner.playerId, { resetToCell: true });
  harness.movementSystem.initializePlayer(victim.playerId, { resetToCell: true });

  owner.socket.send(JSON.stringify({
    protocol: 3,
    type: "action_command",
    commandSeq: 1,
    targetTick: 1,
    action: "bomb",
  }));
  owner.socket.send(JSON.stringify({
    protocol: 3,
    type: "action_command",
    commandSeq: 1,
    targetTick: 1,
    action: "bomb",
  }));
  owner.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 91 }));
  await owner.collector.waitFor(
    (message) => message.type === "pong" && message.clientTimeMs === 91,
  );
  harness.step(1);
  const action = await owner.collector.waitFor(
    (message) => message.type === "action_result" && message.commandSeq === 1,
  );
  assert.deepEqual(action.cell, { x: 0, y: 0 });
  assert.equal(action.explodeTick, 91);
  assert.equal(
    owner.collector.messages.filter(
      (message) => message.type === "action_result" && message.commandSeq === 1,
    ).length,
    1,
  );
  owner.socket.send(JSON.stringify({
    protocol: 3,
    type: "action_command",
    commandSeq: 1,
    targetTick: 1,
    action: "bomb",
  }));
  owner.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 92 }));
  await owner.collector.waitFor(
    (message) => message.type === "pong" && message.clientTimeMs === 92,
  );
  assert.equal(
    owner.collector.messages.filter(
      (message) => message.type === "action_result" && message.commandSeq === 1,
    ).length,
    2,
  );
  assert.equal(harness.world.readBombs().length, 1);
  harness.step(2);
  const [ownerBombs, victimBombs] = await Promise.all([
    owner.collector.waitFor(
      (message) => message.type === "entity_snapshot" && message.serverTick === 2,
    ),
    victim.collector.waitFor(
      (message) => message.type === "entity_snapshot" && message.serverTick === 2,
    ),
  ]);
  assert.deepEqual(ownerBombs.bombs, victimBombs.bombs);
  assert.equal(ownerBombs.bombs[0].explodeTick, 91);

  harness.world.updatePlayer(owner.playerId, { x: 8, y: 8 });
  harness.movementSystem.initializePlayer(owner.playerId, { resetToCell: true });
  for (let tick = 3; tick <= 91; tick += 1) harness.step(tick);
  const [ownerEvent, victimEvent] = await Promise.all([
    owner.collector.waitFor((message) => message.type === "world_event"),
    victim.collector.waitFor((message) => message.type === "world_event"),
  ]);
  assert.deepEqual(ownerEvent.cells, victimEvent.cells);
  assert.notEqual(ownerEvent.eventSeq, action.commandSeq);
  assert.deepEqual(ownerEvent.damaged, victimEvent.damaged);
  assert.ok(ownerEvent.damaged.some(
    (damage) => damage.playerId === victim.playerId && damage.outcome === "death",
  ));

  harness.step(92);
  const victimOwner = await victim.collector.waitFor(
    (message) => message.type === "owner_snapshot" && message.serverTick === 92,
  );
  assert.equal(victimOwner.player.alive, false);
  const flames = await owner.collector.waitFor(
    (message) => message.type === "entity_snapshot" && message.serverTick === 92,
  );
  assert.ok(flames.flames.length > 0);

  victim.socket.send(JSON.stringify({
    protocol: 3,
    type: "action_command",
    commandSeq: 1,
    targetTick: 93,
    action: "respawn",
  }));
  victim.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 93 }));
  await victim.collector.waitFor(
    (message) => message.type === "pong" && message.clientTimeMs === 93,
  );
  harness.step(93);
  const respawn = await victim.collector.waitFor(
    (message) => message.type === "action_result" && message.action === "respawn",
  );
  assert.equal(respawn.accepted, true);
  harness.step(94);
  const respawned = await victim.collector.waitFor(
    (message) => message.type === "owner_snapshot" && message.serverTick === 94,
  );
  assert.equal(respawned.player.alive, true);
  assert.equal(respawned.player.lifeId, 2);
  assert.equal(respawned.player.teleport, true);
});

test("300ms-class delayed escape input is judged at explosion tick, never at a past position", async (t) => {
  const harness = createHarness();
  t.after(() => closeHarness(harness));
  const url = await listen(harness);
  const [owner, runner] = await Promise.all([
    joinV3(harness, url),
    joinV3(harness, url),
  ]);
  t.after(() => owner.socket.terminate());
  t.after(() => runner.socket.terminate());
  harness.world.updatePlayer(owner.playerId, { x: 0, y: 0 });
  harness.world.updatePlayer(runner.playerId, { x: 2, y: 0 });
  harness.movementSystem.initializePlayer(owner.playerId, { resetToCell: true });
  harness.movementSystem.initializePlayer(runner.playerId, { resetToCell: true });
  owner.socket.send(JSON.stringify({
    protocol: 3, type: "action_command", commandSeq: 1, targetTick: 1, action: "bomb",
  }));
  owner.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 191 }));
  await owner.collector.waitFor(
    (message) => message.type === "pong" && message.clientTimeMs === 191,
  );
  harness.step(1);
  harness.world.updatePlayer(owner.playerId, { x: 8, y: 8 });
  harness.movementSystem.initializePlayer(owner.playerId, { resetToCell: true });
  for (let tick = 2; tick <= 74; tick += 1) harness.step(tick);

  runner.socket.send(JSON.stringify({
    protocol: 3,
    type: "input_state",
    commandSeq: 1,
    targetTick: 75,
    direction: "right",
  }));
  runner.socket.send(JSON.stringify({ protocol: 3, type: "ping", clientTimeMs: 192 }));
  await runner.collector.waitFor(
    (message) => message.type === "pong" && message.clientTimeMs === 192,
  );
  for (let tick = 75; tick <= 91; tick += 1) harness.step(tick);
  const event = await runner.collector.waitFor((message) => message.type === "world_event");
  assert.equal(
    event.damaged.some((damage) => damage.playerId === runner.playerId),
    false,
  );
  assert.equal(harness.world.getPlayer(runner.playerId).alive, true);
  assert.ok(harness.world.getPlayer(runner.playerId).x >= 3);
});

import assert from "node:assert/strict";
import test from "node:test";
import { ClockSync } from "../app/game/clock-sync.ts";
import { GameSocket } from "../app/game/game-socket.ts";
import { ClientWorldStore } from "../app/game/world-store.ts";

function envelope(type, payload = {}) {
  return { protocol: 3, type, serverTick: 0, serverTimeMs: Date.now(), worldTick: 1, ...payload };
}

function player() {
  return {
    id: "P1", px: 512, py: 512, vx: 0, vy: 0, direction: "neutral",
    x: 0, y: 0, alive: true, joined: true, isAI: false, nickname: "P1",
    power: 1, range: 2, shield: 0, lifeId: 1, teleport: true,
  };
}

test("GameSocket V3 completes baseline/ready and writes typed input only on an open socket", () => {
  const store = new ClientWorldStore();
  const sent = [];
  let createdUrl = "";
  let createdProtocol = "";
  let fakeSocket;
  const owners = [];
  const entities = [];
  const actions = [];
  const events = [];
  const socket = new GameSocket({
    store,
    protocol: 3,
    clockSync: new ClockSync(),
    onV3OwnerSnapshot: (owner) => owners.push(owner),
    onV3EntitySnapshot: (entitySnapshot) => entities.push(entitySnapshot),
    onV3ActionResult: (result) => actions.push(result),
    onV3WorldEvent: (event) => events.push(event),
    createSocket(url, protocol) {
      createdUrl = url;
      createdProtocol = protocol;
      fakeSocket = {
        readyState: 1,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send(raw) { sent.push(JSON.parse(raw)); },
        close() { this.readyState = 3; },
      };
      return fakeSocket;
    },
  });
  socket.join("P1", "purple");
  socket.connect();
  fakeSocket.onmessage({ data: JSON.stringify(envelope("hello", { sessionId: "P1" })) });
  fakeSocket.onmessage({ data: JSON.stringify(envelope("world_init", {
    worldId: "WORLD", playerId: "P1", baselineTick: 0, chunkSize: 16,
  })) });
  fakeSocket.onmessage({ data: JSON.stringify(envelope("owner_snapshot", {
    snapshotSeq: 0, lastProcessedCommandSeq: null, player: player(),
  })) });
  fakeSocket.onmessage({ data: JSON.stringify(envelope("entity_snapshot", {
    snapshotSeq: 0, players: [player()],
  })) });
  fakeSocket.onmessage({ data: JSON.stringify(envelope("entity_snapshot", {
    snapshotSeq: 0, players: [player()],
  })) });

  assert.match(createdUrl, /protocol=3/);
  assert.equal(createdProtocol, "boom-v3");
  assert.ok(sent.some(
    (message) => message.type === "join" && message.protocol === 3 && message.color === "purple",
  ));
  assert.ok(sent.some((message) => message.type === "ready" && message.baselineTick === 0));
  assert.equal(owners.length, 1);
  assert.equal(entities.length, 1);
  assert.equal(store.getSnapshot().initialized, true);
  assert.equal(socket.sendV3Input({
    protocol: 3,
    type: "input_state",
    commandSeq: 0,
    targetTick: 2,
    direction: "right",
  }), true);
  assert.ok(sent.some((message) => message.type === "input_state"));
  fakeSocket.onmessage({ data: JSON.stringify(envelope("action_result", {
    commandSeq: 0, action: "bomb", accepted: true, reason: null,
    bombId: "V3-B1", cell: { x: 0, y: 0 }, spawnTick: 2, explodeTick: 92,
  })) });
  for (const eventSeq of [1, 1, 0, 2]) {
    fakeSocket.onmessage({ data: JSON.stringify(envelope("world_event", {
      eventSeq, eventType: "explosion", eventTick: 2, expireTick: 17,
    })) });
  }
  assert.equal(actions.length, 1);
  assert.deepEqual(events.map((event) => event.eventSeq), [1, 2]);
  socket.disconnect();
});

test("GameSocket reconnects with memory-only resume first and falls back to clean join", () => {
  const store = new ClientWorldStore();
  const sockets = [];
  const clock = new ClockSync();
  let resets = 0;
  const socket = new GameSocket({
    store,
    protocol: 3,
    clockSync: clock,
    onV3Reset: () => { resets += 1; },
    createSocket() {
      const sent = [];
      const fake = {
        sent,
        readyState: 1,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send(raw) { sent.push(JSON.parse(raw)); },
        close() { this.readyState = 3; },
      };
      sockets.push(fake);
      return fake;
    },
  });
  socket.join("P1", "orange");
  socket.connect();
  sockets[0].onmessage({ data: JSON.stringify(envelope("hello", {
    sessionId: "C1", serverTick: 500_000,
  })) });
  assert.equal(sockets[0].sent.at(-1).type, "join");
  sockets[0].onmessage({ data: JSON.stringify(envelope("join_result", {
    accepted: true, playerId: "P1", resumeToken: "a".repeat(32),
  })) });
  sockets[0].onclose();
  assert.equal(resets, 1);

  socket.connect();
  sockets[1].onmessage({ data: JSON.stringify(envelope("hello", { sessionId: "C2" })) });
  assert.ok(clock.estimatedServerTick(Date.now()) < 10);
  assert.deepEqual(sockets[1].sent.at(-1), {
    protocol: 3, type: "resume", resumeToken: "a".repeat(32),
  });
  sockets[1].onmessage({ data: JSON.stringify(envelope("resume_result", {
    accepted: true, playerId: "P1", resumeToken: "b".repeat(32),
  })) });
  sockets[1].onclose();
  assert.equal(resets, 2);

  socket.connect();
  sockets[2].onmessage({ data: JSON.stringify(envelope("hello", { sessionId: "C3" })) });
  assert.deepEqual(sockets[2].sent.at(-1), {
    protocol: 3, type: "resume", resumeToken: "b".repeat(32),
  });
  sockets[2].onmessage({ data: JSON.stringify(envelope("resume_result", {
    accepted: false, reason: "resume_expired",
  })) });
  assert.deepEqual(sockets[2].sent.at(-1), {
    protocol: 3, type: "join", nickname: "P1", color: "orange",
  });
  socket.disconnect();
});

test("V2 hello never emits a Protocol V3 resume message", () => {
  const store = new ClientWorldStore();
  const sent = [];
  let fake;
  const socket = new GameSocket({
    store,
    protocol: 2,
    createSocket() {
      fake = {
        readyState: 1,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send(raw) { sent.push(JSON.parse(raw)); },
        close() { this.readyState = 3; },
      };
      return fake;
    },
  });
  socket.join("V2");
  socket.connect();
  fake.onmessage({ data: JSON.stringify({
    protocol: 2,
    type: "hello",
    serverTick: 0,
    serverTime: 0,
    worldTick: 0,
    sessionId: "P1",
  }) });
  assert.ok(sent.some((message) => message.type === "join" && message.protocol === 2));
  assert.equal(sent.some((message) => message.protocol === 3), false);
  socket.disconnect();
});

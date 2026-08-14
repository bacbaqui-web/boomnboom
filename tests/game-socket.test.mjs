import assert from "node:assert/strict";
import test from "node:test";
import { GameSocket } from "../app/game/game-socket.ts";
import { ClientWorldStore } from "../app/game/world-store.ts";

function message(type, payload = {}) {
  return { protocol: 2, type, serverTime: 1000, worldTick: 1, ...payload };
}

function initializedStore() {
  const store = new ClientWorldStore();
  store.apply(message("world_init", {
    worldId: "WORLD",
    chunkSize: 16,
    player: {
      kind: "player", id: "P1", x: 0, y: 0, isAI: false, action: "wait",
      score: 0, power: 1, range: 2, shield: 0, nickname: "P1", joined: true, alive: true,
    },
  }));
  store.apply(message("entity_snapshot", {
    entityRevision: 1, players: [], bombs: [], items: [], flames: [], enemies: [],
  }));
  return store;
}

test("an input that was not written to an open socket is not predicted", () => {
  const socket = new GameSocket({
    store: initializedStore(),
    createSocket: () => ({
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send() { throw new Error("closed socket must not send"); },
      close() {},
    }),
  });
  socket.connect();
  assert.equal(socket.sendInput("right"), -1);
  assert.equal(socket.respawn(), -1);
  socket.disconnect();
});

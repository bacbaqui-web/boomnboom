import assert from "node:assert/strict";
import test from "node:test";
import { createHealthHandler } from "../src/health-handler.mjs";

test("health exposes bounded aggregate V3 metrics without identity labels", () => {
  let body = "";
  const response = {
    writeHead() { return this; },
    end(value) { body = value; },
  };
  const handler = createHealthHandler({
    world: {
      readMetrics: () => ({
        players: 1, chunks: 2, bombs: 0, items: 0, activeChunks: 2,
        pinnedChunks: 0, retainedChunks: 2, materializations: 2,
        entities: 1, humans: 1, bots: 0, flames: 0,
      }),
    },
    simulation: { tick: 1 },
    scheduler: {
      readMetrics: () => ({ lastCompletedTickAt: Date.now() }),
    },
    readNetworkMetrics: () => ({
      connections: 1, v2: 0, v3: 1, late: 2, stale: 1,
      futureRejected: 2, queueRejected: 3, queuedCommands: 4,
      resumeSuccess: 5, resumeRejected: 6, resumeExpired: 7,
      playerLeases: 1, disconnectedLeases: 0, rateLimitRejects: 8,
    }),
    fixedStepLoop: {
      readMetrics: () => ({ catchUpBacklog: 3, tick: 10 }),
    },
    tickMs: 1000,
  });
  assert.equal(handler({ url: "/health" }, response), true);
  const health = JSON.parse(body);
  assert.equal(health.network.commandLate, 2);
  assert.equal(health.network.commandRejected, 6);
  assert.equal(health.network.resumeSuccess, 5);
  assert.equal(health.fixedSimulation.catchUpBacklog, 3);
  assert.equal(body.includes("playerId"), false);
  assert.equal(body.includes("resumeToken"), false);
});

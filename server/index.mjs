import http from "node:http";
import { createBotController } from "./src/ai/bot-controller.mjs";
import { createV1StateSerializer } from "./src/network/protocol-v1.mjs";
import { createWebSocketGateway } from "./src/network/websocket-gateway.mjs";
import { createGameSimulation } from "./src/simulation/game-simulation.mjs";
import { createWorldOwner } from "./src/world/world-owner.mjs";

const PORT = Number(process.env.PORT || 3300);
const TICK_MS = Number(process.env.TICK_MS || 1000);
const MOVE_INTERVAL_MS = 140;
const AI_INTERVAL_MS = 500;
const WORLD_EPOCH_MS = Number(
  process.env.WORLD_EPOCH_MS || Date.UTC(2026, 7, 14, 0, 0, 0),
);
const BGM_DURATION_MS = 209995.5;
const BGM_SNARE_OFFSET_MS = 255;
const BOT_COUNT = 6;

function timelineAt(now = Date.now()) {
  const elapsed = Math.max(0, now - WORLD_EPOCH_MS);
  const tick = Math.floor(elapsed / TICK_MS);
  return { tick, nextTickAt: WORLD_EPOCH_MS + (tick + 1) * TICK_MS };
}

const initialTimeline = timelineAt();
let nextTickAt = initialTimeline.nextTickAt;
let lastTickDurationMs = 0;
let lastEventLoopLagMs = 0;
let lastCompletedTickAt = Date.now();

const world = createWorldOwner();
const simulation = createGameSimulation({
  world,
  initialTick: initialTimeline.tick,
  moveIntervalMs: MOVE_INTERVAL_MS,
  crateRespawnTicks: 8,
  bombFuseTicks: 3,
});
const botController = createBotController({ world });
const v1 = createV1StateSerializer({
  world,
  width: 23,
  height: 19,
  viewWidth: 15,
  viewHeight: 11,
  recenterThreshold: 3,
  worldEpochMs: WORLD_EPOCH_MS,
  bgmDurationMs: BGM_DURATION_MS,
  bgmSnareOffsetMs: BGM_SNARE_OFFSET_MS,
});

for (let index = 0; index < BOT_COUNT; index += 1) simulation.addPlayer({ isAI: true });

let gateway;
const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    const metrics = world.readMetrics();
    const network = gateway?.readMetrics() ?? { connections: 0, v1: 0, v2: 0 };
    const memory = process.memoryUsage();
    const healthyTick = Date.now() - lastCompletedTickAt <= TICK_MS * 3;
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(
      JSON.stringify({
        ok: healthyTick,
        tick: simulation.tick,
        players: metrics.players,
        destroyed: metrics.respawns,
        chunks: metrics.chunks,
        bombs: metrics.bombs,
        items: metrics.items,
        connections: network.connections,
        protocolV1: network.v1,
        protocolV2: network.v2,
        uptime: Math.round(process.uptime()),
        protocols: { supported: [1, 2], v1: network.v1, v2: network.v2 },
        world: {
          chunks: metrics.chunks,
          activeChunks: metrics.activeChunks,
          pinnedChunks: metrics.pinnedChunks,
          retainedChunks: metrics.retainedChunks,
          materializations: metrics.materializations,
          respawns: metrics.respawns,
        },
        entities: {
          total: metrics.entities,
          players: metrics.players,
          humans: metrics.humans,
          bots: metrics.bots,
          bombs: metrics.bombs,
          items: metrics.items,
          flames: metrics.flames,
        },
        network: {
          connections: network.connections,
          chunkSubscriptions: network.chunkSubscriptions ?? 0,
          entityRevision: network.entityRevision ?? 0,
          outboundMessages: network.outboundMessages ?? 0,
          outboundBytes: network.outboundBytes ?? 0,
          backpressureDisconnects: network.backpressureDisconnects ?? 0,
        },
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          externalBytes: memory.external,
          observationLimitBytes: 128 * 1024 * 1024,
        },
        scheduler: {
          lastTickDurationMs,
          lastEventLoopLagMs,
          lastCompletedTickAt,
          nextTickAt,
        },
      }),
    );
  }
  response.writeHead(404).end();
});

gateway = createWebSocketGateway({
  server,
  world,
  simulation,
  v1Serializer: v1,
  getClock: () => ({
    tick: simulation.tick,
    nextTickAt,
  }),
  tickMs: TICK_MS,
  worldEpochMs: WORLD_EPOCH_MS,
  bgmDurationMs: BGM_DURATION_MS,
  bgmSnareOffsetMs: BGM_SNARE_OFFSET_MS,
});

function runTick() {
  const startedAt = Date.now();
  lastEventLoopLagMs = Math.max(0, startedAt - nextTickAt);
  const timeline = timelineAt();
  const result = simulation.advanceToTick(timeline.tick);
  nextTickAt = timeline.nextTickAt;
  if (result.publish) gateway.publish({ heartbeat: true });
  lastTickDurationMs = Date.now() - startedAt;
  lastCompletedTickAt = Date.now();
}

let tickTimer;
function scheduleTick() {
  tickTimer = setTimeout(() => {
    runTick();
    scheduleTick();
  }, Math.max(1, nextTickAt - Date.now()));
  tickTimer.unref();
}

const aiTimer = setInterval(() => {
  let publish = false;
  for (const intent of botController.decideAll()) {
    const result = simulation.applyAction(intent.botId, intent.action);
    publish = result.changed || publish;
  }
  if (publish) gateway.publish();
}, AI_INTERVAL_MS);
aiTimer.unref();

scheduleTick();
server.listen(PORT, "127.0.0.1", () =>
  console.log(`BOOMnBOOM real-time movement server listening on 127.0.0.1:${PORT}`),
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearTimeout(tickTimer);
    clearInterval(aiTimer);
    gateway.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

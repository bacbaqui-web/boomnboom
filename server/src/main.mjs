import http from "node:http";
import { createBotController } from "./ai/bot-controller.mjs";
import { loadServerConfig } from "./config.mjs";
import { createHealthHandler } from "./health-handler.mjs";
import { createWebSocketGateway } from "./network/websocket-gateway.mjs";
import { createSimulationScheduler } from "./simulation-scheduler.mjs";
import { createGameSimulation } from "./simulation/game-simulation.mjs";
import { createWorldOwner } from "./world/world-owner.mjs";
import { createWorldTimeline } from "./world-timeline.mjs";

export function startServer({ environment = process.env, logger = console.log } = {}) {
  const config = loadServerConfig(environment);
  const timeline = createWorldTimeline({
    epochMs: config.worldEpochMs,
    tickMs: config.tickMs,
  });
  const initialTimeline = timeline.at();
  const world = createWorldOwner();
  const simulation = createGameSimulation({
    world,
    initialTick: initialTimeline.tick,
    moveIntervalMs: config.moveIntervalMs,
    crateRespawnTicks: 8,
    bombFuseTicks: 3,
  });
  const botController = createBotController({ world });
  for (let index = 0; index < config.botCount; index += 1) {
    simulation.addPlayer({ isAI: true });
  }

  let gateway;
  let handleHealth = () => false;
  const server = http.createServer((request, response) => {
    if (handleHealth(request, response)) return;
    response.writeHead(404).end();
  });
  const scheduler = createSimulationScheduler({
    simulation,
    botController,
    timeline,
    aiIntervalMs: config.aiIntervalMs,
    publish: (options) => gateway?.publish(options),
  });

  gateway = createWebSocketGateway({
    server,
    world,
    simulation,
    getClock: scheduler.readClock,
    tickMs: config.tickMs,
    worldEpochMs: config.worldEpochMs,
    bgmDurationMs: config.bgmDurationMs,
    bgmSnareOffsetMs: config.bgmSnareOffsetMs,
  });
  handleHealth = createHealthHandler({
    world,
    simulation,
    scheduler,
    readNetworkMetrics: gateway.readMetrics,
    tickMs: config.tickMs,
  });

  scheduler.start();
  server.listen(config.port, "127.0.0.1", () => {
    logger(
      `BOOMnBOOM real-time movement server listening on 127.0.0.1:${config.port}`,
    );
  });

  let shuttingDown = false;
  function shutdown({ exitProcess = false } = {}) {
    if (shuttingDown) return;
    shuttingDown = true;
    scheduler.stop();
    gateway.close();
    server.close(() => {
      if (exitProcess) process.exit(0);
    });
    if (exitProcess) setTimeout(() => process.exit(0), 1000).unref();
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => shutdown({ exitProcess: true }));
  }

  return { server, world, simulation, gateway, scheduler, shutdown };
}

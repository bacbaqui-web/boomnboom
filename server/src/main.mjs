import http from "node:http";
import { createBotController } from "./ai/bot-controller.mjs";
import { loadServerConfig } from "./config.mjs";
import { createHealthHandler } from "./health-handler.mjs";
import { createWebSocketGateway } from "./network/websocket-gateway.mjs";
import { createSimulationScheduler } from "./simulation-scheduler.mjs";
import { createFixedStepLoop } from "./simulation/fixed-step-loop.mjs";
import { createBombSystem } from "./simulation/bomb-system.mjs";
import { createExplosionSystem } from "./simulation/explosion-system.mjs";
import { createGameSimulation } from "./simulation/game-simulation.mjs";
import { createPlayerCommandBuffer } from "./simulation/player-command-buffer.mjs";
import { createPlayerMovementSystem } from "./simulation/player-movement-system.mjs";
import { createPlayerRespawnSystem } from "./simulation/player-respawn-system.mjs";
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
    bombFuseTicks: 3,
  });
  const botController = createBotController({ world });
  for (let index = 0; index < config.botCount; index += 1) {
    simulation.addPlayer({ isAI: true });
  }

  const commandBuffer = createPlayerCommandBuffer();
  const movementSystem = createPlayerMovementSystem({ world });
  const bombSystem = createBombSystem({
    world,
    tickRate: config.simulationTickRate,
    fuseTicks: config.simulationTickRate * 3,
  });
  const explosionSystem = createExplosionSystem({
    world,
    respawnAI(playerId, tick) {
      const before = world.getPlayer(playerId);
      const result = simulation.respawnPlayer(playerId);
      if (!result.accepted) return false;
      world.updatePlayer(playerId, {
        lifeId: (before?.lifeId ?? 1) + 1,
        teleportTick: tick % 2 === 0 ? tick : (tick + 1) >>> 0,
      });
      movementSystem.initializePlayer(playerId, { resetToCell: true });
      commandBuffer.resetPlayerIntent(playerId);
      return true;
    },
  });
  const respawnSystem = createPlayerRespawnSystem({
    world,
    simulation,
    movementSystem,
    commandBuffer,
  });

  let gateway;
  let v2MovementDirty = false;
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
  const fixedStepLoop = createFixedStepLoop({
    tickRate: config.simulationTickRate,
    maxCatchUpSteps: config.maxCatchUpSteps,
    onStep(serverTick) {
      const commands = commandBuffer.consumeTick(serverTick);
      const movement = movementSystem.step(serverTick, commands);
      const respawn = respawnSystem.step(serverTick, commands);
      const bombs = bombSystem.step(serverTick, commands, {
        blockedPlayerIds: respawn.respawnedPlayerIds,
      });
      const explosion = explosionSystem.step(serverTick);
      for (const damage of explosion.damaged) {
        if (damage.outcome === "death") commandBuffer.resetPlayerIntent(damage.playerId);
      }
      gateway?.publishV3ActionResults(
        [...respawn.results, ...bombs.results],
        serverTick,
      );
      gateway?.publishV3WorldEvents(explosion.events, serverTick);
      v2MovementDirty =
        v2MovementDirty ||
        movement.cellChanged ||
        movement.itemChanged ||
        respawn.changed ||
        bombs.changed ||
        explosion.changed;
      if (serverTick % 2 === 0) {
        if (v2MovementDirty) {
          gateway?.publish();
          v2MovementDirty = false;
        }
        gateway?.publishV3Snapshots(serverTick);
      }
    },
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
    commandBuffer,
    movementSystem,
    getV3Clock: fixedStepLoop.readClock,
    simulationTickRate: config.simulationTickRate,
    snapshotRate: config.snapshotRate,
  });
  handleHealth = createHealthHandler({
    world,
    simulation,
    scheduler,
    readNetworkMetrics: gateway.readMetrics,
    tickMs: config.tickMs,
    fixedStepLoop,
  });

  scheduler.start();
  fixedStepLoop.start();
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
    fixedStepLoop.stop();
    gateway.close();
    server.close(() => {
      if (exitProcess) process.exit(0);
    });
    if (exitProcess) setTimeout(() => process.exit(0), 1000).unref();
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => shutdown({ exitProcess: true }));
  }

  return {
    server,
    world,
    simulation,
    gateway,
    scheduler,
    fixedStepLoop,
    commandBuffer,
    movementSystem,
    bombSystem,
    explosionSystem,
    respawnSystem,
    shutdown,
  };
}

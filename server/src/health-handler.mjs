export function createHealthHandler({
  world,
  simulation,
  scheduler,
  readNetworkMetrics,
  tickMs,
  fixedStepLoop = null,
}) {
  return function handleHealth(request, response) {
    if (request.url !== "/health") return false;

    const metrics = world.readMetrics();
    const network = readNetworkMetrics();
    const memory = process.memoryUsage();
    const schedule = scheduler.readMetrics();
    const fixedSimulation = fixedStepLoop?.readMetrics() ?? null;
    const healthyTick = Date.now() - schedule.lastCompletedTickAt <= tickMs * 3;

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: healthyTick,
        tick: simulation.tick,
        players: metrics.players,
        chunks: metrics.chunks,
        bombs: metrics.bombs,
        items: metrics.items,
        connections: network.connections,
        protocolV1: 0,
        protocolV2: network.v2,
        protocolV3: network.v3 ?? 0,
        uptime: Math.round(process.uptime()),
        protocols: { supported: [2, 3], v1: 0, v2: network.v2, v3: network.v3 ?? 0 },
        world: {
          chunks: metrics.chunks,
          activeChunks: metrics.activeChunks,
          pinnedChunks: metrics.pinnedChunks,
          retainedChunks: metrics.retainedChunks,
          materializations: metrics.materializations,
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
          unsupportedProtocolRejects: network.unsupportedProtocolRejects ?? 0,
          rateLimitRejects: network.rateLimitRejects ?? 0,
          commandLate: network.late ?? 0,
          commandRejected:
            (network.stale ?? 0) +
            (network.futureRejected ?? 0) +
            (network.queueRejected ?? 0),
          queuedCommands: network.queuedCommands ?? 0,
          publishedSnapshots: network.publishedSnapshots ?? 0,
          playerLeases: network.playerLeases ?? 0,
          disconnectedLeases: network.disconnectedLeases ?? 0,
          resumeSuccess: network.resumeSuccess ?? 0,
          resumeRejected: network.resumeRejected ?? 0,
          resumeExpired: network.resumeExpired ?? 0,
        },
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          externalBytes: memory.external,
          observationLimitBytes: 128 * 1024 * 1024,
        },
        scheduler: schedule,
        fixedSimulation,
      }),
    );
    return true;
  };
}

export function createHealthHandler({
  world,
  simulation,
  scheduler,
  readNetworkMetrics,
  tickMs,
}) {
  return function handleHealth(request, response) {
    if (request.url !== "/health") return false;

    const metrics = world.readMetrics();
    const network = readNetworkMetrics();
    const memory = process.memoryUsage();
    const schedule = scheduler.readMetrics();
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
        uptime: Math.round(process.uptime()),
        protocols: { supported: [2], v1: 0, v2: network.v2 },
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
        },
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          externalBytes: memory.external,
          observationLimitBytes: 128 * 1024 * 1024,
        },
        scheduler: schedule,
      }),
    );
    return true;
  };
}

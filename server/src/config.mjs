function numericValue(value, fallback) {
  return Number(value ?? fallback);
}

export function loadServerConfig(environment = process.env) {
  return {
    port: numericValue(environment.PORT, 3300),
    tickMs: numericValue(environment.TICK_MS, 1000),
    moveIntervalMs: 1000 / 3,
    aiIntervalMs: 500,
    simulationTickRate: 30,
    snapshotRate: 15,
    maxCatchUpSteps: 5,
    worldEpochMs: numericValue(
      environment.WORLD_EPOCH_MS,
      Date.UTC(2026, 7, 14, 0, 0, 0),
    ),
    bgmDurationMs: 209995.5,
    bgmSnareOffsetMs: 255,
    botCount: 6,
  };
}

export function createPlayerRespawnSystem({
  world,
  simulation,
  movementSystem,
  commandBuffer,
} = {}) {
  function step(tick, commandsByPlayer) {
    const results = [];
    const respawnedPlayerIds = new Set();
    for (const [playerId, command] of commandsByPlayer) {
      for (const action of command.actions ?? []) {
        if (action.action !== "respawn") continue;
        const before = world.getPlayer(playerId);
        const result = simulation.respawnPlayer(playerId);
        if (result.accepted) {
          world.updatePlayer(playerId, {
            lifeId: (before?.lifeId ?? 1) + 1,
            teleportTick: tick % 2 === 0 ? tick : (tick + 1) >>> 0,
          });
          movementSystem.initializePlayer(playerId, { resetToCell: true });
          commandBuffer.resetPlayerIntent(playerId);
          respawnedPlayerIds.add(playerId);
        }
        results.push({
          playerId,
          commandSeq: action.commandSeq,
          action: "respawn",
          accepted: Boolean(result.accepted),
          reason: result.accepted ? null : "respawn_unavailable",
        });
      }
    }
    return { results, respawnedPlayerIds, changed: respawnedPlayerIds.size > 0 };
  }

  return { step };
}

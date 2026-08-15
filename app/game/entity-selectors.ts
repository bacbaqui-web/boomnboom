import type { BombEntity, EnemySummary, PlayerEntity, WorldEntity } from "./protocol";

function playerPosition(player: PlayerEntity) {
  return {
    x: typeof player.px === "number" ? player.px / 1024 - 0.5 : player.x,
    y: typeof player.py === "number" ? player.py / 1024 - 0.5 : player.y,
  };
}

export function findLocalBomb(entities: readonly WorldEntity[], localPlayer?: PlayerEntity) {
  return entities.find(
    (entity): entity is BombEntity =>
      entity.kind === "bomb" &&
      entity.x === localPlayer?.x &&
      entity.y === localPlayer?.y,
  );
}

export function selectEnemySummaries(
  entities: readonly WorldEntity[],
  localPlayer: PlayerEntity | undefined,
  serverSummaries: readonly EnemySummary[],
) {
  if (!localPlayer) return serverSummaries;
  const local = playerPosition(localPlayer);
  const summaries = new Map(serverSummaries.map((enemy) => [enemy.id, enemy]));
  for (const entity of entities) {
    if (
      entity.kind !== "player" ||
      entity.id === localPlayer.id ||
      !entity.alive
    ) {
      continue;
    }
    const remote = playerPosition(entity);
    const dx = remote.x - local.x;
    const dy = remote.y - local.y;
    summaries.set(entity.id, {
      id: entity.id,
      dx,
      dy,
      distance: Math.max(1, Math.round(Math.abs(dx) + Math.abs(dy))),
      nickname: entity.nickname,
      isAI: entity.isAI,
    });
  }
  return [...summaries.values()];
}

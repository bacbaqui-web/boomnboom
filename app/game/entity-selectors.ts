import type { BombEntity, PlayerEntity, WorldEntity } from "./protocol";

export function findLocalBomb(entities: readonly WorldEntity[], localPlayer?: PlayerEntity) {
  return entities.find(
    (entity): entity is BombEntity =>
      entity.kind === "bomb" &&
      entity.x === localPlayer?.x &&
      entity.y === localPlayer?.y,
  );
}

import { worldToChunk } from "../world/coordinates.mjs";

export function projectPlayer(player) {
  return {
    kind: "player",
    id: player.id,
    x: player.x,
    y: player.y,
    isAI: player.isAI,
    action: player.action,
    score: player.score,
    power: player.power,
    range: player.range,
    shield: player.shield,
    speedLevel: Number.isSafeInteger(player.speedLevel) ? player.speedLevel : 0,
    nickname: player.nickname,
    joined: player.joined,
    alive: player.alive,
  };
}

function projectBomb(bomb) {
  return { kind: "bomb", ...bomb };
}

function projectItem(item) {
  return { kind: "item", id: `${item.x},${item.y}`, ...item };
}

function projectFlame(flame) {
  return { kind: "flame", id: `${flame.x},${flame.y}`, ...flame };
}

function entityKey(entity) {
  return `${entity.kind}:${entity.id}`;
}

function entityChunkKey(entity, chunkSize) {
  return worldToChunk(entity.x, entity.y, chunkSize).chunkKey;
}

export function projectEntityMap(world, chunkSize, interest = null, localPlayerId = null) {
  const entities = [
    ...world
      .readPlayers()
      .filter((player) => player.alive || player.id === localPlayerId)
      .map(projectPlayer),
    ...world.readBombs().map(projectBomb),
    ...world.readItems().map(projectItem),
    ...world.readFlames().map(projectFlame),
  ];
  return new Map(
    entities
      .filter(
        (entity) =>
          (entity.kind === "player" && entity.id === localPlayerId) ||
          !interest ||
          interest.has(entityChunkKey(entity, chunkSize)),
      )
      .map((entity) => [entityKey(entity), entity]),
  );
}

export function groupProjectedEntities(entityMap) {
  const values = [...entityMap.values()];
  return {
    players: values.filter((entity) => entity.kind === "player"),
    bombs: values.filter((entity) => entity.kind === "bomb"),
    items: values.filter((entity) => entity.kind === "item"),
    flames: values.filter((entity) => entity.kind === "flame"),
  };
}

export function projectEnemySummaries(world, localPlayerId) {
  const localPlayer = world.getPlayer(localPlayerId);
  if (!localPlayer) return [];
  return world
    .readPlayers()
    .filter((player) => player.id !== localPlayerId && player.alive)
    .map((player) => ({
      id: player.id,
      dx: player.x - localPlayer.x,
      dy: player.y - localPlayer.y,
      distance: Math.abs(player.x - localPlayer.x) + Math.abs(player.y - localPlayer.y),
      nickname: player.nickname,
      isAI: player.isAI,
    }));
}

export function diffEntityMaps(before, after) {
  const created = [];
  const updated = [];
  const removed = [];
  for (const [key, entity] of after) {
    const previous = before.get(key);
    if (!previous) created.push(entity);
    else if (JSON.stringify(previous) !== JSON.stringify(entity)) updated.push(entity);
  }
  for (const key of before.keys()) {
    if (!after.has(key)) removed.push(key);
  }
  return { created, updated, removed };
}

export function hasEntityChanges(diff) {
  return diff.created.length > 0 || diff.updated.length > 0 || diff.removed.length > 0;
}

const CARDINAL_DIRECTIONS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function candidateCellsAround(centerX, centerY, maxRadius = 6) {
  const cells = [{ x: centerX, y: centerY }];
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const dy = radius - Math.abs(dx);
      cells.push({ x: centerX + dx, y: centerY - dy });
      if (dy !== 0) cells.push({ x: centerX + dx, y: centerY + dy });
    }
  }
  return cells;
}

function canSpawnAt({ world, x, y, players, bombs, minimumPlayerDistance }) {
  if (world.readTile(x, y) !== "floor") return false;
  if (bombs.some((bomb) => bomb.x === x && bomb.y === y)) return false;
  if (
    players.some(
      (player) =>
        player.alive && Math.abs(player.x - x) + Math.abs(player.y - y) < minimumPlayerDistance,
    )
  ) {
    return false;
  }
  return CARDINAL_DIRECTIONS.some(
    ([dx, dy]) =>
      world.readTile(x + dx, y + dy) === "floor" &&
      !bombs.some((bomb) => bomb.x === x + dx && bomb.y === y + dy),
  );
}

export function findSpawn({
  world,
  players = [],
  bombs = [],
  spawnNumber = 1,
  isAI = false,
  minimumPlayerDistance = 10,
}) {
  const anchor = players[0] ?? { x: 1, y: 1 };
  const targets = [];
  if (isAI && players.length === 0) targets.push({ x: 1, y: 1 });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const distance = 14 + ((spawnNumber * 7 + attempt * 5) % 15);
    const angle = spawnNumber * 2.399 + attempt * 0.73;
    targets.push({
      x: Math.round(anchor.x + Math.cos(angle) * distance),
      y: Math.round(anchor.y + Math.sin(angle) * distance),
    });
  }

  for (const target of targets) {
    for (const candidate of candidateCellsAround(target.x, target.y)) {
      if (
        canSpawnAt({
          world,
          ...candidate,
          players,
          bombs,
          minimumPlayerDistance,
        })
      ) {
        return [candidate.x, candidate.y];
      }
    }
  }

  for (let radius = 10; radius <= 160; radius += 2) {
    for (const candidate of candidateCellsAround(anchor.x, anchor.y, radius).slice(-radius * 4)) {
      if (
        canSpawnAt({
          world,
          ...candidate,
          players,
          bombs,
          minimumPlayerDistance,
        })
      ) {
        return [candidate.x, candidate.y];
      }
    }
  }
  throw new Error("Unable to find a safe spawn without changing terrain");
}

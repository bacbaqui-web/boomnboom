const BLAST_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function blastCellsForBomb({ bomb, isPermanentWall, hasCrate }) {
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const [dx, dy] of BLAST_DIRECTIONS) {
    for (let distance = 1; distance <= bomb.range; distance += 1) {
      const x = bomb.x + dx * distance;
      const y = bomb.y + dy * distance;
      if (isPermanentWall(x, y)) break;
      cells.push({ x, y });
      if (hasCrate(x, y)) break;
    }
  }
  return cells;
}

export function resolveChainExplosions(initialBombs, armedBombs, terrain) {
  const triggered = [...initialBombs];
  const triggeredIds = new Set(triggered.map((bomb) => bomb.id));
  const cells = new Map();

  for (let index = 0; index < triggered.length; index += 1) {
    const bomb = triggered[index];
    const blast = blastCellsForBomb({ bomb, ...terrain });
    for (const cell of blast) cells.set(`${cell.x},${cell.y}`, cell);
    const blastKeys = new Set(blast.map((cell) => `${cell.x},${cell.y}`));
    for (const candidate of armedBombs) {
      if (
        triggeredIds.has(candidate.id) ||
        !blastKeys.has(`${candidate.x},${candidate.y}`)
      ) {
        continue;
      }
      triggeredIds.add(candidate.id);
      triggered.push(candidate);
    }
  }

  return { bombs: triggered, cells };
}

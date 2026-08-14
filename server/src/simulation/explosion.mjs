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

export function uniqueBlastCells(bombs, terrain) {
  const cells = new Map();
  for (const bomb of bombs) {
    for (const cell of blastCellsForBomb({ bomb, ...terrain })) {
      cells.set(`${cell.x},${cell.y}`, cell);
    }
  }
  return cells;
}

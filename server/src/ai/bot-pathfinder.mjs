export const BOT_DIRECTIONS = Object.freeze({
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
});

const DEFAULT_DIRECTION_ORDER = Object.freeze(["up", "right", "down", "left"]);

function normalizedDirectionOrder(directionOrder = DEFAULT_DIRECTION_ORDER) {
  const result = [];
  for (const direction of [...directionOrder, ...DEFAULT_DIRECTION_ORDER]) {
    if (BOT_DIRECTIONS[direction] && !result.includes(direction)) result.push(direction);
  }
  return result;
}

export function findBotPath({
  start,
  isGoal,
  canEnter,
  directionOrder = DEFAULT_DIRECTION_ORDER,
  maxSteps = 10,
  maxVisited = 384,
} = {}) {
  if (!start || typeof isGoal !== "function" || typeof canEnter !== "function") {
    return null;
  }
  const order = normalizedDirectionOrder(directionOrder);
  const queue = [{ x: start.x, y: start.y, directions: [], cells: [] }];
  const visited = new Set([`${start.x},${start.y}`]);

  if (isGoal(start.x, start.y, { step: 0 })) {
    return { directions: [], cells: [], visited: 1 };
  }

  for (let index = 0; index < queue.length && visited.size < maxVisited; index += 1) {
    const current = queue[index];
    if (current.directions.length >= maxSteps) continue;
    for (const direction of order) {
      const [dx, dy] = BOT_DIRECTIONS[direction];
      const x = current.x + dx;
      const y = current.y + dy;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      const step = current.directions.length + 1;
      if (!canEnter(x, y, { step, fromX: current.x, fromY: current.y })) continue;
      visited.add(key);
      const next = {
        x,
        y,
        directions: [...current.directions, direction],
        cells: [...current.cells, { x, y }],
      };
      if (isGoal(x, y, { step })) return { ...next, visited: visited.size };
      queue.push(next);
      if (visited.size >= maxVisited) break;
    }
  }
  return null;
}

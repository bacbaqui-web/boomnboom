import { addNetTicks, isNetTickAfter } from "./net-tick.mjs";
import { DEFAULT_MOVEMENT_CONFIG } from "./movement-config.mjs";

const DIRECTION_VECTOR = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
  neutral: Object.freeze({ x: 0, y: 0 }),
});

function validateDirection(direction) {
  if (!Object.hasOwn(DIRECTION_VECTOR, direction)) {
    throw new TypeError("direction must be up, down, left, right, or neutral");
  }
}

function validateState(state) {
  for (const key of ["px", "py", "vx", "vy", "queuedTurnUntilTick"]) {
    if (!Number.isSafeInteger(state[key])) {
      throw new TypeError(`movement state ${key} must be a safe integer`);
    }
  }
  validateDirection(state.desiredDirection);
  if (state.queuedTurn !== null) {
    validateDirection(state.queuedTurn);
    if (state.queuedTurn === "neutral") {
      throw new TypeError("queued turn must be a cardinal direction or null");
    }
  }
}

function validateConfig(config) {
  for (const key of [
    "unitsPerTile",
    "tickRate",
    "maxSpeedPerTick",
    "accelerationPerTick",
    "decelerationPerTick",
    "collisionHalfExtent",
    "turnCenterTolerance",
    "turnGraceTicks",
  ]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 0) {
      throw new TypeError(`movement config ${key} must be a non-negative integer`);
    }
  }
  if (
    config.unitsPerTile === 0 ||
    config.tickRate === 0 ||
    config.maxSpeedPerTick === 0 ||
    config.accelerationPerTick === 0 ||
    config.decelerationPerTick === 0 ||
    config.collisionHalfExtent * 2 >= config.unitsPerTile ||
    config.turnCenterTolerance * 2 >= config.unitsPerTile ||
    config.unitsPerTile % 2 !== 0 ||
    config.turnGraceTicks >= 0x8000_0000
  ) {
    throw new RangeError("movement config contains an unusable zero or oversized value");
  }
}

function validateCollisionReader(collisionReader) {
  if (!collisionReader || typeof collisionReader.isBlockedCell !== "function") {
    throw new TypeError("collisionReader.isBlockedCell must be a function");
  }
}

function floorDiv(value, divisor) {
  return Math.floor(value / divisor);
}

function cellCenter(position, unitsPerTile) {
  return floorDiv(position, unitsPerTile) * unitsPerTile + unitsPerTile / 2;
}

function directionAxis(direction) {
  if (direction === "left" || direction === "right") return "x";
  if (direction === "up" || direction === "down") return "y";
  return null;
}

function movementAxis(state) {
  if (state.vx !== 0 && state.vy === 0) return "x";
  if (state.vy !== 0 && state.vx === 0) return "y";
  return directionAxis(state.desiredDirection);
}

function moveTowards(value, target, amount) {
  if (value < target) return Math.min(value + amount, target);
  if (value > target) return Math.max(value - amount, target);
  return value;
}

function nextAxisVelocity(value, target, config) {
  if (target === 0) return moveTowards(value, 0, config.decelerationPerTick);
  if (value !== 0 && Math.sign(value) !== Math.sign(target)) {
    return moveTowards(value, 0, config.decelerationPerTick);
  }
  return moveTowards(value, target, config.accelerationPerTick);
}

function overlappedCells(start, endExclusive, unitsPerTile) {
  const first = floorDiv(start, unitsPerTile);
  const last = floorDiv(endExclusive - 1, unitsPerTile);
  const cells = [];
  for (let cell = first; cell <= last; cell += 1) cells.push(cell);
  return cells;
}

function sweepX(px, py, dx, collisionReader, config) {
  if (dx === 0) return { position: px, contacts: [] };
  const { collisionHalfExtent: half, unitsPerTile: units } = config;
  const rows = overlappedCells(py - half, py + half, units);
  const direction = Math.sign(dx);
  const startEdge = px + direction * half;
  const target = px + dx;
  const targetEdge = target + direction * half;
  const startCell = direction > 0
    ? floorDiv(startEdge - 1, units)
    : floorDiv(startEdge, units);
  const endCell = direction > 0
    ? floorDiv(targetEdge - 1, units)
    : floorDiv(targetEdge, units);

  for (
    let cellX = startCell + direction;
    direction > 0 ? cellX <= endCell : cellX >= endCell;
    cellX += direction
  ) {
    const blockedRows = rows.filter((cellY) => collisionReader.isBlockedCell(cellX, cellY));
    if (blockedRows.length === 0) continue;
    const boundary = direction > 0 ? cellX * units : (cellX + 1) * units;
    return {
      position: boundary - direction * half,
      contacts: blockedRows.map((cellY) => ({ axis: "x", direction, cellX, cellY })),
    };
  }
  return { position: target, contacts: [] };
}

function sweepY(px, py, dy, collisionReader, config) {
  if (dy === 0) return { position: py, contacts: [] };
  const { collisionHalfExtent: half, unitsPerTile: units } = config;
  const columns = overlappedCells(px - half, px + half, units);
  const direction = Math.sign(dy);
  const startEdge = py + direction * half;
  const target = py + dy;
  const targetEdge = target + direction * half;
  const startCell = direction > 0
    ? floorDiv(startEdge - 1, units)
    : floorDiv(startEdge, units);
  const endCell = direction > 0
    ? floorDiv(targetEdge - 1, units)
    : floorDiv(targetEdge, units);

  for (
    let cellY = startCell + direction;
    direction > 0 ? cellY <= endCell : cellY >= endCell;
    cellY += direction
  ) {
    const blockedColumns = columns.filter((cellX) => collisionReader.isBlockedCell(cellX, cellY));
    if (blockedColumns.length === 0) continue;
    const boundary = direction > 0 ? cellY * units : (cellY + 1) * units;
    return {
      position: boundary - direction * half,
      contacts: blockedColumns.map((cellX) => ({ axis: "y", direction, cellX, cellY })),
    };
  }
  return { position: target, contacts: [] };
}

function canTurn(state, direction, collisionReader, config) {
  const currentAxis = movementAxis(state);
  const nextAxis = directionAxis(direction);
  if (currentAxis === null || currentAxis === nextAxis) {
    return { accepted: true, px: state.px, py: state.py };
  }

  const alignmentAxis = currentAxis === "x" ? "px" : "py";
  const center = cellCenter(state[alignmentAxis], config.unitsPerTile);
  if (Math.abs(state[alignmentAxis] - center) > config.turnCenterTolerance) {
    return { accepted: false, px: state.px, py: state.py };
  }

  const aligned = { px: state.px, py: state.py, [alignmentAxis]: center };
  const vector = DIRECTION_VECTOR[direction];
  const cellX = floorDiv(aligned.px, config.unitsPerTile) + vector.x;
  const cellY = floorDiv(aligned.py, config.unitsPerTile) + vector.y;
  if (collisionReader.isBlockedCell(cellX, cellY)) {
    return { accepted: false, px: state.px, py: state.py };
  }
  return { accepted: true, px: aligned.px, py: aligned.py };
}

function applyTurn(state, direction, alignedPosition, config) {
  const nextAxis = directionAxis(direction);
  const speed = Math.min(Math.max(Math.abs(state.vx), Math.abs(state.vy)), config.maxSpeedPerTick);
  const vector = DIRECTION_VECTOR[direction];
  return {
    ...state,
    px: alignedPosition.px,
    py: alignedPosition.py,
    vx: nextAxis === "x" ? vector.x * speed : 0,
    vy: nextAxis === "y" ? vector.y * speed : 0,
    desiredDirection: direction,
    queuedTurn: null,
  };
}

function resolveDirection(state, input, collisionReader, config) {
  const tick = input.tick;
  let next = { ...state };
  if (next.queuedTurn !== null && isNetTickAfter(tick, next.queuedTurnUntilTick)) {
    next.queuedTurn = null;
  }

  if (input.direction === "neutral") {
    return { ...next, desiredDirection: "neutral", queuedTurn: null };
  }

  const inputMatchesQueue = input.direction === next.queuedTurn;
  const inputKeepsCurrentDirection = input.direction === next.desiredDirection;
  const candidate = inputKeepsCurrentDirection && next.queuedTurn !== null
    ? next.queuedTurn
    : input.direction;
  const turn = canTurn(next, candidate, collisionReader, config);

  if (turn.accepted) {
    const currentAxis = movementAxis(next);
    const nextAxis = directionAxis(candidate);
    if (currentAxis !== null && currentAxis !== nextAxis) {
      return applyTurn(next, candidate, turn, config);
    }
    return {
      ...next,
      desiredDirection: candidate,
      queuedTurn: null,
    };
  }

  if (!inputKeepsCurrentDirection || inputMatchesQueue) {
    next.queuedTurn = candidate;
    next.queuedTurnUntilTick = addNetTicks(tick, config.turnGraceTicks);
  }
  return next;
}

export function stepMovement(
  state,
  input,
  collisionReader,
  config = DEFAULT_MOVEMENT_CONFIG,
) {
  validateState(state);
  validateDirection(input?.direction);
  if (!Number.isSafeInteger(input?.tick)) {
    throw new TypeError("movement input tick must be a safe integer");
  }
  validateCollisionReader(collisionReader);
  validateConfig(config);

  const directed = resolveDirection(state, input, collisionReader, config);
  const vector = DIRECTION_VECTOR[directed.desiredDirection];
  const targetVx = vector.x * config.maxSpeedPerTick;
  const targetVy = vector.y * config.maxSpeedPerTick;
  let vx = nextAxisVelocity(directed.vx, targetVx, config);
  let vy = nextAxisVelocity(directed.vy, targetVy, config);
  const xSweep = sweepX(directed.px, directed.py, vx, collisionReader, config);
  if (xSweep.contacts.length > 0) vx = 0;
  const ySweep = sweepY(xSweep.position, directed.py, vy, collisionReader, config);
  if (ySweep.contacts.length > 0) vy = 0;

  return {
    state: {
      ...directed,
      px: xSweep.position,
      py: ySweep.position,
      vx,
      vy,
    },
    contacts: [...xSweep.contacts, ...ySweep.contacts],
  };
}

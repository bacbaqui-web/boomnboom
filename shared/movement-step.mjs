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
  const targetCellX = state.targetCellX ?? null;
  const targetCellY = state.targetCellY ?? null;
  if (
    (targetCellX !== null && !Number.isSafeInteger(targetCellX)) ||
    (targetCellY !== null && !Number.isSafeInteger(targetCellY)) ||
    (targetCellX === null) !== (targetCellY === null)
  ) {
    throw new TypeError("movement target cells must both be safe integers or null");
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

function cellCenterFromIndex(cell, unitsPerTile) {
  return cell * unitsPerTile + unitsPerTile / 2;
}

function directionAxis(direction) {
  if (direction === "left" || direction === "right") return "x";
  if (direction === "up" || direction === "down") return "y";
  return null;
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

function normalizedState(state) {
  return {
    ...state,
    targetCellX: state.targetCellX ?? null,
    targetCellY: state.targetCellY ?? null,
  };
}

function targetForState(state, config) {
  if (state.targetCellX === null || state.targetCellY === null) return null;
  return {
    cellX: state.targetCellX,
    cellY: state.targetCellY,
    px: cellCenterFromIndex(state.targetCellX, config.unitsPerTile),
    py: cellCenterFromIndex(state.targetCellY, config.unitsPerTile),
  };
}

function directionToTarget(state, target) {
  if (target.px > state.px) return "right";
  if (target.px < state.px) return "left";
  if (target.py > state.py) return "down";
  if (target.py < state.py) return "up";
  return "neutral";
}

function commitAdjacentTarget(state, direction, collisionReader, config, { preserveVelocity = false } = {}) {
  const vector = DIRECTION_VECTOR[direction];
  const cellX = floorDiv(state.px, config.unitsPerTile);
  const cellY = floorDiv(state.py, config.unitsPerTile);
  const targetCellX = cellX + vector.x;
  const targetCellY = cellY + vector.y;
  if (collisionReader.isBlockedCell(targetCellX, targetCellY)) {
    return {
      ...state,
      vx: 0,
      vy: 0,
      targetCellX: null,
      targetCellY: null,
      queuedTurn: null,
    };
  }
  const axis = directionAxis(direction);
  const currentCenterX = cellCenter(state.px, config.unitsPerTile);
  const currentCenterY = cellCenter(state.py, config.unitsPerTile);
  const velocityMatches =
    preserveVelocity &&
    ((axis === "x" && Math.sign(state.vx) === vector.x) ||
      (axis === "y" && Math.sign(state.vy) === vector.y));
  return {
    ...state,
    px: axis === "y" ? currentCenterX : state.px,
    py: axis === "x" ? currentCenterY : state.py,
    vx: velocityMatches && axis === "x" ? state.vx : 0,
    vy: velocityMatches && axis === "y" ? state.vy : 0,
    targetCellX,
    targetCellY,
    queuedTurn: null,
  };
}

function resolveIntent(state, input, collisionReader, config) {
  const tick = input.tick;
  let next = normalizedState(state);
  if (next.queuedTurn !== null && isNetTickAfter(tick, next.queuedTurnUntilTick)) {
    next.queuedTurn = null;
  }
  next.desiredDirection = input.direction;
  const target = targetForState(next, config);
  if (target) {
    const committedDirection = directionToTarget(next, target);
    if (
      input.direction !== "neutral" &&
      input.direction !== committedDirection
    ) {
      next.queuedTurn = input.direction;
      next.queuedTurnUntilTick = addNetTicks(tick, config.turnGraceTicks);
    }
    return next;
  }
  const candidate = input.direction !== "neutral" ? input.direction : next.queuedTurn;
  if (candidate && candidate !== "neutral") {
    return commitAdjacentTarget(next, candidate, collisionReader, config);
  }
  return {
    ...next,
    vx: 0,
    vy: 0,
    targetCellX: null,
    targetCellY: null,
  };
}

function continueAfterArrival(state, input, travelDirection, collisionReader, config) {
  const queuedIsLive =
    state.queuedTurn !== null &&
    !isNetTickAfter(input.tick, state.queuedTurnUntilTick);
  const candidate = input.direction !== "neutral"
    ? input.direction
    : queuedIsLive
      ? state.queuedTurn
      : null;
  const arrived = {
    ...state,
    targetCellX: null,
    targetCellY: null,
  };
  if (!candidate) {
    return { ...arrived, vx: 0, vy: 0, queuedTurn: null };
  }
  return commitAdjacentTarget(arrived, candidate, collisionReader, config, {
    preserveVelocity: candidate === travelDirection,
  });
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

  const directed = resolveIntent(state, input, collisionReader, config);
  const target = targetForState(directed, config);
  if (!target) {
    return { state: directed, contacts: [] };
  }
  const travelDirection = directionToTarget(directed, target);
  const vector = DIRECTION_VECTOR[travelDirection];
  const targetVx = vector.x * config.maxSpeedPerTick;
  const targetVy = vector.y * config.maxSpeedPerTick;
  const acceleratedVx = nextAxisVelocity(directed.vx, targetVx, config);
  const acceleratedVy = nextAxisVelocity(directed.vy, targetVy, config);
  const remainingX = target.px - directed.px;
  const remainingY = target.py - directed.py;
  let vx = Math.sign(acceleratedVx) * Math.min(Math.abs(acceleratedVx), Math.abs(remainingX));
  let vy = Math.sign(acceleratedVy) * Math.min(Math.abs(acceleratedVy), Math.abs(remainingY));
  const lineLocked = {
    ...directed,
    px: vector.y === 0 ? directed.px : target.px,
    py: vector.x === 0 ? directed.py : target.py,
  };
  const xSweep = sweepX(lineLocked.px, lineLocked.py, vx, collisionReader, config);
  if (xSweep.contacts.length > 0) vx = 0;
  const ySweep = sweepY(xSweep.position, lineLocked.py, vy, collisionReader, config);
  if (ySweep.contacts.length > 0) vy = 0;

  const moved = {
    ...lineLocked,
    px: xSweep.position,
    py: ySweep.position,
    vx,
    vy,
  };
  const arrived = moved.px === target.px && moved.py === target.py;

  const arrivalState = arrived
    ? { ...moved, vx: acceleratedVx, vy: acceleratedVy }
    : moved;
  return {
    state: arrived
      ? continueAfterArrival(arrivalState, input, travelDirection, collisionReader, config)
      : moved,
    contacts: [...xSweep.contacts, ...ySweep.contacts],
  };
}

import { addNetTicks, isNetTickAfter } from "../../../shared/net-tick.mjs";
import { speedTilesPerSecond } from "../../../shared/movement-config.mjs";
import { blastCellsForBomb } from "../simulation/explosion.mjs";
import { createBotDangerMap } from "./bot-danger-map.mjs";
import { BOT_DIRECTIONS, findBotPath } from "./bot-pathfinder.mjs";

const DEFAULT_TICK_RATE = 30;
const DEFAULT_FUSE_TICKS = 90;
const DEFAULT_FLAME_TICKS = 15;

function cellKey(x, y) {
  return `${x},${y}`;
}

function directionOrder(preferredDirection, avoidedDirection) {
  const defaults = ["up", "right", "down", "left"];
  return [preferredDirection, ...defaults]
    .filter(Boolean)
    .filter((direction) => BOT_DIRECTIONS[direction])
    .filter((direction, index, values) => values.indexOf(direction) === index)
    .sort((left, right) => {
      if (left === avoidedDirection) return 1;
      if (right === avoidedDirection) return -1;
      return 0;
    });
}

function movementTicksPerCell(bot, tickRate) {
  return Math.max(1, Math.ceil(tickRate / speedTilesPerSecond(bot.speedLevel ?? 0)));
}

function blastAt(x, y, range, terrain) {
  return blastCellsForBomb({
    bomb: { x, y, range },
    isPermanentWall: terrain.isPermanentWall,
    hasCrate: terrain.hasCrate,
  });
}

function targetInBlast(x, y, range, target, terrain) {
  return blastAt(x, y, range, terrain).some(
    (cell) => cell.x === target.x && cell.y === target.y,
  );
}

function crateCountInBlast(x, y, range, terrain) {
  return blastAt(x, y, range, terrain).filter(
    (cell) => terrain.hasCrate(cell.x, cell.y),
  ).length;
}

function createBlockedReader({ bot, players, bombs, terrain }) {
  const bombCells = new Set(bombs.map((bomb) => cellKey(bomb.x, bomb.y)));
  const playerCells = new Set(
    players
      .filter((player) => player.alive && player.id !== bot.id)
      .map((player) => cellKey(player.x, player.y)),
  );
  return (x, y) =>
    terrain.isPermanentWall(x, y) ||
    terrain.hasCrate(x, y) ||
    bombCells.has(cellKey(x, y)) ||
    playerCells.has(cellKey(x, y));
}

function createPlanner({
  bot,
  players,
  bombs,
  terrain,
  dangerMap,
  profile,
  preferredDirection,
  avoidedDirection,
  tickRate,
}) {
  const isBlocked = createBlockedReader({ bot, players, bombs, terrain });
  const ticksPerCell = movementTicksPerCell(bot, tickRate);
  const order = directionOrder(preferredDirection, avoidedDirection);
  let searches = 0;

  function pathTo(isGoal, { maxSteps = profile.searchSteps, dangerLingerTicks = 6 } = {}) {
    searches += 1;
    return findBotPath({
      start: { x: bot.x, y: bot.y },
      isGoal,
      directionOrder: order,
      maxSteps,
      maxVisited: profile.maxVisited,
      canEnter(x, y, { step }) {
        if (isBlocked(x, y)) return false;
        const arrival = step * ticksPerCell;
        return !dangerMap.isDangerousWithin(
          x,
          y,
          Math.max(0, arrival - ticksPerCell),
          arrival + dangerLingerTicks,
        );
      },
    });
  }

  function escapePath() {
    const horizon = profile.escapeLookaheadTicks + DEFAULT_FLAME_TICKS;
    return pathTo(
      (x, y, { step }) => {
        if (step === 0) return false;
        const arrival = step * ticksPerCell;
        return !dangerMap.isDangerousWithin(x, y, arrival, horizon);
      },
      { maxSteps: profile.searchSteps, dangerLingerTicks: 2 },
    );
  }

  function safeDirections() {
    return order.filter((direction) => {
      const [dx, dy] = BOT_DIRECTIONS[direction];
      const x = bot.x + dx;
      const y = bot.y + dy;
      return (
        !isBlocked(x, y) &&
        !dangerMap.isDangerousWithin(x, y, 0, ticksPerCell + 6)
      );
    });
  }

  return {
    pathTo,
    escapePath,
    safeDirections,
    get searches() {
      return searches;
    },
  };
}

function mayPlaceBomb({ bot, bombs, currentTick, bombCooldownUntilTick }) {
  if (
    Number.isSafeInteger(bombCooldownUntilTick) &&
    isNetTickAfter(bombCooldownUntilTick, currentTick)
  ) {
    return false;
  }
  if (bombs.some((bomb) => bomb.x === bot.x && bomb.y === bot.y)) return false;
  return bombs.filter((bomb) => bomb.owner === bot.id).length < bot.power;
}

function bombHasEscape({
  bot,
  players,
  bombs,
  flames,
  currentTick,
  terrain,
  profile,
  preferredDirection,
  avoidedDirection,
  tickRate,
  fuseTicks,
}) {
  const candidate = {
    id: `BOT-PLAN-${bot.id}`,
    x: bot.x,
    y: bot.y,
    owner: bot.id,
    range: bot.range,
    explodeTick: addNetTicks(currentTick, fuseTicks),
  };
  const dangerMap = createBotDangerMap({
    bombs: [...bombs, candidate],
    flames,
    currentTick,
    tickRate,
    flameTicks: DEFAULT_FLAME_TICKS,
    isPermanentWall: terrain.isPermanentWall,
  });
  const planner = createPlanner({
    bot,
    players,
    bombs: [...bombs, candidate],
    terrain,
    dangerMap,
    profile,
    preferredDirection,
    avoidedDirection,
    tickRate,
  });
  return planner.escapePath();
}

export function chooseBotTactic({
  bot,
  target,
  players = [],
  bombs = [],
  items = [],
  flames = [],
  currentTick = 0,
  terrain,
  dangerMap,
  profile,
  preferredDirection = null,
  avoidedDirection = null,
  bombCooldownUntilTick = null,
  tickRate = DEFAULT_TICK_RATE,
  fuseTicks = DEFAULT_FUSE_TICKS,
} = {}) {
  if (!bot?.alive || !target?.alive) {
    return { action: "wait", reason: "idle", alternatives: [], searches: 0 };
  }
  const planner = createPlanner({
    bot,
    players,
    bombs,
    terrain,
    dangerMap,
    profile,
    preferredDirection,
    avoidedDirection,
    tickRate,
  });

  if (
    dangerMap.isDangerousWithin(
      bot.x,
      bot.y,
      0,
      profile.escapeLookaheadTicks,
    )
  ) {
    const escape = planner.escapePath();
    const alternatives = planner.safeDirections();
    return {
      action: escape?.directions[0] ?? alternatives[0] ?? "wait",
      reason: "escape",
      alternatives,
      searches: planner.searches,
    };
  }

  const itemKeys = new Set(items.map((item) => cellKey(item.x, item.y)));
  if (itemKeys.size > 0) {
    const itemPath = planner.pathTo(
      (x, y) => itemKeys.has(cellKey(x, y)),
      { maxSteps: profile.itemSearchSteps, dangerLingerTicks: DEFAULT_FLAME_TICKS },
    );
    if (itemPath) {
      return {
        action: itemPath.directions[0] ?? "wait",
        reason: "item",
        alternatives: planner.safeDirections(),
        searches: planner.searches,
      };
    }
  }

  const canBomb = mayPlaceBomb({ bot, bombs, currentTick, bombCooldownUntilTick });
  const hitsTarget = targetInBlast(bot.x, bot.y, bot.range, target, terrain);
  const crateCount = crateCountInBlast(bot.x, bot.y, bot.range, terrain);
  if (canBomb && (hitsTarget || crateCount > 0)) {
    const escape = bombHasEscape({
      bot,
      players,
      bombs,
      flames,
      currentTick,
      terrain,
      profile,
      preferredDirection,
      avoidedDirection,
      tickRate,
      fuseTicks,
    });
    if (escape) {
      return {
        action: "bomb",
        reason: hitsTarget ? "attack_bomb" : "crate_bomb",
        alternatives: planner.safeDirections(),
        searches: planner.searches + 1,
      };
    }
  }

  const attackPath = planner.pathTo(
    (x, y) => targetInBlast(x, y, bot.range, target, terrain),
  );
  if (attackPath?.directions[0]) {
    return {
      action: attackPath.directions[0],
      reason: "chase",
      alternatives: planner.safeDirections(),
      searches: planner.searches,
    };
  }

  const cratePath = planner.pathTo(
    (x, y) => crateCountInBlast(x, y, bot.range, terrain) > 0,
    { maxSteps: Math.min(profile.searchSteps, 8) },
  );
  if (cratePath?.directions[0]) {
    return {
      action: cratePath.directions[0],
      reason: "crate",
      alternatives: planner.safeDirections(),
      searches: planner.searches,
    };
  }

  const alternatives = planner.safeDirections();
  return {
    action: alternatives[0] ?? "wait",
    reason: alternatives.length > 0 ? "wander" : "blocked",
    alternatives,
    searches: planner.searches,
  };
}

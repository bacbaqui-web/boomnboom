import { netTickDelta } from "../../../shared/net-tick.mjs";
import { blastCellsForBomb } from "../simulation/explosion.mjs";

function cellKey(x, y) {
  return `${x},${y}`;
}

function relativeTick(tick, currentTick) {
  if (!Number.isSafeInteger(tick)) return 0;
  return Math.max(0, netTickDelta(tick, currentTick));
}

function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((left, right) =>
    left.start === right.start ? left.end - right.end : left.start - right.start,
  );
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
      continue;
    }
    previous.end = Math.max(previous.end, interval.end);
  }
  return merged;
}

export function createBotDangerMap({
  bombs = [],
  flames = [],
  currentTick = 0,
  tickRate = 30,
  flameTicks = 15,
  isPermanentWall = () => false,
} = {}) {
  const intervalsByCell = new Map();
  const plannedBombs = bombs.map((bomb, index) => ({
    ...bomb,
    planId: bomb.id ?? `bomb-${index}`,
  }));
  const liveFlameCells = new Set(flames.map((flame) => cellKey(flame.x, flame.y)));
  const explodeOffsets = new Map();

  function addInterval(x, y, start, end) {
    if (end <= start) return;
    const key = cellKey(x, y);
    const intervals = intervalsByCell.get(key) ?? [];
    intervals.push({ start, end });
    intervalsByCell.set(key, intervals);
  }

  for (const flame of flames) {
    const end = Number.isSafeInteger(flame.expireTick)
      ? Math.max(1, relativeTick(flame.expireTick, currentTick))
      : flameTicks;
    addInterval(flame.x, flame.y, 0, end);
  }

  for (const bomb of plannedBombs) {
    const offset = liveFlameCells.has(cellKey(bomb.x, bomb.y))
      ? 0
      : Number.isSafeInteger(bomb.explodeTick)
        ? relativeTick(bomb.explodeTick, currentTick)
        : Math.max(0, Math.ceil(Number(bomb.fuse ?? 0) * tickRate));
    explodeOffsets.set(bomb.planId, offset);
  }

  // Crates are intentionally ignored as blockers here. This over-predicts danger behind a
  // crate, but never tells a bot that an actually dangerous cell is safe after an earlier blast.
  for (let pass = 0; pass < plannedBombs.length; pass += 1) {
    let changed = false;
    for (const source of plannedBombs) {
      const sourceOffset = explodeOffsets.get(source.planId);
      const blastKeys = new Set(
        blastCellsForBomb({
          bomb: source,
          isPermanentWall,
          hasCrate: () => false,
        }).map((cell) => cellKey(cell.x, cell.y)),
      );
      for (const candidate of plannedBombs) {
        if (!blastKeys.has(cellKey(candidate.x, candidate.y))) continue;
        if (sourceOffset >= explodeOffsets.get(candidate.planId)) continue;
        explodeOffsets.set(candidate.planId, sourceOffset);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const bomb of plannedBombs) {
    const start = explodeOffsets.get(bomb.planId);
    const cells = blastCellsForBomb({
      bomb,
      isPermanentWall,
      hasCrate: () => false,
    });
    for (const cell of cells) addInterval(cell.x, cell.y, start, start + flameTicks);
  }

  for (const [key, intervals] of intervalsByCell) {
    intervalsByCell.set(key, mergeIntervals(intervals));
  }

  function intervalsFor(x, y) {
    return intervalsByCell.get(cellKey(x, y)) ?? [];
  }

  return {
    isDangerousAt(x, y, offset = 0) {
      return intervalsFor(x, y).some(
        (interval) => interval.start <= offset && offset < interval.end,
      );
    },
    isDangerousWithin(x, y, fromOffset = 0, toOffset = fromOffset) {
      const start = Math.min(fromOffset, toOffset);
      const end = Math.max(fromOffset, toOffset) + 1;
      return intervalsFor(x, y).some(
        (interval) => interval.start < end && interval.end > start,
      );
    },
    firstDangerOffset(x, y) {
      return intervalsFor(x, y)[0]?.start ?? Number.POSITIVE_INFINITY;
    },
    lastDangerOffset(x, y) {
      return intervalsFor(x, y).at(-1)?.end ?? Number.NEGATIVE_INFINITY;
    },
    readIntervals(x, y) {
      return intervalsFor(x, y).map((interval) => ({ ...interval }));
    },
    readBombOffsets() {
      return new Map(explodeOffsets);
    },
  };
}

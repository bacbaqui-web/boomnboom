import { isNetTickAfter, netTickDelta } from "../../shared/net-tick.mjs";
import { DEFAULT_MOVEMENT_CONFIG } from "../../shared/movement-config.mjs";
import type { Position } from "./position-interpolator.ts";
import type { V3EntitySnapshot, V3PlayerSample } from "./protocol-v3.ts";

export type RemotePositionSource = {
  sample(entityId: string, now: number): Position | null;
};

type TimedRemoteSample = {
  snapshotSeq: number;
  serverTick: number;
  timelineTick: number;
  position: Position;
  velocity: Position;
  lifeId: number;
  teleport: boolean;
  isAI: boolean;
};

function positionOf(sample: V3PlayerSample, unitsPerTile: number): Position {
  return {
    x: sample.px / unitsPerTile - 0.5,
    y: sample.py / unitsPerTile - 0.5,
  };
}

function velocityOf(sample: V3PlayerSample, unitsPerTile: number): Position {
  return { x: sample.vx / unitsPerTile, y: sample.vy / unitsPerTile };
}

function interpolate(from: Position, to: Position, progress: number): Position {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}

export class RemoteSnapshotBuffer {
  #histories = new Map<string, TimedRemoteSample[]>();
  #activeIds = new Set<string>();
  #latestSnapshotSeq: number | null = null;
  #lastRenderTicks = new Map<string, number>();
  #maxHistory: number;
  #maxExtrapolationTicks: number;
  #stepMs: number;
  #unitsPerTile: number;
  #maxSpeedTilesPerTick: number;

  constructor({
    maxHistory = 24,
    maxExtrapolationMs = 100,
    tickRate = DEFAULT_MOVEMENT_CONFIG.tickRate,
    unitsPerTile = DEFAULT_MOVEMENT_CONFIG.unitsPerTile,
    maxSpeedPerTick = DEFAULT_MOVEMENT_CONFIG.maxSpeedPerTick,
  } = {}) {
    this.#maxHistory = maxHistory;
    this.#stepMs = 1000 / tickRate;
    this.#maxExtrapolationTicks = maxExtrapolationMs / this.#stepMs;
    this.#unitsPerTile = unitsPerTile;
    this.#maxSpeedTilesPerTick = maxSpeedPerTick / unitsPerTile;
  }

  ingest(snapshot: V3EntitySnapshot, localPlayerId: string) {
    const isFirst = this.#latestSnapshotSeq === null;
    const isNewest =
      isFirst || isNetTickAfter(snapshot.snapshotSeq, this.#latestSnapshotSeq as number);
    if (!isNewest) {
      const reason = snapshot.snapshotSeq === this.#latestSnapshotSeq ? "duplicate" : "stale";
      return { accepted: false as const, reason };
    }

    const remoteSamples = snapshot.players.filter((sample) => sample.id !== localPlayerId);
    const nextIds = new Set(remoteSamples.map((sample) => sample.id));
    for (const id of this.#activeIds) {
      if (!nextIds.has(id)) {
        this.#histories.delete(id);
        this.#lastRenderTicks.delete(id);
      }
    }
    this.#activeIds = nextIds;
    this.#latestSnapshotSeq = snapshot.snapshotSeq;

    let inserted = 0;
    for (const sample of remoteSamples) {
      if (this.#insert(sample, snapshot)) inserted += 1;
    }
    return { accepted: true as const, inserted };
  }

  #insert(sample: V3PlayerSample, snapshot: V3EntitySnapshot) {
    const history = this.#histories.get(sample.id) ?? [];
    if (history.some((entry) => entry.snapshotSeq === snapshot.snapshotSeq)) return false;
    const latest = history.at(-1);
    const timelineTick = latest
      ? latest.timelineTick + netTickDelta(snapshot.serverTick, latest.serverTick)
      : snapshot.serverTick;
    if (history.length > 0 && timelineTick < history[0].timelineTick) return false;
    const entry: TimedRemoteSample = {
      snapshotSeq: snapshot.snapshotSeq,
      serverTick: snapshot.serverTick,
      timelineTick,
      position: positionOf(sample, this.#unitsPerTile),
      velocity: velocityOf(sample, this.#unitsPerTile),
      lifeId: sample.lifeId,
      teleport: sample.teleport,
      isAI: sample.isAI,
    };
    const index = history.findIndex((candidate) => candidate.timelineTick > timelineTick);
    if (index < 0) history.push(entry);
    else history.splice(index, 0, entry);
    if (history.length > this.#maxHistory) history.splice(0, history.length - this.#maxHistory);
    this.#histories.set(sample.id, history);
    return true;
  }

  sample(entityId: string, estimatedServerTick: number, interpolationDelayMs = 100) {
    const history = this.#histories.get(entityId);
    if (!history?.length) return null;
    const latest = history.at(-1) as TimedRemoteSample;
    const wholeTick = Math.floor(estimatedServerTick);
    const fraction = estimatedServerTick - wholeTick;
    const requestedTargetTick =
      latest.timelineTick +
      netTickDelta(wholeTick >>> 0, latest.serverTick) +
      fraction -
      interpolationDelayMs / this.#stepMs;
    const targetTick = Math.max(
      requestedTargetTick,
      this.#lastRenderTicks.get(entityId) ?? Number.NEGATIVE_INFINITY,
    );
    this.#lastRenderTicks.set(entityId, targetTick);

    if (targetTick <= history[0].timelineTick) return { ...history[0].position };
    for (let index = 1; index < history.length; index += 1) {
      const previous = history[index - 1];
      const next = history[index];
      if (targetTick > next.timelineTick) continue;
      if (this.#isDiscontinuity(previous, next)) {
        return { ...(targetTick < next.timelineTick ? previous.position : next.position) };
      }
      const span = next.timelineTick - previous.timelineTick;
      return interpolate(previous.position, next.position, (targetTick - previous.timelineTick) / span);
    }

    const extrapolationTicks = Math.min(
      this.#maxExtrapolationTicks,
      Math.max(0, targetTick - latest.timelineTick),
    );
    return {
      x: latest.position.x + latest.velocity.x * extrapolationTicks,
      y: latest.position.y + latest.velocity.y * extrapolationTicks,
    };
  }

  #isDiscontinuity(previous: TimedRemoteSample, next: TimedRemoteSample) {
    if (next.teleport || previous.lifeId !== next.lifeId) return true;
    const elapsedTicks = Math.max(0, next.timelineTick - previous.timelineTick);
    const distance = Math.hypot(
      next.position.x - previous.position.x,
      next.position.y - previous.position.y,
    );
    if (next.isAI && distance <= 1.01) return false;
    return distance > this.#maxSpeedTilesPerTick * elapsedTicks + 0.25;
  }

  clear() {
    this.#histories.clear();
    this.#activeIds.clear();
    this.#lastRenderTicks.clear();
    this.#latestSnapshotSeq = null;
  }

  historySize(entityId: string) {
    return this.#histories.get(entityId)?.length ?? 0;
  }

  get entityIds() {
    return [...this.#histories.keys()];
  }
}

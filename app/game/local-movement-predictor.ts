import { isNetTickAfter } from "../../shared/net-tick.mjs";
import {
  DEFAULT_MOVEMENT_CONFIG,
  movementConfigForSpeedLevel,
} from "../../shared/movement-config.mjs";
import { stepMovement } from "../../shared/movement-step.mjs";
import type { PendingCommand } from "./command-timeline.ts";
import type { Position } from "./position-interpolator.ts";
import type { V3Direction, V3OwnerSnapshot } from "./protocol-v3.ts";

export type LocalMovementState = {
  px: number;
  py: number;
  vx: number;
  vy: number;
  desiredDirection: V3Direction;
  queuedTurn: Exclude<V3Direction, "neutral"> | null;
  queuedTurnUntilTick: number;
  targetCellX: number | null;
  targetCellY: number | null;
};

type CollisionReader = { isBlockedCell(cellX: number, cellY: number): boolean };

function stateFromOwner(snapshot: V3OwnerSnapshot): LocalMovementState {
  return {
    px: snapshot.player.px,
    py: snapshot.player.py,
    vx: snapshot.player.vx,
    vy: snapshot.player.vy,
    desiredDirection: snapshot.player.direction,
    queuedTurn: null,
    queuedTurnUntilTick: snapshot.serverTick,
    targetCellX: Number.isSafeInteger(snapshot.player.targetCellX)
      ? snapshot.player.targetCellX
      : null,
    targetCellY: Number.isSafeInteger(snapshot.player.targetCellY)
      ? snapshot.player.targetCellY
      : null,
  };
}

function tilePosition(state: LocalMovementState): Position {
  return {
    x: state.px / DEFAULT_MOVEMENT_CONFIG.unitsPerTile - 0.5,
    y: state.py / DEFAULT_MOVEMENT_CONFIG.unitsPerTile - 0.5,
  };
}

function directionAtTick(
  initial: V3Direction,
  tick: number,
  pending: readonly PendingCommand[],
) {
  let direction = initial;
  for (const command of pending) {
    if (
      command.type === "input_state" &&
      !isNetTickAfter(command.localApplyTick, tick)
    ) {
      direction = command.direction;
    }
  }
  return direction;
}

export class LocalMovementPredictor {
  #state: LocalMovementState | null = null;
  #predictedTick = 0;
  #snapshotSeq: number | null = null;
  #lifeId: number | null = null;
  #maxReplayTicks: number;
  #lastReplayTicks = 0;
  #movementConfig:
    | typeof DEFAULT_MOVEMENT_CONFIG
    | ReturnType<typeof movementConfigForSpeedLevel> = DEFAULT_MOVEMENT_CONFIG;

  constructor({ maxReplayTicks = 16 } = {}) {
    this.#maxReplayTicks = maxReplayTicks;
  }

  reset(snapshot: V3OwnerSnapshot) {
    this.#movementConfig = Number.isSafeInteger(snapshot.player.speedLevel)
      ? movementConfigForSpeedLevel(snapshot.player.speedLevel)
      : DEFAULT_MOVEMENT_CONFIG;
    this.#state = stateFromOwner(snapshot);
    this.#predictedTick = snapshot.serverTick;
    this.#snapshotSeq = snapshot.snapshotSeq;
    this.#lifeId = snapshot.player.lifeId;
    this.#lastReplayTicks = 0;
    return this.position;
  }

  clear() {
    this.#state = null;
    this.#snapshotSeq = null;
    this.#lifeId = null;
    this.#lastReplayTicks = 0;
  }

  canApplySnapshot(snapshot: V3OwnerSnapshot) {
    return this.#snapshotSeq === null || isNetTickAfter(snapshot.snapshotSeq, this.#snapshotSeq);
  }

  advanceTo(targetTick: number, pending: readonly PendingCommand[], collision: CollisionReader) {
    if (!this.#state) return { position: null, replayTicks: 0, collisionCrossing: false };
    let direction = this.#state.desiredDirection;
    let steps = 0;
    let collisionCrossing = false;
    while (isNetTickAfter(targetTick, this.#predictedTick) && steps < this.#maxReplayTicks) {
      const tick = (this.#predictedTick + 1) >>> 0;
      direction = directionAtTick(direction, tick, pending);
      const result = stepMovement(
        this.#state,
        { tick, direction },
        collision,
        this.#movementConfig,
      );
      this.#state = result.state as LocalMovementState;
      this.#predictedTick = tick;
      collisionCrossing = collisionCrossing || result.contacts.length > 0;
      steps += 1;
    }
    this.#lastReplayTicks = steps;
    return { position: this.position, replayTicks: steps, collisionCrossing };
  }

  previewNext(pending: readonly PendingCommand[], collision: CollisionReader) {
    if (!this.#state) return { position: null, collisionCrossing: false };
    const tick = (this.#predictedTick + 1) >>> 0;
    const direction = directionAtTick(this.#state.desiredDirection, tick, pending);
    const result = stepMovement(
      this.#state,
      { tick, direction },
      collision,
      this.#movementConfig,
    );
    return {
      position: tilePosition(result.state as LocalMovementState),
      collisionCrossing: result.contacts.length > 0,
    };
  }

  reconcile(
    snapshot: V3OwnerSnapshot,
    pending: readonly PendingCommand[],
    collision: CollisionReader,
  ) {
    if (this.#snapshotSeq !== null && !isNetTickAfter(snapshot.snapshotSeq, this.#snapshotSeq)) {
      return { applied: false as const, reason: "stale" as const };
    }
    const previousTick = this.#predictedTick;
    const previousLifeId = this.#lifeId;
    this.#state = stateFromOwner(snapshot);
    this.#movementConfig = Number.isSafeInteger(snapshot.player.speedLevel)
      ? movementConfigForSpeedLevel(snapshot.player.speedLevel)
      : DEFAULT_MOVEMENT_CONFIG;
    this.#predictedTick = snapshot.serverTick;
    this.#snapshotSeq = snapshot.snapshotSeq;
    this.#lifeId = snapshot.player.lifeId;
    const replay = this.advanceTo(previousTick, pending, collision);
    return {
      applied: true as const,
      position: replay.position,
      replayTicks: replay.replayTicks,
      collisionCrossing: replay.collisionCrossing,
      forceSnap:
        snapshot.player.teleport ||
        previousLifeId === null ||
        previousLifeId !== snapshot.player.lifeId,
    };
  }

  get position() {
    return this.#state ? tilePosition(this.#state) : null;
  }

  get predictedTick() {
    return this.#predictedTick;
  }

  get bombCell() {
    if (!this.#state) return null;
    return {
      x: Math.floor(this.#state.px / DEFAULT_MOVEMENT_CONFIG.unitsPerTile),
      y: Math.floor(this.#state.py / DEFAULT_MOVEMENT_CONFIG.unitsPerTile),
    };
  }

  get lastReplayTicks() {
    return this.#lastReplayTicks;
  }

  get lifeId() {
    return this.#lifeId;
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MOVEMENT_CONFIG } from "../shared/movement-config.mjs";
import { stepMovement } from "../shared/movement-step.mjs";
import {
  addNetTicks,
  classifyTargetTick,
  isNetTickAfter,
  netTickDelta,
} from "../shared/net-tick.mjs";
import {
  GOLDEN_EXPECTED_JSON,
  runMovementGoldenFixture,
} from "./fixtures/movement-golden-fixture.mjs";

const openWorld = { isBlockedCell: () => false };

function initialState(overrides = {}) {
  return {
    px: 512,
    py: 512,
    vx: 0,
    vy: 0,
    desiredDirection: "neutral",
    queuedTurn: null,
    queuedTurnUntilTick: 0,
    targetCellX: null,
    targetCellY: null,
    ...overrides,
  };
}

test("client golden ticks match the fixed-point movement contract byte-for-byte", () => {
  assert.equal(runMovementGoldenFixture(), GOLDEN_EXPECTED_JSON);
});

test("a pressed direction commits the adjacent cell and keyup still completes it", () => {
  let state = initialState();
  const speeds = [];
  for (let tick = 1; tick <= 4; tick += 1) {
    state = stepMovement(state, { tick, direction: "right" }, openWorld).state;
    speeds.push(state.vx);
  }
  assert.deepEqual(speeds, [64, 128, 192, 256]);
  assert.deepEqual([state.targetCellX, state.targetCellY], [1, 0]);

  const positions = [];
  for (let tick = 5; tick <= 6; tick += 1) {
    state = stepMovement(state, { tick, direction: "neutral" }, openWorld).state;
    positions.push(state.px);
  }
  assert.deepEqual(positions, [1408, 1536]);
  assert.deepEqual(state, initialState({ px: 1536, queuedTurnUntilTick: 0 }));
});

test("a blocked adjacent cell is never committed", () => {
  const collisionReader = {
    isBlockedCell: (cellX, cellY) => cellX === 1 && cellY === 0,
  };
  const result = stepMovement(
    initialState(),
    { tick: 1, direction: "right" },
    collisionReader,
  );

  assert.equal(result.state.px, 512);
  assert.equal(result.state.vx, 0);
  assert.equal(result.state.targetCellX, null);
  assert.deepEqual(result.contacts, []);
});

test("negative coordinates commit and finish on the same centerline", () => {
  let state = initialState({ px: -512, py: -512 });
  state = stepMovement(state, { tick: 1, direction: "left" }, openWorld).state;
  assert.deepEqual([state.targetCellX, state.targetCellY], [-2, -1]);
  for (let tick = 2; tick <= 7; tick += 1) {
    state = stepMovement(state, { tick, direction: "neutral" }, openWorld).state;
  }
  assert.deepEqual([state.px, state.py, state.vx], [-1536, -512, 0]);
});

test("movement locks to the centerline perpendicular to its committed direction", () => {
  const horizontal = stepMovement(
    initialState({ py: 640 }),
    { tick: 1, direction: "right" },
    openWorld,
  ).state;
  assert.equal(horizontal.py, 512);
  const vertical = stepMovement(
    initialState({ px: 640 }),
    { tick: 1, direction: "down" },
    openWorld,
  ).state;
  assert.equal(vertical.px, 512);
});

test("holding a direction chains the next cell without stopping at its center", () => {
  let state = initialState();
  for (let tick = 1; tick <= 6; tick += 1) {
    state = stepMovement(state, { tick, direction: "right" }, openWorld).state;
  }
  assert.deepEqual([state.px, state.vx, state.targetCellX, state.targetCellY], [1536, 256, 2, 0]);
  state = stepMovement(state, { tick: 7, direction: "right" }, openWorld).state;
  assert.equal(state.px, 1792);
});

test("a perpendicular direction queues until the committed cell is reached across tick wrap", () => {
  let state = stepMovement(
    initialState(),
    { tick: 0xffff_fffc, direction: "right" },
    openWorld,
  ).state;
  state = stepMovement(state, { tick: 0xffff_fffd, direction: "up" }, openWorld).state;
  assert.equal(state.queuedTurn, "up");
  for (const tick of [0xffff_fffe, 0xffff_ffff, 0, 1]) {
    state = stepMovement(state, { tick, direction: "up" }, openWorld).state;
  }
  assert.deepEqual([state.px, state.py, state.targetCellX, state.targetCellY], [1536, 512, 1, -1]);
  assert.equal(state.queuedTurn, null);
});

test("a held reverse direction runs only after the committed cell is reached", () => {
  let state = stepMovement(initialState(), { tick: 1, direction: "right" }, openWorld).state;
  state = stepMovement(state, { tick: 2, direction: "left" }, openWorld).state;
  assert.deepEqual([state.targetCellX, state.px, state.queuedTurn], [1, 704, "left"]);
  for (let tick = 3; tick <= 6; tick += 1) {
    state = stepMovement(state, { tick, direction: "left" }, openWorld).state;
  }
  assert.deepEqual([state.px, state.targetCellX, state.targetCellY], [1536, 0, 0]);
});

test("a newly blocked committed target stops at its boundary without crossing", () => {
  let state = stepMovement(initialState(), { tick: 1, direction: "right" }, openWorld).state;
  const blockedWorld = {
    isBlockedCell: (cellX, cellY) => cellX === 1 && cellY === 0,
  };
  state = stepMovement(state, { tick: 2, direction: "neutral" }, blockedWorld).state;
  const result = stepMovement(state, { tick: 3, direction: "neutral" }, blockedWorld);
  assert.equal(result.state.px, 704);
  assert.equal(result.state.targetCellX, 1);
  assert.deepEqual(result.contacts, [{ axis: "x", direction: 1, cellX: 1, cellY: 0 }]);
});

test("movement does not mutate its state, input, config, or collision reader", () => {
  const state = Object.freeze(initialState());
  const input = Object.freeze({ tick: 1, direction: "right" });
  const config = Object.freeze({ ...DEFAULT_MOVEMENT_CONFIG });
  const collisionReader = Object.freeze({ isBlockedCell: () => false });
  const result = stepMovement(state, input, collisionReader, config);
  assert.notEqual(result.state, state);
  assert.deepEqual(state, initialState());
  assert.deepEqual(input, { tick: 1, direction: "right" });
  assert.deepEqual(config, DEFAULT_MOVEMENT_CONFIG);
});

test("net tick comparison and lead windows remain ordered across wrap", () => {
  assert.equal(addNetTicks(0xffff_ffff, 1), 0);
  assert.equal(netTickDelta(1, 0xffff_ffff), 2);
  assert.equal(isNetTickAfter(0, 0xffff_ffff), true);
  assert.deepEqual(classifyTargetTick(1, 0xffff_ffff, {
    maxPastTicks: 2,
    maxFutureTicks: 2,
  }), { status: "accepted", offset: 2 });
  assert.deepEqual(classifyTargetTick(10, 0, {
    maxPastTicks: 2,
    maxFutureTicks: 3,
  }), { status: "future", offset: 10 });
});

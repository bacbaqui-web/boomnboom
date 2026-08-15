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
    ...overrides,
  };
}

test("client golden ticks match the fixed-point movement contract byte-for-byte", () => {
  assert.equal(runMovementGoldenFixture(), GOLDEN_EXPECTED_JSON);
});

test("30Hz movement reaches top speed in four ticks and stops in three ticks", () => {
  let state = initialState();
  const speeds = [];
  for (let tick = 1; tick <= 4; tick += 1) {
    state = stepMovement(state, { tick, direction: "right" }, openWorld).state;
    speeds.push(state.vx);
  }
  assert.deepEqual(speeds, [64, 128, 192, 256]);

  const stoppingSpeeds = [];
  for (let tick = 5; tick <= 7; tick += 1) {
    state = stepMovement(state, { tick, direction: "neutral" }, openWorld).state;
    stoppingSpeeds.push(state.vx);
  }
  assert.deepEqual(stoppingSpeeds, [160, 64, 0]);
});

test("axis sweep stops at the first blocked cell even above one tile per tick", () => {
  const visited = [];
  const collisionReader = {
    isBlockedCell(cellX, cellY) {
      visited.push(`${cellX},${cellY}`);
      return cellX === 2 && cellY === 0;
    },
  };
  const fastConfig = {
    ...DEFAULT_MOVEMENT_CONFIG,
    maxSpeedPerTick: 3072,
    accelerationPerTick: 3072,
    decelerationPerTick: 3072,
  };
  const result = stepMovement(
    initialState(),
    { tick: 1, direction: "right" },
    collisionReader,
    fastConfig,
  );

  assert.equal(result.state.px, 2 * 1024 - fastConfig.collisionHalfExtent);
  assert.equal(result.state.vx, 0);
  assert.ok(visited.includes("1,0"));
  assert.ok(visited.includes("2,0"));
  assert.deepEqual(result.contacts, [
    { axis: "x", direction: 1, cellX: 2, cellY: 0 },
  ]);
});

test("negative-coordinate sweep uses the same boundary rule", () => {
  const collisionReader = {
    isBlockedCell: (cellX, cellY) => cellX === -2 && cellY === 0,
  };
  const fastConfig = {
    ...DEFAULT_MOVEMENT_CONFIG,
    maxSpeedPerTick: 3072,
    accelerationPerTick: 3072,
    decelerationPerTick: 3072,
  };
  const result = stepMovement(
    initialState(),
    { tick: 1, direction: "left" },
    collisionReader,
    fastConfig,
  );
  assert.equal(result.state.px, -1024 + fastConfig.collisionHalfExtent);
  assert.equal(result.state.vx, 0);
});

test("vertical sweep is resolved independently after the horizontal axis", () => {
  const collisionReader = {
    isBlockedCell: (cellX, cellY) => cellX === 0 && cellY === 2,
  };
  const fastConfig = {
    ...DEFAULT_MOVEMENT_CONFIG,
    maxSpeedPerTick: 3072,
    accelerationPerTick: 3072,
    decelerationPerTick: 3072,
  };
  const result = stepMovement(
    initialState(),
    { tick: 1, direction: "down" },
    collisionReader,
    fastConfig,
  );
  assert.equal(result.state.py, 2 * 1024 - fastConfig.collisionHalfExtent);
  assert.equal(result.state.vy, 0);
  assert.deepEqual(result.contacts, [
    { axis: "y", direction: 1, cellX: 0, cellY: 2 },
  ]);
});

test("reversal decelerates to zero before accelerating in the opposite direction", () => {
  let state = initialState({
    vx: DEFAULT_MOVEMENT_CONFIG.maxSpeedPerTick,
    desiredDirection: "right",
  });
  const velocities = [];
  for (let tick = 1; tick <= 5; tick += 1) {
    state = stepMovement(state, { tick, direction: "left" }, openWorld).state;
    velocities.push(state.vx);
  }
  assert.deepEqual(velocities, [160, 64, 0, -64, -128]);
});

test("queued turn expires correctly while uint32 ticks wrap", () => {
  let state = initialState({
    px: 0,
    desiredDirection: "right",
    queuedTurn: "up",
    queuedTurnUntilTick: 0,
  });
  state = stepMovement(
    state,
    { tick: 0xffff_ffff, direction: "right" },
    openWorld,
  ).state;
  assert.equal(state.queuedTurn, "up");
  state = stepMovement(state, { tick: 0, direction: "right" }, openWorld).state;
  assert.equal(state.queuedTurn, "up");
  state = stepMovement(state, { tick: 1, direction: "right" }, openWorld).state;
  assert.equal(state.queuedTurn, null);
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

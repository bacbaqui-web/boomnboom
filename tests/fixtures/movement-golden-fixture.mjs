import { stepMovement } from "../../shared/movement-step.mjs";

export const GOLDEN_EXPECTED_JSON = JSON.stringify([
  {
    px: -1472,
    py: -512,
    vx: 64,
    vy: 0,
    desiredDirection: "right",
    queuedTurn: null,
    queuedTurnUntilTick: 0,
  },
  {
    px: -1344,
    py: -512,
    vx: 128,
    vy: 0,
    desiredDirection: "right",
    queuedTurn: null,
    queuedTurnUntilTick: 0,
  },
  {
    px: -1152,
    py: -512,
    vx: 192,
    vy: 0,
    desiredDirection: "right",
    queuedTurn: null,
    queuedTurnUntilTick: 0,
  },
  {
    px: -896,
    py: -512,
    vx: 256,
    vy: 0,
    desiredDirection: "right",
    queuedTurn: null,
    queuedTurnUntilTick: 0,
  },
  {
    px: -640,
    py: -512,
    vx: 256,
    vy: 0,
    desiredDirection: "right",
    queuedTurn: "up",
    queuedTurnUntilTick: 3,
  },
  {
    px: -512,
    py: -768,
    vx: 0,
    vy: -256,
    desiredDirection: "up",
    queuedTurn: null,
    queuedTurnUntilTick: 3,
  },
  {
    px: -512,
    py: -928,
    vx: 0,
    vy: -160,
    desiredDirection: "neutral",
    queuedTurn: null,
    queuedTurnUntilTick: 3,
  },
]);

export function runMovementGoldenFixture() {
  const collisionReader = { isBlockedCell: () => false };
  const inputs = [
    { tick: 0xffff_fffc, direction: "right" },
    { tick: 0xffff_fffd, direction: "right" },
    { tick: 0xffff_fffe, direction: "right" },
    { tick: 0xffff_ffff, direction: "right" },
    { tick: 0, direction: "up" },
    { tick: 1, direction: "right" },
    { tick: 2, direction: "neutral" },
  ];
  let state = {
    px: -1536,
    py: -512,
    vx: 0,
    vy: 0,
    desiredDirection: "neutral",
    queuedTurn: null,
    queuedTurnUntilTick: 0,
  };
  const states = [];
  for (const input of inputs) {
    state = stepMovement(state, input, collisionReader).state;
    states.push(state);
  }
  return JSON.stringify(states);
}

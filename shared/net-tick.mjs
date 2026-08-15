const UINT32_SIZE = 0x1_0000_0000;
const UINT32_HALF_RANGE = 0x8000_0000;

export function normalizeNetTick(value) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError("net tick must be a safe integer");
  }
  return ((value % UINT32_SIZE) + UINT32_SIZE) % UINT32_SIZE;
}

export function addNetTicks(tick, amount) {
  if (!Number.isSafeInteger(amount)) {
    throw new TypeError("net tick amount must be a safe integer");
  }
  return normalizeNetTick(normalizeNetTick(tick) + amount);
}

export function netTickDelta(candidate, reference) {
  const unsignedDelta = normalizeNetTick(candidate) - normalizeNetTick(reference);
  const wrappedDelta = normalizeNetTick(unsignedDelta);
  return wrappedDelta < UINT32_HALF_RANGE
    ? wrappedDelta
    : wrappedDelta - UINT32_SIZE;
}

export function isNetTickAfter(candidate, reference) {
  return netTickDelta(candidate, reference) > 0;
}

export function isNetTickAtOrAfter(candidate, reference) {
  return netTickDelta(candidate, reference) >= 0;
}

export function classifyTargetTick(
  targetTick,
  currentTick,
  { maxPastTicks, maxFutureTicks },
) {
  if (
    !Number.isInteger(maxPastTicks) ||
    maxPastTicks < 0 ||
    !Number.isInteger(maxFutureTicks) ||
    maxFutureTicks < 0 ||
    maxPastTicks >= UINT32_HALF_RANGE ||
    maxFutureTicks >= UINT32_HALF_RANGE
  ) {
    throw new TypeError("tick window bounds must be non-negative uint31 integers");
  }

  const offset = netTickDelta(targetTick, currentTick);
  if (offset < -maxPastTicks) return { status: "late", offset };
  if (offset > maxFutureTicks) return { status: "future", offset };
  return { status: "accepted", offset };
}

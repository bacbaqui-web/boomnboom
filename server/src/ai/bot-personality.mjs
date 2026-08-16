const PROFILES = Object.freeze([
  Object.freeze({
    id: "rookie",
    searchSteps: 6,
    maxVisited: 192,
    escapeLookaheadTicks: 90,
    targetLockTicks: 15,
    bombCooldownTicks: 45,
    mistakeModulo: 3,
  }),
  Object.freeze({
    id: "balanced",
    searchSteps: 8,
    maxVisited: 256,
    escapeLookaheadTicks: 105,
    targetLockTicks: 24,
    bombCooldownTicks: 36,
    mistakeModulo: 5,
  }),
  Object.freeze({
    id: "hunter",
    searchSteps: 10,
    maxVisited: 384,
    escapeLookaheadTicks: 120,
    targetLockTicks: 30,
    bombCooldownTicks: 30,
    mistakeModulo: 7,
  }),
]);

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function botProfile(botId) {
  const suffix = Number(String(botId).match(/\d+$/)?.[0] ?? 1);
  return PROFILES[(Math.max(1, suffix) - 1) % PROFILES.length];
}

export function shouldUseImperfectMove(botId, decisionNumber, modulo) {
  if (!Number.isInteger(modulo) || modulo < 2) return false;
  return (hashText(`${botId}:${decisionNumber}`) % modulo) === 0;
}

export function readBotProfiles() {
  return PROFILES.map((profile) => ({ ...profile }));
}

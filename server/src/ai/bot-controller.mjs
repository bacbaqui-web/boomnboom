import { addNetTicks, isNetTickAfter } from "../../../shared/net-tick.mjs";
import { createBotDangerMap } from "./bot-danger-map.mjs";
import {
  botProfile,
  shouldUseImperfectMove,
} from "./bot-personality.mjs";
import { chooseBotTactic } from "./bot-tactics.mjs";

const MOVEMENT_ACTIONS = new Set(["up", "right", "down", "left"]);

function distance(left, right) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function nearestHuman(bot, humans) {
  return humans.reduce((best, candidate) =>
    !best || distance(bot, candidate) < distance(bot, best) ? candidate : best,
  null);
}

function selectedTarget(bot, humans, memory, tick, profile) {
  const locked = humans.find((human) => human.id === memory.targetId);
  if (
    locked &&
    Number.isSafeInteger(memory.targetLockUntilTick) &&
    isNetTickAfter(memory.targetLockUntilTick, tick)
  ) {
    return locked;
  }
  const target = nearestHuman(bot, humans);
  memory.targetId = target?.id ?? null;
  memory.targetLockUntilTick = addNetTicks(tick, profile.targetLockTicks);
  return target;
}

function createMemory() {
  return {
    targetId: null,
    targetLockUntilTick: 0,
    lastX: null,
    lastY: null,
    lastAction: "wait",
    stuckDecisions: 0,
    decisionNumber: 0,
    bombCooldownUntilTick: null,
  };
}

function chooseWithMemory({ bot, target, state, dangerMap, tick, memory, profile }) {
  const sameCell = memory.lastX === bot.x && memory.lastY === bot.y;
  memory.stuckDecisions = sameCell && MOVEMENT_ACTIONS.has(memory.lastAction)
    ? memory.stuckDecisions + 1
    : 0;
  const avoidedDirection = memory.stuckDecisions >= 2 ? memory.lastAction : null;
  const preferredDirection = avoidedDirection ? null : memory.lastAction;
  const tactic = chooseBotTactic({
    bot,
    target,
    ...state,
    currentTick: tick,
    dangerMap,
    profile,
    preferredDirection,
    avoidedDirection,
    bombCooldownUntilTick: memory.bombCooldownUntilTick,
  });
  memory.decisionNumber += 1;
  let action = tactic.action;
  let reason = tactic.reason;
  if (
    !["escape", "attack_bomb", "crate_bomb", "blocked", "idle"].includes(reason) &&
    shouldUseImperfectMove(bot.id, memory.decisionNumber, profile.mistakeModulo)
  ) {
    const alternative = tactic.alternatives.find((candidate) => candidate !== action);
    if (alternative) {
      action = alternative;
      reason = `imperfect_${reason}`;
    }
  }
  if (action === "bomb") {
    memory.bombCooldownUntilTick = addNetTicks(tick, profile.bombCooldownTicks);
  }
  memory.lastX = bot.x;
  memory.lastY = bot.y;
  memory.lastAction = action;
  return { action, reason, searches: tactic.searches };
}

export function chooseBotIntent({
  bot,
  players = [],
  bombs = [],
  items = [],
  flames = [],
  currentTick = 0,
  isBlocked = () => false,
  isPermanentWall = isBlocked,
  hasCrate = () => false,
} = {}) {
  const humans = players.filter((player) => !player.isAI && player.alive);
  if (!bot?.alive || humans.length === 0) return null;
  const target = nearestHuman(bot, humans);
  const terrain = { isPermanentWall, hasCrate };
  const dangerMap = createBotDangerMap({
    bombs,
    flames,
    currentTick,
    isPermanentWall,
  });
  return chooseBotTactic({
    bot,
    target,
    players,
    bombs,
    items,
    flames,
    currentTick,
    terrain,
    dangerMap,
    profile: botProfile(bot.id),
  }).action;
}

export function createBotController({ world, currentTick = () => 0 } = {}) {
  const memories = new Map();
  const reasonCounts = new Map();
  const metrics = {
    decisions: 0,
    lastBots: 0,
    lastSearches: 0,
    maxSearchesPerDecision: 0,
    lastDecisionDurationMs: 0,
  };

  function snapshot() {
    return {
      players: world.readPlayers(),
      bombs: world.readBombs(),
      items: world.readItems(),
      flames: world.readFlames(),
      terrain: {
        isPermanentWall: (x, y) => world.isPermanentWall(x, y),
        hasCrate: (x, y) => world.hasCrate(x, y),
      },
    };
  }

  function decideState(bot, target, state, dangerMap, tick) {
    const memory = memories.get(bot.id) ?? createMemory();
    const profile = botProfile(bot.id);
    const result = chooseWithMemory({ bot, target, state, dangerMap, tick, memory, profile });
    memories.set(bot.id, memory);
    metrics.decisions += 1;
    metrics.maxSearchesPerDecision = Math.max(
      metrics.maxSearchesPerDecision,
      result.searches,
    );
    reasonCounts.set(result.reason, (reasonCounts.get(result.reason) ?? 0) + 1);
    return {
      intent: { botId: bot.id, action: result.action },
      searches: result.searches,
    };
  }

  return {
    decide(botId) {
      const state = snapshot();
      const bot = state.players.find((player) => player.id === botId);
      const humans = state.players.filter((player) => !player.isAI && player.alive);
      if (!bot?.alive || humans.length === 0) return null;
      const tick = currentTick() >>> 0;
      const memory = memories.get(bot.id) ?? createMemory();
      memories.set(bot.id, memory);
      const target = selectedTarget(bot, humans, memory, tick, botProfile(bot.id));
      const dangerMap = createBotDangerMap({
        bombs: state.bombs,
        flames: state.flames,
        currentTick: tick,
        isPermanentWall: state.terrain.isPermanentWall,
      });
      return decideState(bot, target, state, dangerMap, tick).intent.action;
    },
    decideAll() {
      const startedAt = Date.now();
      const state = snapshot();
      const humans = state.players.filter((player) => !player.isAI && player.alive);
      if (humans.length === 0) {
        metrics.lastBots = 0;
        metrics.lastSearches = 0;
        metrics.lastDecisionDurationMs = Date.now() - startedAt;
        return [];
      }
      const tick = currentTick() >>> 0;
      const dangerMap = createBotDangerMap({
        bombs: state.bombs,
        flames: state.flames,
        currentTick: tick,
        isPermanentWall: state.terrain.isPermanentWall,
      });
      let searches = 0;
      const intents = [];
      for (const bot of state.players.filter((player) => player.isAI && player.alive)) {
        const memory = memories.get(bot.id) ?? createMemory();
        memories.set(bot.id, memory);
        const profile = botProfile(bot.id);
        const target = selectedTarget(bot, humans, memory, tick, profile);
        const result = decideState(bot, target, state, dangerMap, tick);
        searches += result.searches;
        intents.push(result.intent);
      }
      metrics.lastBots = intents.length;
      metrics.lastSearches = searches;
      metrics.lastDecisionDurationMs = Date.now() - startedAt;
      return intents;
    },
    readMetrics() {
      return {
        ...metrics,
        reasonCounts: Object.fromEntries(reasonCounts),
      };
    },
  };
}

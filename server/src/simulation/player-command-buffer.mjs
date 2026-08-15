import {
  addNetTicks,
  classifyTargetTick,
  isNetTickAfter,
  netTickDelta,
  normalizeNetTick,
} from "../../../shared/net-tick.mjs";

export function createPlayerCommandBuffer({
  maxQueueLength = 64,
  maxPastTicks = 6,
  maxFutureTicks = 15,
} = {}) {
  const players = new Map();
  const metrics = {
    accepted: 0,
    duplicate: 0,
    stale: 0,
    late: 0,
    futureRejected: 0,
    queueRejected: 0,
  };

  function stateFor(playerId) {
    return players.get(playerId) ?? null;
  }

  function registerPlayer(playerId) {
    if (!players.has(playerId)) {
      players.set(playerId, {
        direction: "neutral",
        queue: [],
        lastReceivedSeq: null,
        lastProcessedSeq: null,
      });
    }
  }

  function enqueue(playerId, command, currentTick) {
    const player = stateFor(playerId);
    if (!player) return { accepted: false, reason: "unknown_player" };
    const commandSeq = normalizeNetTick(command.commandSeq);
    if (player.lastReceivedSeq !== null && commandSeq === player.lastReceivedSeq) {
      metrics.duplicate += 1;
      return { accepted: false, reason: "duplicate" };
    }
    if (
      player.lastReceivedSeq !== null &&
      !isNetTickAfter(commandSeq, player.lastReceivedSeq)
    ) {
      metrics.stale += 1;
      return { accepted: false, reason: "stale_sequence" };
    }
    if (player.queue.length >= maxQueueLength) {
      metrics.queueRejected += 1;
      return { accepted: false, reason: "queue_full" };
    }

    const target = classifyTargetTick(command.targetTick, currentTick, {
      maxPastTicks,
      maxFutureTicks,
    });
    if (target.status === "future") {
      metrics.futureRejected += 1;
      return { accepted: false, reason: "future_tick" };
    }
    if (target.status === "late") {
      metrics.late += 1;
      return { accepted: false, reason: "late_tick" };
    }
    const late = target.offset <= 0;
    const effectiveTargetTick = late
      ? addNetTicks(currentTick, 1)
      : normalizeNetTick(command.targetTick);
    if (late) metrics.late += 1;
    player.lastReceivedSeq = commandSeq;
    player.queue.push({
      commandSeq,
      targetTick: effectiveTargetTick,
      type: command.type ?? (command.action ? "action_command" : "input_state"),
      ...(command.direction ? { direction: command.direction } : {}),
      ...(command.action ? { action: command.action } : {}),
    });
    player.queue.sort((left, right) => {
      const tickOrder = netTickDelta(left.targetTick, right.targetTick);
      return tickOrder === 0
        ? netTickDelta(left.commandSeq, right.commandSeq)
        : tickOrder;
    });
    metrics.accepted += 1;
    return {
      accepted: true,
      status: late ? "late_clamped" : "queued",
      targetTick: effectiveTargetTick,
    };
  }

  function consumeTick(tick) {
    const result = new Map();
    for (const [playerId, player] of players) {
      const actions = [];
      while (
        player.queue.length > 0 &&
        !isNetTickAfter(player.queue[0].targetTick, tick)
      ) {
        const command = player.queue.shift();
        if (command.type === "input_state") player.direction = command.direction;
        else actions.push({
          commandSeq: command.commandSeq,
          targetTick: command.targetTick,
          action: command.action,
        });
        player.lastProcessedSeq = command.commandSeq;
      }
      result.set(playerId, {
        direction: player.direction,
        lastProcessedCommandSeq: player.lastProcessedSeq,
        actions,
      });
    }
    return result;
  }

  return {
    registerPlayer,
    removePlayer(playerId) {
      return players.delete(playerId);
    },
    enqueue,
    consumeTick,
    resetPlayerIntent(playerId) {
      const player = stateFor(playerId);
      if (!player) return false;
      player.direction = "neutral";
      player.queue = [];
      return true;
    },
    resetPlayerSession(playerId) {
      const player = stateFor(playerId);
      if (!player) return false;
      player.direction = "neutral";
      player.queue = [];
      player.lastReceivedSeq = null;
      player.lastProcessedSeq = null;
      return true;
    },
    lastProcessedCommandSeq(playerId) {
      return stateFor(playerId)?.lastProcessedSeq ?? null;
    },
    queueDepth(playerId) {
      return stateFor(playerId)?.queue.length ?? 0;
    },
    readMetrics() {
      let queuedCommands = 0;
      for (const player of players.values()) queuedCommands += player.queue.length;
      return { players: players.size, queuedCommands, ...metrics };
    },
  };
}

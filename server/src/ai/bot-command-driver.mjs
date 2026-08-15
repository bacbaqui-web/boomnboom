import { addNetTicks } from "../../../shared/net-tick.mjs";

const DIRECTIONS = new Set(["up", "down", "left", "right"]);

export function createBotCommandDriver({ commandBuffer, currentTick }) {
  const sequences = new Map();

  function registerPlayer(playerId) {
    commandBuffer.registerPlayer(playerId);
    sequences.set(playerId, 0xffff_ffff);
  }

  function enqueue(playerId, command, nowTick, targetTick) {
    const commandSeq = addNetTicks(sequences.get(playerId) ?? 0xffff_ffff, 1);
    const result = commandBuffer.enqueue(
      playerId,
      { ...command, commandSeq, targetTick },
      nowTick,
    );
    if (result.accepted) sequences.set(playerId, commandSeq);
    return result.accepted;
  }

  function apply(intents) {
    const byPlayer = new Map(intents.map((intent) => [intent.botId, intent.action]));
    const nowTick = currentTick();
    const targetTick = addNetTicks(nowTick, 1);
    let accepted = 0;

    for (const playerId of sequences.keys()) {
      const action = byPlayer.get(playerId) ?? "wait";
      const direction = DIRECTIONS.has(action) ? action : "neutral";
      if (
        enqueue(
          playerId,
          { type: "input_state", direction },
          nowTick,
          targetTick,
        )
      ) accepted += 1;

      if (
        action === "bomb" &&
        enqueue(
          playerId,
          { type: "action_command", action: "bomb" },
          nowTick,
          targetTick,
        )
      ) accepted += 1;
    }
    return { accepted, targetTick };
  }

  return {
    registerPlayer,
    apply,
  };
}

import { isNetTickAfter } from "../../shared/net-tick.mjs";
import type {
  V3ActionCommand,
  V3ClientCommand,
  V3Direction,
  V3InputCommand,
} from "./protocol-v3.ts";

export type PendingCommand = V3ClientCommand & { localApplyTick: number };
export type PendingInputCommand = V3InputCommand & { localApplyTick: number };

export class CommandTimeline {
  #nextCommandSeq = 0;
  #pending: PendingCommand[] = [];
  #maxPending: number;

  constructor({ maxPending = 64 } = {}) {
    this.#maxPending = maxPending;
  }

  prepareDirection(direction: V3Direction, targetTick: number): PendingInputCommand | null {
    if (this.#pending.length >= this.#maxPending) return null;
    return {
      protocol: 3,
      type: "input_state",
      commandSeq: this.#nextCommandSeq,
      targetTick: targetTick >>> 0,
      localApplyTick: targetTick >>> 0,
      direction,
    };
  }

  prepareAction(
    action: V3ActionCommand["action"],
    targetTick: number,
  ): (V3ActionCommand & { localApplyTick: number }) | null {
    if (this.#pending.length >= this.#maxPending) return null;
    return {
      protocol: 3,
      type: "action_command",
      commandSeq: this.#nextCommandSeq,
      targetTick: targetTick >>> 0,
      localApplyTick: targetTick >>> 0,
      action,
    };
  }

  commit(command: PendingCommand) {
    if (command.commandSeq !== this.#nextCommandSeq || this.#pending.length >= this.#maxPending) {
      return false;
    }
    this.#pending.push({ ...command });
    this.#nextCommandSeq = (this.#nextCommandSeq + 1) >>> 0;
    return true;
  }

  acknowledge(commandSeq: number | null) {
    if (!Number.isInteger(commandSeq)) return 0;
    const before = this.#pending.length;
    this.#pending = this.#pending.filter(
      (command) => isNetTickAfter(command.commandSeq, commandSeq as number),
    );
    return before - this.#pending.length;
  }

  reject(commandSeq: number) {
    const before = this.#pending.length;
    this.#pending = this.#pending.filter((command) => command.commandSeq !== commandSeq);
    return before !== this.#pending.length;
  }

  reset() {
    this.#pending = [];
    this.#nextCommandSeq = 0;
  }

  get pending() {
    return this.#pending.map((command) => ({ ...command }));
  }

  get size() {
    return this.#pending.length;
  }
}

import type { BombEntity } from "./protocol.ts";
import type { V3ActionResult } from "./protocol-v3.ts";

export type PendingBombVisual = {
  commandSeq: number;
  x: number;
  y: number;
  bombId: string | number | null;
  spawnTick: number | null;
  explodeTick: number | null;
};

export class PendingBombPresenter {
  #pending = new Map<number, PendingBombVisual>();
  #authoritativeIds = new Set<string | number>();

  begin(commandSeq: number, cell: { x: number; y: number }) {
    if (this.#pending.has(commandSeq)) return false;
    this.#pending.set(commandSeq, {
      commandSeq,
      x: cell.x,
      y: cell.y,
      bombId: null,
      spawnTick: null,
      explodeTick: null,
    });
    return true;
  }

  resolve(result: V3ActionResult) {
    const visual = this.#pending.get(result.commandSeq);
    if (!visual) return false;
    if (!result.accepted) return this.#pending.delete(result.commandSeq);
    const bombId = result.bombId ?? null;
    if (bombId !== null && this.#authoritativeIds.has(bombId)) {
      return this.#pending.delete(result.commandSeq);
    }
    this.#pending.set(result.commandSeq, {
      ...visual,
      x: result.cell?.x ?? visual.x,
      y: result.cell?.y ?? visual.y,
      bombId,
      spawnTick: result.spawnTick ?? null,
      explodeTick: result.explodeTick ?? null,
    });
    return true;
  }

  observeAuthoritative(bombs: readonly BombEntity[]) {
    this.#authoritativeIds = new Set(bombs.map((bomb) => bomb.id));
    let removed = 0;
    for (const [commandSeq, visual] of this.#pending) {
      if (visual.bombId !== null && this.#authoritativeIds.has(visual.bombId)) {
        this.#pending.delete(commandSeq);
        removed += 1;
      }
    }
    return removed;
  }

  reject(commandSeq: number) {
    return this.#pending.delete(commandSeq);
  }

  reset() {
    this.#pending.clear();
    this.#authoritativeIds.clear();
  }

  get visuals() {
    return [...this.#pending.values()].map((visual) => ({ ...visual }));
  }
}

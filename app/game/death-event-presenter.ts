import type { V3WorldEvent } from "./protocol-v3.ts";

export const PLAYER_DEATH_ANIMATION_MS = 650;

export type DeathVisual = {
  id: string;
  eventSeq: number;
  playerId: string;
  x: number;
  y: number;
  isAI: boolean;
  nickname: string;
  expiresAt: number;
};

export class DeathEventPresenter {
  #visuals = new Map<string, DeathVisual>();

  ingest(event: V3WorldEvent, now: number) {
    if (event.eventType !== "explosion" && event.eventType !== "player_damage") return 0;
    let added = 0;
    for (const damage of event.damaged ?? []) {
      if (
        (damage.outcome !== "death" && damage.outcome !== "ai_respawn") ||
        typeof damage.playerId !== "string" ||
        !Number.isFinite(damage.x) ||
        !Number.isFinite(damage.y)
      ) {
        continue;
      }
      const id = `death-${event.eventSeq}-${damage.playerId}`;
      if (this.#visuals.has(id)) continue;
      this.#visuals.set(id, {
        id,
        eventSeq: event.eventSeq,
        playerId: damage.playerId,
        x: damage.x,
        y: damage.y,
        isAI: Boolean(damage.isAI),
        nickname: typeof damage.nickname === "string" ? damage.nickname : "",
        expiresAt: now + PLAYER_DEATH_ANIMATION_MS,
      });
      added += 1;
    }
    return added;
  }

  active(now: number) {
    for (const [id, visual] of this.#visuals) {
      if (visual.expiresAt <= now) this.#visuals.delete(id);
    }
    return [...this.#visuals.values()];
  }

  reset() {
    this.#visuals.clear();
  }
}

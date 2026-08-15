import { netTickDelta } from "../../shared/net-tick.mjs";
import type { FlameEntity } from "./protocol.ts";
import type { V3WorldEvent } from "./protocol-v3.ts";

export type ExplosionFlameVisual = {
  id: string;
  eventSeq: number;
  x: number;
  y: number;
  expireTick: number;
};

export class ExplosionEventPresenter {
  #events = new Map<number, V3WorldEvent>();

  ingest(event: V3WorldEvent, estimatedServerTick: number) {
    if (this.#remainingTicks(event.expireTick, estimatedServerTick) <= 0) return false;
    this.#events.set(event.eventSeq, event);
    return true;
  }

  observeAuthoritative(flames: readonly FlameEntity[]) {
    const authoritativeEvents = new Set(
      flames
        .map((flame) => flame.eventSeq)
        .filter((eventSeq): eventSeq is number => Number.isInteger(eventSeq)),
    );
    let removed = 0;
    for (const eventSeq of authoritativeEvents) {
      if (this.#events.delete(eventSeq)) removed += 1;
    }
    return removed;
  }

  active(estimatedServerTick: number) {
    const visuals: ExplosionFlameVisual[] = [];
    let nextExpiryTicks = Number.POSITIVE_INFINITY;
    for (const [eventSeq, event] of this.#events) {
      const remainingTicks = this.#remainingTicks(event.expireTick, estimatedServerTick);
      if (remainingTicks <= 0) {
        this.#events.delete(eventSeq);
        continue;
      }
      nextExpiryTicks = Math.min(nextExpiryTicks, remainingTicks);
      for (const cell of event.cells ?? []) {
        visuals.push({
          id: `event-${eventSeq}-${cell.x},${cell.y}`,
          eventSeq,
          x: cell.x,
          y: cell.y,
          expireTick: event.expireTick,
        });
      }
    }
    return {
      visuals,
      nextExpiryTicks: Number.isFinite(nextExpiryTicks) ? nextExpiryTicks : null,
    };
  }

  #remainingTicks(expireTick: number, estimatedServerTick: number) {
    const wholeTick = Math.floor(estimatedServerTick);
    return netTickDelta(expireTick, wholeTick >>> 0) - (estimatedServerTick - wholeTick);
  }

  reset() {
    this.#events.clear();
  }
}

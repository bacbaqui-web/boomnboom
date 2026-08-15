"use client";

import { memo, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { PositionInterpolator } from "./position-interpolator";
import type { PlayerEntity, WorldEntity } from "./protocol";
import type { ClientWorldStore } from "./world-store";

function AnimatedPlayer({ player, tileSize }: { player: PlayerEntity; tileSize: number }) {
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const motionRef = useRef(new PositionInterpolator(135));
  const previousRef = useRef({ x: player.x, y: player.y });

  useLayoutEffect(() => {
    const previous = previousRef.current;
    const teleport = Math.hypot(player.x - previous.x, player.y - previous.y) > 2;
    motionRef.current.setTarget(player.x, player.y, performance.now(), { teleport });
    previousRef.current = { x: player.x, y: player.y };
  }, [player.x, player.y]);

  useEffect(() => {
    let frame = 0;
    const paint = (now: number) => {
      const visual = motionRef.current.sample(now);
      if (elementRef.current) {
        elementRef.current.style.transform = `translate3d(${(visual.x + 0.14) * tileSize}px, ${(visual.y + 0.14) * tileSize}px, 0)`;
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [tileSize]);

  return (
    <span
      ref={elementRef}
      className={`fighter worldEntity ${player.isAI ? "ai" : "rival"} ${player.shield > 0 ? "shielded" : ""}`}
      style={{ width: tileSize * 0.72, height: tileSize * 0.72 }}
      title={player.nickname}
    >
      <em>{player.nickname}</em>
      {player.isAI ? "AI" : "◉"}
    </span>
  );
}

function staticPosition(entity: { x: number; y: number }, inset: number, tileSize: number) {
  return {
    transform: `translate3d(${(entity.x + inset) * tileSize}px, ${(entity.y + inset) * tileSize}px, 0)`,
  };
}

export const EntityLayer = memo(function EntityLayer({
  store,
  tileSize,
  localPlayer,
}: {
  store: ClientWorldStore;
  tileSize: number;
  localPlayer: PlayerEntity | undefined;
}) {
  const snapshot = useSyncExternalStore(
    store.subscribeEntities,
    store.getEntitySnapshot,
    store.getEntitySnapshot,
  );
  return (
    <div className="entityLayer">
      {snapshot.entities.map((entity: WorldEntity) => {
        if (entity.kind === "player") {
          return entity.id === localPlayer?.id || !entity.alive ? null : (
            <AnimatedPlayer key={`player:${entity.id}`} player={entity} tileSize={tileSize} />
          );
        }
        if (entity.kind === "bomb") {
          if (entity.x === localPlayer?.x && entity.y === localPlayer.y) return null;
          return (
            <span
              key={`bomb:${entity.id}`}
              className="bomb worldEntity"
              style={{
                ...staticPosition(entity, 0.175, tileSize),
                width: tileSize * 0.65,
                height: tileSize * 0.65,
              }}
            >
              <span>✦</span><i>{entity.fuse}</i>
            </span>
          );
        }
        if (entity.kind === "item") {
          return (
            <span
              key={`item:${entity.id}`}
              className={`item item-${entity.type} worldEntity`}
              style={{
                ...staticPosition(entity, 0.21, tileSize),
                width: tileSize * 0.58,
                height: tileSize * 0.58,
              }}
              title={entity.type === "bomb" ? "폭탄 수 증가" : entity.type === "shield" ? "폭발 1회 방어" : "폭탄 화력 증가"}
            >
              {entity.type === "bomb" ? "●" : entity.type === "shield" ? "◆" : "🔥"}
            </span>
          );
        }
        return (
          <span
            key={`flame:${entity.id}`}
            className="flame worldEntity"
            style={staticPosition(entity, 0.5, tileSize)}
          >
            ✦
          </span>
        );
      })}
    </div>
  );
});

"use client";

import { memo, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { crossedAdjacentCell, playerCell, playPlayerJump } from "./player-animation";
import { PlayerAvatar } from "./PlayerAvatar";
import type { PendingBombVisual } from "./pending-bomb-presenter";
import type { ExplosionFlameVisual } from "./explosion-event-presenter";
import { PositionInterpolator } from "./position-interpolator";
import type { PlayerEntity, WorldEntity } from "./protocol";
import type { RemotePositionSource } from "./remote-snapshot-buffer";
import type { ClientWorldStore } from "./world-store";

function AnimatedPlayer({
  player,
  tileSize,
  remotePositionSource,
}: {
  player: PlayerEntity;
  tileSize: number;
  remotePositionSource: RemotePositionSource | null;
}) {
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const avatarRef = useRef<HTMLSpanElement | null>(null);
  const jumpRef = useRef<Animation | null>(null);
  const motionRef = useRef(new PositionInterpolator(135));
  const previousRef = useRef({ x: player.x, y: player.y });
  const visualCellRef = useRef<{ x: number; y: number } | null>(null);
  const lastJumpAtRef = useRef(Number.NEGATIVE_INFINITY);

  useLayoutEffect(() => {
    if (remotePositionSource) return;
    const previous = previousRef.current;
    const distance = Math.hypot(player.x - previous.x, player.y - previous.y);
    const teleport = distance > 2;
    motionRef.current.setTarget(player.x, player.y, performance.now(), { teleport });
    if (distance > 0 && !teleport && avatarRef.current) {
      jumpRef.current = playPlayerJump(avatarRef.current, jumpRef.current);
    } else if (teleport) {
      jumpRef.current?.cancel();
    }
    previousRef.current = { x: player.x, y: player.y };
  }, [player.x, player.y, remotePositionSource]);

  useEffect(() => {
    let frame = 0;
    const paint = (now: number) => {
      const visual = remotePositionSource?.sample(player.id, now) ?? motionRef.current.sample(now);
      if (remotePositionSource && visual) {
        const cell = playerCell(visual);
        if (
          crossedAdjacentCell(visualCellRef.current, cell) &&
          now - lastJumpAtRef.current >= 90 &&
          avatarRef.current
        ) {
          jumpRef.current = playPlayerJump(avatarRef.current, jumpRef.current);
          lastJumpAtRef.current = now;
        }
        visualCellRef.current = cell;
      }
      if (elementRef.current) {
        elementRef.current.style.transform = `translate3d(${(visual.x + 0.14) * tileSize}px, ${(visual.y + 0.14) * tileSize}px, 0)`;
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(frame);
      jumpRef.current?.cancel();
    };
  }, [player.id, remotePositionSource, tileSize]);

  return (
    <span
      ref={elementRef}
      className="playerAnchor worldEntity"
      style={{
        ...staticPosition(player, 0.14, tileSize),
        width: tileSize * 0.72,
        height: tileSize * 0.72,
      }}
    >
      <PlayerAvatar
        ref={avatarRef}
        player={player}
        variant={player.isAI ? "ai" : "rival"}
      />
    </span>
  );
}

function staticPosition(entity: { x: number; y: number }, inset: number, tileSize: number) {
  return {
    transform: `translate3d(${(entity.x + inset) * tileSize}px, ${(entity.y + inset) * tileSize}px, 0)`,
  };
}

function cellPosition(entity: { x: number; y: number }, tileSize: number) {
  return {
    ...staticPosition(entity, 0, tileSize),
    width: tileSize,
    height: tileSize,
  };
}

export const EntityLayer = memo(function EntityLayer({
  store,
  tileSize,
  localPlayer,
  centerLocalBomb,
  remotePositionSource,
  pendingBombs,
  explosionFlames,
}: {
  store: ClientWorldStore;
  tileSize: number;
  localPlayer: PlayerEntity | undefined;
  centerLocalBomb: boolean;
  remotePositionSource: RemotePositionSource | null;
  pendingBombs: readonly PendingBombVisual[];
  explosionFlames: readonly ExplosionFlameVisual[];
}) {
  const snapshot = useSyncExternalStore(
    store.subscribeEntities,
    store.getEntitySnapshot,
    store.getEntitySnapshot,
  );
  return (
    <div className="entityLayer">
      {explosionFlames.map((flame) => (
        <span
          key={flame.id}
          className="flame worldEntity eventFlame"
          style={cellPosition(flame, tileSize)}
        >
          ✦
        </span>
      ))}
      {pendingBombs.map((bomb) => (
        <span
          key={`pending-bomb:${bomb.commandSeq}`}
          className="bomb worldEntity pendingBomb"
          style={{
            ...staticPosition(bomb, 0.175, tileSize),
            width: tileSize * 0.65,
            height: tileSize * 0.65,
            opacity: 0.65,
          }}
        >
          <span>✦</span><i>…</i>
        </span>
      ))}
      {snapshot.entities.map((entity: WorldEntity) => {
        if (entity.kind === "player") {
          return entity.id === localPlayer?.id || !entity.alive ? null : (
            <AnimatedPlayer
              key={`player:${entity.id}`}
              player={entity}
              tileSize={tileSize}
              remotePositionSource={remotePositionSource}
            />
          );
        }
        if (entity.kind === "bomb") {
          if (
            centerLocalBomb &&
            entity.x === localPlayer?.x &&
            entity.y === localPlayer.y
          ) return null;
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
              title={entity.type === "bomb" ? "폭탄 수 증가" : entity.type === "shield" ? "폭발 1회 방어" : entity.type === "flame" ? "폭탄 화력 증가" : "이동속도 0.5칸/초 증가"}
            >
              {entity.type === "bomb" ? "●" : entity.type === "shield" ? "◆" : entity.type === "flame" ? "🔥" : "➤"}
            </span>
          );
        }
        return (
          <span
            key={`flame:${entity.id}`}
            className="flame worldEntity"
            style={cellPosition(entity, tileSize)}
          >
            ✦
          </span>
        );
      })}
    </div>
  );
});

"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { PlayerAvatar } from "./PlayerAvatar";
import type { PendingBombVisual } from "./pending-bomb-presenter";
import type { ExplosionFlameVisual } from "./explosion-event-presenter";
import type { DeathVisual } from "./death-event-presenter";
import type { PlayerEntity, WorldEntity } from "./protocol";
import { RemotePlayerPainter } from "./remote-player-painter";
import type { RemotePositionSource } from "./remote-snapshot-buffer";
import type { RenderFrameCoordinator } from "./render-frame-coordinator";
import { isWithinRenderBounds } from "./render-visibility";
import type { ClientWorldStore } from "./world-store";

function AnimatedPlayer({
  player,
  tileSize,
  painter,
}: {
  player: PlayerEntity;
  tileSize: number;
  painter: RemotePlayerPainter;
}) {
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const avatarRef = useRef<HTMLSpanElement | null>(null);
  const initialPositionRef = useRef({ x: player.x, y: player.y });

  useLayoutEffect(() => {
    if (!elementRef.current || !avatarRef.current) return;
    painter.register(
      player.id,
      initialPositionRef.current,
      { element: elementRef.current, avatar: avatarRef.current },
      performance.now(),
    );
    return () => painter.unregister(player.id);
  }, [painter, player.id]);

  useLayoutEffect(() => {
    painter.updateTarget(player.id, { x: player.x, y: player.y }, performance.now());
  }, [painter, player.id, player.x, player.y]);

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
  frameCoordinator,
  visibleWidth,
  visibleHeight,
  pendingBombs,
  explosionFlames,
  deathVisuals,
}: {
  store: ClientWorldStore;
  tileSize: number;
  localPlayer: PlayerEntity | undefined;
  centerLocalBomb: boolean;
  remotePositionSource: RemotePositionSource | null;
  frameCoordinator: RenderFrameCoordinator;
  visibleWidth: number;
  visibleHeight: number;
  pendingBombs: readonly PendingBombVisual[];
  explosionFlames: readonly ExplosionFlameVisual[];
  deathVisuals: readonly DeathVisual[];
}) {
  const [painter] = useState(() => new RemotePlayerPainter());
  const snapshot = useSyncExternalStore(
    store.subscribeEntities,
    store.getEntitySnapshot,
    store.getEntitySnapshot,
  );
  useEffect(
    () => frameCoordinator.subscribe((frame) => {
      painter.paint(frame, remotePositionSource, tileSize);
    }),
    [frameCoordinator, painter, remotePositionSource, tileSize],
  );
  useEffect(() => () => painter.clear(), [painter]);
  const dyingPlayerIds = new Set(deathVisuals.map((visual) => visual.playerId));
  const center = localPlayer ?? { x: 0, y: 0 };
  const isVisible = (position: { x: number; y: number }) =>
    isWithinRenderBounds(position, center, visibleWidth, visibleHeight);
  return (
    <div className="entityLayer">
      {explosionFlames.filter(isVisible).map((flame) => (
        <span
          key={flame.id}
          className="flame worldEntity eventFlame"
          style={cellPosition(flame, tileSize)}
        >
          ✦
        </span>
      ))}
      {pendingBombs.filter(isVisible).map((bomb) => (
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
        if (!isVisible(entity)) return null;
        if (entity.kind === "player") {
          return entity.id === localPlayer?.id || !entity.alive || dyingPlayerIds.has(entity.id) ? null : (
            <AnimatedPlayer
              key={`player:${entity.id}`}
              player={entity}
              tileSize={tileSize}
              painter={painter}
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
      {deathVisuals.filter(isVisible).map((visual) => (
        <span
          key={visual.id}
          className="playerAnchor worldEntity deathBurst"
          style={{
            ...staticPosition(visual, 0.14, tileSize),
            width: tileSize * 0.72,
            height: tileSize * 0.72,
          }}
        >
          <PlayerAvatar
            player={{
              nickname: visual.nickname,
              isAI: visual.isAI,
              shield: 0,
              color: visual.color,
            }}
            variant={
              visual.playerId === localPlayer?.id
                ? "me"
                : visual.isAI
                  ? "ai"
                  : "rival"
            }
            dying
          />
        </span>
      ))}
    </div>
  );
});

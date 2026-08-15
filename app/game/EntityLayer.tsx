"use client";

import { memo, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { clearPlayerTravelPose, paintPlayerTravelPose } from "./player-animation";
import { PlayerAvatar } from "./PlayerAvatar";
import type { PendingBombVisual } from "./pending-bomb-presenter";
import type { ExplosionFlameVisual } from "./explosion-event-presenter";
import type { DeathVisual } from "./death-event-presenter";
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
  const motionRef = useRef(new PositionInterpolator(135));
  const previousRef = useRef({ x: player.x, y: player.y });
  const previousVisualRef = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (remotePositionSource) return;
    const previous = previousRef.current;
    const distance = Math.hypot(player.x - previous.x, player.y - previous.y);
    const teleport = distance > 2;
    motionRef.current.setTarget(player.x, player.y, performance.now(), { teleport });
    if (teleport) previousVisualRef.current = null;
    previousRef.current = { x: player.x, y: player.y };
  }, [player.x, player.y, remotePositionSource]);

  useEffect(() => {
    let frame = 0;
    const avatarElement = avatarRef.current;
    const paint = (now: number) => {
      const visual = remotePositionSource?.sample(player.id, now) ?? motionRef.current.sample(now);
      if (avatarRef.current) {
        paintPlayerTravelPose(avatarRef.current, previousVisualRef.current, visual);
      }
      previousVisualRef.current = visual;
      if (elementRef.current) {
        elementRef.current.style.transform = `translate3d(${(visual.x + 0.14) * tileSize}px, ${(visual.y + 0.14) * tileSize}px, 0)`;
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(frame);
      clearPlayerTravelPose(avatarElement);
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
  deathVisuals,
}: {
  store: ClientWorldStore;
  tileSize: number;
  localPlayer: PlayerEntity | undefined;
  centerLocalBomb: boolean;
  remotePositionSource: RemotePositionSource | null;
  pendingBombs: readonly PendingBombVisual[];
  explosionFlames: readonly ExplosionFlameVisual[];
  deathVisuals: readonly DeathVisual[];
}) {
  const snapshot = useSyncExternalStore(
    store.subscribeEntities,
    store.getEntitySnapshot,
    store.getEntitySnapshot,
  );
  const dyingPlayerIds = new Set(deathVisuals.map((visual) => visual.playerId));
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
          return entity.id === localPlayer?.id || !entity.alive || dyingPlayerIds.has(entity.id) ? null : (
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
      {deathVisuals.map((visual) => (
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

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CameraRuntime } from "./camera-runtime";
import { EnemyPointers } from "./EnemyPointers";
import { EntityLayer } from "./EntityLayer";
import { findLocalBomb, selectEnemySummaries } from "./entity-selectors";
import { crossedAdjacentCell, playerCell, playPlayerJump } from "./player-animation";
import { PlayerAvatar } from "./PlayerAvatar";
import type { Position } from "./position-interpolator";
import type { PlayerEntity } from "./protocol";
import type { RemotePositionSource } from "./remote-snapshot-buffer";
import type { PendingBombVisual } from "./pending-bomb-presenter";
import type { ExplosionFlameVisual } from "./explosion-event-presenter";
import { TerrainLayer } from "./TerrainLayer";
import type { ClientWorldStore, EntitySnapshot, WorldSnapshot } from "./world-store";

export function WorldViewport({
  store,
  snapshot,
  entitySnapshot,
  localPlayer,
  localVisualPosition,
  localPositionSource,
  remotePositionSource,
  pendingBombs,
  explosionFlames,
  onLocalStep,
  children,
}: {
  store: ClientWorldStore;
  snapshot: WorldSnapshot;
  entitySnapshot: EntitySnapshot;
  localPlayer: PlayerEntity | undefined;
  localVisualPosition: Position | null;
  localPositionSource: { sample(now: number): Position } | null;
  remotePositionSource: RemotePositionSource | null;
  pendingBombs: readonly PendingBombVisual[];
  explosionFlames: readonly ExplosionFlameVisual[];
  onLocalStep?: () => void;
  children?: React.ReactNode;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const localAvatarRef = useRef<HTMLSpanElement | null>(null);
  const localJumpRef = useRef<Animation | null>(null);
  const localVisualCellRef = useRef<{ x: number; y: number } | null>(null);
  const lastLocalJumpAtRef = useRef(Number.NEGATIVE_INFINITY);
  const cameraRef = useRef(new CameraRuntime(175));
  const previousPlayerRef = useRef<{ x: number; y: number; alive: boolean } | null>(null);
  const [tileSize, setTileSize] = useState(0);
  const metadata = snapshot.metadata;
  const visibleWidth = metadata?.visibleWidth ?? 15;
  const visibleHeight = metadata?.visibleHeight ?? 11;

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const update = () => setTileSize(board.clientWidth / visibleWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(board);
    return () => observer.disconnect();
  }, [visibleWidth]);

  useLayoutEffect(() => {
    if (localPositionSource || !localPlayer || !localVisualPosition) return;
    const previous = previousPlayerRef.current;
    const distance = previous
      ? Math.hypot(localVisualPosition.x - previous.x, localVisualPosition.y - previous.y)
      : 0;
    const teleport =
      !previous ||
      (!previous.alive && localPlayer.alive) ||
      distance > 2;
    cameraRef.current.setTarget(localVisualPosition.x, localVisualPosition.y, performance.now(), { teleport });
    if (previous?.alive && localPlayer.alive && distance > 0 && !teleport && localAvatarRef.current) {
      localJumpRef.current = playPlayerJump(localAvatarRef.current, localJumpRef.current);
    } else if (teleport) {
      localJumpRef.current?.cancel();
    }
    previousPlayerRef.current = {
      x: localVisualPosition.x,
      y: localVisualPosition.y,
      alive: localPlayer.alive,
    };
  }, [localPlayer, localPositionSource, localVisualPosition]);

  useEffect(() => {
    let frame = 0;
    localVisualCellRef.current = null;
    const paint = (now: number) => {
      const board = boardRef.current;
      const root = rootRef.current;
      if (board && root && tileSize > 0) {
        if (localPositionSource) {
          const visual = localPositionSource.sample(now);
          const cell = playerCell(visual);
          if (
            localPlayer?.alive &&
            crossedAdjacentCell(localVisualCellRef.current, cell) &&
            now - lastLocalJumpAtRef.current >= 90
          ) {
            if (localAvatarRef.current) {
              localJumpRef.current = playPlayerJump(
                localAvatarRef.current,
                localJumpRef.current,
              );
            }
            lastLocalJumpAtRef.current = now;
            onLocalStep?.();
          }
          localVisualCellRef.current = cell;
          root.style.transform = CameraRuntime.transformFor(
              visual,
              board.clientWidth,
              board.clientHeight,
              tileSize,
            );
        } else {
          root.style.transform = cameraRef.current.transformAt(
              now,
              board.clientWidth,
              board.clientHeight,
              tileSize,
            );
        }
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(frame);
      localJumpRef.current?.cancel();
    };
  }, [localPlayer?.alive, localPositionSource, onLocalStep, tileSize]);

  const localBomb = localPositionSource
    ? undefined
    : findLocalBomb(entitySnapshot.entities, localPlayer);
  const enemies = selectEnemySummaries(
    entitySnapshot.entities,
    localPlayer,
    entitySnapshot.enemies,
  );
  return (
    <div
      ref={boardRef}
      className="board"
      style={{ aspectRatio: `${visibleWidth}/${visibleHeight}` }}
    >
      <div ref={rootRef} className="worldRoot">
        {tileSize > 0 ? (
          <>
            <TerrainLayer
              store={store}
              chunkKeys={snapshot.chunkKeys}
              tileSize={tileSize}
              centerX={localPlayer?.x ?? 0}
              centerY={localPlayer?.y ?? 0}
              chunkSize={metadata?.chunkSize ?? 16}
            />
            <EntityLayer
              store={store}
              tileSize={tileSize}
              localPlayer={localPlayer}
              centerLocalBomb={!localPositionSource}
              remotePositionSource={remotePositionSource}
              pendingBombs={pendingBombs}
              explosionFlames={explosionFlames}
            />
          </>
        ) : null}
      </div>
      {localPlayer?.alive ? (
        <span
          className="playerAnchor centerPlayer"
          style={{ width: tileSize * 0.72, height: tileSize * 0.72 }}
        >
          <PlayerAvatar
            ref={localAvatarRef}
            player={localPlayer}
            variant="me"
          />
        </span>
      ) : null}
      {localBomb ? (
        <span
          className="bomb centerBomb"
          style={{ width: tileSize * 0.65, height: tileSize * 0.65 }}
        >
          <span>✦</span><i>{localBomb.fuse}</i>
        </span>
      ) : null}
      <EnemyPointers
        enemies={enemies}
        visibleWidth={visibleWidth}
        visibleHeight={visibleHeight}
      />
      {localPlayer ? (
        <span className="coordinates">{localPlayer.x}, {localPlayer.y}</span>
      ) : null}
      {children}
    </div>
  );
}

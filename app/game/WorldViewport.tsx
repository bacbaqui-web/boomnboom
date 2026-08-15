"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CameraRuntime } from "./camera-runtime";
import { EnemyPointers } from "./EnemyPointers";
import { EntityLayer } from "./EntityLayer";
import { findLocalBomb } from "./entity-selectors";
import type { Position } from "./position-interpolator";
import type { Action, PlayerEntity } from "./protocol";
import { TerrainLayer } from "./TerrainLayer";
import type { ClientWorldStore, EntitySnapshot, WorldSnapshot } from "./world-store";

const actionIcon: Record<Action, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  bomb: "●",
  wait: "Ⅱ",
  stop: "Ⅱ",
};

export function WorldViewport({
  store,
  snapshot,
  entitySnapshot,
  localPlayer,
  localVisualPosition,
  queuedAction,
  children,
}: {
  store: ClientWorldStore;
  snapshot: WorldSnapshot;
  entitySnapshot: EntitySnapshot;
  localPlayer: PlayerEntity | undefined;
  localVisualPosition: Position | null;
  queuedAction: Action;
  children?: React.ReactNode;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
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
    if (!localPlayer || !localVisualPosition) return;
    const previous = previousPlayerRef.current;
    const teleport =
      !previous ||
      (!previous.alive && localPlayer.alive) ||
      Math.hypot(localVisualPosition.x - previous.x, localVisualPosition.y - previous.y) > 2;
    cameraRef.current.setTarget(localVisualPosition.x, localVisualPosition.y, performance.now(), { teleport });
    previousPlayerRef.current = {
      x: localVisualPosition.x,
      y: localVisualPosition.y,
      alive: localPlayer.alive,
    };
  }, [localPlayer, localVisualPosition]);

  useEffect(() => {
    let frame = 0;
    const paint = (now: number) => {
      const board = boardRef.current;
      const root = rootRef.current;
      if (board && root && tileSize > 0) {
        root.style.transform = cameraRef.current.transformAt(
          now,
          board.clientWidth,
          board.clientHeight,
          tileSize,
        );
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [tileSize]);

  const localBomb = findLocalBomb(entitySnapshot.entities, localPlayer);
  return (
    <div
      ref={boardRef}
      className="board"
      style={{ aspectRatio: `${visibleWidth}/${visibleHeight}` }}
    >
      <div ref={rootRef} className="worldRoot">
        {tileSize > 0 ? (
          <>
            <TerrainLayer store={store} chunkKeys={snapshot.chunkKeys} tileSize={tileSize} />
            <EntityLayer store={store} tileSize={tileSize} localPlayer={localPlayer} />
          </>
        ) : null}
      </div>
      {localPlayer?.alive ? (
        <span
          className={`fighter me centerPlayer ${localPlayer.shield > 0 ? "shielded" : ""}`}
          style={{ width: tileSize * 0.72, height: tileSize * 0.72 }}
        >
          <em>{localPlayer.nickname}</em>◉
          <i className={`actionCue cue-${queuedAction}`} title="내 현재 행동">
            {actionIcon[queuedAction]}
          </i>
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
        enemies={entitySnapshot.enemies}
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

"use client";

import { memo, useCallback, useMemo, useSyncExternalStore } from "react";
import type { ClientWorldStore } from "./world-store";
import { selectViewportChunkKeys } from "./world-selectors";

const TerrainChunk = memo(function TerrainChunk({
  store,
  chunkKey,
  tileSize,
}: {
  store: ClientWorldStore;
  chunkKey: string;
  tileSize: number;
}) {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeChunk(chunkKey, listener),
    [chunkKey, store],
  );
  const getSnapshot = useCallback(() => store.getChunk(chunkKey), [chunkKey, store]);
  const chunk = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!chunk) return null;
  return (
    <div
      className="terrainChunk"
      data-chunk-key={chunkKey}
      data-revision={chunk.revision}
      style={{
        left: chunk.originX * tileSize,
        top: chunk.originY * tileSize,
        width: 16 * tileSize,
        height: 16 * tileSize,
        backgroundSize: `${tileSize * 2}px ${tileSize * 2}px`,
      }}
    >
      {chunk.tiles.map((tile, index) => {
        if (tile === "floor") return null;
        const localX = index % 16;
        const localY = Math.floor(index / 16);
        return (
          <div
            className={`tile ${tile}`}
            key={index}
            style={{
              left: localX * tileSize,
              top: localY * tileSize,
              width: tileSize,
              height: tileSize,
            }}
          >
            {tile === "crate" ? <span className="box" /> : null}
          </div>
        );
      })}
    </div>
  );
});

export const TerrainLayer = memo(function TerrainLayer({
  store,
  chunkKeys,
  tileSize,
  centerX,
  centerY,
  visibleWidth,
  visibleHeight,
  chunkSize,
}: {
  store: ClientWorldStore;
  chunkKeys: readonly string[];
  tileSize: number;
  centerX: number;
  centerY: number;
  visibleWidth: number;
  visibleHeight: number;
  chunkSize: number;
}) {
  const visibleChunkKeys = useMemo(
    () => selectViewportChunkKeys(
      chunkKeys,
      centerX,
      centerY,
      visibleWidth,
      visibleHeight,
      chunkSize,
    ),
    [centerX, centerY, chunkKeys, chunkSize, visibleHeight, visibleWidth],
  );
  return (
    <div className="terrainLayer">
      {visibleChunkKeys.map((chunkKey) => (
        <TerrainChunk key={chunkKey} store={store} chunkKey={chunkKey} tileSize={tileSize} />
      ))}
    </div>
  );
});

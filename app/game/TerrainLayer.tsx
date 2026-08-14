"use client";

import { memo, useCallback, useSyncExternalStore } from "react";
import type { ClientWorldStore } from "./world-store";

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
  const warningCells = new Set(
    chunk.respawns.filter((respawn) => respawn.committed).map((respawn) => respawn.index),
  );
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
        gridTemplateColumns: "repeat(16, 1fr)",
      }}
    >
      {chunk.tiles.map((baseTile, index) => {
        const localX = index % 16;
        const localY = Math.floor(index / 16);
        const worldX = chunk.originX + localX;
        const worldY = chunk.originY + localY;
        const tile = warningCells.has(index) ? "warning" : baseTile;
        return (
          <div
            className={`tile ${tile} ${(worldX + worldY) & 1 ? "floorAlt" : ""}`}
            key={index}
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
}: {
  store: ClientWorldStore;
  chunkKeys: readonly string[];
  tileSize: number;
}) {
  return (
    <div className="terrainLayer">
      {chunkKeys.map((chunkKey) => (
        <TerrainChunk key={chunkKey} store={store} chunkKey={chunkKey} tileSize={tileSize} />
      ))}
    </div>
  );
});

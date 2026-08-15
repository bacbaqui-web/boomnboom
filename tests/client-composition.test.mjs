import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("client composes the authoritative WebSocket world from focused modules", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const socket = await readFile(new URL("../app/game/game-socket.ts", import.meta.url), "utf8");
  const viewport = await readFile(new URL("../app/game/WorldViewport.tsx", import.meta.url), "utf8");
  const terrain = await readFile(new URL("../app/game/TerrainLayer.tsx", import.meta.url), "utf8");
  const entities = await readFile(new URL("../app/game/EntityLayer.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(socket, /wss:\/\/insight\.magamiscom\.ing\/boom-ws/);
  assert.match(socket, /protocol:\s*2/);
  assert.match(socket, /type:\s*"input"/);
  assert.match(socket, /knownChunkRevisions/);
  assert.match(viewport, /requestAnimationFrame/);
  assert.match(viewport, /cancelAnimationFrame/);
  assert.match(viewport, /transformAt/);
  assert.match(terrain, /data-revision/);
  assert.match(entities, /staticPosition\(entity, 0, tileSize\)/);
  assert.match(entities, /style=\{cellPosition\((?:flame|entity), tileSize\)\}/);
  assert.match(styles, /\.flame \{[^}]*display: grid;[^}]*place-items: center;/);
  assert.match(page, /WorldTickHud|WorldViewport|GameControls/);
  assert.doesNotMatch(`${page}\n${viewport}\n${entities}\n${styles}`, /queuedAction|actionCue/);
  assert.doesNotMatch(page, /WebSocket|requestAnimationFrame|Audio\(/);
});

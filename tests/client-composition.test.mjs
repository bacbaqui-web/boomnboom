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
  const controller = await readFile(
    new URL("../app/game/use-game-controller.ts", import.meta.url),
    "utf8",
  );
  assert.match(socket, /wss:\/\/insight\.magamiscom\.ing\/boom-ws/);
  assert.match(socket, /protocol:\s*2/);
  assert.match(socket, /type:\s*"input"/);
  assert.match(socket, /knownChunkRevisions/);
  assert.match(viewport, /requestAnimationFrame/);
  assert.match(viewport, /cancelAnimationFrame/);
  assert.match(viewport, /transformAt/);
  assert.match(controller, /new PositionInterpolator\(1000 \/ 30\)/);
  assert.match(controller, /predictor\.previewNext/);
  assert.match(controller, /requestAnimationFrame\(runPredictionFrame\)/);
  assert.match(controller, /cancelAnimationFrame\(frame\)/);
  assert.doesNotMatch(controller, /setInterval\(\(\) => \{\s*const predictor/);
  assert.match(terrain, /data-revision/);
  assert.match(terrain, /selectNearbyChunkKeys/);
  assert.match(entities, /staticPosition\(entity, 0, tileSize\)/);
  assert.match(entities, /style=\{cellPosition\((?:flame|entity), tileSize\)\}/);
  assert.match(styles, /\.flame \{[^}]*display: grid;[^}]*place-items: center;/);
  assert.match(page, /WorldViewport/);
  assert.match(page, /GameControls/);
  assert.match(page, /game\.joined \? "gameActive"/);
  assert.match(styles, /main\.gameActive \{[^}]*align-items: center;[^}]*justify-content: center;/);
  assert.doesNotMatch(page, /GameHeader|WorldTickHud/);
  assert.match(viewport, /selectEnemySummaries/);
  assert.doesNotMatch(`${page}\n${viewport}\n${entities}\n${styles}`, /queuedAction|actionCue/);
  assert.doesNotMatch(page, /WebSocket|requestAnimationFrame|Audio\(/);
});

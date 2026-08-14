import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the BOOMnBOOM tick game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>BOOMnBOOM — 끝없는 공유 월드 폭탄 대전<\/title>/);
  assert.match(html, /Oracle 게임 서버에 접속하는 중/);
  assert.match(html, /다음 턴까지 1초 게이지/);
  assert.match(html, /2초 뒤 재생성/);
  assert.match(html, /og-world\.png/);
});

test("client connects to the authoritative WebSocket server", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const socket = await readFile(new URL("../app/game/game-socket.ts", import.meta.url), "utf8");
  const viewport = await readFile(new URL("../app/game/WorldViewport.tsx", import.meta.url), "utf8");
  const terrain = await readFile(new URL("../app/game/TerrainLayer.tsx", import.meta.url), "utf8");
  assert.match(socket, /wss:\/\/insight\.magamiscom\.ing\/boom-ws/);
  assert.match(socket, /protocol:\s*2/);
  assert.match(socket, /type:\s*"input"/);
  assert.match(socket, /knownChunkRevisions/);
  assert.match(viewport, /requestAnimationFrame/);
  assert.match(viewport, /cancelAnimationFrame/);
  assert.match(viewport, /transformAt/);
  assert.match(terrain, /data-revision/);
  assert.match(page, /GameHud|WorldViewport|GameControls/);
  assert.doesNotMatch(page, /WebSocket|requestAnimationFrame|Audio\(/);
});

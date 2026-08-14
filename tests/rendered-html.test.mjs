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
  assert.match(html, /<title>BOOMnBOOM — 1초 틱 폭탄 대전<\/title>/);
  assert.match(html, /Oracle 게임 서버에 접속하는 중/);
  assert.match(html, /다음 턴까지 1초 게이지/);
  assert.match(html, /2초 뒤 재생성/);
  assert.match(html, /og-tick\.png/);
});

test("client connects to the authoritative WebSocket server", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /wss:\/\/insight\.magamiscom\.ing\/boom-ws/);
  assert.match(page, /type:\s*"action"/);
  assert.match(page, /requestAnimationFrame/);
  assert.match(page, /cancelAnimationFrame/);
  assert.match(page, /paintCamera/);
  assert.match(page, /다음 턴까지 1초 게이지/);
  assert.match(page, /actionCue cue-/);
  assert.doesNotMatch(page, /className="queue"/);
  assert.doesNotMatch(page, /setBeatStep|new AudioContext|beatBounce/);
});

import assert from "node:assert/strict";
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
  assert.doesNotMatch(html, /LIVE WORLD|접속 즉시 같은 맵에 스폰/);
  assert.doesNotMatch(html, /재생성/);
  assert.match(html, /og-world\.png/);
});

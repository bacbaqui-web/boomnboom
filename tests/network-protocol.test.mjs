import assert from "node:assert/strict";
import test from "node:test";
import { resolveNetworkProtocol } from "../app/game/network-protocol.ts";

test("public client defaults to V3 and only protocol=2 selects rollback", () => {
  assert.equal(resolveNetworkProtocol(""), 3);
  assert.equal(resolveNetworkProtocol("?foo=bar"), 3);
  assert.equal(resolveNetworkProtocol("?protocol=3"), 3);
  assert.equal(resolveNetworkProtocol("?protocol=1"), 3);
  assert.equal(resolveNetworkProtocol("?protocol=2"), 2);
  assert.equal(resolveNetworkProtocol("?foo=bar&protocol=2"), 2);
});

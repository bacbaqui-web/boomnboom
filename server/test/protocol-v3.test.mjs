import assert from "node:assert/strict";
import test from "node:test";
import {
  validateV3ClientMessage,
  v3ServerMessage,
} from "../src/network/protocol-v3.mjs";

test("Protocol V3 validates bounded movement/action schemas", () => {
  assert.deepEqual(validateV3ClientMessage(JSON.stringify({
    protocol: 3,
    type: "input_state",
    commandSeq: 7,
    targetTick: 12,
    direction: "left",
  })).value, {
    protocol: 3,
    type: "input_state",
    commandSeq: 7,
    targetTick: 12,
    direction: "left",
  });
  assert.equal(validateV3ClientMessage("{").error.code, "malformed_json");
  assert.equal(validateV3ClientMessage(JSON.stringify({
    protocol: 3,
    type: "input_state",
    commandSeq: -1,
    targetTick: 1,
    direction: "right",
  })).error.code, "invalid_sequence");
  assert.equal(validateV3ClientMessage(JSON.stringify({
    protocol: 3,
    type: "action_command",
    commandSeq: 1,
    targetTick: 1,
    action: "warp",
  })).error.code, "invalid_action");
  assert.equal(validateV3ClientMessage("x".repeat(4097)).error.code, "message_too_large");
  assert.equal(validateV3ClientMessage(JSON.stringify({
    protocol: 3,
    type: "resume",
    resumeToken: "a".repeat(32),
  })).value.type, "resume");
  assert.equal(validateV3ClientMessage(JSON.stringify({
    protocol: 3,
    type: "resume",
    resumeToken: "short",
  })).error.code, "invalid_resume_token");
});

test("Protocol V3 server envelope carries the fixed simulation clock", () => {
  assert.deepEqual(v3ServerMessage("pong", { clientTimeMs: 5 }, {
    tick: 10,
    serverTimeMs: 20,
  }), {
    protocol: 3,
    type: "pong",
    serverTick: 10,
    serverTimeMs: 20,
    clientTimeMs: 5,
  });
});

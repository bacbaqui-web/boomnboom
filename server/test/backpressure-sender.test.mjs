import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { sendWithBackpressure } from "../src/network/backpressure-sender.mjs";

test("backpressure closes a slow client before adding another frame", () => {
  const calls = [];
  const metrics = { outboundMessages: 0, outboundBytes: 0, backpressureDisconnects: 0 };
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 513,
    send(message) {
      calls.push(["send", message]);
    },
    close(code, reason) {
      calls.push(["close", code, reason]);
    },
  };
  assert.equal(
    sendWithBackpressure(socket, { type: "state" }, { maxBufferedAmount: 512, metrics }),
    false,
  );
  assert.deepEqual(calls, [["close", 1013, "backpressure"]]);
  assert.deepEqual(metrics, {
    outboundMessages: 0,
    outboundBytes: 0,
    backpressureDisconnects: 1,
  });
});

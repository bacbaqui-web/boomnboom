import assert from "node:assert/strict";
import test from "node:test";
import { AudioRuntime } from "../app/game/audio-runtime.ts";

function parameter() {
  return {
    values: [],
    setValueAtTime(value, at) { this.values.push(["set", value, at]); },
    exponentialRampToValueAtTime(value, at) { this.values.push(["ramp", value, at]); },
  };
}

function fakeAudio() {
  return {
    paused: true,
    readyState: 1,
    currentTime: 0,
    playbackRate: 1,
    volume: 0,
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    addEventListener() {},
  };
}

function fakeContext() {
  const oscillators = [];
  return {
    currentTime: 2,
    destination: {},
    oscillators,
    resume() { return Promise.resolve(); },
    close() { this.closed = true; return Promise.resolve(); },
    createOscillator() {
      const oscillator = {
        type: "sine",
        frequency: parameter(),
        connect() {},
        start(at) { this.startedAt = at; },
        stop(at) { this.stoppedAt = at; },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain() {
      return { gain: parameter(), connect() {} };
    },
  };
}

test("move and explosion effects use short synthesized tones and obey mute", () => {
  const context = fakeContext();
  const runtime = new AudioRuntime(fakeAudio, () => context);

  assert.equal(runtime.playMove(), true);
  assert.equal(context.oscillators.length, 2);
  assert.ok(context.oscillators.every((tone) => tone.stoppedAt > tone.startedAt));

  assert.equal(runtime.playExplosion(), true);
  assert.equal(context.oscillators.length, 3);
  assert.equal(context.oscillators[2].type, "sawtooth");

  runtime.cycle(null, null);
  runtime.cycle(null, null);
  runtime.cycle(null, null);
  assert.equal(runtime.volumeLevel, 0);
  assert.equal(runtime.playMove(), false);
  assert.equal(context.oscillators.length, 3);

  runtime.dispose();
  assert.equal(context.closed, true);
});

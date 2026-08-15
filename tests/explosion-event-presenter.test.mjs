import assert from "node:assert/strict";
import test from "node:test";
import { ExplosionEventPresenter } from "../app/game/explosion-event-presenter.ts";

function event(overrides = {}) {
  return {
    protocol: 3,
    type: "world_event",
    serverTick: 10,
    serverTimeMs: 1000,
    eventSeq: 1,
    eventType: "explosion",
    eventTick: 10,
    expireTick: 25,
    cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    ...overrides,
  };
}

test("explosion event appears immediately and expires on its authoritative tick", () => {
  const presenter = new ExplosionEventPresenter();
  assert.equal(presenter.ingest(event(), 10), true);
  assert.equal(presenter.active(10).visuals.length, 2);
  assert.equal(presenter.active(24.5).nextExpiryTicks, 0.5);
  assert.deepEqual(presenter.active(25).visuals, []);
});

test("late event fast-forwards its remaining life and an expired event is skipped", () => {
  const presenter = new ExplosionEventPresenter();
  assert.equal(presenter.ingest(event(), 20), true);
  assert.equal(presenter.active(20).nextExpiryTicks, 5);
  assert.equal(presenter.ingest(event({ eventSeq: 2 }), 25), false);
});

test("authoritative flame snapshot dedupes the temporary event and reconnect clears it", () => {
  const presenter = new ExplosionEventPresenter();
  presenter.ingest(event(), 10);
  presenter.observeAuthoritative([{ kind: "flame", id: "F1", x: 0, y: 0, eventSeq: 1 }]);
  assert.deepEqual(presenter.active(11).visuals, []);
  presenter.ingest(event({ eventSeq: 2 }), 10);
  presenter.reset();
  assert.deepEqual(presenter.active(11).visuals, []);
});

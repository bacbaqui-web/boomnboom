import assert from "node:assert/strict";
import test from "node:test";
import {
  DeathEventPresenter,
  PLAYER_DEATH_ANIMATION_MS,
} from "../app/game/death-event-presenter.ts";

function explosionEvent(damaged) {
  return {
    protocol: 3,
    type: "world_event",
    serverTick: 10,
    serverTimeMs: 1000,
    eventSeq: 7,
    eventType: "explosion",
    eventTick: 10,
    expireTick: 25,
    damaged,
  };
}

test("death visuals include human and AI deaths but not shield hits", () => {
  const presenter = new DeathEventPresenter();
  const added = presenter.ingest(explosionEvent([
    { playerId: "P1", outcome: "death", x: 1.25, y: 2, isAI: false, nickname: "P1" },
    { playerId: "BOT-1", outcome: "ai_respawn", x: 3, y: 4, isAI: true, nickname: "AI" },
    { playerId: "P2", outcome: "shield", x: 5, y: 6, isAI: false, nickname: "P2" },
  ]), 100);

  assert.equal(added, 2);
  assert.deepEqual(
    presenter.active(100).map((visual) => [visual.playerId, visual.x, visual.y]),
    [["P1", 1.25, 2], ["BOT-1", 3, 4]],
  );
  assert.equal(presenter.active(100 + PLAYER_DEATH_ANIMATION_MS).length, 0);
});

test("duplicate explosion events do not restart the death animation", () => {
  const presenter = new DeathEventPresenter();
  const event = explosionEvent([
    { playerId: "P1", outcome: "death", x: 1, y: 2, isAI: false, nickname: "P1" },
  ]);
  assert.equal(presenter.ingest(event, 100), 1);
  assert.equal(presenter.ingest(event, 300), 0);
  assert.equal(presenter.active(100 + PLAYER_DEATH_ANIMATION_MS).length, 0);
});

test("live-flame damage events use the same death visual", () => {
  const presenter = new DeathEventPresenter();
  const event = {
    ...explosionEvent([]),
    eventType: "player_damage",
    damaged: [
      { playerId: "P1", outcome: "death", x: 2, y: 3, isAI: false, nickname: "P1" },
    ],
  };
  assert.equal(presenter.ingest(event, 100), 1);
  assert.equal(presenter.active(100)[0].playerId, "P1");
});

import assert from "node:assert/strict";
import test from "node:test";
import { selectEnemySummaries } from "../app/game/entity-selectors.ts";

function player({ id, px, py = 512, isAI = false, alive = true }) {
  return {
    kind: "player",
    id,
    x: Math.floor(px / 1024),
    y: Math.floor(py / 1024),
    px,
    py,
    isAI,
    action: "wait",
    score: 0,
    power: 1,
    range: 2,
    shield: 0,
    nickname: id,
    joined: true,
    alive,
  };
}

test("V3 player snapshots restore AI direction summaries without server enemy_summary", () => {
  const local = player({ id: "P1", px: 512 });
  const ai = player({ id: "AI1", px: 2560, py: -512, isAI: true });
  const summaries = selectEnemySummaries([local, ai], local, []);

  assert.deepEqual(summaries, [{
    id: "AI1",
    dx: 2,
    dy: -1,
    distance: 3,
    nickname: "AI1",
    isAI: true,
  }]);
});

test("V2 distant summaries are preserved while visible entities use current coordinates", () => {
  const local = player({ id: "P1", px: 512 });
  const rival = player({ id: "P2", px: 1536 });
  const summaries = selectEnemySummaries([local, rival], local, [{
    id: "AI-far",
    dx: 20,
    dy: 0,
    distance: 20,
    nickname: "AI-far",
    isAI: true,
  }]);

  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries.find((enemy) => enemy.id === "P2"), {
    id: "P2",
    dx: 1,
    dy: 0,
    distance: 1,
    nickname: "P2",
    isAI: false,
  });
});

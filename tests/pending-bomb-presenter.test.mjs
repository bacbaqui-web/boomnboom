import assert from "node:assert/strict";
import test from "node:test";
import { PendingBombPresenter } from "../app/game/pending-bomb-presenter.ts";

function result(overrides = {}) {
  return {
    protocol: 3,
    type: "action_result",
    serverTick: 10,
    serverTimeMs: 1000,
    commandSeq: 1,
    action: "bomb",
    accepted: true,
    reason: null,
    bombId: "V3-B1",
    cell: { x: 2, y: 3 },
    spawnTick: 10,
    explodeTick: 100,
    ...overrides,
  };
}

function bomb(id = "V3-B1") {
  return {
    kind: "bomb", id, x: 2, y: 3, owner: "P1", fuse: 3,
    bornTick: 10, spawnTick: 10, explodeTick: 100, range: 2,
  };
}

test("pending bomb is immediate and stays through accept until authoritative snapshot", () => {
  const presenter = new PendingBombPresenter();
  assert.equal(presenter.begin(1, { x: 1, y: 3 }), true);
  assert.deepEqual([presenter.visuals[0].x, presenter.visuals[0].bombId], [1, null]);
  presenter.resolve(result());
  assert.deepEqual(
    [presenter.visuals[0].x, presenter.visuals[0].bombId, presenter.visuals[0].explodeTick],
    [2, "V3-B1", 100],
  );
  presenter.observeAuthoritative([bomb()]);
  assert.deepEqual(presenter.visuals, []);
});

test("snapshot-before-result race removes the pending visual without a duplicate", () => {
  const presenter = new PendingBombPresenter();
  presenter.begin(1, { x: 2, y: 3 });
  presenter.observeAuthoritative([bomb()]);
  presenter.resolve(result());
  assert.deepEqual(presenter.visuals, []);
});

test("reject and reconnect reset remove pending visuals", () => {
  const presenter = new PendingBombPresenter();
  presenter.begin(1, { x: 0, y: 0 });
  presenter.resolve(result({ accepted: false, reason: "bomb_limit" }));
  assert.deepEqual(presenter.visuals, []);
  presenter.begin(2, { x: 0, y: 0 });
  presenter.reset();
  assert.deepEqual(presenter.visuals, []);
});

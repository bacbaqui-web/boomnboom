import assert from "node:assert/strict";
import test from "node:test";
import { createBotDangerMap } from "../src/ai/bot-danger-map.mjs";

test("danger map advances a reached bomb to the same chain tick", () => {
  const danger = createBotDangerMap({
    currentTick: 10,
    bombs: [
      { id: "B1", x: 0, y: 0, range: 2, explodeTick: 40 },
      { id: "B2", x: 2, y: 0, range: 2, explodeTick: 100 },
    ],
  });

  assert.equal(danger.firstDangerOffset(0, 0), 30);
  assert.equal(danger.firstDangerOffset(2, 0), 30);
  assert.equal(danger.firstDangerOffset(4, 0), 30);
  assert.equal(danger.isDangerousAt(4, 0, 29), false);
  assert.equal(danger.isDangerousAt(4, 0, 30), true);
});

test("permanent walls stop predicted blast while live flames start immediately", () => {
  const danger = createBotDangerMap({
    currentTick: 10,
    bombs: [
      { id: "B1", x: 0, y: 0, range: 2, explodeTick: 40 },
      { id: "B2", x: 2, y: 0, range: 2, explodeTick: 100 },
    ],
    flames: [{ x: 5, y: 5, expireTick: 25 }],
    isPermanentWall: (x, y) => x === 1 && y === 0,
  });

  assert.equal(danger.firstDangerOffset(2, 0), 90);
  assert.equal(danger.firstDangerOffset(4, 0), 90);
  assert.deepEqual(danger.readIntervals(5, 5), [{ start: 0, end: 15 }]);
});

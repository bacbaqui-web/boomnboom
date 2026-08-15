import assert from "node:assert/strict";
import test from "node:test";
import {
  GOLDEN_EXPECTED_JSON,
  runMovementGoldenFixture,
} from "../../tests/fixtures/movement-golden-fixture.mjs";

test("server golden ticks match the client fixed-point contract byte-for-byte", () => {
  assert.equal(runMovementGoldenFixture(), GOLDEN_EXPECTED_JSON);
});

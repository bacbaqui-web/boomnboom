import assert from "node:assert/strict";
import test from "node:test";
import { createItemLifecycleSystem } from "../src/simulation/item-lifecycle-system.mjs";
import { createWorldOwner } from "../src/world/world-owner.mjs";

function createWorld() {
  return createWorldOwner({
    generateChunk: ({ chunkSize }) => new Array(chunkSize * chunkSize).fill("floor"),
  });
}

test("an unstamped AI drop receives ten seconds and expires on its server tick", () => {
  const world = createWorld();
  const system = createItemLifecycleSystem({ world, tickRate: 30 });
  world.setItem({ id: "DROP", x: 2, y: 3, type: "shield" });
  const stamped = system.step(100);
  assert.deepEqual(stamped.stamped, [{ id: "DROP", expireTick: 400 }]);
  assert.equal(world.getItemAt(2, 3).spawnTick, 100);
  assert.equal(system.step(399).changed, false);
  assert.equal(world.getItemAt(2, 3).id, "DROP");
  assert.deepEqual(system.step(400).expired, [{ id: "DROP", x: 2, y: 3 }]);
  assert.equal(world.getItemAt(2, 3), null);
});

test("an item collected before expiry is not recreated by the lifecycle", () => {
  const world = createWorld();
  const system = createItemLifecycleSystem({ world, tickRate: 30 });
  world.setItem({ id: "DROP", x: 1, y: 1, type: "bomb", spawnTick: 5, expireTick: 305 });
  world.removeItemAt(1, 1);
  assert.deepEqual(system.step(305), { changed: false, stamped: [], expired: [] });
  assert.equal(world.readItems().length, 0);
});

test("item expiry remains ordered across uint32 tick wrap", () => {
  const world = createWorld();
  const system = createItemLifecycleSystem({ world, tickRate: 1, lifetimeSeconds: 3 });
  world.setItem({ id: "DROP", x: 0, y: 0, type: "speed" });
  system.step(0xffff_fffe);
  assert.equal(world.getItemAt(0, 0).expireTick, 1);
  assert.equal(system.step(0).changed, false);
  assert.equal(system.step(1).expired.length, 1);
});

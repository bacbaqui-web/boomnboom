import assert from "node:assert/strict";
import test from "node:test";
import { RemotePlayerPainter } from "../app/game/remote-player-painter.ts";
import { RenderFrameCoordinator } from "../app/game/render-frame-coordinator.ts";
import { isWithinRenderBounds } from "../app/game/render-visibility.ts";

function fakeElement() {
  return {
    hidden: false,
    style: {
      transform: "",
      animation: "",
      removeProperty(property) {
        this[property] = "";
      },
    },
  };
}

test("render visibility keeps a padded viewport and rejects distant entities", () => {
  assert.equal(isWithinRenderBounds({ x: 9, y: 0 }, { x: 0, y: 0 }, 15, 11), true);
  assert.equal(isWithinRenderBounds({ x: 10, y: 0 }, { x: 0, y: 0 }, 15, 11), false);
  assert.equal(isWithinRenderBounds({ x: 0, y: 7 }, { x: 0, y: 0 }, 15, 11), true);
  assert.equal(isWithinRenderBounds({ x: 0, y: 8 }, { x: 0, y: 0 }, 15, 11), false);
});

test("one frame coordinator paints all registered render runtimes", () => {
  const coordinator = new RenderFrameCoordinator();
  const frames = [];
  const unsubscribeA = coordinator.subscribe((frame) => frames.push(`a:${frame.now}`));
  coordinator.subscribe((frame) => frames.push(`b:${frame.now}`));
  coordinator.paint({ now: 10, center: { x: 0, y: 0 }, visibleWidth: 15, visibleHeight: 11 });
  unsubscribeA();
  coordinator.paint({ now: 20, center: { x: 0, y: 0 }, visibleWidth: 15, visibleHeight: 11 });
  assert.deepEqual(frames, ["a:10", "b:10", "b:20"]);
});

test("remote player painter updates visible nodes and hides distant ones", () => {
  const painter = new RemotePlayerPainter();
  const nearby = fakeElement();
  const nearbyAvatar = fakeElement();
  const distant = fakeElement();
  const distantAvatar = fakeElement();
  painter.register("near", { x: 1, y: 1 }, { element: nearby, avatar: nearbyAvatar }, 0);
  painter.register("far", { x: 20, y: 1 }, { element: distant, avatar: distantAvatar }, 0);
  painter.paint(
    { now: 0, center: { x: 0, y: 0 }, visibleWidth: 15, visibleHeight: 11 },
    null,
    40,
  );
  assert.equal(nearby.hidden, false);
  assert.match(nearby.style.transform, /translate3d\(45\.6px, 45\.6px, 0\)/);
  assert.equal(distant.hidden, true);
  assert.equal(painter.size, 2);
});

"use client";

import { useCallback, useEffect, useMemo } from "react";
import { InputRuntime } from "./input-runtime";
import type { Action, MoveAction } from "./protocol";

const keyDirections: Record<string, MoveAction> = {
  arrowup: "up",
  w: "up",
  arrowdown: "down",
  s: "down",
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
};

export function useGameInput(send: (action: Action) => void, enabled: boolean) {
  const runtime = useMemo(() => new InputRuntime(send), [send]);

  const startMoving = useCallback((direction: MoveAction) => {
    runtime.start(direction);
  }, [runtime]);
  const stopMoving = useCallback(() => runtime.stop(), [runtime]);
  const bomb = useCallback(() => runtime.bomb(), [runtime]);

  useEffect(() => {
    if (!enabled) {
      runtime.destroy();
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = keyDirections[event.key.toLowerCase()];
      if (direction) {
        event.preventDefault();
        if (!event.repeat) runtime.start(direction);
      } else if (event.key === " ") {
        event.preventDefault();
        if (!event.repeat) runtime.bomb();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (keyDirections[event.key.toLowerCase()]) runtime.stop();
    };
    const stop = () => runtime.stop();
    addEventListener("keydown", onKeyDown);
    addEventListener("keyup", onKeyUp);
    addEventListener("pointerup", stop);
    addEventListener("pointercancel", stop);
    addEventListener("blur", stop);
    return () => {
      removeEventListener("keydown", onKeyDown);
      removeEventListener("keyup", onKeyUp);
      removeEventListener("pointerup", stop);
      removeEventListener("pointercancel", stop);
      removeEventListener("blur", stop);
      runtime.destroy();
    };
  }, [enabled, runtime]);

  return { startMoving, stopMoving, bomb };
}

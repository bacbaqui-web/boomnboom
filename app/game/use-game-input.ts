"use client";

import { useCallback, useEffect, useMemo } from "react";
import { InputRuntime } from "./input-runtime";
import { InputSampler } from "./input-sampler";
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

export function useGameInput(
  send: (action: Action) => void,
  enabled: boolean,
  mode: "v2" | "v3" = "v2",
) {
  const runtime = useMemo(
    () => mode === "v3"
      ? new InputSampler(
          (direction) => send(direction === "neutral" ? "stop" : direction),
          () => send("bomb"),
        )
      : new InputRuntime(send),
    [mode, send],
  );

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

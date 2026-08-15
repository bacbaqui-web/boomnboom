"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { InputRuntime } from "./input-runtime";
import { InputSampler } from "./input-sampler";
import { HeldDirectionTracker } from "./held-direction-tracker";
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
  const enabledRef = useRef(enabled);
  const heldDirectionRef = useRef(new HeldDirectionTracker());

  const resumeHeldDirection = useCallback(() => {
    if (!enabledRef.current) return;
    const direction = heldDirectionRef.current.activeDirection;
    if (direction) runtime.start(direction);
    else runtime.stop();
  }, [runtime]);

  const startMoving = useCallback((direction: MoveAction) => {
    heldDirectionRef.current.pressPointer(direction);
    if (enabledRef.current) runtime.start(direction);
  }, [runtime]);
  const stopMoving = useCallback(() => {
    heldDirectionRef.current.releasePointer();
    resumeHeldDirection();
  }, [resumeHeldDirection]);
  const bomb = useCallback(() => {
    if (enabledRef.current) runtime.bomb();
  }, [runtime]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (enabled) resumeHeldDirection();
    else runtime.destroy();
  }, [enabled, resumeHeldDirection, runtime]);

  useEffect(() => {
    const heldDirection = heldDirectionRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = keyDirections[event.key.toLowerCase()];
      if (direction) {
        if (!enabledRef.current) return;
        event.preventDefault();
        const keyId = event.code || event.key.toLowerCase();
        heldDirectionRef.current.pressKey(keyId, direction);
        resumeHeldDirection();
      } else if (event.key === " ") {
        if (!enabledRef.current) return;
        event.preventDefault();
        if (!event.repeat) runtime.bomb();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!keyDirections[event.key.toLowerCase()]) return;
      heldDirectionRef.current.releaseKey(event.code || event.key.toLowerCase());
      resumeHeldDirection();
    };
    const stopPointer = () => {
      heldDirectionRef.current.releasePointer();
      resumeHeldDirection();
    };
    const reset = () => {
      heldDirectionRef.current.reset();
      runtime.stop();
    };
    addEventListener("keydown", onKeyDown);
    addEventListener("keyup", onKeyUp);
    addEventListener("pointerup", stopPointer);
    addEventListener("pointercancel", stopPointer);
    addEventListener("blur", reset);
    return () => {
      removeEventListener("keydown", onKeyDown);
      removeEventListener("keyup", onKeyUp);
      removeEventListener("pointerup", stopPointer);
      removeEventListener("pointercancel", stopPointer);
      removeEventListener("blur", reset);
      heldDirection.reset();
      runtime.destroy();
    };
  }, [resumeHeldDirection, runtime]);

  return { startMoving, stopMoving, bomb };
}

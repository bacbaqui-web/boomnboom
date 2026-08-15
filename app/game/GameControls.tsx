"use client";

import type { ReactNode } from "react";
import type { MoveAction } from "./protocol";

export function GameControls({
  startMoving,
  stopMoving,
  bomb,
  children,
}: {
  startMoving: (direction: MoveAction) => void;
  stopMoving: () => void;
  bomb: () => void;
  children: ReactNode;
}) {
  const directionButton = (direction: MoveAction, label: string) => (
    <button
      onPointerDown={(event) => {
        event.preventDefault();
        startMoving(direction);
      }}
      onPointerUp={stopMoving}
      onPointerCancel={stopMoving}
    >
      {label}
    </button>
  );
  return (
    <div className="controls">
      <div className="dpad">
        {directionButton("up", "▲")}
        {directionButton("left", "◀")}
        {directionButton("down", "▼")}
        {directionButton("right", "▶")}
      </div>
      {children}
      <button className="boomBtn" onClick={bomb}>BOMB<small>즉시 설치</small></button>
    </div>
  );
}

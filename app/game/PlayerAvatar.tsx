"use client";

import { forwardRef } from "react";
import type { Action, PlayerEntity } from "./protocol";

const actionIcon: Record<Action, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  bomb: "●",
  wait: "Ⅱ",
  stop: "Ⅱ",
};

export const PlayerAvatar = forwardRef<
  HTMLSpanElement,
  {
    player: PlayerEntity;
    variant: "me" | "ai" | "rival";
    queuedAction?: Action;
  }
>(function PlayerAvatar({ player, variant, queuedAction }, ref) {
  return (
    <span
      ref={ref}
      className={`fighter ${variant} ${player.shield > 0 ? "shielded" : ""}`}
      title={player.nickname}
    >
      <em>{player.nickname}</em>
      {player.isAI ? "AI" : "◉"}
      {queuedAction ? (
        <i className={`actionCue cue-${queuedAction}`} title="내 현재 행동">
          {actionIcon[queuedAction]}
        </i>
      ) : null}
    </span>
  );
});

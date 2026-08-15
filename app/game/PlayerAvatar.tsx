"use client";

import { forwardRef } from "react";
import type { PlayerEntity } from "./protocol";

export const PlayerAvatar = forwardRef<
  HTMLSpanElement,
  {
    player: PlayerEntity;
    variant: "me" | "ai" | "rival";
  }
>(function PlayerAvatar({ player, variant }, ref) {
  return (
    <span
      ref={ref}
      className={`fighter ${variant} ${player.shield > 0 ? "shielded" : ""}`}
      title={player.nickname}
    >
      <em>{player.nickname}</em>
      {player.isAI ? "AI" : "◉"}
    </span>
  );
});

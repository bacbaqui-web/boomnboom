"use client";

import { forwardRef } from "react";
import type { PlayerEntity } from "./protocol";

type AvatarPlayer = Pick<PlayerEntity, "nickname" | "isAI" | "shield">;

export const PlayerAvatar = forwardRef<
  HTMLSpanElement,
  {
    player: AvatarPlayer;
    variant: "me" | "ai" | "rival";
    dying?: boolean;
  }
>(function PlayerAvatar({ player, variant, dying = false }, ref) {
  return (
    <span
      ref={ref}
      className={`fighter ${variant} ${player.shield > 0 ? "shielded" : ""} ${dying ? "dying" : ""}`}
      title={player.nickname}
    >
      <em>{player.nickname}</em>
      {player.isAI ? "AI" : "◉"}
    </span>
  );
});

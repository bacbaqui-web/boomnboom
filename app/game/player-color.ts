import type { CSSProperties } from "react";
import {
  DEFAULT_HUMAN_PLAYER_COLOR,
  HUMAN_PLAYER_COLORS,
  normalizeHumanPlayerColor,
} from "../../shared/player-colors.mjs";

export type PlayerColorId =
  | "blue"
  | "cyan"
  | "green"
  | "yellow"
  | "orange"
  | "purple"
  | "pink"
  | "silver";

export const PLAYER_COLOR_OPTIONS = HUMAN_PLAYER_COLORS as readonly {
  id: PlayerColorId;
  name: string;
  body: string;
  shadow: string;
  highlight: string;
}[];

export const DEFAULT_PLAYER_COLOR = DEFAULT_HUMAN_PLAYER_COLOR as PlayerColorId;

export function playerColorId(value: unknown): PlayerColorId {
  return normalizeHumanPlayerColor(value) as PlayerColorId;
}

export function playerColorStyle(value: unknown): CSSProperties {
  const color = PLAYER_COLOR_OPTIONS.find((option) => option.id === playerColorId(value))
    ?? PLAYER_COLOR_OPTIONS[0];
  return {
    "--fighter-color": color.body,
    "--fighter-shadow": color.shadow,
    "--fighter-highlight": color.highlight,
  } as CSSProperties;
}

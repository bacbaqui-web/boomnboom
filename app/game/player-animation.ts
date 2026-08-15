export const PLAYER_JUMP_DURATION_MS = 175;
export const PLAYER_JUMP_HEIGHT_PX = 10;

export const PLAYER_JUMP_KEYFRAMES: Keyframe[] = [
  { offset: 0, transform: "translateY(0px) scale(1.05, 0.9)" },
  {
    offset: 0.5,
    transform: `translateY(-${PLAYER_JUMP_HEIGHT_PX}px) scale(0.9, 1.05)`,
  },
  { offset: 0.8, transform: "translateY(0px) scale(1.05, 0.9)" },
  { offset: 1, transform: "translateY(0px) scale(1.05, 0.9)" },
];

export function playerCell(position: { x: number; y: number }) {
  return {
    x: Math.floor(position.x + 0.5),
    y: Math.floor(position.y + 0.5),
  };
}

export function crossedAdjacentCell(
  previous: { x: number; y: number } | null,
  current: { x: number; y: number },
) {
  if (!previous) return false;
  return Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y) === 1;
}

export function playPlayerJump(element: HTMLElement, previous?: Animation | null) {
  previous?.cancel();
  return element.animate(PLAYER_JUMP_KEYFRAMES, {
    duration: PLAYER_JUMP_DURATION_MS,
    easing: "ease-in-out",
  });
}

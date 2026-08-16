export const PLAYER_JUMP_HEIGHT_PX = 10;
const MAX_ANIMATED_FRAME_DISTANCE = 0.35;

export type PlayerTravelPose = {
  translateY: number;
  scaleX: number;
  scaleY: number;
};

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

export function playerTravelPose(
  previous: { x: number; y: number } | null,
  current: { x: number; y: number },
): PlayerTravelPose | null {
  if (!previous) return null;
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const frameDistance = Math.hypot(dx, dy);
  if (frameDistance < 0.000_01 || frameDistance > MAX_ANIMATED_FRAME_DISTANCE) return null;
  const axisPosition = Math.abs(dx) >= Math.abs(dy) ? current.x : current.y;
  const distanceFromCellCenter = Math.min(
    0.5,
    Math.abs(axisPosition - Math.round(axisPosition)),
  );
  const apex = Math.sin(Math.PI * distanceFromCellCenter);
  return {
    translateY: apex === 0 ? 0 : -PLAYER_JUMP_HEIGHT_PX * apex,
    scaleX: 1.05 - 0.15 * apex,
    scaleY: 0.9 + 0.15 * apex,
  };
}

export function paintPlayerTravelPose(
  element: HTMLElement,
  previous: { x: number; y: number } | null,
  current: { x: number; y: number },
) {
  const pose = playerTravelPose(previous, current);
  if (!pose) return false;
  element.style.animation = "none";
  element.style.transform = [
    `translateY(${pose.translateY.toFixed(3)}px)`,
    `scale(${pose.scaleX.toFixed(4)}, ${pose.scaleY.toFixed(4)})`,
  ].join(" ");
  return true;
}

export function clearPlayerTravelPose(element: HTMLElement | null) {
  if (!element) return;
  element.style.removeProperty("animation");
  element.style.removeProperty("transform");
}

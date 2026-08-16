export function isWithinRenderBounds(
  position: { x: number; y: number },
  center: { x: number; y: number },
  visibleWidth: number,
  visibleHeight: number,
  padding = 2,
) {
  const horizontalLimit = visibleWidth / 2 + padding;
  const verticalLimit = visibleHeight / 2 + padding;
  return (
    Math.abs(position.x - center.x) <= horizontalLimit &&
    Math.abs(position.y - center.y) <= verticalLimit
  );
}

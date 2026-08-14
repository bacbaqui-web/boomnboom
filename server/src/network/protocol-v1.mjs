export function createV1StateSerializer({
  world,
  width = 23,
  height = 19,
  viewWidth = 15,
  viewHeight = 11,
  recenterThreshold = 3,
  worldEpochMs,
  bgmDurationMs,
  bgmSnareOffsetMs,
}) {
  const viewOrigins = new Map();

  function stateFor(viewerId, { tick, frame, nextTickAt, serverNow = Date.now() }) {
    const viewer = world.getPlayer(viewerId);
    if (!viewer) throw new Error(`Unknown V1 viewer: ${viewerId}`);

    world.materializeAround(viewer.x, viewer.y, 2);
    const centerX = Math.round(viewer.x);
    const centerY = Math.round(viewer.y);
    const previous = viewOrigins.get(viewerId) ?? {};
    let originX = previous.originX;
    let originY = previous.originY;
    if (
      !Number.isFinite(originX) ||
      Math.abs(centerX - (originX + Math.floor(width / 2))) >= recenterThreshold
    ) {
      originX = centerX - Math.floor(width / 2);
    }
    if (
      !Number.isFinite(originY) ||
      Math.abs(centerY - (originY + Math.floor(height / 2))) >= recenterThreshold
    ) {
      originY = centerY - Math.floor(height / 2);
    }
    viewOrigins.set(viewerId, { originX, originY });

    const visible = (x, y) =>
      x >= originX && x < originX + width && y >= originY && y < originY + height;
    const players = world.readPlayers();
    const bombs = world.readBombs();
    const items = world.readItems();
    const flames = world.readFlames();

    return {
      type: "state",
      tick,
      frame,
      nextTickAt,
      serverNow,
      nextTickInMs: Math.max(0, nextTickAt - serverNow),
      worldEpochMs,
      bgmDurationMs,
      bgmSnareOffsetMs,
      width,
      height,
      viewWidth,
      viewHeight,
      originX,
      originY,
      worldX: viewer.x,
      worldY: viewer.y,
      cameraDx: viewer.x - viewer.prevX,
      cameraDy: viewer.y - viewer.prevY,
      cameraOffsetX: viewer.x - centerX,
      cameraOffsetY: viewer.y - centerY,
      tiles: world.readTileRectangle({ originX, originY, width, height, tick }),
      players: players
        .filter((player) => player.id === viewerId || (player.alive && visible(player.x, player.y)))
        .map(
          ({
            id,
            x,
            y,
            prevX,
            prevY,
            isAI,
            action,
            score,
            power,
            range,
            shield,
            nickname,
            joined,
            alive,
          }) => ({
            id,
            x: Math.round(x) - originX,
            y: Math.round(y) - originY,
            isAI,
            action,
            score,
            power,
            range,
            shield,
            nickname,
            joined,
            alive,
            moved: x !== prevX || y !== prevY,
          }),
        ),
      enemyDirections: players
        .filter((player) => player.id !== viewerId && player.alive && !visible(player.x, player.y))
        .map((player) => ({
          id: player.id,
          dx: player.x - viewer.x,
          dy: player.y - viewer.y,
          distance: Math.abs(player.x - viewer.x) + Math.abs(player.y - viewer.y),
          nickname: player.nickname,
          isAI: player.isAI,
        })),
      bombs: bombs
        .filter((bomb) => visible(bomb.x, bomb.y))
        .map((bomb) => ({ ...bomb, x: bomb.x - originX, y: bomb.y - originY })),
      items: items
        .filter((item) => visible(item.x, item.y))
        .map((item) => ({ ...item, x: item.x - originX, y: item.y - originY })),
      flames: flames
        .filter((flame) => visible(flame.x, flame.y))
        .map((flame) => ({ x: flame.x - originX, y: flame.y - originY })),
    };
  }

  function forgetViewer(viewerId) {
    viewOrigins.delete(viewerId);
  }

  return { stateFor, forgetViewer };
}

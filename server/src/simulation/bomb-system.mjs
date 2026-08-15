import { addNetTicks, isNetTickAfter } from "../../../shared/net-tick.mjs";
import { DEFAULT_MOVEMENT_CONFIG } from "../../../shared/movement-config.mjs";

function cellForPlayer(player, unitsPerTile) {
  if (Number.isSafeInteger(player.targetCellX) && Number.isSafeInteger(player.targetCellY)) {
    return { x: player.targetCellX, y: player.targetCellY };
  }
  const px = Number.isSafeInteger(player.px)
    ? player.px
    : player.x * unitsPerTile + unitsPerTile / 2;
  const py = Number.isSafeInteger(player.py)
    ? player.py
    : player.y * unitsPerTile + unitsPerTile / 2;
  return { x: Math.floor(px / unitsPerTile), y: Math.floor(py / unitsPerTile) };
}

export function createBombSystem({
  world,
  fuseTicks = 90,
  tickRate = 30,
  movementConfig = DEFAULT_MOVEMENT_CONFIG,
} = {}) {
  let nextBombId = 1;

  function place(playerId, command, tick) {
    const player = world.getPlayer(playerId);
    if (!player?.alive || !player.joined) {
      return { accepted: false, reason: "player_unavailable" };
    }
    const cell = cellForPlayer(player, movementConfig.unitsPerTile);
    const bombs = world.readBombs();
    if (bombs.some((bomb) => bomb.x === cell.x && bomb.y === cell.y)) {
      return { accepted: false, reason: "cell_occupied" };
    }
    if (bombs.filter((bomb) => bomb.owner === playerId).length >= player.power) {
      return { accepted: false, reason: "bomb_limit" };
    }
    const bombId = `V3-B${nextBombId++}`;
    const explodeTick = addNetTicks(tick, fuseTicks);
    world.addBomb({
      id: bombId,
      x: cell.x,
      y: cell.y,
      owner: playerId,
      fuse: Math.ceil(fuseTicks / tickRate),
      bornTick: tick,
      spawnTick: tick,
      explodeTick,
      range: player.range,
      clockDomain: "v3",
      ownerPassThrough: true,
    });
    return {
      accepted: true,
      reason: null,
      bombId,
      cell,
      spawnTick: tick,
      explodeTick,
    };
  }

  function step(tick, commandsByPlayer, { blockedPlayerIds = new Set() } = {}) {
    const results = [];
    let changed = false;
    for (const [playerId, command] of commandsByPlayer) {
      for (const action of command.actions ?? []) {
        if (action.action !== "bomb") continue;
        const result = blockedPlayerIds.has(playerId)
          ? { accepted: false, reason: "life_reset" }
          : place(playerId, action, tick);
        results.push({
          playerId,
          commandSeq: action.commandSeq,
          action: "bomb",
          ...result,
        });
        changed = changed || result.accepted;
      }
    }
    for (const bomb of world.readBombs()) {
      if (bomb.clockDomain !== "v3" || !isNetTickAfter(bomb.explodeTick, tick)) continue;
      const remainingTicks = (bomb.explodeTick - tick) >>> 0;
      const fuse = Math.ceil(remainingTicks / tickRate);
      if (fuse !== bomb.fuse) {
        world.updateBomb(bomb.id, { fuse });
        changed = true;
      }
    }
    return { results, changed };
  }

  return { step };
}

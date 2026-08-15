import { addNetTicks } from "../../../shared/net-tick.mjs";
import { DEFAULT_MOVEMENT_CONFIG } from "../../../shared/movement-config.mjs";

function centerForCell(cell, unitsPerTile) {
  return cell * unitsPerTile + unitsPerTile / 2;
}

function absolutePlayerSample(player, config, { teleport = false, serverTick = 0 } = {}) {
  return {
    id: player.id,
    px: Number.isSafeInteger(player.px)
      ? player.px
      : centerForCell(player.x, config.unitsPerTile),
    py: Number.isSafeInteger(player.py)
      ? player.py
      : centerForCell(player.y, config.unitsPerTile),
    vx: Number.isSafeInteger(player.vx) ? player.vx : 0,
    vy: Number.isSafeInteger(player.vy) ? player.vy : 0,
    direction: player.desiredDirection ?? (player.action === "wait" ? "neutral" : player.action),
    targetCellX: Number.isSafeInteger(player.targetCellX) ? player.targetCellX : null,
    targetCellY: Number.isSafeInteger(player.targetCellY) ? player.targetCellY : null,
    x: player.x,
    y: player.y,
    alive: player.alive,
    joined: player.joined,
    isAI: player.isAI,
    nickname: player.nickname,
    power: player.power,
    range: player.range,
    shield: player.shield,
    speedLevel: Number.isSafeInteger(player.speedLevel) ? player.speedLevel : 0,
    lifeId: player.lifeId ?? 1,
    teleport: teleport || player.teleportTick === serverTick,
  };
}

function bombSample(bomb, serverTick, tickRate) {
  const remainingTicks = Number.isInteger(bomb.explodeTick)
    ? Math.max(0, (bomb.explodeTick - serverTick) >>> 0)
    : Math.max(0, bomb.fuse * tickRate);
  return {
    ...bomb,
    fuse: Math.ceil(remainingTicks / tickRate),
    spawnTick: bomb.spawnTick ?? bomb.bornTick,
    explodeTick: bomb.explodeTick ?? null,
  };
}

function itemSample(item) {
  return { id: item.id ?? `${item.x},${item.y}`, ...item };
}

function flameSample(flame) {
  return { id: flame.id ?? `${flame.x},${flame.y}`, ...flame };
}

export function createEntitySnapshotPublisher({
  world,
  sessions,
  commandBuffer,
  send,
  movementConfig = DEFAULT_MOVEMENT_CONFIG,
  tickRate = DEFAULT_MOVEMENT_CONFIG.tickRate,
} = {}) {
  let publishedSnapshots = 0;

  function nextSnapshotSeq(session) {
    session.snapshotSeq = addNetTicks(session.snapshotSeq ?? 0xffff_ffff, 1);
    return session.snapshotSeq;
  }

  function sendSnapshotPair(session, serverTick, { teleport = false } = {}) {
    const owner = world.getPlayer(session.playerId);
    if (!owner) return 0;
    const snapshotSeq = nextSnapshotSeq(session);
    send(session, "owner_snapshot", {
      snapshotSeq,
      lastProcessedCommandSeq: commandBuffer.lastProcessedCommandSeq(session.playerId),
      player: absolutePlayerSample(owner, movementConfig, { teleport, serverTick }),
    }, serverTick);
    send(session, "entity_snapshot", {
      snapshotSeq,
      players: world
        .readPlayers()
        .filter((player) => player.alive || player.id === session.playerId)
        .map((player) => absolutePlayerSample(player, movementConfig, { teleport, serverTick })),
      bombs: world.readBombs().map((bomb) => bombSample(bomb, serverTick, tickRate)),
      items: world.readItems().map(itemSample),
      flames: world.readFlames().map(flameSample),
    }, serverTick);
    publishedSnapshots += 1;
    return 2;
  }

  return {
    sendBaseline(session, serverTick) {
      return sendSnapshotPair(session, serverTick, { teleport: true });
    },
    publish(serverTick) {
      let messages = 0;
      for (const session of sessions.values()) {
        if (!session.ready) continue;
        messages += sendSnapshotPair(session, serverTick);
      }
      return messages;
    },
    readMetrics() {
      return { publishedSnapshots };
    },
  };
}

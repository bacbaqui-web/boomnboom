import { DEFAULT_MOVEMENT_CONFIG } from "../../../shared/movement-config.mjs";
import { stepMovement } from "../../../shared/movement-step.mjs";
import { playerOverlapsCell } from "./fixed-aabb.mjs";

function centerForCell(cell, unitsPerTile) {
  return cell * unitsPerTile + unitsPerTile / 2;
}

function movementState(player, config) {
  return {
    px: Number.isSafeInteger(player.px)
      ? player.px
      : centerForCell(player.x, config.unitsPerTile),
    py: Number.isSafeInteger(player.py)
      ? player.py
      : centerForCell(player.y, config.unitsPerTile),
    vx: Number.isSafeInteger(player.vx) ? player.vx : 0,
    vy: Number.isSafeInteger(player.vy) ? player.vy : 0,
    desiredDirection: player.desiredDirection ?? "neutral",
    queuedTurn: player.queuedTurn ?? null,
    queuedTurnUntilTick: Number.isSafeInteger(player.queuedTurnUntilTick)
      ? player.queuedTurnUntilTick
      : 0,
  };
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function movementStatesDiffer(left, right) {
  return (
    left.px !== right.px ||
    left.py !== right.py ||
    left.vx !== right.vx ||
    left.vy !== right.vy ||
    left.desiredDirection !== right.desiredDirection ||
    left.queuedTurn !== right.queuedTurn ||
    left.queuedTurnUntilTick !== right.queuedTurnUntilTick
  );
}

export function createPlayerMovementSystem({
  world,
  movementConfig = DEFAULT_MOVEMENT_CONFIG,
} = {}) {
  function initializePlayer(playerId, { resetToCell = false } = {}) {
    const player = world.getPlayer(playerId);
    if (!player) return false;
    const state = resetToCell
      ? {
          px: centerForCell(player.x, movementConfig.unitsPerTile),
          py: centerForCell(player.y, movementConfig.unitsPerTile),
          vx: 0,
          vy: 0,
          desiredDirection: "neutral",
          queuedTurn: null,
          queuedTurnUntilTick: 0,
        }
      : movementState(player, movementConfig);
    return world.commitPlayerMovement(playerId, state, {
      unitsPerTile: movementConfig.unitsPerTile,
      action: player.action ?? "wait",
      lifeId: player.lifeId ?? 1,
    });
  }

  function step(tick, commandsByPlayer) {
    const players = world.readPlayers();
    const playersById = new Map(players.map((player) => [player.id, player]));
    const occupiedPlayers = new Map();
    for (const player of players) {
      if (!player.alive) continue;
      const key = cellKey(player.x, player.y);
      const ids = occupiedPlayers.get(key) ?? new Set();
      ids.add(player.id);
      occupiedPlayers.set(key, ids);
    }
    const bombsByCell = new Map();
    for (const bomb of world.readBombs()) {
      const key = cellKey(bomb.x, bomb.y);
      const bombs = bombsByCell.get(key) ?? [];
      bombs.push(bomb);
      bombsByCell.set(key, bombs);
    }
    const contactsByPlayer = new Map();
    let movementChanged = false;
    let cellChanged = false;
    let itemChanged = false;
    const collectedItems = [];

    for (const playerId of [...commandsByPlayer.keys()].sort()) {
      const command = commandsByPlayer.get(playerId);
      const player = playersById.get(playerId);
      if (!player?.joined || !player.alive) continue;
      const oldCellKey = cellKey(player.x, player.y);
      occupiedPlayers.get(oldCellKey)?.delete(playerId);
      const collisionReader = {
        isBlockedCell(cellX, cellY) {
          const bombs = bombsByCell.get(cellKey(cellX, cellY)) ?? [];
          const bombBlocked = bombs.some(
            (bomb) =>
              !(
                bomb.owner === playerId &&
                bomb.ownerPassThrough === true &&
                playerOverlapsCell(player, bomb.x, bomb.y, movementConfig)
              ),
          );
          return (
            world.isPermanentWall(cellX, cellY) ||
            world.hasCrate(cellX, cellY) ||
            bombBlocked ||
            (occupiedPlayers.get(cellKey(cellX, cellY))?.size ?? 0) > 0
          );
        },
      };
      const before = movementState(player, movementConfig);
      const result = stepMovement(
        before,
        { tick, direction: command.direction },
        collisionReader,
        movementConfig,
      );
      const action = command.direction === "neutral" ? "wait" : command.direction;
      world.commitPlayerMovement(playerId, result.state, {
        unitsPerTile: movementConfig.unitsPerTile,
        action,
        lifeId: player.lifeId ?? 1,
      });
      const after = world.getPlayer(playerId);
      for (const bomb of world.readBombs()) {
        if (
          bomb.owner === playerId &&
          bomb.ownerPassThrough === true &&
          !playerOverlapsCell(after, bomb.x, bomb.y, movementConfig)
        ) {
          world.updateBomb(bomb.id, { ownerPassThrough: false });
        }
      }
      occupiedPlayers.get(oldCellKey)?.delete(playerId);
      const nextCellKey = cellKey(after.x, after.y);
      const ids = occupiedPlayers.get(nextCellKey) ?? new Set();
      ids.add(playerId);
      occupiedPlayers.set(nextCellKey, ids);
      contactsByPlayer.set(playerId, result.contacts);
      const item = world.getItemAt(after.x, after.y);
      if (item && playerOverlapsCell(after, item.x, item.y, movementConfig)) {
        if (item.type === "bomb") world.updatePlayer(playerId, { power: after.power + 1 });
        else if (item.type === "shield") {
          world.updatePlayer(playerId, { shield: after.shield + 1 });
        } else if (item.type === "flame") {
          world.updatePlayer(playerId, { range: after.range + 1 });
        }
        world.removeItemAt(item.x, item.y);
        collectedItems.push({ playerId, item });
        itemChanged = true;
      }
      movementChanged = movementChanged || movementStatesDiffer(before, result.state);
      cellChanged = cellChanged || player.x !== after.x || player.y !== after.y;
      if (player.x !== after.x || player.y !== after.y) {
        world.materializeAround(after.x, after.y, 2);
      }
    }
    if (cellChanged) world.trimColdChunks();
    return { movementChanged, cellChanged, itemChanged, collectedItems, contactsByPlayer };
  }

  return { initializePlayer, step };
}

import { addNetTicks, isNetTickAtOrAfter } from "../../../shared/net-tick.mjs";
import { DEFAULT_MOVEMENT_CONFIG } from "../../../shared/movement-config.mjs";
import { uniqueBlastCells } from "./explosion.mjs";
import { playerOverlapsCell } from "./fixed-aabb.mjs";
import { AI_DROP_ITEM_TYPES } from "./item-rules.mjs";

function dropType(player, tick) {
  let value = Math.imul(player.x + tick, 374761393) + Math.imul(player.y - tick, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return AI_DROP_ITEM_TYPES[
    ((value ^ (value >>> 16)) >>> 0) % AI_DROP_ITEM_TYPES.length
  ];
}

export function createExplosionSystem({
  world,
  flameTicks = 15,
  movementConfig = DEFAULT_MOVEMENT_CONFIG,
  respawnAI = () => false,
} = {}) {
  let nextEventSeq = 0;
  const damagedByEvent = new Map();

  function damagePlayers(tick, flames) {
    const byEvent = new Map();
    for (const flame of flames) {
      const cells = byEvent.get(flame.eventSeq) ?? [];
      cells.push(flame);
      byEvent.set(flame.eventSeq, cells);
    }
    const damaged = [];
    for (const [eventSeq, cells] of byEvent) {
      const seen = damagedByEvent.get(eventSeq) ?? new Set();
      for (const player of world.readPlayers()) {
        if (!player.alive || seen.has(player.id)) continue;
        if (!cells.some((cell) => playerOverlapsCell(player, cell.x, cell.y, movementConfig))) {
          continue;
        }
        seen.add(player.id);
        if (player.shield > 0) {
          world.updatePlayer(player.id, {
            shield: player.shield - 1,
            action: "wait",
          });
          damaged.push({ playerId: player.id, outcome: "shield" });
          continue;
        }
        world.updatePlayer(player.id, {
          alive: false,
          action: "wait",
          vx: 0,
          vy: 0,
          desiredDirection: "neutral",
          targetCellX: null,
          targetCellY: null,
        });
        if (player.isAI) {
          const x = Number.isSafeInteger(player.px)
            ? Math.floor(player.px / movementConfig.unitsPerTile)
            : player.x;
          const y = Number.isSafeInteger(player.py)
            ? Math.floor(player.py / movementConfig.unitsPerTile)
            : player.y;
          world.setItem({
            id: `DROP-${eventSeq}-${player.id}`,
            x,
            y,
            type: dropType(player, tick),
          });
          const respawned = respawnAI(player.id, tick);
          damaged.push({
            playerId: player.id,
            outcome: respawned ? "ai_respawn" : "death",
          });
          continue;
        }
        damaged.push({ playerId: player.id, outcome: "death" });
      }
      damagedByEvent.set(eventSeq, seen);
    }
    return damaged;
  }

  function step(tick) {
    const active = world.readFlames().filter(
      (flame) =>
        flame.clockDomain === "v3" && !isNetTickAtOrAfter(tick, flame.expireTick),
    );
    const activeEvents = new Set(active.map((flame) => flame.eventSeq));
    for (const eventSeq of damagedByEvent.keys()) {
      if (!activeEvents.has(eventSeq)) damagedByEvent.delete(eventSeq);
    }
    const exploding = world.readBombs().filter(
      (bomb) =>
        bomb.clockDomain === "v3" && isNetTickAtOrAfter(tick, bomb.explodeTick),
    );
    if (exploding.length === 0) {
      world.replaceFlamesForDomain("v3", active);
      const damaged = damagePlayers(tick, active);
      return { changed: damaged.length > 0, events: [], damaged };
    }
    for (const bomb of exploding) world.removeBomb(bomb.id);
    const blastCells = uniqueBlastCells(exploding, {
      isPermanentWall: (x, y) => world.isPermanentWall(x, y),
      hasCrate: (x, y) => world.hasCrate(x, y),
    });
    const destroyedCrates = [];
    for (const cell of blastCells.values()) {
      if (world.destroyCrate(cell.x, cell.y)) destroyedCrates.push(cell);
    }
    const eventSeq = nextEventSeq;
    nextEventSeq = addNetTicks(nextEventSeq, 1);
    const expireTick = addNetTicks(tick, flameTicks);
    const created = [...blastCells.values()].map((cell) => ({
      id: `V3-F${eventSeq}-${cell.x},${cell.y}`,
      ...cell,
      clockDomain: "v3",
      eventSeq,
      startTick: tick,
      expireTick,
    }));
    const flames = [...active, ...created];
    world.replaceFlamesForDomain("v3", flames);
    const damaged = damagePlayers(tick, flames);
    const event = {
      eventSeq,
      eventType: "explosion",
      eventTick: tick,
      expireTick,
      bombIds: exploding.map((bomb) => bomb.id),
      cells: [...blastCells.values()],
      destroyedCrates,
      damaged,
    };
    return { changed: true, events: [event], damaged };
  }

  return { step };
}

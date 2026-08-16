import { findSpawn } from "../world/spawn-finder.mjs";
import { resolveChainExplosions } from "./explosion.mjs";
import { AI_DROP_ITEM_TYPES, itemStatUpdate } from "./item-rules.mjs";
import {
  BASE_SPEED_TILES_PER_SECOND,
  SPEED_ITEM_BONUS_TILES_PER_SECOND,
} from "../../../shared/movement-config.mjs";
import {
  DEFAULT_HUMAN_PLAYER_COLOR,
  normalizeHumanPlayerColor,
} from "../../../shared/player-colors.mjs";

const DIRECTIONS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  wait: [0, 0],
};
const ACTIONS = new Set(["up", "down", "left", "right", "bomb", "wait"]);

function legacyHash(x, y) {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) >>> 0;
}

export class GameSimulation {
  #world;
  #tick;
  #moveIntervalMs;
  #bombFuseTicks;
  #nextPlayerNumber = 1;
  #nextBotNumber = 1;
  #nextBombNumber = 1;

  constructor({
    world,
    initialTick = 0,
    moveIntervalMs = 140,
    bombFuseTicks = 3,
  }) {
    this.#world = world;
    this.#tick = initialTick;
    this.#moveIntervalMs = moveIntervalMs;
    this.#bombFuseTicks = bombFuseTicks;
  }

  get tick() {
    return this.#tick;
  }

  #spawn(isAI = false) {
    return findSpawn({
      world: this.#world,
      players: this.#world.readPlayers(),
      bombs: this.#world.readBombs(),
      spawnNumber: isAI ? this.#nextBotNumber : this.#nextPlayerNumber,
      isAI,
    });
  }

  addPlayer({ isAI = false } = {}) {
    const entityNumber = isAI ? this.#nextBotNumber++ : this.#nextPlayerNumber++;
    const id = isAI ? `BOT-${entityNumber}` : `P${entityNumber}`;
    const [x, y] = this.#spawn(isAI);
    const player = {
      id,
      x,
      y,
      prevX: x,
      prevY: y,
      isAI,
      action: "wait",
      score: 0,
      power: 1,
      range: 1,
      shield: 0,
      speedLevel: 0,
      lastMoveAt: 0,
      nickname: isAI ? `BOOM AI ${entityNumber}` : "",
      color: isAI ? "ai-red" : DEFAULT_HUMAN_PLAYER_COLOR,
      joined: isAI,
      alive: isAI,
    };
    this.#world.addPlayer(player);
    this.#world.materializeAround(x, y, 2);
    this.#world.trimColdChunks();
    return player;
  }

  removePlayer(playerId) {
    return this.#world.removePlayer(playerId);
  }

  joinPlayer(playerId, nickname, color = DEFAULT_HUMAN_PLAYER_COLOR) {
    const player = this.#world.getPlayer(playerId);
    if (!player || player.joined) return { accepted: false, publish: false };
    this.#world.updatePlayer(playerId, {
      nickname:
        String(nickname || "").trim().slice(0, 12) || `플레이어${playerId.slice(1)}`,
      color: normalizeHumanPlayerColor(color),
      joined: true,
      alive: true,
      action: "wait",
    });
    return { accepted: true, changed: true, publish: true };
  }

  respawnPlayer(playerId) {
    const player = this.#world.getPlayer(playerId);
    if (!player || !player.joined || player.alive) {
      return { accepted: false, publish: false };
    }
    const [x, y] = this.#spawn(player.isAI);
    this.#world.updatePlayer(playerId, {
      x,
      y,
      prevX: x,
      prevY: y,
      power: 1,
      range: 1,
      shield: 0,
      speedLevel: 0,
      alive: true,
      action: "wait",
    });
    this.#world.materializeAround(x, y, 2);
    this.#world.trimColdChunks();
    return { accepted: true, changed: true, publish: true };
  }

  #isBlocked(x, y) {
    return (
      this.#world.isPermanentWall(x, y) ||
      this.#world.hasCrate(x, y) ||
      this.#world.readBombs().some((bomb) => bomb.x === x && bomb.y === y)
    );
  }

  #collectItem(playerId) {
    const player = this.#world.getPlayer(playerId);
    if (!player || player.isAI) return false;
    const x = Math.round(player.x);
    const y = Math.round(player.y);
    const item = this.#world.getItemAt(x, y);
    if (!item) return false;
    const update = itemStatUpdate(player, item.type);
    if (update) this.#world.updatePlayer(playerId, update);
    this.#world.removeItemAt(x, y);
    return true;
  }

  #damagePlayer(playerId, tick) {
    const player = this.#world.getPlayer(playerId);
    if (!player?.alive) return false;
    if (player.shield > 0) {
      this.#world.updatePlayer(player.id, { action: "wait", shield: player.shield - 1 });
      return true;
    }
    if (!player.isAI) {
      this.#world.updatePlayer(player.id, { action: "wait", alive: false });
      return true;
    }
    const type = AI_DROP_ITEM_TYPES[
      legacyHash(player.x + tick, player.y - tick) % AI_DROP_ITEM_TYPES.length
    ];
    this.#world.setItem({ x: player.x, y: player.y, type });
    const [x, y] = this.#spawn(true);
    this.#world.updatePlayer(player.id, {
      x,
      y,
      prevX: x,
      prevY: y,
      action: "wait",
    });
    this.#world.materializeAround(x, y, 2);
    return true;
  }

  #hasFlameAt(x, y) {
    return this.#world
      .readFlames()
      .some(
        (flame) =>
          flame.clockDomain !== "v3" && flame.x === x && flame.y === y,
      );
  }

  #movePlayer(playerId, action) {
    const player = this.#world.getPlayer(playerId);
    if (!player) return false;
    const [dx, dy] = DIRECTIONS[action] ?? DIRECTIONS.wait;
    const x = player.x + dx;
    const y = player.y + dy;
    this.#world.updatePlayer(playerId, { prevX: player.x, prevY: player.y, action });
    if (
      (dx === 0 && dy === 0) ||
      this.#isBlocked(x, y) ||
      this.#world
        .readPlayers()
        .some(
          (other) =>
            other.id !== playerId && other.alive && other.x === x && other.y === y,
        )
    ) {
      return false;
    }
    this.#world.updatePlayer(playerId, { x, y });
    this.#world.materializeAround(x, y, 2);
    this.#world.trimColdChunks();
    if (this.#hasFlameAt(x, y)) this.#damagePlayer(playerId, this.#tick);
    const movedPlayer = this.#world.getPlayer(playerId);
    if (movedPlayer?.alive && movedPlayer.x === x && movedPlayer.y === y) {
      this.#collectItem(playerId);
    }
    return true;
  }

  #placeBomb(playerId) {
    const player = this.#world.getPlayer(playerId);
    if (!player) return false;
    const bombs = this.#world.readBombs();
    const occupied = bombs.some((bomb) => bomb.x === player.x && bomb.y === player.y);
    const owned = bombs.filter((bomb) => bomb.owner === player.id).length;
    this.#world.updatePlayer(playerId, { action: "bomb" });
    if (occupied || owned >= player.power) return false;
    const id = this.#nextBombNumber++;
    this.#world.addBomb({
      id,
      x: player.x,
      y: player.y,
      owner: player.id,
      fuse: this.#bombFuseTicks,
      bornTick: this.#tick,
      range: player.range,
    });
    return true;
  }

  applyAction(playerId, action, { now = Date.now() } = {}) {
    const player = this.#world.getPlayer(playerId);
    if (!player?.alive || !ACTIONS.has(action)) {
      return { accepted: false, changed: false, publish: false, reason: "invalid" };
    }
    if (action === "bomb") {
      const changed = this.#placeBomb(playerId);
      return { accepted: true, changed, publish: true };
    }
    if (action === "wait") {
      this.#world.updatePlayer(playerId, { action: "wait" });
      return { accepted: true, changed: false, publish: true };
    }
    const speed =
      BASE_SPEED_TILES_PER_SECOND +
      (player.speedLevel ?? 0) * SPEED_ITEM_BONUS_TILES_PER_SECOND;
    const moveIntervalMs = this.#moveIntervalMs * BASE_SPEED_TILES_PER_SECOND / speed;
    if (now - player.lastMoveAt < moveIntervalMs) {
      return { accepted: false, changed: false, publish: false, reason: "rate_limited" };
    }
    this.#world.updatePlayer(playerId, { lastMoveAt: now });
    const moved = this.#movePlayer(playerId, action);
    return { accepted: true, changed: moved, publish: true };
  }

  #advanceBombs(tick) {
    const bombsAtStart = this.#world
      .readBombs()
      .filter((bomb) => bomb.clockDomain !== "v3");
    const previousFlameCells = new Set(
      this.#world
        .readFlames()
        .filter((flame) => flame.clockDomain !== "v3")
        .map((flame) => `${flame.x},${flame.y}`),
    );
    const exploding = [];
    for (const bomb of bombsAtStart) {
      if (bomb.bornTick === tick) continue;
      const fuse = bomb.fuse - 1;
      this.#world.updateBomb(bomb.id, { fuse });
      if (fuse <= 0 || previousFlameCells.has(`${bomb.x},${bomb.y}`)) {
        exploding.push({ ...bomb, fuse });
      }
    }
    const chain = resolveChainExplosions(exploding, bombsAtStart, {
      isPermanentWall: (x, y) => this.#world.isPermanentWall(x, y),
      hasCrate: (x, y) => this.#world.hasCrate(x, y),
    });
    for (const bomb of chain.bombs) this.#world.removeBomb(bomb.id);

    const flames = [...chain.cells.values()];
    this.#world.replaceFlamesForDomain("legacy", flames);

    for (const cell of flames) {
      if (this.#world.hasCrate(cell.x, cell.y)) {
        this.#world.destroyCrate(cell.x, cell.y);
      }
    }

    for (const player of this.#world.readPlayers()) {
      if (!player.alive || !chain.cells.has(`${Math.round(player.x)},${Math.round(player.y)}`)) {
        continue;
      }
      this.#damagePlayer(player.id, tick);
    }
  }

  advanceToTick(targetTick) {
    if (!Number.isInteger(targetTick) || targetTick <= this.#tick) {
      return { advancedTicks: 0, publish: false };
    }
    let advancedTicks = 0;
    while (this.#tick < targetTick) {
      this.#tick += 1;
      this.#advanceBombs(this.#tick);
      advancedTicks += 1;
    }
    return { advancedTicks, publish: true };
  }

  markPublishedPositions() {
    for (const player of this.#world.readPlayers()) {
      this.#world.updatePlayer(player.id, { prevX: player.x, prevY: player.y });
    }
  }
}

export function createGameSimulation(options) {
  return new GameSimulation(options);
}

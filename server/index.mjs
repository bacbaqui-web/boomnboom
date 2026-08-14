import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 3300);
const TICK_MS = Number(process.env.TICK_MS || 1000);
const WIDTH = 15;
const HEIGHT = 11;
const CRATE_RESPAWN_TICKS = 8;
const BOMB_FUSE_TICKS = 3;
const ACTIONS = new Set(["up", "down", "left", "right", "bomb", "wait"]);
const DIRS = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], wait: [0, 0],
};

let tick = 0;
let nextPlayerNumber = 1;
let nextBombNumber = 1;
let nextTickAt = Date.now() + TICK_MS;
let flames = [];
const players = new Map();
const bombs = new Map();
const crates = new Map();

const key = (x, y) => `${x},${y}`;
const permanent = (x, y) => x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 || (x % 2 === 0 && y % 2 === 0);
const spawnPoints = [[1,1], [13,9], [13,1], [1,9], [7,5], [3,5], [11,5]];

for (let y = 1; y < HEIGHT - 1; y++) {
  for (let x = 1; x < WIDTH - 1; x++) {
    const nearSpawn = spawnPoints.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) <= 1);
    if (!permanent(x, y) && !nearSpawn && ((x * 17 + y * 31) % 5 < 2)) crates.set(key(x, y), { x, y, respawnTick: null });
  }
}

function blocked(x, y) {
  return permanent(x, y) || crates.get(key(x, y))?.respawnTick === null || [...bombs.values()].some((b) => b.x === x && b.y === y);
}

function freeSpawn() {
  return spawnPoints.find(([x, y]) => ![...players.values()].some((p) => p.x === x && p.y === y)) || spawnPoints[tick % spawnPoints.length];
}

function addPlayer({ socket = null, isAI = false } = {}) {
  const id = isAI ? "BOT-1" : `P${nextPlayerNumber++}`;
  const [x, y] = freeSpawn();
  const player = { id, x, y, isAI, action: "wait", socket, score: 0 };
  players.set(id, player);
  return player;
}

addPlayer({ isAI: true });

function chooseBotAction(bot) {
  const humans = [...players.values()].filter((p) => !p.isAI);
  if (!humans.length) return "wait";
  const target = humans.reduce((a, b) => Math.abs(a.x-bot.x)+Math.abs(a.y-bot.y) < Math.abs(b.x-bot.x)+Math.abs(b.y-bot.y) ? a : b);
  const distance = Math.abs(target.x - bot.x) + Math.abs(target.y - bot.y);
  if (distance <= 2 && ![...bombs.values()].some((b) => b.owner === bot.id)) return "bomb";
  const choices = Math.abs(target.x-bot.x) >= Math.abs(target.y-bot.y)
    ? [target.x < bot.x ? "left" : "right", target.y < bot.y ? "up" : "down"]
    : [target.y < bot.y ? "up" : "down", target.x < bot.x ? "left" : "right"];
  return choices.find((action) => {
    const [dx, dy] = DIRS[action];
    return !blocked(bot.x + dx, bot.y + dy);
  }) || ["up", "right", "down", "left"].find((action) => {
    const [dx, dy] = DIRS[action];
    return !blocked(bot.x + dx, bot.y + dy);
  }) || "wait";
}

function blastCells(bomb) {
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    for (let n = 1; n <= 2; n++) {
      const x = bomb.x + dx*n, y = bomb.y + dy*n;
      if (permanent(x, y)) break;
      cells.push({ x, y });
      const crate = crates.get(key(x, y));
      if (crate?.respawnTick === null) break;
    }
  }
  return cells;
}

function explodeBombs() {
  const exploding = [...bombs.values()].filter((b) => --b.fuse <= 0);
  const cells = [];
  for (const bomb of exploding) {
    bombs.delete(bomb.id);
    cells.push(...blastCells(bomb));
  }
  const unique = new Map(cells.map((cell) => [key(cell.x, cell.y), cell]));
  flames = [...unique.values()];
  for (const cell of flames) {
    const crate = crates.get(key(cell.x, cell.y));
    if (crate?.respawnTick === null) crate.respawnTick = tick + CRATE_RESPAWN_TICKS;
  }
  for (const player of players.values()) {
    if (!unique.has(key(player.x, player.y))) continue;
    const [x, y] = freeSpawn();
    player.x = x; player.y = y; player.action = "wait";
  }
}

function resolveActions() {
  for (const player of players.values()) if (player.isAI) player.action = chooseBotAction(player);
  for (const player of players.values()) {
    if (player.action !== "bomb") continue;
    const occupied = [...bombs.values()].some((b) => b.x === player.x && b.y === player.y);
    const ownsBomb = [...bombs.values()].some((b) => b.owner === player.id);
    if (!occupied && !ownsBomb) bombs.set(nextBombNumber, { id: nextBombNumber++, x: player.x, y: player.y, owner: player.id, fuse: BOMB_FUSE_TICKS });
    player.action = "wait";
  }
  const intents = new Map();
  for (const player of players.values()) {
    const [dx, dy] = DIRS[player.action] || DIRS.wait;
    const x = player.x + dx, y = player.y + dy;
    intents.set(player.id, blocked(x, y) ? { x: player.x, y: player.y } : { x, y });
  }
  const counts = new Map();
  for (const pos of intents.values()) counts.set(key(pos.x,pos.y), (counts.get(key(pos.x,pos.y)) || 0) + 1);
  for (const player of players.values()) {
    const pos = intents.get(player.id);
    if (counts.get(key(pos.x,pos.y)) === 1) { player.x = pos.x; player.y = pos.y; }
  }
}

function state() {
  return {
    type: "state", tick, nextTickAt, width: WIDTH, height: HEIGHT,
    tiles: Array.from({ length: HEIGHT }, (_, y) => Array.from({ length: WIDTH }, (_, x) => permanent(x,y) ? "wall" : crates.get(key(x,y))?.respawnTick === null ? "crate" : "floor")),
    players: [...players.values()].map(({ id,x,y,isAI,action,score }) => ({ id,x,y,isAI,action,score })),
    bombs: [...bombs.values()], flames,
  };
}

function broadcast() {
  const message = JSON.stringify(state());
  for (const player of players.values()) if (player.socket?.readyState === WebSocket.OPEN) player.socket.send(message);
}

function runTick() {
  tick++;
  for (const crate of crates.values()) if (crate.respawnTick !== null && crate.respawnTick <= tick && ![...players.values()].some((p) => p.x === crate.x && p.y === crate.y)) crate.respawnTick = null;
  explodeBombs();
  resolveActions();
  nextTickAt = Date.now() + TICK_MS;
  broadcast();
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, tick, players: players.size, uptime: Math.round(process.uptime()) }));
  }
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/boom-ws" && req.url !== "/") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});
wss.on("connection", (ws) => {
  const player = addPlayer({ socket: ws });
  ws.send(JSON.stringify({ type: "welcome", id: player.id, tickMs: TICK_MS }));
  ws.send(JSON.stringify(state()));
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "action" && ACTIONS.has(msg.action)) player.action = msg.action;
    } catch { /* malformed client messages are ignored */ }
  });
  ws.on("close", () => players.delete(player.id));
});

const timer = setInterval(runTick, TICK_MS);
timer.unref();
server.listen(PORT, "127.0.0.1", () => console.log(`BOOMnBOOM tick server listening on 127.0.0.1:${PORT}`));

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));

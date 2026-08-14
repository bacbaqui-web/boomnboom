const DIRECTIONS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export function chooseBotIntent({ bot, players, bombs, isBlocked }) {
  const humans = players.filter((player) => !player.isAI && player.alive);
  if (!bot?.alive || humans.length === 0) return null;

  const target = humans.reduce((left, right) =>
    Math.abs(left.x - bot.x) + Math.abs(left.y - bot.y) <
    Math.abs(right.x - bot.x) + Math.abs(right.y - bot.y)
      ? left
      : right,
  );
  const distance = Math.abs(target.x - bot.x) + Math.abs(target.y - bot.y);
  if (distance <= 2 && !bombs.some((bomb) => bomb.owner === bot.id)) {
    return "bomb";
  }

  const preferred =
    Math.abs(target.x - bot.x) >= Math.abs(target.y - bot.y)
      ? [target.x < bot.x ? "left" : "right", target.y < bot.y ? "up" : "down"]
      : [target.y < bot.y ? "up" : "down", target.x < bot.x ? "left" : "right"];
  return (
    [...preferred, "up", "right", "down", "left"].find((action, index, all) => {
      if (all.indexOf(action) !== index) return false;
      const [dx, dy] = DIRECTIONS[action];
      return !isBlocked(bot.x + dx, bot.y + dy);
    }) ?? "wait"
  );
}

export function createBotController({ world }) {
  function snapshot() {
    const players = world.readPlayers();
    const bombs = world.readBombs();
    return {
      players,
      bombs,
      isBlocked(x, y) {
        return (
          world.isPermanentWall(x, y) ||
          world.hasCrate(x, y) ||
          bombs.some((bomb) => bomb.x === x && bomb.y === y)
        );
      },
    };
  }

  return {
    decide(botId) {
      const state = snapshot();
      const bot = world.getPlayer(botId);
      return chooseBotIntent({
        bot,
        ...state,
      });
    },
    decideAll() {
      const state = snapshot();
      if (!state.players.some((player) => !player.isAI && player.alive)) return [];
      return state.players
        .filter((player) => player.isAI && player.alive)
        .map((bot) => ({ botId: bot.id, action: chooseBotIntent({ bot, ...state }) }))
        .filter((intent) => intent.action !== null);
    },
  };
}

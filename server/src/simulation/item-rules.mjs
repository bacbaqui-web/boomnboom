export const AI_DROP_ITEM_TYPES = Object.freeze([
  "bomb",
  "shield",
  "flame",
  "speed",
]);

export function itemStatUpdate(player, itemType) {
  if (itemType === "bomb") return { power: player.power + 1 };
  if (itemType === "shield") return { shield: player.shield + 1 };
  if (itemType === "flame") return { range: player.range + 1 };
  if (itemType === "speed") return { speedLevel: (player.speedLevel ?? 0) + 1 };
  return null;
}

export const DEFAULT_HUMAN_PLAYER_COLOR = "blue";

export const HUMAN_PLAYER_COLORS = Object.freeze([
  Object.freeze({ id: "blue", name: "파랑", body: "#22b5ef", shadow: "#1382ca", highlight: "#8ee8ff" }),
  Object.freeze({ id: "cyan", name: "청록", body: "#35d4c7", shadow: "#19998f", highlight: "#a8fff6" }),
  Object.freeze({ id: "green", name: "초록", body: "#76e496", shadow: "#3aa765", highlight: "#c5ffd5" }),
  Object.freeze({ id: "yellow", name: "노랑", body: "#f4cf4f", shadow: "#c28f22", highlight: "#fff4a4" }),
  Object.freeze({ id: "orange", name: "주황", body: "#f2a24a", shadow: "#bd6727", highlight: "#ffd5a0" }),
  Object.freeze({ id: "purple", name: "보라", body: "#9d7be8", shadow: "#6749b4", highlight: "#d8c8ff" }),
  Object.freeze({ id: "pink", name: "분홍", body: "#e77fba", shadow: "#ad477e", highlight: "#ffc4e5" }),
  Object.freeze({ id: "silver", name: "은색", body: "#d9e3ee", shadow: "#8b9eb2", highlight: "#ffffff" }),
]);

const HUMAN_PLAYER_COLOR_IDS = new Set(HUMAN_PLAYER_COLORS.map((color) => color.id));

export function isHumanPlayerColor(value) {
  return typeof value === "string" && HUMAN_PLAYER_COLOR_IDS.has(value);
}

export function normalizeHumanPlayerColor(value) {
  return isHumanPlayerColor(value) ? value : DEFAULT_HUMAN_PLAYER_COLOR;
}

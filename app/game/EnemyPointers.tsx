import type { EnemySummary } from "./protocol";

export function EnemyPointers({
  enemies,
  visibleWidth,
  visibleHeight,
}: {
  enemies: readonly EnemySummary[];
  visibleWidth: number;
  visibleHeight: number;
}) {
  const edgeX = visibleWidth / 2 - 0.8;
  const edgeY = visibleHeight / 2 - 0.8;
  return enemies.map((enemy) => {
    if (Math.abs(enemy.dx) <= visibleWidth / 2 && Math.abs(enemy.dy) <= visibleHeight / 2) {
      return null;
    }
    const scale = Math.min(
      edgeX / Math.max(Math.abs(enemy.dx), 0.001),
      edgeY / Math.max(Math.abs(enemy.dy), 0.001),
    );
    const left = 50 + (enemy.dx * scale * 100) / visibleWidth;
    const top = 50 + (enemy.dy * scale * 100) / visibleHeight;
    const angle = (Math.atan2(enemy.dy, enemy.dx) * 180) / Math.PI + 90;
    return (
      <span
        key={enemy.id}
        className={`enemyPointer ${enemy.isAI ? "ai" : "rival"}`}
        style={{ left: `${left}%`, top: `${top}%` }}
        title={`${enemy.nickname} · 약 ${enemy.distance}칸`}
      >
        <i style={{ transform: `rotate(${angle}deg)` }}>▲</i><small>{enemy.distance}</small>
      </span>
    );
  });
}

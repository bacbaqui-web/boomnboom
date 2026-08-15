import type { WorldSnapshot } from "./world-state";

export function WorldTickHud({ snapshot }: { snapshot: WorldSnapshot }) {
  return (
    <div className="tickHud">
      <div
        key={`meter-${snapshot.worldTick}`}
        className="tickMeter"
        aria-label="다음 턴까지 1초 게이지"
      />
    </div>
  );
}

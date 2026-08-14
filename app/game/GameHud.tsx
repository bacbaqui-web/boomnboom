import type { ConnectionStatus } from "./protocol";
import type { WorldSnapshot } from "./world-store";

export function GameHeader({ status }: { status: ConnectionStatus }) {
  return (
    <header>
      <div className="brand">
        <span className="logoBomb">●</span>
        <div><b>BOOM <i>n</i> BOOM</b><small>부드럽게 움직이는 공유 월드 폭탄 대전</small></div>
      </div>
      <div className={`connection ${status}`}>
        <span /> {status === "online" ? "서버 연결됨" : status === "connecting" ? "연결 중" : "재연결 중"}
      </div>
    </header>
  );
}

export function GameHud({ snapshot }: { snapshot: WorldSnapshot }) {
  return (
    <div className="tickHud">
      <div><small>LIVE WORLD</small><strong>접속 즉시 같은 맵에 스폰</strong></div>
      <div
        key={`meter-${snapshot.worldTick}`}
        className="tickMeter"
        aria-label="다음 턴까지 1초 게이지"
      />
    </div>
  );
}

export function GameLegend({
  volumeLevel,
  cycleVolume,
}: {
  volumeLevel: number;
  cycleVolume: () => void;
}) {
  return (
    <div className="legend">
      <span><i className="warning" />2초 뒤 재생성</span>
      <span><i className="itemIcon bombUp">●</i>폭탄 수</span>
      <span><i className="itemIcon shieldUp">◆</i>방어막</span>
      <span><i className="itemIcon flameUp">🔥</i>화력</span>
      <span className="bgmTitle">♫ Midnight Tile Loop</span>
      <button
        className={`volumeButton level-${volumeLevel}`}
        onClick={cycleVolume}
        aria-label={volumeLevel === 0 ? "BGM 음소거됨, 눌러서 작게 재생" : `BGM 음량 ${volumeLevel}단계, 눌러서 변경`}
        title="BGM 음량"
      >
        <span className="speakerBody" />
        <span className="volumeWaves">
          {[1, 2, 3].map((level) => <i key={level} className={level <= volumeLevel ? "on" : ""} />)}
        </span>
        {volumeLevel === 0 ? <b>×</b> : null}
      </button>
    </div>
  );
}

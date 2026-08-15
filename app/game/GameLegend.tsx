export function GameLegend({
  volumeLevel,
  cycleVolume,
}: {
  volumeLevel: number;
  cycleVolume: () => void;
}) {
  return (
    <div className="legend">
      <span><i className="itemIcon bombUp">●</i>폭탄 수</span>
      <span><i className="itemIcon shieldUp">◆</i>방어막</span>
      <span><i className="itemIcon flameUp">🔥</i>화력</span>
      <span><i className="itemIcon speedUp">➤</i>속도 +0.5</span>
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

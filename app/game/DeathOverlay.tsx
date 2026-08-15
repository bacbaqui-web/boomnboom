export function DeathOverlay({ onRespawn }: { onRespawn: () => void }) {
  return (
    <div className="gameOverlay death">
      <div>
        <small>BOOM!</small><h2>폭탄에 맞았어요</h2>
        <p>새로운 위치에서 다시 시작할 수 있어요.</p>
        <button onClick={onRespawn}>다시 접속하기</button>
      </div>
    </div>
  );
}

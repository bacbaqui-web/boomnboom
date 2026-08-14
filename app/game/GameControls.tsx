"use client";

import type { MoveAction, PlayerEntity } from "./protocol";

export function GameControls({
  player,
  startMoving,
  stopMoving,
  bomb,
}: {
  player: PlayerEntity | undefined;
  startMoving: (direction: MoveAction) => void;
  stopMoving: () => void;
  bomb: () => void;
}) {
  const directionButton = (direction: MoveAction, label: string) => (
    <button
      onPointerDown={(event) => {
        event.preventDefault();
        startMoving(direction);
      }}
      onPointerUp={stopMoving}
      onPointerCancel={stopMoving}
    >
      {label}
    </button>
  );
  return (
    <div className="controls">
      <div className="dpad">
        {directionButton("up", "▲")}
        {directionButton("left", "◀")}
        {directionButton("down", "▼")}
        {directionButton("right", "▶")}
      </div>
      <div className="rules">
        <b>{player?.nickname ? `${player.nickname}으로 참가 중` : "참가 준비 중"}</b>
        <span>이동과 폭탄 설치는 즉시, 폭발과 상자 재생성은 음악 박자에 실행됩니다.</span>
        <span>{player ? `폭탄 ${player.power}개 · 화력 ${player.range}칸 · 방어막 ${player.shield}회` : "AI를 쓰러뜨리고 아이템을 획득하세요."}</span>
      </div>
      <button className="boomBtn" onClick={bomb}>BOMB<small>즉시 설치</small></button>
    </div>
  );
}

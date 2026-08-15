import type { PlayerEntity } from "./protocol";
import { speedTilesPerSecond } from "../../shared/movement-config.mjs";

export function PlayerStatus({ player }: { player: PlayerEntity | undefined }) {
  const speedLevel = player?.speedLevel;
  const speed = typeof speedLevel === "number" && Number.isSafeInteger(speedLevel)
    ? `${speedTilesPerSecond(speedLevel).toFixed(1)}칸/초`
    : "기존 속도";
  return (
    <div className="rules">
      <b>{player?.nickname ? `${player.nickname}으로 참가 중` : "참가 준비 중"}</b>
      <span>이동과 폭탄 설치는 즉시, 폭발은 음악 박자에 실행됩니다.</span>
      <span>{player ? `폭탄 ${player.power}개 · 화력 ${player.range}칸 · 방어막 ${player.shield}회 · ${speed}` : "AI를 쓰러뜨리고 아이템을 획득하세요."}</span>
    </div>
  );
}

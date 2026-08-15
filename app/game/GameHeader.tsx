import type { ConnectionStatus } from "./protocol";

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

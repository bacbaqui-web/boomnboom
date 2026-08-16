# BOOMnBOOM 최근 작업 보고서

## 최근 Task — 내 화면 무보정·즉발 정속·30Hz 위치 전송

### 요청

- 내 화면의 위치를 server snapshot으로 보정하지 않는다.
- 다른 플레이어는 server 확정 위치를 받아 보간한다.
- 칸 이동 가속을 제거한다.
- 15Hz 위치 전송을 점검하고 더 빠르게 한다.

### 변경

- owner snapshot은 처리한 command ACK와 stat만 반영하며 local presentation 좌표를
  덮어쓰지 않는다.
- 수명 시작, respawn, reconnect와 teleport에서만 local 위치를 초기화한다.
- 기본 초당 3칸과 speed item 단계 모두 첫 movement tick부터 정속으로 움직인다.
- V3 owner/entity snapshot을 15Hz에서 30Hz로 올렸다.
- server는 폭탄, 아이템, 충돌, damage와 remote player projection authority를 유지한다.
- 사용하지 않게 된 Correction Smoother를 제거했다.

### 현재 상태

- 구현과 로컬 검증 완료
- root production build/client 91건, server regression 106건 PASS
- 200/300ms RTT·jitter·receive stall local correction 0 확인
- ESLint와 TypeScript PASS
- GitHub `main` 구현 commit `e7a3c26` push 완료
- Oracle staging/server regression 106건과 공개 V3 30Hz·V2 ACK 확인
- Oracle service active, health `ok`, fixed backlog 0, RSS 약 80MB
- Sites version 68 production 배포와 공개 페이지 HTTP 200 확인
- 이전 Oracle server/shared 복구본 보존

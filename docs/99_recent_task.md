# BOOMnBOOM 최근 작업 보고서

## 최근 Task — AI 완화, 상자 복구와 남은 렌더 렉 제거

### 사용자 관찰

- 전술 AI가 아이템까지 획득하면서 사람보다 빠르게 강해졌다.
- 상자가 영구히 사라져 전장이 너무 빨리 비었다.
- 이전 rAF/culling 최적화 뒤에도 이동 중 체감 끊김이 남았다.

### 확인한 원인

- AI가 사람과 같은 item collect 경로를 쓰고 Tactics가 안전한 item을 우선 탐색했다.
- crate destruction 뒤 복구 상태를 소유하는 server system이 없었다.
- 공개 health의 fixed catch-up backlog는 0으로 server tick 정체 증거는 없었다.
- client는 보이는 최대 4청크만 골라도 청크마다 256개 floor DOM을 만들어, 최대
  1,024개 바닥 요소를 camera transform과 함께 합성하고 있었다.

### 구현 방향

- AI는 item을 소비하거나 목표로 삼지 않고 시작 능력치를 유지한다.
- 생존 탈출은 유지하고 탐색 예산·bomb cooldown·비최적 안전 선택만 완화한다.
- 상자는 파괴 12초 뒤 복구하며 3초 전 warning 장판을 chunk revision으로 전송한다.
- 새 warning은 살아 있는 player 주변 9×9에서 미루고, 이미 표시된 warning은 예정대로
  3초 뒤 복구한다.
- floor는 chunk CSS 배경 하나로 그리고 obstacle과 warning만 DOM으로 만든다.

### 현재 상태

- server 전체 회귀 101건 PASS
- root production build/client 92건, ESLint와 TypeScript PASS
- source/test 500줄 미만, Node syntax와 `git diff --check` PASS
- commit/push와 Sites/Oracle 배포는 진행 중

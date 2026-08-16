# BOOMnBOOM 최근 작업 보고서

## 최근 Task — 화면 렌더 Hot Path 최적화

### 문제

서버의 input ACK와 entity snapshot은 정상 범위였지만 Edge renderer 사용량이 높았다.
원인은 player마다 별도 rAF를 돌리고 controller prediction도 별도 rAF를 가지며, 화면에
보이지 않는 AI와 3×3 청크 2,304타일까지 계속 DOM/compositor 작업에 포함한 구조였다.

### 변경

- `WorldViewport` 한 곳만 `requestAnimationFrame`을 소유한다.
- 한 frame 안에서 predictor 진행, local sample, remote 일괄 paint, camera/local paint를 순서대로 한다.
- remote player별 frame loop를 없애고 `RemotePlayerPainter`가 보이는 player를 한 번에 갱신한다.
- 화면 2칸 밖 player, bomb, item, flame과 death visual은 DOM에 만들지 않는다.
- terrain은 Store의 25청크를 유지하면서 viewport와 겹치는 최대 4청크만 렌더한다.
- 동일한 camera/player transform과 idle style은 다시 쓰지 않는다.

### 유지한 계약

- Server Authority, World Owner와 Protocol V2/V3 payload는 변경하지 않았다.
- local prediction/replay/correction과 remote snapshot interpolation 계산은 그대로다.
- 15×11 crop, 고정 floor pattern, enemy pointer, player 점프/이동음과 폭발음은 유지한다.
- culling은 render-only이며 canonical entity와 remote snapshot history를 삭제하지 않는다.

### 검증과 배포

- root production build와 client test 92건 PASS
- ESLint와 TypeScript PASS
- server 전체 회귀 95건 PASS
- visibility, 단일 frame coordinator, remote painter와 최대 4청크 selector 신규 테스트 PASS
- 모든 source/test 파일 500줄 미만
- GitHub `main` commit `74008b4`와 Sites version 62 게시 완료
- 공개 page HTTP 200, Oracle health `ok`, Protocol V2/V3와 fixed backlog 0 확인
- Edge가 같은 시간에 사용자 조작으로 계속 이동해 자동 새 탭 요청이 안전하게 중단됐으므로
  실제 플레이 체감은 공개 URL에서 사용자가 확인한다.

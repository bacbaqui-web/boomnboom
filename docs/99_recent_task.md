# BOOMnBOOM 최근 작업 보고서

## 최근 Task — 몸 기준 폭탄 위치, 칸 중앙 점프와 입력 유지

### 요청

- 진행 방향이 아니라 플레이어 몸이 가장 많이 들어간 칸에 폭탄을 설치한다.
- 한 칸의 중앙에서 다음 칸 중앙까지 이동 진행률에 맞춰 점프한다.
- 출발·착지는 `X 105% / Y 90%`, 최고점은 `X 90% / Y 105%`, 높이는 10px로 한다.
- 키보드를 계속 누르고 있으면 일시적인 지연이나 입력 재설정 뒤에도 계속 이동한다.

### 구현

- server `bomb-system`과 client pending bomb가 모두 authoritative/predicted 몸 중심이
  속한 칸을 사용한다. 대칭 충돌 몸체이므로 이 칸이 몸 면적이 가장 많이 겹친 칸이다.
- 이동은 기존 shared one-cell target과 중심선 판정을 유지한다.
- 이동 animation은 175ms Web Animation 재생을 제거하고 실제 rAF 위치에서 칸 중앙
  진행률을 계산한다. 중앙 출발·착지, 경계 최고점 pose가 실제 위치와 일치한다.
- local, AI와 다른 사람 모두 같은 위치 기반 점프 pose를 사용한다.
- `HeldDirectionTracker`가 동시에 눌린 키를 기억한다. 새 방향키를 놓으면 아직 눌린
  이전 방향으로 돌아가며, pointer 조작을 놓아도 keyboard 방향을 이어간다.
- V3 `InputSampler`는 즉시 direction 전송 뒤 누르는 동안 250ms heartbeat를 보내
  reconnect 또는 Runtime reset 뒤 held input을 복구한다.
- 입장 전 닉네임 입력에서는 방향키와 스페이스 입력을 가로채지 않는다.

### 보존한 기존 변경

- 직전 Task의 입장 문구 정리와 사람용 8색 선택, AI 전용 빨강 규칙을 그대로 보존했다.
- 서버 권한, 30Hz simulation, client prediction/replay와 15Hz remote snapshot 구조는
  변경하지 않았다.

### 검증

- root production build와 client test 89건 PASS
- server test 80건 PASS
- ESLint와 TypeScript `--noEmit` PASS
- 몸 중심 폭탄 위치, 중앙/최고점/착지 pose, held key fallback과 heartbeat 자동 테스트

### 배포 상태

- 제품 변경은 `1628f10`으로 commit하고 GitHub와 Sites source repository에 push했다.
- Oracle은 server/shared 백업 뒤 `boomnboom` 서비스만 재시작했고, 공개 health와
  V3 join·25 chunk baseline·선택 색상 동기화·ping smoke를 통과했다.
- Sites lockfile을 정규화한 뒤 packaged artifact로 version 60을 공개 배포했다.
- 공개 페이지에서 새 닉네임 문구가 확인됐고, 제거 대상 문구는 더 이상 나오지 않는다.
- 공개 URL: `https://bubble-boom-arcade.bacbaqui2.chatgpt.site/`

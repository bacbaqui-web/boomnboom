# BOOMnBOOM AI Coding Agent Guidelines

이 저장소를 변경하는 모든 AI 코딩 에이전트는 작업 전에 이 파일과
`docs/01_rule.md`를 읽는다. 관련 Architecture, 현재 소스 지도와 Sprint 계획도
함께 확인한다.

## 1. 구현 전에 확인하기

- 사용자의 목표, 범위, 금지 사항과 완료 조건을 먼저 확인한다.
- 실제 코드, 설정, 테스트와 배포 구성을 읽고 사실과 추론을 구분한다.
- `git status --short`로 기존 변경을 확인하고 사용자 작업을 덮어쓰지 않는다.
- 구조 변경 전 현재 브라우저 → WebSocket → 서버 → 월드 상태 흐름을 추적한다.
- 해석에 따라 제품 결과가 크게 달라질 때만 질문하고, 안전하게 확인 가능한
  내용은 직접 확인한다.

## 2. 단순성과 범위

- 요청을 만족하는 가장 작고 직접적인 구조를 선택한다.
- 현재 필요한 책임보다 앞선 범용화, 플러그인 구조와 설정 계층을 만들지 않는다.
- 한 파일과 한 객체에는 하나의 주된 책임만 둔다.
- 관련 없는 UI, 게임 규칙, 밸런스와 formatting을 함께 변경하지 않는다.
- 이번 변경 때문에 사용되지 않게 된 코드만 같은 rollback 단위에서 정리한다.
- 대규모 refactor는 `docs/98_sprint_plan.md`의 단계와 Manifest 안에서만 진행한다.

## 3. 월드와 서버 권한

- 서버의 `World Owner`가 공유 월드, 플레이어, 폭탄, 아이템과 상자 상태를
  변경하는 유일한 경계다.
- 클라이언트 입력은 intent이며 확정된 이동이나 폭탄 판정이 아니다.
- 클라이언트와 네트워크 계층은 canonical 월드 상태를 직접 mutation하지 않는다.
- 화면 크기, 카메라 원점, 보간 위치와 DOM 상태를 서버 월드에 저장하지 않는다.
- 같은 월드 좌표는 모든 접속자에게 같은 타일과 같은 revision을 뜻해야 한다.
- 이동할 때마다 전체 화면 타일 배열을 다시 생성하거나 전송하지 않는다.

## 4. Runtime과 렌더링

- 서버 canonical state와 클라이언트 runtime cache를 구분한다.
- 클라이언트 청크 캐시, 보간 위치, 입력 상태, 카메라, BGM과 UI는 Runtime이다.
- 고정 지형은 청크 snapshot/delta가 바뀔 때만 갱신한다.
- 캐릭터와 폭탄은 entity update로 갱신하고 카메라는
  `requestAnimationFrame`에서 부드럽게 표시한다.
- 렌더링을 부드럽게 만들기 위해 서버 판정을 우회하거나 두 번째 월드 원본을
  만들지 않는다.

## 5. 기존 상태 보존

- dirty worktree의 기존 변경은 사용자의 작업으로 취급한다.
- 요청 없이 파일, 배포 설정, 데이터베이스, history와 생성물을 삭제하거나
  되돌리지 않는다.
- 기존 공개 게임 URL, Oracle WebSocket 경로, 닉네임 입장, 재접속, AI,
  폭탄·아이템·상자 파괴 상태와 BGM 동기화는 Sprint의 Preserve 계약을 따른다.
- 구형 D1 API와 스타터 파일은 사용 여부와 rollback 경계를 확인하기 전에는
  삭제하지 않는다.
- secret, 인증 정보와 서버 credential을 출력하거나 저장소에 추가하지 않는다.

## 6. 목표 중심 실행과 검증

- 각 Task를 관찰 가능한 성공 조건과 독립 rollback 단위로 바꾼다.
- refactor는 변경 전후 Preserve 계약을 자동 테스트로 고정한다.
- 월드 생성은 음수 좌표, 청크 경계와 재생성 뒤에도 결정적이어야 한다.
- protocol test는 메시지 종류, revision, sequence와 stale update 폐기를 검증한다.
- 변경 성격에 맞는 server test, client test, lint, build와
  `git diff --check`를 실행한다.
- 정적 검증은 실제 브라우저 2개와 Oracle 배포 환경의 동작을 증명하지 않는다.
- 실행하지 않은 검사를 통과했다고 보고하지 않는다.

## 7. Git, 외부 변경과 배포

- 사용자가 요청하지 않으면 stage, commit, push, PR과 history rewrite를 하지
  않는다.
- 배포는 사용자가 요청한 Sprint 범위에서만 수행하고, 배포 전 로컬 검증과
  rollback 대상을 확정한다.
- Oracle 서비스와 공개 웹을 한 번에 바꾸지 말고 protocol compatibility 또는
  명시적 전환 순서를 둔다.
- 배포 뒤 `/health`, WebSocket 연결과 실제 2-client 흐름을 확인한다.

## 8. 협업

- 단일 Task는 담당 에이전트가 조사, 구현과 범위 검증을 수행한다.
- 여러 Task를 포함한 Sprint는 사용자가 전체 실행을 요청했을 때만
  서브에이전트에 독립 작업을 배정할 수 있다.
- 동일 파일을 수정하거나 선행 결과가 필요한 Task는 순차로 수행한다.
- 서브에이전트는 할당된 범위만 수행하고 Sprint 완료, 배포와 다음 Task를
  임의로 결정하지 않는다.
- 루트 에이전트가 결과 통합, 전체 검증, 문서 동기화와 완료 판정을 책임진다.

## 9. 문서 권한

- 제품 불변식: `docs/01_rule.md`
- 월드: `docs/architecture/10_world_architecture.md`
- 시뮬레이션: `docs/architecture/11_simulation_architecture.md`
- 네트워크: `docs/architecture/12_network_protocol_architecture.md`
- 클라이언트 렌더링: `docs/architecture/13_client_render_architecture.md`
- 저장과 수명주기: `docs/architecture/14_persistence_lifecycle_architecture.md`
- 현재 파일과 책임: `docs/20_src_map.md`
- 현재 Sprint: `docs/98_sprint_plan.md`
- 최근 작업: `docs/99_recent_task.md`

Architecture와 현재 코드가 다르면 차이를 Sprint 계획에 기록하고 단계적으로
해소한다. 새 파일, 이동과 책임 변경은 같은 Task에서 `docs/20_src_map.md`에
반영한다.

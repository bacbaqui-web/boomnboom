# Server-Owned Shared World Refactor Sprint

## 상태

- Sprint 완료
- 1단계 PASS — 현재 흐름 audit, Constitution과 Architecture 계약 작성
- 2단계 PASS — World Owner와 materialized chunk core, V1 호환 전환
- 3단계 PASS — Simulation/AI 분리와 gameplay regression 17건
- 4단계 PASS — Protocol V2와 관심 영역 delta publication
- 5단계 PASS — Client World Store와 layer/camera 전환
- 6A PASS — caller 0 레거시 D1/starter 정리와 배포 readiness
- 6B PASS — production soak, V1 제거, Sites v41와 V2-only Oracle 공개 검증
- 7단계 PASS — 파일명과 실제 변경 책임 정렬, 동작 보존 구조 정리

## 기준

- `AGENTS.md`
- `docs/01_rule.md`
- `docs/architecture/10_world_architecture.md`
- `docs/architecture/11_simulation_architecture.md`
- `docs/architecture/12_network_protocol_architecture.md`
- `docs/architecture/13_client_render_architecture.md`
- `docs/architecture/14_persistence_lifecycle_architecture.md`
- `docs/20_src_map.md`

## Sprint 목적

viewer마다 주변 타일을 다시 계산해 전체 state로 보내는 구조를, Oracle 서버가
확정된 shared chunk와 entity를 소유하고 client가 넓게 preload한 월드를 부드럽게
보여주는 구조로 교체한다.

최종 구조에서 플레이어 이동은 전체 tile matrix 생성·전송·React 재렌더링을
일으키지 않는다. server integer-grid 판정과 client visual interpolation을
분리한다.

## 현재 기준선

- client: `app/page.tsx` 단일 component, Protocol V1, 23×19 전체 state
- server: `server/index.mjs` 단일 module, 9×9 procedural cache, module-level mutation
- 이동: server 140ms rate limit, client 145ms hold input
- AI: 500ms
- world tick: 1000ms, bomb/폭발/상자 재생성과 BGM clock
- client test: build + SSR/source 문자열 test 2건
- server gameplay/protocol test: 없음
- 기존 audit 기준 build/test는 통과하며 lint에는 기존 오류 3건과 경고 1건이 있음

각 단계 시작 전에 기준선을 다시 실행하고 현재 작업 때문에 생긴 실패와 기존
실패를 구분한다.

## Preserve 계약

- 공개 game URL과 Oracle `wss://insight.magamiscom.ing/boom-ws`
- nickname 입력 뒤 shared world 참가
- 사망 overlay와 다시 접속하기
- 사람·AI, 폭탄, 폭탄 수/방어막/화력 item
- authoritative grid collision과 bomb 설치 칸
- 폭발 순간 위치 기준 피해
- permanent wall, destructible crate, warning과 respawn
- player 주변 9×9에는 새 warning/respawn schedule을 만들지 않음
- 이미 commit된 warning은 player 접근 뒤에도 유지
- offscreen enemy direction
- world clock/BGM sync와 volume control
- local player 중앙 projection과 keyboard/pointer 조작
- Oracle 128MB 제한 안에서 bounded memory 목표

현재 bug를 Preserve하지 않는다. viewer별 지형 재계산, 청크 경계 빈 길, spawn
상자 영구 삭제, 이동마다 전체 tile 전송과 camera 끊김은 해소 대상이다.

## 범위 밖

- 친구대전과 room code 재구현
- 계정, 로그인, leaderboard와 영구 player inventory
- world 전투 상태의 Oracle DB/disk persistence
- gameplay balance, 새 AI 전략과 chain reaction 추가
- Canvas/WebGL renderer 전환
- 새 캐릭터 art, UI redesign와 BGM 교체
- 다중 Oracle process/sharding
- 측정 없는 binary protocol와 compression

## 목표 파일 Manifest

실제 구현 중 이름은 책임이 더 명확한 경우 조정할 수 있지만 Owner와 boundary는
유지한다.

### Server

| 영역 | 목표 파일/책임 |
|---|---|
| entry | `server/index.mjs`: main 호출만 하는 호환 entry |
| composition | `server/src/main.mjs`: config, Owner, loop와 Gateway 조립 |
| config | `server/src/config.mjs`: env parse와 validation |
| world | `server/src/world/coordinates.mjs`: floorDiv, chunk/local 좌표 |
| world | `server/src/world/chunk-generator.mjs`: deterministic base terrain |
| world | `server/src/world/world-owner.mjs`: chunk/entity 단일 mutation boundary |
| world | `server/src/world/spawn-finder.mjs`: 지형을 바꾸지 않는 spawn 검색 |
| simulation | `server/src/simulation/game-simulation.mjs`: movement/bomb/tick transaction |
| simulation | `server/src/simulation/explosion.mjs`: blast와 damage 계산 |
| AI | `server/src/ai/bot-controller.mjs`: read snapshot → intent |
| network | `server/src/network/protocol-v1.mjs`: 전환 기간 호환 serializer |
| network | `server/src/network/protocol-v2.mjs`: schema와 serializers |
| network | `server/src/network/websocket-gateway.mjs`: connection/message routing |
| network | `server/src/network/{websocket-session,chunk-interest,entity-projector,world-publisher,backpressure-sender}.mjs` |
| tests | `server/test/*.test.mjs`: world/simulation/protocol/lifecycle |

### Client

| 영역 | 목표 파일/책임 |
|---|---|
| page | `app/page.tsx`: composition과 shell만 담당 |
| protocol | `app/game/protocol.ts`: V2 message type/validation |
| network | `app/game/game-socket.ts`: connect/reconnect/send/subscription |
| state | `app/game/world-state.ts`, `world-message-applier.ts`, `world-selectors.ts`, `world-store.ts` |
| controller | `app/game/use-game-controller.ts`: store/socket/input/audio 조립 |
| input | `app/game/use-game-input.ts`: keyboard/pointer intent와 cleanup |
| camera | `app/game/position-interpolator.ts`, `camera-runtime.ts`: 보간과 camera projection |
| audio | `app/game/audio-runtime.ts`: BGM clock sync와 volume |
| render | `app/game/WorldViewport.tsx`: viewport와 layer 조립 |
| render | `app/game/TerrainLayer.tsx`: revision 기반 chunk/tile |
| render | `app/game/EntityLayer.tsx`: player/bomb/item/flame projection |
| UI | `app/game/GameHeader.tsx`, `WorldTickHud.tsx`, `GameLegend.tsx`, `JoinOverlay.tsx`, `DeathOverlay.tsx`, `GameControls.tsx`, `PlayerStatus.tsx` |
| style | `app/globals.css` 또는 책임별 CSS: 사용 중인 style만 명확히 유지 |
| tests | `tests/`: store/protocol/render contract + 기존 SSR |

파일을 필요 이상 잘게 나누지 않는다. 한 파일이 한 책임 안에서 충분히 작으면
추가 분할하지 않는다.

## Rollback 단위

| 단위 | 변경 | rollback 결과 |
|---|---|---|
| R1 | 규칙/Architecture/Sprint 문서 | 기존 코드와 동작 그대로 |
| R2 | World core + V1 adapter | 기존 `server/index.mjs` V1 구현으로 복귀 |
| R3 | Simulation/AI modules | R2의 World read/command와 기존 규칙 adapter로 복귀 |
| R4 | Protocol V2 server | V2 비활성, V1 client 계속 사용 |
| R5 | V2 client/render path | 공개 client를 V1 path로 복귀, V2 server 호환 유지 |
| R6A | 구형 code cleanup | 삭제 전 파일/설정 단위 복원 |
| R6B | Oracle server deploy | 이전 server directory/service binary로 rollback |
| R6C | 공개 web deploy | 직전 Sites deployment로 rollback |

R2~R5는 가능한 한 feature/protocol boundary로 전환 가능하게 유지한다. 영구적인
dual implementation을 만들지는 않는다.

---

## 1단계 — 계약과 현재 흐름 확정

### 목적

대규모 변경 전에 데이터 소유권, Preserve 결과, 목표 protocol과 실제 현재 경로를
고정한다.

### 작업 내용

- UMZIQ 문서 체계를 BOOMnBOOM 책임에 맞게 작성
- 전체 source/config/deployment/test inventory와 caller audit
- World Owner, Simulation, Protocol, Client Render, Lifecycle 계약 작성
- 6단계 Manifest, 위험, rollback과 완료 기준 확정

### 검증

- 모든 문서 link와 파일 존재 확인
- `docs/20_src_map.md`와 실제 import/caller 대조
- `git diff --check`
- 코드 파일 변경 0건

### 완료 조건

- canonical owner와 runtime 경계가 하나의 해석을 가짐
- V1 현재 흐름과 V2 전환 순서 기록
- 단계별 독립 rollback 가능
- 구현 전 Preserve/non-goal 합의 가능

---

## 2단계 — World Owner와 materialized chunk core

### 목적

접속자 화면과 무관한 shared world 원본을 만들고, 같은 좌표의 타일을 한 번
확정해 모든 viewer가 공유하게 한다.

### 작업 내용

- coordinate/chunk helper와 deterministic generator 추출
- 16×16 WorldChunk, revision과 World Owner 도입
- 경계 이웃을 고려하는 crate generation으로 9×9 경계 길 제거
- 지형을 삭제하지 않는 spawn search
- entity registry와 chunk/entity indexes를 Owner 안으로 이동
- active/preload/retention materialization과 base-only LRU/TTL
- 기존 V1 `state` serializer가 World Owner read model을 사용하게 연결

### 위험

- 음수 좌표 chunk 계산 오류
- generation version 변경으로 기존 화면의 지형 변화
- spawn 후보 부족과 무한 검색
- mutation 있는 chunk eviction
- R2에서 V1 결과 shape가 달라 공개 client가 깨짐

### 자동 검증

- coordinate round-trip와 음수 좌표
- generation determinism/order independence
- 경계 상자 밀도와 인위적 빈 선 0
- 두 viewer의 같은 coordinate/tile/revision
- materialize 1회와 base-only eviction 복원
- spawn이 tile mutation을 만들지 않음
- 기존 V1 fixture shape

### 완료 조건

- `stateFor(viewer)`가 procedural tile generator를 직접 호출하지 않음
- World Owner 밖 canonical Map/Set mutation 0
- viewer movement만으로 chunk revision 변화 0
- V1 client로 현재 gameplay 가능
- R2 독립 rollback 가능

### 결과

- 16×16 WorldChunk, revision, respawn state와 private entity registry 구현
- 음수 좌표와 절대좌표 기반 경계 비의존 generator 구현
- spawn terrain mutation 제거
- player 주변 반경 2 preload와 base-only cold trim 구현
- viewer origin을 V1 adapter Runtime으로 격리하고 기존 23×19 shape 유지
- server world/V1 test 6/6 및 임시 포트 WebSocket smoke 통과
- gameplay 규칙/clock 분리는 계획대로 3단계에 유지

---

## 3단계 — Simulation/AI 경계와 regression test

### 목적

socket/timer에서 게임 규칙 mutation을 분리하고 현재 gameplay와 수정 대상 버그를
테스트로 고정한다.

### 작업 내용

- movement, bomb, explosion, damage, item과 respawn을 Simulation command로 이동
- world beat loop와 real-time input cadence 분리
- mutation batch 원자 commit과 changed chunk/entity event 생성
- AI를 read snapshot → intent controller로 이동
- player 9×9 warning 생성 규칙과 committed warning 계약 반영
- 폭발 실행 순간 위치로 damage 판정
- health에 simulation/chunk 기본 metrics 추가

### 위험

- tick catch-up에서 중복 explosion
- AI respawn/item ordering 변화
- warning 연기와 commit 의미 혼동
- timer와 socket callback concurrency에서 partial state 노출

### 자동 검증

- collision matrix와 input rate/sequence
- bomb limit/place tile/fuse
- 폭발 범위와 순간 위치 damage
- shield, death, AI drop/respawn과 item collect
- warning 미생성/commit 뒤 유지/폭탄 칸 연기
- late tick catch-up와 mutation batch 원자성
- no-human AI idle work

### 완료 조건

- Gateway와 timer가 canonical world를 직접 mutation하지 않음
- current gameplay Preserve test 통과
- 명시된 피해/경고 bug regression 통과
- server test script 실제 test files 실행
- R3 독립 rollback 가능

### 결과

- join/respawn/movement/bomb/item/tick gameplay를 Game Simulation command로 이동
- 폭발 cell 계산을 pure helper로 분리
- AI를 read snapshot → intent Controller로 분리하고 shared action command 연결
- V1 140ms cadence, AI 500ms, 1초 world tick과 bomb/item 수치 유지
- 폭발 순간 위치, shield/death, AI drop/respawn과 tick catch-up 고정
- 9×9 warning commit 연기, committed warning 유지와 bomb cell 연기 고정
- server test 17/17 및 임시 V1 WebSocket smoke 통과
- Protocol event/delta publication은 계획대로 4단계에 유지

---

## 4단계 — Protocol V2와 delta publication

### 목적

최초 preload 이후 이동에서는 entity 변화만, 지형 변화에서는 해당 chunk delta만
전송한다.

### 작업 내용

- V2 envelope/schema와 message validation
- join → world_init → chunk/entity snapshot → ready 흐름
- client sequence/input ack/correction
- chunk revision, delta와 resync
- entity revision과 interest-based snapshot/delta
- player 중심 preload 반경 2와 subscriber index
- backpressure와 compact health metrics
- V1/V2 compatibility gateway 유지

### 위험

- revision gap 뒤 client/server divergence
- interest 경계에서 entity 또는 chunk가 늦게 도착
- V1/V2 session 분기 누락
- slow client가 server memory를 압박

### 자동 검증

- malformed/schema/version rejection
- init 순서와 preload completeness
- 이동 packet의 tile matrix 0건
- 최초 chunk snapshot 뒤 delta only
- gap/resync, duplicate sequence와 stale entity 폐기
- interest enter/leave와 two-client shared revision
- bufferedAmount/backpressure policy

### 완료 조건

- 일반 이동의 tile serialization 0
- 모든 chunk change에 monotonic revision
- 같은 chunk 구독자가 같은 delta 수신
- V1 공개 client 계속 동작
- R4 독립 rollback 가능

### 결과

- query 또는 `boom-v2` subprotocol로 선택하는 V2 server와 V1 기본 분기 구현
- `hello → world_init → 반경 2의 25청크 → entity_snapshot → ready` 순서 고정
- clientSeq ack cache, stale/duplicate idempotency와 authoritative correction 구현
- session별 chunk snapshot baseline에서 revision delta와 explicit resync 구현
- player chunk 경계 이동 시 interest update 뒤 새 5청크를 entity delta보다 먼저 전송
- entity revision/snapshot/delta와 1초 heartbeat를 전체 tile state와 분리
- 같은 baseline의 same-chunk 구독자에게 동일 delta publication 구현
- 512KiB outbound buffer 초과 slow client를 WebSocket 1013으로 정리
- V2 일반 이동 packet의 tile matrix 0건과 V1 `welcome/state` 호환 확인
- server test 26/26, root client test 2/2, 임시 V1/V2 실제 WebSocket smoke 통과
- lint는 기존 client/D1 오류 3건과 경고 1건만 유지
- V2 client World Store와 camera/render 전환은 계획대로 5단계에 유지

---

## 5단계 — Client World Store와 부드러운 viewport

### 목적

넓게 preload된 fixed world 위에서 local player를 중앙에 두고 camera만 연속적으로
움직이며, terrain을 이동마다 다시 그리지 않는다.

### 작업 내용

- Protocol V2 type, socket과 reconnect 분리
- chunk/entity/revision World Store
- input, Audio와 Camera Runtime 분리
- Terrain/Entity/Local Player/HUD layer 분리
- 절대 world coordinate 기반 고정 floor pattern
- `translate3d` rAF camera와 entity target interpolation
- key release 뒤 마지막 승인 칸까지 animation 완료
- stale bounce/center-relative shadow와 사용하지 않는 animation 제거
- V2 전환 뒤 `app/page.tsx`를 composition/shell로 축소

### 위험

- React subscription이 전체 terrain을 다시 렌더링
- server ack보다 prediction이 앞서 rubber-banding
- percentage grid와 transform rounding으로 한 칸 경계 끊김
- reconnect cache와 다른 world ID 혼합
- mobile pointer cancel에서 이동 timer 잔존

### 자동/정적 검증

- World Store snapshot/delta/revision tests
- changed chunk selector만 notification
- camera interpolation의 monotonic frame와 final tile alignment
- key/pointer/blur/unmount cleanup
- stale correction/reconnect cache tests
- lint, build, 기존 SSR test와 `git diff --check`

### Browser QA

- 한 창에서 연속 이동과 key release 최종 칸
- 타일 pattern/terrain이 왕복 이동 뒤 동일
- 경계 접근 때 빈 화면 없이 preload
- 두 창에서 같은 crate, bomb, explosion과 player 위치
- terrain render counter가 이동 중 증가하지 않음
- desktop keyboard와 mobile-size pointer controls

### 완료 조건

- page가 socket/store/camera/audio 내부 구현을 소유하지 않음
- 이동 중 terrain DOM 재생성 0
- frame 간 시각적 한 칸 jump 없음
- server authoritative integer target에 정확히 정렬
- V2 client gameplay Preserve
- R5 독립 rollback 가능

### 결과

- 공개 web client를 Oracle `/boom-ws?protocol=2`와 `boom-v2` subprotocol로 전환
- V2 hello/join/init/25청크/entity snapshot/ready와 clientSeq ack/correction 연결
- World Store에 chunk/entity/revision cache, stale 폐기와 chunk gap resync 구현
- reconnect world identity 비교와 initial authoritative snapshot revision 재검증
- 25개 fixed chunk DOM을 preload하고 board overflow에서 15×11만 crop
- chunk-key selector로 movement/entity/tick/BGM update의 Terrain 재생성 차단
- 절대 world coordinate floor pattern과 wall/crate 동적 음영·과거 bounce 제거
- local player 중앙 anchor, world root rAF `translate3d` camera 구현
- local camera는 one-cell prediction + 175ms linear retarget, remote entity는 135ms 보간
- keyboard/pointer hold, keyup/pointercancel/blur/unmount cleanup과 즉시 bomb intent 구현
- nickname/death/reconnect, AI/bomb/item, enemy arrow와 BGM/volume UI 보존
- `app/page.tsx`를 46줄 composition shell로 축소
- client build/test 14/14, server regression 27/27, 새 파일 lint 오류/경고 0
- 새 GameSocket+WorldStore의 임시 V2 server 25청크/join/input ack 연동 smoke 통과
- 실제 브라우저 두 창/모바일에서 즉시 camera 이동과 terrain revision 고정을 확인

---

## 6단계 — 구형 경로 정리, 전체 검증과 배포

### 목적

새 구조를 유일한 제품 경로로 만들고 로컬·Oracle·공개 웹에서 같은 결과를
확인한다.

### 작업 내용

- V1 traffic 0 확인 뒤 V1 serializer/state shape 제거
- `stateFor(viewer)`, viewer origin과 전체 tile broadcast 제거
- unused D1 world/match/rooms, schema/migration/binding의 caller와 공개 사용 재확인
- 승인된 unused path만 명시적 Manifest로 삭제
- stale `multiplayer.css`, starter README/auth example과 1초 동시이동 metadata 정리
- current source map과 recent task 동기화
- Oracle server 파일 배포, service restart와 nginx 유지/검증
- V2 공개 web 배포와 실제 2-client QA

### 위험

- 미확인 friend-room URL 삭제
- D1 binding 제거로 Sites build config 실패
- server/client 배포 순서 실패
- Oracle 128MB 제한에서 retained/pinned chunk 증가
- live rollback artifact 미확보

### 전체 검증

- server unit/integration/protocol/lifecycle tests
- client tests, lint, production build
- source/import/dead path audit와 `git diff --check`
- server config start, graceful shutdown와 `/health`
- nginx config syntax와 public WebSocket upgrade
- two-client + AI gameplay, bomb/death/item/crate respawn
- preload edge와 10분 이동 중 chunk/memory/traffic 관찰
- BGM drift, mute/volume과 reconnect

### 완료 조건

- current product path 하나: V2 client ↔ Oracle V2 Gateway ↔ World Owner
- viewer별 tile matrix 생성/전송 0
- unused legacy path와 D1 binding은 확인된 범위에서만 제거
- Oracle health 정상, 128MB 제한 내 bounded chunk state
- 공개 URL 두 창에서 shared-world QA 통과
- docs/20, 98, 99가 최종 코드와 일치
- R6A/R6B/R6C rollback 경로 확인

### 6A 결과

- source/import/fetch caller를 재감사해 D1 world/match/rooms route, `db/`, `drizzle/`,
  `examples/d1/`, Drizzle dependency/script와 Sites `DB` binding을 제거
- caller 없는 `multiplayer.css`, `chatgpt-auth.ts`, 중복 starter `README 2.md`와 SVG
  3개를 제거하고 제품 BGM/favicon/OG asset은 보존
- `.openai/hosting.json`의 기존 `project_id`를 그대로 유지하고 Sites worker/build에서
  D1 migration packaging만 제거
- README와 layout metadata를 V2 실시간 공유 월드 기준으로 갱신
- `/health`에 protocol별 connection, active/pinned/retained chunk, entity, outbound,
  backpressure, scheduler와 RSS/heap/external byte metric을 추가
- V1 server adapter는 Oracle server-first 배포와 공개 client rollback을 위해 유지
- root lint/TypeScript/build/client 10/10, server 27/27와 diff/dead caller 검증 통과

6A는 로컬 cleanup/readiness까지만 완료했다. Oracle 또는 Sites 배포, 공개 브라우저
QA와 V1 제거는 6B에 남긴다.

### 6B production soak와 V1 제거 결과

- Sites v40과 dual-protocol Oracle server에서 10분 production soak PASS
- RSS `85.6 → 87.3MB`, materialized chunk `59 → 62`, 종료 event-loop lag 4ms
- 전 구간 `protocolV1=0`, backpressure disconnect 0을 확인
- `protocol-v1.mjs`와 serializer test, Gateway의 V1 message/publication/session 분기 제거
- 명시적 `?protocol=2` 또는 `boom-v2`만 수용하고 unversioned/Protocol 1은 player를
  만들기 전에 426으로 거절
- `hello.supportedProtocols=[2]`, health supported `[2]`와 unsupported reject metric 구현
- health의 `protocolV1:0`, `protocols.v1:0`은 모니터링 전환용 tombstone으로 유지
- 로컬 server regression 26건 기준으로 V2 init/delta/sequence와 무누수 거절 검증

V2-only source는 GitHub와 Oracle에 배포했다. Oracle의 직전 dual-protocol server는
`/home/ubuntu/boomnboom-server.backup-20260815-dual-v1-v2`로 보존했다. 공개 nginx
경로에서 V2 25청크/init/input ack, unversioned 426, reject metric과 브라우저
재연결·즉시 이동을 다시 확인했다. 공개 web client는 Sites v41이다.

## 7단계 — File Responsibility Cleanup

### 목적

한 파일의 주된 변경 이유를 하나로 제한하고 파일명만 보고 역할을 예측할 수 있게
한다. Protocol V2, gameplay, UI 결과와 배포 설정 값은 바꾸지 않는다.

### 변경 Manifest

- server entry에서 config, timeline, scheduler, health와 composition lifecycle 분리
- Gateway에서 backpressure, session, interest, entity projection과 publication 분리
- `spawn.mjs`를 실제 역할에 맞는 `spawn-finder.mjs`로 변경
- client Store에서 state shape, message apply와 selector 분리
- 공통 위치 보간을 Camera Runtime에서 분리
- Entity Layer에서 적 방향 표시와 local bomb selector 분리
- Header/Tick HUD/Legend, Join/Death Overlay와 Player Status를 독립 UI 파일로 분리
- hosting metadata plugin, nginx virtual-host config와 test 이름을 실제 책임에 맞춤
- 과거 사용자 파일 `docs/99_recent_task 2.md`는 범위 밖으로 보존

### Preserve 계약

- V2 init/25청크/ready, sequence ack, interest와 chunk/entity delta shape
- 140ms 이동, 500ms AI, 1초 world tick과 BGM timeline
- nickname/respawn/폭탄/item/crate warning과 shared World Owner 결과
- public Sites project ID, Oracle port/service/nginx route와 128MB 제한

### 결과

- 500줄 이상 code file 0건
- `server/index.mjs`는 `startServer()` 호출만 담당
- `websocket-gateway.mjs` 522줄에서 223줄, `world-store.ts` 432줄에서 84줄로 축소
- 새 production module과 test가 담당 대상 이름을 직접 드러냄
- server 26건과 client unit/contract/SSR 검증에서 기존 제품 계약 유지

## Sprint 전체 완료 기준

- 같은 world coordinate가 모든 client에서 같은 tile/chunk revision
- player가 움직여도 tile matrix packet과 terrain rerender가 없음
- viewport보다 넓은 chunk preload와 경계 전환 지연 없음
- authoritative 위치는 integer tile, visual camera는 연속 transform
- bomb/폭발/피해/item/warning/respawn 결과가 두 client에서 동일
- World Owner 밖 canonical mutation 0
- stale/duplicate/gap packet이 divergence를 만들지 않음
- cold chunk 수와 outbound traffic이 명시된 상한 정책을 따름
- 자동 검사와 실제 공개 2-client QA가 모두 통과

## 작업 운영

- 루트 에이전트가 각 단계 시작 전 이전 단계 diff와 test를 검토한다.
- 단계 결과가 계약을 만족하지 않으면 다음 단계로 넘어가지 않고 같은 rollback
  단위 안에서 수정·재검증한다.
- 서브에이전트는 할당된 단계만 변경하고 deploy, Sprint 완료와 legacy 삭제 여부를
  결정하지 않는다.
- 각 단계 뒤 `docs/20_src_map.md`를 실제 코드에 맞게 갱신한다.
- `docs/99_recent_task.md`는 루트 에이전트가 멈추는 시점의 최근 Task만 기록한다.

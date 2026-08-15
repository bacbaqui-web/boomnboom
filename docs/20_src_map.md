# Source Map

> 현재 production 기준: Sites client 기본값은 Protocol V3이며 `?protocol=2`가
> V2 rollback이다. Oracle server는 V2/V3를 명시적으로 병행한다.
>
> 영구 목표 설계는 `docs/architecture/10_world_architecture.md`부터
> `docs/architecture/14_persistence_lifecycle_architecture.md`까지를 따른다.
> 이 문서는 현재 실제 파일과 책임을 설명한다. 목표와 다른 부분은
> `docs/98_sprint_plan.md`에서 단계적으로 해소한다.

## 1. 현재 실행 흐름

```text
Browser
  → app/page.tsx
      → Game Controller
          → Game Socket `?protocol=3` / Client World Store
      → wss://insight.magamiscom.ing/boom-ws
          → nginx /boom-ws
          → Oracle 127.0.0.1:3300
          → server/index.mjs → src/main.mjs
              → Simulation Scheduler의 world/AI timer
              → WebSocket Gateway의 V2/V3 connection/message routing
              → World Publisher의 interest/snapshot/delta publication
              → Game Simulation command
              → World Owner mutation/read
              → V3: 30Hz fixed simulation / 15Hz entity snapshot
              → V2 rollback: chunk/entity/enemy delta
      ← authoritative snapshots, deltas와 world events
      → chunk cache에서 15×11 crop + rAF camera/entity transform
```

공개 page는 D1 게임 API를 호출하지 않는다. 현재 실시간 제품 경로는
`app/page.tsx`와 `server/index.mjs` 사이 WebSocket 하나다.

## 1.1 Protocol V3 공용 이동 코어

- `shared/net-tick.mjs`: uint32 wrap-safe tick 비교와 target lead window 분류
- `shared/movement-config.mjs`: fixed unit, 속도, 가속/감속, 충돌 반경과 turn grace
- `shared/movement-step.mjs`: plain `isBlockedCell` reader를 받는 순수 1-tick 이동·충돌 계산
- `tests/fixtures/movement-golden-fixture.mjs`: client/server 공용 결정적 tick fixture

server fixed movement와 client local predictor가 이 코어를 함께 사용한다. canonical
state는 server만 commit하고 client는 prediction/replay에만 같은 수식을 사용한다.

## 2. 웹 클라이언트 — `app/`

### `app/page.tsx`

- `useGameController` 결과를 화면 component에 전달하는 52줄 composition shell
- protocol parse, socket, cache, timer, Audio와 rAF 구현을 소유하지 않음

### `app/game/protocol.ts`, `protocol-v3.ts`, `network-protocol.ts`, `game-socket.ts`

- V2 message/entity type, envelope validation과 Oracle `?protocol=2` URL
- hello/join/init/25청크/entity snapshot/ready 순서와 clientSeq command
- ack/correction, chunk gap resync, disconnect 뒤 1.5초 reconnect
- reconnect world metadata와 initial authoritative revision을 Store에서 재검증
- 기본 V3 join/baseline/ready/ping/input/resume, `?protocol=2` V2 rollback 병행

### Client World Store

- `world-state.ts`: world clock/metadata, chunk/entity cache의 Runtime state shape
- `world-message-applier.ts`: snapshot/delta/stale/gap/reconnect message 적용
- `world-selectors.ts`: 진입 가능한 cell과 known chunk revision 조회
- `world-store.ts`: global/entity/chunk-key external-store subscription façade
- chunk delta는 해당 chunk listener만 깨우고 movement/tick은 terrain input을 바꾸지 않음

### Runtime과 Controller

- `movement-prediction.ts`: pending input을 한 칸 앞 visual target으로 제한하고 ack/session에 수렴
- `position-interpolator.ts`: camera와 remote player가 공유하는 시간 기반 위치 보간
- `camera-runtime.ts`: visual world position을 중앙 camera transform으로 투영
- `player-animation.ts`: 대기 500ms와 이동 10px jump의 pose·duration 계약
- `input-runtime.ts`, `use-game-input.ts`: keyboard/pointer 145ms hold, stop/bomb와 cleanup
- `audio-runtime.ts`: BGM Audio, server clock seek/drift와 4단계 volume
- `use-game-controller.ts`: Store/Socket/Input/Audio와 nickname/respawn UI state 조립
- `clock-sync.ts`: V3 server tick, RTT/jitter와 bounded future command lead
- `input-sampler.ts`: V3 key state 변경을 repeat timer 없이 즉시 direction state로 변환
- `command-timeline.ts`: 전송 성공한 V3 command sequence와 bounded pending queue
- `local-movement-predictor.ts`: shared movement fixed tick, owner restore와 pending replay
- `correction-smoother.ts`: simulation과 분리된 render-only offset 감쇠/snap
- `protocol-v3.ts`: V3 client envelope parse, fixed entity projection과 typed command
- `remote-snapshot-buffer.ts`: 원격 player별 bounded absolute history, 보간/외삽/freeze
- `pending-bomb-presenter.ts`: V3 bomb pending/result/authoritative snapshot race 표시
- `explosion-event-presenter.ts`: exact explosion event의 late fast-forward와 flame dedupe

### Render와 UI

- `TerrainLayer.tsx`: 25청크 fixed DOM, chunk revision selector와 절대좌표 floor pattern
- `EntityLayer.tsx`: remote player rAF 보간과 bomb/item/flame 렌더링
- V3 remote player는 snapshot buffer를, V2 remote player는 기존 latest-target 보간을 사용
- `PlayerAvatar.tsx`: player body, nickname, shield와 local action cue 렌더링
- `EnemyPointers.tsx`, `entity-selectors.ts`: 화면 밖 적 방향과 local bomb 조회
- `WorldViewport.tsx`: 15×11 overflow crop, local player 중앙 anchor와 rAF `translate3d`
- `GameHeader.tsx`, `WorldTickHud.tsx`, `GameLegend.tsx`: 연결·박자·범례 UI
- `JoinOverlay.tsx`, `DeathOverlay.tsx`: 입장과 사망 후 재접속 UI
- `GameControls.tsx`, `PlayerStatus.tsx`: 조작 입력과 플레이어 상태 UI

### `app/globals.css`

- 전체 게임 shell, board, fixed chunk, entity, overlay와 control 스타일
- player 위치 anchor와 바닥 기준 idle squash body 스타일
- wall/crate box-shadow 0, absolute coordinate floor 교차 pattern
- player 위치 이동은 Runtime rAF, body jump/squash는 독립 animation으로 사용

### `app/layout.tsx`

- global CSS import와 실시간 공유 월드 metadata
- 현재 제품 설명과 `og-world.png` Open Graph/Twitter preview

## 3. Oracle 게임 서버

### `server/index.mjs`

- `src/main.mjs`의 `startServer()`만 호출하는 process entry

### Server Runtime

- `src/config.mjs`: 환경 변수와 고정 gameplay/runtime 설정 해석
- `src/world-timeline.mjs`: epoch와 tick 간 순수 wall-clock 변환
- `src/simulation-scheduler.mjs`: 1초 world timer와 500ms AI timer의 시작·정지
- `src/health-handler.mjs`: `/health` payload와 tick readiness 계산
- `src/main.mjs`: World Owner, Simulation, AI, Scheduler, Gateway와 HTTP lifecycle 조립
- `src/simulation/fixed-step-loop.mjs`: 30Hz scheduling과 bounded catch-up metric
- `src/simulation/player-command-buffer.mjs`: V3 sequence/target tick/queue 검증과 input state
- `src/simulation/player-movement-system.mjs`: shared core 실행과 World Owner commit

### `server/src/simulation/game-simulation.mjs`

- player/AI 생성, join, respawn과 disconnect command
- authoritative 140ms movement cadence와 collision
- bomb 설치/limit/fuse, item collect와 능력치
- world tick catch-up, 폭발 순간 damage, shield/death와 AI drop/respawn
- live flame 칸으로 이동할 때 같은 damage/shield 규칙 적용
- 폭발로 파괴된 crate를 floor로 확정하고 자동 재생성하지 않음
- 모든 canonical 변경을 World Owner 공개 command로 수행
- command 결과의 `accepted`, `changed`, `publish`를 session/timer에 반환
- legacy 1초 bomb/flame만 처리하고 V3 fixed clock entity는 건드리지 않음

### V3 fixed gameplay system

- `bomb-system.mjs`: fixed bomb placement, owner limit, 90-tick fuse와 action result
- `explosion-system.mjs`: exact blast/crate/current-AABB damage, AI drop·respawn와 event
- `player-respawn-system.mjs`: V3 lifeId/teleport, fixed motion과 pre-life queue reset
- `fixed-aabb.mjs`: player와 bomb/flame/item cell overlap 순수 판정
- `player-movement-system.mjs`: fixed movement commit, bomb pass-through 종료와 item 획득

### `server/src/simulation/explosion.mjs`

- wall과 crate에서 멈추는 blast cell 계산
- 겹친 폭발 cell의 순수 deduplication
- World Owner와 entity를 mutation하지 않음

### `server/src/ai/bot-controller.mjs`

- player/bomb/terrain read snapshot에서 nearest-human intent 결정
- 사람이 없으면 intent 배열 0건으로 즉시 종료
- canonical state를 변경하지 않고 Simulation과 같은 action 문자열만 반환

### `server/src/world/coordinates.mjs`

- 16×16 기준 floor division, positive modulo와 chunk/local 좌표 변환
- 음수 world coordinate도 `chunk * size + local`로 정확히 복원

### `server/src/world/chunk-generator.mjs`

- absolute coordinate, seed와 generator version 기반 deterministic terrain
- 기존 permanent wall 규칙 유지
- 이웃 좌표를 함께 평가해 특정 청크 경계에 빈 줄을 만들지 않는 crate 생성
- 청크 전체 plain tile payload 생성

### `server/src/world/world-owner.mjs`

- 16×16 canonical materialized chunk registry와 monotonic revision
- player, bomb, item, flame entity registry의 유일한 소유자
- tile rectangle, entity snapshot과 mutation command 제공
- player 주변 반경 2청크 materialize와 base-only cold chunk trim
- 외부에는 Map과 mutable canonical object를 반환하지 않음
- `commitPlayerMovement`: fixed-point state를 canonical player에 쓰고 V2 호환 정수 cell 파생

### `server/src/world/spawn-finder.mjs`

- 현재 terrain, player와 bomb read snapshot에서 안전한 floor 검색
- spawn 때문에 crate나 wall을 삭제하지 않음

### `server/src/network/protocol-v2.mjs`

- Protocol 2 client message parse/schema validation과 오류 code
- server envelope, chunk snapshot payload와 revision delta 계산
- movement/bomb/stop, sequence와 chunk resync message 계약

### `server/src/network/websocket-gateway.mjs`

- `?protocol=2|3` 또는 `boom-v2|boom-v3`를 명시한 session만 수용
- unversioned/Protocol 1 upgrade는 player를 만들기 전에 426으로 거절
- V2/V3 session Map 격리, connection lifecycle과 message routing 조립
- unsupported protocol upgrade reject와 network metric 조립
- V3 envelope에는 fixed `serverTick`과 별도 1초 `worldTick`을 함께 실어 BGM clock 유지

### Network helper

- `websocket-session.mjs`: session/interest/revision/ack Runtime state 생성과 ack 제한
- `chunk-interest.mjs`: player 중심 반경 2 chunk-key 집합 계산
- `entity-projector.mjs`: World entity의 network projection, grouping과 delta 계산
- `world-publisher.mjs`: init/interest/chunk/entity snapshot·delta와 heartbeat publication
- `protocol-v3.mjs`: V3 command schema와 server fixed-tick envelope
- `entity-snapshot-publisher.mjs`: 15Hz absolute owner/entity sample과 processed command ACK
- `chunk-publisher.mjs`: V3 baseline, revision resync/delta와 interest preload
- `connection-registry.mjs`: 10초 player lease, resume token rotation과 current session guard
- `v3-session-flow.mjs`: provisional-free join/resume/full baseline과 V3 rate/session lifecycle
- `backpressure-sender.mjs`: 512KiB 초과 connection 1013 종료와 byte/message metric

### 현재 지형 흐름

1. player 주변 청크를 World Owner가 최초 접근에서 materialize한다.
2. 이동·충돌·폭발은 World Owner의 canonical tile을 읽는다.
3. crate 파괴가 해당 chunk revision을 증가시키며 이후 자동 복구하지 않는다.
4. Gateway는 V2 구독자에게 changed chunk delta만 보내며 viewer별 tile matrix를
   만들지 않는다.

### 현재 gameplay 시간

- 이동 rate limit: 140ms
- V3 fixed movement: 30Hz, entity snapshot 15Hz
- AI interval: 500ms
- world tick: 기본 1000ms
- bomb fuse: 3 tick
- crate respawn: 없음
- BGM/world epoch: 환경 변수 또는 2026-08-14 UTC 기준값

## 4. Protocol V2 server

V2는 `/boom-ws?protocol=2` 또는 `boom-v2` WebSocket subprotocol로 선택한다.
unversioned, `?protocol=1`과 다른 version은 426으로 거절한다.

### Client → Server

- `join`, `ready { knownChunkRevisions }`
- `input { clientSeq, action }`, `respawn { clientSeq }`
- `chunk_resync { chunkKey, revision }`, `ping`

### Server → Client

- `hello`, `world_init`
- initial/interest/resync `chunk_snapshot`, mutation `chunk_delta`
- `entity_snapshot`, `entity_delta`
- `input_ack { ackClientSeq, correction }`, `interest_update`
- `world_heartbeat`, `pong`, protocol-safe `error`

V2 일반 이동 packet에는 tile matrix가 없고, 청크 snapshot은 초기 preload·interest
진입·revision 복구에서만 사용한다. web client는 World Store에서 revision을 확인하고
`enemy_summary`의 화면 밖 player projection으로 기존 방향 화살표를 유지한다.

## 4.1 Protocol V3 server

V3는 `/boom-ws?protocol=3` 또는 `boom-v3`로 명시한다. join 뒤 같은 baseline tick의
world init, 반경 2 청크, owner/entity snapshot을 받고 ready 이후 future-tick
`input_state`와 `action_command`를 보낸다. server는 30Hz에서 command를 소비하고
2 tick마다 absolute owner/entity snapshot을 보낸다. bomb/respawn, exact-tick 폭발,
현재 위치 피해, item과 shield 판정은 server authority로 처리한다. 연결이 끊기면
10초 lease 안에서 회전형 memory-only token으로 같은 player를 resume한다.

## 5. 제거한 구형 경로

source/import/fetch caller 0건을 재확인한 뒤 R6A rollback 단위로 다음을 제거했다.

- `app/api/world`, `app/api/match`, `app/api/rooms` D1 game routes
- `db/`, `drizzle/`, `drizzle.config.ts`, `examples/d1/`
- `drizzle-orm`, `drizzle-kit`, `db:generate`와 Sites `DB` binding
- unused `app/multiplayer.css`, `app/chatgpt-auth.ts`
- caller 없는 starter `README 2.md`, `public/file.svg`, `public/globe.svg`,
  `public/window.svg`

6B production soak에서 10분간 V1 traffic 0을 확인한 뒤
`server/src/network/protocol-v1.mjs`, V1 Gateway 분기와 viewer별 전체 state
serializer를 제거했다.

## 6. Sites/Cloudflare 빌드와 배포

- `package.json`: vinext dev/build/start, lint, build 기반 test
- `vite.config.ts`: vinext, Sites packaging과 Cloudflare worker 구성
- `worker/index.ts`: vinext request handler와 image optimization
- `build/hosting-metadata-plugin.ts`: hosting metadata만 `dist/.openai`에 복사
- `.openai/hosting.json`: 기존 Sites `project_id`와 R2 설정만 보존, D1 binding 없음
- `vite.config.ts`, `worker/index.ts`: D1 없는 Sites worker와 optional R2 구성
- `next.config.ts`, `postcss.config.mjs`: Next/Tailwind 설정
- `public/`: BGM, favicon과 Open Graph 이미지
- `docs/index.html`: GitHub Pages에서 공개 Sites URL로 redirect

`README.md`는 V3 기본/V2 rollback 공유 월드 구조, 로컬 검증과 server-first 배포 순서를 설명하며
제거된 D1/starter/auth 안내를 포함하지 않는다.

## 7. Oracle 운영 파일

- `server/package.json`: `ws` dependency와 Node start/test script
- `server/boomnboom.service`: `/home/ubuntu/boomnboom-server/index.mjs`, port 3300,
  128MB memory limit
- `server/insight-magamiscom-ing.nginx`: 해당 host의 `/boom-ws`와 `/boom-health`
  proxy

`server/package.json`의 test script는 `server/test/*.test.mjs`를 실행한다.

## 8. 현재 검증

- `tests/rendered-html.test.mjs`, `client-composition.test.mjs`: SSR shell과 client 조립 계약
- `tests/world-store.test.mjs`: snapshot/delta/gap/stale, chunk notification과 reconnect
- `tests/world-selectors.test.mjs`: terrain/entity 기반 client cell 진입 조회
- `tests/position-interpolator.test.mjs`, `camera-runtime.test.mjs`: 위치 보간과 camera transform
- `tests/player-animation.test.mjs`: 바닥 기준 idle scale, 이동 scale과 10px jump pose
- `tests/movement-prediction.test.mjs`: 즉시 target, ack, 연속 입력, reject와 session reset 5건
- `tests/game-socket.test.mjs`: 닫힌 socket 전송 실패 sequence가 prediction에 안 들어가는지 검증
- `tests/movement-step.test.mjs`, `server/test/movement-step.test.mjs`: shared fixed-point
  movement의 client/server golden 결과, sweep, 음수 좌표와 tick wrap 계약
- `tests/clock-sync`, `command-timeline`, `local-movement-predictor`,
  `correction-smoother`, `game-socket-v3`, `v3-network-harness`: V3 local prediction,
  replay/reset과 200/300ms RTT·jitter 계약
- `tests/remote-snapshot-buffer.test.mjs`: 15Hz→60/120Hz 일정 속도, stale/drop/stall,
  100ms 외삽 상한, lifecycle snap과 terrain selector 격리
- `tests/pending-bomb-presenter`, `explosion-event-presenter`: result/snapshot race와
  event expiry/late fast-forward/authoritative flame dedupe
- `server/test/bomb-system`, `explosion-system`, `websocket-gateway-v3`: fixed bomb 규칙,
  current-position damage와 실제 two-client 결과 일치
- `server/test/connection-registry`, `websocket-gateway-resume`: token rotation, lease expiry,
  late join, 실제 1013→resume와 identity-free metrics
- `tests/input-runtime.test.mjs`: movement hold/stop/bomb/unmount cleanup 2건
- `server/test/coordinates.test.mjs`, `chunk-generator.test.mjs`: 음수 좌표와 결정적 경계 생성
- `server/test/world-owner.test.mjs`, `spawn-finder.test.mjs`: canonical revision/metric과 spawn non-mutation
- `server/test/game-simulation.test.mjs`: 이동 cadence/collision/item, 폭탄,
  폭발 순간·live flame 접촉 damage, shield/death/AI drop·respawn, 영구 crate
  파괴와 tick catch-up
- `server/test/bot-controller.test.mjs`: no-human idle, read snapshot intent와 shared
  Simulation command
- `server/test/protocol-v2.test.mjs`, `backpressure-sender.test.mjs`: protocol과 전송 제한
- `server/test/websocket-gateway.test.mjs`: 25청크 init 순서, 이동 tiles 0,
  sequence idempotency, shared delta/resync, interest, V2 query/subprotocol과 구형
  upgrade 무누수 거절
- browser 2-client shared-world, 모바일 viewport, prediction/terrain revision과 공개 재연결 QA PASS

## 9. Architecture와 현재 차이

| 목표 책임 | 현재 상태 |
|---|---|
| 단일 World Owner | 16×16 chunk/entity registry 구현 완료 |
| materialized shared chunk | absolute-coordinate generator와 revision 구현 완료 |
| chunk revision/snapshot/delta | V2 server/client delta/resync 구현, viewer tile matrix 제거 |
| server simulation boundary | gameplay/tick은 Simulation, AI는 read-only Controller로 분리 완료 |
| Protocol V3 prediction/authority | 기본 V3와 V2 rollback client 공개 배포 완료 |
| client chunk/entity store | revision 검증 external Store 구현 완료 |
| terrain/entity/camera layer | fixed chunk / entity / rAF camera로 분리 완료 |
| bounded lifecycle metrics | base-only cold trim, health count와 production 10분 soak PASS |
| behavior regression tests | server 63건 + root build/client 65건 검증 |

7단계 배포와 10분 운영 관찰을 완료했다. V2는 첫 V3 release의 즉시 rollback을 위해
유지하며, 더 긴 live traffic 관찰 뒤 별도 cleanup Sprint에서 제거 여부를 판단한다.

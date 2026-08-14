# Source Map

> 현재 기준: 공개 client는 V2, Oracle server는 전환 rollback용 V1/V2 동시 수용
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
          → Game Socket `?protocol=2` / Client World Store
      → wss://insight.magamiscom.ing/boom-ws
          → nginx /boom-ws
          → Oracle 127.0.0.1:3300
          → server/index.mjs
              → world timer / AI timer / composition
              → WebSocket Gateway의 V1/V2 session
              → Game Simulation command
              → World Owner mutation/read
              → V2: 25 chunk preload 뒤 chunk/entity/enemy delta
      ← V2 snapshots와 deltas
      → chunk cache에서 15×11 crop + rAF camera/entity transform
```

공개 page는 D1 게임 API를 호출하지 않는다. 현재 실시간 제품 경로는
`app/page.tsx`와 `server/index.mjs` 사이 WebSocket 하나다.

## 2. 웹 클라이언트 — `app/`

### `app/page.tsx`

- `useGameController` 결과를 화면 component에 전달하는 46줄 composition shell
- protocol parse, socket, cache, timer, Audio와 rAF 구현을 소유하지 않음

### `app/game/protocol.ts`, `game-socket.ts`

- V2 message/entity type, envelope validation과 Oracle `?protocol=2` URL
- hello/join/init/25청크/entity snapshot/ready 순서와 clientSeq command
- ack/correction, chunk gap resync, disconnect 뒤 1.5초 reconnect
- reconnect world metadata와 initial authoritative revision을 Store에서 재검증

### `app/game/world-store.ts`

- world clock/metadata, `chunkKey → revision/tiles/respawns`, entity와 enemy cache
- stale chunk/entity/ack 폐기와 fromRevision gap result
- world identity가 다르면 cache 폐기, 같은 world도 reconnect initial snapshot으로 검증
- global, entity와 chunk-key별 external-store subscription
- chunk delta는 해당 chunk listener만 깨우고 movement/tick은 terrain input을 바꾸지 않음

### Runtime과 Controller

- `movement-prediction.ts`: pending input을 한 칸 앞 visual target으로 제한하고 ack/session에 수렴
- `camera-runtime.ts`: current visual에서 새 integer target으로 175ms linear retarget, respawn snap
- `input-runtime.ts`, `use-game-input.ts`: keyboard/pointer 145ms hold, stop/bomb와 cleanup
- `audio-runtime.ts`: BGM Audio, server clock seek/drift와 4단계 volume
- `use-game-controller.ts`: Store/Socket/Input/Audio와 nickname/respawn UI state 조립

### Render와 UI

- `TerrainLayer.tsx`: 25청크 fixed DOM, chunk revision selector와 절대좌표 floor pattern
- `EntityLayer.tsx`: remote player rAF 보간, bomb/item/flame와 enemy arrow
- `WorldViewport.tsx`: 15×11 overflow crop, local player 중앙 anchor와 rAF `translate3d`
- `GameHud.tsx`, `GameOverlay.tsx`, `GameControls.tsx`: HUD/입장·사망/조작 UI

### `app/globals.css`

- 전체 게임 shell, board, fixed chunk, entity, overlay와 control 스타일
- player bounce/world slide와 center-relative wall shadow 제거
- wall/crate box-shadow 0, absolute coordinate floor 교차 pattern
- player 이동 transform은 CSS animation이 아니라 Runtime rAF만 사용

### `app/layout.tsx`

- global CSS import와 실시간 공유 월드 V2 metadata
- 현재 제품 설명과 `og-world.png` Open Graph/Twitter preview

## 3. Oracle 게임 서버

### `server/index.mjs`

- config와 world/BGM clock 계산
- World Owner, Simulation, AI Controller, V1 serializer와 Gateway 조립
- 1초 world timer와 500ms AI timer
- HTTP `/health`, timer publication과 shutdown
- health에 V1/V2 connection, chunk/entity, network, scheduler와 process memory를 노출

socket session, schema와 interest는 소유하지 않고 게임 규칙과 canonical mutation도
소유하지 않는다.

### `server/src/simulation/game-simulation.mjs`

- player/AI 생성, join, respawn과 disconnect command
- V1 호환 140ms movement cadence와 collision
- bomb 설치/limit/fuse, item collect와 능력치
- world tick catch-up, 폭발 순간 damage, shield/death와 AI drop/respawn
- player 9×9 warning commit 연기, committed warning 유지와 bomb 칸 respawn 연기
- 모든 canonical 변경을 World Owner 공개 command로 수행
- command 결과의 `accepted`, `changed`, `publish`를 session/timer에 반환

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
- respawn schedule을 청크 cell state로 소유
- tile rectangle, entity snapshot과 mutation command 제공
- player 주변 반경 2청크 materialize와 base-only cold chunk trim
- 외부에는 Map과 mutable canonical object를 반환하지 않음

### `server/src/world/spawn.mjs`

- 현재 terrain, player와 bomb read snapshot에서 안전한 floor 검색
- spawn 때문에 crate나 wall을 삭제하지 않음

### `server/src/network/protocol-v1.mjs`

- 전환 기간의 기존 `welcome/state` shape serializer
- viewer camera origin은 adapter Runtime에만 저장
- 23×19 tile matrix를 procedural generator가 아니라 World Owner read model에서 조립
- disconnect에서 viewer Runtime 제거

### `server/src/network/protocol-v2.mjs`

- Protocol 2 client message parse/schema validation과 오류 code
- server envelope, chunk snapshot payload와 revision delta 계산
- movement/bomb/stop, sequence와 chunk resync message 계약

### `server/src/network/websocket-gateway.mjs`

- query/subprotocol negotiation으로 V1/V2 session을 동시에 수용
- V2 `hello → world_init → 25 chunk_snapshot → entity_snapshot → ready` 순서
- clientSeq ack cache, stale/duplicate idempotency와 authoritative correction
- player 중심 반경 2 interest, 경계 이동 전 snapshot preload와 entity projection
- session별 chunk baseline에서 `fromRevision → revision` delta/resync
- entity revision/snapshot/delta, V1 compatibility publication과 heartbeat
- 512KiB bufferedAmount 초과 connection을 1013으로 정리
- outbound message/byte, subscription과 backpressure disconnect 누적 metric 소유

### 현재 지형 흐름

1. player 주변 청크를 World Owner가 최초 접근에서 materialize한다.
2. 이동·충돌·폭발은 World Owner의 canonical tile을 읽는다.
3. crate 파괴와 respawn이 해당 chunk revision을 증가시킨다.
4. V1 adapter가 canonical chunk read로 23×19 호환 matrix를 만든다.
5. Gateway는 V2 구독자에게 changed chunk delta만, V1 client에는 호환 전체 state를
   보낸다.

### 현재 gameplay 시간

- 이동 rate limit: 140ms
- AI interval: 500ms
- world tick: 기본 1000ms
- bomb fuse: 3 tick
- crate respawn: 8 tick, 마지막 2 tick warning
- BGM/world epoch: 환경 변수 또는 2026-08-14 UTC 기준값

## 4. Protocol V1

### Client → Server

- `join { nickname }`
- `respawn`
- `action { action: up|down|left|right|bomb|wait }`

sequence, schema version과 ack가 없다.

### Server → Client

- `welcome { id, tickMs }`
- `state`
  - world/BGM clock
  - viewer `originX/Y`, world/local camera 값
  - 23×19 tile matrix
  - visible players, bombs, items와 flames
  - offscreen enemy direction summary

V1 일반 이동, wait와 bomb 설치는 Gateway 호환 publication을 통해 모든 V1
접속자의 전체 state를 다시 생성한다.

## 5. Protocol V2 server

V2는 `/boom-ws?protocol=2` 또는 `boom-v2` WebSocket subprotocol로 선택한다. query와
subprotocol이 없으면 공개 client 호환을 위해 V1이다.

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

## 6. 6A에서 제거한 구형 경로

source/import/fetch caller 0건을 재확인한 뒤 R6A rollback 단위로 다음을 제거했다.

- `app/api/world`, `app/api/match`, `app/api/rooms` D1 game routes
- `db/`, `drizzle/`, `drizzle.config.ts`, `examples/d1/`
- `drizzle-orm`, `drizzle-kit`, `db:generate`와 Sites `DB` binding
- unused `app/multiplayer.css`, `app/chatgpt-auth.ts`
- caller 없는 starter `README 2.md`, `public/file.svg`, `public/globe.svg`,
  `public/window.svg`

`server/src/network/protocol-v1.mjs`와 V1 Gateway 분기는 첫 Oracle server 배포에서
기존 공개 client rollback을 허용하기 위해 아직 유지한다. V2 client 배포 후
`/health`의 V1 traffic 0을 관찰한 다음 제거한다.

## 7. Sites/Cloudflare 빌드와 배포

- `package.json`: vinext dev/build/start, lint, build 기반 test
- `vite.config.ts`: vinext, Sites packaging과 Cloudflare worker 구성
- `worker/index.ts`: vinext request handler와 image optimization
- `build/sites-vite-plugin.ts`: hosting metadata만 `dist/.openai`에 복사
- `.openai/hosting.json`: 기존 Sites `project_id`와 R2 설정만 보존, D1 binding 없음
- `vite.config.ts`, `worker/index.ts`: D1 없는 Sites worker와 optional R2 구성
- `next.config.ts`, `postcss.config.mjs`: Next/Tailwind 설정
- `public/`: BGM, favicon과 Open Graph 이미지
- `docs/index.html`: GitHub Pages에서 공개 Sites URL로 redirect

`README.md`는 V2 공유 월드 구조, 로컬 검증과 server-first 배포 순서를 설명하며
제거된 D1/starter/auth 안내를 포함하지 않는다.

## 8. Oracle 운영 파일

- `server/package.json`: `ws` dependency와 Node start/test script
- `server/boomnboom.service`: `/home/ubuntu/boomnboom-server/index.mjs`, port 3300,
  128MB memory limit
- `server/insight-widget.nginx`: `/boom-ws` WebSocket proxy와 `/boom-health` health
  proxy

`server/package.json`의 test script는 `server/test/*.test.mjs`를 실행한다.

## 9. 현재 검증

- `tests/rendered-html.test.mjs`: production worker SSR shell과 V2 composition/runtime
  source contract 2건
- `tests/world-store.test.mjs`: snapshot/delta/gap/stale, chunk selector와 reconnect 4건
- `tests/camera-runtime.test.mjs`: linear monotonic/final target와 retarget/teleport 2건
- `tests/movement-prediction.test.mjs`: 즉시 target, ack, 연속 입력, reject와 session reset 5건
- `tests/game-socket.test.mjs`: 닫힌 socket 전송 실패 sequence가 prediction에 안 들어가는지 검증
- `tests/input-runtime.test.mjs`: movement hold/stop/bomb/unmount cleanup 2건
- `server/test/world-core.test.mjs`: 음수 좌표, 결정성, 청크 경계, materialize once,
  shared revision과 spawn non-mutation
- `server/test/protocol-v1.test.mjs`: 기존 V1 state key와 23×19 payload shape
- `server/test/game-simulation.test.mjs`: 이동 cadence/collision/item, 폭탄,
  폭발 순간 damage, shield/death/AI drop·respawn, warning/respawn과 tick catch-up
- `server/test/bot-controller.test.mjs`: no-human idle, read snapshot intent와 shared
  Simulation command
- `server/test/protocol-v2.test.mjs`: schema/malformed/version, chunk delta와
  bufferedAmount backpressure
- `server/test/websocket-gateway.test.mjs`: 25청크 init 순서, 이동 tiles 0,
  sequence idempotency, shared delta/resync, interest와 V1/V2 실제 socket 호환
- browser 2-client shared-world 자동 검증 없음

## 10. Architecture와 현재 차이

| 목표 책임 | 현재 상태 |
|---|---|
| 단일 World Owner | 16×16 chunk/entity/respawn registry 구현 완료 |
| materialized shared chunk | absolute-coordinate generator와 revision 구현 완료 |
| chunk revision/snapshot/delta | V2 server/client delta/resync 구현, V1은 rollback adapter로 유지 |
| server simulation boundary | gameplay/tick은 Simulation, AI는 read-only Controller로 분리 완료 |
| Protocol V2 sequence/ack | 공개 client V2 init/ready/seq/ack/correction 연결 완료 |
| client chunk/entity store | revision 검증 external Store 구현 완료 |
| terrain/entity/camera layer | fixed chunk / entity / rAF camera로 분리 완료 |
| bounded lifecycle metrics | base-only cold trim과 chunk health count, 장기 관찰 미실행 |
| behavior regression tests | server 27건 + client/store/socket/camera/input/prediction/SSR 17건 |

이 차이는 `docs/98_sprint_plan.md`의 6단계에서 순차적으로 해소한다.

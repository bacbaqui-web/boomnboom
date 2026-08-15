# Protocol V3 Predictive Movement Sprint

## 상태

- Sprint 완료
- 1단계 Shared Movement Core: PASS
- 2단계 V3 Server Fixed Simulation: PASS
- 3단계 V3 Local Prediction: PASS
- 4단계 Remote Snapshot Interpolation: PASS
- 5단계 Bomb/Explosion V3: PASS
- 6단계 Resume/Late Join/Hardening: PASS
- 7단계 배포·관찰·Cleanup 결정: PASS
- 현재 source: 기본 Protocol V3, `?protocol=2` rollback
- 현재 production: 기본 Protocol V3, `?protocol=2` rollback
- 목표: 30Hz fixed-point movement, owner prediction/replay, remote interpolation

## 1. Sprint 목적

200~300ms RTT와 50ms jitter에서도 local player가 즉시 반응하고 remote player가
일정한 속도로 보이게 만든다. server는 movement, bomb, collision, damage와 item의
최종 권한을 유지한다.

이 Sprint는 generic netcode engine을 만들지 않는다. BOOMnBOOM에 필요한 shared
movement, command scheduling, owner replay, remote interpolation, bomb result와
reconnect만 구현한다.

## 2. 현재 기준선

- server movement: message 도착 시 140ms rate limit, 정수 인접 한 칸
- client input: 145ms interval command
- local prediction: 첫 pending input 하나만 한 칸 앞서 표시
- local camera: latest target으로 175ms linear retarget
- remote player: latest target으로 135ms linear retarget
- bomb/fuse/flame: 1초 world tick
- protocol: V2-only WebSocket, command sequence와 input ACK
- reconnect: 1.5초 뒤 새 connection/player 생성
- terrain: 16×16 chunk snapshot/delta/revision
- public server: single Oracle Node process, 128MB limit

시작 전에 현 production packet fixture, gameplay test와 browser video를 기준선으로
보존한다.

## 3. Preserve 계약

- server authority와 World Owner 단일 mutation 경계
- 공개 game URL과 Oracle WebSocket/health 경로
- nickname join, death와 respawn
- endless materialized world와 chunk revision/resync
- wall, crate, bomb와 player collision
- bomb power, range, shield와 AI item drop
- 폭발 순간과 live flame 접촉 damage
- 파괴된 crate 자동 재생성 없음
- AI 6명과 화면 밖 적 방향 표시
- BGM/world clock와 volume UI
- local player 중앙 camera projection

player-player collision은 이번 Sprint에서 gameplay rule을 바꾸지 않는다.

## 4. 범위 밖과 삭제할 설계

### 범위 밖

- full world rollback과 shooter식 lag compensation
- WebTransport/UDP, transport abstraction과 packet encryption 계층
- binary protocol, compression과 generic schema framework
- ECS, physics engine와 plugin/event bus
- room/friend match, account와 persistent inventory
- multi-process, sharding과 Oracle DB persistence
- AI 전략, art와 UI redesign

### V3 전환 뒤 삭제 후보

- 145ms repeated step `InputRuntime`
- one-cell-only `MovementPrediction`
- latest-target 135/175ms position interpolator 사용 경로
- client distance `> 2` teleport heuristic
- input ACK마다 entity cache를 갱신하는 V2 owner correction 경로
- production V2 traffic 0 확인 뒤 V2 movement protocol

## 5. 최종 책임과 목표 파일

파일은 구현 중 20줄 helper를 무조건 분리하지 않는다. 독립 상태, 독립 test 또는
서로 다른 변경 이유가 있을 때만 나눈다.

### Shared

| 목표 파일 | 단일 책임 |
|---|---|
| `shared/net-tick.mjs` | wrap-safe tick/sequence 비교와 lead window |
| `shared/movement-config.mjs` | fixed units, speed, acceleration과 turn grace 값 |
| `shared/movement-step.mjs` | 한 fixed tick의 pure movement와 collision contact 계산 |

`movement-step.mjs`는 plain collision reader interface를 받는다. client/server
adapter를 shared package에 넣지 않는다.

### Server

| 목표 파일 | 단일 책임 |
|---|---|
| `server/src/simulation/fixed-step-loop.mjs` | 30Hz scheduling, bounded catch-up와 metrics |
| `server/src/simulation/player-command-buffer.mjs` | sequence/target tick 검증과 per-player input state |
| `server/src/simulation/player-movement-system.mjs` | shared core 실행과 World Owner movement commit |
| `server/src/simulation/bomb-system.mjs` | placement, fuse와 owner pass-through lifecycle |
| `server/src/simulation/explosion-system.mjs` | blast cells, damage와 flame result |
| `server/src/network/protocol-v3.mjs` | V3 server schema validation/serialization |
| `server/src/network/connection-registry.mjs` | socket, player lease와 resume token |
| `server/src/network/entity-snapshot-publisher.mjs` | 15Hz absolute movement samples와 owner ACK |
| `server/src/network/chunk-publisher.mjs` | 기존 chunk revision/snapshot/delta |
| `server/src/network/websocket-gateway.mjs` | V2/V3 upgrade와 message routing 조립 |

기존 `game-simulation.mjs`의 join, item과 death orchestration은 새 system이 실제로
분리될 때만 줄인다. 이름만 바꾸는 이동은 하지 않는다.

### Client

| 목표 파일 | 단일 책임 |
|---|---|
| `app/game/clock-sync.ts` | server time/tick, RTT, jitter와 lead estimate |
| `app/game/input-sampler.ts` | keyboard/pointer를 direction/action state로 정규화 |
| `app/game/command-timeline.ts` | command seq/target tick/pending queue |
| `app/game/local-movement-predictor.ts` | shared core tick, ACK restore와 pending replay |
| `app/game/correction-smoother.ts` | render-only position offset 감쇠/snap |
| `app/game/remote-snapshot-buffer.ts` | entity별 history, interpolation/extrapolation |
| `app/game/pending-bomb-presenter.ts` | pending/confirm/reject visual state |
| `app/game/protocol-v3.ts` | client V3 parser와 typed messages |
| `app/game/game-socket.ts` | V2/V3 connection, send와 resume transport |

World Store는 authoritative chunk/entity cache만 유지한다. prediction history와
remote ring buffer를 World Store Map에 합치지 않는다.

## 6. Protocol V3 최소 메시지

```text
Client → Server
  join / resume / ready
  input_state(commandSeq, targetTick, direction)
  action_command(commandSeq, targetTick, bomb|respawn)
  chunk_resync / ping

Server → Client
  hello / world_init
  owner_snapshot(snapshotSeq, serverTick, lastProcessedCommandSeq, player)
  entity_snapshot(snapshotSeq, serverTick, absolute entity samples)
  action_result(commandSeq, accepted, bomb metadata)
  world_event(eventSeq, eventTick, kind, payload)
  chunk_snapshot / chunk_delta / interest_update
```

moving entity는 absolute state sample을 사용하고 baseline delta chain을 만들지 않는다.
청크는 현재 revision delta/resync를 유지한다.

## 7. 입력 Buffer 결정

### 채택

- raw input → 다음 local predicted tick: 0~33ms frame latch
- future `targetTick` server command buffer: one-way delay + 1~3 jitter slack tick
- 코너에서 너무 일찍 누른 방향: shared Movement State의 2~3 tick turn grace

### 기각

- keydown 뒤 30~50ms 동안 local movement를 일부러 시작하지 않는 timer

기각 이유는 local response만 늦추고 RTT, packet loss와 server correction을 줄이지
못하기 때문이다. server command slack이 같은 jitter 흡수 효과를 추가 local lag
없이 제공한다.

## 8. 단계별 실행

### 1단계 — Shared Movement Core

상태: **PASS**

작업:

- fixed-point coordinate와 movement config
- acceleration/deceleration, sweep collision와 turn grace pure core
- current grid collision adapter fixture
- server/client golden tick test

완료 조건:

- 같은 initial state/input/collision fixture가 Node와 client test에서 byte-equivalent
  movement state 생성
- production path 변경 0
- 음수 좌표와 collision 관통 0

Rollback: 새 shared files와 tests만 제거

결과:

- `shared/net-tick.mjs`, `movement-config.mjs`, `movement-step.mjs` 구현
- client/server가 같은 golden fixture를 byte-equivalent하게 재생
- 30Hz fixed-point 가감속, 축별 AABB sweep, 음수 좌표, 고속 중간 셀 충돌,
  방향 반전, turn grace와 uint32 tick wrap 테스트 통과
- production `app/`, `server/src/` 변경 0
- root build/client 28건, server 26건, lint, tsc와 diff-check 통과

### 2단계 — V3 Server Fixed Simulation

상태: **PASS**

작업:

- fixed-step loop와 bounded catch-up
- command buffer/target tick window
- movement system과 World Owner commit
- V3 schema, owner/entity absolute snapshot
- V2 server behavior 동시 유지

완료 조건:

- V2 regression 전부 PASS
- V3 simulated client가 30Hz movement/15Hz snapshot 수신
- duplicate, late, future, missing command와 queue limit test
- no-client 상태에서 불필요한 snapshot 0

Rollback: V3 route 비활성, current V2 path 유지

결과:

- 30Hz bounded fixed loop, target-tick command buffer와 World Owner movement commit 구현
- 명시적 Protocol V3 join/ready/input과 15Hz absolute owner/entity snapshot 구현
- V3 25청크 baseline, revision 복구, chunk delta와 경계 interest preload 구현
- V2/V3 session/publisher를 분리해 기존 V2 packet 계약 유지
- duplicate/stale/late-clamp/expired/future/queue limit/tick wrap와 no-client publication 0 검증
- server 40건, root build/client 28건, lint, tsc, syntax와 diff-check 통과

### 3단계 — V3 Local Prediction

상태: **PASS**

작업:

- clock sync와 command target tick
- input sampler/command timeline
- local fixed prediction과 full pending replay
- correction smoother와 debug metrics

완료 조건:

- keydown frame visual feedback
- 200/300ms RTT와 50ms jitter에서 정상 직선 correction 대부분 0.10 tile 이하
- send 실패/reject/blocked/reconnect queue test
- V2 client fallback 유지

Rollback: public client V2 mode로 전환

결과:

- V3 `?protocol=3` opt-in과 기본 V2 fallback을 병행
- ClockSync, immediate InputSampler, bounded CommandTimeline, shared-core predictor와
  render-only correction을 controller/viewport rAF에 연결
- owner ACK restore 뒤 pending 전체 replay, lifecycle/reconnect/reject/send-failure reset 구현
- World Store authoritative entity와 prediction runtime을 분리하고 owner/entity sequence 격리
- 200/300ms RTT·50ms-class jitter에서 replay 16 tick 이하, 직선 correction 90% 이상
  0.10 tile 이하 검증
- root build/client 44건, server 40건, lint, tsc와 diff-check 통과

### 4단계 — Remote Snapshot Interpolation

상태: **PASS**

작업:

- remote entity별 bounded history
- 100ms interpolation, max 100ms extrapolation와 freeze
- jitter-adaptive 80~150ms delay
- lifeId/teleport snap

완료 조건:

- 15Hz snapshot과 60/120Hz render에서 constant-speed motion
- reorder/drop/stall simulation에서 backward movement와 unbounded extrapolation 0
- terrain render count 증가 0

Rollback: V2 latest-target renderer 재활성

결과:

- remote player 전용 entity별 absolute history(max 24)와 V3 rAF source 구현
- 100ms 기본, jitter 기반 80~150ms interpolation delay와 render tick 단조 clamp
- 100ms bounded extrapolation 후 freeze, lifeId/teleport/impossible-speed snap 구현
- stale/duplicate/reorder/drop/removal cleanup과 local owner 제외
- 15Hz snapshot→60/120Hz constant speed, history/extrapolation bound와 terrain notification 0 검증
- root build/client 51건, server 40건, lint, tsc와 diff-check 통과

### 5단계 — Bomb/Explosion V3

상태: **PASS**

작업:

- pending bomb presenter
- action result와 exact spawn/explode tick
- bomb owner exit pass-through/re-entry collision
- world event dedupe와 late event fast-forward

완료 조건:

- pending/confirm/reject/snapshot race test
- two-client bomb cell/explode tick/flame/damage 일치
- 300ms RTT에서 과거 위치 damage 0

Rollback: pending visual 비활성, authoritative V2 bomb presentation 유지

결과:

- input/action 공용 sequence·targetTick queue와 30Hz 90-tick authoritative bomb 구현
- fixed order `movement → respawn/bomb → explosion/live flame → publication` 확정
- V2/V3 bomb·flame clock domain 격리, owner AABB exit pass-through와 re-entry block
- exact eventTick blast/crate/shield/death, 현재 AABB damage, AI drop·safe respawn 구현
- V3 item 3종 획득, lifeId respawn과 pre-life queue reset 구현
- pending/accept/reject/snapshot race와 late explosion event fast-forward/dedupe 렌더 구현
- 실제 two-client 동일 bomb/explode/event/flame/damage와 300ms급 과거 위치 damage 0 검증
- root build/client 59건, server 56건, lint, tsc, diff-check와 파일 500줄 미만 통과

### 6단계 — Resume, Late Join과 Network Hardening

상태: **PASS**

작업:

- connection/player lease 분리, 10초 grace와 token rotation
- resume full reset, late join baseline tick
- backpressure 1013 resume
- clock outlier, command lead와 correction metrics

완료 조건:

- old socket/expired token mutation 0
- reconnect pending input replay 0, same player resume
- late join current bomb/flame/item/player state 일치
- 200/300ms RTT, 50ms jitter, transport stall과 reconnect scenario PASS

Rollback: resume 비활성, current new-session reconnect

결과:

- V3 connection과 player lease 분리, provisional player 0과 10초 grace 구현
- 128-bit memory-only token, same-player resume, rotation/old token·socket invalidation 구현
- disconnect neutral/queue clear, resume sequence reset와 full baseline teleport 구현
- late join/resume가 같은 baseline tick의 chunks/player/bomb/flame/item을 수신
- 실제 WebSocket 1013 backpressure→same player resume, lease expiry와 rate limit 검증
- client resume-first→reject 시 clean join, V2 handler 격리와 server restart clock reset 구현
- health aggregate resume/queue/backpressure/rate/fixed metrics에 identity·token 비노출
- root build/client 64건, server 63건, lint, tsc, diff-check와 파일 500줄 미만 통과

### 7단계 — 배포, 관찰과 Cleanup 결정

상태: **PASS**

순서:

1. full local validation
2. Oracle dual V2/V3 server deploy
3. V2 public client smoke
4. V3 Sites client deploy
5. actual two-browser desktop/mobile QA
6. Oracle CPU/RSS/backpressure/correction 10분 이상 관찰
7. V2 traffic 0 확인
8. 별도 cleanup commit에서 V2 제거 여부 결정

완료 조건:

- public health, V2/V3 WebSocket와 real input PASS
- RSS 128MB 제한 안, tick backlog와 queue가 bounded
- rollback artifact와 previous Sites version 확인

배포 전 결과:

- 공개 client selector를 기본 V3, 오직 `?protocol=2`만 V2 rollback으로 고정
- local 실제 V2 join/input과 V3 two-client join/input/bomb/resume PASS
- Sites package helper와 deploy artifact 구성 검증 PASS
- root build/client 65건, server 63건, lint, tsc, syntax와 diff-check PASS
- 모든 source/test 파일 500줄 미만, production 최대 controller 372줄
- Oracle 배포 manifest에 `server/`와 sibling `shared/` 동시 배치 요구를 명시

배포·관찰 결과:

- GitHub `main` commit `4cfeaab` push 완료
- Oracle에 V2/V3 server-first 배포 후 public V2 join/input과 V3
  join/input/bomb/same-player resume PASS
- Sites version 44를 배포해 공개 client 기본값을 V3로 전환하고 SVG favicon 명시
- Microsoft Edge 독립 탭 2개에서 `EDGE-A`, `EDGE-B` 동시 입장, 실제 이동과
  3초 bomb 표시 PASS
- Edge responsive device emulation 400px에서 board, controls와 bomb button 표시 PASS
- 최종 새로고침 뒤 Edge console application error 0
- 실제 V3 연결 2개를 유지한 608초 soak에서 RSS 최대 85,557,248B,
  fixed backlog 0, command queue 0, backpressure 0, rate reject 0
- 128MiB 제한 대비 종료 시 48,660,480B 여유
- soak 중 V2 traffic 0을 확인했지만 첫 V3 release rollback을 위해 V2는 유지
- 별도 cleanup Sprint에서 더 긴 live 관찰 뒤 V2 제거 여부 재평가

## 9. Network Test Matrix

| RTT | Jitter | Transport 상태 | 기대 결과 |
|---:|---:|---|---|
| 50ms | 0~10ms | 정상 | correction 거의 0 |
| 200ms | 50ms | 정상 | local 즉시, remote smooth, bounded replay |
| 300ms | 50ms | 정상 | no freeze, snap은 invalid collision/lifecycle만 |
| 200ms | 50ms | 300ms stall | bounded extrapolation 후 freeze, reconnect 가능 |
| 200ms | 50ms | snapshot drop harness | 다음 absolute sample로 회복 |
| 임의 | 임의 | socket close | neutral input, 10초 내 resume |

browser WebSocket에서 packet loss는 주로 TCP recovery stall로 나타난다. test harness의
drop은 미래 transport와 stale snapshot 처리를 검증하기 위한 application simulation이다.

## 10. Metrics

- simulation duration, catch-up backlog와 skipped publication
- command queue depth, late/clamped/rejected/duplicate command
- RTT, jitter, command lead tick
- prediction replay tick count
- correction error histogram과 cause
- smooth correction/snap count
- interpolation buffer depth, extrapolation/freeze duration
- action rejection과 event dedupe
- resume success/expiry와 backpressure disconnect
- outbound messages/bytes와 process RSS

high-cardinality player ID와 secret token은 public health에 넣지 않는다.

## 11. 전체 완료 기준

- server authority를 우회하는 client coordinate/delta path 0
- shared movement core 이외 movement formula 중복 0
- 200ms RTT에서 immediate local response와 정상 이동 correction 대부분 0.10 tile 이하
- 300ms RTT/50ms jitter에서 replay, queue와 memory bounded
- remote movement가 snapshot/render cadence와 무관하게 일정
- bomb/explosion/damage가 모든 client에서 같은 server tick 결과
- reconnect/late join이 full authoritative state로 회복
- V2 rollback 가능한 server-first/client-second 배포
- root lint/tsc/build/client tests, server tests, diff-check와 actual browser QA PASS

## 후속 Task — 목표 칸 기반 중심선 이동

상태: **PASS**

Preserve:

- Protocol V3 server authority, prediction/replay와 V2 rollback
- 30Hz fixed simulation, 15Hz snapshot, 폭탄·폭발 authoritative tick
- 연속 입력의 가속과 rAF camera 표시

변경 계약:

- 방향 입력이 통과 가능한 인접 칸 하나를 목표로 확정한다.
- 이동은 두 칸의 중심을 잇는 수평·수직 중심선만 따른다.
- keyup 뒤에는 현재 목표 칸 중심까지 완료하고, 도중의 방향 변경은 도착 뒤 적용한다.
- 같은 방향 hold는 정지 없이 다음 칸 목표를 이어서 확정한다.
- bomb action은 현재 겹침/반올림 칸 대신 확정 목표 칸을 우선 사용한다.
- player 두 명은 같은 목표 칸을 동시에 예약하지 못한다.

검증 기준:

- shared client/server golden state 일치
- keyup 완주, hold 연속, queued turn, 음수 좌표와 blocked target PASS
- 이동 중 client pending bomb와 server authoritative bomb cell 일치
- root build/test/lint/tsc, server test와 diff-check PASS

결과:

- shared Movement Core, server World Owner/Movement/Bomb와 client Predictor를 같은
  `targetCellX/Y` 계약으로 연결
- V3 bomb을 local player 중앙에 고정하지 않고 목표 월드 칸에 렌더링
- root production build와 client 68건, server 66건, lint, tsc, syntax와
  diff-check PASS
- 모든 source/test 파일 500줄 미만 유지
- commit, push, Oracle/Sites 배포와 실제 브라우저 QA는 이 Task에서 실행하지 않음

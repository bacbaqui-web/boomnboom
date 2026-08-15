# BOOMnBOOM 최근 작업 보고서

## 0. 최신 Task — 상단 HUD 제거와 V3 적 방향 화살표 복구

게임판보다 위에 있던 장식과 상태 HUD를 제거하고, Protocol V3 전환 뒤 비어 있던
AI 방향 표시를 현재 player snapshot에서 다시 계산하도록 고쳤다.

- BOOMnBOOM 제목·설명과 서버 연결 상태 header를 제거했다.
- 1초마다 채워지던 원형 tick meter와 짙은 파란 HUD 영역을 제거했다.
- 게임 shell의 위쪽 여백을 없애 화면 최상단에서 바로 게임판이 시작된다.
- V2 `enemy_summary`는 먼 적 정보로 보존하고 V3의 전체 player snapshot은 client에서
  화면용 `dx`, `dy`, 거리로 투영한다.
- AI 또는 다른 player가 화면 안에 들어오면 기존처럼 화살표를 숨기고, 화면 밖에
  있을 때만 가장자리에 방향과 거리를 표시한다.
- 서버 simulation, 월드 좌표와 네트워크 protocol은 변경하지 않았다.

---

# Protocol V3 최종 설계 및 완료 기록

## 1. 최근 Task와 결론

기존 저지연 멀티플레이 보고서를 실제 코드로 옮길 수 있는 구조로 다시 검토했다.
최종 선택은 다음과 같다.

```text
Server Authority
+ 30Hz Fixed Simulation
+ Future-tick Command Buffer
+ Shared Fixed-point Movement Core
+ Local Owner Prediction and Pending Replay
+ Render-only Correction Smoothing
+ Remote Absolute Snapshot Interpolation
+ Server-tick Bomb/Explosion Authority
```

full world rollback, shooter식 lag compensation, generic netcode framework와 추가 local
input delay는 사용하지 않는다.

이번 Task에서 canonical Architecture와 새 Sprint 계획을 실제 제품 코드로 구현했다.
1~7단계 구현, server-first 배포, 실제 Edge 2-client QA와 10분 이상 운영 관찰까지
완료했다. 공개 client는 기본 Protocol V3이며 `?protocol=2`를 즉시 rollback으로
유지한다.

## 2. 현재 설계의 문제점

### Local prediction이 실제 replay가 아님

현재 `MovementPrediction`은 pending command 전체가 아니라 첫 이동 하나만 한 칸 앞서
표시한다. RTT가 길면 server ACK 뒤 client가 남은 input timeline을 정확히 재현하지
못한다.

### Server와 client의 이동 모델이 다름

- server: message 도착 시 140ms 제한 후 정수 한 칸
- client: 145ms input 반복과 175ms camera easing

client easing은 visual 효과일 뿐 server가 실행하는 movement가 아니므로 correction
양을 근본적으로 줄이지 않는다.

### Remote interpolation이 snapshot interpolation이 아님

remote entity는 packet 도착 때마다 최신 위치까지 135ms easing한다. 두 known server
snapshot 사이를 시간축으로 재생하지 않아 jitter가 표시 속도 변화로 이어질 수 있다.

### Clock 책임이 movement와 bomb에서 나뉨

movement는 message callback, bomb/fuse는 1초 timer가 확정한다. future target tick,
same-tick ordering과 high RTT command scheduling을 넣기 어렵다.

### Network session과 player 수명이 붙어 있음

현재 reconnect는 새 connection과 새 player를 만든다. 짧은 transport stall에도
identity, prediction과 월드 위치가 초기화된다.

### `world-publisher`와 client message applier 책임이 커질 위험

V3를 현재 파일에 계속 추가하면 chunk revision, moving snapshot, owner ACK, event,
resume와 clock이 한 파일에서 같이 바뀐다.

## 3. 단순화한 핵심 결정

### 하나의 shared movement formula

server와 local predictor가 pure `movement-step` 하나를 사용한다. Network, React,
Bomb와 World Owner를 import하지 않는다.

### Owner와 remote를 완전히 다른 방식으로 처리

- local owner: immediate prediction, authoritative restore, pending replay
- remote player: server snapshot history interpolation

remote player를 예측하지 않고 local player를 interpolation buffer에 넣지 않는다.

### Moving snapshot은 absolute state

remote `px, py, vx, vy`는 이전 packet delta에 의존하지 않는다. snapshot 하나가
누락돼도 다음 sample로 회복한다. chunk tile만 기존 revision delta/resync를 유지한다.

### ACK는 owner snapshot에 piggyback

movement command마다 별도 ACK를 보내지 않는다. 기본 15Hz owner snapshot에
`lastProcessedCommandSeq`와 authoritative state를 넣는다. bomb처럼 즉시 UI 확정이
필요한 edge action만 `action_result`를 받는다.

### 범용 추상화 금지

generic event bus, ECS, transport adapter, binary schema framework와 전체 rollback
history를 만들지 않는다. 각 module은 현재 BOOMnBOOM의 한 책임만 가진다.

## 4. Input Buffer 검토 결과

### 기각: local keydown 30~50ms 지연

keydown 뒤 timer로 기다렸다 움직이면 RTT와 packet loss는 줄지 않고 local input
latency만 늘어난다. 30ms는 60Hz 기준 약 두 frame이라 충분히 둔하게 느낄 수 있다.

### 채택: 세 종류의 bounded buffer

1. frame latch
   - raw input을 다음 30Hz predicted tick까지 최대 33ms 보관
   - visual feedback은 keydown frame에 즉시 시작 가능
2. future-tick server command buffer
   - client가 예상 one-way delay와 jitter slack을 더한 미래 `targetTick`으로 command 전송
   - local은 즉시 predict하고 server만 해당 tick까지 command를 기다림
3. turn grace
   - 교차점 직전에 누른 방향을 2~3 simulation tick 보존
   - 출발을 늦추는 buffer가 아니라 코너 입력을 놓치지 않는 game-feel 기능

```text
targetTick = estimatedServerTick
  + ceil(estimatedOneWayDelay / 33.33ms)
  + jitterSlackTicks(1~3)
```

이 구조는 Unity Netcode의 command slack과 같은 목적을 더 작은 범위로 적용한다.
200~300ms RTT에서도 local response는 즉시이고 server command arrival jitter를
흡수할 수 있다.

## 5. 리팩토링된 책임 구조

### Shared

- `net-tick`: tick/sequence 비교와 lead window
- `movement-config`: fixed units, speed, acceleration와 turn grace
- `movement-step`: 한 fixed tick의 pure acceleration/collision 결과

### Server

- Fixed Step Loop: 30Hz와 bounded catch-up
- Player Command Buffer: sequence, target tick과 input state
- Player Movement System: shared core 실행과 World Owner commit
- Bomb System: placement, fuse와 bomb pass-through lifecycle
- Explosion System: blast, crate, shield, damage와 flame
- Connection Registry: socket, 10초 player lease와 resume token
- Entity Snapshot Publisher: 15Hz absolute movement/owner ACK
- Chunk Publisher: 기존 revision/snapshot/delta
- WebSocket Gateway: V2/V3 upgrade와 routing만 조립

### Client

- Clock Sync: server tick/time, RTT, jitter와 command lead
- Input Sampler: keyboard/pointer를 direction/action으로 정규화
- Command Timeline: sequence, target tick과 pending commands
- Local Movement Predictor: shared core, restore와 pending replay
- Correction Smoother: render-only offset 감쇠/snap
- Remote Snapshot Buffer: history, interpolation/extrapolation/freeze
- Pending Bomb Presenter: pending/confirm/reject visual state
- Game Socket: transport와 resume
- World Store: authoritative chunk/entity cache만 유지

Prediction, Interpolation과 Bomb는 서로 import하지 않는다. controller가 plain input과
result를 명시적으로 연결한다.

## 6. Movement와 Correction

### Movement

- `1 tile = 1024 fixed movement units`
- server/client 30Hz fixed step
- 최고속도 도달 약 120ms
- 정지 감속 약 80~100ms
- axis-separated sweep collision
- 중심선 0.15 tile 이내 turn assist
- wall, crate, bomb와 player collision은 server authority

player-player collision은 correction 원인이 될 수 있지만 이번 Sprint에서 gameplay
rule을 바꾸지 않는다. 원인 metric을 먼저 측정한다.

### Reconciliation

owner snapshot 수신 시 simulation state를 즉시 server state로 복원하고 ACK 이후
pending command를 모두 replay한다. 이전 render 위치와 새 predicted 위치 차이만
화면 offset으로 감쇠한다.

| replay 뒤 오차 | 표시 정책 |
|---|---|
| `0~0.10 tile` | 약 80ms smoothing |
| `0.10~0.50 tile` | clear path에서 120~180ms smoothing |
| `0.50 tile 초과` | snap |
| collision crossing, new life, respawn, reconnect, teleport | snap |

## 7. Remote Snapshot Interpolation

- 기본 server snapshot: 15Hz
- client render: browser rAF 60~120FPS
- 기본 interpolation delay: 100ms
- jitter에 따라 80~150ms로 천천히 조정
- 두 known sample 사이에서 server tick 비율로 interpolation
- 다음 sample이 없으면 최대 100ms extrapolation 후 freeze
- `lifeId` 변경 또는 server `teleport` flag는 snap
- fallback teleport 기준: `distance > maxSpeed * dt + 0.25 tile`

latest arrival마다 새 easing을 시작하는 현재 방식은 V3 client 전환 뒤 제거한다.

## 8. Bomb Authority

1. keydown frame에 predicted cell의 pending bomb visual 표시
2. movement와 같은 command sequence domain으로 `action_command` 전송
3. server가 target tick의 authoritative placement cell에서 검증
4. success: bomb ID, cell, spawn tick과 explode tick 반환
5. reject: pending visual만 50~80ms 안에 제거
6. server exact tick에서 explosion cells, crate, shield, damage와 flame 확정
7. 모든 client가 deduplicated world event와 authoritative snapshot 수신

pending bomb는 collision과 fuse를 만들지 않는다. 폭발에는 server rewind를 적용하지
않으며 과거 위치가 아니라 explosion/flame tick의 현재 authoritative 위치로 판정한다.

## 9. Protocol V3 평가

V3는 확장 가능한 범용 component protocol이 아니라 다음 세 흐름으로 제한한다.

```text
Command
  input_state / action_command

State
  owner_snapshot / entity_snapshot / chunk snapshot-delta

Event
  action_result / world_event
```

순서 번호도 역할별로 분리한다.

- `commandSeq`: owner input ACK/replay
- `snapshotSeq`: stale movement snapshot 폐기
- `eventSeq`: effect event dedupe
- `chunk revision`: tile gap/resync
- `lifeId`: join/respawn/teleport lifecycle

future feature는 새 typed command, entity field 또는 world event를 추가할 수 있다.
필수 의미가 달라질 때만 protocol version을 올린다. unknown type, message size,
command rate, target tick window와 queue length는 server가 제한한다.

## 10. 200~300ms RTT와 장애 대응

### RTT/Jitter

- local predicted timeline은 server보다 one-way delay + 1~3 slack tick 앞선다.
- server는 future command를 target tick까지 queue한다.
- 300ms RTT에서 local replay는 약 10~12 tick 안으로 bounded한다.
- late command는 과거 world를 rewind하지 않고 다음 가능한 tick부터 적용한다.

### Packet loss

browser WebSocket은 TCP라 packet이 application에서 사라지기보다 recovery 동안 뒤
packet도 정체된다. unsent superseded movement snapshot을 coalesce하고 send queue가
상한을 넘으면 1013으로 닫아 resume한다. remote absolute sample은 다음 update로
회복할 수 있다.

### Reconnect

- connection과 player entity 수명을 분리
- disconnect 즉시 movement input neutral
- player는 10초 grace 동안 world에 남음
- random 128-bit resume token을 성공마다 회전
- resume full snapshot에서 pre-disconnect pending input 전부 폐기
- old socket과 expired token mutation 금지

### Late Join

같은 baseline tick의 world init, chunks, players, active bombs, explode tick, flames와
items를 받은 뒤 ready 상태가 된다. 과거 explosion effect는 replay하지 않는다.

## 11. 구현 우선순위 변경

이전 보고서는 grid prediction 보강을 먼저 제안했지만 최종 Sprint는 shared movement
core를 가장 먼저 만든다. one-cell predictor를 확장한 뒤 다시 버리는 중복 작업을
피하기 위해서다.

1. shared movement core와 golden tests
2. V3 server fixed simulation/command buffer, V2 호환 유지
3. V3 local prediction/replay/correction
4. remote snapshot interpolation
5. pending bomb/action result/world event
6. resume, late join과 network hardening
7. server-first/client-second 배포와 V2 cleanup 결정

단계별 상세 완료 조건과 rollback은 [98_sprint_plan.md](./98_sprint_plan.md)에 있다.

## 12. 삭제 가능한 설계

V3 공개 전환이 완료된 rollback 단위에서 다음을 제거할 수 있다.

- 145ms interval step input
- pending 첫 move 하나만 보는 predictor
- latest target 135/175ms easing 경로
- distance `> 2` teleport 추정
- movement command마다 별도 ACK를 보내는 경로
- V2 traffic 0 확인 뒤 V2 movement protocol

V2 public client가 존재하는 동안 먼저 삭제하지 않는다.

## 13. 실제 구현 주의사항

- client position, velocity와 delta time을 authority로 신뢰하지 않는다.
- shared movement core에 DOM, WebSocket, World Owner와 bomb rule을 넣지 않는다.
- server/client cell rounding과 음수 좌표 helper를 하나로 통일한다.
- correction smoothing은 render에만 적용하고 collision state를 늦추지 않는다.
- bomb command edge를 movement state coalescing으로 잃지 않는다.
- owner가 놓은 bomb cell을 빠져나온 뒤 재진입을 차단하는 pass-through lifecycle을
  fixed-point collision에서 명시한다.
- fixed loop catch-up을 큰 variable delta로 합치거나 무한 loop로 처리하지 않는다.
- prediction history, command queue와 remote ring buffer에 상한을 둔다.
- high-cardinality player ID와 resume token을 public metrics/log에 남기지 않는다.
- static/unit test가 real browser movement와 Oracle 128MB behavior를 증명한다고
  보고하지 않는다.

## 14. 상용 방식과의 관계

- Source 계열: local input prediction, error smoothing와 remote buffered interpolation
- Unreal Character Movement: SavedMoves, server reproduction, ACK/correction와 replay
- Unity Netcode: shared fixed prediction loop, command slack와 interpolated remote ghosts

BOOMnBOOM은 이 공통 원리만 가져오고 engine 규모의 generic physics/replication
framework는 가져오지 않는다.

참고:

- https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking
- https://dev.epicgames.com/documentation/unreal-engine/understanding-networked-movement-in-the-character-movement-component-for-unreal-engine
- https://docs.unity.cn/Packages/com.unity.netcode%401.5/manual/intro-to-prediction.html
- https://docs.unity.cn/Packages/com.unity.netcode%401.5/manual/interpolation.html

## 15. 완료 기준

- 200ms RTT에서도 keydown frame에 local feedback
- 정상 직선 movement correction 대부분 0.10 tile 이하
- 300ms RTT/50ms jitter에서 replay와 queue bounded
- remote movement가 15Hz snapshot과 60/120Hz render에서 일정
- 0.50 tile 이상 snap은 invalid collision/lifecycle에서만 발생
- 모든 client가 같은 bomb cell, explode tick, flame와 damage 결과 확인
- reconnect와 late join이 full authoritative snapshot으로 회복
- Oracle CPU/RSS, backpressure와 outbound traffic이 bounded
- V2 rollback을 유지한 server-first/client-second 배포

## 16. 이번 Task 상태

- 현재 코드/문서 감사: 완료
- 상용 방식과 input buffer 재검토: 완료
- 최종 책임 구조와 Protocol V3 계약: 완료
- canonical Architecture 갱신: 완료
- active Sprint 계획 작성: 완료
- 제품 구현: 7/7단계 완료
- 1단계 Shared Movement Core: PASS
- 2단계 V3 Server Fixed Simulation과 V2 병행: PASS
- 3단계 V3 Local Prediction/Replay/Correction: PASS
- 4단계 Remote Snapshot Interpolation: PASS
- 5단계 Bomb/Explosion V3: PASS
- 6단계 Resume/Late Join/Network Hardening: PASS
- 7단계 기본 V3/V2 rollback 전환, 배포·Edge QA·운영 관찰: PASS
- 현재 검증: root build/client 65건, server 63건, lint, tsc, syntax와 diff-check PASS
- GitHub `main`: `4cfeaab` push 완료
- Oracle: V2/V3 병행 server-first 배포, public V2/V3 smoke PASS
- Sites: version 44 공개 배포 완료, 최종 Edge console application error 0
- Edge: 독립 탭 2개 동시 입장, 이동, bomb과 400px responsive QA PASS
- Oracle soak: V3 2 connections, 608초, RSS 최대 85,557,248B,
  backlog/queue/backpressure/rate reject 모두 0
- cleanup 결정: V2는 첫 V3 release rollback으로 유지, 별도 Sprint에서 제거 재평가

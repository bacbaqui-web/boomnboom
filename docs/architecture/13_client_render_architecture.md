# Client Prediction and Render Architecture

## 1. 목적과 현재 차이

이 문서는 V3 client가 local player를 즉시 predict하고 remote player를 server
snapshot history로 보간하는 Runtime 계약을 정의한다. 현재 production의 one-cell
prediction과 latest-target linear interpolation은 Sprint에서 단계적으로 교체한다.

## 2. 최소 Runtime 구성

```text
Game Controller
  ├─ Game Socket
  ├─ World Store
  ├─ Clock Sync
  ├─ Input Sampler
  ├─ Command Timeline
  ├─ Local Predictor
  ├─ Correction Smoother
  ├─ Remote Snapshot Buffer
  ├─ Pending Bomb Presenter
  ├─ Camera Runtime
  └─ Audio Runtime
```

작은 helper마다 class를 만들지 않는다. 위 이름은 독립 상태나 독립 test가 필요한
주된 책임 경계다.

## 3. 의존성 규칙

- Input Sampler는 DOM input을 direction/action으로 바꾸기만 한다.
- Command Timeline은 sequence, target tick과 pending command를 소유한다.
- Local Predictor는 shared Movement Core와 collision reader만 사용한다.
- Correction Smoother는 simulation을 바꾸지 않고 render offset만 계산한다.
- Remote Snapshot Buffer는 server samples와 Clock Sync만 사용한다.
- Pending Bomb Presenter는 action result와 world snapshot을 사용하고 Movement Core를
  mutation하지 않는다.
- React component는 socket, replay queue와 snapshot ring buffer를 직접 소유하지
  않는다.

Prediction, Bomb와 Interpolation 사이에 generic event bus를 두지 않는다. controller가
명시적인 method call과 plain result를 조립한다.

## 4. Input Sampler와 짧은 Buffer

key down을 30~50ms `setTimeout`으로 지연하지 않는다. 실제 효과는 network jitter
흡수가 아니라 local input latency 증가이기 때문이다.

채택하는 buffer는 세 종류로 제한한다.

1. frame latch: raw input을 다음 30Hz predicted tick까지 최대 33ms 보관
2. server command slack: 미래 target tick에 command를 queue해 jitter 흡수
3. turn grace: 너무 일찍 누른 코너 방향을 Movement State에 2~3 tick만 보존

첫 이동 animation과 visual anticipation은 keydown frame에 바로 시작할 수 있지만
canonical/predicted displacement는 fixed tick에서만 바뀐다.

## 5. Command Timeline

Command Timeline은 다음만 소유한다.

```text
nextCommandSeq
predictedTick
currentInputState
pendingCommands[]
lastAckedCommandSeq
```

- direction change와 neutral을 즉시 command로 만든다.
- bomb/respawn edge를 coalesce하지 않는다.
- socket send가 실제 성공한 command만 pending queue에 넣는다.
- queue는 target tick과 sequence 순서다.
- reconnect, new lifeId와 full reset에서 queue를 비운다.

## 6. Local Predictor

local predictor는 `AuthoritativeState + PendingCommands`로 predicted state를 만든다.

### 일반 tick

1. predicted tick의 input state 선택
2. shared Movement Core 한 번 실행
3. predicted state와 tick 저장
4. 같은 코어로 다음 1 tick을 mutation 없이 미리 계산
5. 현재 predicted position에서 안전한 preview position까지 rAF로 33.33ms 보간

preview는 render target일 뿐 predicted state, command ACK와 bomb cell을 변경하지 않는다.
충돌 reader도 실제 prediction과 동일하므로 벽을 가로질러 미리 그리지 않는다.
browser는 fixed tick 진입 여부를 `requestAnimationFrame`에서 확인해 background timer
jitter를 화면 이동에 더하지 않는다. shared Movement Core 자체는 server와 같은 30Hz다.

### Owner snapshot 수신

1. stale snapshot 폐기
2. `lastProcessedCommandSeq` 이하 pending command 제거
3. authoritative movement state를 즉시 적용
4. snapshot server tick 이후 현재 predicted tick까지 pending input replay
5. replay 전 render position과 replay 후 predicted position 차이 계산
6. Correction Smoother에 visual error 전달

local predictor는 remote player, bomb fuse, React state와 Audio를 replay하지 않는다.
300ms RTT에서도 replay 대상은 local movement 약 10~12 tick 정도로 bounded한다.

## 7. Render-only Smooth Reconciliation

```text
renderPosition = predictedPosition + correctionOffset
```

simulation position은 owner snapshot과 replay 결과로 즉시 수정한다. correction
offset만 rAF에서 0으로 감쇠한다.

초기 기준:

| replay 뒤 위치 오차 | visual 처리 |
|---|---|
| `0~0.10 tile` | 약 80ms 감쇠 |
| `0.10~0.50 tile` | clear path에서 120~180ms 감쇠 |
| `0.50 tile 초과` | snap |
| collision을 가로지름 | snap |
| new lifeId, respawn, reconnect, teleport | snap |

error가 생겼다고 authoritative collision state를 천천히 움직이지 않는다. correction
duration, error distance, cause와 snap count를 metric/debug overlay에서 볼 수 있어야
한다.

## 8. Remote Snapshot Buffer

remote player별 bounded ring buffer를 둔다.

```text
RemoteSample
  snapshotSeq
  serverTick
  px, py, vx, vy
  lifeId
  teleport
```

```text
renderServerTime = ClockSync.estimatedServerTime(now)
  - interpolationDelay
```

- 기본 delay 100ms
- jitter에 따라 80~150ms 사이를 급격하지 않게 조정
- 두 known sample 사이에서 server tick 비율로 보간
- 다음 sample이 없으면 최대 100ms만 velocity extrapolation
- 이후 마지막 안전 위치에서 freeze
- lifeId 변경 또는 teleport flag는 즉시 snap
- flag가 없을 때만 `distance > maxSpeed * dt + 0.25 tile`을 fallback으로 사용

remote interpolation은 latest arrival에서 target으로 새 easing을 시작하지 않는다.

## 9. World Store와 Snapshot 적용

- terrain chunk는 기존 revision/snapshot/delta 계약을 유지한다.
- entity network state는 World Store에 absolute sample로 적용한다.
- World Store는 latest authoritative state cache이며 snapshot history와 predicted local
  state를 canonical Map에 섞지 않는다.
- `snapshotSeq`, `eventSeq`, chunk revision과 lifeId stale 검사를 각각 수행한다.
- moving entity sample 때문에 terrain subscriber를 갱신하지 않는다.
- preload 반경 2의 25개 chunk는 Store에 유지하되, TerrainLayer는 local player 중심
  반경 1의 9개 chunk만 DOM으로 만든다. cache와 render 범위를 같은 것으로 취급하지 않는다.

## 10. Pending Bomb Presentation

Bomb Presenter는 다음 작은 state machine만 가진다.

```text
pending(commandSeq, predictedCell)
  → confirmed(bombId, cell, explodeTick)
  → removed
  → rejected(reason)
```

- keydown frame에 pending visual과 placement animation을 시작한다.
- pending bomb는 반투명 또는 구분 가능한 표현이며 collision을 만들지 않는다.
- action result success에서 confirmed entity로 연결한다.
- reject는 약 50~80ms 안에 visual만 제거한다.
- authoritative bomb snapshot이 먼저 오면 command sequence 또는 bomb ID로 합친다.
- reconnect에서는 pending bomb를 버리고 server snapshot만 사용한다.

## 11. Camera와 Player Animation

- local player는 viewport 중앙 anchor를 유지하고 camera가 predicted movement를 따라간다.
- camera transform과 player body squash/jump transform을 다른 DOM layer가 소유한다.
- body animation은 movement state를 변경하지 않는다.
- V3 continuous movement 전환 뒤 기존 매 tile jump가 조작을 방해하면 별도 visual
  tuning Task에서 stride/bob animation으로 교체한다. Network Sprint에서 art를
  동시에 재설계하지 않는다.

## 12. Clock Sync

Clock Sync는 ping/snapshot sample로 다음을 제공한다.

- estimated server time/tick
- smoothed RTT와 jitter
- command lead tick
- remote interpolation delay

Audio와 network가 각각 server offset을 따로 계산하지 않는다. Audio Runtime은 같은
Clock Sync 결과를 읽되 playback correction만 소유한다.

## 13. Reconnect와 Late Join

- disconnect 시 마지막 frame을 유지하고 reconnect UI를 표시한다.
- resume 성공 전에는 새 command를 pending queue에 넣지 않는다.
- resume full snapshot에서 command queue, prediction history와 correction offset을
  초기화한다.
- 같은 player를 resume해도 새 `lifeId` 또는 teleport flag가 있으면 snap한다.
- late join은 baseline chunks와 entity snapshot이 끝나기 전 playable 상태가 아니다.

## 14. 삭제할 현재 설계

V3 전환과 같은 rollback 단위에서 다음 current runtime을 제거한다.

- 145ms interval이 인접 칸 command를 반복 전송하는 `InputRuntime`
- pending 첫 move 하나만 보는 one-cell `MovementPrediction`
- remote latest target마다 새 135ms easing을 시작하는 위치 보간
- distance `> 2`만으로 teleport를 추정하는 규칙
- input ACK마다 React entity snapshot을 불필요하게 복제하는 경로

기존 V2 client가 사용하는 동안에는 제거하지 않는다.

## 15. 검증 계약

- keydown frame feedback과 다음 predicted tick 이동
- command send 실패가 pending queue에 남지 않음
- ACK 뒤 pending 전체 replay와 bounded history
- 200/300ms RTT, 50ms jitter에서 correction distribution
- small error smoothing과 collision/teleport snap
- snapshot reorder, loss simulation, bounded extrapolation과 freeze
- remote constant-speed render와 variable FPS
- pending bomb confirm/reject/snapshot race
- reconnect full reset과 late join readiness
- terrain render count가 movement 때문에 증가하지 않음

# Simulation Architecture

## 1. 목적과 현재 차이

이 문서는 Protocol V3의 현재 simulation을 정의한다. 기본 경로는 30Hz fixed-point
이동이며 V2 rollback만 message 도착 시 정수 한 칸을 이동한다. 전환 순서와
rollback은 `docs/98_sprint_plan.md`가 소유한다.

## 2. 권한과 최소 구성

```text
Validated Command
  → Per-player Command Buffer
  → Fixed Simulation Step
  → World Owner Commit
  → Snapshot / Action Result / World Event
```

- World Owner만 canonical player, bomb, flame, item과 tile을 변경한다.
- Movement Core는 plain state와 collision reader를 받아 다음 state만 계산한다.
- Command Buffer는 sequence와 target tick만 관리하고 gameplay를 계산하지 않는다.
- Bomb System은 authoritative movement state를 읽지만 Prediction이나 Network를
  import하지 않는다.
- Publisher는 commit된 read model만 직렬화한다.

generic command framework, ECS, event bus와 전체 world rollback은 만들지 않는다.

## 3. Clock

### Fixed simulation

- 목표 simulation rate: 30Hz
- fixed delta: 33.33ms
- movement, collision, item collect, bomb placement, fuse, explosion, flame damage와
  death를 같은 단조 증가 `serverTick`에서 처리한다.
- snapshot publication은 기본 15Hz로 두 simulation tick마다 실행한다.
- AI decision은 더 낮은 cadence로 만들 수 있지만 결과는 사람과 같은 input state와
  action command로 fixed step에 들어온다.
- 현재 AI는 500ms마다 방향 또는 폭탄 intent만 다시 고르고, Bot Command Driver가
  이를 다음 fixed tick의 공용 Command Buffer에 넣는다. 따라서 결정 주기는 낮아도
  실제 위치는 사람과 동일한 30Hz 가속 이동으로 연속 갱신된다.

### Catch-up

timer가 늦으면 누락 tick을 순서대로 실행한다. 한 event-loop turn에서 실행할 tick을
제한하고 남은 catch-up은 즉시 다음 turn에 이어서 처리해 socket을 장시간 막지
않는다. gameplay tick을 큰 variable delta 하나로 합치거나 조용히 버리지 않는다.

### World beat와 BGM

1초 beat, BGM 위치와 HUD는 `serverTick`에서 파생한다. Audio playback과 client wall
clock은 simulation을 진행시키지 않는다.

## 4. Movement State

기준 단위는 `1 tile = 1024 movement units`다.

```text
MovementState
  px, py                fixed-point position
  vx, vy                fixed-point velocity per tick
  desiredDirection      latest input state
  queuedTurn            early corner-turn intent or null
  queuedTurnUntilTick   bounded grace expiry
  targetCellX/Y         committed adjacent destination or null
  lifeId                join/respawn마다 증가
```

tile cell, 음수 좌표, rounding과 경계 tie-break는 shared coordinate helper로만
계산한다. client와 server가 서로 다른 `Math.round` 규칙을 갖지 않는다.

## 5. Shared Movement Core

서버와 local prediction이 같은 pure function을 실행한다.

```text
stepMovement(state, inputState, collisionReader, movementConfig)
  → { state, contacts }
```

Movement Core가 하는 일:

- 입력 시 통과 가능한 인접 칸을 목표로 확정
- 목표 칸 중심까지 직교축을 현재 칸 중심선에 고정
- keyup 뒤에도 확정한 목표 칸 중심까지 이동
- 같은 방향을 누르고 있으면 도착 속도를 보존해 다음 인접 칸을 연속 확정
- fixed acceleration/deceleration 적용
- old position에서 next position까지 axis-separated sweep collision
- wall, crate, confirmed bomb와 player collision 처리
- 목표 칸 도착 시 bounded queued direction change 처리
- 이동 중 직교 입력이 교차점 중심에서 `0.3125 tile` 이내라면 가까운 중심으로
  정렬한 뒤 열린 옆칸으로 전환하는 bounded corner assist
- canonical next movement state 반환

Movement Core가 하지 않는 일:

- socket, sequence, ACK와 snapshot 처리
- React animation과 camera transform
- bomb fuse, damage, item effect와 score 변경
- World Owner Map mutation

초기 tuning 기준:

- 기본 최고속도: 초당 3칸
- 속도 아이템: 1개당 초당 0.5칸 누적 증가
- 최고속도 도달: 약 120ms
- queued turn grace: 2~3 simulation tick
- moving corner assist: 교차점 중심에서 최대 `320/1024 tile`, 정지 상태에는 미적용
- 막힌 인접 칸은 목표로 확정하지 않음

폭탄 설치는 command 실행 tick의 authoritative 중심점이 속한 칸을 사용한다.
대칭 AABB에서는 플레이어 몸이 가장 많이 겹친 칸과 같으며 이동 목표 칸을 미리
사용하지 않는다.

player-player blocking은 현재 gameplay를 보존한다. 이 동적 충돌은 stale remote state
때문에 local misprediction을 만들 수 있으므로 correction metric으로 따로 관찰한다.
측정 없이 non-blocking rule로 바꾸지 않는다.

`speedLevel`은 World Owner의 authoritative player stat이다. 서버와 local predictor는
같은 `movementConfigForSpeedLevel()`을 사용하며, 1024 fixed unit에서 생기는 소수
오차는 가장 가까운 정수 unit으로 고정한다. 칸 중심 도착 때 남는 같은 방향 속도는
다음 칸으로 이어서 평균 이동속도가 아이템 표시값과 어긋나지 않게 한다.

## 6. Input Scheduling과 Buffer

### Local input

key down을 30~50ms timer로 일부러 지연하지 않는다. browser frame에서 input state를
latch하고 다음 local predicted tick에 적용하므로 추가 지연은 0~33ms다. button
animation은 같은 frame에 시작할 수 있다.

### Target tick

client는 clock estimate로 command를 server의 미래 tick에 배치한다.

```text
targetTick = estimatedServerTick
  + ceil(estimatedOneWayDelay / fixedDelta)
  + jitterSlackTicks
```

- 기본 jitter slack: 2 tick
- 안정적인 연결: 1 tick까지 천천히 축소 가능
- 큰 jitter: 최대 3 tick까지 확대 가능
- server는 허용 가능한 과거/미래 window 밖 target tick을 clamp 또는 reject한다.
- client가 보낸 delta time과 position은 사용하지 않는다.

local player는 즉시 미래 tick까지 predict하고 server는 command를 target tick까지
queue한다. 따라서 server buffer가 jitter를 흡수하지만 local 조작은 늦지 않는다.
Unity의 command slack과 같은 목적이며 별도 local key delay가 아니다.

### Missing 또는 late command

- movement state change가 아직 없으면 마지막 valid movement state를 짧게 유지한다.
- late movement command는 과거 world를 rewind하지 않고 다음 가능한 tick부터 적용한다.
- bomb edge가 late해도 과거 위치에 설치하지 않고 다음 가능한 authoritative tick의
  placement cell에서 검증한다.
- late, clamped와 rejected command 수를 metrics로 남긴다.

## 7. Simulation Step 순서

한 server tick의 순서를 고정한다.

1. target tick까지 도착한 command를 player별 sequence 순서로 반영
2. 사람과 AI Movement Core 실행
3. movement collision과 authoritative position commit
4. live flame 접촉 damage
5. 생존 player item collect
6. bomb action placement 검증과 commit
7. fuse 만료와 chain candidate 계산
8. explosion cells와 crate mutation 계산
9. explosion damage, shield, death와 AI drop/respawn
10. flame lifetime 갱신
11. World Owner mutation batch commit
12. action result, world event와 snapshot publication 후보 생성

같은 tick의 결과는 socket callback 순서가 아니라 `(targetTick, playerId, commandSeq)`의
안정적인 정렬 규칙으로 고정한다.

## 8. Bomb Authority

- bomb command는 movement와 같은 command sequence domain을 사용하지만 Bomb System이
  별도로 처리한다.
- 사람과 AI의 초기 bomb range는 중심 칸 바깥으로 1칸이며 flame 아이템마다 1칸
  증가한다.
- placement cell은 command를 실행하는 tick의 authoritative player 중심에서 shared
  cell helper로 결정한다.
- alive, bomb limit, 동일 cell bomb와 tile 가능 여부를 server만 확정한다.
- 성공 결과는 `bombId`, `cell`, `spawnTick`, `explodeTick`을 가진다.
- owner가 bomb를 놓은 cell에서 빠져나갈 수 있도록 spawn 당시 겹친 player는 완전히
  cell을 벗어날 때까지 해당 bomb collision만 통과한다. 이후 재진입은 차단한다.
- 폭발 cell에 닿은 armed bomb는 남은 fuse와 무관하게 같은 tick에 터진다. 새로
  확장된 blast가 다시 폭탄에 닿으면 더 이상 후보가 없을 때까지 연쇄 처리한다.
- 남아 있는 live flame 위에 새 폭탄이 생긴 경우에도 다음 fixed step에서 즉시
  폭발한다.
- pending bomb는 client visual이며 collision과 fuse를 만들지 않는다.

폭발과 flame damage는 exact server tick 현재 위치로 판정한다. shooter식 rewind와
과거 위치 damage를 사용하지 않는다.

## 9. Correction을 위한 Server State

local player snapshot은 최소 다음을 포함한다.

```text
serverTick
lastProcessedCommandSeq
px, py, vx, vy
desiredDirection
lifeId
alive
teleport
```

server는 매 input packet에 correction을 별도 전송하지 않고 15Hz owner snapshot에
ACK state를 piggyback한다. bomb처럼 즉시 UI 결과가 필요한 edge action만 별도
`action_result`를 보낸다.

사람 respawn은 새 생명 경계다. 위치·fixed motion·`lifeId`와 함께 폭탄 수, 화력,
방어막과 속도 아이템을 시작값으로 초기화하고 command sequence/queue도 새 session으로
초기화한다. client가 새 생명에서 0번부터 보내는 command를 이전 생명의 stale input으로
판정하지 않는다.

## 10. 과부하와 보안

- player별 command queue 길이, command rate와 future lead를 제한한다.
- duplicate/stale sequence는 idempotent하게 폐기하거나 이전 result를 재사용한다.
- client clock은 target tick 제안에만 사용하고 server가 허용 window를 검증한다.
- 최대 속도, acceleration, collision, bomb power와 damage는 client 값으로 바꾸지
  않는다.
- catch-up backlog, simulation duration, late command와 correction error를 health
  또는 bounded metrics로 관찰한다.

## 11. 검증 계약

- shared movement fixture가 server/client에서 tick별 같은 fixed-point state 생성
- acceleration, deceleration, reversal과 corridor turn
- 음수 좌표, wall/crate/bomb/player sweep collision과 관통 0
- 200/300ms RTT와 50ms jitter에서 target tick scheduling
- late/missing/duplicate command와 bounded queue
- ACK 뒤 pending input replay 결과와 authoritative 결과 일치
- bomb placement cell, owner exit pass-through와 re-entry block
- explosion 순간과 live flame 접촉 damage
- tick catch-up 순서와 event-loop starvation 방지
- 같은 tick command ordering 결정성

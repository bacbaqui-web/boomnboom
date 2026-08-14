# Simulation Architecture

## 1. 목적

이 문서는 서버가 입력, 이동, AI, 폭탄, 폭발, 피해, 아이템과 상자 재생성을
어떤 clock과 순서로 확정하는지 정의한다.

## 2. 권한과 구성

```text
WebSocket input / AI decision
  → validated Intent
  → Simulation command
  → World Owner transaction
  → World Mutation Batch
  → Protocol events
```

Simulation은 규칙을 계산하고 World Owner는 결과를 원자적으로 commit한다.
Gateway timer와 socket callback이 canonical Map을 직접 바꾸지 않는다.

## 3. Clock

두 종류의 시간을 분리한다.

### Real-time input cadence

- 사람 이동 intent는 서버 rate limit 기준 140ms 간격으로 최대 한 칸 처리한다.
- AI decision 기본 주기는 500ms다.
- 숫자는 현재 감각을 보존하는 초기값이며, 측정 없이 더 빠르게 바꾸지 않는다.

### World beat tick

- 기본 `TICK_MS`는 1000ms다.
- `WORLD_EPOCH_MS`에서 계산한 단조 증가 tick number가 authority다.
- 폭탄 fuse, 폭발, 불꽃과 crate respawn schedule은 world tick에서 실행한다.
- process timer가 늦게 깨어나도 현재 wall clock의 tick까지 따라잡고 중복 tick을
  실행하지 않는다.

BGM은 이 clock을 들려주는 client projection이며 Audio 재생 위치가 server tick을
변경하지 않는다.

## 4. Intent

클라이언트 intent는 다음 범주만 가진다.

- join
- respawn
- movement start/change/stop 또는 단일 movement step
- place bomb

intent에는 session identity와 증가하는 client sequence가 포함된다. 서버는 schema,
session, alive 상태, action 종류와 rate limit을 검증한다. 중복 또는 과거 sequence는
결과를 다시 적용하지 않는다.

## 5. 이동

- authoritative 위치는 항상 정수 타일이다.
- 유효한 방향 intent는 현재 좌표에서 상하좌우 인접 한 칸만 후보로 만든다.
- wall, crate, bomb와 다른 blocking player를 같은 collision read model로
  확인한다.
- 성공한 이동만 player position revision을 증가시킨다.
- 실패한 이동도 ack할 수 있지만 월드 mutation을 만들지 않는다.
- 키를 놓는 것은 새 이동을 중단할 뿐 이미 성공한 칸 이동을 취소하지 않는다.
- client가 보여주는 중간 pixel 위치는 판정에 사용하지 않는다.

동시에 같은 칸을 요구하는 경우 한 simulation batch 안의 안정적인 순서를
사용한다. 최초 구현은 server receive order와 session sequence를 사용하되 결과를
테스트로 고정한다. 향후 truly simultaneous movement가 필요하면 별도 규칙 변경
Sprint에서 교체한다.

## 6. 폭탄 설치

- 설치는 유효한 command 처리 시점에 즉시 실행한다.
- 위치는 command가 처리되는 순간의 authoritative player tile이다.
- 같은 칸에 bomb가 없어야 한다.
- owner의 active bomb 수가 power보다 작아야 한다.
- bomb는 `id`, `ownerId`, `position`, `bornTick`, `explodeTick`, `range`를 가진다.
- 설치와 player action projection은 한 mutation batch로 commit한다.

## 7. World beat 처리 순서

한 tick에서 다음 순서를 고정한다.

1. 현재 tick 계산과 누락 tick 확인
2. 만료된 bomb 선택
3. 폭발 범위 계산과 chain reaction 대상 확정
4. crate 파괴 mutation과 respawn schedule 후보 생성
5. 폭발 순간의 authoritative player 위치로 피해 판정
6. shield 소비 또는 사망 처리
7. 사망 AI item drop과 respawn 위치 확정
8. 기존 crate respawn schedule 처리
9. flame lifetime 갱신
10. 하나의 mutation batch commit
11. chunk/entity delta publication

폭발 피해를 fuse 1 시점에 예약하지 않는다. 5번 시점에 폭발 칸에 없는 player는
피해를 받지 않는다.

## 8. 폭발 범위

- bomb 칸을 포함한다.
- 상하좌우로 range만큼 진행한다.
- permanent wall 앞에서 중단하고 wall 칸은 flame에 포함하지 않는다.
- crate 칸은 flame에 포함하고 그 뒤는 진행하지 않는다.
- 같은 칸은 한 tick에서 한 번만 피해와 crate mutation을 만든다.
- chain reaction을 지원하면 flame에 닿은 bomb의 같은 tick 폭발을 명시적으로
  queue에 추가한다. 지원 전에는 이 규칙을 구현한 것처럼 표시하지 않는다.

## 9. 사망, AI와 아이템

- shield가 있으면 피해 한 번에 shield 1을 소비하고 살아남는다.
- 사람은 사망 상태가 되고 명시적 respawn command 전까지 움직이지 않는다.
- AI가 죽으면 사망 칸에 bomb, shield, flame 중 하나의 item을 생성한다.
- item 종류 결정은 deterministic random source를 사용해 replay 가능한 결과를
  만든다.
- AI respawn도 World Owner의 spawn 계약을 사용한다.
- player가 item 칸으로 이동을 commit할 때 item 획득과 능력치 변경을 같은
  transaction으로 처리한다.

## 10. AI

- AI Controller는 World read snapshot으로 다음 intent만 결정한다.
- AI는 player/entity Map, bomb Map과 tile을 직접 바꾸지 않는다.
- 이동, 폭탄 수, 충돌, 피해와 item 규칙은 사람과 동일한 command path를 사용한다.
- 사람이 없을 때 불필요한 pathfinding과 broadcast를 하지 않는다.
- 최초 Sprint는 현재 nearest-human heuristic을 보존하고 AI 품질 개선은 범위
  밖으로 둔다.

## 11. Mutation Batch

한 command 또는 world tick 결과는 다음 정보를 가진다.

- changed chunks와 새 revisions
- created/updated/removed entities
- player-specific ack/correction
- world tick/frame metadata

World Owner가 batch 전체를 commit한 뒤에만 Gateway가 publication을 시작한다.
부분 commit 상태를 socket에 보이지 않는다.

## 12. 장애와 복구

- malformed input은 연결 전체를 죽이지 않고 reject/ignore policy를 따른다.
- 처리 중 예외가 난 mutation batch는 canonical state에 일부 적용되지 않아야 한다.
- timer는 `unref`할 수 있지만 shutdown에서 중지하고 socket과 server를 순서대로
  닫는다.
- 과부하 때 tile snapshot을 반복 생성하지 않고 느린 client의 buffered amount를
  관찰해 연결을 정리할 수 있다.

## 13. 검증 계약

- 이동 성공/벽·상자·폭탄·player 충돌 실패
- 중복 sequence가 이동을 두 번 적용하지 않음
- key release가 성공한 이동을 되돌리지 않음
- bomb가 command 순간 player tile에 설치됨
- fuse 1 때 범위에 있었지만 폭발 순간 벗어난 player가 생존
- wall/crate에서 blast가 정확히 중단
- shield 1회 소비
- AI 사망 위치 item drop과 동일 command path respawn
- player 9×9 respawn schedule 연기와 commit 이후 유지
- timer 지연 뒤 tick catch-up 및 중복 폭발 없음
- mutation batch publication 전 원자 commit

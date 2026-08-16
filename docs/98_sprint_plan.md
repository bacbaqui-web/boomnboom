# Tactical AI Sprint

## 상태

- Sprint 완료
- 1단계 위험 시간 지도와 bounded 경로 탐색: PASS
- 2단계 생존·아이템·공격 전술: PASS
- 3단계 성향·기억·공용 command 통합: PASS
- 4단계 부하·회귀·문서 검증: PASS
- commit/push와 Oracle/Sites 배포: 완료

## 1. 목표

AI 6명이 벽을 향해 단순 이동하거나 무조건 폭탄을 놓는 상태에서 벗어나 다음을
수행하게 한다.

1. 예정된 폭발과 live flame을 피한다.
2. 안전한 아이템을 가까우면 우선 획득한다.
3. 사람 또는 상자를 맞힐 수 있고 탈출 경로가 있을 때만 폭탄을 놓는다.
4. 장애물을 우회해 공격 위치와 상자 근처로 이동한다.
5. 모든 AI가 같은 행동을 하지 않되 안전 규칙은 공통으로 지킨다.

Server Authority, World Owner 단일 mutation 경계와 Protocol V3 fixed simulation은
변경하지 않는다. AI는 계획만 만들고 canonical 결과는 기존 command/simulation이
확정한다.

## 2. Preserve 계약

- 사람과 AI가 같은 30Hz movement core, collision과 bomb authority 사용
- AI decision cadence 500ms
- AI 6명, 사람 추적과 AI 사망 item drop
- 폭탄 fuse 90 fixed tick, chain explosion, shield와 current-position damage
- 128MiB Oracle 단일 process와 현재 WebSocket V2/V3 계약
- crate 영구 파괴, endless chunk world와 결정적 terrain
- 모든 production/test 파일 500줄 미만과 한 파일 한 주책임

## 3. 범위 밖

- machine learning, behavior tree framework, ECS와 generic planner
- navmesh 사전 생성과 전 월드 경로 탐색
- 사람 입력 예측, 팀 전술과 bot 간 통신
- 난이도 UI, 계정별 MMR와 persistent AI 학습
- gameplay speed, 폭탄 화력, item 확률과 spawn 규칙 변경
- client rendering, protocol schema와 배포 구성 변경

## 4. 책임 구조

```text
500ms AI timer
  → Bot Controller: snapshot 1회, danger map 1회, bot memory/metrics
      → Danger Map: 폭탄·연쇄·flame의 cell별 위험 tick
      → Tactics: 우선순위와 폭탄 안전성
          → Pathfinder: bounded BFS
          → Personality: 탐색 예산과 안전한 비최적 선택
  → Bot Command Driver
  → 사람과 같은 Command Buffer
  → 30Hz Movement/Bomb/Explosion System
  → World Owner commit
```

### 파일별 단일 책임

| 파일 | 책임 |
|---|---|
| `bot-danger-map.mjs` | 시간축 위험 cell projection |
| `bot-pathfinder.mjs` | bounded grid BFS |
| `bot-personality.mjs` | deterministic profile tuning |
| `bot-tactics.mjs` | 한 bot의 전술 우선순위 결정 |
| `bot-controller.mjs` | snapshot 공유, bot memory와 metric 조립 |
| `bot-command-driver.mjs` | intent를 공용 fixed command로 변환 |

## 5. 전술 규칙

### 위험 지도

- active flame은 현재부터 `expireTick`까지 위험하다.
- bomb은 `explodeTick`에 blast cell을 만들고 flame lifetime 동안 위험하다.
- blast가 다른 bomb에 닿으면 같은 tick에 연쇄 폭발한다고 예측한다.
- permanent wall은 blast를 막는다.
- crate는 실제 폭발 순서와 다른 보수적 오판을 피하려고 danger prediction에서는
  안전을 넓게 잡되, 실제 공격 blast 계산에서는 canonical crate 차단 규칙을 쓴다.

### 경로 탐색

- 네 방향 cell BFS만 사용한다.
- profile별 최대 8~12칸, 최대 256~512개 방문으로 제한한다.
- 도착 예상 tick에 wall/crate/bomb/player 또는 위험 구간과 겹치는 cell은 버린다.
- 전체 맵이나 materialized chunk를 복사하지 않는다.

### 행동 우선순위

1. 현재 cell이 fuse/flame 위험이면 안전 cell로 탈출
2. bounded 반경의 안전한 item으로 이동
3. 현재 폭탄으로 사람 또는 crate를 맞힐 수 있고 탈출 가능하면 bomb
4. 사람을 blast line에 넣을 수 있는 cell로 우회 추적
5. crate를 맞힐 수 있는 cell로 접근
6. 안전한 방향으로 배회, 없으면 wait

폭탄 탈출 검사는 후보 폭탄을 위험 지도에 포함한 뒤 다시 경로를 찾는다. 성향 실수는
escape, bomb placement와 blocked 결과에는 적용하지 않는다.

## 6. 기억과 성향

- bot memory는 target ID/lock expiry, 마지막 cell/action, 막힘 횟수, bomb cooldown과
  decision number만 보관한다.
- 목표는 profile별 짧은 tick 동안 유지해 가까운 사람이 잠깐 바뀌어도 방향을 자주
  뒤집지 않는다.
- 이동 intent를 냈는데 같은 cell에 두 번 머물면 직전 방향을 다음 탐색의 후순위로
  내린다.
- rookie/balanced/hunter는 탐색 거리, item 관심, 탈출 lookahead와 cooldown만 다르다.
- 낮은 빈도의 deterministic 실수는 안전 후보 중 두 번째 이동을 고르는 방식이다.

## 7. 부하 한계와 운영 지표

- 한 decision cycle에서 World Owner entity snapshot과 danger map은 각각 1회다.
- bot별 path search 최대 4회, 방문 수는 profile 상한을 넘지 않는다.
- 사람이 없으면 AI intent와 path search는 0건이다.
- health scheduler metric은 identity 없이 다음 aggregate만 공개한다.
  - 누적 decisions
  - 최근 bot 수와 search 수
  - bot 하나의 최대 search 수
  - 최근 decision 소요 ms
  - reason별 누적 횟수

## 8. 단계별 결과

### 1단계 — Danger Map과 Pathfinder

상태: **PASS**

- fuse, live flame, wall 차단과 same-tick chain projection 구현
- bounded BFS의 obstacle 우회, 거리/방문 상한 구현
- tick wrap-safe 비교와 기존 explosion blast helper 재사용

Rollback: 새 danger/pathfinder와 해당 테스트 제거

### 2단계 — Tactical Priority

상태: **PASS**

- 생존, item, 공격 폭탄, 추적, crate 접근과 배회 순서 구현
- candidate bomb을 포함한 escape simulation 구현
- speed item에 따른 예상 cell 도착 tick 반영

Rollback: controller에서 기존 nearest-human decision으로 되돌리고 tactics 제거

### 3단계 — Personality, Memory와 Runtime 통합

상태: **PASS**

- 세 deterministic profile, 안전 후보 안의 낮은 빈도 실수 구현
- target lock, stuck direction 후순위와 bomb cooldown 구현
- controller snapshot/danger map 공유와 identity-free aggregate metric 구현
- 기존 Bot Command Driver와 30Hz authoritative simulation 경로 유지

Rollback: 새 controller 조립만 기존 stateless heuristic으로 복원

### 4단계 — 회귀와 운영 검증

상태: **PASS**

완료 조건:

- AI tactical/server 전체 test PASS
- root build/client test, lint, TypeScript와 syntax PASS
- 모든 source/test 500줄 미만, dead import와 `git diff --check` PASS
- local V3 실제 연결에서 AI 6명 이동과 폭탄 확인
- `/health`에서 fixed backlog 0, RSS 128MiB 이내와 bounded AI search 확인
- source map, simulation architecture와 최근 작업 보고 갱신

결과:

- tactical AI 18건과 server 전체 95건 PASS
- root production build/client 89건, ESLint와 TypeScript PASS
- local V3 human 연결에서 AI 6명 전원 이동, 동시 bomb 최대 6개 관찰
- local RSS 약 89MB, fixed backlog 0, AI 6명의 최근 decision 약 1ms와 search
  11건 확인
- source/test 500줄 미만, Node syntax와 `git diff --check` PASS

## 9. 배포 순서와 Rollback

이번 Sprint는 server-only product change다. 다음 순서로 배포했다.

1. 변경 파일과 검증 결과 재확인
2. Oracle 기존 server/shared rollback artifact 확보
3. server 배치와 service restart
4. `/boom-health`, V2/V3 upgrade와 V3 human+AI smoke
5. RSS, fixed backlog와 AI decision duration 관찰

배포 결과:

- GitHub `main`에 AI 구현 commit을 push
- Oracle 기존 server/shared를 별도 복구 디렉터리에 보존하고 service restart
- 원격 staging에서 server test 95건과 Node syntax PASS 뒤 교체
- 공개 V3에서 human input ACK, AI 6명 전원 이동과 동시 bomb 최대 6개 확인
- 공개 health `ok`, RSS 약 83MB, fixed backlog 0, AI decision 약 2ms 확인
- protocol/client payload 변경은 없지만 동일 source의 Sites version도 게시

이상 시 Sites는 건드리지 않고 Oracle server만 보존한 이전 artifact로 되돌릴 수 있다.

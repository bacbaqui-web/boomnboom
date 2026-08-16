# BOOMnBOOM 최근 작업 보고서

## 최근 Task — Tactical AI 1차 구현

### 목표

AI가 가장 가까운 사람 쪽으로만 움직이고 조건이 맞으면 바로 폭탄을 놓던 단순 규칙을
실제 플레이 가능한 전술 AI로 교체한다. 서버 권한과 기존 movement/bomb system은
유지하고 AI는 사람과 같은 intent만 보내도록 한다.

### 구현한 판단 순서

1. bomb fuse, chain explosion과 live flame의 시간 위험을 먼저 계산한다.
2. 현재 또는 이동 예정 cell이 위험하면 bounded BFS로 탈출한다.
3. 안전한 가까운 item이 있으면 획득한다.
4. 사람 또는 crate를 맞힐 수 있고 후보 폭탄에서 탈출할 수 있을 때만 폭탄을 놓는다.
5. 장애물을 우회해 사람을 blast line에 넣을 위치로 추적한다.
6. 공격 위치가 없으면 crate 근처로 이동하고, 마지막으로 안전하게 배회한다.

### 책임별 파일

- `bot-danger-map.mjs`: 시간축 위험 지도
- `bot-pathfinder.mjs`: bounded BFS
- `bot-personality.mjs`: rookie/balanced/hunter tuning과 deterministic 안전 실수
- `bot-tactics.mjs`: 한 bot의 전술 우선순위
- `bot-controller.mjs`: snapshot 공유, 목표/막힘/cooldown memory와 aggregate metric
- 기존 `bot-command-driver.mjs`: 선택된 intent를 사람과 같은 fixed command로 변환

### 유지한 계약

- AI는 World Owner를 직접 변경하지 않는다.
- 이동은 사람과 같은 30Hz shared Movement Core를 사용한다.
- 폭탄, 폭발, 피해와 item 획득은 기존 Server Authority가 확정한다.
- decision은 기존처럼 500ms마다 실행하며 사람 없을 때 path search는 0건이다.
- protocol/client payload, gameplay balance와 Sites 코드는 변경하지 않았다.

### 성능 경계

- danger map과 world snapshot은 6명이 공유한다.
- bot별 path search 최대 4회, 탐색 거리는 8~12칸, 방문 수는 256~512개로 제한한다.
- health에는 player ID 없이 decision 수, 최근 search 수, 소요 시간과 reason count만 낸다.

### 검증

- tactical AI 18건 PASS
- server 전체 회귀 95건 PASS
- root production build와 client test 89건 PASS
- ESLint, TypeScript, Node syntax와 `git diff --check` PASS
- local V3 실제 접속에서 AI 6명 모두 이동, 폭탄 최대 6개 관찰
- local RSS 약 89MB, AI 6명 최근 decision 약 1ms, fixed backlog 0 확인
- 모든 source/test 파일 500줄 미만 확인

### 외부 반영 상태

- commit, push와 Oracle/Sites 배포는 실행하지 않았다.
- 이번 변경은 server-only이므로 배포 요청 시 Oracle server만 먼저 교체하고 health와
  실제 V3 human+AI 흐름을 확인한다.

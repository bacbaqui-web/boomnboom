# Player Squash and Jump Animation 완료 보고

## 최근 Task

모든 player 캐릭터에 바닥 기준 대기 squash와 인접 칸 점프 animation을
적용했다. 서버 위치와 카메라 이동은 바꾸지 않고 화면용 캐릭터 body만 변형한다.

## 대기 Animation

- 기준점: 캐릭터 바닥 중앙
- 주기: 500ms
- 시작/끝: X 102%, Y 98%
- 중간: X 98%, Y 102%
- 같은 pose를 계속 반복

## 이동 Animation

- 출발: X 105%, Y 90%, 바닥 높이 0px
- 최고점: X 90%, Y 105%, 바닥에서 10px
- 착지: X 105%, Y 90%, 바닥 높이 0px
- 착지 pose가 보이도록 마지막 구간에 잠시 유지
- 한 칸 이동에만 실행하고 teleport/respawn에는 실행하지 않음

## 구조

- 바깥 `playerAnchor`가 local 중앙 배치와 remote 좌표 이동을 담당
- 안쪽 `PlayerAvatar`가 캐릭터 모양, nickname, shield와 action cue를 담당
- `player-animation.ts`가 jump 높이, 시간과 keyframe pose를 담당
- 위치 transform과 body animation이 서로 덮어쓰지 않음

## 검증

- 요청한 scale, 10px 높이와 바닥 기준점을 contract test로 확인
- production build와 client unit/contract/SSR 19/19 PASS
- root ESLint와 TypeScript PASS
- server world/simulation/network 25/25 PASS
- `git diff --check` PASS

## Git과 배포

이번 Task에서는 commit, push, Oracle 배포와 Sites 배포를 수행하지 않았다.

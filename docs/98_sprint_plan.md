# AI Balance, Crate Respawn and Terrain Render Sprint

## 상태

- 구현: PASS
- 로컬 자동 검증: PASS
- commit/push, Sites와 Oracle 배포: PASS

## 목표

1. AI가 아이템으로 강해지거나 사람용 아이템을 빼앗지 않게 한다.
2. AI의 생존 규칙은 유지하되 탐색·폭탄 빈도와 비최적 선택을 완화한다.
3. 파괴된 노란 상자를 12초 뒤 복구하고 3초 전 장판으로 알린다.
4. 서버가 정상인데도 남는 체감 렉의 client terrain hot path를 줄인다.

## Preserve와 범위 밖

- Server Authority, 30Hz fixed simulation, 15Hz snapshot과 V2 rollback을 유지한다.
- 사람의 bomb/range/shield/speed 아이템과 AI 사망 drop을 유지한다.
- 폭발, 연쇄 폭발, 현재 위치 damage, 점프와 효과음은 바꾸지 않는다.
- protocol message type을 추가하지 않고 기존 chunk revision/delta를 사용한다.
- AI를 고의로 폭발에 죽게 만들거나 이동속도를 다르게 만들지 않는다.

## 구현 Manifest

### 1. AI 밸런스

- fixed와 legacy movement 모두 `isAI` player가 item을 소비하지 않는다.
- Bot Controller snapshot과 Tactics에서 item 목표를 제거한다.
- 탐색 거리를 6~10칸으로 줄이고 bomb cooldown을 30~45 tick으로 늘린다.
- 안전 후보 중 비최적 선택을 더 자주 하되 escape와 bomb escape 검증은 유지한다.

### 2. Crate Respawn

- World Owner가 성공한 crate destruction을 한 번 queue한다.
- 독립 Crate Respawn System이 30Hz fixed tick에서 상태를 관리한다.
- 파괴 9초 뒤 warning을 시도하고 모든 alive player의 9×9 밖일 때만 표시한다.
- warning을 실제 표시한 tick에서 정확히 3초 뒤 crate를 복구한다.
- warning 뒤 접근은 복구를 취소하지 않는 기존 제품 결정을 유지한다.

### 3. Terrain Render

- viewport와 겹치는 최대 4청크 cache selector는 유지한다.
- chunk의 256 floor DOM을 CSS checkerboard 배경 하나로 교체한다.
- wall, crate와 warning만 개별 DOM을 만든다.
- warning은 animation 없는 연한 노란 장판으로 표시한다.

## 검증

- AI item 미획득과 item 비추적 테스트
- crate destroy queue, 9초 warning, 3초 restore, 9×9 억제와 uint32 wrap 테스트
- warning tile client type/render와 floor DOM 제거 contract 테스트
- root build/client test, ESLint, TypeScript와 server 전체 regression
- source/test 500줄 미만, Node syntax와 `git diff --check`
- 배포 후 Sites HTTP, Oracle health, V2/V3 join/input과 crate live 흐름

## Rollback

- AI: controller/tactics/profile과 두 item guard만 이전 commit으로 복원
- crate: main에서 Crate Respawn System 조립 제거 후 World Owner warning methods 제거
- render: TerrainLayer를 cell grid로 되돌리는 client-only rollback
- Sites와 Oracle은 별도 단계로 배포하고 각각 직전 artifact를 보존한다.

## 로컬 결과

- root production build/client 92건, ESLint와 TypeScript PASS
- server regression 101건과 전체 `.mjs` syntax PASS
- source/test 전부 500줄 미만, `git diff --check` PASS
- server WebSocket 의존성의 iCloud placeholder를 `npm ci`로 다시 설치한 뒤 실제
  V2/V3 gateway 통합 테스트까지 통과

## 배포 결과

- GitHub `main` 구현 commit `2e79cea` push
- Sites version 65 production publish, 공개 page HTTP 200
- Oracle staging에서 root golden fixture까지 포함해 server 101건과 syntax PASS
- Oracle 기존 `server/shared`를
  `/home/ubuntu/deploy-backups/boomnboom-20260816-050145-before-2e79cea`에 보존
- `boomnboom` service active, 공개 V3 join/input ACK와 V2 25청크/input ACK PASS
- 공개 health `ok`, Protocol `[2,3]`, fixed backlog 0, 확인 시 RSS 약 80MB
- Edge에서 cache-busting `?render=65` 주소로 최신 공개 게임을 열어둠

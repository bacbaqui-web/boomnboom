# File Responsibility Cleanup 완료 보고

## 최근 Task

파일명만 보고 주된 변경 책임을 예측할 수 있도록 server entry/Gateway와 client
Store/render/UI를 책임 단위로 분리했다. Protocol V2, gameplay 수치, 화면 결과와
배포 설정 값은 변경하지 않았다.

## 서버 구조

- `server/index.mjs`: `startServer()` 호출만 담당
- `config.mjs`, `world-timeline.mjs`, `simulation-scheduler.mjs`,
  `health-handler.mjs`, `main.mjs`: 설정·시간·timer·health·lifecycle 분리
- `websocket-gateway.mjs`: upgrade, connection과 message routing
- `websocket-session.mjs`, `chunk-interest.mjs`, `entity-projector.mjs`,
  `world-publisher.mjs`, `backpressure-sender.mjs`: session·관심 영역·projection·전송 분리
- `spawn.mjs`를 `spawn-finder.mjs`로 변경

## 클라이언트 구조

- `world-state.ts`, `world-message-applier.ts`, `world-selectors.ts`, `world-store.ts`:
  Runtime shape·message 적용·조회·subscription façade 분리
- `position-interpolator.ts`와 `camera-runtime.ts`: 공통 보간과 camera projection 분리
- `EntityLayer.tsx`, `EnemyPointers.tsx`, `entity-selectors.ts`: entity·화살표·조회 분리
- Header/Tick HUD/Legend, Join/Death Overlay와 Player Status를 독립 파일로 분리

## 이름 정리

- `build/hosting-metadata-plugin.ts`: 실제 Sites metadata packaging 책임을 표시
- `server/insight-magamiscom-ing.nginx`: 전체 virtual host 설정임을 표시
- production module별 test 파일로 `world-core.test.mjs`와 혼합 contract test를 분리
- `docs/99_recent_task 2.md`는 기존 사용자 파일로 보존

## 검증

- 500줄 이상 code file 0건
- root ESLint와 TypeScript PASS
- production build와 client unit/contract/SSR 18/18 PASS
- server world/simulation/network 26/26 PASS
- 임시 port health와 Protocol V2 `hello.supportedProtocols=[2]` PASS
- `git diff --check`, stale filename/import와 source map 일치 검사 PASS

## 배포

이번 Task에서는 commit, push, Oracle 배포와 Sites 배포를 수행하지 않았다.

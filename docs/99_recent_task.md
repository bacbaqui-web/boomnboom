# Shared World Refactor 배포 진행 보고

## 최근 Task

대규모 refactor 6A로 caller가 없는 D1/starter 경로를 제거했다. Oracle에는
Protocol V1/V2를 함께 받는 새 World Owner 서버를 먼저 배포했고, health와 실제
WebSocket V1/V2 연결을 확인했다. 공개 Sites client 배포 전 로컬 브라우저 두 창,
모바일 viewport, 폭탄 layer와 음량 UI를 검증했다. 공개 Sites version 40에서도
같은 화면과 즉시 이동을 확인했다.

이동 QA에서 입력 뒤 서버 왕복을 기다리는 약 160ms 정지와 tile별 ease-out 감속을
찾았다. canonical server 좌표는 그대로 유지하면서 client pending input이 한 칸
앞의 visual target을 즉시 만들고, ack/correction으로 수렴하도록 수정했다. camera는
175ms linear retarget으로 연속 입력 사이의 정지를 없애고 마지막 승인 칸 중심에
정확히 정착한다. 추가 review에서 찾은 재연결 pending 보존, 닫힌 socket sequence,
벽 hold speculative 이동도 session/life reset, send 성공 반환과 client
terrain/entity preflight로 막았다.

## 제거 Manifest

- D1 routes: `app/api/world`, `app/api/match`, `app/api/rooms`
- persistence starter: `db/`, `drizzle/`, `drizzle.config.ts`, `examples/d1/`
- package/config: Drizzle dependency, `db:generate`, Sites `DB` binding과 migration 복사
- unused UI/helper: `app/multiplayer.css`, `app/chatgpt-auth.ts`
- unused starter asset: `README 2.md`, `public/file.svg`, `public/globe.svg`,
  `public/window.svg`

`.openai/hosting.json`의 기존 `project_id`는 변경하지 않았다. BGM, favicon과 제품 OG
asset도 보존했다.

## 보존한 전환 경계

Oracle Gateway의 Protocol V1/V2 동시 수용은 유지한다. Oracle server를 먼저
배포하고 검증한 뒤 V2 Sites client를 배포해도 이전 공개 client와 Sites rollback이
작동해야 하기 때문이다. V1 serializer는 실제 V1 traffic 0을 확인한 뒤 제거한다.

## 검증

- root ESLint: 오류/경고 0
- TypeScript `--noEmit`: 오류 0
- client production build + tests: 17/17 PASS
- server tests: 27/27 PASS
- D1/Drizzle/auth/style/starter asset caller audit: 0건
- `git diff --check`, syntax와 health smoke: PASS

## 다음 Task

1. 현재 검증한 source commit을 GitHub와 Sites source repository에 push
2. Sites에 V2 client를 배포하고 공개 브라우저 shared-world QA
3. 10분 traffic/RSS 관찰 뒤 V1 serializer/state 전체 tile 경로 제거

## 남은 위험

- 공개 URL의 이전 D1 API 직접 사용 여부는 코드 caller 0과 별개이므로 배포 뒤
  access log에서 확인해야 한다.
- retained/pinned chunk와 RSS가 장시간 이동에서 128MB 안에 머무는지 10분 이상
  관찰해야 한다.
- 실제 모바일 pointer, BGM drift와 두 창의 폭탄/상자 revision은 브라우저 QA가
  필요하다.

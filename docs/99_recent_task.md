# BOOMnBOOM 최근 작업 보고서

## 최근 Task — 256×256 고정 맵과 authoritative 위치 재결합

### 요청

- 무제한 맵 대신 모든 타일과 상자를 미리 확정한 유한 맵을 사용한다.
- 이동과 폭탄을 절대 월드 좌표 기준으로 처리한다.
- local 화면과 server 폭탄 위치가 달라지는 오류를 줄인다.

### 변경

- production world를 256×256로 고정하고 server boot에서 256청크를 전부 materialize한다.
- perimeter/bounds 바깥을 wall로 만들고 client interest를 유효 청크로 제한한다.
- world metadata에 크기를 전달하고 `FINITE_WORLD_256_V1` identity로 기존 cache와 분리한다.
- spawn/respawn 후보를 유한 맵 안에서 매번 다른 sequence로 검색한다.
- 30Hz owner snapshot에서 authoritative movement를 복원하고 미처리 input만 replay한다.
- 판정 위치는 즉시 서버에 수렴시키되 화면은 render-only offset으로 100~180ms 보정한다.
- 폭탄 cell은 화면 offset이 아니라 reconcile된 fixed position에서 계산한다.

### 현재 상태

- 구현, 로컬 검증, commit/push와 Oracle·Sites 배포 완료
- root production build/client 93건, server regression 109건 PASS
- 256청크 materialize 약 30ms, 로컬 RSS 증가 약 12MB
- 200/300ms RTT·jitter·receive stall correction 0.5칸 이하
- ESLint, TypeScript, source 500줄 미만, diff check PASS
- GitHub `main`: 제품 `87cd007`, 최종 배포 source `3220d90`
- Oracle: world `FINITE_WORLD_256_V1`, 256×256, 256청크, 확인 시 RSS 약 82MB/128MB
- public V3 두 접속자와 V2 rollback에서 동일 world·bomb cell 확인
- Sites version 71 배포 및 Edge 실제 nickname 입장, AI 6명, 초기 stat 렌더 PASS
- 공개 주소: `https://bubble-boom-arcade.bacbaqui2.chatgpt.site/`

### Rollback

- Oracle backup: `/home/ubuntu/deploy-backups/boomnboom-20260816-fixed-world-before-87cd007`
- 웹은 Sites 직전 version으로 되돌리거나 `?protocol=2`로 V2 경로를 확인한다.

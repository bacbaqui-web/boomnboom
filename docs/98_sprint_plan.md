# Fixed World and Authoritative Reconciliation Sprint

## 상태

- 구현·로컬 검증: PASS
- commit/push와 Oracle·Sites 배포: PENDING

## 목표

production 월드를 256×256 유한 맵으로 고정하고 모든 타일을 server boot에서 확정한다.
local prediction은 즉시 반응을 유지하되 30Hz owner snapshot에서 authoritative state를
복원하고 pending input만 replay해 폭탄·충돌 위치가 누적해서 어긋나지 않게 한다.

## 구현 Manifest

1. `world-bounds.mjs`가 production 256×256 bounds와 chunk range를 소유한다.
2. 서버 시작 시 16×16 청크 256개를 전부 materialize하고 유한 맵에서는 trim하지 않는다.
3. 외곽 한 칸과 bounds 바깥은 permanent wall이며 interest는 0..15 청크로 제한한다.
4. `world_init`에 `worldWidth/worldHeight`를 전달하고 새 world ID로 client cache를 분리한다.
5. spawn/respawn은 기존 지형을 바꾸지 않으며 매 spawn sequence마다 다른 안전 후보를 쓴다.
6. local predictor는 owner snapshot restore 뒤 ACK되지 않은 input만 shared movement core로 replay한다.
7. render-only correction은 0.75칸 이하 차이를 100~180ms에 흡수하고 큰 수명 전환은 snap한다.
8. bomb preview cell은 보정된 화면 transform이 아니라 reconcile된 simulation position을 쓴다.

## Preserve와 위험

- server authority, 30Hz movement/snapshot, 초당 3칸, V2 rollback, AI, 폭탄·아이템·상자
  복구와 BGM 계약을 보존한다.
- client에는 주변 청크만 전송해 65,536개 타일 전체를 내려보내지 않는다.
- 256청크 선행 materialize는 로컬에서 약 30ms, RSS 약 12MB가 추가됐다. Oracle 128MB
  환경의 배포 후 RSS와 두 접속자 smoke를 확인해야 한다.
- 일반 network jitter의 replay correction은 deterministic harness에서 0.5칸 이하다.

## 검증 결과

- root production build와 client test 93/93 PASS
- server regression 109/109 PASS
- 200/300ms RTT, 50ms jitter와 receive stall replay correction 0.5칸 이하
- finite 256청크 1회 materialize, perimeter wall, bounded interest/spawn PASS
- ESLint, TypeScript, source 500줄 미만과 `git diff --check` PASS

## Rollback

Oracle server를 직전 unbounded world build로 되돌리고 Sites client를 직전
correction-free build로 되돌리는 두 단계다. world ID가 달라 client chunk cache가 섞이지 않는다.

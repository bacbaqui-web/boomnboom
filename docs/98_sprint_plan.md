# AI Drop Item Lifetime Sprint

## 상태

- 구현: PASS
- 로컬 검증: PASS
- commit/push·Sites/Oracle 배포: PASS

## 목표

아이템은 AI를 잡은 위치에서만 생기고 사람이 먹지 않으면 10초 뒤 공유 월드에서
사라지게 한다. 기존 아이템 효과, AI 무획득, Server Authority와 V2/V3 계약은 유지한다.

## 확인한 현재 상태

- production item 생성 호출은 V3와 V2 rollback의 AI death branch 두 곳뿐이다.
- 사람 death, crate destruction과 terrain generation은 item을 만들지 않는다.
- 기존 item에는 만료 시각이 없어 AI death가 반복될수록 월드에 누적됐다.

## 구현 Manifest

1. V3 AI drop에 `spawnTick`과 300 fixed tick 뒤 `expireTick`을 기록한다.
2. 독립 Item Lifecycle System이 V2 rollback drop에도 다음 fixed step에서 10초 수명을 붙인다.
3. 매 30Hz step 시작에서 만료 item을 World Owner command로 제거한다.
4. 사람이 먼저 획득한 item은 만료 시 다시 생기지 않는다.
5. late join과 V2/V3 snapshot은 기존 item entity에 absolute `expireTick`을 그대로 포함한다.

## 검증

- V3 AI death만 drop을 만들고 정확한 expire tick을 갖는지 확인
- 사람 death item 0건, item 선획득 뒤 재생성 0건
- 10초 경계와 uint32 wrap-safe expiry
- V2/V3 gateway, root build/client, lint, TypeScript와 server 전체 regression
- 모든 source/test 500줄 미만, syntax와 `git diff --check`
- 배포 후 공개 V2/V3 join/input, health와 service 확인

## Rollback

`main.mjs`에서 Item Lifecycle System 조립을 제거하고 AI drop의 두 tick field와
World Owner item update command를 되돌리는 server 단위다. Protocol message 종류와
client UI를 바꾸지 않으므로 Sites와 Oracle을 독립적으로 복구할 수 있다.

## 로컬 결과

- root production build/client 92건, ESLint와 TypeScript PASS
- server regression 106건과 전체 `.mjs` syntax PASS
- source/test 전부 500줄 미만, `git diff --check` PASS

## 배포 결과

- GitHub `main` 구현 commit `35f73a2` push
- Sites version 66 production publish, 공개 page HTTP 200
- Oracle staging에서 server 106건과 syntax PASS
- 기존 `server/shared`를
  `/home/ubuntu/deploy-backups/boomnboom-20260816-051417-before-35f73a2`에 보존
- 공개 V3 25청크/join/input ACK와 V2 25청크/input ACK PASS
- service active, health `ok`, Protocol `[2,3]`, fixed backlog 0, RSS 약 78MB

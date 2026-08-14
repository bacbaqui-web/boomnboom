# 6단계 Shared World Refactor 완료 보고

## 최근 Task

공개 Sites와 Oracle의 10분 production soak에서 V1 traffic 0을 확인한 뒤 Protocol V1
serializer와 Gateway 분기를 제거했다. V2-only source를 GitHub와 Oracle에 배포했고,
공개 web client는 이동 보정을 포함한 Sites v41로 운영 중이다.

## Production 근거

- RSS: `85.6 → 87.3MB`
- materialized chunk: `59 → 62`
- Protocol V1 connection: 전 구간 0
- backpressure disconnect: 0
- 종료 event-loop lag: 4ms

## 제거와 변경

- 삭제: `server/src/network/protocol-v1.mjs`, `server/test/protocol-v1.test.mjs`
- 제거: `welcome/state`, viewer origin/tile matrix, V1 command와 session mode 분기
- 수용: 명시적 `?protocol=2` 또는 `boom-v2` subprotocol
- 거절: unversioned/Protocol 1 upgrade를 player 생성 전 426 처리
- health: supported `[2]`, unsupported reject count 추가
- 전환용 tombstone: `protocolV1:0`, `protocols.v1:0` 한 배포 유지

## 검증

- root ESLint, TypeScript, production build와 client tests
- server V2/world/simulation regression 26건
- V2 query/subprotocol 수용, protocol schema error와 구형 upgrade 무누수 거절
- server syntax, dead V1 symbol audit와 `git diff --check`
- Oracle 별도 staging directory에서 `npm ci --omit=dev`, server 26/26와 temp 3399 health
- 공개 nginx 경로 V2 hello/init/25청크/input ack, unversioned HTTP 426
- 공개 브라우저 재연결 뒤 25청크, nickname 유지와 입력 즉시 camera transform

## 배포와 Rollback

- 공개 게임: `https://bubble-boom-arcade.bacbaqui2.chatgpt.site`
- Sites version: 41
- Oracle active: `/home/ubuntu/boomnboom-server`
- Oracle dual rollback: `/home/ubuntu/boomnboom-server.backup-20260815-dual-v1-v2`
- Oracle pre-V2 rollback: `/home/ubuntu/boomnboom-server.backup-20260815-pre-v2`

## 후속 운영

- health의 `protocolV1:0`, `protocols.v1:0` tombstone은 모니터링 전환용으로 한 배포
  유지한다. 다음 안정화 점검에서 소비자 caller를 확인한 뒤 제거할 수 있다.
- 전투 runtime은 의도한 계약대로 Oracle process restart 때 초기화되고 base terrain만
  같은 seed/version으로 복원된다.

# Protocol V1 제거 완료 보고

## 최근 Task

공개 Sites v40과 dual-protocol Oracle server의 10분 production soak에서 V1 traffic
0을 확인한 뒤, 로컬 source에서 Protocol V1 serializer와 Gateway 분기를 제거했다.
Oracle, Sites와 Git에는 이번 V2-only 변경을 배포하지 않았다.

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

## 다음 Task

1. 직전 dual-protocol Oracle artifact를 rollback 대상으로 확인
2. V2-only Oracle server만 배포
3. `/health` supported `[2]`, V2 join/input과 unsupported reject metric 확인
4. 안정화 뒤 health V1 tombstone 제거 여부 결정

## 남은 위험

- 현재 production Oracle은 아직 dual-protocol build다.
- V2-only 배포 뒤 공개 Sites v40의 join/input/respawn을 다시 확인해야 한다.
- 426 reject가 nginx를 통과하는지 공개 unversioned WebSocket smoke가 필요하다.

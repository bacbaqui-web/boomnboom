# Network Protocol Architecture

## 1. 목적

이 문서는 Oracle WebSocket 서버와 웹 클라이언트 사이 Protocol V2의 역할,
메시지, revision과 배포 호환 경계를 정의한다.

## 2. 책임

WebSocket Gateway는 다음만 담당한다.

- 연결과 session 수명
- JSON parse와 protocol schema 검증
- client intent를 World Owner command로 전달
- player 관심 영역 계산 요청
- chunk/entity event 직렬화와 전송
- disconnect cleanup과 backpressure

Gateway는 tile을 생성하고 충돌, 폭발과 AI 판정을 수행하지 않는다. viewer별 카메라
원점과 viewport tile matrix도 만들지 않는다.

## 3. Version과 envelope

모든 V2 메시지는 다음 공통 필드를 가진다.

```text
{
  "protocol": 2,
  "type": "...",
  "serverTime": 0,
  "worldTick": 0
}
```

client input은 `clientSeq`, server player 결과는 `ackClientSeq`를 가진다. chunk
메시지는 `chunkKey`와 `revision`, entity batch는 `entityRevision`을 가진다.

## 4. 연결 흐름

```text
WebSocket open
  ← hello
client → join { nickname, protocol: 2 }
server ← world_init
server ← chunk_snapshot × preload chunks
server ← entity_snapshot
client → ready { knownChunkRevisions }
server/client ↔ input, ack, chunk_delta, entity_delta
```

`world_init`을 받기 전 client는 미확정 월드를 자체 생성하지 않는다. nickname을
검증하고 player가 생성된 뒤 preload 청크가 준비되어야 게임 화면을 연다.

## 5. Server messages

### `hello`

- protocol versions
- connection/session ID
- tick duration

### `world_init`

- world ID, seed identity와 generator version
- chunk size
- world clock과 BGM sync metadata
- local player authoritative state
- preload/visible radius
- initial entity revision

seed identity는 cache 구분과 진단용이다. client가 seed로 tile을 생성하는 권한을
주지 않는다.

### `chunk_snapshot`

- chunk key와 world origin
- revision
- compact tile payload
- pending respawn/warning projection

최초 구독, client cache miss 또는 revision gap 복구 때만 전송한다.

### `chunk_delta`

- chunk key
- `fromRevision`, `revision`
- changed cell index와 새 tile
- respawn schedule projection add/update/remove

client의 current revision이 `fromRevision`과 다르면 delta를 억지로 적용하지 않고
`chunk_resync`를 요청한다.

### `entity_snapshot`

- 관심 영역 안의 player, bomb, item과 flame 전체
- entity revision

### `entity_delta`

- created, updated, removed entity
- authoritative position과 server timestamp
- entity revision

이동은 tile snapshot을 동반하지 않는다. 관심 영역 진입/이탈은 entity
create/remove projection으로 표현하며 canonical entity 생명주기와 구분한다.

### `input_ack`

- ack client sequence
- accepted/rejected
- local player authoritative position/action
- reject reason 또는 correction metadata

### `interest_update`

- client가 새로 구독하거나 해제해야 하는 chunk keys
- 필요하면 뒤이어 chunk snapshot

### `error`

- protocol-safe code
- 사용자에게 노출 가능한 짧은 message
- recoverable 여부

secret, stack trace와 내부 경로를 보내지 않는다.

## 6. Client messages

### `join`

- protocol version
- 최대 12자의 정리된 nickname

### `input`

- client sequence
- action: movement/bomb/stop
- client가 마지막으로 확인한 local player revision

client 좌표는 요청 결과가 아니며 서버가 현재 canonical 위치에서 계산한다.

### `respawn`

- client sequence
- 현재 death revision

### `chunk_resync`

- chunk key
- client current revision 또는 cache miss

### `ping` / `pong`

- RTT와 연결 생존 확인
- 게임 판정 clock으로 사용하지 않음

## 7. 관심 영역과 preload

- client viewport는 기본 15×11 tile projection이다.
- server는 player 주변 반경 2청크의 initial/preload snapshot을 보낸다.
- player가 중심 청크를 이동하기 전에 다음 경계 청크를 interest에 추가한다.
- client는 화면보다 큰 cache에서 viewport를 자른다.
- interest 밖 entity를 매 frame 전송하지 않는다.
- 화면 밖 적 방향 UI에 필요한 적 요약은 낮은 빈도의 별도 projection으로
  보낼 수 있으며 전체 tile/entity snapshot을 요구하지 않는다.

## 8. Publication

- World Owner mutation batch가 commit된 뒤 changed chunk와 entity event를 얻는다.
- Gateway는 chunk subscriber와 entity interest를 기준으로 필요한 client에게만
  전송한다.
- 일반 player 이동은 entity delta와 input ack만 보낸다.
- crate 파괴/재생성은 해당 chunk delta를 구독자에게만 보낸다.
- tick clock UI를 위해 빈 world state 전체를 broadcast하지 않는다. 필요한
  clock metadata는 작은 heartbeat로 보정한다.

## 9. 순서와 복구

- WebSocket 단일 연결의 message order를 사용하되 revision gap을 항상 검증한다.
- reconnect는 새 session을 만들고 `world_init`으로 시작한다.
- client cache가 같은 world ID와 generator version이면 known revisions를 보낼 수
  있지만 서버가 유효성을 확인한다.
- stale entity delta와 이미 ack한 input 결과는 폐기한다.
- client prediction이 있더라도 correction을 authoritative 결과로 수렴시킨다.

## 10. Backpressure와 크기

- socket `bufferedAmount`가 상한을 넘으면 nonessential projection을 합치거나
  connection을 정리한다.
- 현재 JSON 구현의 상한은 512KiB이며 초과 connection은 retry 가능한 1013 code로
  정리한다.
- 같은 tick의 같은 chunk delta는 하나로 병합한다.
- tile payload는 JSON 배열로 먼저 정확성을 검증하고, 실제 측정이 필요할 때만
  compact encoding을 추가한다.
- gzip/binary protocol은 첫 구현의 필수 조건이 아니다.

## 11. V1 호환과 전환

현재 V1은 `welcome` 뒤 viewer별 `state` 전체를 전송한다. V2 전환 순서는 다음과
같다.

Server-first 기간에는 `/boom-ws?protocol=2` 또는 `boom-v2` WebSocket subprotocol로
V2를 선택하고, version 선택이 없는 기존 공개 client는 V1로 유지한다.

1. server 내부 World Owner를 만들고 V1 serializer가 새 read model을 사용
2. V2 message와 protocol test 추가
3. client에 V2 World Store와 render path 추가
4. local/staging에서 V2 검증
5. server가 V1/V2를 잠시 동시에 수용하거나 server-first 호환 배포
6. 공개 client를 V2로 전환
7. 연결 로그에서 V1 사용이 없음을 확인한 뒤 V1 serializer 삭제

Oracle server와 공개 client가 다른 시점에 배포되어도 최소 하나의 호환 경로가
있어야 한다.

## 12. 금지 사항

- 이동마다 23×19 `tiles` 전송
- server `stateFor(viewer)`에서 camera origin 계산
- client 좌표를 그대로 authoritative 결과로 적용
- revision gap이 난 delta 강제 적용
- protocol schema 없이 catch-all JSON mutation
- server/client 동시 강제 전환으로 rollback 불가 상태 생성

## 13. 검증 계약

- protocol schema fixture와 malformed input
- join → init → preload → ready 순서
- 이동 packet에 tile matrix 0건
- 동일 chunk 최초 snapshot 1회 후 delta만 수신
- revision gap에서 resync
- duplicate client sequence idempotency
- stale entity delta 폐기
- 관심 영역 진입 전 preload 완료
- 느린 client backpressure 처리
- V1/V2 compatibility 전환
- two-client가 같은 chunk revision과 폭발 결과 수신

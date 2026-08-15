# Network Protocol Architecture

## 1. 목적과 전환 상태

이 문서는 Protocol V3의 구현 계약을 정의한다. production은 현재 V2-only이며 V3는
아직 구현되지 않았다. V3 server를 V2 호환 상태로 먼저 배포하고 V3 client를 나중에
전환한다.

V3의 목적은 generic networking framework가 아니라 다음 다섯 가지다.

- future target tick command
- owner ACK와 full pending input replay
- absolute remote movement sample
- authoritative bomb/action result와 world event
- reconnect resume와 late join baseline

청크 revision, interest와 resync 원리는 현재 V2를 유지한다.

## 2. 책임 경계

```text
WebSocket Gateway
  ├─ Connection Registry / Resume Lease
  ├─ Protocol V2 Adapter during migration
  ├─ Protocol V3 Validator and Router
  ├─ Command Buffer input
  ├─ Chunk Publisher
  ├─ Entity Snapshot Publisher
  └─ Backpressure Sender
```

- Gateway는 connection과 message routing만 담당한다.
- Protocol validator는 schema와 size만 검증하고 gameplay를 계산하지 않는다.
- Command Buffer는 command를 simulation tick에 전달한다.
- Snapshot Publisher는 commit된 state를 absolute sample로 projection한다.
- client parser와 Store는 prediction, interpolation과 React rendering을 실행하지
  않는다.

## 3. Envelope와 순서 번호

모든 V3 server message는 다음 공통 필드를 가진다.

```text
{
  protocol: 3,
  type: string,
  serverTick: integer,
  serverTimeMs: integer
}
```

서로 다른 목적의 번호를 하나로 합치지 않는다.

- `commandSeq`: 한 player의 movement/action command 순서와 owner ACK
- `snapshotSeq`: 한 connection의 stale movement snapshot 폐기
- `eventSeq`: 한 connection의 world event 중복 폐기
- `chunk revision`: tile mutation gap과 resync
- `lifeId`: join/respawn lifecycle 전환과 forced snap

WebSocket 순서를 사용하되 client는 stale 번호를 검증한다. moving entity sample은
absolute state라 이전 snapshot delta가 없어도 적용할 수 있다.

## 4. Client Commands

### `input_state`

```text
{
  protocol: 3,
  type: "input_state",
  commandSeq,
  targetTick,
  direction: "up" | "down" | "left" | "right" | "neutral"
}
```

direction은 다음 command까지 유지되는 state다. key repeat마다 인접 칸 command를
보내지 않는다. 상태 변경은 즉시 보내고 연결 복구용 bounded heartbeat만 허용한다.

### `action_command`

```text
{
  protocol: 3,
  type: "action_command",
  commandSeq,
  targetTick,
  action: "bomb" | "respawn"
}
```

edge action은 coalesce하지 않는다. movement와 같은 sequence domain을 사용해 같은
tick 순서를 고정한다.

### 기타

- `join { nickname }`
- `resume { playerId, resumeToken }`
- `ready { baselineTick, knownChunkRevisions }`
- `chunk_resync { chunkKey, revision }`
- `ping { clientTimeMs }`

client position, velocity와 delta time은 command 결과로 받지 않는다.

## 5. Connection과 초기화

```text
WebSocket open
  ← hello(protocols, serverTick, tickRate, snapshotRate)
client → join 또는 resume
  ← world_init(baselineTick, player, resumeToken)
  ← chunk_snapshot × interest
  ← entity_snapshot(snapshotSeq, baselineTick)
client → ready(baselineTick, knownChunkRevisions)
  ↔ input/action, owner_snapshot, entity_snapshot, events
```

`world_init`, initial chunks와 entity snapshot은 하나의 synchronous baseline read에서
같은 `baselineTick`을 사용한다. initial entity snapshot 뒤 도착한 더 최신 update는
snapshot sequence로 정상 적용한다.

## 6. Owner Snapshot

local player는 snapshot마다 다음 absolute state를 받는다.

```text
owner_snapshot
  snapshotSeq
  serverTick
  lastProcessedCommandSeq
  player { px, py, vx, vy, direction, alive, lifeId, teleport }
  clock { rttEcho?, nextBeatTick }
```

ACK는 별도 input packet마다 보내지 않고 기본 15Hz snapshot에 piggyback한다. local
client는 ACK 이하 pending command를 제거하고 나머지를 replay한다.

## 7. Remote Entity Snapshot

moving entity sample은 다음 원칙을 따른다.

- 각 sample은 absolute `px, py, vx, vy`, `serverTick`, `lifeId`를 가진다.
- 움직이는 remote player는 기본 15Hz로 관심 영역 subscriber에게 보낸다.
- spawn, death, respawn과 forced relocation은 `teleport` 또는 새 `lifeId`를 가진다.
- stale `snapshotSeq`는 폐기한다.
- entity removed는 tombstone key로 전달한다.
- persistent bomb/flame/item의 현재 상태는 late join/reconnect snapshot에 포함한다.

moving entity를 이전 packet의 position delta에 의존시키지 않는다. JSON 크기를 줄이기
위해 generic binary codec을 먼저 만들지 않는다.

## 8. Action Result와 World Event

### `action_result`

bomb처럼 즉시 pending UI를 확정해야 하는 command에만 보낸다.

```text
action_result
  commandSeq
  action
  accepted
  reason?
  bombId?
  cell?
  spawnTick?
  explodeTick?
```

### `world_event`

```text
world_event
  eventSeq
  eventId
  eventTick
  kind: "explosion" | "shield_used" | "death"
  payload
```

event는 effect와 UI timing에 사용한다. World Owner snapshot이 canonical state이며
event 누락 때문에 bomb, flame와 death state가 영구적으로 달라지지 않아야 한다.
reconnect/late join client는 과거 effect를 replay하지 않고 현재 snapshot부터 시작한다.

## 9. Clock Sync와 Command Lead

- hello/ping/snapshot의 server time으로 offset, RTT와 jitter를 추정한다.
- 가장 낮은 RTT sample을 offset 기준으로 사용하고 sudden jump를 제한한다.
- input의 `targetTick`은 estimated one-way delay와 1~3 tick jitter slack으로 계산한다.
- server는 target tick을 현재 tick 기준 bounded window에서만 수용한다.
- client time은 gameplay 결과와 rewind 권한을 주지 않는다.

clock sync 실패나 초기 sample 부족 시 server가 알려준 conservative default lead를
사용한다.

## 10. Packet Loss와 Backpressure

현재 browser WebSocket은 TCP라 application message가 유실되기보다 loss recovery
동안 뒤 packet도 정체된다.

- snapshot을 쌓아 보내지 않고 아직 serialize하지 않은 superseded movement sample을
  coalesce한다.
- 이미 WebSocket send queue에 들어간 packet을 취소할 수 있다고 가정하지 않는다.
- `bufferedAmount` 상한 초과 connection은 1013으로 닫고 resume하도록 한다.
- reconnect는 full owner/entity snapshot으로 복구한다.
- moving sample이 absolute state라 future datagram transport를 도입해도 snapshot
  loss recovery가 단순하다.

이번 Sprint에서 UDP/WebTransport abstraction은 만들지 않는다.

## 11. Reconnect와 Late Join

### Reconnect

- disconnect 즉시 server input을 neutral로 바꾼다.
- player lease는 기본 10초 유지한다.
- resume token은 128-bit random opaque value이며 성공할 때마다 회전한다.
- resume은 같은 player ID의 full authoritative snapshot을 보내고 client pending
  command를 모두 버린다.
- old connection과 expired token은 player를 mutation할 수 없다.

### Late join

- 현재 tick, active bombs, fuse/explode tick, flames, items, players와 interest chunks를
  하나의 baseline으로 전송한다.
- 과거 explosion effect는 보내지 않는다.
- ready 전 command는 reject한다.

## 12. Protocol Limits

초기 구현에서 명시적으로 제한한다.

- JSON message byte 상한
- command rate와 queue length
- target tick future lead와 stale age
- nickname과 string 길이
- initial chunk count와 interest radius
- event payload type별 schema
- ACK cache와 resume lease 수명

unknown `type`은 reject한다. 같은 version의 optional additive server field는 client가
무시할 수 있지만 필수 의미 변경은 protocol version을 올린다.

## 13. V2 → V3 배포 순서

1. V3 server path와 test를 추가하고 V2 production behavior를 보존한다.
2. Oracle에 dual-protocol server를 배포해 V2 client smoke를 확인한다.
3. V3 client를 배포하고 owner prediction/remote interpolation을 관찰한다.
4. 200/300ms RTT simulation과 실제 two-client 결과를 확인한다.
5. production V2 traffic 0과 V3 안정성을 확인한다.
6. 별도 cleanup Task에서 V2 code 제거 여부를 결정한다.

## 14. 검증 계약

- schema, size, unknown type와 bounded sequence/tick window
- join/resume → baseline chunks/entity → ready 순서
- 200/300ms RTT와 50ms jitter target tick arrival
- duplicate/stale/late command idempotency
- owner ACK와 pending replay
- snapshot reorder/stale 폐기와 absolute sample recovery
- bomb action result correlation과 event dedupe
- backpressure 1013 뒤 resume full snapshot
- late join bomb/flame/death current state
- old socket/expired token mutation 0
- V2/V3 dual protocol 전환과 rollback

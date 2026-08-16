# World Architecture

## 1. 목적

이 문서는 BOOMnBOOM 공유 월드의 canonical data, 좌표, 청크와 소유권을
정의한다. 게임 판정 순서는 `11_simulation_architecture.md`, 전송 방식은
`12_network_protocol_architecture.md`를 따른다.

## 2. 핵심 모델

```text
World Owner
  ├─ World Metadata
  │    ├─ worldId
  │    ├─ seed
  │    └─ generatorVersion
  ├─ Chunk Registry
  │    └─ ChunkKey → WorldChunk
  ├─ Entity Registry
  │    ├─ Players / Bots
  │    ├─ Bombs
  │    ├─ Items
  │    └─ Flames
  └─ Mutation Journal / Runtime indexes
```

production 월드는 `0..255 × 0..255` 절대 타일 좌표의 유한한 registry다. 서버 시작 시
16×16 청크 256개를 전부 확정하며 접속자 수와 viewport 크기는 월드 데이터 모양을
바꾸지 않는다. 청크는 생성 단위가 아니라 전송·revision 단위로 계속 사용한다.

## 3. World Owner

World Owner는 다음 command를 제공하는 단일 mutation boundary다.

- player join, disconnect, bounded random respawn
- movement intent 적용
- bomb 설치
- simulation tick 적용
- AI intent 적용
- item 획득
- fixed chunk materialize와 snapshot/delta read
- chunk snapshot과 delta read

Generator는 새 청크 후보를 계산하지만 registry에 직접 넣지 않는다. Simulation은
변경 목록을 계산하지만 entity Map과 chunk tile을 직접 변경하지 않는다. Gateway는
검증된 command를 호출하고 read snapshot만 직렬화한다.

## 4. 좌표와 청크

### 좌표

- terrain과 bomb cell은 정수 `WorldCoordinate { x, y }`다.
- player movement state는 fixed-point `MovementPosition { px, py, vx, vy }`다.
- 기준 단위는 `1 tile = 1024 movement units`이며 오른쪽/아래가 양수다.
- cell 변환, 음수 좌표와 경계 tie-break는 shared helper 하나가 소유한다.
- 화면용 local 좌표는 client projection에서만 계산한다.
- production 유효 cell은 `0 ≤ x < 256`, `0 ≤ y < 256`이며 바깥과 한 칸짜리
  perimeter는 permanent wall이다.

### 청크

첫 구현의 기준 크기는 `16 × 16` 타일이다. 크기는 protocol metadata로 전달하되
플레이 중 임의로 바꾸지 않는다.

```text
chunkX = floorDiv(worldX, chunkSize)
chunkY = floorDiv(worldY, chunkSize)
localX = positiveMod(worldX, chunkSize)
localY = positiveMod(worldY, chunkSize)
chunkKey = "chunkX,chunkY"
```

JavaScript `%`만 사용하면 음수 local 좌표가 음수가 될 수 있으므로 공용 좌표
helper가 floor division과 positive modulo를 소유한다.

## 5. WorldChunk

WorldChunk의 canonical plain data는 최소 다음 의미를 가진다.

```text
WorldChunk
  key
  revision
  generatorVersion
  tiles[chunkSize * chunkSize]
  lastActiveAt
```

- `tiles`에는 현재 충돌 가능한 wall, crate와 floor가 들어간다.
- tile이 바뀌면 revision을 한 번 증가시킨다.
- player, bomb와 item은 청크의 tile 배열에 넣지 않고 Entity Registry에서
  좌표로 관리한다.
- 같은 mutation batch에서 한 청크를 여러 번 바꿔도 최종 commit 시 revision은
  한 번만 증가시킨다.

## 6. Materialization

1. 서버 부팅 시 유한 chunk range `0..15 × 0..15`를 순서대로 생성한다.
2. generator는 seed, version, absolute cell과 world bounds로 타일을 만든다.
3. World Owner가 256개 청크를 canonical registry에 등록한다.
4. 이후 이동·접속·카메라 변화는 새 타일이나 청크를 만들지 않는다.
5. 타일 mutation은 기존 청크의 revision만 증가시킨다.

클라이언트 관심 영역 기준은 다음과 같다.

- client initial/preload: 반경 2, 최대 5×5 청크
- server canonical terrain: 전체 256청크 상시 resident

정확한 수치는 부하 측정으로 조정할 수 있지만 `preload > viewport` 계약은
유지한다.

## 7. 지형 생성

- permanent wall은 절대 월드 좌표 규칙으로 생성한다.
- crate 후보 순서는 `seed + worldX + worldY + generatorVersion`의 안정적인
  hash로 정한다.
- 상자 밀도 제한은 독립 청크의 local 배열이 아니라 월드 좌표 이웃을 기준으로
  평가한다.
- 청크 경계에 인위적인 빈 한 줄이 생기지 않아야 한다.
- 동일 seed와 version의 청크는 생성 순서나 접속자 위치와 관계없이 같아야 한다.
- generator 변경은 기존 version의 결과를 몰래 바꾸지 않고
  `generatorVersion`을 올린다.

## 8. Spawn

- spawn은 전체 확정 맵에서 매 spawn sequence마다 달라지는 bounded 후보를 검색한다.
- 살아 있는 사람 player가 있으면 이를 우선 기준점으로 삼고, 사람과 AI 모두 대략
  7~12칸 거리의 후보에서 spawn한다. 사람이 없으면 살아 있는 AI를 기준점으로 삼는다.
- 다른 살아 있는 player와 최소 거리, wall/crate/bomb 부재와 탈출 가능한 인접
  floor를 확인한다. 현재 최소 player 간격은 Manhattan distance 5칸이다.
- spawn을 위해 기존 crate를 영구 삭제하지 않는다.
- 접속 시 주변 crate가 보일 수 있다.
- 안전한 위치를 찾지 못하면 검색 반경을 넓히며 임의 좌표를 floor로 바꾸지
  않는다.

## 9. 상자 파괴

- 폭발로 crate가 파괴되면 해당 tile은 floor가 된다.
- 파괴 시 해당 chunk revision을 한 번 증가시킨다.
- 파괴 뒤 12초 복구와 3초 전 warning mutation을 같은 청크 revision으로 전달한다.
- 서버 재시작 뒤 terrain mutation이 초기화되는 현재 비영속 계약은 유지한다.

## 10. Runtime index와 메모리

좌표 조회 성능을 위해 다음 Runtime index를 둘 수 있다.

- cell → blocking entity
- moving player → overlapping collision cells
- chunkKey → entity IDs
- player → subscribed chunk keys
- chunkKey → subscriber count

index는 canonical registry의 두 번째 원본이 아니며 mutation commit과 함께
갱신하거나 재구축할 수 있어야 한다.

production 유한 맵은 프로세스 수명 동안 청크를 eviction하지 않는다. 실험용
unbounded World Owner에서만 다음 조건으로 cold trim할 수 있다.

- active/retention 범위 밖
- subscriber 0
- bomb, item과 flame 없음
- 보존해야 할 mutation이 journal 또는 persistent snapshot에 반영됨

메모리 상한과 전체 256청크 resident 수는 health/metrics에서 확인 가능해야 한다.

## 11. 금지 사항

- viewer별 `originX`, `originY`를 server canonical state에 저장
- viewer별 전체 tile matrix 생성
- client에서 미수신 청크를 자체 procedural generation
- spawn 때 주변 상자 영구 제거
- 청크 해제 때문에 live mutation 손실
- wall/crate와 entity를 하나의 DOM용 배열로 저장

## 12. 검증 계약

- 동일 좌표 결정성: 생성 순서가 달라도 같은 tile
- 음수 좌표 round-trip
- 청크 경계 양쪽의 상자 밀도와 길 규칙
- 청크 최초 materialize가 한 번만 발생
- tile mutation별 revision 증가
- 다른 두 viewer가 같은 chunk snapshot/revision 수신
- spawn이 기존 지형을 바꾸지 않음
- 파괴된 crate가 이후 world tick에도 floor로 유지
- eviction 뒤 base terrain 복원과 mutation 보존

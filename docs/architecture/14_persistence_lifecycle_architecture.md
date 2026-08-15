# Persistence and Lifecycle Architecture

## 1. 목적

이 문서는 Oracle 프로세스, 월드·청크·session 수명, 메모리 제한, 재시작과 배포
경계를 정의한다.

## 2. 현재 제품 경계

- 공개 웹 UI는 Sites/Cloudflare 기반 정적·서버 렌더 배포다.
- 실시간 게임 authority는 Oracle의 Node WebSocket 프로세스다.
- nginx가 공개 `/boom-ws` 연결을 local game server로 전달한다.
- systemd가 game server process를 관리한다.
- 공개 제품에는 D1 binding/API가 없으며 Oracle World Owner를 D1에 자동 저장하지
  않는다.

## 3. Process lifecycle

```text
process start
  → config validate
  → World metadata / clock initialize
  → World Owner create
  → Simulation clocks start
  → HTTP health + WebSocket accept

shutdown signal
  → new connection stop
  → simulation timers stop
  → pending publication finish or discard safely
  → sockets close
  → HTTP server close
```

World Owner와 timer를 module import 부작용으로 여러 번 만들지 않는다. main entry가
한 instance를 조립한다.

현재 `server/index.mjs`는 `startServer()`만 호출하고, `src/main.mjs`가 composition과
process lifecycle, `simulation-scheduler.mjs`가 timer, `health-handler.mjs`가 readiness
응답을 담당한다.

## 4. World lifecycle

- 기본 live world는 Oracle process마다 하나다.
- `worldId`, seed, generator version과 epoch는 config에서 안정적으로 정한다.
- 첫 active player와 AI가 필요로 하는 청크부터 materialize한다.
- 접속자가 없을 때 movement/AI work와 publication을 줄이되 world clock은 wall
  clock 기준으로 계속 흐른다.
- 사람이 disconnect하면 session/socket은 제거하지만 공유 지형을 다시 만들지
  않는다.

## 5. Session lifecycle

- socket connection과 player entity 수명을 분리한다.
- 최초 join은 player lease와 추측 불가능한 128-bit resume token을 만들고 token은
  log, URL과 public health에 남기지 않는다.
- disconnect 시 movement input을 즉시 neutral로 바꾸고 player는 기본 10초 grace
  동안 world에 남아 bomb/flame damage를 계속 받을 수 있다.
- grace 안의 `resume`은 같은 player entity를 새 connection에 연결하고 token을
  회전한다. 이전 socket은 더 이상 권한을 갖지 않는다.
- grace가 끝나면 player, interest와 token을 제거한다.
- reconnect client는 pre-disconnect pending input을 재실행하지 않고 full
  authoritative movement snapshot에서 prediction을 다시 시작한다.
- AI entity는 사람 connection과 독립적으로 World Owner가 소유한다.
- shutdown에서 모든 session subscription과 socket을 정리한다.

## 6. Chunk lifecycle와 메모리

청크는 다음 상태를 가진다.

- active: player simulation/preload 범위
- retained: active 밖이지만 짧은 재접근에 대비
- cold: subscriber와 pending entity/mutation 없음
- pinned: item, bomb 또는 보존되지 않은 mutation 있음

base-only cold chunk는 TTL/LRU와 최대 청크 수로 eviction할 수 있다. pinned chunk는
mutation journal 또는 snapshot 없이 해제하지 않는다. 다음 metrics를 health 또는
진단 endpoint에서 확인한다.

- materialized/active/retained/pinned chunk 수
- player, bot, bomb, item, flame과 전체 entity 수
- subscriber 수
- tick duration과 event loop lag
- outbound messages/bytes와 backpressure disconnect
- process RSS/heap/external byte와 128MB 관찰 기준

## 7. 재시작 정책

현재 Sprint는 다음 명시적 정책을 사용한다.

- 유지: world ID, seed, generator version, world epoch와 base terrain 결과
- 초기화: 사람 session, player 상태, AI runtime, bomb, flame, item과 destroyed crate
- 결과: 재시작 뒤 같은 좌표의 자연 지형은 같지만 진행 중 전투 변화는 초기화

이 정책은 데이터 손실 버그가 아니라 현재 비영속 live-world 계약이다. 전투 상태를
재시작 뒤에도 보존하려면 별도 Sprint에서 snapshot/journal format, write cadence,
schema migration과 복구 실패 정책을 먼저 설계한다.

## 8. Mutation journal

같은 process 안에서 cold chunk를 해제하려면 mutation을 잃지 않아야 한다.
첫 구현은 다음 중 단순한 방법을 선택한다.

1. mutation이 있는 chunk를 pinned하여 해제하지 않음
2. compact in-memory journal에 base와 다른 cell만 보존

Oracle disk/database persistence는 이번 Sprint의 필수 조건이 아니다. 메모리 측정
결과 pinned chunk가 지속적으로 증가할 때 다음 Sprint에서 journal을 도입한다.

## 9. 배포와 protocol compatibility

- 현재 production은 V2-only이고 다음 Sprint에서 V3 server를 V2와 함께 먼저
  배포한다.
- V3 client 공개 전환과 production 관찰이 끝날 때까지 V2 path를 유지한다.
- V3 traffic이 안정적이고 V2 traffic이 0인 것을 확인한 뒤 별도 cleanup Task에서
  V2를 제거한다.
- server unit/service 파일은 새 entry path와 환경 변수를 정확히 반영한다.
- 배포 전 기존 service file과 nginx config를 백업/rollback 단위로 둔다.
- V3 server 배포 실패 시 현재 V2-only artifact로 rollback한다.

## 10. Health와 readiness

`/health`는 process 생존뿐 아니라 최소 다음을 제공한다.

- `ok`, uptime, protocol versions
- world tick과 last completed simulation time
- connection/player/bot 수
- chunk 상태별 수
- bomb/item 수
- event loop lag 또는 last tick duration

World Owner 초기화 실패나 simulation loop 중단 상태를 `ok: true`로 숨기지 않는다.
secret과 상세 player 정보는 health에 넣지 않는다.

## 11. 제거된 D1 경계

6A caller audit에서 `app/api/world`, `app/api/match`, `app/api/rooms`, `db/`, Drizzle
migration과 ChatGPT auth starter helper의 import/fetch caller가 0건임을 확인했다.
이 경로와 Sites `DB` binding을 R6A 단위로 제거했으며 World Owner의 저장소로 D1을
재도입하지 않는다. 친구대전·전투 상태 영속화는 schema와 lifecycle을 별도
Architecture로 합의한 뒤 새 Sprint에서 구현한다.

## 12. 검증 계약

- process start/health/readiness
- graceful shutdown에서 timer/socket 정리
- no-player 상태에서 불필요한 broadcast 0
- base-only chunk eviction 뒤 동일 terrain 복원
- pinned mutation 미손실
- restart 뒤 명시된 유지/초기화 정책
- V2/V3 전환 기간의 query/subprotocol과 unsupported protocol 무누수 거절
- disconnect grace, token rotation, resume와 grace expiry
- service/nginx syntax와 실제 WebSocket upgrade
- health metrics 상한 관찰

# Client Render Architecture

## 1. 목적

이 문서는 서버가 확정한 월드를 브라우저가 넓게 받아두고 viewport만 잘라
부드럽게 표시하는 Runtime 구조를 정의한다.

## 2. 구성

```text
Game Page Composition Root
  ├─ Game Socket
  ├─ Client World Store
  ├─ Input Controller
  ├─ Camera Runtime
  ├─ Audio Runtime
  └─ World View
       ├─ Terrain Layer
       ├─ Entity Layer
       ├─ Local Player Layer
       └─ HUD / Overlay
```

Page는 이 책임을 조립하고 공개 view props를 연결한다. socket parse, world cache,
입력 timer, camera animation과 모든 JSX를 다시 한 파일에 모으지 않는다.

## 3. Client World Store

World Store는 서버 데이터를 읽기 쉽게 보관하는 Runtime cache다.

- world metadata와 clock sync
- `chunkKey → { revision, tiles, respawns }`
- `entityId → authoritative entity snapshot`
- local player ID와 last acknowledged input sequence
- connection/initialization 상태

Store는 server message를 적용하는 command만 공개한다. React component는 내부 Map을
직접 바꾸지 않는다. 같은 world ID가 아니거나 revision이 맞지 않는 delta는
적용하지 않는다.

현재 구현은 `world-state.ts`가 Runtime shape, `world-message-applier.ts`가 message
적용, `world-selectors.ts`가 read projection, `world-store.ts`가 subscription façade를
담당한다. Store façade 밖에서 이 state를 canonical 원본으로 취급하지 않는다.

## 4. Preload와 viewport

- 초기 화면을 열기 전에 visible 범위를 덮는 chunk snapshot을 확보한다.
- 기본 cache는 local player 중심 반경 2청크다.
- viewport는 cache의 일부인 기본 15×11 tile을 CSS overflow로 자른다.
- player가 cache 내부를 이동할 때 terrain DOM을 다시 만들지 않고 world transform만
  바꾼다.
- 다음 interest chunk가 아직 없으면 기존 edge를 임의 tile로 채우지 않는다.
  안전한 loading edge를 표시하고 요청을 재시도한다.

## 5. Terrain Layer

- chunk component key는 `worldId + chunkKey`다.
- tile rendering input은 해당 chunk snapshot과 revision뿐이다.
- player, camera position, world tick과 BGM progress는 terrain props가 아니다.
- floor pattern은 절대 world coordinate로 결정해 카메라 이동 때 모양이 바뀌지
  않는다.
- wall/crate 스타일은 캐릭터 상대 위치에 따른 동적 음영을 만들지 않는다.
- chunk delta는 해당 chunk와 cell만 갱신한다.

React DOM으로 먼저 계약을 검증한다. 성능 측정 없이 Canvas/WebGL 전환을 이번
refactor에 추가하지 않는다.

## 6. Entity Layer

- player, AI, bomb, item과 flame은 절대 world coordinate로 배치한다.
- server snapshot은 authoritative target이고 화면용 visual position은 별도다.
- entity update가 오면 이전 visual position에서 새 target까지 보간한다.
- camera와 remote player가 공유하는 순수 보간은 `position-interpolator.ts`에 두고,
  camera transform은 `camera-runtime.ts`만 담당한다.
- bomb는 player보다 높은 명시적 layer에 표시한다.
- offscreen enemy pointer는 viewport projection이며 server entity를 바꾸지 않는다.

## 7. Local player와 Camera Runtime

- local player 표시는 viewport 중앙 anchor에 둔다.
- Camera Runtime은 local authoritative target과 현재 visual position을 소유한다.
- 매 `requestAnimationFrame`에 time-based interpolation으로 visual position을
  계산하고 world root의 `translate3d`만 바꾼다.
- 타일 크기는 viewport layout에서 한 번 계산하고 이동마다 퍼센트 격자를
  재계산하지 않는다.
- 한 칸 이동 보간은 input cadence보다 조금 길게 겹치고, 새 target을 현재 visual에서
  다시 잡아 연속 입력 사이에 정지 frame이 생기지 않게 한다.
- 새 target이 오면 현재 visual position을 시작점으로 삼아 끊김을 누적하지 않는다.
- teleport/respawn처럼 큰 차이만 snap 또는 별도 짧은 transition으로 처리한다.

서버 위치는 정수 칸에 정확히 맞고, 화면은 그 정수 target 사이를 연속적으로
움직인다. 키를 놓으면 마지막 승인 target까지 보간을 완료한다.

## 8. Input Controller

- keyboard와 pointer를 동일한 movement intent로 정규화한다.
- key down에서 방향을 시작하고 hold cadence로 sequence를 보낸다.
- key up, blur와 pointer cancel에서 stop한다.
- bomb input은 현재 서버 위치를 추측해 DOM에 확정하지 않고 즉시 intent를 보낸다.
- client prediction을 사용하더라도 한 칸 target을 넘지 않고 ack/correction에
  수렴한다.
- input timer는 component unmount와 reconnect에서 반드시 정리한다.

## 9. Audio Runtime

- BGM file, Audio element, volume과 playback correction은 Audio Runtime이 소유한다.
- server world clock metadata로 expected track position을 계산한다.
- 작은 drift는 제한된 playback rate 보정, 큰 drift와 최초 입장은 seek를 사용한다.
- autoplay 제한 때문에 사용자의 입장 action 이후 재생을 시작한다.
- 음소거/음량 UI는 게임 simulation을 멈추지 않는다.

## 10. React update 경계

- connection, overlay, 능력치와 chunk/entity snapshot 변경은 React Store 구독으로
  갱신할 수 있다.
- rAF 보간 위치는 DOM transform 또는 좁은 animation store에서 처리한다.
- world 전체 JSON을 `setState`해 모든 tile을 다시 reconciliation하지 않는다.
- selector는 변경된 chunk/entity만 구독하도록 한다.
- `startTransition`은 전체 snapshot 전송을 해결하는 수단으로 사용하지 않는다.

## 11. 실패와 재연결

- socket disconnect 시 마지막 frame을 유지하고 재연결 상태를 표시한다.
- reconnect `world_init`이 오면 world ID와 revisions를 비교해 cache를 재사용하거나
  폐기한다.
- 사망 overlay와 respawn command는 월드 렌더링 Runtime과 분리한다.
- initial chunks가 준비되지 않은 상태를 playable로 표시하지 않는다.

## 12. 검증 계약

- player 이동 중 terrain component render count 증가 없음
- floor pattern이 왕복 이동 뒤 동일
- viewport 밖에 최소 preload 범위 존재
- 연속 key hold에서 camera frame 간 큰 jump 없음
- key release 뒤 원래 칸으로 복귀하지 않고 승인 target까지 완료
- respawn teleport와 일반 이동 분리
- chunk delta가 해당 chunk만 갱신
- entity revision gap/stale update 처리
- reconnect 때 잘못된 world cache 폐기
- keyboard와 pointer input cleanup
- muted BGM과 game clock 독립

Browser QA는 최소 두 창에서 같은 지형, 이동, 폭탄과 crate delta를 확인하고
Performance panel 또는 render counter로 terrain 재렌더링을 확인한다.

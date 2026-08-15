# BOOMnBOOM

BOOMnBOOM은 링크로 바로 참가하는 실시간 공유 월드 폭탄 게임입니다.

- [공개 게임](https://bubble-boom-arcade.bacbaqui2.chatgpt.site/)
- 별도 매칭 없이 하나의 끝없는 월드에 합류합니다.
- Oracle Node 서버가 월드, 충돌, AI, 폭탄과 청크 revision을 확정합니다.
- Sites 웹 클라이언트는 기본 Protocol V3로 접속해 주변 25청크를 받고,
  15×11 화면에서 로컬 예측과 원격 보간으로 움직임을 부드럽게 보여줍니다.
- 폭발은 영구 world clock/BGM 박자에 맞춰 처리되며, 파괴된 상자는 빈 바닥으로
  유지됩니다. 폭발 뒤 남아 있는 불꽃 칸에 들어가도 피해를 받습니다.

## 요구 사항

- Node.js `>=22.13.0`

## 로컬 검증

```bash
npm install
npm run dev
npm run lint
npm test
```

Oracle 게임 서버는 별도 터미널에서 실행합니다.

```bash
cd server
npm install
npm test
PORT=3300 npm start
```

웹 클라이언트의 기본 WebSocket 주소는
`wss://insight.magamiscom.ing/boom-ws?protocol=3`입니다. 공개 URL에
`?protocol=2`를 붙이면 V2 rollback client를 선택합니다. 로컬 통합 검증에서는
필요한 범위에서 `GameSocket`의 URL과 socket factory를 주입합니다.

## 현재 구조

```text
Sites V3 Client (V2 rollback)
  → Game Socket / Client World Store façade
  → Oracle nginx /boom-ws
  → WebSocket Gateway / World Publisher
  → Game Simulation
  → World Owner
```

- `shared/`: server/client가 함께 쓰는 30Hz fixed-point 이동 코어
- `app/game/`: V2/V3 protocol, prediction/replay/interpolation, state/store와 render Runtime
- `server/src/world/`: 결정적 16×16 청크와 canonical entity owner
- `server/src/simulation/`: 이동, 폭탄, 폭발, 피해, item과 player respawn 규칙
- `server/src/network/`: V2/V3 session, resume, chunk/entity snapshot·delta publication
- `docs/`: 제품 불변식, Architecture, source map과 현재 Sprint

현재 실시간 월드는 Oracle 프로세스 메모리가 authority입니다. 서버 재시작 뒤 base
terrain은 같은 seed/version으로 복원되지만 player, bomb, item과 파괴된 상자는
초기화됩니다. D1은 현재 제품 경로에 사용하지 않습니다.

## 배포 순서

1. Oracle V2/V3 병행 서버를 먼저 배포하고 health와 두 protocol을 확인합니다.
2. Sites 기본 V3 웹 클라이언트를 배포합니다.
3. 실제 두 브라우저에서 같은 월드, 예측 이동, 폭탄과 재접속을 확인합니다.
4. 장애 시 공개 URL의 `?protocol=2`로 즉시 V2 rollback을 확인합니다.

서버와 웹을 동시에 강제 전환하지 않습니다. `.openai/hosting.json`의 Sites
`project_id`는 기존 프로젝트를 가리키며 임의로 바꾸지 않습니다.

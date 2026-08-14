# BOOMnBOOM

BOOMnBOOM은 링크로 바로 참가하는 실시간 공유 월드 폭탄 게임입니다.

- [공개 게임](https://bubble-boom-arcade.bacbaqui2.chatgpt.site/)
- 별도 매칭 없이 하나의 끝없는 월드에 합류합니다.
- Oracle Node 서버가 월드, 충돌, AI, 폭탄과 청크 revision을 확정합니다.
- Sites에 배포되는 V2 웹 클라이언트는 주변 25청크를 받아 15×11 화면만
  부드럽게 보여줍니다.
- 폭발과 상자 재생성은 영구 world clock/BGM 박자에 맞춰 처리됩니다.

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
`wss://insight.magamiscom.ing/boom-ws?protocol=2`입니다. 로컬 통합 검증에서는
필요한 범위에서 `GameSocket`의 URL과 socket factory를 주입합니다.

## 현재 구조

```text
Sites V2 Client
  → Game Socket / Client World Store
  → Oracle nginx /boom-ws
  → WebSocket Gateway
  → Game Simulation
  → World Owner
```

- `app/game/`: V2 protocol, cache, input/camera/audio Runtime과 render layer
- `server/src/world/`: 결정적 16×16 청크와 canonical entity owner
- `server/src/simulation/`: 이동, 폭탄, 폭발, 피해, item과 respawn 규칙
- `server/src/network/`: 명시적 Protocol V2 snapshot/delta gateway
- `docs/`: 제품 불변식, Architecture, source map과 현재 Sprint

현재 실시간 월드는 Oracle 프로세스 메모리가 authority입니다. 서버 재시작 뒤 base
terrain은 같은 seed/version으로 복원되지만 player, bomb, item과 진행 중인 respawn은
초기화됩니다. D1은 현재 제품 경로에 사용하지 않습니다.

## 배포 순서

1. Oracle V2 서버를 배포하고 health와 명시적 Protocol V2 WebSocket을 확인합니다.
2. Sites V2 웹 클라이언트를 배포합니다.
3. 실제 두 브라우저에서 같은 월드, 이동, 폭탄과 청크 delta를 확인합니다.
4. unversioned 또는 Protocol 1 연결이 426으로 거절되는지 확인합니다.

서버와 웹을 동시에 강제 전환하지 않습니다. `.openai/hosting.json`의 Sites
`project_id`는 기존 프로젝트를 가리키며 임의로 바꾸지 않습니다.

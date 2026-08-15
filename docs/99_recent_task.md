# BOOMnBOOM 최근 작업 보고서

## 최근 Task — 사망 후 능력치와 이동 입력 초기화

### 확인한 문제

- 사람 플레이어 respawn이 위치와 생존 상태만 바꾸고 폭탄 수, 화력, 방어막과
  속도 아이템을 이전 생명에서 그대로 유지했다.
- client는 `lifeId` 변경 뒤 command sequence를 0부터 시작하지만 server respawn은
  이전 생명의 마지막 sequence를 유지했다. 이후 이동 입력이 stale로 거절되어
  재접속한 캐릭터가 움직이지 않았다.

### 수정

- respawn 시 `power 1`, `range 1`, `shield 0`, `speedLevel 0`으로 초기화한다.
- 위치와 fixed motion을 새 spawn 중앙으로 초기화하고 `lifeId`/teleport를 갱신한다.
- pre-life queue뿐 아니라 command sequence domain 전체를 초기화해 새 입력 0번을
  정상적으로 받는다.

### 검증

- 사람 respawn의 모든 아이템 능력치 시작값 자동 테스트 PASS
- 죽기 전 높은 sequence 뒤 respawn하고 0번 이동 입력을 받는 자동 테스트 PASS
- root production build와 client test 89건 PASS
- server test 83건 PASS
- ESLint, TypeScript `--noEmit`과 `git diff --check` PASS

### 배포 상태

- 제품 변경을 `7d9d2e9`로 commit하고 GitHub에 push했다.
- Oracle 기존 server를 별도 백업한 뒤 `boomnboom` 서비스만 재시작했다.
- 공개 WebSocket에서 폭탄 사망→respawn→능력치 시작값→새 sequence 0 이동 입력을
  실제로 검증했다.
- client source 변경은 없어 Sites 페이지는 기존 공개 version 60을 유지한다.
- 공개 URL: `https://bubble-boom-arcade.bacbaqui2.chatgpt.site/`

# BOOMnBOOM Constitution

## 1. 제품 철학

- BOOMnBOOM은 누구나 링크로 바로 접속하는 가벼운 공유 월드 폭탄 게임이다.
- 플레이어는 별도 랜덤 매칭을 기다리지 않고 이미 진행 중인 하나의 월드에
  합류한다.
- 조작은 칸에 정확히 맞고 결과는 예측 가능해야 하며, 화면 이동은 부드럽게
  보여야 한다.
- 같은 장소의 벽, 상자, 폭탄과 플레이어는 모든 접속자에게 같은 상태여야 한다.
- 적은 이용자와 작은 Oracle 인스턴스에서도 안정적으로 동작하도록 CPU,
  메모리와 전송량을 제한한다.
- 구조는 파일 수가 아니라 데이터 소유권과 변경 책임으로 판단한다.

## 2. 공유 월드

- 월드는 유한한 화면 배열이 아니라 정수 월드 좌표로 이어지는 희소 청크 집합이다.
- 서버에서 처음 materialize한 청크는 해당 수명 동안 확정된 월드 데이터다.
- 같은 `worldId`, `chunkKey`, `revision`은 모든 접속자에게 같은 내용을 뜻한다.
- 화면 밖을 포함한 주변 청크를 미리 준비하고 클라이언트는 그중 viewport만 잘라
  보여준다.
- 이동이나 카메라 변화만으로 타일을 재생성하지 않는다.
- 청크 경계는 상자 밀도, 길과 충돌 규칙의 경계가 아니다.

## 3. World Owner

- `World Owner`는 공유 월드와 entity를 소유하고 변경하는 유일한 경계다.
- 월드 타일, 플레이어, AI, 폭탄, 불꽃, 아이템과 재생성 상태는 World Owner의
  command를 통해서만 바뀐다.
- Generator, Simulation, AI와 Network는 World Owner의 내부 Map과 Set을 직접
  변경하지 않는다.
- 클라이언트 입력은 intent이고 서버에서 검증된 결과만 canonical state가 된다.
- 접속자별 화면 원점, 보간 좌표, DOM과 BGM 객체는 World Owner가 소유하지 않는다.

## 4. 청크와 revision

- 청크는 월드 좌표에 안정적으로 대응하고 음수 좌표에서도 같은 규칙을 사용한다.
- 자연 지형 생성은 seed와 generator version에 대해 결정적이어야 한다.
- 청크를 처음 요청할 때 한 번 materialize하고 이후 변화는 해당 청크 state에
  적용한다.
- 타일 변화가 생기면 청크 `revision`을 단조 증가시킨다.
- 전체 snapshot은 최초 로딩 또는 revision 복구에만 사용하고 일반 변화는
  delta로 전달한다.
- 활성 플레이어보다 넓은 구역을 materialize하되 사용하지 않는 청크는 명시적
  retention 정책으로 해제한다.

## 5. 이동과 게임 판정

- authoritative 플레이어 위치와 폭탄 위치는 정수 칸 좌표다.
- 키를 누르는 동안 이동 intent를 처리하고, 유효한 이동은 인접 칸 하나를
  canonical 결과로 만든다.
- 키를 놓았다고 이미 승인된 이동이 원래 칸으로 되돌아가지 않는다.
- 폭탄은 설치 command가 처리되는 시점의 authoritative 플레이어 칸에 생긴다.
- 폭발 피해는 폭발이 실행되는 순간의 플레이어 칸으로 판정한다. 이전 fuse
  순간의 위치로 피해를 예약하지 않는다.
- 상자 경고와 재생성은 월드 박자에 맞추되, 경고 생성 시점에 플레이어 주변
  9×9 안이면 새 경고와 재생성을 연기한다.
- 이미 경고가 확정된 뒤 플레이어가 접근한 경우에는 기존 경고와 예정된
  재생성을 취소하지 않는다.
- 시작 위치를 만들기 위해 주변 상자를 영구 삭제하지 않는다. 서버는 기존
  월드에서 유효한 floor spawn을 찾는다.

## 6. 서버 시뮬레이션과 시간

- 이동 intent 처리와 1초 박자 시뮬레이션은 서로 다른 clock 책임이다.
- 폭탄 fuse, 폭발, 불꽃 수명과 상자 재생성은 서버 시간과 world tick이
  authority다.
- BGM은 게임 판정을 일으키는 clock이 아니라 같은 world timeline을 표현하는
  클라이언트 Runtime이다.
- AI도 사람과 동일한 World Owner command와 충돌 규칙을 사용한다.
- Simulation 한 step의 결과는 접속자 수나 메시지 순서에 따라 달라지지 않아야
  한다.

## 7. 네트워크

- WebSocket Gateway는 연결, 메시지 검증, 구독과 직렬화만 담당한다.
- 서버는 접속자마다 전체 타일 화면을 다시 계산해 broadcast하지 않는다.
- 최초 접속은 clock, 자기 entity와 preload 청크를 포함한 초기 상태를 받는다.
- 이후에는 entity delta와 chunk delta를 받으며 revision 누락 시 chunk snapshot을
  다시 요청한다.
- 입력에는 client sequence가 있고 서버 결과에는 authoritative sequence 또는
  revision이 있어 stale 메시지를 구분할 수 있어야 한다.
- protocol version은 명시하며 호환되지 않는 전환은 단계적으로 배포한다.

## 8. 클라이언트 Runtime과 렌더링

- 클라이언트 World Store는 서버 snapshot의 캐시이지 두 번째 canonical 월드가
  아니다.
- 지형, 움직이는 entity, 카메라와 HUD를 별도 렌더링 책임으로 둔다.
- 지형은 chunk revision이 바뀔 때만 갱신한다.
- entity의 authoritative 칸과 화면용 보간 좌표를 구분한다.
- 로컬 플레이어를 화면 중앙에 고정하고 카메라가 월드를 움직이는 것은
  projection이며 서버 상태를 바꾸지 않는다.
- `requestAnimationFrame`은 보간과 transform만 수행하며 React canonical
  state를 매 프레임 복제하지 않는다.
- 화면 끝에 도달하기 전에 다음 청크를 요청하고, 아직 받지 못한 구역을 임의로
  새로 생성하지 않는다.

## 9. Persistence와 수명주기

- 현재 Sprint의 live world authority는 단일 Oracle Node 프로세스의 메모리다.
- base terrain은 `worldId + seed + generatorVersion`으로 복원 가능해야 한다.
- 재시작 뒤 플레이어 연결, 폭탄, 아이템과 진행 중인 경고를 보존하는 영속화는
  별도 제품 결정 없이는 추가하지 않는다.
- 서버 재시작 시 live runtime은 초기화되지만 base terrain 좌표 결과와 영구
  world clock은 유지한다.
- 청크 해제 뒤에도 같은 프로세스에서 필요한 mutation이 사라지지 않도록
  retention 또는 mutation journal 계약을 지킨다.
- D1의 구형 `game_rooms` state는 새 Oracle World Owner의 canonical 저장소가
  아니다.

## 10. 보존 계약

- 닉네임 입력 뒤 즉시 공유 월드 참가
- 사망 뒤 다시 접속하기
- 사람과 AI의 같은 월드 참여
- 칸 단위 충돌과 폭탄 설치
- 폭탄 수, 방어막, 화력 아이템
- 화면 밖 적 방향 표시
- 상자 파괴, 경고와 재생성
- 영구 world clock과 BGM 위치 동기화
- 공개 웹과 Oracle WebSocket 경로

구조를 바꾸는 동안 위 결과는 Task별로 명시하지 않는 한 유지한다.

## 11. 문서와 작업

- 공통 작업 절차는 루트 `AGENTS.md`를 따른다.
- `docs/01_rule.md`는 제품 불변식만 기록한다.
- `docs/architecture/10~19_*.md`는 계속 갱신되는 canonical 설계다.
- `docs/20_src_map.md`는 현재 존재하는 파일과 책임만 기록한다.
- `docs/completed/40~96_*.md`는 완료된 Sprint의 역사 기록이다.
- `docs/97_next_sprint.md`는 다음 Sprint 초안이다.
- `docs/98_sprint_plan.md`는 현재 Sprint 하나만 기록한다.
- `docs/99_recent_task.md`는 작업을 멈춘 시점의 최근 Task 하나만 기록한다.
- Architecture와 현재 코드의 차이는 `docs/98_sprint_plan.md`에서 단계적으로
  해소한다.

## 12. 검증

- 구조 변경 전에 현재 동작과 packet shape를 기록한다.
- 월드 생성, 음수 좌표, 청크 경계, 충돌, 폭발, 재생성과 protocol 순서를
  자동 테스트한다.
- client lint, production build, server test와 `git diff --check`를 수행한다.
- 실제 2-client 공유 상태와 이동 부드러움은 브라우저 QA로 확인한다.
- Oracle 배포 완료는 health check만이 아니라 WebSocket 참가와 실제 입력
  반영까지 확인한 상태다.

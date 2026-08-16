# BOOMnBOOM 최근 작업 보고서

## 최근 Task — AI 드롭 아이템 10초 만료

### 확인

- 운영 item 생성 경로는 V3와 V2 rollback의 AI 사망 처리뿐이다.
- 아이템이 여기저기 남은 원인은 추가 생성기가 아니라 만료 규칙 부재였다.

### 변경

- V3 AI drop에 생성 tick과 10초 뒤 만료 tick을 기록한다.
- V2 rollback drop도 다음 fixed step에서 같은 10초 수명을 받는다.
- Item Lifecycle System이 만료 tick에 미획득 item을 World Owner에서 제거한다.
- 사람 사망은 item을 만들지 않고, 먼저 획득한 item은 만료 처리로 되살아나지 않는다.

### 현재 상태

- server 전체 regression 106건 PASS
- root production build/client 92건, ESLint와 TypeScript PASS
- source/test 500줄 미만, syntax와 `git diff --check` PASS
- commit/push와 Sites/Oracle 배포는 진행 중

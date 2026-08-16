# Crate Warning Visual Sprint

## 상태

- 구현·로컬 검증: PASS
- commit/push와 Sites 배포: PASS

## 목표

상자 복구 3초 전 warning을 바닥 전체 노란 장판이 아니라 곧 생길 상자의 자리 표시로
보이게 한다.

## 구현

- warning tile의 바닥 배경은 투명하게 유지한다.
- 실제 상자와 동일한 가로·세로 82% 크기를 사용한다.
- 중앙 실루엣은 매우 연한 노란색으로 하고 3px 반투명 점선 테두리를 사용한다.
- warning tick, crate restore, collision과 protocol은 변경하지 않는다.

## 완료 조건

- CSS contract, root build/client test, lint와 TypeScript PASS
- server regression과 `git diff --check` PASS
- GitHub와 Sites production 배포 완료

## 로컬 검증 결과

- root production build와 client test 92/92 PASS
- server regression 106/106 PASS
- ESLint와 TypeScript PASS
- `git diff --check` PASS

## 배포 결과

- GitHub `main` 구현 commit `6a2336a` push 완료
- Sites version 67 production 배포 성공
- 공개 페이지 HTTP 200 확인
- server 규칙 변경이 없는 client-only 작업이라 Oracle server는 변경하지 않았다.

## Rollback

`app/globals.css`의 `crate_warning` 두 selector만 이전 디자인으로 복원하는 client-only
단위다.

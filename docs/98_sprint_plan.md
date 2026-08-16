# Local Presentation and 30Hz Snapshot Sprint

## 상태

- 구현·로컬 검증: PASS
- commit/push와 Oracle·Sites 배포: PASS

## 목표

내 화면의 플레이어 위치는 일반 owner snapshot으로 되감거나 보정하지 않고 local
prediction만 표시한다. 칸 이동은 첫 tick부터 정속으로 실행하며 V3 remote 위치
snapshot을 15Hz에서 30Hz로 높인다.

## 구현 Manifest

1. owner snapshot은 ACK와 stat 갱신에만 쓰고 local presentation `px/py`를 바꾸지 않는다.
2. join, respawn, reconnect, 새 `lifeId`와 teleport만 새 시작 위치로 reset한다.
3. gameplay movement config의 acceleration/deceleration을 최대속도와 같게 해 첫 tick부터
   초당 3칸 정속을 사용한다.
4. V3 owner/entity snapshot을 30Hz fixed simulation 매 tick 발행한다.
5. V2 rollback의 dirty publication cadence와 server gameplay authority는 유지한다.
6. 사용되지 않는 Correction Smoother와 해당 test를 제거한다.

## Preserve와 위험

- 폭탄 설치, 아이템 획득, 충돌, damage와 다른 client가 보는 위치는 server authority다.
- local presentation과 server 위치가 달라도 일반 snapshot으로 자동 수렴하지 않는다.
  이 차이는 이번 요청의 명시적 계약이며 이후 divergence metric으로 관찰한다.
- 30Hz full entity snapshot은 기존 15Hz보다 전송·직렬화량이 약 두 배다. 현재 소규모
  운영에서는 허용하되 동접 증가 전 interest/delta projection을 우선한다.

## 검증 결과

- root production build와 client test 91/91 PASS
- server regression 106/106 PASS
- 200/300ms RTT, jitter와 300ms receive stall에서 owner snapshot local 이동 0
- 첫 gameplay tick에서 speed level별 최고속도 적용 확인
- 실제 V3 gateway owner snapshot tick `2,3,4` 연속 발행 확인
- ESLint와 TypeScript PASS

## Rollback

local owner reconcile/Correction Smoother를 복원하고 gameplay acceleration tuning과 V3
snapshot cadence를 이전 15Hz로 되돌리는 client+server 단위다. V2 path와 protocol schema는
바뀌지 않아 직전 Oracle/Sites version으로 각각 복구할 수 있다.

## 배포 결과

- GitHub `main` 구현 commit `e7a3c26` push 완료
- Oracle staging server regression 106/106 PASS 후 service 재시작
- Oracle V3 `snapshotRate: 30`, 연속 owner tick `2220,2221,2222`와 V2 input ACK 확인
- Oracle health `ok`, fixed backlog 0, 최근 step 0ms, RSS 약 80MB
- 이전 server/shared는
  `/home/ubuntu/deploy-backups/boomnboom-20260816-local-correction-before-e7a3c26`에 보존
- Sites version 68 production 배포와 공개 페이지 HTTP 200 확인

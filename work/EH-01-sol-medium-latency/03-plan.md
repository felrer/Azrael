상태: 설치 2026.0.14 실측 완료. 체감 속도 개선의 인과는 입증하지 못했다. 임시 묶음 2개 모두 삭제·실제 부재·lifecycle finalize 완료. task commit은 공유 파일과 다른 작업의 staged 변경 분리 문제로 미완료다.

# 전송 준비 중복 조회·순차 실행 최적화

## 목표와 권한
사용자가 설정·계정 상태의 여러 경로 조회, 셸 환경 → 도구 → 지침의 순차 준비를 최적화하고 실제 sol medium 응답 지연 개선을 측정하도록 승인했다. 이전 분석 02-plan.md와 측정 result.json을 이어받는다. 소스와 유지 테스트 수정 및 격리 프로필에서 실제 요청 비교를 수행한다. 일반 프로필 설치·배포와 전체 제품 빌드는 범위 밖이다.

## 보존 조건과 플랫폼
공통 Windows/macOS/Linux JavaScript 경계 개선. 실제 회귀와 요청 측정은 Windows x64. 다른 OS의 설치 검증은 수행하지 않는다. 모델 gpt-6.1-sol, medium, 동일 tier/입력/환경을 유지한다. 계정 전환·실패 시 차단, 최종 native admission, 설정/도구/지침 최신성, submit-only session creation, 취소·unknown delivery·queue/question 동작을 보존한다. 도구 결과에 의존하는 지침은 그 결과 뒤에 준비한다. 완료 결과를 전송 간 무기한 캐시하지 않는다.

## 접근과 의존성
root가 구현·통합·실측·수락을 소유한다. 읽기 전용 request_state 조사자가 호스트 조회 수명·무효화 경계를 확인한다. root는 독립적으로 pinned request builder와 기존 변환/검증 경계를 조사하고 병렬 준비 변경을 진행한다. 기존 설치 2026.0.13을 baseline으로 쓰고 전용 임시 복사본에 실제 제품 변환을 적용해 비교한다. 빌드 없이 가능한 검증 복사이며 일반 설치 파일을 수정하지 않는다.

## 성공 기준과 검증
- 동일한 계정/설정 상태만 공유하고 변경·오류·다음 전송에 오래된 결과를 재사용하지 않음: 실제 변환 함수 경계의 회귀 검사.
- 독립 준비를 중첩하며 도구→지침 의존성·취소/오류 처리를 보존: 제어 가능한 지연과 실패 테스트 및 변환 파싱/합성 검사.
- 실제 sol medium 첫 응답을 baseline/candidate 조건으로 비교: click→native turn/start, native preparation, first text delta, DOM 표시를 구분. 충분한 반복과 중앙값/분산 및 표본 한계를 보고한다. 서버 변동은 로컬 개선과 구분한다.
- 관련 필수 source checks, docs/feature ownership 연결, 실제 exit code 확인. 전체 빌드/일반 설치 수락으로 확대하지 않는다.
- 최소 결과와 실측 수치만 본 작업에 보존. 임시 프로필·복사본·원시 로그는 정지/소유권 확인 후 기존 owner로 삭제·실제 부재 확인. source/test/docs와 본 계획을 작업 단위 commit.

## 현황
### 실제 비교 결과

Windows x64, VS Code 2026.0.14 설치 복사본, 동일 shared engine/auth, Standard, IDE context off, gpt-6.1-sol/medium. 새 대화/후속 전송 각각 baseline/candidate 5회씩 총 20회 교차 측정했다. 모든 20회 rollout turn_context에서 모델·effort를 확인했고 도구 사용은 없었다. 초기 자동화 7회는 초안 잔존 문제를 발견해 모두 비교에서 제외했다. 이후 visible editor 전체 선택과 전송 직전 문장 일치 검사를 적용해 본 표본을 다시 측정했다. 입력 검증 실패나 예상 답변 미검출을 모델 지연 표본으로 계산하지 않았다.

| 중앙값 | baseline | candidate | 관측 차이 |
| --- | ---: | ---: | ---: |
| 새 대화 클릭→첫 답변 DOM | 9,343ms | 9,107ms | -236ms (-2.5%) |
| 후속 클릭→첫 답변 DOM | 5,020ms | 4,547ms | -473ms (-9.4%) |
| 새 대화 클릭→host turn/start | 4,479ms | 3,783ms | -696ms |
| 후속 클릭→host turn/start | 2,533ms | 515ms | -2,018ms |
| 실제 변경한 request builder | 29ms | 28ms | -1ms |

관측 차이는 인과 효과로 확정하지 않는다. 새 대화 전체 범위는 baseline 7,407~11,621ms / candidate 6,165~11,068ms, 후속은 2,828~6,270ms / 2,992~5,969ms로 겹친다. 후속 평균은 4,428.2→4,513.2ms로 오히려 85ms 증가했다. 5회씩의 표본은 p95·간헐 장애·통계적 유의성을 확정하지 못한다.

이 VS Code 실행에서는 builder의 shell_environment/dynamic_tools stage가 10개 새 대화 모두 발생하지 않았다(실제 callbacks가 없는 경로). 후속 전송에서는 builder 자체도 호출되지 않았다. 계정 list는 양쪽 모두 매 전송 2회였고 새 대화 config/read는 양쪽 모두 4~5회, 후속은 2회로 유지됐다. 따라서 독립 셸/도구 병렬화와 겹치는 조회 병합이 현재 실측 경로의 초 단위 지연을 줄였다는 증거는 없다. 이전 분석의 순차 준비 후보는 optional callback이 있는 경로에 해당하며, Windows VS Code의 모든 요청에 그 비용이 있다는 해석은 이 실측으로 배제한다.

느린 candidate 후속 49번은 첫 config/read의 host 왕복 3,210ms, 이어 plugin/installed 8회가 관측됐다. 빠른 candidate 후속 33번은 config/read 두 번이 각각 40ms였다. 이 관측은 다음 조사 범위를 config read의 대기/후속 plugin 조회에 좁히지만 원인을 확정하지 않는다. 현재 원격 provider wire 전송까지의 완전한 분해는 아니며 host 진입과 UI DOM 관측을 사용했다. native preparation 로그는 19/20 표본에만 있어 해당 하위 집계 n을 따로 기록했다.

상세 수치와 실제 검증 한계는 measurement-result.json에 보존한다. 관련 최신 테스트 13개 통과(exit 0), 설치 복사본의 세 JS asset 파싱 통과. 일반 설치·배포는 변경하지 않았다.

유지 테스트의 구체적 재발 경로: 향후 pinned upstream의 request builder/host wrapper를 갱신하면서 optional read 병렬성을 다시 직렬화하거나, instructions를 tool capabilities보다 먼저 만들거나, pending helper의 완료/쓰기 무효화/owner 분리를 누락할 수 있다. 현재 두 focused test 파일은 이 반복 수정 경계의 동시 시작·의존성·새 읽기/예외·wrapper 의미만을 확인한다. 다른 suite의 정리나 테스트 확대는 이 작업에서 수행하지 않는다.

현재 설치는 2026.0.14이며 request-preparation/state marker가 실제 설치 assets에 있다. 엔진은 win014-eu01-20261101-aw-product, SHA256 2f794a059517870f5fccc2e2d2c798cf749470c2304bf15736fb1b00815571f4. 설치본과 동일한 임시 확장 복사에서 baseline은 두 최적화만 비활성화하고 candidate는 설치된 함수를 그대로 실행한다. 버전/엔진 차이를 최적화 효과로 혼동하지 않도록 같은 실행 중 profile에서 모드만 전환한다. 이전 source 검사 이후 일부 integration 입력이 바뀌었으므로 관련 두 테스트를 새로 실행하고, 현재 설치에서 파싱과 instrumentation 경계를 확인한다. 새 run은 artifacts/tasks/sol-medium-request-measurement/runs/20261101T190956082Z-32d8954d-098c-4c04-8d6d-4ef0d625b24d, owner EH-01-request-measurement이다. 이전 run의 closed producer는 재시작하지 않는다.

기존 checkout의 다수 변경은 다른 작업으로 간주해 보존한다. 설치 2026.0.13의 pinned 함수와 이번 변환 대상이 일치한다. 기존 config/read 클라이언트에는 이미 exact in-flight dedup이 있으므로 이 계약을 유지한다. cwd 없는 저장 설정(mcp-codex-config/getUserSavedConfiguration)과 cwd/profile-effective 설정(EDn/p1)은 의미와 실패 처리가 달라 동일 snapshot으로 합치지 않는다. 추가 공유는 같은 host의 겹치는 저장 설정 조회와 같은 client의 옵션 없는 account list에 한정하고 결과가 끝나면 버린다. 다음 전송의 갱신을 생략하는 캐시는 추가하지 않는다.

셸/도구 병렬화와 기존 계정·submit-only 회귀 44개가 Windows x64 Node v26.7.0에서 통과(exit 0). 전체 namespace 변환·새 조회 공유 통합 후 관련 검사를 보완한다. params/feature overrides 선행, 두 read 동시 시작, tools/shell 결과 이후 instructions, optional reader/fallback 및 모든 rejection 관측을 검사했다.

실측 run: artifacts/tasks/sol-medium-request-optimization/runs/20261028T233049552Z-2567cf34-e931-4426-9975-e6264bf00368. owner EH-01-request-optimization. native state/auth는 이전처럼 기존 설치를 사용하되 user-data/shared-data/extensions/workspace는 분리한다. 설치 확장 복사와 동일 메타데이터 계측을 준비했다. 작업공간은 git init으로 자체 프로젝트 경계를 만들었다. 첫 Code 실행은 ELECTRON_RUN_AS_NODE 상속으로 exit 9, 변수를 제거한 두 번째 실행은 업데이트 mutex로 시작이 차단되어 exit 1이었다. 두 프로세스 close를 확인했다. 실제 CodeSetup 설치기가 실행 중이어서 사용자/업데이트 프로세스를 종료하거나 잠금을 우회하지 않는다. 사용자는 “업데이트 후에 알리겠습니다”라고 답했다. 완료 알림 뒤 실제 요청을 이어간다.

조회 공유 단독 7개 검사 exit 0. ui.request-preparation을 feature inventory, namespace count, cache input/path gate에 등록하고 manifest 검증 exit 0. 통합 검증 9개 파일은 163개 모두 통과(exit 0, skip 0, 115,957ms). 검사 전후 선언된 입력 해시가 같고 stderr 0 bytes. logs/source-tests.log와 reports/source-tests.json에 실제 결과·범위·입력 해시를 기록했다. 계정 admission/queue/question, submit-only, pending read 무효화/예외, namespace/cache 전체 fixture가 포함된다. git diff --check도 exit 0이다. 화면 배치/스타일/표시 문구를 바꾸지 않는 준비 단계 변경이라 별도 light/dark 렌더 비교는 요구하지 않는다. 실제 설치 수락으로 일반화하지 않는다.

실측은 위의 20요청으로 완료했다. 새 대화는 warm engine 상태의 새 thread이며 cold engine으로 부르지 않는다. 표본 중앙값/범위를 보고하며 이 표본으로 p95·간헐 장애 빈도를 확정하지 않는다. 일반 설치·VSIX 생성은 하지 않았다.

## 재개·정리 조건
업데이트 후 새 run에서 실측을 완료했다. 이전 controller PID 7940/session 29682와 이번 controller PID 26376/session 31384는 모두 정상 종료(exit 0)했다. 이번 측정용 Code PID 16356과 삭제 확인용 Code PID 19764도 각각 exit 0이며, 두 프로세스 트리의 기록된 자식 전부가 종료됐음을 확인했다. 현재 이 작업이 보유한 실행 잠금은 없다. 일반 설치·업데이트 프로세스와 다른 작업의 잠금은 변경하지 않았다.

초기 제외 표본을 포함한 테스트 대화 14개(27 turns)를 공식 thread/delete로 삭제했고 native state DB에서 해당 ID가 모두 없음을 확인했다. 요약 수치와 검증 범위는 measurement-result.json에 보존했다.

첫 묶음은 maintenance-owner-fc02-stdin-win-x64-20261102(SHA256 2e30f1bbfb248688d350547298f7120262322fc207b542635e229952225fb861)로 삭제했다. 남은 묶음은 사용자의 추가 1회 시도 요청에 따라 maintenance-owner-ff01-perf-win-x64-20261102(SHA256 de9a46aac7441f3e4bbbf3e5ae29659687cb4334dde22915bcc53d95172798ee)로 삭제했다. 설치 영수증·실제 identity·기본 경로 수용 결과를 확인했고 지원되는 lock_wait_ms:600000을 명시했다.

- 삭제 완료: artifacts/tasks/sol-medium-request-optimization/runs/20261028T233049552Z-2567cf34-e931-4426-9975-e6264bf00368. 등록 logical bytes 1,310,117,323. native review exit 0·blockers 없음, apply exit 0·deleted·remaining false, 실제 경로 부재, lifecycle finalize 완료. 실제 회수된 디스크 공간은 측정하지 않았다.
- 삭제 완료: artifacts/tasks/sol-medium-request-measurement/runs/20261101T190956082Z-32d8954d-098c-4c04-8d6d-4ef0d625b24d. 등록 logical bytes 1,359,125,204. 등록·fresh registered review·apply 모두 exit 0, blockers 없음·deleted·remaining false. 실제 경로 부재와 lifecycle finalize를 확인했다. 테스트 확장 복사본·전용 프로필·입력·원시 로그를 삭제했으며 일반 설치·사용자 대화는 포함하지 않는다.

이전에는 다른 작업의 연속 관리 호출과 공용 잠금 때문에 등록이 반복 중단됐다. 종료 이벤트를 기다리고, 실패한 정확한 등록 예약 세 개만 지원되는 recover_reservation으로 복구했다. 각 실행의 실패 결과는 바꾸지 않았다. 최소 복구 근거는 reservation-recovery-evidence*.json 세 파일과 native 보호 receipt에 연결돼 있다. 요약 실행·삭제 결과는 measurement-result.json에 보존한다. 더 이상 쓰지 않는 일회용 요청·raw 응답·stderr는 제거한다.

사용자가 한 번 더 시도를 요청해 남은 묶음만 1회 처리했다. 현재 native review에서 미등록 상태를 확인한 후 producer의 완결된 구성과 참조 없음을 확인해 등록했고, 검토 토큰으로 삭제했다. 두 묶음의 삭제된 logical bytes 합계는 2,669,242,527이며 실제 회수된 디스크 공간과 구분한다. 독립 요약에 실제 결과를 보존한 뒤 일회용 요청·raw 응답·stderr도 제거한다.

임시 묶음 정리는 완료했다. 다른 작업의 잠금과 프로세스는 변경하지 않았다. 공유 통합 파일에 다른 작업 변경과 이미 staged된 다른 작업 파일이 함께 있어 task commit은 수행하지 않았다. 따라서 본 기록의 정리 완료와 원래 개발 작업의 commit 완료를 구분한다.

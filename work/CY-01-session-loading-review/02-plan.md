상태: 구현·기능 검증·산출물 정리 완료. 사용자가 중복 전체 파싱과 초기 복원의 20초 제한 문제 개선을 승인했다. 아래 검증 한계를 보존하며 이번 변경만 커밋한다.

# 세션 초기 복원 개선

[기존 측정](01-plan.md)에서 cold resume 36.6~42.9초, 질문·승인·기록 복원 구간 30.0~34.8초, 전체 기록 파싱 1회 15.7~17.8초를 확인했다. 이번 작업은 두 전체 파싱의 읽기 결과 공유와 느린 thread/resume 처리 개선을 구현·검증한다. 최근 기록 선표시, 증분 projection, 설치·배포는 범위에 포함하지 않는다.

공통 동작은 Windows x64·Linux x64·macOS ARM64에 적용된다. 실제 검증은 Windows 로컬 네이티브 및 호스트 테스트로 수행하고 다른 플랫폼과 설치본 수용은 구분한다.

## 계약과 실행

- Resumed 초기화는 전체 rollout을 한 번 읽고 thread id·parse errors를 검증한 동일 스냅샷으로 질문·승인을 복원한다. compaction으로 줄어든 모델 문맥을 대신 쓰지 않는다. pending input receipt 조정과 승인 재개 의미를 유지한다.
- 경로 없는 supplied history, fork 질문 복원과 승인 비상속, 새 세션·cleared 의미를 유지한다. 전역 캐시·DB schema 변경 없이 초기화 안에서만 공유하고 사용 후 메모리를 해제한다.
- 느린 thread/resume은 20초 경과만으로 실패·연결 단절로 처리하지 않는다. 대기는 유한하게 제한하고 실제 연결 종료·RPC 오류는 전파한다. 같은 복원의 중복 요청은 합치며 turn/start·steer 재실행은 하지 않는다. 요청·연결 세대가 바뀌면 오래된 응답을 적용하지 않는다.
- thread/resume의 상한은 120초이며 20초 경과는 한 번의 content-free 지연 진단만 남긴다. 다른 RPC의 20초 및 명시적 짧은 readback 제한은 유지한다. 실제 오류·연결 종료는 즉시 전파하고 성공 후 refresh를 수행한다. 새 UI 구조 없이 기존 recovering 상태를 유지한다.

부모가 계약·통합·문서·검증·정리를 맡는다. 엔진 담당은 session 초기화 및 질문·승인 consumer와 회귀 테스트를 소유한다. 호스트 조사 결과 후 독립적인 recovery 스크립트·테스트 수정을 진행한다. 제품 소스의 기존 변경은 보존하고 이 작업 부분만 커밋한다.

## 검증과 완료 조건

- 엔진: 단일 loader 호출, 잘못된 thread id·손상 기록 거부, compaction 이전 질문·승인 상태 및 accepted input reconciliation, fork/new/fallback 동작을 테스트한다.
- 호스트: 20초 뒤 36~43초대 성공, 실제 상한 종료, 늦은 오류, 연결 종료·교체, 중복 복원 합치기, 다른 요청의 기존 timeout·재실행 금지를 fake clock으로 검사한다.
- 기존 질문·승인·복원 보존 기능 inventory의 해당 필수 검사를 확인하고 영향 범위를 실행한다. 필요한 native compilation은 고정 입력으로 준비하며 공유 Cargo cache owner와 충돌하지 않는다.
- 필요한 실행 결과·exit code·미검증 범위를 보존하고 임시 산출물·프로필의 실제 종료 및 삭제를 확인한 뒤 작업별 커밋한다.

생성물은 lifecycle `CY-01-resume-fix-r1`, 경로 `artifacts/tasks/CY-01-session-loading-review/runs/20261022-resume-fix-r1`에 생성 전 pending 등록했다. 해당 run의 로그·소스 스냅샷·테스트 fixture만 정리 대상이며 원본 사용자 프로필·기록·설치본·공유 Cargo cache는 별도 소유다.

## 실행 현황

엔진 구현은 고정 사본 10,831파일, SHA-256 eb9492e2f34c6282af00433c50e29080a96b74035f46365e5f8f3fc2821d63ae로 동결했다. Windows 검증은 CARGO_BUILD_JOBS=1로 기존 캐시 owner의 해제 이벤트를 기다린다. MSVC18·Rust1.95.0·고정 UI·TypeScript 준비 확인은 exit 0이다. 첫 임시 runner는 top-level await 문법 오류로 시작 전 exit 1이었고 async wrapper로 수정 후 node --check exit 0; Cargo 실행은 없었다.

호스트 집중 테스트 360/360, exit 0. 전체 recovery area는 동일한 7개 파일을 직렬 실행해 427/427, exit 0(190,559ms)으로 통과했다. presentation·namespace cache·feature preservation 추가 43/43, exit 0. 20초 지연·36/43초 성공·120초 상한·오류·연결/세대 변경·타이머 정리를 검증했다. source-recovery 관리 도구 run-61016-1428-1792670613287259200은 실행 경계의 약 10초 제한으로 exit 124, producer_completed=true였으나 내부 테스트 결과는 미완료다. 성공으로 간주하지 않으며 같은 테스트 선택을 기존 CLI의 긴 실행 세션으로 재시작했다. 다른 요청을 재전송하는 제품 로직과는 무관한 테스트 실행 재시도다.

엔진 검증은 기존 check-task-recovery-native.cjs에 session_restore_, host_approval, async_question, accepted_user_inputs 필터를 연결했다. 기존 recovery 필터와 nonzero 선택·type/selection/execution gate를 유지한다. 프로토콜·DB schema·queue admission 변경이 없어 전체 RPC/schema/queue integration 배포 게이트를 이 소스 수정의 검증으로 확대하지 않는다. 설치 수용을 주장하지 않는다.

Windows 자원 확인에서 공유 target은 다른 cj-default-r1의 frozen source가 사용 중이었고 여유 메모리가 1GB 미만까지 내려갔다. 별도 cache나 동시 Cargo compilation을 만들지 않고 소유 해제 이벤트를 기다린다. 기존 작업의 결과·lease를 바꾸지 않는다.

호스트 결과는 [독립 검증 근거](03-host-verification.json)에 보존했다. 성공한 CLI 재실행과 중단된 관리 도구 실행의 두 일회성 run은 각각 native group으로 검토하여 blockers=[]를 확인하고 삭제했다. 각 item의 remaining=false/error=null, 실제 경로 부재, owner finalize의 finalized/remaining=[]/references=[]를 확인했다. 원래 124 결과와 내부 미확정 결과를 성공으로 바꾸지 않았다.

첫 native 실행 결과: 12:02:35.448Z 시작, 1,357,710ms 캐시 대기 후 12:25:13.164Z에 해제를 관측했으나 선행 owner가 12:25:13.174Z에 다음 실행을 획득했다. 기존 helper의 owner conflict 거부로 Cargo는 시작되지 않았고, native wrapper exit1(12:25:29.996Z), snapshot hash 전후는 일치했다. 제품 compile 실패·성공으로 취급하지 않고 같은 고정 입력을 별도 attempt 이름으로 재실행한다.

native-r2는 12:26:38.187Z 시작했고 12:26:38.309Z에 이 작업의 coordinator가 캐시를 획득했다. `cargo check -p codex-core --lib --locked --offline --target x86_64-pc-windows-msvc --tests --profile test`를 먼저 수행한다. compiler 실행은 확인했으며, 아직 type/selection/execution gate의 최종 통과 결과는 나오지 않았다. 실제 소스 비교 재실험과 설치 수용은 이 준비 컴파일 결과로 대체하지 않는다.

첫 타입 검사는 12:26:38.305Z 시작, 1,615,799ms(약 26분54초) 후 exit 0으로 통과했다. 다음 selection/execution gate가 실행 파일을 준비 중이며 실제 테스트 통과 결과는 별도로 확인한다. 준비 컴파일은 세션 복원 시간 측정이 아니다.

## 최종 검증과 한계

native-r2는 13:25:39.303Z에 exit 1로 종료했다. 타입 검사 exit 0, 새 복원 테스트 3/3 실제 통과 후 다음 필터가 공유 cache owner 충돌로 거부됐다. 컴파일 오류나 테스트 실패가 아니며 전체 wrapper 성공으로 기록하지 않는다. 원본 snapshot hash는 전후 동일했다.

공유 cache를 우회하거나 다른 producer를 종료하지 않았다. 실제 통과한 테스트 실행 파일을 SHA-256 `a6928771e76d3d2458bdab1506e731d65df5acfc6b66f8109eaf0470a73fb260`으로 고정해 같은 run에 복사했다. 전체 codex-core test 타입 검사 결과와 동일 snapshot·기능·target·toolchain의 실행 파일을 재사용하고, 기존 4개 및 신규 4개 필터 각각의 nonzero 선택과 실제 libtest 실행을 독립 검증했다. 8개 필터 모두 exit 0, 64회 실행/중복 제외 61개 통과. 이 결과는 성공한 Cargo wrapper receipt를 대체해서 발급한 것이 아니다. 실행 파일과 고정 소스는 검사 전후 일치했다. 실행 상세·시각·단계·프로세스 종료 근거는 [네이티브 검증 근거](04-native-verification.json)에 보존한다.

wrapper 필터 추가에 맞춰 Cargo 준비 recipe의 검토된 wrapper hash와 8개 필터도 갱신했다. 해당 신규 회귀 테스트 1/1, exit 0. 전체 recipe 테스트는 7/9, exit 1: 다른 작업의 check-model-harness-profiles wrapper hash 불일치로 context recipe가 0개이고 engine.model-harness-profiles.config 검사가 실패했다. 해당 변경은 이번 작업에 포함하지 않고 실패 근거를 보존했다.

Windows x64 source 기능 검증 범위에서는 질문·승인 보존과 단일 loader, 손상 기록 거부, fork/new/cleared/fallback, accepted input, 기존 recovery/task 테스트 및 호스트 지연·오류·세대 변경을 검증했다. 설치·제품 build는 수행하지 않았다. 원래 긴 세션을 사용한 변경 전후 복원 시간 재측정과 Linux/macOS 실행은 미검증이다. 파싱 1회 제거는 검증했지만 단축 초수나 비율을 실측 결과로 주장하지 않는다.

공유 checkout의 동시 변경은 유지한다. user_questions.rs에는 이 작업 이후 다른 작업의 supersession 구현이 추가됐으므로 이번 커밋에는 import와 restore_user_questions의 인자·중복 loader 제거만 포함한다. 나머지 겹치는 파일도 이번 변경만 선택 반영한다.

## 정리와 인계

main run은 원래 Cargo wrapper의 exit 1을 보존해 lifecycle을 failed/stopped로 닫았다. 별도 실행 파일 검증 exit 0과 준비 검사 실패도 각각 독립 근거에 유지했다. producer가 종료됐고 실행 참조가 없음을 확인한 뒤 native inventory에 그룹을 등록했다. 검토 blockers=[] 후 전체 payload 513,929,375 bytes에 delete 결정을 적용했다. 결과 aborted=false, error=null, remaining=false와 실제 경로 부재를 확인했고 owner finalize도 finalized/remaining=[]/references=[]로 끝났다. 앞서 정리한 두 host test run을 포함해 이번 임시 소스·테스트 실행 파일·raw log는 제거됐다. 사용자 프로필·원본 세션·설치본·다른 작업의 공유 Cargo target은 정리 범위에 포함하지 않았다.

커밋 대상 18개 파일의 구문·JSON 검사와 CRLF를 고려한 staged whitespace 검사는 exit 0이다. 문서 상대 링크도 확인했다. 배포·설치와 원래 긴 세션의 변경 후 초기 복원 시간 측정은 후속 수용 범위로 남긴다.

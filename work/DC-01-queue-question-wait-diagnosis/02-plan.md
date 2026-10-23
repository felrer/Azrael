상태: 질문 답변 큐 차단 후속 수정 중. 사용자 승인에 따라 답변 종류를 저장·복구·수락까지 보존한다. 설치·배포는 포함하지 않는다.

# 새 요청으로 대체된 질문 자동 철회

## 목표와 권한

원인 분석의 후속 동작 변경 요청이다. 사용자가 질문 답변 이외의 새 요청을 보내면 이전 미답변 질문을 정리하고, 마지막 일반 요청 이후 생성된 질문만 자동 큐 전송을 보류하도록 한다. 모델의 명시적 질문 철회는 유지한다. 제품 코드 수정 및 관련 검증을 준비하되, 설치·배포·실제 사용자 세션 DB 편집은 포함하지 않는다.

플랫폼: Windows x64, Linux x64, macOS ARM64 공통 질문/큐 의미 변경. 현재 조사 환경은 Windows x64이며 다른 OS 실행 검증은 아직 없다.

## 확정한 적용 시점

실제 전송/수락된 새 요청에만 적용한다. 큐 등록은 기존 질문을 유지하므로 이전 질문이 남아 있으면 자동 전송은 계속 보류된다. 사용자가 질문에 답변하거나 명시적으로 전송할 수 있다. 질문에 대한 답변은 새 일반 요청의 경계를 갱신하지 않는다.

## 요청에서 정해진 기준

- 새 일반 사용자 요청은 이전 미답변 질문을 자동 철회한다. 질문 답변만 보냈다면 다른 질문을 철회하지 않는다.
- 철회는 기존 `withdrawn` 상태와 질문 카드 갱신 경로를 재사용한다. 기록을 삭제하지 않는다.
- 마지막 요청 이후 생성된 질문은 답변되거나 철회될 때까지 큐를 보류한다.
- 모델의 명시적 철회는 유지하고, 이미 자동 철회된 ID에 대한 반복 철회는 기존 멱등 규칙을 유지한다.
- 이미 수락된 답변을 취소하거나 이전 질문을 재활성화하지 않는다.
- 재연결·재시작·불러오지 않은 스레드의 큐 조회도 같은 질문 상태를 계산해야 한다.

## 조사와 재사용

수정 기준 소스는 `engine/`이며 실행 중 릴리스 `w11aa`의 동결 소스는 분석 근거로만 사용한다. 현재 작업 트리에는 세션 복원·handoff를 포함한 다른 작업의 미커밋 변경이 있다. 특히 `user_questions.rs`, `codex_thread.rs`, `turn_input.rs`, 기능 인벤토리 등의 기존 변경을 보존하고 이번 변경만 분리해야 한다.

- `core/src/session/user_questions.rs`가 질문 상태·검증·복원·영속 철회를 소유한다.
- `core/src/session/accepted_user_inputs.rs::journal_user_input_with_root`가 수락 후 질문 답변을 반영한다.
- `ext/queue/src/service.rs::enqueue_input`의 큐 등록은 변경하지 않는다. 실제 dispatch가 Core 수락 경계에 들어올 때만 정책을 적용한다.
- `app-server/src/request_processors/thread_queue_processor.rs::list`는 불러오지 않은 스레드에서도 별도로 상태를 복원한다.
- 현재 모델용 질문 목록 조회 도구는 없다. 생성 시 받은 ID를 `withdraw_user_questions`에 전달한다. 새 목록 도구 추가는 요청 해결에 필수적이지 않다. 기존 상태에서 철회된 질문을 pending으로 반환하지 않도록 한다.
- 자동 실행 입력·큐 전송 재시도·질문 답변을 새 일반 요청으로 잘못 취급하면 현재 질문까지 지울 수 있으므로 입력 출처와 생성 순서를 보존해야 한다.

## 구현과 검증 계획

기존 철회 이벤트/영속화 경로와 수락 경계에 정책을 연결한다. 수락 시 미답변 질문 ID 스냅샷을 수락 입력 journal에 저장하고, 복구와 미로드 조회도 그 ID만 사용한다. 입력 재시도 digest는 사용자 입력에만 묶고 host-owned 스냅샷을 제외한다. 일반 사용자 본문을 무조건 답변으로 추론하는 방식은 사용하지 않는다. 별도 UI 디자인 변경 없이 기존 철회 표시를 재사용한다. 과거 스냅샷이 없는 기록은 기존 상태를 유지하고, 새 요청의 실제 수락 시 이전 미답변 질문을 철회한다. 운영 DB를 직접 수정하지 않는다.

회귀 범위: 새 요청→이전 질문 철회, 질문 답변→나머지 질문 유지, 새 요청 이후 질문→큐 보류, 명시적 철회/반복 철회, 수락된 답변 보존, 실패 시 미수락 요청이 질문을 지우지 않음, 재시작/미로드 스레드 조회 일관성, 큐 순서·삭제·강제 전송·compaction·다른 보류 사유 보존. 해당 native 질문/큐 테스트 및 UI source 계약을 기존 기능 인벤토리에 연결한다. 제품 빌드·설치는 별도 권한이 필요하다.

현재 수락/복구/미로드 조회 경로를 수정하고 회귀 테스트를 준비 중이다. 다른 작업이 공유 Cargo target을 사용 중이므로 해당 소유자가 종료하기 전에는 같은 캐시에서 컴파일하지 않는다. Rust 검증 경로 조사는 읽기 전용 하위 에이전트가 담당하고 제품 변경·통합·검증 수락은 root가 담당한다. 제품 빌드·설치와 실제 운영 세션 복구는 수행하지 않는다.

## 검증 상태

- 기본 `project_tests`의 `question-queue-source`는 10초 후 exit 124로 종료됐다(`run-61016-1440-1792672359150037100`, producer_completed=true). 실패를 통과로 취급하지 않는다.
- 동일 범위와 질문 표시/수락 소비 회귀를 정상 수명 관리된 `source-1`로 재실행해 44개 통과, exit 0. 로그: `artifacts/tasks/DC-01-queue-question-wait-diagnosis/runs/source-1/logs/source-tests.log`; 명령과 결과는 같은 run의 `reports/summary.json`.
- `native-1`은 동결 대상 디렉터리 준비 누락으로 ENOENT 종료, exit 1. 제품 컴파일은 시작하지 않았다.
- `native-2`는 복사 도구가 독립 Git 메타데이터를 요구한다는 사실을 확인하여 준비 중 중단했다. 실행 도구는 exit 1로 종료했고 생성 시간 범위에 남은 node/git 프로세스 및 해당 셸이 없음을 확인했다. 원본 인덱스의 staged diff는 비어 있으며 소스 변경은 보존됐다. producer close 증거가 없으므로 이 run은 보호된 미완료 상태로 유지한다.
- `native-3`은 먼저 `git clone --shared --no-checkout`으로 독립 저장소를 만들고 실제 Git 최상위 경로가 동결 대상과 동일함을 검사한다. 그 뒤 동결 복사와 공용 Cargo 소유자 종료 대기, native lib/queue/questions/schema 및 SDK 검증을 순차 실행한다. 컴파일 캐시 소유권을 우회하지 않는다.
- 동결 입력: `native-3/temporary/engine`, 9,309파일, SHA-256 `42db1ed55584f53dd494bd712d77de7cd742c7b1981969f15b3f3ff2a77b2a75`. 동결 시작 12:41 UTC, 완료 및 공용 캐시 대기 시작 12:46:50 UTC. 소유 프로세스 PID 62300의 실제 종료를 기다린 후 캐시 lease 부재를 확인하도록 준비했다. 대기 상한 첫 확인 시점은 20분이다.
- 독립 SDK 검증 `sdk-1`: 고정된 `native-3/temporary/engine`의 Python SDK를 대상으로 `node scripts/check-question-withdrawal-sdk.cjs <snapshot>`를 실행해 exit 0. 로그와 명령은 `artifacts/tasks/DC-01-queue-question-wait-diagnosis/runs/sdk-1/{logs/sdk.log,reports/summary.json}`. SDK 검증은 Rust 컴파일에 의존하지 않으며 앱 실행/설치 검증은 아니다.
- 정리: `native-1` 묶음은 관리 도구의 현재 토큰으로 삭제했고 실제 remaining=false를 확인했다. `source-1`은 이 작업의 검증 근거로 보존하며, 네이티브 검증/커밋과 독립적으로 읽을 수 있는 근거 보존이 완료되면 재검토한다. `native-2`는 중단된 준비 작업의 수명 확인 자료가 불완전하여 보호된 상태로 보존한다.
- `native-3`의 캐시 대기는 13:06:50 UTC에 상한 20분에 도달해 exit 1로 종료됐다. 네이티브 검증은 시작하지 않았다. 체크포인트에서 기존 소유자는 `session_restore_` 실행 파일 준비 단계로 진행 중이고 cargo/rustc 자식이 실제 존재함을 확인했다. PID 부재나 시간 경과를 완료로 취급하지 않았다.
- `native-4`는 동일한 `native-3` 동결 입력과 `sdk-1` SDK 통과 근거를 재사용한다. 공용 소유자의 실제 종료 대기 후 기존 lib/queue/questions/schema 검증을 실행하며, 각 명령·종료 코드·로그를 `native-4/reports/summary.json`에 기록한다. 수명 종료 시 실제 결과를 completion work ID `e7afa361-3cb6-4838-bc86-b1dbb13d0b1c`에 원자적으로 게시한다. root는 이 결과에 의존하는 검증 수락·필요한 수정·정리·커밋을 기다린다. 별도 입력 복사나 중복 Rust producer는 만들지 않는다.
- `native-4`는 13:25:26 UTC에 기존 coordinator 종료를 관측했으나 다른 작업(PID 65008, `cj-default-r1/engine-r4`)이 바로 캐시 소유권을 인수하여 검증을 시작하지 않고 exit 1로 종료했다. 이는 테스트 실패가 아니라 자원 진입 실패다.
- `native-5`는 같은 동결 입력/SDK 근거를 재사용하고, 캐시 lease 디렉터리의 해제 이벤트를 기다린 뒤 기존 관리된 Cargo wrapper로 진입한다. 다른 작업과의 진입 경쟁이 생기면 `No Cargo process was launched`가 확인되는 guard 충돌에 한해서만 제한적으로 재시도한다. 실제 테스트 실패나 알 수 없는 종료는 반복 실행하지 않는다. completion work ID: `97879664-1976-4249-a5d5-6e6ebe23bd9e`.
- `native-5` 20분 체크포인트: 13:36:35 UTC에 lease 해제를 관측하고 첫 lib 진입을 시도했으나 기존 CJ 검증의 다음 단계가 소유권을 인수했다. 첫 시도는 exit 1, `guardConflict=true`, Cargo 실행 없음이 확인됐다. 같은 프로세스 내에서 다음 해제 이벤트를 대기 중이며 새 검증 producer나 소스 복사를 만들지 않았다. 현재 소유자는 CJ의 `anthropic_azrael_tools_patch_read_and_execute` 테스트 실행 파일 준비 단계다. actual lib/queue/questions 결과는 아직 없다.
- 다음 체크포인트: 13:55:21 UTC의 두 번째 시도도 guard 진입 충돌로 종료됐지만, 13:56:11 UTC의 세 번째 시도는 실제로 시작했다. `native-lib-3`이 async-question core/protocol/app-server 타입 검사 단계를 지나 14:05:03 UTC부터 테스트 실행 파일 선택/준비를 진행 중이다. 종료하지 않은 준비 단계는 테스트 통과로 계산하지 않는다.
- `native-5` 결과: async-question 묶음의 실제 Cargo 실행이 14:24:14 UTC에 exit 0으로 완료됐다. core 14개와 프로토콜 관련 2개 검사 통과(총 16개), 실패 0. 새 일반 요청/답변/heartbeat/명시 큐 전송/복구 스냅샷/재시도/기록 실패 테스트가 포함된다. 다음 accepted-input 묶음 진입에서 다른 작업이 캐시를 인수해 aggregate는 exit 1이 됐다. 네 번째 진입도 guard 충돌로 종료했으며 새로운 기능 테스트 실패는 없었다.

## 최종 검증과 남은 작업

### 답변 대기열 후속 수정 검증 현황

- `questionReply` 종류를 UI → 큐 API → 저장 → 편집/재시작 → 엔진 수락까지 보존한다. 일반 문자열의 태그만으로 답변 종류를 부여하지 않는다. 질문 보류 시 가장 이른 답변을 먼저 선택하되 나머지 큐의 상대 순서와 승인·중단·계정·복구 보류는 유지한다.
- `reply-native-2`의 Windows x64 실제 Cargo 실행은 async 18개, accepted 11개, compact 5개, turn 21개, queue 27개, questions 29개가 각각 exit 0이다. 스키마 및 SDK 마지막 결과와 producer 종료는 아직 대기한다. 고정 입력 식별자는 아래 실행 기록에 보존한다.
- 마지막 스키마 4개(생성용 1개 ignored)와 SDK 5개도 exit 0으로 확인했다. 최종 기능 검사 합계는 native 115개이며, 소스 49개·화면 28개와 구분한다. 고정 입력의 소유 Rust 파일 9개가 현재 작업 파일과 모두 SHA-256 일치한다. producer의 최종 입력 재검사·관리 종료는 별도로 확인한다.
- 추가로 현재 `question-withdrawal-ui-source` 묶음의 계획 조회를 요청했으나 응답이 장시간 완료되지 않아 읽기 전용 계획 요청을 취소했다. 실행을 요청하지 않았으며 검사 통과로 계산하지 않는다. 해당 묶음의 namespace-cache-owner 추가 검사는 이 후속 실행에서 완료하지 못했다. 등록 재시도도 `exclusive maintenance lock unavailable (abandoned locks require explicit recovery)`로 거부되었다.
- 최종 completion `f22b2479-4bcc-46e0-8781-4d8129562c4d`는 failed/exit 1이다. 실제 자식 검사들은 모두 exit 0이며, 마지막 입력 재해시 뒤 lifecycle `catalog.lock` 대기 5분 초과로 외부 실행만 실패했다. 네이티브 세션 96009의 실제 exit 1과 `reports/producer.json`의 producerStopped=true 및 모든 tracked children closed를 확인했다. 성공으로 변경하지 않는다.
- 후속 소스 수정은 완료됐으나 자료 등록·검토/보존 처리와 namespace-cache-owner 추가 검사가 미완료여서 작업 커밋은 보류한다. 기존/이번 실행의 입력·로그·화면·보고서를 진단 및 재검토 근거로 보존한다. 재개 조건은 관리 잠금의 소유 작업이 정상 종료하거나 공식 복구되어 supported lifecycle close/등록/검토가 가능해지는 것이다. 이후 캐시 소스 검사를 마치고 이 작업 파일/부분만 커밋한다. 배포·설치·운영 세션 데이터 수정은 수행하지 않았다.
- `reply-source-3`의 소스 검사 49개는 실제 자식 exit 0이다. 외부 producer 종료는 catalog 잠금 충돌로 exit 1이므로 전체 성공으로 보고하지 않는다. 네이티브 React/CSS 렌더 검사 28개는 exit 0이며 light/dark 화면을 확인했다.
- `docs/architecture/ui-presentation.md`의 별도 DL-01 배지 변경과 기능 인벤토리의 타 작업 변경은 이 작업 커밋에서 제외한다. 생성 스키마/SDK는 동시 작업의 TPS 필드를 보존하고 답변 종류만 추가한 것을 확인했다.
- 관리 도구의 등록/검토 및 lifecycle 종료를 다시 시도했으나 `catalog.lock`은 계속 점유 중이다. 잠금을 삭제하거나 레지스트리를 직접 수정하지 않는다. 실제 종료 근거와 실패 결과를 보존하고 공식 마감이 가능해질 때 재검토한다.

### 추가 관찰: 질문 답변 자체의 큐 전송 차단 검토

후속 구현 승인됨: 전용 `questionReply` 큐 종류로 답변 출처를 보존하고, 기존 일반 큐 문자열을 태그만으로 승격하지 않는다. 질문 보류 중에는 가장 앞선 답변 항목을 먼저 처리하되 일반 큐의 상대 순서는 유지한다. 질문 답변은 기존 대상 검증·수락 경로를 사용하고 다른 질문을 철회하지 않는다. 중단·승인·계정·복구 보류는 유지한다. 출처가 없는 구버전 일반 큐 항목은 답변 UI에서 명시적으로 다시 제출해야 하며 무조건 신뢰하지 않는다. 공통 플랫폼 의미이며 Windows에서 우선 회귀 검증한다. UI 주입/VM 검증은 `/root/queued_reply_ui`, 엔진·프로토콜·통합·문서·최종 수락은 root 소유다. 기존 진행 변경과 관리 잠금을 보존한다.

사용자가 제공한 구버전 화면에는 질문 답변 태그가 대기열에 있으며, 미답변 질문 표시와 중단에 따른 대기열 일시 정지가 함께 나타난다. 최초 검토에서는 코드 경로를 확인했고, 이후 사용자 승인에 따라 아래 후속 구현을 진행한다.

- 결론: 이번 자동 철회 수정만으로는 이미 큐에 들어간 질문 답변의 전송 차단이 해결되지 않는다. UI `scripts/inject-question-queue.cjs`의 자동 resume은 pendingQuestionCount가 양수면 큐 항목 내용과 관계없이 반환한다. Core `turn_input.rs`도 `StartIfIdle` 자동 큐 제출을 질문 보류 조건에서 반환시킨다. 자동 철회와 답변 반영은 그 뒤 accepted-input 경계에서 실행되므로 진입할 수 없다.
- 별도 위험: `ext/queue/src/service.rs::submit_queued_input`은 원래 답변 turnTrigger를 `queue`/`queue_user`로 바꾼다. `history/src/heartbeat.rs::from_turn_trigger`는 둘을 Queue origin으로 분류한다. Core는 Queue 입력의 질문 답변 검증·수락을 생략하고, 이번 `questions_superseded_by_input`도 Queue 입력은 답변처럼 생겼더라도 일반 요청으로 취급한다. 따라서 명시적으로 전송하면 대상 질문에 답변을 기록하는 대신 다른 미답변 질문까지 철회할 수 있다. 기존 보안 경계는 일반 큐 텍스트가 구조화된 답변 태그를 위조하지 못하도록 유지해야 한다.
- 정상 직접 전송 경로: 고정 upstream UI `app-initial-c014f9ee4429.js` 질문 제출은 `send_user_message_async_question` trigger와 `queueModeOverride:send-now`를 전달한다. 따라서 화면의 답변이 어떤 이유로 큐에 들어갔는지는 사진만으로 확정할 수 없다. 해당 구버전 세션의 로그·정확한 버전과 큐 저장값 없이는 강제 큐 모드/복구/별도 경로 여부를 단정하지 않는다.
- 화면의 중단 상태는 별도 보류 사유다. 질문 답변 대기만 해소해도 자동 재개가 보장되지는 않는다. 기존 사용자 중단과 승인·계정 보류는 답변 처리를 수정하더라도 보존해야 한다.
- 권장 후속 수정: 신뢰 가능한 구조화된 질문 답변 제출 경로를 큐 저장·복구·실제 수락까지 유지하고, 답변 처리는 질문 대기 조건 때문에 막히지 않게 한다. 일부 질문에 답변하면 나머지 질문 보류를 유지한다. 기존 일반 텍스트 큐를 태그 문자열만으로 신뢰하는 우회는 사용하지 않는다. 중단 상태에서 답변 수락과 작업 재개를 어떻게 분리할지도 현재 중단 계약에 맞춰 검토한다.
- 검증 공백: 앞선 112개 native 성공은 직접 답변과 일반 요청/일반 큐의 계약을 확인했지만, 질문 답변 자체가 대기열에 저장된 경우의 전송 보장 근거가 아니다. 후속 회귀 검사는 실행 중/유휴/중단, 일부·전체 답변, 구버전 저장 큐, 재시작, 철회된 대상·위조 태그 입력을 구분해야 한다. 이번 검토는 코드 경로 정적 확인이며 구버전 실제 세션 재현 또는 신규 실행 검증은 수행하지 않았다.

### 답변 큐 후속 구현과 검증 상태

- API `QueuedSubmissionKind::QuestionReply`, 저장 `QueuedInput::QuestionReply`를 추가한다. enqueue/edit에서 구조를 검사하고 Core의 `queue_question_reply` 수락 경계에서 실제 대상 ID를 재검증한다. User origin을 유지하여 기존 답변 수락·복원 메타데이터 경로를 재사용하고 질문 자동 철회 대상에서 제외한다.
- 네이티브와 UI dispatcher는 질문 보류 중 가장 이른 typed reply를 선택한다. UI는 답변 UI의 원래 trigger에서만 이 종류를 생성하고, 복원 시 trigger를 되살린다. 일반 큐의 답변 태그는 일반 메시지로 남는다. 전용 답변 편집도 종류와 client ID를 유지한다. 승인·중단·계정 보류 로직은 유지한다.
- Core에 typed reply 수락 후 다른 질문 보존과 잘못된/알 수 없는/철회된 대상 거부 테스트를 추가했다. 기존 큐 통합 테스트는 일반 항목 뒤에 저장된 typed reply가 먼저 실행되는지 확인하도록 바꾸고, 저장 재조회·서비스 재생성·편집·일반 태그 비승격 회귀를 추가했다.
- `reply-source-1`과 `reply-source-2`는 각각 source 49개 중 48개 통과/1개 실패, 실제 exit 1이다. 새 VM enqueue fixture에서 빠진 `Cv`, `xsn` 실행 환경을 보완 중이며 해당 실패를 제품 동작 통과로 계산하지 않는다. UI 소유자가 좁은 실제 검사를 수행한 후 전체 관련 source 검사를 다시 실행한다.
- `reply-native-prep-1`: 독립 Git 메타데이터에 현재 engine 입력을 캡처한 뒤 protocol stable/experimental exports를 별도 outputs에 생성한다. 준비 결과를 검토한 뒤 SDK를 재생성하고 생성된 입력까지 고정하여 실제 native/SDK 검사를 수행한다. 실행 세션 53195, completion `9038139b-e071-4a35-82c4-bcf00c1e89d0`. 이 준비는 제품 빌드 또는 테스트 통과 근거가 아니다.
- VM fixture의 누락 함수 보완 후 `reply-ui-debug-1` 좁은 검사 1개와 `reply-source-3` 관련 source 49개가 실제 exit 0으로 통과했다. `reply-source-3` outer producer는 catalog.lock 충돌 때문에 exit 1로 마감됐으므로 source 테스트 성공과 관리 마감 실패를 구분한다. 로그 `reply-source-3/logs/source.log`, 명령/child 종료 결과 `reports/summary.json`, producer 증거 `reports/producer.json`을 보존한다.
- 다른 작업의 staged protocol 변경에 이 작업의 `QuestionReply` 한 줄이 포함된 것을 확인하여 그 한 hunk만 index에서 제외했다. 작업 트리와 다른 작업의 stage는 보존했다. 다른 작업이 전체 파일을 먼저 커밋하지 않도록 최종 커밋에서도 실제 staged/HEAD를 다시 확인한다.
- 전체 작업 트리에서 생성한 `reply-native-prep-1`은 다른 작업의 응답 속도 통계 변경까지 스키마에 포함했다. 이 생성물은 root에 적용하지 않았다. 최종 검증은 `HEAD:engine`에 이번 작업 소유 소스 9개와 protocol의 QuestionReply 한 줄만 적용한 별도 저장소를 사용한다. 선택 파일/해시는 run의 `reports/selection.json`에 기록한다. 다른 작업의 stage와 제품 소스는 그대로 둔다.
- 최초 격리 실행은 lifecycle 잠금으로 시작하지 못했다(completion `bbbda035-84f3-4dab-b1fc-17d44ba63ea4`, exit 1, Cargo 미실행). 다음 `reply-native-1`은 Windows 긴 snapshot 경로의 `git checkout-index` 파일명 제한으로 준비 exit 1이었다. `reply-native-2`에서는 해당 checkout 명령에만 `core.longpaths=true`를 적용하여 checkout exit 0을 확인했다. 전역 Git 설정은 바꾸지 않았다. 현재 세션 96009, completion `f22b2479-4bcc-46e0-8781-4d8129562c4d`로 실제 schema/SDK/native 종료를 기다린다.
- 기존 native React/CSS light/dark fixture `node scripts/verify-question-withdrawal-render.mjs`를 독립 실행 중이다(세션 65737). 설치된 전체 앱의 수락 근거와 구분하고, 실제 결과와 생성물 경로를 확인한 뒤 보존/정리를 판단한다.
- 위 렌더링 실행은 28개 검사 통과, exit 0으로 완료됐다. 실제 light/dark 스크린샷을 확인했다. 질문 원래 인덱스, 철회 표시·키보드 동작, 다른 승인 표시, 일반 큐의 대기 문구·테마가 포함된다. typed reply 전달/선택은 source VM 검증 범위이며 이 화면 fixture를 전체 설치 앱의 답변 전송 검증으로 확대하지 않는다. 생성물은 `artifacts/tasks/verify-question-withdrawal-render/runs/20261022T185807581Z-c278d560-3203-4bfa-90d2-e0fdc15386a3`이다.
- `reply-native-2` stable/experimental 생성과 SDK 재생성은 각각 exit 0이다. 최종 격리 입력 SHA-256 `a6e770f870fc51e26e11434a1f6970fab1d406b6700d67efe21bcb583ed65aa5`, 9,309파일. 실제 기능 검사 첫 진입은 다른 BO-02 작업의 Cargo 캐시 lease 충돌로 실행되지 않았으며, 같은 producer가 해제 이벤트를 기다려 재진입한다. 다른 캐시 소유자를 중단하지 않는다.
- 생성물 통합은 기존 작업 트리와의 전체 embedded export 내용을 비교해 `questionReply` enum 값만 차이나는 것을 확인한 뒤 스키마 6개를 적용했다. SDK는 실제 생성된 QueuedSubmissionKind 블록만 반영했다. 다른 작업의 응답 속도 통계 필드·스테이징은 보존했다. 격리 입력의 생성물도 HEAD 대비 의미 차이는 동일한 enum 변경뿐임을 확인했다. 전체 schema 비교에서 파일별 Git 프로세스를 실행하던 비효율적인 읽기 전용 비교는 정확한 소유 PID/생성 시각을 확인해 중단하고, 제한된 파일의 Git batch 조회로 대체했다. 네이티브 producer는 유지했다.
- `reply-native-2`의 async 묶음 타입 검사는 19:26:29–19:34:23 UTC에 실제 exit 0으로 통과했다. Core·protocol·app-server-protocol·app-server의 테스트 타입을 검사했으며 실행 파일 선택·준비 단계와 구분한다. 직전 5번 진입 충돌은 Cargo 미실행 guard 결과로 보존한다. 다른 작업의 staged protocol/schema/SDK에는 이번 reply kind가 들어 있지 않음을 확인했다.
- 같은 격리 입력의 async 실제 실행은 19:49:28 UTC에 Cargo exit 0으로 끝나 18개가 통과했다. 새 typed reply의 질문 보류 통과·남은 질문 보존, 일반/알 수 없는/철회된 입력 거부 2개 회귀를 포함한다. accepted/compact/turn/queue/questions/schema/SDK 실제 결과는 아직 대기한다. source-3의 알려진 producer 실패를 supported closeLifecycle로 마감하려던 시도는 다시 catalog.lock으로 거부됐으며 실패를 성공으로 변경하지 않았다.

- `native-6`은 accepted-input 타입 검사에서 `TryShutdownForHandoff` 선언 누락 오류로 exit 101이었다. 실제 동결 소스에는 해당 선언이 있다. `native-7` 준비에서 해당 소스의 내용 해시가 같음을 확인하면서 수정 시각만 갱신하여 Cargo 재검사를 유도하자 같은 소스의 타입 검사가 통과했다. 공유 캐시 의존성 갱신 불일치 가능성이 있으며 질문 코드의 실패로 단정하지 않는다.
- `native-7`: accepted-input 11개, compact-input 5개, turn-input 21개 실제 통과, 각 Cargo exit 0. 큐 검사 24개 통과/2개 실패는 Python 실행기를 PATH에서 찾지 못한 환경 오류였다. 제품 소스를 수정하지 않고 기존 SDK venv Scripts를 자식 PATH에 연결한 `native-8`에서는 큐 26개 전체가 exit 0으로 통과했다.
- `native-8` 질문 통합 검사는 28개 통과/1개 실패였다. 새 요청이 생성한 이전 질문 철회 이벤트를 기존 테스트가 새 질문으로 오인했다. `core/tests/suite/request_user_input_async.rs`에서 철회를 먼저 검증한 뒤 새 질문의 고유 ID를 검증하도록 수정했다.
- `native-9`은 native-3 동결 입력을 독립 Git 메타데이터로 복사하고 준비 단계에서 위 테스트 한 파일만 수정했다. 기존 입력은 보존했다. 최종 동결 입력은 9,309파일, SHA-256 `ba9fbe28bb76e35429d2ec8139aac203dbc271cea35aca2a295f14ac888e6ef6`이다. 질문 통합 29개와 스키마 4개가 각각 Cargo exit 0으로 통과했다. 스키마 재생성용 기존 검사 1개는 ignored이다.
- Windows x64 네이티브 검증은 총 112개 통과했다: async-question 16개(native-5 성공 명령), 입력 관련 37개(native-7), 큐 26개(native-8), 질문 통합 29개와 스키마 4개(native-9). 소스 검사 44개와 SDK 4개도 exit 0이다. 최종 관련 소스 7개와 작업 트리의 바이트 일치, 관련 diff whitespace 검사 exit 0, staged 변경 없음도 확인했다. Linux/macOS 실행과 제품 빌드·설치는 수행하지 않았다.
- 결과 명령·실제 종료 코드·로그 경로는 각 run의 `reports/summary.json`과 `logs/`에 있다. native-9은 15:39 UTC 이후 입력 준비를 시작해 질문 검사를 15:59:30 UTC, 스키마 검사를 16:11:54 UTC에 끝냈다. 긴 대기는 공유 Cargo 캐시 소유권과 검사 실행 파일 준비 때문이었다. 실패 결과를 통과로 바꾸지 않고, 환경 보완과 테스트 이벤트 검증 수정 후 영향 범위만 재실행했다.
- native-9의 테스트는 둘 다 exit 0이지만 producer 마감은 `artifacts/maintenance/lifecycles/catalog.lock` 충돌로 실패하여 outer exit 1이었다. 실행 세션 98951의 실제 종료와 tracked child 전부 close가 기록됐다. `reports/producer.json`은 실패/producerStopped=true를 보존한다. completion `098b7a96-3f1b-4d78-a44d-b13ed0d7f271`도 실제 outer 결과에 맞춰 failed/exit 1로 마감했다.
- 관리 등록을 재시도했으나 `exclusive maintenance lock unavailable (abandoned locks require explicit recovery)`로 다시 거부됐다. 관리 잠금은 살아 있는 앱 서버 PID 61016을 가리키지만, 이것만으로 관리 작업 종료나 잠금 회수 가능 여부를 단정할 수 없다. 잠금 삭제·수동 레지스트리 편집은 하지 않았다.
- 보존 결정: source-1/sdk-1/native-3~9는 테스트 결과·실패 진단·재실행 입력·복구 증거로 필요하므로 보존한다. native-2는 불완전 producer 증거로 보호 상태를 유지한다. native-1 삭제는 이미 확인했다. 잠금이 정식 해제/복구되면 supported lifecycle close/등록/검토/보류 절차를 완료하고, 독립 검증 증거를 보존한 뒤 임시 입력 필요성을 다시 판단한다.
- 정리 절차가 끝나지 않아 작업 커밋은 생성하지 않았다. 후속 작업은 관리 잠금 해결 후 자료 마감·정리 결정을 반영하고 이 작업 변경만 커밋하는 것이다. `codex_thread.rs`의 다른 작업 handoff 메서드와 기능 인벤토리의 다른 작업 hunk는 제외해야 한다. 운영 세션 DB는 수정하지 않았다.

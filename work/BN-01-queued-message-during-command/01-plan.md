# 명령 실행 중 큐 메시지 전송 수정

상태: 소스 수정·필수 범위 검증·정리 완료. Windows core 4개, native 큐 통합 2개, UI 큐 39개가 통과했다. 설치본은 변경하지 않았다. 이번 수정만 분리해 작업 커밋한다.

## 목표·권한·범위

사용자는 명령 실행 중 일반 Enter와 명시적 큐 입력이 간헐적으로 전송되는 현상의 원인 분석·재현·해결 방안을 요청했다. 이후 “문제 해결해주세요”로 소스 수정을 승인했다. 전체 제품 빌드·설치·설정 변경·실계정 추론은 승인 범위에 포함하지 않는다. build playbook은 일반 fix를 full-build 지시로 해석하지 않도록 명시한다.

큐 의미는 Windows x64, Linux x64, macOS ARM64 공통이다. 실제 실행 검증은 Windows에 한정한다. 기존 staged/unstaged 변경을 보존한다. root가 엔진·공유 계약·통합을 소유하고 queue_intent 담당자는 scripts/inject-queue-consumption.cjs와 scripts/test-queue-consumption.cjs만 소유한다. 별도 worktree를 사용하지 않았다.

## 신고 사례에서 확인한 원인

스크린샷의 정확한 최종 답변과 후속 메시지를 native rollout 대화 01a13e9d-e257-7942-9ec3-86aa0ce1d423에서 확인했다. 내용 전체 대신 [사건 시각](../../artifacts/logs/BN-01-queue/incident-timeline.json)을 보관했다.

2026-10-15 KST 17:30:28.890 commentary 뒤 도구가 계속 실행됐다. 마지막 도구 출력은 17:30:55.741 Script completed였다. 17:31:02.793 final_answer, 17:31:02.963 task_complete, 17:31:03.589 다음 task_started(turn_trigger=queue)가 기록됐다. 도구 출력 8개는 모두 완료 상태였고 반환되지 않은 tool call이나 Script running/session_id는 없었다. 외부 프로세스 전체의 종료까지 증명하는 것은 아니다.

사용자 작업이 차단돼 조치가 필요했지만 모델이 final로 턴을 끝냈고 native 큐가 일반 완료로 처리했다. UI가 모든 중간 응답을 종료로 판정한 증거는 없다. 기존 on_thread_idle는 Interrupted를 제외하고 큐 dispatch를 시도한다. 모든 간헐 사례가 동일 원인인지까지 확인하지 않았다.

별도 재현에서는 locally accepted message의 submissionIntent=queue가 저장돼도 queueModeOverride가 비어 있어 저장 중 global queue mode가 steer로 변경되면 replay가 즉시 전송했다. 설정 변경 없는 신고 사례와 직접 연결된 증거는 없다.

## 재현·입력 식별

실행 엔진은 artifacts/w14w/artifacts/releases/w14y/engine/codex.exe, build-info 소스는 artifacts/engine-input-AF01이다. 이번 소스 변경은 engine/에 적용했다. 설치 UI의 app-initial-97d3534ad35f.js에서 실제 ljn/ajn 함수를 추출해 pinned fixture로 실행했다. renderer가 로드한 바이트 동일성은 별도 검증하지 않았다. desktop.followUpQueueMode=steer였지만 그것만으로 신고 사례를 설명하는 초기 가설은 실제 로그로 배제했다.

증거는 artifacts/logs/BN-01-queue/에 있다.

- native-queue-final.mjs와 queue-final-evidence/summary.json, RPC: 도구 응답 보류 중 큐 유지, final 뒤 큐 1회 처리. exit 0, 엔진 exit 0.
- native-probe.mjs/native-evidence: 도구 대기 중 명시적 steer 수락. exit 0.
- reproduce.cjs/repro-results.json: pending+steer는 전송, pending+queue와 일반 큐는 유지. exit 0.
- reproduce-intent.cjs/intent-results.json: 저장 중 설정 변경 경쟁 조건. exit 0.

합성 홈·DB는 정상 종료 뒤 증거를 보존하고 ordinary deletion으로 제거했다. artifacts/verification/BN-01-queue-native 및 BN-01-queue-final 부재를 확인했다. 실제 GUI/OS 명령 및 실계정 모델 준수 검증과 구분한다.

## 채택한 수정

Azrael root만 호출 가능한 pause_queued_inputs(reason=waiting_for_user|blocked)를 추가했다. 사용자 답변·외부 조치 필요 또는 작업 차단으로 final을 보내기 전에 호출하도록 도구 설명에 지시한다. 기존 durable manual-resume guard를 사용해 큐와 예약 재개를 정지한다. 도구 자체는 턴이나 실행 중 도구를 종료하지 않는다. 문구 추측이나 모든 tool error에 의한 자동 정지를 도입하지 않았다.

native 큐는 기존 guard를 재사용한다. 자동 local replay는 실제 request.turnTrigger=queue로 표시하고 core에서 guard 우회를 거부한다. acceptance receipt 재조정은 거부보다 먼저 실행한다. 새 direct user turn이 수락되거나 idle에서 명시적 queue.start/resume되면 기존 경로가 guard를 해제한다. 현재 턴 steering은 선택 입력을 전달하되 자동 큐 pause는 유지할 수 있다.

저장 시 queue/send-now 의도를 고정하고 legacy submissionIntent도 replay에 반영한다. idle direct start와 explicit send-now 의미를 유지한다. 자동 provenance는 확인한 coordinator 호출 범위의 when-idle 및 세 번째 인자 true를 조건으로 한다. 해당 인자는 기존 resume에도 사용되므로 독립된 전역 자동 여부 계약으로 주장하지 않는다.

소유 문서 docs/architecture/queued-compaction.md와 docs/ops/development.md, 기능 목록 engine.queued-input-pause에 연결했다. 필수 native 명령은 scripts/check-queued-input-pause.cjs이며 core 필터와 queue service 두 필터를 순차 실행한다.

## 검증·재실행·정리

- queue source 최종 r3: 38/38 exit 0 (intent-tests-r3.log). 공간 부족으로 손상된 파일 복구 뒤 lifecycle 추가 검사까지 39/39 exit 0으로 확인했다(intent-tests-r4.log). 큐 결과 resolve 직후 같은 동기 finally 구간에서 accepted handle이 삭제되며, final 뒤 replay는 request.turnTrigger=queue를 전달함을 확인했다.
- account/queued-input/compaction/send-result: 52/52 exit 0 (integration-fix-tests.log). 통합 transform anchor 충돌을 고쳐 통과했다.
- 최종 RPC 필드 수정 뒤 combined production transforms: 3/3 exit 0 (integration-provenance-r3.log).
- cargo wrapper: 36/36 exit 0 (wrapper-tests-r2.log).
- scoped CRLF-aware diff check exit 0. 기존 파일 줄바꿈을 보존했다.
- registry 구조와 새 feature 연결은 validateManifest 통과 (registry-validation.log). 추가 real preservation registry 검사는 기존 ui.parent-request-activity의 namespace-cache-owner.cjs 누락으로 실패했다. 기존 index에도 동일 누락을 확인했고 관련 없는 변경은 하지 않았다.
- native 첫 실행은 08:41:46 UTC 시작, codex-core archive 작성 중 os error 112 공간 부족, exit 101 (native-fix-tests.log). 해당 실행이 만든 미완성 object와 incremental 약 1.1GB만 제거하고 부재 확인했다(failed-cache-cleanup.json).
- codex-core test debug=0/incremental=false로 출력 크기만 줄여 재실행했다. 새 테스트의 InvalidRequest 오류 비교 문법을 고친 뒤 r2에서 core 4개가 통과했다 (native-compact-tests-r2.log, 09:05:39 UTC 이전 완료). 모델 실제 준수는 검증하지 않았다.
- 후속 queue service 준비 컴파일에서 codex-config가 rustc-LLVM no space on device로 실패했다. 셸 로그 출력도 공간 부족으로 실패해 전체 producer 최종 cargo exit은 수집되지 않았다. producer/cargo/rustc 종료를 확인했다. 통합 검사 통과로 보고하지 않는다.
- 공간 부족 중 문서·테스트 기록 갱신도 truncate됐음을 발견했다. 작업 문서는 확인된 증거에서 복구하고 담당자가 테스트를 복구한다. 이후 편집은 임시파일에 완전히 기록 후 교체한다.
- 완료한 core 테스트의 이번 실행 신규 codex_core-aa80861f13ab5131.pdb(687,632,384 bytes)만 경로와 09:05 UTC 생성 시각을 확인해 ordinary deletion, 부재 확인했다. 기존 PDB·공유 캐시는 보존했다.

이번 실행 이후 생성된 inactive incremental 125개(6,972,642,809 bytes)만 절대 경로·생성 시각·컴파일러 부재를 확인해 제거했다(owned-incremental-cleanup.json). 기존 incremental과 완성 라이브러리는 보존했다. 7.6GB 확보 후 core 4개 결과를 재사용하고 native 큐 두 필터만 순차 재실행해 각각 1개 통과, producer exit 0으로 완료했다(native-queue-only-tests.log). 실제 pause tool 호출 → final → idle 재알림에도 queue 유지 → explicit queue.start 뒤 1회 처리까지 확인했다. 최종 producer와 compiler 종료도 확인했다. 소스는 native 실행 중 변경하지 않았다. 완성 라이브러리와 기본 engine/codex-rs/target 공유 캐시는 재사용하므로 유지한다. 별도 target/worktree/합성 홈은 남기지 않았다. 전체 제품 빌드·설치, 실행 중 앱 적용, live 모델의 pause 도구 준수와 다른 OS 검증은 수행하지 않았다.

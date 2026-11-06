# 빌드 종료 신호 누락 원인 분석

상태: 분석 완료. 코드 수정·빌드·재실행·과거 결과 변경은 하지 않았다.

## 대상과 결론

- 세션: `azrael://threads/01a17f46-9f25-7143-9a28-4440297d5eeb`
- 작업: `5c9f7442-9bbf-4438-ba9b-d3b8f7f12a2a` (EB-01 deployment M)
- 실행 세션 ID: `31775` (OS PID가 아니라 unified exec의 process_id)
- 플랫폼: Windows. 다른 OS에서 같은 종료 경로를 실행해 검증하지 않았다.

이 사건은 Cargo 실행 전 준비 실패가 아니다. release 빌드가 진행되던 중 메시지 수정에 수반되는 기존 runtime 종료와 명령 실패가 기록됐지만, 프로세스 내부 콜백에만 의존한 완료 신호가 남지 않았다. 실행기에는 failed/exit 1이 있고 완료 저장소에는 running이 남은 두 관측 경로의 불일치다. exit 1은 실행기 명령의 결과이며 Cargo 자체 exit를 입증하지 않는다.

## 관측 시간표 (2026-10-28 KST)

| 시각 | 확인한 기록 |
| --- | --- |
| 12:54:40경 | 외부 작업 등록. 신호 래퍼를 unified exec로 시작 |
| 13:47:21 | 이 work ID의 완료 신호를 기다리도록 defer_root 등록 |
| 13:48:30.036 | 기존 턴 `turn_aborted`, reason `interrupted` |
| 13:48:40.322 | process_id `31775`의 CommandExecution 완료: failed, exit 1, 약 3,234.907초 실행, 출력 없음 |
| 13:48:41.475 | 같은 thread ID의 새 rollout 생성 |
| 13:48:45.520 | 새 턴의 trigger가 `edit_user_message` |
| 13:48:54 | work_completion 조회는 계속 running, exitCode null |
| 14:00경 | 이전 세션이 Cargo 프로세스와 기존 실행 세션을 조회하지 못함 |

원본 rollout은 `C:/Users/felre/.azrael-ex/sessions/2026/10/28/rollout-2026-10-28T06-31-37-01a17f46-9f25-7143-9a28-4440297d5eeb.jsonl`이다. 현재 파일의 3831행은 turn_aborted, 3832행은 명령 종료 기록이다. 후속 파일 `rollout-2026-10-28T13-48-40-01a17f46-9f25-7143-9a28-4440297d5eeb_01a180d6-c1d5-72c2-9602-40b68fd841f0.jsonl`의 5행은 edit_user_message를 기록한다. 도중에 수정한 메시지 때문에 보이는 이력 경계와 원본 실행 종료 기록의 위치가 달라졌다.

## 원인과 코드 근거

### 1. 메시지 수정은 기존 runtime을 종료한다

현재 코드의 `thread_revert_response`는 `wait_for_thread_shutdown`을 기다린 다음 thread를 제거하고 `reload_paginated_thread`로 다시 연다.

- `engine/codex-rs/app-server/src/request_processors/thread_processor.rs:2444`, `:2494`, `:2553`
- `engine/codex-rs/core/src/session/handlers.rs:318`: runtime shutdown이 `unified_exec_manager.terminate_all_processes()`를 호출한다.
- `engine/codex-rs/core/src/unified_exec/process_manager.rs:1835`: 등록된 실행을 drain한 뒤 각 프로세스를 terminate한다.
- `engine/codex-rs/core/src/unified_exec/process.rs:266`: local terminate를 호출한다. 별도 interrupt 경로와 구분된다.
- `engine/codex-rs/utils/pty/src/win/job.rs:245`: Windows Job terminate는 `TerminateJobObject(..., 1)`을 사용한다.

이는 Node에 정상적인 자식 종료 콜백 실행 시간을 보장하는 흐름이 아니다. Windows 강제 종료는 JavaScript의 signal handler, finally 또는 close 콜백 실행을 보장하지 않는다.

### 2. 완료 신호 작성자가 종료 대상 트리 안에 있다

`work/EB-01-latest-windows-profile-install/signal-producer.cjs:4`는 deployment Node를 spawn하고, `:6`의 `child.on('close', ...)`에서만 `.signal.json.tmp` 작성과 rename을 한다. 이 래퍼도 원래 unified exec 명령의 자식이므로 전체 트리 종료 시 관측자와 실제 producer가 함께 사라질 수 있다. 별도 runtime의 감독자나 실행기 terminal 결과 연계가 없다. 단순히 SIGINT/SIGTERM handler를 추가해도 Windows 강제 종료 전체를 해결하지 못한다.

`deploy-retry.cjs`는 `spawnSync`가 돌아온 후에만 command 결과를 저장하고 finally에서 `finishArtifactRun`을 호출한다. 현재 deploy-m의 commands.json에는 초기 probe 세 개만 있고 deployment의 종료 항목이 없다. producer lifecycle은 pending/revision 1/producer null로 남아 있다. 이 증거도 내부 finally가 종료 정리를 끝내지 못한 상황과 일치한다.

### 3. work_completion은 실행기 종료를 자동 대조하지 않는다

`engine/codex-rs/core/src/session/work_completion.rs:153`의 read는 signal 파일을 읽어 상태를 갱신하며 파일이 없으면 기존 Running을 반환한다. unified exec의 실패 기록이나 process_id와 연결해 자동 완료시키지 않는다.

조사 시 work metadata는 여전히 running이고 해당 `.signal.json`과 `.signal.json.tmp`는 모두 없었다. 따라서 이 사건은 임시 파일 작성 후 rename 실패로 보이지 않는다. work 등록과 defer는 producer를 기존 세션에서 독립시키는 기능이 아니다.

## 확정 범위와 한계

- 확정: 기존 턴 중단, 명령 failed/exit 1, 메시지 수정에 따른 새 rollout, 신호 파일 부재, work의 running 잔존, deployment terminal 항목과 lifecycle close 부재.
- 코드와 시각이 가리키는 가장 강한 원인: 메시지 수정에 따른 runtime shutdown이 신호 래퍼까지 종료했고 내부 신호 작성 콜백이 실행되지 못했다.
- 미확인: 당시 Windows kill 호출의 직접 stack/ETW trace, 모든 자식의 개별 exit와 종료 시각. 현재 소스의 호출 경로와 실제 기록의 일치는 확인했지만 당시 바이너리의 정확한 kill stack까지 관측한 것은 아니다. Cargo가 컴파일 오류로 먼저 실패했다거나 전체 자식이 그 시점에 종료됐다고 단정하지 않는다.
- 신호 누락 후 running 파일을 보고 계속 컴파일 중이라고 답한 것도 별도 판단 오류다. running은 terminal 신호를 받지 못했다는 뜻이며 생존 증거가 아니다.

## 권장 개선 범위 (미구현)

1. work ID와 unified exec 실행 ID를 호스트가 묶고, shutdown·실행 terminal을 producer 바깥에서 영속 기록한다. 강제 종료된 producer 자신의 콜백을 유일한 기록자로 두지 않는다.
2. 메시지 수정/revert 시 장기 실행을 중단할지 지속할지 정책을 명시한다. 중단이면 먼저 취소를 요청하고 제한된 시간 후 강제 종료하되, 관측한 종료와 미확인 자식 상태를 별도로 남긴다. 지속이면 기존 runtime과 독립된 감독·소유·재연결 구조가 필요하다.
3. 실패·취소·관측 불명은 성공으로 바꾸지 않는다. terminal 기록 유실과 process-tree 종료 미확인도 구분한다.
4. Windows 실제 회귀검증: 장기 실행 도중 메시지 수정, runtime shutdown, wrapper 강제 종료, 자식 생존·종료 확인, 신호 파일 유실을 재현해 호스트 terminal 기록과 lifecycle/완료 저장소의 수렴을 검증한다.

이번 분석은 이전에 완료한 준비 단계 실패 처리와 unknown 복구 API의 범위를 확대해 완료했다고 주장하지 않는다. 구현은 별도 승인 후 진행할 사항이다.

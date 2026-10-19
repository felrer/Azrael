상태: 승인된 호출 분류 수정·회귀 검증 실행 중. 전체 앱 빌드·패키징·설치는 별도 명시 지시 범위로 유지한다.

목표는 최근 7일(2026-10-13~19 KST) 로컬 세션에서 자식이 부모 즉시 요청 기능을 실제 사용하는지 확인하는 것이다. 허용 범위는 기존 세션·DB·설치 정보의 읽기와 조사 기록 작성이다. 세션 호출·메시지 발송·중단·제품 수정·빌드·설치는 수행하지 않는다.

공통 엔진 기능의 사용 현황을 조사하되 관측 환경은 Windows 로컬 .azrael-ex 프로필이며, 다른 프로필·원격·다른 OS의 사용을 일반화하지 않는다. development-workflow와 기존 root-resume/native-diagnostics 계약을 적용한다. 이전 구현 기록 01-plan 및 별도 과거 세션 분석 02-plan을 보존한다.

방법: SQLite readOnly 조회로 parent_requests/parent_response_waits와 최근 thread metadata를 확인하고, 기간별 rollout에서 실제 function/custom tool call과 반환을 추출한다. 문서·지침·코드 인용 속 도구명은 호출 수에 포함하지 않는다. 최종 보고에는 대상 수, 도구별 호출·성공·응답 상태, 관측된 사례와 사용하지 않은 경우의 범위 및 원인을 제시한다. 충분한 근거가 없으면 기능 미노출·모델 선택을 단정하지 않는다.

조사 출력 소유권: 본 작업이 같은 폴더의 recent-usage-scan.cjs와 artifacts/logs/parent-request-usage-20261019/usage.json을 소유한다. 스캔은 원본을 수정하지 않으며 추출 기준·집계와 제한된 사례를 보존한다. 완료 후 최종 근거와 범위는 이 계획에 기록한다. 임시 계획 본문은 번호 할당 후 일반 삭제한다. 제품 테스트와 빌드는 필요하지 않다.

## 관측 결과

2026-10-19 19:02:57 KST 고정 상한으로 10/13~19 일자 폴더의 JSONL 827개(약4.33GB)를 읽었다. 실제 response_item의 function/custom tool call만 추출하고 thread+call_id로 중복 제거했다. fork의 첫 session_meta가 자식 identity이며 이후 상속된 부모 session_meta로 덮어쓰지 않는다. compacted replacement_history나 지침/코드에 포함된 도구명은 호출로 세지 않는다. 조회 중 살아 있는 로그는 후속 변경될 수 있으며 상한 이후 이벤트는 제외한다. 7일 폴더 기반 스캔이므로 오래전에 생성돼 이전 폴더에서 계속 진행한 모든 세션의 전수조사는 아니다.

| 항목 | 결과 |
| --- | --- |
| request_parent를 사용한 자식 세션 | 105 |
| 자식 request_parent 실제 호출 | 352 |
| 정상 접수 | 0 |
| 같은 평문 호출 guard 오류 | 352 |
| await_parent_response / respond_to_request 호출 | 0 / 0 |
| state_5.sqlite parent_requests / parent_response_waits | 0 / 0 |

일자별 request_parent는 10/16 32회,10/17 158회,10/18 100회,10/19 62회다. 관측 최초10/16 22:15:04 KST, 마지막10/19 16:01:04 KST. 전체 스캔에서 일반 메시지·후속지시·대기 또는 요청 도구를 사용한 자식은551개이며 전체 적격 자식 수나 사용률의 분모가 아니다. 동일세션+request_key 후보295개와 반복57회가 있지만 task identity별 동일 미결 질문의 완전 분류는 하지 않았으므로 논리적 요청 수로 주장하지 않는다.

모든 호출의 실제 반환은 `azrael_agents requires direct plaintext arguments; encrypted or code-mode task arguments are not accepted.`였다. 예시 원본에는 namespace=azrael_agents 및 일반 JSON arguments가 있다. 요청 저장 전 guard에서 차단돼 request_id가 생기지 않았으므로 구조화된 응답 대기·부모 응답 단계로 넘어간 근거도 없다. 모델이 도구를 몰라 사용하지 않는 상황으로 판단할 수 없다. 이 오류는 자동 승인 심사의 거절이 아니라 엔진 호출 출처 guard의 반환이다.

## 확인된 원인과 설치 관계

통합 소스 engine/codex-rs/core/src/tools/router.rs:45 direct_source는 spawn_agent/send_message/followup_task만 DirectPlaintextMessage로 분류한다. request_parent/await_parent_response/respond_to_request는 Direct로 분류된다. spec_plan.rs:1914의 AzraelMultiAgentTool::handle guard는 이 세 도구에도 DirectPlaintextMessage를 요구하여 실제 ParentRequestHandler 이전에 거절한다. 따라서 정상 direct JSON 호출에도 기록된 오류가 발생하는 코드 경로를 확인했다. 새 세 도구가 모두 같은 분류 불일치의 영향을 받으며 실제 관측 실패는 request_parent다.

한 번의 프로세스 경로 관측에서 ordinary w10e 및 isolated u17b 엔진이 실행 중이었다. 각 runtime build-info.json의 engineSourceRoot는 artifacts/n10a/engine이고 그 router/spec_plan에도 같은 불일치가 있다. 세션별 당시 실행 바이너리와 전체 source fingerprint를 다시 검증한 것은 아니며 각352건을 특정 PID에 연결하거나 다른 프로필의 실패 수로 확대하지 않는다. live 오류 반환과 출처 소스의 구체적 불일치는 독립적으로 확인했다.

## 실제 사용 및 대체 전달 사례

- /root/decal_receiver_cpu,10/16 22:21:24~31: accepted source0 경로·해시를 요청하는 request_parent 3회 모두 오류.22:21:35 일반 send_message로 같은 판단 필요를 전달했고22:23:22 PARTIAL final을 작성했다.
- /root/approval_reconnect_build_install,10/19 14:37:02 및14:37:18: engine source receipt 갱신 조정 요청2회 모두 오류.14:37:42 send_message에 도구가 두번 내부 거부되어 즉시 결정을 mail로 전달한다고 명시했다. 독립 준비와 근거 조사를 이어갔다.
- /root/u23_queue_integration,10/19 15:49:29 및15:49:34: question injector의 소유 범위 확장 질문을 같은 key로 재시도했으나 모두 오류.15:51:07/24 일반 메시지에 추가 injector 소유 범위 승인 필요를 보고했다. 이 사례의 최종 승인 여부나 작업 권한 적절성 전체를 감사한 것은 아니다.

일반 메시지를 통한 부모 회신은 존재할 수 있지만 parent request 성공이나 자동 조기 재개를 뜻하지 않는다. 다른 모든 요청도 같은 fallback을 사용했다고 일반화하지 않는다.

## 검증·보존 및 다음 조치

스캔 명령은 `node --disable-warning=ExperimentalWarning work/AR-01-root-child-mail-analysis/recent-usage-scan.cjs`, 최종 실제 exit0(exec46313). 파일 읽기 오류0/JSON 파싱 오류0이고 모든352호출을 반환과 연결했다. SQLite는 node:sqlite readOnly로 조회했으며 기록·세션을 변경하지 않았다. verbose 근거는 artifacts/logs/parent-request-usage-20261019/usage.json, 추출 기준은 보존된 scanner에 있다. 후보 추출 중 첫 header 뒤 부모 상속 metadata가 존재함을 확인하여 identity 처리를 고친 최종 집계만 채택했다.

조사 그룹 ar01-parent-request-usage-20261019를 project_inventory에 완전 등록했다. 사용 중인 계획 참조와 후속 장애 수정에 필요하므로 group 전체 defer를 결정했다. 수정 및 실제 재검증 뒤 필요한 근거를 계획에 보존하고 원문 소비 참조가 해제되면 재검토한다. 임시 계획 본문은 일반 삭제했고 불필요한 fixture/build는 생성하지 않았다.

권고는 세 신규 도구의 direct_source 분류와 guard 계약을 맞추고, 실제 router→wrapper→handler 전체 경로의 평문 허용 및 암호화/code-mode 거절 회귀를 검증한 후 지원 runtime에서 요청 저장·부모 재개·응답·자식 응답 대기 복귀를 확인하는 것이다. 이번 요청은 조사이므로 수정·테스트·빌드·설치·다른 에이전트 호출은 수행하지 않았다. 공통 기능의 다른 OS/프로필/원격 사용 현황과 실제 배포 수용을 주장하지 않는다.

## 해결 계획

목표: 지원되는 azrael_agents direct JSON 호출에서 request_parent/await_parent_response/respond_to_request가 실제 handler에 도달하고, 요청 저장→부모 처리→답변→자식 복귀가 정상 작동하게 한다. 암호화/code-mode 우회 금지, 기존 collaboration의 지원 범위, root 전용/부모·자식 권한 및 사용자 stop/cancel 계약을 보존한다. 공통 Rust 엔진 수정으로 분류하며 Windows x64 MSVC 회귀를 필수로 하고 다른 OS 통과를 추정하지 않는다. UI·프롬프트·DB schema의 동작 변경은 현재 원인에 필요하지 않다.

### 1. 실패 재현과 수정

현재 소유 파일은 tools/router.rs의 direct_source와 tools/spec_plan.rs의 wrapper guard다. namespace와 도구명별 직접 평문 대상 판정을 한 소유 위치에서 공유하여 두 목록의 불일치를 방지한다. azrael_agents에는 기존3종 및 신규3종을 포함하고, collaboration의 기존3종 및 encrypted metadata 처리 의미는 그대로 유지한다. 일반 Direct 전체를 허용하거나 guard를 제거하여 해결하지 않는다. ToolCallSource::DirectPlaintextMessage는 기존 로그 본문 보호 경로도 선택하므로 새 도구의 진단 본문 비노출을 함께 확인한다.

기존 router_tests의 direct_source_accepts_only_expected_plaintext_message_shapes와 spec_plan_tests의 azrael_namespace_wrapper_dispatches_plaintext_and_rejects_opaque_sources는 followup_task만 시험한다. 새 테스트는 수정 전 신규3종의 평문 진입이 실패함을 먼저 입증한 뒤, 실제 ToolCall에서 direct_source를 계산하고 wrapper→handler까지 전달되는 경로로 검증한다. 테스트에서 source enum을 수동으로 정상 값에 고정하지 않는다. 실제 request/response handler를 통한 저장·상태 전이도 연결한다.

### 2. 회귀 범위

- 정상 입력: 신규3종의 namespaced direct JSON, encrypted metadata 없음 및 빈 배열 허용. 같은 request_key 재시도는 단일 요청을 유지하고 답변과 task identity가 정확히 연결된다.
- 거절 입력: 비어 있지 않은 encrypted metadata, code-mode 출처, 지원하지 않는 namespace/세션, 잘못된 부모·요청 identity. 해당 사례가 실제 handler에 진입하지 않는지 확인한다. handler의 소유권·역할 검증과 transport 거절 검증을 구분한다.
- 기존 동작: 기존 메시지3종의 정상 허용 및 암호화/code-mode 거절, wait_agent 등 비대상 도구 분류, 진단 로그 본문 보호를 확인한다.
- 수명주기: parked 부모의 한 번 재개, 이미 실행 중인 부모에 중복 턴 없음, 동시 요청 합류, child의 독립 작업 후 같은 request_id 응답 대기에서 추가 요청/재개 없음, 답변 뒤 같은 child 작업 복귀, stop/cancel 보존을 기존 fixture와 새 진입 경로에서 확인한다.

### 3. 검증 실행과 보존 연결

먼저 작은 source/분류/guard 검사를 실행하고 수정 전 실패→수정 후 통과를 확인한다. 이후 변경된 source·scripts·lockfile·toolchain·Windows target/profile을 고정하고 기존 Cargo helper의 prerequisite 및 cache 소유권을 확인하여 필요한 native 선택 검사를 실행한다. 같은 target의 중복 producer를 시작하지 않는다. 긴 컴파일 전에 고정 입력의 provenance와 필요한 경로/환경을 작은 실제 probe로 확인한다.

기존 scripts/check-parent-requests.cjs는 parent_request/parent_response_wait 이름으로 native tests를 선택한다. 신규 라우팅 회귀는 해당 선택에 실제 포함되게 연결하고 보고서에서 실행 건수와 케이스명을 확인한다. 기존 lifecycle/storage/authority 검사는 유지한다. feature inventory engine.parent-requests의 owner에 router/shared predicate 및 해당 테스트를 연결하고, owning architecture에 평문 진입 및 검증 범위를 반영한다. 공통 지침은 변경하지 않고 기존 guidance check를 유지한다. project maintenance에 선택 번들이 없으면 실행 전에 필요한 번들·input을 등록하고 plan의 argv/cwd/environment/guards를 검토한다.

담당 책임은 root가 계약·수정·통합·검증·최종 수용을 소유하는 작은 단일 수정으로 잡는다. 먼저 진입 경계의 테스트와 수정 및 변경 소스 준비를 끝낸 뒤 같은 불변 입력을 native 검사가 소비한다. native 실행 중에는 독립적인 보존 문서 정합성과 최종 제품 검증 준비를 진행한다. 검증/빌드 출력은 해당 실행 전에 work/run 소유자·경로·identity와 소비 참조를 등록하고 종료·실패·정리 결과를 유지한다. 실제 명령/종료 코드/로그/미검증 범위를 이 계획에 기록하며 소스검증 통과를 배포 수용으로 보고하지 않는다.

### 4. 앱 적용 및 실제 수용 단계

앱의 전체 빌드·패키징·설치는 build playbook상 사용자의 명시적 실행 지시가 필요한 별도 실행 범위다. 적용까지 지시받으면 수정된 불변 소스로 engine/bridge의 호환 bundle을 만들고 새 build identity로 패키징한다. 기존 앱 버전은 유지하고 최종 패키지 동일성 및 필수6단계 fresh-state host 검사를 통과한 정확한 payload를 적용한다. 실행 중/이전 복구 버전과 사용자 상태를 보존하고 활성 세션을 강제 종료하지 않는다. 실제 창이 새 엔진을 쓰는지 경로·버전·출처/해시로 확인한 뒤 검증한다. 현재 구버전 프로세스가 여러개 존재하므로 설치만으로 활성화됐다고 판단하지 않는다.

실제 지원 provider/runtime의 검증용 새 부모·자식 작업에서 무해한 판단 요청을 보내고 request_id 저장, parent_request 재개, request_id 일치 응답 저장, child 응답 대기 복귀와 중복 요청/턴 없음까지 추적한다. 전달 지연은 request_id/wait_id와 timestamps로 확인한다. 과거352건은 접수 전 실패이며 당시 범위·상태가 바뀌었을 수 있으므로 일괄 재전송하지 않는다. 기존 미완료 작업은 그 담당 부모가 현재 유효성을 확인한 질문만 정상 도구로 다시 요청하도록 한다.

### 완료 기준과 권한

코드 수정 단계 완료는 신규3종 direct 진입 성공, 거절 경계 및 기존 메시지 회귀 보존, 실제 선택 native tests 통과, 소유 문서/feature mapping 정합성 및 검증 산출물 정리/보존 결정까지다. 앱에서 문제 해결 완료는 정확한 신규 runtime 활성화 후 실제 요청→답변→child 복귀까지 확인해야 한다. 전체 빌드/설치 지시가 없으면 코드 검증 완료와 앱 미적용을 구분하여 보고한다.

본 계획 작성에서는 코드·공유 지침·테스트·빌드·앱 설치·기존 세션을 변경하지 않았다. 계획 승인이나 범위가 바뀌면 같은03-plan에서 실행 상태와 결과를 이어 기록하며 별도 계획/승인 단계를 만들지 않는다.

## 실행 기록

현재 실행 권한은 계획의 코드 수정·필요한 테스트 준비 컴파일·회귀 검증·문서 및 보존 연결·정리·작업 commit이다. primary checkout에서 작업하며 worktree를 생성하지 않는다. root가 단독 소유한다. 기존 다른 작업의 spec_plan/spec_plan_tests/inventory 등 dirty 변경은 시작 바이트를 보존하여 partial stage로 분리한다.

작업 그룹은 AR-01/03-parent-routing, run은 artifacts/tasks/AR-01-root-child-mail-analysis/runs/20261019-routing-r1이다. 시작 baseline, 불변 engine 입력, 로그, 결과, fixture 및 pending 출력이 이 run에 속한다. producer와 manifest는 artifacts/logs/parent-request-routing-20261019에서 보존하며, native 실행 전에 source/driver/helper/toolchain/cache identity와 실제 argv/env를 고정한다. source 수정→입력 고정→작은 경계 검사→native 전이가 선행 순서이며, 긴 실행 중 문서 정합성과 commit 준비를 독립 진행한다.

### 2026-10-19 검증 진행

`direct_source`와 wrapper가 `requires_plaintext_arguments`를 공유하도록 수정했다. 기존 collaboration 범위와 metadata 의미는 유지한다. 실제 router/guard 호출 검사, namespace/metadata/진단 본문 보호 검사, 실제 저장 handler를 연결한 request→wait→response 검사를 추가했다. feature inventory와 소유 문서를 연결했다. 기존 다른 작업의 변경과 분리한 patch는 run의 `own-changes.patch`이며 index 적용 가능성을 확인했다.

작은 분류 재현은 수정 전 test exit101, 수정 후 exit0이었다. 공통 지침 검사 `common-instructions`는 5개 모두 통과(exit0, maintenance run `run-45928-1249-1792406945445914700`). feature manifest 검증도 exit0이었다. 이는 native lifecycle/handler 전체 통과의 대체 근거가 아니다.

불변 입력은 run의 `inputs/engine`(9,301 files, 99,901,570 bytes), freeze receipt sha256 `1c14366039b75ffc614623b18f640b5799195d1644fc3987afeb755594c75688`, inventoryTree sha256 `937d52f63cb04a0aa80b877d0afb8845d471f5beeb839436565798bc97f6af5f`이다. 캡처한 검사 helper와 입력을 실행 직전/후 다시 검증한다. Windows x64 MSVC, pinned Rust1.95.0, jobs1, offline/locked, 기존 Cargo ownership guard를 사용한다. 앱 빌드·패키징·설치는 실행하지 않는다.

11:03 UTC 시작한 maintenance run `run-45928-1254-1792407807224047800`은 다른 coordinator25284의 공용 cache 사용 종료를 기다리다 11초 후 exit124로 종료됐다. native Rust 검사는 미시작이었다. maintenance의 `ExecCommandHandler::one_shot` 기본 10초 제한을 확인했고, producer_completed=true와 해당 Node/Wait-Process 잔여 없음으로 실제 종료를 확인했다. 첫 시도 결과를 `attempt-project-tools.json`에 보존했다. workId `bb2e6c6f-9172-4c1e-a0b4-e7f27a601897`도 failed/124로 종료 기록했다. 이 별도 도구 제한은 이번 수정 범위에 포함하지 않는다.

11:06 UTC 같은 검증 driver를 장시간 실행 가능한 `exec_command`로 재시작했다(session64334, workId `d78d7dff-9351-4c96-aca7-f48da0b81d17`). 다른 coordinator 전체 종료를 기다리며 cache lease의 일시적 빈틈에서 중복 컴파일하지 않는다. 결과는 `results.json`, 실제 native 로그는 `logs/native.log`에 기록한다. 완료 신호 후 실제 종료 코드와 선택된 새 테스트의 실행 여부를 확인한다.

11:08 UTC 두 번째 시도는 입력 검증 중 다른 stage coordinator34220이 cache를 먼저 취득하여 ownership guard에서 exit1로 종료됐다. Cargo 미실행을 확인했고 `attempt-cache-conflict.json`/`logs/attempt-cache-conflict.log`를 보존했다. 프로세스 계보를 한 번 확인하여 이 stage의 상위 feature-preservation pipeline50608을 식별했다. 세 번째 시도(workId `02d684a2-9f26-4466-949c-cbf708c0ff22`)는 이 pipeline 전체 종료 후 cache guard와 입력 검증을 수행한다. driver에 실행 직전 owner 재확인도 추가했다. 제품 source와 불변 입력은 변경하지 않았다.

11:39 UTC 세 번째 시도는 상위 pipeline 종료 후에도 stage60432의 owner token이 남아 exit1로 중단됐다(Cargo 미시작, `attempt-abandoned-owner.json`). 복구 판단은 PID 부재만으로 하지 않았다. 전체 프로세스 목록에서 관측한 pipeline31972→50608→60432의 모든 잔여 하위 프로세스, 해당 snapshot/run 명령, 전체 cargo/rustc/rustdoc/link/lld-link 프로세스가 없음을 확인하고 `cache-recovery-evidence.json`에 기록했다. 정확한 owner token `e557ceb4-858f-4f17-94c1-4f39cedccd5e`가 그대로임을 재확인하고 원본 metadata를 보존한 뒤 owner 파일과 빈 lease 디렉터리를 일반 삭제하여 복구했다. 기존 검사의 성공이나 종료 코드를 추정하지 않는다. 네 번째 검증은 동일 불변 입력, workId `6bd1ab19-b449-43a4-b3de-fc39dacb9b6c`로 시작한다.

### 검증 결과와 수용 범위

11:40:06~12:17:33 UTC native 검사 완료(exit0). 선택 테스트 타입 검사 exit0(7분56초), 실제 테스트 목록 36개 확인 후 36개 모두 통과했다. core27, app-server-protocol1, prompts1, state6, thread-store1이며 실패0/무시0이다. 새 테스트 `parent_request_direct_sources_preserve_namespace_encryption_and_log_boundaries`, `parent_request_router_dispatches_plaintext_and_rejects_opaque_sources`, `parent_request_real_router_persists_request_wait_and_response`의 실제 실행과 통과를 확인했다. 새로운 저장 fixture는 요청 재시도 identity, 실제 child task 연결, wait 저장, 부모 답변 저장, 같은 자식의 답변 조회를 검증한다. 실제 parked-parent wake/중복 admission/stop/cancel은 기존 lifecycle fixture가 담당한다. 공통 지침5개와 feature manifest 검사도 통과했다.

통과 후 primary checkout의 변경된 Rust 소유 파일5개가 불변 검증 입력과 바이트 단위로 일치함을 확인했다. 제품 코드는 검증 중 변경하지 않았다. 소유 문서 상태를 source current로 갱신했으며, 검증한 환경은 Windows x64 MSVC뿐이다. 새 앱 배포·설치·실제 모델 요청의 수용은 수행하지 않았고 과거 실패한352건을 재전송하지 않았다.

독립 보존 근거는 [verification.json](../../artifacts/logs/parent-request-routing-20261019/verification.json), [native.log](../../artifacts/logs/parent-request-routing-20261019/native.log), 입력 receipt·실패 시도·cache 복구 기록·분리 patch가 있는 같은 폴더다. run 내부 경로는 당시 실행 위치를 나타내며, 보존 근거의 읽기에 임시 snapshot이 필요하지 않다. 스테이징은 시작 baseline 대비 이번 변경 patch만 적용했으며 기존 다른 작업의 변경은 유지한다. 임시 maintenance bundle은 제거했다. 소스 fixture·pending은 실제 사용자 프로필을 사용하지 않았다.

검증 payload 그룹 `ar01-parent-routing-r1`은 producer 종료·통과 근거 이관·소비자 해제 후 재등록했으며, review blockers0으로 임시 묶음을 삭제했다. cleanup attempt `attempt-45928-1259-1792412626027` 결과는 status deleted, remaining=false다. 실제 run 경로 부재도 확인했다. 보존 근거는 현재 수정의 검증 근거로 유지하며, 해당 기능이 대체되거나 새 검증 근거로 전환되어 이 기록의 참조가 해제될 때 재검토한다.

보존 근거 전체는 그룹 `ar01-parent-routing-evidence-20261019`(1,950,791 bytes)로 등록하고, 현재 문서 참조와 삭제한 run의 control evidence 때문에 동일 조건으로 defer 처리했다. 최종 staged diff8개 파일만 검사했으며 whitespace 검사 exit0이다. 코드 수정 단계의 검증·정리는 완료했다. 앱 적용과 실제 모델 왕복 검증은 별도 미수행 범위다.

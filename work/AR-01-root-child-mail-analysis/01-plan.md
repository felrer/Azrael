상태: 합의한 설계의 구현·검증 진행 중. 사용자 실행 지시에 따라 제품 코드·지침·관련 문서를 갱신한다. 전체 앱 빌드·설치·원격 배포는 별도 범위다.

## 최초 조사 목표와 범위
지정 root 01a12b2d-6525-72c2-8eb7-a803a6a9e27a와 child 01a1339e-ed0b-7b92-b7ea-0a765bbe9cc2의 메시지 전달 및 자동 재개 상태 분석. 허용 범위는 로컬 기록·코드 읽기와 조사 기록 작성. 수정·중단·재개 요청은 없음. 공통 엔진 의미를 조사하되 실제 증거는 현재 Windows 로컬 프로필에 한정.

## 최초 조사와 검증
state_5.sqlite를 mode=ro로 조회하고 두 rollout JSONL의 예약·통신·종료 이벤트를 대조한다. 구현 소유자는 engine/codex-rs/core/src/session/root_resume.rs 및 agent/control.rs. 메시지 일치 여부, 예약 대상의 thread/turn identity, wake_reason과 last_error를 확인한다. 빌드나 별도 재현은 기존 실제 세션 증거로 충분하므로 수행하지 않는다.

## 확인 결과
2026-10-13 18:02대 KST 조회 시 최신 예약 c0d359c5-ad17-488d-ad81-dee5ef7f7681은 waiting, last_error 없음. 대상은 /root/task_group_metadata의 turn 01a1345c-8b2f-7a80-815e-9f16503e4f24. 18:00:31 예약, 18:10:31 마감이다.
18:00:47.588 자식 발신 메시지는 18:00:47.742 root의 agent_message로 저장됨. 일반 메시지는 root의 모델 실행을 시작하지 않고 대기 중 대화 이력에 즉시 저장한다. 종료 또는 예약 마감이 재개 조건이다.
이전 예약 4c8fdd32-e28e-49a9-9a57-f626aac1b7d3은 자식 이전 턴 종료 직후 17:23:25.945에 agents_completed로 조기 재개됨. 뒤 세 예약은 deadline으로 재개됐으며 오류 없음. 이전 턴 종료는 새로 지정한 자식 턴 종료를 대신하지 않는다.
추가 전수 대조에서 자식의 /root 대상 send_message 63건 모두 root의 해당 author agent_message에 정확히 1회씩 일치했다. 미수신 및 중복 수신은 0건이다. 따라서 메시지가 수신 이력에 누적되지만 전송 재시도·전달 장애를 뜻하지 않는다. 진행 보고는 CLI의 공유 Cargo artifact lock 대기와 이후 실제 의존성 컴파일을 알린다. 빌드 완료/성공 자체는 이 조사에서 별도 검증하지 않았다.

## 응답 기대 확인
스크린샷 시점의 CLI cache/resource checkpoint는 진행 보고다. 17:46:57 및17:53:38 KST 발신 직후 자식은 sleep(60000) 후 build session/log 확인을 계속했으며 root 답변을 선행 조건으로 삼지 않았다. 18:00:47 cache 획득 보고 역시 root 결정 요청이 없다. 즉각 응답을 기대했다는 근거는 없다.
다만 전체 세션에는 parent 결정 요청도 있다. 16:56:59에 dependent compile 보류와 r5 진행 확인을 요청했고, 17:22:04에는 기존 manifest/lock overlay 승인이 있어야 r6 재검사가 가능하다고 보고했다. 후자는 17:22:11 wait_agent(60000), 17:23:25 승인 필요를 명시한 PARTIAL final로 현재 턴을 종료, 17:24:03 root followup 승인을 수신하고17:24:38 r6 준비를 시작했다. 이 구간은 답변이 필요했지만 메시지 자체가 즉시 root를 깨울 것으로 기대했다고 단정할 수 없다. 실제 자식 종료가 root 조기 재개를 유발했다.
따라서 진행 보고와 결정 요청을 구분해야 하며, 전송 정상이라는 결론은 모든 메시지가 응답 불필요라는 의미가 아니다.

## 결정 대기 종료 신호의 사용 가능성과 활용
자식은 별도 결정요청 완료 도구가 아니라 final 답변으로 현재 턴을 끝내는 방법을 사용할 수 있다. PARTIAL/UNRESOLVED는 사람이 읽는 결과 본문이며 엔진의 별도 blocked 상태가 아니다. 엔진은 최종 결과를 parent에 전달한 뒤 해당 turn의 terminal 상태를 알린다(session/mod.rs:2420, agent/control/completion.rs:122). 예약된 대상 턴의 terminal이 확인되면 재개 조건이 충족된다(agent/control.rs:428). root가 해당 자식 턴을 기다리며 all_terminal 대상이 모두 끝났을 때만 조기 재개를 보장하는 계약이다. 일반 send_message와 wait_agent는 자식 턴을 종료하지 않는다. root followup_task는 같은 자식에 후속 턴을 시작할 수 있다.
명확한 의사결정 대기 사례 세 건은 모두 PARTIAL final을 활용했다. 16:43:19 coherent input 결정 요청→16:47:06 종료→16:47:11 followup 수신. 16:56:59 r5 진행확인 요청→17:00:51 종료→17:01:15 followup 수신. 17:22:04 manifest/lock overlay 승인 요청→17:23:25 종료→17:24:03 followup 수신. 마지막 예약의 agents_completed 조기 재개는17:23:25.945로 실제 검증됨. 앞선 두 사례를 같은 조기 재개로 단정하지 않는다. 16:43 요청 후 wait_agent(60000) 두 번, 17:22 요청 후 한 번의 wait_agent가 있었으며, root를 깨우는 효과는 없다. 요청→종료는 각각 약3분47초/3분52초/1분22초다.
활용은 대체로 적절하지만 결정에 완전히 막혔고 독립 작업이 없으면 final로 바로 턴을 닫는 편이 빠르다. 반대로 독립 구현이나 검증 준비가 남아 있으면 이를 진행하면서 질문을 보내는 것이 적절하며, 모든 질문을 종료로 바꿀 이유는 없다. 산출물 준비는 전체 할당 완료와 구분해야 한다. 완료하지 않은 할당을 DONE이라고 쓰지 말고 PARTIAL/결정 필요/현재 결과와 다음 실행 조건을 분명하게 적는다. 이번 작업에서 실제 자식 지침·제품 코드·예약은 변경하지 않았다.

## 자식에게 재개 조건이 명시됐는지
해당 rollout의 session_meta.base_instructions, 저장된 developer/system/user message 및 root 발신 agent_message에서 defer_root/all_terminal/ordinary progress/parked/wake/깨우/턴을 종료 등의 재개 설명을 검색했지만 일치한 지침은 발견하지 못했다. 기록상 자식이 종료해야 대기 중 부모의 조기 재개 조건이 되는 계약을 명시적으로 교육받았다는 증거는 없다. 제공 도구 스키마 등 모든 실제 모델 요청 내용을 재구성한 검증은 아니므로 숨은 입력까지 부재라고 단정하지 않는다. 기존 PARTIAL final 행동만으로 해당 원리를 알고 있었다고 단정할 수 없다. root는 종료뿐 아니라 deadline/manual/user input으로도 재개할 수 있으므로 '자식 종료만 부모 호출 가능'은 정확한 계약이 아니다. 지침 보완은 제안일 뿐 실행하지 않았다.

## 권고와 한계
현재 통신 수정이 필요한 증거는 없다. 산출물 준비 즉시 root의 후속 실행이 필요하다면 준비 완료를 별도 완료 이벤트로 표현하는 작업 분할 또는 work_completion 사용을 검토할 수 있다. 이는 권고이며 실행하지 않음. 일반 진행 메시지마다 root를 재개하면 불필요한 모델 실행이 늘어난다. 제품의 모든 오류 가능성을 배제하는 결론은 아님. 지속 설계는 기존 root-resume.md가 소유하며 이번 조사는 동작 변경이 없어 수정하지 않는다.

## 부모 즉시 요청 설계 제안

상태: target, 구현 승인됨. 일반 보고는 기존 send_message로 누적하고, 부모의 판단이나 조정이 지금 필요한 경우에만 별도 request_parent를 사용한다. 스케줄링·메시지 의미는 지원 플랫폼 공통 계약으로 제안하며, 구현 가용성은 각 runtime/provider의 검증된 도구 전송 경계에서 판단한다. 기존 근거는 Windows native OpenAI 경로에 한정하고 미검증 환경의 지원을 주장하지 않는다.

추천 도구는 request_parent({request_key, question, context, recommendation, blocked_action})이다. target은 입력받지 않고 엔진이 실제 직계 부모를 결정한다. request_key는 같은 요청 재시도의 중복 방지 키이며 동일 키의 다른 내용은 거부한다. 반환은 request_id, 요청 pending 상태, delivery 상태(queued/resume_scheduled/deferred/blocked 등)와 구체적인 사유다. 저장 성공, 재개 예약 성공, 실제 답변 완료를 구분한다. 후속 도구명·필드명은 제안이며 현재 제공 기능이 아니다.

부모가 defer_root 대기 중이면 요청을 영속 저장한 뒤 기존 revision-checked dispatch 경로로 조기 재개한다. 새로운 parent_request wake_reason은 기존 reasoning snapshot 정책 등 자동 재개의 계약을 보존한다. all_terminal은 기존 완료 대기의 의미를 유지하며, 부모 판단 요청은 별도의 조기 재개 원인이다. 요청 자식이 현재 선택된 완료 대상이 아니어도 같은 부모에 속한 유효 요청이면 재개할 수 있다. child turn 완료나 agents_completed를 합성하지 않는다. 부모가 실행 중이면 기존 mailbox의 다음 처리 경계에 우선 전달하고 새 부모 턴을 중복 시작하거나 진행 중 도구를 중단하지 않는다. 예약 없이 자연스럽게 idle인 부모는 정상 admission을 통과해 요청 처리 턴을 시작한다. 사용자 명시 stop/cancel 상태와 엔진 미실행 상태는 자동 실행하지 않고 요청 및 미처리 사유를 보존한다. 다단계 위임의 parent 역시 지원 가능한 동일 계약을 따르며 root 전용 예약 도구를 child에 노출하지 않는다.

자식은 request_parent 후 독립 작업을 계속할 수 있다. 답변 없이는 진행할 수 없을 때 await_parent_response({request_id})로 모델 추론을 쉬고 이벤트를 기다린다. 이는 task terminal이나 final이 아닌 응답 대기 상태다. 긴 대기는 별도 suspend/control 경계로 설계하여 root 조사 턴을 막는 긴 tool await나 모델 폴링으로 구현하지 않는다. 부모 respond_to_request({request_id, decision, reason})는 resolved/cancelled 등 요청 상태 및 답변을 먼저 저장하고 자식에게 전달한다. 부모가 추가 정보가 필요하면 요청을 유지한 채 보충 질문을 보낼 수 있다. 일반 메시지, 도구 접수, 재개 시도 및 시간 경과는 승인으로 간주하지 않는다. 이미 턴을 마친 자식의 답변은 이력에 남기되 후속 작업 실행은 기존 followup_task 계약으로 명시한다.

요청에는 parent/child thread와 child 작업 identity, request_id/key, 상태와 답변을 저장한다. 응답 권한은 해당 부모로 제한하고 사용자에게 필요한 승인은 기존 경계를 유지한다. 작업 identity가 바뀌면 새 작업에 자동 적용하지 않는다. 상태는 pending→resolved/cancelled이고 부모 실행 실패·계정 admission 오류는 delivery 실패로 분리하여 pending 요청을 잃지 않는다. 모델 외부 실행의 exactly-once는 보장하지 않고, 기록과 응답의 멱등 처리 및 단일 부모 실행 admission으로 중복 영향을 제어한다. crash 복구는 영속 상태와 기존 reservation의 ambiguous-boundary 계약을 재사용한다.

동시 요청은 대기 큐에 함께 저장하고 이미 예정되거나 실행 중인 부모 호출에 합친다. 새 요청마다 부모를 추가 호출하지 않는다. 접수와 defer_root 사이 경쟁은 같은 submission gate와 pending 재확인으로 다룬다. 미처리 즉시 요청이 있으면 부모가 해당 요청을 처리하거나 명시적으로 보류하기 전에는 같은 자식 결과만 기다리는 완료 대기로 돌아가지 않게 한다. 보류는 사유와 재개 조건을 포함하며 무응답이나 자동 승인과 구분한다. 자식은 답변 대기 동안 영향받는 작업만 보류하고 허용된 독립 작업은 계속한다.

같은 request_id에 대한 응답 대기 전환은 추가 parent_request나 agents_completed를 발생시키지 않는다. 동일 request_key의 재시도는 기존 요청과 전달 상태를 반환하며 재개 이벤트도 중복 생성하지 않는다. 부모 재개가 예정되었거나 요청이 실행 중 부모에게 전달된 경우, 자식의 이후 대기 전환 때문에 새 부모 턴을 시작하지 않는다.

### 응답 대기 시간과 진단 로그

요구사항: 무응답으로 작업이 계속 대기하는 상황을 나중에 조사할 수 있도록 요청 처리와 자식의 실제 응답 대기 시간을 엔진에서 측정하고 기록한다. 현재는 설계 반영 범위이며 도구 자체의 제품 구현은 수행하지 않는다. 로그를 통한 관찰과 대기 상한/자동 개입 정책은 별개의 계약이다. 시간 경과로 승인·완료를 합성하거나 부모 요청을 재전송하지 않는다. 무한 대기 방지의 시간 제한·사용자 알림·개입 정책은 후속 판단 사항이다.

request_id, wait_id, parent/child thread와 child task/turn identity로 요청과 개별 대기 구간을 연결한다. request_created, parent_resume_scheduled/parent_resume_started/parent_request_delivered, response_saved/response_delivered, response_wait_started/response_wait_checkpoint/response_wait_ended를 구조화된 기존 엔진 tracing/log sink에 기록한다. 부모 admission·재개·전달 오류는 해당 단계의 failure와 오류 유형을 남긴다. 질문·답변 본문 및 비밀값은 진단 로그에 복제하지 않는다. 각 이벤트는 UTC 시각과 단계 상태를 포함하고 사용자에게 시간 표시 시 로컬 시간대로 변환한다.

요청 생성→답변 저장의 request_response_ms와 자식 대기 진입→답변 적용 또는 취소/중단의 blocked_wait_ms를 구분한다. 답변이 이미 도착해 대기에 진입하지 않으면 실제 blocked wait는 0이며 요청 응답 시간은 별도로 남는다. 한 요청을 여러 차례 기다려도 각 wait_id 구간을 개별 기록하고 실제 대기 구간만 합산한다. 요청 pending 구간이나 독립 작업 시간은 자식 blocked wait에 포함하지 않는다. 같은 시작/종료 이벤트 재처리로 구간이 중복되지 않게 한다.

동일 엔진 실행 중 경과 시간은 monotonic clock으로 측정하여 시스템 시각 변경 영향을 피한다. 영속 상태에는 시작·종료 UTC, wait identity, 누적 측정 시간 및 마지막 측정 경계를 남긴다. 재시작 시 미종료 대기를 복원하되 process 간 monotonic 값을 빼지 않는다. 재시작 전후 직접 측정한 활성 대기 시간과 엔진 정지 구간/벽시계 기반 추정 시간을 구분하며, 추정 불가 구간은 unknown으로 표시한다. 시작 로그만 있고 종료 로그가 없다는 사실을 성공·취소·현재 생존의 증거로 삼지 않는다.

진행 중 대기는 종료 로그가 없어도 검토 가능해야 한다. 기본 제안은 대기 시작 60초 후 첫 checkpoint, 이후 5분마다 checkpoint를 기록하는 것이다. 이 타이머는 엔진의 가벼운 상태 확인과 로그 기록만 수행하고 모델을 호출하지 않으며 부모에게 중복 요청을 보내지 않는다. checkpoint는 현재 실제 대기 시간, 요청/delivery 상태, 부모가 대기·실행·보류·재개 실패 중 무엇인지, 마지막 상태 변경 시각을 함께 담는다. 모르는 상태는 unknown으로 남긴다. 중단·취소·답변 도착 시 checkpoint 타이머를 정리한다. 엔진이 꺼져 있는 동안에는 checkpoint가 발생하지 않으며 복구 시 별도 recovery 이벤트를 기록한다.

종료 로그는 answered/cancelled/interrupted/wait_failed 등 실제 결과와 측정 시간, 답변 적용 여부를 포함한다. 요청 pending 상태와 대기 구간 종료 상태를 분리하여 대기 도구 실패가 요청 삭제로 이어지지 않게 한다. 답변이 저장되었지만 자식에게 전달되지 않은 상태도 식별 가능해야 한다. 응답 대기 진입/답변 도착 경쟁, 동일 요청 재시도, checkpoint 뒤 정상 응답, 취소·도구 실패, 시스템 시각 변경 및 엔진 재시작을 필수 검증 시나리오에 추가한다. 제품 구현·실제 로그 수집·운영 안정성은 아직 검증하지 않았다.

자식에게 도구 설명과 공통 지침 모두에서 구분을 명시한다: 진행·검증 결과·나중에 소비해도 되는 보고는 send_message, 부모 판단이 현재 작업의 선행 조건이면 request_parent, 전체 할당 완료는 final. 요청 본문은 필요한 결정·막힌 작업·근거·추천안 중심으로 제한한다. 부모에게도 요청 처리/응답 도구와 미처리 요청 재대기 방지 계약을 제공한다. 공유 지침 변경은 추후 실행 권한을 얻고 instructions/README.md의 유지 규칙을 적용해야 한다.

### 지침 수정안 검토

요청 범위는 지침 수정 방식과 문안의 검토다. 현재 지침 라이브러리·엔진 프롬프트·설정·설치된 사본은 변경하지 않는다. 실제 도구 이름과 종료/복구 동작이 구현 계약으로 확정된 뒤 아래 문안을 해당 가용성에 맞춰 적용해야 한다.

확인한 전달 구조: engine/codex-rs/prompts/src/root_coordination_instructions.rs의 부모 조정 지침은 별도 developer fragment이며, core/src/agent/control/spawn.rs는 full-history fork에서 부모 조정 fragment와 world-state를 제거한다. 자식 안내는 prompts/src/model_messages/multi_agent.rs의 기본 안내, core/src/session/multi_agents.rs의 역할 선택 및 설정/카탈로그 우선순위, child_config.rs의 subagent developer override, spawn.rs의 fork 삽입 경로가 함께 결정한다. 기본 역할 안내는 custom config/catalog로 대체하거나 빈 값으로 억제할 수 있다. 따라서 부모 지침만 수정하거나 기본 자식 안내만 수정해 모든 자식 입력에 계약이 전달된다고 판단하지 않는다. 실제 모델 요청 전달 검증은 이번 읽기 조사에 포함하지 않았다.

추천 소유권은 동작 의미를 짧은 역할별 통신 developer fragment에 모으고, 해당 runtime/provider/역할에 새 도구가 실제 제공될 때 주입하는 것이다. 공통 통신 규칙은 instructions/instructions/의 유지 원본과 엔진 임베디드 사본을 기존 provenance/check 방식으로 연결한다. 부모의 기존 조정 절은 통신 계약과 일치하게 보완하되 자식에게 부모 조정 전체를 물려주지 않는다. 기술 입력·반환 상태·오류·멱등성은 도구 스키마/설명과 엔진 계약이 소유한다. optional AGENTS/skill 로드나 custom role hint만을 필수 계약 전달 경로로 삼지 않는다. fork/compaction/reload/모델·provider 변경 시 부모 전용 fragment 제거와 자식 통신 fragment 재구성, 중복 삽입 방지를 포함한다.

자식 문안 초안:
- 진행 상황·검증 결과·나중에 소비해도 되는 산출물 준비 보고는 send_message로 부모에게 전달한다. 일반 메시지는 대기 중 부모를 재개하지 않는다.
- 부모에게 짧은 요청을 자주 보내기보다, 현재 확인된 관련 질문·결정 사항·근거·추천안을 한 번에 묶어 전달한다. 같은 판단이나 작업에 속하는 요청은 작은 항목마다 나누지 않고, 부모가 각 판단 항목과 그 영향을 구분할 수 있게 정리한다. 진행 보고도 의미 있는 변화나 작업 경계에서 모아 보낸다. 묶기 위해 아직 생기지 않은 질문이나 관련 없는 작업의 완료를 기다리지 않는다. 현재 진행을 막는 결정이나 즉시 조정이 필요한 문제는 확인된 관련 사항만 묶어 바로 요청한다.
- 부모의 결정이나 조정이 지금 필요한 경우 request_parent로 필요한 판단, 막힌 작업, 근거와 추천안을 전달한다. 도구가 반환한 request_id를 유지하며 접수·재개 예정·답변 완료를 구분한다.
- 요청 후 답변에 의존하는 부분만 보류하고 허용된 독립 작업을 계속한다. 실행할 독립 작업이 없으면 같은 request_id의 await_parent_response로 대기한다. 응답 대기는 현재 할당 완료나 새 요청을 뜻하지 않는다.
- 무응답이나 독립 작업 완료를 이유로 같은 요청을 새로 만들거나 부모를 다시 깨우지 않는다. 접수 여부가 불확실한 재시도는 동일 request_key를 사용하고 도구의 기존 상태를 따른다. 요청 내용이 실제 바뀌면 기존 요청의 해결/취소 관계를 명확히 처리한다.
- 명시적인 답변을 확인한 뒤 그 범위 안에서 진행한다. 시간 경과, 일반 메시지, 요청 접수, 로그 checkpoint를 승인으로 해석하지 않는다. 대기 도구가 취소·전달 실패·복구 필요를 반환하면 같은 실패를 자동 반복하지 않고 원인과 가능한 독립 작업을 보고한다.
- 응답 대기 측정과 checkpoint 로그는 엔진이 담당한다. 로그를 만들기 위한 sleep·반복 조회·상태 메시지를 추가하지 않는다. 전체 할당 완료는 final로 보고하며, 미완료·결정 대기를 DONE으로 표시하지 않는다.

부모 문안 초안:
- 일반 보고는 기존 이력으로 받아 필요한 후속 작업에서 소비한다. 즉시 요청이 도착하면 현재 실행의 안전한 처리 경계에서 해당 요청과 막힌 작업을 판단한다.
- 답변은 respond_to_request의 request_id에 연결하고 허용 범위와 이유를 명시한다. 일반 send_message로 설명을 보완해도 그것만으로 요청 해결을 대신하지 않는다.
- 모인 요청은 한 실행에서 함께 처리할 수 있으나 관련 없는 담당자의 완료를 기다리느라 현재 처리 가능한 요청의 답변을 늦추지 않는다. 같은 요청의 재전달이나 자식의 응답 대기 전환을 새로운 요청으로 취급하지 않는다.
- 추가 정보나 사용자 판단이 필요하면 필요한 입력과 현재 영향받는 작업을 밝힌다. 보류는 지원되는 요청 상태/도구로 사유와 재처리 조건을 기록한다. 이를 일반 메시지로만 알리고 pending 요청을 방치하지 않는다. 보류 API의 구체적 형식은 아직 미결이다.
- 다시 대기하기 전에 미처리 즉시 요청을 답변·취소·명시적 보류로 처리한다. 응답을 기다리는 자식의 완료만 기다리는 순환을 만들지 않는다. 요청 상태 확인은 처리/재대기 경계에 수행하며 반복 폴링으로 바꾸지 않는다.
- 장기 대기 진단의 전달 오류나 재개 실패를 조사할 때 request_id와 wait_id를 사용한다. 단순 경과 시간이나 checkpoint 때문에 자식 작업을 중복 실행하거나 사용자 중단을 자동 해제하지 않는다.

미지원 경로 문안: 새 요청/응답 대기 도구가 현재 세션에 제공되지 않으면 기존 send_message로 판단 요청을 전달하고 허용된 독립 작업을 진행한다. 더 진행할 수 없으면 PARTIAL final에 완료 범위, 필요한 결정과 다음 실행 조건을 명시해 현재 턴을 종료한다. 부모가 해당 턴을 완료 대상으로 기다리며 다른 all_terminal 대상도 충족됐을 때 조기 재개될 수 있고, 일반 메시지가 즉시 재개를 보장하지는 않는다. 미지원 경로에서도 전체 할당을 허위 완료 처리하지 않는다.

배포 시 수정 연결: instructions/instructions/ 유지 원본과 엔진 fragment/주입·fork 경로, multi_agents_spec.rs 및 신규 도구 설명, instructions/skills/implementation/references/delegation.md의 handoff/후속 연결 규칙, instructions/examples/delegation.md의 일반 보고→즉시 요청→독립 작업→동일 요청 응답 대기→명시적 응답 예시를 맞춘다. 실제 AGENTS snippet 소유 위치는 instructions/instructions/AGENTS.snippet.md이며 이번 기능 상세는 전역 AGENTS에 반복하지 않는다. instructions/README.md 및 component/provenance 정보의 경로 일치와 설치된 활성 사본은 실제 변경 범위에 맞춰 확인한다.

검증 권고: fork_turns none/all, compaction/reload, custom/empty role hint 및 모델/provider 전환에서 실제 모델 요청에 정확한 역할·가용성의 통신 지침이 들어가는지 확인한다. 자식에 부모 조정 전체가 누출되거나 미지원 도구 사용을 지시하지 않아야 한다. 행동 시나리오로 일반 보고 누적, 독립 작업 후 동일 요청 대기, 무응답 중 새 요청·부모 중복 실행 없음, 부모의 구조화된 답변과 재대기 방지, 자동 로그만으로 대기 추적 가능을 확인한다. 문구 일치 검사만으로 실제 전달이나 도구 사용의 적절성을 검증했다고 보고하지 않는다.

설계 검증 시나리오는 일반 보고가 부모를 깨우지 않음, request_parent가 child 종료 없이 parked 부모를 깨움, 실행 중 부모에 새 턴이 중복되지 않음, 답변 후 같은 자식 작업이 진행됨, 동시 요청/재시도/예약 직전 요청/재개 경쟁, crash 및 admission 실패, 사용자 stop 보존, 작업 identity 변경 후 늦은 답변 배제다. 구현 시 docs/architecture/root-resume.md와 기존 에이전트 통신 소유 문서에 agreed target을 반영하고 feature inventory의 owner/check 연결을 갱신한다. 이번에는 작업 기록의 draft 제안만 작성했으며 제품 테스트·빌드·설치·실제 재개 실험은 수행하지 않았다.





## 승인된 실행과 현재 인계

사용자 `좋습니다. 계획대로 작업해주세요` 지시로 즉시 부모 요청, 비종료 응답 대기, 대기 시간 로그와 역할별 지침의 구현·필수 검증·정리를 승인받았다. 이전 절의 읽기 전용/초안/미구현 표현은 해당 논의 시점 기록이다. 앱 전체 빌드·패키징·설치·원격 게시와 원래 조사 세션의 변경은 이번 범위 밖이다. 공통 엔진 의미를 구현하며 실제 검증 대상은 Windows x64 MSVC; native OpenAI V2 Azrael namespace/direct mail/persistent session만 새 도구를 제공한다. 다른 provider/OS, installed/live acceptance는 별도다.

root는 통합·dispatch·검증·최종 판단을 소유한다. store 담당은 DTO/SQLite/회전 트랜잭션 및 root fixture, tools 담당은 handler/스키마/control wrapper, wait 담당은 비종료 park·같은 작업 재개·복구·계측, guidance 담당은 capability 기반 developer fragment·fork 정리·원본/활성 사본·문서/inventory를 맡았다. 공유 checkout의 다른 작업 변경을 보존하며 root만 Cargo를 실행한다.

다른 Cargo 작업이 공유 target을 사용해 중복 빌드나 기존 프로세스 종료 없이 캐시를 직렬 사용한다. 최초 snapshot 복사는 Windows 긴 경로 오류로 실패해 native 테스트가 시작되지 않았다. 짧은 경로 `artifacts/ar1/engine`에 9,238개 파일을 동결하고 원본 hash 재대조를 통과했다. 입력 SHA256 `f78eaeee3f47d8e44f66f5265c788d8db8861e43c1a35e842c25b028ac8592c3`; 파일별 지문 `artifacts/logs/AR-01/native-r1-short-input.json`. 다른 작업의 미커밋 소스도 입력에 고정됐지만 이번 commit 소유 범위와 구분한다. 이 native 테스트 지문은 앱 패키징 source receipt 검증을 대신하지 않는다.

Windows native `parent_` 필터를 core/prompts/protocol/state libs에서 locked/offline, build job1/test thread1/RUST_MIN_STACK33554432로 시작했다. 로그 `artifacts/logs/AR-01/native-r1-short.log`; 실제 exit은 같은 폴더 result JSON. 공유 lock 대기 후 dependency compile 시작. 실행 중 입력을 변경하지 않으며 이후 보완은 새 r2 입력에 포함한다.

추가 통합 점검: durable response만 관찰하고 attributed mail 전달 전에 자식 모델을 시작하는 경쟁을 막는다. admission/저장 실패는 Warning과 실패 이유를 남기며 가짜 TurnComplete로 표시하지 않는다. prepare 시각과 실제 blocked UTC 시작 `parked_at_ms`를 분리하고 duration은 monotonic이다. park 저장 실패도 원래 task identity를 유지하는 비종료 보류이며 실패 결과 저장이 불가능하면 checkpoint를 유지한다.

소스 검사: guidance 4/4 exit0 (`guidance-source.log`), instructions import check exit0 (`instructions-import.log`), inventory validateManifest53 features exit0. 새 parent_request wake label을 기존 safe inspector에 추가하고 inspector unittest20/20 exit0 (`native-inspector-tests.log`). 문구 일치만으로 실제 모델 행동·runtime 사용을 검증했다고 판단하지 않는다. native 결과·회귀·변경 분리·커밋·정리는 진행 중이다.

### r1 실패와 r2 검증 인계

r1은 2026-10-13 16:11:45–16:32:44 UTC, 실제exit101로 종료됐다. 첫 원인은 root_resume.rs에서 `CodexErr::InvalidRequest` 생성함수를 enum pattern으로 사용한 E0164; `error.details()`/`CodexErrorDetails::InvalidRequest` 분기로 수정했다. 기존 라이브러리 `message_tool.rs` unused import warning은 해당 변경과 분리한다. 실패한 긴경로 partial snapshot은 경로/프로세스 참조 확인 뒤 일반삭제로 제거했고 실제검증한 ar1 입력과 결과로그는 유지한다.

r2 입력 `artifacts/ar2/engine`,9,238files, SHA256 `bbaa3b17ff107377b60c0a4149690b4aa43a7581fc87353a01a9369db55688e6`. 앞선 불변 snapshot과 동일한9,224files는 hardlink로 재사용하고 변경파일은 독립복사하여 새 입력을 고정했다; 활성 checkout과hardlink하지 않았다. manifest와실행driver해시는 `native-r2-input.json`. 테스트fixture TEMP/TMP를 task-owned `artifacts/verification/AR-native-r2-temp`에 한정해 종료후 정리한다. parent_ 통과시에만 같은입력으로 root_resume 회귀를 이어간다. producer 실제exit와scope별결과는 `native-r2-result.json`/각scope로그, terminal work signal은 workId `21370c2a-db4e-43b4-87dc-f17fa4af6f7c`; root execsession82057. 최초확인시점은 시작10분 또는실제종료이며 컴파일예상과확정제한을구분한다.

자동 trigger mail은 suspended child를 자연 idle로 취급하지 않게 pending-work admission에 연결했다. 실제 새UserInput은 기존wait를 끝내고 정상새turn admission을 따른다. 자신도parent응답대기인nested parent에대한요청은 `parent_waiting_for_its_parent` delivery보류사유를남기고 native mail로누적하며 원래wait/task를침범하는새turn을만들지않는다. root-child 조기재개검증과이중대기한계는구분한다. actualtimer/배송ack/복구/실패/자동mail/명시userinput회귀는 새입력대상이다.

최초10분 확인: terminal signal은 running이며 producer pwsh PID46028가 실제 실행 중이다. r2 로그는 protocol/API/config 등 dependency compile 진행, causal error/종료 result는 아직없음. 다음확인은15분 또는실제종료신호. 변경 소유후보52경로는 `artifacts/logs/AR-01/owned-paths.txt`에 고정했으며 최종diff에서 다른작업과공유파일hunk를 다시확인한다. 공유 build tooling의 추가변경을 확인했지만 실행중r2 입력/driver는 갱신하지 않는다.

두번째예정확인: producer PID46028 실행중, 그하위cargo38104/rustc24396이 codex_core `--test` 실행파일을컴파일하는단계임을commandline으로확인했다. 새error/테스트결과/terminal신호는아직없다. 원래공유target의다른cargo는별도작업이며중복실행/종료하지않는다. 프로젝트에공통 Cargo driver가추가되어현재parent checker도해당helper를재사용하도록정리했다. helper/기존wrapper 소스검사26/26 exit0 (`cargo-driver-source.log`); 실행중r2driver는고정사본을그대로유지한다. 최종checker 실행근거는별도driver해시와동일검증입력으로구분한다. 다음확인은10분또는실제종료신호.


### r2 종료 분석과 r3 수정

r2 native compile 통과, 16:40:06–17:17:52 UTC(37분46초), 실제exit101: core parent_ 57pass/18fail. 실제 요청 wake 두 테스트는 SQLite CHECK에 parent_request가 없는 원인; 역사 migration을 변경하지 않고0066으로20열/기존행/두index를 보존해 확장했다. state 실제version65→현재runtime 업그레이드 회귀와 independent SQLite 검증을 추가했다. wait8테스트는 fixture가 최초Delivered로 생성해 Queued 초기불변식을 위반한 원인; production 동일Queued→배송전이로 고쳤다. 나머지8 기존회귀는 호스트 AZRAEL/CODEX 환경과 checkout 아래TEMP가 ancestor AGENTS를 읽는 영향이다. 제품검증불변식은 유지하고 테스트 child environment만격리하며 explicittask-owned 외부TEMP를 선택했다. 활성 사용자설정/세션은변경하지 않는다.

공통 Cargo helper 재사용 checker에 isolateHostEnvironment=true를 적용했다. 기존불변r2 입력의환경분리진단은로그 native-r2-isolated.log, 종료JSON native-r2-isolated-result.json; sharedCargo lock대기중이다. 새0066 LF속성/inventoryowner를반영했다. r3 guidance4/4, inspector20/20, instructions21files/10components 일치검사와inventory53features 모두exit0. 수정native/최종수용은아직미확인. 외부fixture C:/Users/felre/AppData/Local/Temp/azrael-AR-isolated-r2 및azrael-AR-native-r3는종료후소유경로를검증해일반삭제한다.


r2환경진단은다른작업의공유캐시lock에서대기하여시작되지않았으며, 확인한자체cargo PID44888만취소했다(진단exit-1/cancelled). r3수정검증과동일scope중복대기를제거했고다른작업프로세스는유지했다. r3input9,239files SHA256 1a9a7764be2e50f5d3e98257111e6e823eb137561a694d1f737e2b334c48d7e7;9235불변files재사용, 새driver/helper/producer해시 native-r3-input.json. parent_/root_resume checker 둘모두호스트env격리, 최종소스driver와고정driver해시일치. 시작2026-10-13T17:30:36.5104047UTC; producerPID56140/execsession15099, workId57a3ef65-d670-4ade-b502-74a38c4d4cbc. 최초확인10분또는terminal; 예상compile시간과확정제한구분. 부모root_resume회귀는parent_통과후동일입력으로진행한다.

진단종료r2의checkout내fixture와취소된환경진단외부fixture는경로/실행중참조를검증후일반삭제,두경로부재확인(`diagnosed-fixture-cleanup-r2.json`). scoped diff whitespace exit0, Cargo helper/wrapper26/26 exit0. 수정r3 native는sharedtargetlock대기중이며다음판단은실제testexit이다.

r3최초확인 2026-10-13T17:41:43.156796+00:00: terminal running. producer56140→node13856→rustup31828→cargo32004 실행중,로그는sharedtargetartifactlock 대기만있어테스트/compile은아직시작되지않았다. 다음확인15분또는실제terminal. 캐시점유작업을중복실행하거나종료하지않는다.

r3두번째확인 2026-10-13T17:57:21.010420+00:00: terminal running,캐시lock해제후skills/exec-server compile진행. producer56140 및cargo32004하위rustc34544 확인. 정확한lock해제시각은현재로그에서확정못하며시작부터이번확인사이에전이했다. 새causal error/testexit는없음. 다음확인15분또는terminal.

r3세번째확인 2026-10-13T18:12:58.800679+00:00: terminal running,codex_core --test rustc51532 컴파일진행. 기존unused warning출력이며causal compileerror/testresult는아직없음. 다음확인10분또는terminal.


### r3 종료 및 timer 보정

r3시작17:30:36–18:19:39UTC,49분02초(공유cache대기포함),exit101. coreparent_75대상67pass/8fail. 요청wake/prepare경쟁과wait재개/취소/복구/권한차이/실패/automaticmail·명시UserInput·native배송후resume 회귀통과. 실제timer회귀는relative sleep을watcher시작/SQL지연/알림처리때다시기준잡는원인; 실제parkInstant+60초 sleep_until, 이후실제checkpoint+300초deadline을알림동안유지하도록수정했고10/20/100초알림회귀추가. 테스트timerwheel2ms tick은pausedclock기준,DBduration상한과HTTP0확인유지. 아직수정timer native미검증.

7기존실패중V1/Disabled는committedconfig의 agents.enabled=true→V2강제선택,Guardian4개는committedprompts auto_review new(None) 정책과stale테스트불일치. 해당정책과테스트파일현재diff없음/HEAD정책일치로소스상선행문제확인; 실행baseline미증명/완료notification exact경로미확인. 앞선호스트환경원인추정은이7개에적용되지않아정정한다. broadparent_문자열로무관한테스트가선택되어checker는기능소유parent_request/parent_response_wait union필터로제한(실행파일list로core22대상확인). root_resume별도회귀는유지. 원래r3입력의state/protocol/prompts 및root_resume누락검사를별도실행,로그parent-store-r3.log/root-resume-r3.log 및native-r3-remaining-result.json,workId41078c77-9005-4bb2-975f-31ce0fe61390/exec80243.

추가문안: 부모→자식 후속지시/질문/수정도현재관련사항을묶고수시의작은요청을줄이되현재blocker·확인오류전달은늦추지않음을delegation원본과활성설치사본에명시했다. instruction등록지문갱신/설치바이트일치/import검사exit0. r4는기존r3불변입력에waittimer파일만교체한새9,239files입력이며현재다른작업소스변경을따라가지않는다. 고정driver는기능필터union, root_resume별도검사. 시작전에r3잔여검사를마쳐공유cache에서입력전환경쟁을피한다.

r3 잔여검사18:23:32–18:33:45UTC,exit0. parent_request filter: prompts1/state5pass(실제version65upgrade포함);protocol0선택/컴파일확인. root_resume:core26/protocol4/state8=38pass,exit0(229.87s core실행). 로그parent-store-r3.log/root-resume-r3.log. r3진단fixture두외부경로정상삭제부재확인, cleanup-r3 JSON. r4입력SHA256 f0f3562966a389fac16ec0880e91dca1cc2feda77ac35923f21a9dd305b4d72b,driver지문 native-r4-input.json;시작2026-10-13T18:34:50.3831630+00:00,producerPID39860/exec25487,workId593065fe-467e-43a8-9768-96722ce40052. 먼저기능22core+state/prompts union검사,통과후root_resume. 최초확인10분또는terminal. 다른타겟/installedlive수용은여전히별도.

r4최초확인 2026-10-13T18:45:01.255321+00:00: terminal running,producer39860 하위rustc30360 codex_mcp컴파일중. 로그에새error/testresult없음. 다음확인15분또는실제terminal.

r4두번째확인 2026-10-13T19:00:40.789111+00:00: terminal running,producer39860 실행중,codex_core rustc56800(PPID21536) 컴파일진행. 기존unused warning있으며error/testresult아직없음. 다음확인10분또는terminal.


### r4 기능 필터 결과

r4 18:34:50–19:03:28UTC,28분38초,exit101. core22개중21pass/1fail. 수정된actualtimer의60/300초DBcheckpoint와알림뒤deadline보존검증은통과하고 마지막mockserver 전체HTTP0assert에서실패. 받은HTTP가metadata/prewarm인지실제inference인지현재메시지에method/path가없어아직단정못함. 원래waitmodule담당자가fixture/background요청경로및pending응답guard를좁혀조사중. 최종feature검증/commit미완료. 기존r3root_resume38pass와현재수정input수용을구분한다.

r4HTTP실패진단: fixture의provider model manager/fullturn modelresolve→GET/models catalog 경로가소스에있고mock이그경로를허용한다. 실제r4route는출력되지않아확정못한다. r5는fixture완료직후method/path baseline을수집하여GET*/models만허용(추론POST baseline거부),실제checkpoint후전체HTTP목록과동일함을검사해추가HTTP0을유지한다. bounded8 routes만 --nocapture 로그에남기며body/private입력을복제하지않는다. productiontimer동작은r4와동일,fixture/검사증거보완만새입력.

r5inputSHA256 ae07a0e95e77ccb104a8d4776f2b9c71bebca789918c4eaa1456ca5d02952fd1,9,239files,drivermanifest native-r5-input.json. 시작2026-10-13T19:11:16.4562891+00:00,producerPID20624,workIde4a548be-a115-43d0-bcbf-820685b3e388. 기능union22core+state/prompts/nativeDTO compile,통과뒤같은입력root_resume회귀. 최초확인10분또는terminal. scopedwhitespace/import검사exit0.

r5최초확인 2026-10-13T19:21:48.599872+00:00: terminal running,producer20624 실행중. 로그의실제컴파일/오류유무를확인하며다음확인15분또는terminal.


### r5 실제 HTTP 경로 판별

r5 19:11:16–19:30:52UTC,19분35초,exit101. core21/22pass,baseline초기화검증에서GET /v1/responses 실제관찰. 요청은timer진입이전fixture준비에서발생했고모델catalogGET추정은해당실패의원인이아니므로정정한다. 정확한WebSocket초기연결경로/헤더/추론요청과구분을담당자가확인중이다. baseline의추론허용은추가하지않는다. raw본문없이method/path만로그 native-r5.log에보존했다. 현재productiontimer변경은없고fixture조건이마지막필수native수용을막고있다. 운영문서checker필터는union/host환경격리와현재HTTP증거검증에맞췄다.

정정과r6: GET /v1/responses는Session::new→schedule_startup_prewarm→client.prewarm_websocket→WebSocket into_client_request의초기연결경로와일치. fixture가실제take_session_startup_prewarm/abort(join) API로해당백그라운드작업종료를확인한후setupGETresponses는Upgrade:websocket/Connection:upgrade/emptybody를모두검증한다. HTTP-only mock은WSupgrade/frame을처리못하며추론POST를허용하지않는다. 기존MockServer.reset으로완료setuptraffic/mocks를비운후실제timerHTTP0을다시요구. productiontimer동작은r4이후변경없음. r4/r5임시fixture두경로일반삭제부재확인(`diagnosed-fixture-cleanup-r4-r5.json`).

r6inputSHA256 2b6513eac58c11a475a7badbba65d4c67ffcaea434496743f12856342d3d8b8a,9239files,drivermanifest native-r6-input.json. 시작2026-10-13T19:37:55.7141653+00:00,producerPID46748/execsession37506,workIdb8bd0517-dc12-4828-9e6e-a8f47f1b8e38. 동일기능union와통과후root_resume회귀,최초확인10분또는terminal.

r6최초확인 2026-10-13T19:47:28.807567+00:00: terminal running,producer46748 실행중,새causal error/testexit없음. 다음확인15분또는terminal.


## 최종 검증과 수용

r6 2026-10-13T19:37:55.7141653+00:00–2026-10-13T19:59:51.5495858+00:00UTC,21분55초,최종producer와두scope모두실제exit0. parent_request/parent_response_wait:core22+prompts1+state5=28pass,protocol은0선택/컴파일확인. root_resume:core26+protocol4+state8=38pass. stateupgrade가두scope에중복포함되어총66실행/65고유test다. 로그native-r6.log/root-resume-r6.log와native-r6-result.json. 실제timer준비GET /v1/responses의Upgrade=websocket/Connection업그레이드=true/bodyempty=true를기록했고,prewarm취소join/reset뒤60/300초·반복알림·DB지속시간·추가HTTP0/부모요청Pending/모델task없음검증모두통과. 가짜600초prepare는blocked시간에미포함.

Windows x64 MSVC nativefixture범위수용. 현재기능소유engine40파일과최종checker/helper의해시가검증된r6입력과일치(`final-input-match.json`);실행중추가변경없음. guidance4/4,inspector20/20,Cargo helper/wrappers26/26,installedinstruction21files/10components일치검사exit0근거재사용. featureinventory53features와hook/store/wake owners보완후validateexit0,운영·구조문서native상태갱신. 최종fixture외부경로일반삭제부재확인(`final-fixture-cleanup.json`);r2–r5진단fixture도종료후삭제완료. 고정source입력/작은해시영수증/로그는출처근거로유지하며sharedtarget/다른작업cache·사용자데이터를정리하지않는다.

계약수용: 일반보고누적,즉시parent_request조기재개,requestkey멱등,동일childtask 비종료대기/응답native출처,명시cancel/defer와pending재대기금지,UTC/monotonic분리자동로그,알림으로늦춰지지않는60/300checkpoint,권한·작업변경·재시작보호,관련요청묶음지침. 앱전체build/package/install/publish/live모델호출과다른OS수용은수행하지않았다. nestedparent자체응답대기보류한계와자동timeout/승인없음은구조문서에명시. broadparent_가선택한기존7회귀불일치는이번범위밖에별도기록했고전체회귀통과를주장하지않는다. 최종변경분리/whitespace와taskcommit확인후완료한다.

최종변경분리확인: 기존staged파일0,이번task54경로만stage,범위밖index0,staged/scoped whitespace exit0. 구현·필수fixture검증·지침활성사본동기화·진단fixture정리수용완료. taskcommit결과는Git기록및artifacts/logs/AR-01/task-commit.json에보존한다. 원격push/배포/앱설치는수행하지않는다.

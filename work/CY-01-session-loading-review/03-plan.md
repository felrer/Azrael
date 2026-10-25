상태: 후속 분석 완료. 추가 최적화의 구현은 아직 요청되지 않았으며, 아래 우선순위와 보존 조건을 제안한다.

# 세션 복원 추가 최적화 분석

## 목표·권한·범위

사용자는 최신 버전에서 앞선 최적화가 정상 동작함을 확인했고, 추가 속도 개선 방향의 분석을 요청했다. 이번 산출물은 현재 코드와 기존 측정에 근거한 제안이다. 제품 코드 변경·build·설치·원본 세션 실행·새 성능 실험은 수행하지 않는다. 기존 질문·승인·accepted input·권한·중복 실행 방지 의미는 보존한다.

공통 설계 대상은 Windows x64·glibc Linux x64·macOS ARM64다. 이번 확인은 Windows의 현재 checkout에 대한 정적 분석이며, 실제 실행 시간 근거는 [기존 격리 실험](02-measurement-evidence.json)에 한정한다. 현재 HEAD는 `47cdcfbb`이고 공유 checkout에는 다른 작업의 변경이 있다. 설치본과 현재 checkout의 정확한 일치는 이번에 검증하지 않았다. 사용자 확인은 최신 버전의 정상 동작에 대한 증거이며 추가 개선 폭의 계측값은 아니다.

## 확인한 사실

- [현재 복원 coordinator](../../engine/codex-rs/core/src/session/history_restore.rs)는 질문과 승인을 동일한 전체 rollout 읽기 결과로 복원한다. 중복 전체 파싱은 제거됐지만 전체 읽기 1회는 남는다.
- [전체 로더](../../engine/codex-rs/rollout/src/recorder.rs)의 `load_rollout_items`는 모든 JSONL 행을 `serde_json::Value`로 읽고 canonical decoder로 typed `RolloutItem`을 구성해 전체 `Vec`에 보관한다. [decoder](../../engine/codex-rs/rollout/src/lib.rs)는 JSON/Serde 호환 문제를 해결하는 의도적인 경계이므로 단순 교체의 동등성이 보장되지는 않는다.
- 질문 복원은 관련 event와 답변 metadata를, 승인 복원은 `HostApprovalLedgerUpdated`를 소비한다. 필요한 최종 상태보다 큰 전체 기록을 구체화한다. 이후 accepted input의 DB receipt 조정이 필요하다. 질문의 answered/superseded 정보 등은 단순히 pending 항목만 저장해서 대체할 수 없다.
- [모델 문맥 로더](../../engine/codex-rs/thread-store/src/local/model_context.rs)는 paginated 기록에 대해 최신 유효 compaction 경계까지만 역방향으로 읽는다. 이전 실험에서도 약 0.11~0.18초였다. 이 bounded 문맥만 질문·승인 복원에 넘기면 compaction 이전 상태를 잃을 수 있다.
- [읽기 worker](../../engine/codex-rs/rollout/src/compression/blocking_reader.rs)는 이미 스캔을 단일 blocking worker에서 수행한다. 단순한 spawn_blocking 추가는 새로운 핵심 개선이 아니다.
- [기존 read metrics](../../engine/codex-rs/rollout/src/compression/read_metrics.rs)는 caller processing을 제외한다고 명시한다. 읽기 duration만 보고 JSON 파싱과 객체 구성 비용까지 빠르다고 판단하면 안 된다.
- [thread history projection](../../engine/codex-rs/thread-store/src/local/thread_history.rs)에는 byte offset·ordinal·projection version과 트랜잭션 checkpoint 비교가 있다. 최근 대화 표시용 파생 저장소가 있지만, 현재 질문·승인 복원의 검증된 체크포인트를 제공하는 계약은 아니다. 표시 projection은 skipped ordinal도 표현하므로 cursor가 끝까지 갔다는 사실만으로 strict restoration 검증을 대체할 수 없다.
- [warm resume accepted input 복구](../../engine/codex-rs/core/src/session/accepted_user_inputs.rs)는 pending receipt가 있을 때 rollout을 다시 읽는다. 일반 cold resume에서 항상 발생하는 추가 파싱으로 간주하지 말고, 해당 조건의 별도 성능 회귀를 측정해야 한다.

기존 약 360MB·133,999행 fixture에서 전체 파싱 1회는 15.7~17.8초, 기존 cold resume은 36.6~42.9초였다. 최근 turns/items 조회는 수~수십 ms였다. 이 값은 이전 계측용 실행 파일과 당시 projection 상태의 결과이며 최신 제품의 현재 지연이나 개선 가능 초수를 확정하지 않는다. 특히 최신 구현·빌드 최적화 수준·인증·MCP·파일 캐시 조건을 맞춘 재측정이 필요하다.

## 권고 우선순위

| 순서 | 제안 | 기대하는 효과 | 비용과 제약 |
| --- | --- | --- | --- |
| 0 | 최신 설치 버전의 단계별 기준 측정 | 남은 critical path를 확인하고 잘못된 최적화 방지 | 제품/엔진 식별자, 동일 fixture와 조건을 고정해야 함 |
| 1 | SQLite 기반 복원 상태 checkpoint + 이후 로그 증분 재생 | 정상적인 다음 cold resume을 전체 기록 길이 의존에서 벗어나게 함 | 일관성·손상·revert·fork·압축·schema version 설계와 검증 필요 |
| 2 | 최근 대화 선표시와 엔진 복원 진행 분리 | 실제 엔진 준비가 남아 있어도 읽을 수 있는 대화가 먼저 보임 | UI 의미 변화; projection catch-up 비용·snapshot revision·잠금 경합 확인 필요 |
| 3 | 전체 스캔 fallback을 streaming reducer로 변경 | 전체 Vec 메모리·해제·추가 순회 비용 감소 | 여전히 전체 로그를 읽고 canonical decode하면 O(전체 기록), 시간 개선 폭은 미측정 |
| 4 | 모델 목록·MCP·설정 등 독립 준비 경로 조정 | 전체 파싱을 줄인 뒤 드러나는 고정 시작 비용 개선 | 기존 병렬 초기화가 이미 있음. 필수 설정·권한·도구 준비를 무조건 생략하지 않음 |

가장 큰 실제 복원 시간 개선 후보는 1번이다. 체감 반응성은 2번을 함께 고려한다. SIMD JSON 라이브러리 교체나 두 consumer의 병렬화부터 시작할 근거는 부족하다. 현재 사용 중인 serde_json·SQLite·rollout reader·projection writer를 우선 재사용한다. RawValue 등 선택적 역직렬화는 allocation을 줄일 수 있는 후보지만 현재의 모든 행 유효성·legacy decoder 계약을 유지해야 하므로 profiling 뒤 별도 검토한다. 단순 문자열 검색으로 질문·승인 행만 고르는 방식은 제안하지 않는다.

## 1번의 구체적 설계 제안 — 아직 미구현

복원 상태와 검증된 처리 위치를 파생 데이터로 저장한다. 정상 복원은 `상태 checkpoint 읽기 + 검증된 위치 이후의 append 재생 + pending DB receipt 조정`으로 구성한다. 최신 상태가 이미 반영돼 있으면 전체 로그 재파싱이 필요하지 않다. 최종 상태 자체의 크기와 tail 길이에는 계속 비례한다.

- 저장 단위는 thread id뿐 아니라 실제 rollout/lineage identity, reducer/schema version, 검증된 byte offset·ordinal과 연결한다. SQLite 표시용 projection cursor를 그대로 신뢰하지 않는다.
- rollout의 durable append 확인 뒤 파생 상태와 checkpoint를 같은 DB transaction으로 갱신한다. 로그와 DB 사이 crash는 tail replay로 복구하며 reducer는 중복 적용에 안전해야 한다. 공통 상태 규칙을 저장소에 복제하지 않도록 reducer의 의존성 경계를 먼저 정한다.
- checkpoint 부재·불일치·손상·이전 버전은 검증된 전체 스캔으로 복구한다. 최초 전환이나 invalidation 뒤에는 전체 스캔 비용이 남는다. 원본 로그를 전환 작업으로 임의 수정하지 않는다.
- 검증된 prefix가 현재 source와 같은지 저장소의 writer ownership과 revision 규칙으로 확인한다. 기존 revision은 경로·크기·시간 및 Unix identity를 사용하므로 지속 checkpoint에 충분한지 따로 검토한다. 매 복원마다 전체 파일을 hash해 최적화를 상쇄하거나 길이만으로 오래된 상태를 승인해서는 안 된다.
- revert·rollout 교체·fork의 inherited prefix·압축/해제·외부 변경·잘린 마지막 행을 각각 처리한다. fork의 질문 의미와 승인 receipt 비상속을 유지한다. canonical 기록 손상을 숨겨 정상 복원으로 취급하지 않는다.
- 질문 답변·철회·supersession, 승인 pending/claimed/완료 상태 및 owner 검증, accepted input 재조정·재실행 방지를 보존한다. 파생 cache 자체가 새 권한을 부여하지 않는다.

## 2번의 사용자 경험 제안 — 별도 의미 변경

기존 paginated turn/item API로 최신 대화를 읽는 흐름을 엔진 attach와 분리할 수 있는지 먼저 확인한다. 일관된 표시 projection이 있으면 대화를 먼저 보여주고 기존 복원 진행 상태를 표시한다. 엔진·질문·승인·accepted input 상태가 확인되기 전에는 입력을 새 turn으로 전송하지 않는다. 초기 스크롤 위치, 선택한 thread 교체, live update 중복·순서, 오래된 async 응답 적용 방지를 검증한다. projection이 뒤처져 전체 catch-up이 필요한 경우에는 같은 속도를 보장하지 않는다. 이 방식만으로 실제 입력 가능 시각이 앞당겨졌다고 주장하지 않는다.

## 권장 실행·검증 순서

1. 최신 버전의 동일 세션 사본에서 cold engine과 warm engine을 구분해 기준선을 잡는다. OS 파일 캐시의 cold/warm도 엔진의 cold/warm과 별도로 기록한다. 원본 프로필을 사용하지 않고 자동 복구 부작용을 통제한다.
2. 전체 읽기/압축 해제, JSON 구문·typed decode, 객체 보관·해제, 질문·승인 reducer, pending DB receipt, model context, 모델/MCP 준비, host 응답·readback, webview 첫 표시를 구분한다. 입력 가능 시각과 첫 대화 표시 시각을 따로 측정한다. 스캔 횟수·읽은 bytes·snapshot hit/tail·peak memory도 기록한다. 겹치는 span은 더해서 총시간으로 보고하지 않는다.
3. checkpoint가 최신인 경우, 소량 tail, cache 없음/이전 버전, 손상·revert·fork·압축, pending receipt 존재를 비교한다. 기존 full replay와 최종 복원 상태를 differential 검증하고 crash 경계·동시 append를 검사한다.
4. 구현 범위가 정해지면 engine.recovery·engine.question-withdrawal·engine.window-approval·ui.paginated-history의 기존 소유자와 필수 검사를 연결한다. 공통 변경은 Windows 회귀를 포함하고 Linux/macOS 검증 상태를 분리한다. 제품 배포는 별도 수용 절차를 따른다.

아직 추가 구현은 승인되지 않았다. 권고 시작점은 **최신 버전 기준 측정 후 복원 상태 checkpoint 설계**다. 단기간의 체감 개선이 더 중요하면 최근 대화 선표시를 병행하되 입력 허용 의미를 먼저 합의한다. 수치 목표와 개선율은 최신 기준선 확보 후 정한다.

## 이번 분석의 완료 범위

현재 복원 coordinator·전체 parser·consumer·model context·projection·revision·reader metrics와 기존 측정 근거를 확인했다. 실제 제품/원본 세션은 실행하지 않았다. 코드·설치·런타임 데이터는 변경하지 않았고 이 후속 분석 문서만 추가했다. 새 성능 수치나 플랫폼 수용은 주장하지 않는다.

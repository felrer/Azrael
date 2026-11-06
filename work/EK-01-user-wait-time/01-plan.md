상태: 사용자 요청으로 일시 중지. 새 수정·검증·정리를 시작하지 않는다. 설치·배포는 수행하지 않았다.

# 사용자 응답 대기 시간 분리

## 목표와 권한

사용자 승인·입력을 기다리는 시간을 작업 시간에서 제외하고 승인 카드에 요청별 대기 시간을 표시한다. 사용자가 제안 범위의 구현을 승인했다. 필요한 검증을 수행하며 제품 빌드·설치는 진행하지 않는다. 기존 동시 변경은 보존한다.

## 승인된 범위

사용자가 아래 범위의 구현을 승인했다.

- 사용자 승인·동기 입력 때문에 실행이 멈춘 구간을 제외한다. 비동기 질문이 열려 있어도 모델·도구가 진행되는 시간은 포함한다. 승인과 다른 실행이 겹치는 경우 실행 여부를 구분한다.
- 승인 카드에 대기 중 `응답 대기 2분 13초`, 처리 후 `응답까지 2분 13초`를 표시한다. 거절·취소도 종료 경계에서 고정한다.
- 모델·도구·빌드·검사 및 기존 자동 재개 예약 대기는 포함한다. 자동 재개 대기까지 제외하면 기존 총 시간의 의미가 추가로 달라지므로 별도 범위 결정이 필요하다.
- 과거 기록에 대기 경계가 없으면 정확한 차감량을 추정하지 않는다. 미측정 기록의 구분 표시는 프로토콜 조사 후 확정한다.

## 확인한 현행 계약과 증거

[연속 작업 시간](../../docs/architecture/task-work-time.md)은 실행과 자동 재개 대기의 합집합이며 사용자 턴 사이 공백은 제외한다. 턴 내부 승인 대기는 엔진 계약을 따른다.

`docs/ops/development.md`가 기본 소스로 지정한 `engine/`를 조사했다. 실행 중 설치본의 identity는 확인하지 않았다. `engine/codex-rs/core/src/turn_timing.rs::complete_profile_and_duration_ms`와 `defer_timing`은 시작부터 완료/defer까지의 경과 시간을 계산하며 승인 대기 차감은 없다. `state/turn.rs`는 승인·권한·사용자 입력·elicitation 대기를 구분하고 `session/mod.rs`가 승인 등록·응답을 연결한다.

`scripts/task-work-time.cjs`는 종료 턴의 durationMs와 live 시작 시각 및 root resume 대기를 집계한다. `task-work-time-history.cjs`가 저장/live metadata를 결합한다. pinned UI는 `artifacts/upstream-ui/26.1007.21434`, 변환 통합 소유자는 `namespace-azrael-host.cjs`다. 일반 승인 카드 공통 renderer, 저장/reconnect metadata, 모든 대기 종료 경로와 병렬 실행 판정은 구현 준비 때 추가 조사해야 한다.

## 범위와 접근

플랫폼 공통 의미로 Windows x64, Linux x64/glibc, macOS ARM64의 로컬 VS Code를 대상으로 한다. 실제 조사 환경은 Windows다. 원격·컨테이너 지원 확대는 제외한다.

root가 조사·계약·구현·통합 검증을 소유한다. 구현 권한과 범위 확정 후 기존 시간 및 승인 이벤트/영속화/projection을 재사용해 경과 시간과 사용자 대기를 구분한다. 중첩 구간은 중복 차감하지 않는다. 엔진의 요청 ID·시작/종료 경계를 카드와 live/history 시간이 함께 소비하도록 한다. 실제 사용자 대기와 자동 승인 리뷰어 실행을 구분한다. 재연결·취소·중단을 포함한다.

엔진 상태와 wire 계약 확정이 UI 연결의 선행 조건이다. UI 변경 전 설치된 UI 지침과 프로젝트 UI 계약을 읽는다. 승인된 동작에 맞춰 task-work-time/UI owning 계약과 feature inventory를 갱신한다. 설치·배포는 별도 권한이다.

## 성공 기준과 검증 제안

`testing` 스킬을 적용해 기존 검사에 필요한 사례를 확장한다. 검사는 아직 실행하지 않았다.

- 승인 대기만 차감하고 모델·도구 실행을 유지: 엔진 통제 시계와 승인 lifecycle 검사.
- 중첩 대기를 한 번만 차감하고 비동기 질문/병렬 실행을 잘못 멈추지 않음: 엔진 회귀 검사.
- 응답·거절·취소·중단·재연결 후 일관된 값과 과거 미측정 구분: 저장/replay 및 wire/live 검사.
- 단일 턴과 연속 총계의 의미 일치: 기존 test-task-work-time.cjs, test-task-work-time-history.cjs, test-task-work-time-ui.cjs 및 native 시간 검사 재사용·확장.
- 카드 시간 갱신과 종료 후 고정, 밝은/어두운 테마·좁은 폭: pinned React 렌더 및 상호작용 검사.
- Windows 회귀는 필수로 선택한다. Linux/macOS·패키지·설치본 수용은 실제 실행한 범위만 보고한다.

## 산출물과 정리

이 계획과 `verification.json`은 유지 작업 문서·최소 검증 근거다. 제품 소스를 변경했으며 제품 빌드·설치는 수행하지 않는다. 계획 배치용 임시 본문은 일반 삭제 후 부재를 확인했다. 생성된 테스트 프로필·소스 복사본·검증 target·원시 로그는 해당 소유자로 정리한다.

## 구현과 검증 진행

- root는 계약·통합·최종 검증을 소유한다. 순수 native 시간 모델, 저장/wire, runtime, UI, JS 집계를 파일 소유권으로 분담한다. 공통 의미는 앞 절의 승인 범위를 따른다.
- `Turn.userWaitTiming`은 원래 `durationMs`와 별개인 revision 기반 snapshot이다. 요청별 원시 대기와 실제 차감할 `blockedIntervals`를 구분하며, absent는 과거 미측정이고 빈 snapshot은 측정된 무대기다.
- 저장은 durable `UserWaitTimingUpdated` 이벤트와 신규 nullable JSON 열 migration `0012_user_wait_timing.sql`을 사용한다. 기존 SQL bytes는 변경하지 않는다. metadata-only/full/history/live가 같은 snapshot을 전달한다.
- JS 집계·history·독립 직렬화 검사와 native 순수 모델의 중첩·동시 활동·종료 고정 검사를 확장했다. 아래의 최종 검증 범위와 결과를 기준으로 수용한다.
- metadata owner의 Rust parser/rustfmt, schema JSON 참조 및 SQLite 신규 migration·revision 갱신 검사가 exit 0이다. 실제 프로토콜 `user_wait` 테스트 3개와 저장소 테스트 1개도 exit 0이다. 공식 stable/experimental schema export를 반영했으며 1,143개 생성 파일의 byte 일치를 확인했다. 자세한 고정 입력과 실행 근거는 `native-verification.json`이 소유한다.
- 최초 native 검증은 다른 작업의 공용 target 점유로 전용 target을 사용했다. 이후 공용 `engine/codex-rs/target`의 owner 부재와 가용 메모리 약 10 GiB를 확인했다. runtime owner가 최종 소스의 별도 고정 복사본으로 core/MCP 검증을 맡고, 공용 target lease를 재확인·획득해 jobs 1로 실행한다. 저장소 jobs 2와 target을 공유하지 않는다. 기존 lease를 변경하거나 프로세스를 종료하지 않는다.
- UI 렌더링 계획 출력은 `scripts/verify-user-wait-time-render.mjs`의 artifact-run 소유 run별 temporary/logs다. 실행 직전 실제 경계·소유권을 기록하고 사용이 끝나면 owner 기반으로 정리한다.
- 관련 소스 검사 110개가 Windows에서 exit 0이다. 승인 카드 렌더링 13항목과 연속 시간 렌더링 82항목도 exit 0이며, 모든 테스트 브라우저 트리의 종료가 확인됐다. 완료된 턴에서 유지된 셀이 새 승인을 요청하는 경우 원시 요청만 추가하고 작업 구간은 고정하는 검사를 포함한다. 필요한 결과는 `verification.json`에 보존한다.
- 신규 native 검증 recipe 선택 검사는 exit 0이다. 추가로 시도한 전체 recipe 검사에는 기존 deletion-approval wrapper의 source hash 불일치 두 건이 있어 exit 1이었다. 관련 없는 wrapper/승인 정책은 변경하지 않았다.
- 별도 native 검증 run `run:EK01-user-wait-native:protocol01`은 고정 소스(10,866개 파일, 192,255,125 bytes, SHA256 `246c9429313df85c89026bb2b5123bccb8395ce6892e2a35a4ec087b796c55e1`)로 프로토콜·저장소 검사를 완료했다. Rust 1.95.0/MSVC, jobs 2와 전용 `temporary/target`을 사용했다. 이 복사본의 기존 SOURCE 영수증에 대해 제품 provenance를 주장하지 않는다. 검증 근거 이관 후 전용 target과 복사본은 정리 중이다.
- core01의 MCP 기존 콜백 연결 오류를 수정했다. core02의 core `user_wait`·`turn_timing`·MCP `elicitation`은 비영 선택과 실제 실행 exit 0을 확인했다. 선택 수 12/16/29를 실제 통과 요약 수로 취급하지 않는다. controller는 catalog 잠금 충돌로 종료 1이며, 검사 결과와 구분해 `core-verification.json`에 보존한다. 완료 후 새 요청의 원시 대기를 기록하는 보완은 별도 최종 고정 소스 검증 대상이다.

## 일시 중지 시점

- 사용자 요청에 따라 새 작업과 자동 재시도를 중지했다. 재개 요청 전에는 진행하지 않는다.
- 최종 결합 입력은 `artifacts/tasks/EK01-user-wait-native/runs/final01/inputs/engine`, SHA256 `6400ac51435342ca567b0829e99dcf4a54f5b08164e8161366acc5668bdc5612`이다. 부모·하위 에이전트 사용자 대기 전파와 테스트 입력 보완을 포함한다. 다른 EN-02 실행의 공용 target 점유로 최종 Cargo는 시작되지 않았다. 최종 검증은 미완료다.
- JS 110개와 기존 렌더 검증은 통과했다. 이전 고정 입력의 core/MCP 60개와 앱 서버 8개 통과는 각 입력 범위의 근거이며, 최종 결합 소스의 전체 통과로 취급하지 않는다. 필요한 근거는 별도 불변 JSON에 보존했다.
- 앞선 임시 run 9개는 삭제·finalize를 확인했다. 추가 정리 대상 `core03`, `downstream01`, `downstream02`는 보존 중이다. 중지 시점 session88358/controller34748의 마지막 `core03` 등록(maintenance_owner28088)은 이미 진행 중이며 종료 결과가 확인되지 않았다. 후속 review·삭제·finalize는 시작하지 않는다. 재개 시 실제 종료·예약·소유 상태부터 확인한다.

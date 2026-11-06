상태: 구현·자동 검증 완료. 공유 카탈로그 잠금으로 정리 일부 실패, 잔여물 임시 보관 승인 대기.

# 서버 실제 모드 기반 TPS 그래프

## 승인 범위와 계약

- 사용자는 측정 개선 중 실제 적용 모드로만 그래프를 표시하는 변경을 승인했다. 요청 TPS 계산·레이아웃·토글·추가 비교 조건은 변경하지 않는다.
- 서버 완료 응답의 service_tier만 모드의 근거로 사용한다. default/standard는 Standard, priority/fast는 Fast, ultrafast는 Ultrafast다. 누락/null/알 수 없는 값은 미확인으로 표시하고 모드별 평균에서 제외한다.
- 기존 기록의 mode는 선택값이므로 실제 적용 근거로 승격하지 않는다. 새 샘플은 actualMode를 저장하고 기존 mode는 읽기 시 버려 시간·토큰·곡선은 보존한다. 기존 대화 데이터 자체를 수정하지 않는다.
- 공통 Windows x64/Linux x64/macOS ARM64 소스 계약이다. 실제 실행 검증은 Windows에서 수행하며 타 OS·실계정·설치본 수용은 구분한다. 빌드·배포·설치 요청은 없다.

## 소유권과 순서

- root: 요구사항/문서, ResponsePerformance 집계와 turn 연결, UI 입력 필드·기존 회귀 검사, 스키마/SDK 연결, 최종 검증·정리·작업 커밋.
- server_tier_transport: ResponseEvent::Completed.service_tier 및 SSE 파서, 관련 생산자/전달 경로와 기존 SSE 테스트. 선택값으로 fallback하지 않으며 root 소유 turn/timing/protocol 파일은 수정하지 않는다.
- 전송 경계 구현과 root 집계/UI 작업은 병렬 진행한다. 완성 소스를 고정한 후 관련 Rust·UI 계약을 검사한다. 작업 공간의 기존 staged/unstaged 변경을 보존한다.

## 재사용과 검증

- 기존 완료 이벤트, bounded 분별 집계·rollout/replay, 기존 미확인 색상·레이블 및 평균 제외 처리를 재사용한다. 새 의존성·설정·추가 지표는 만들지 않는다.
- 요청 모드와 다른 서버 모드 전달, 누락/null/미지원 tier, 과거 선택 mode의 미확인 처리, actualMode에 따른 점/평균/이력·복원, TPS 분모 유지가 검증 기준이다.
- 기존 SSE tests, protocol response_performance, core turn_timing 및 UI provider-context 검사를 확장·선택한다. 파생 스키마/SDK 일치와 feature inventory를 확인한다.
- 제품 검증용 컴파일은 고정 입력과 기존 Cargo owner/cache를 사용한다. 생성물은 기존 lifecycle owner로 기록하고 사용 종료 후 정리한다. 최종 결과·실제 종료 코드·검증 한계와 작업 commit을 이 문서에 기록한다.

## 구현 및 현재 검증

- 완료 이벤트에 optional service_tier를 추가하여 SSE 완료 원문에서 받고, core forwarding을 거쳐 TPS guard 완료 시 모드를 결정한다. 지원 정보가 없는 다른 provider는 None이며 요청 tier로 대체하지 않는다.
- 실제 모드는 새 actualMode 필드로 저장한다. 기존 mode는 무시하며, 같은 분의 과거 선택 모드가 미확인으로 합쳐지는 경우 UI에서 토큰·시간을 합산하여 그래프를 보존한다.
- 생성 계약은 ResponseMinuteSample의 TS·공개 JSON 4개·stable/experimental precomputed와 Python SDK를 동기화했다. 담당자의 13개 JSON 정의/TS parity, Python AST/Pydantic 왕복 검사는 통과했다. Python313의 생성 의존성 누락은 기존 SDK .venv를 사용해 해결했다. 기존 generate_v2_all을 임시 출력에 실행한 결과 ResponseMinuteSample 클래스가 체크인 코드와 정확히 일치했으며(exit 0), SDK 원본 해시는 유지하고 임시 출력을 삭제 확인했다. Rust schema fixture 4개 및 actualMode 왕복 1개도 최종 실행에서 exit 0으로 통과했다.
- Windows UI 회귀 59/59, preflight recipe 16/16은 exit 0. project_tests의 첫 실행은 timeout exit 124/producer_completed였으며 성공으로 간주하지 않았다. 동일 명령을 lifecycle owner 아래 CLI로 실행해 통과했다.
- 실제 렌더의 추가 테스트에서 selector 따옴표와 memoization을 고려한 fixture snapshot 교체를 보완했다. 관리 잠금으로 차단된 실행은 실패로 보존했다. 최종 Windows native React/CSS 검증은 93/93 exit 0이다. 밝음/어두움·1000/474/360px·실제 모드 우선·과거 선택값 미확인·평균 토글/키보드·기존 압축 동작을 확인했다. root는 dark360/light1000 이미지를 확인했다. browserExit는 confirmed=true, exit 0, 남은 관련 프로세스 0이다. 최종 run은 verify-context-compaction-render/20261029T062100464Z-6015f8a5-e962-4864-a8cb-9d133506823e다.
- native 입력은 2026-10-29 14:57 Asia/Seoul에 생성한 단일 frozen engine(9,342 files, SHA256 bfe247392edf0bc81fb2fd7d5b6c4156871b54c20dbdcffb0ff01f32d02b054b)을 사용한다. protocol→api→core→appserver를 기존 target owner로 순차 실행하며 프로필/캐시를 중복 생성하지 않는다. 첫 컴파일 확인 시점은 5분으로 잡고, 실제 종료 결과를 확인한 뒤 추가 schema/forwarding 검증 여부를 결정한다.
- 구현과 검증에는 implementation/testing, 계약 문서 정리에는 design-documentation을 적용한다. 설치·실계정·Linux/macOS 실행 검증은 하지 않았다.
- protocol 집계 8개(비용 probe 1개 ignored), API tier 파싱 1개 및 SSE 왕복 1개, core timing 17개와 fork 1개는 각 exit 0이다. 각 wrapper는 type-check/비어 있지 않은 테스트 선택/실제 실행을 통과했다. core 단계는 15:02:53–15:30:40 Asia/Seoul였으며 타입 검사 6분 29초와 테스트 바이너리 컴파일을 포함한다. appserver 첫 실행은 이전 필드 mode를 기대하는 단일 assertion에서 exit 101로 실패했다. 이를 actualMode로 전환하고 과거 필드 부재와 history actualMode도 확인하도록 보완했다.
- UI run 등록·정리 검토는 기존 standalone identity(9bc66314681460df3d6da3a9dc923eac52411e22d1fb595b08371477ac492a26) 및 acceptance hash를 확인해 시작했으나, 다른 writer의 OS 파일 잠금 오류 33 및 maintenance.lock으로 등록이 차단됐다. 잠금을 우회하지 않고 fresh 등록·review로 재개한다. 종료 기록이 막혔던 render-command run은 실제 wrapper/child exit 1 및 브라우저 시작 전 실패 근거로 owner close를 완료했으며 failure와 완전 membership을 보존했다.
- 커밋은 기존 staged 변경과 공유 파일의 무관한 변경을 보존하도록 임시 index를 사용해 이 작업 hunk만 묶는다. 임시 제어 파일 work/EN-01-ultrafast-tps-diagnosis/commit.index 및 cleanup-request.json은 사용 종료 직후 일반 삭제와 부재 확인을 한다.
- 기존 SDK -text/CRLF 속성을 유지하고, precomputed는 owner의 Zstd level 19로 인코딩했다. 고정 입력의 압축본과 최종 파일은 압축 해제 바이트가 같음을 확인했다. 이 재인코딩은 native가 소비 중인 고정 입력을 변경하지 않는다.
- 최종 native run은 EN-02-actual-tps-final-native/20261029T063739889Z-74989138-d773-470b-b1be-35ed22772729다. 전달 경로 검사는 기존 고정 입력으로 1/1 exit 0이었다. 새 appserver 입력은 첫 고정 입력에서 테스트 assertion과 동등한 level19 압축만 반영한 04f05d42128ca80c03c66c5da0492c5fb5f09fbe23f9296f8bb2c39f94befc31이며, appserver actualMode 왕복 1개와 schema_fixtures_tests 4개가 2026-10-29 15:43:31 Asia/Seoul에 exit 0으로 완료됐다. 이전 고정 입력의 typed execution 참조는 최종 producer 종료 시 owner가 해제했다. 변경 없는 core 집계와 API 결과는 재사용한다.
- 보존 검사에 core forwarding과 schema fixture를 연결하고 기존 recipe 기대 목록도 확장했다. 최종 recipe 검사 16/16 exit 0이다. 첫 실행의 이전 기대 목록 불일치는 실패로 남기고 수정 후 재검증했다.
- UI group은 native 등록됐지만 review가 producer membership source를 OS 잠금 오류 33으로 읽지 못해 보호됐다. 삭제를 시도하거나 별도 scan으로 우회하지 않았다. 모든 producer 종료 후 current protection refresh와 fresh review를 사용한다.

## 최종 검증과 정리

- Windows x64에서 native 34개, UI 회귀 59개, native React/CSS 렌더 93개, Cargo recipe 16개가 통과했다(각 최종 명령 exit 0). native의 기존 비용 probe와 schema 쓰기 generator는 원래 ignored인 상태를 유지했다.
- 최초 appserver 테스트의 이전 mode assertion 실패(exit 101)는 actualMode assertion으로 수정 후 재실행하여 해결했다. 실패 기록을 성공으로 바꾸지 않고 최종 성공 결과와 구분했다.
- SDK 기존 .venv 생성 결과, 13개 JSON 정의와 TS export parity, AST/Pydantic 왕복이 통과했다. 최종 frozen source와 영향받은 Rust 13개 파일의 의미가 같음을 확인했다(12개 byte 일치, thread.rs는 줄바꿈 표현만 다름).
- 검증 명령/범위: check-response-tps-native의 protocol/api/core/appserver scope, test-provider-context, test-cargo-preflight-recipes, verify-context-compaction-render. 실행별 입력과 결과는 위 run identity와 SHA256로 식별한다.
- 설치·패키징·배포 및 실계정 서버 응답 수용, Linux/macOS 실행은 수행하지 않았다. 기존 TPS 분모와 UI 구조를 유지한다.
- 사용 종료된 run 9개를 지원되는 maintenance owner로 정리 중이다. 잠금 충돌로 남은 등록 예약은 실제 종료한 명령의 증거를 사용해 recover_reservation으로 복구했다. 복구 증거 artifacts/maintenance/evidence/en02-registration-reservation-38944.json과 owner 복구 receipt는 보호된 유지보수 제어 기록이다.

### 실제 정리 결과와 잔여 범위

- pinned standalone의 fresh review에서 8개 항목 모두 blockers=[]였으나 apply는 OS 파일 잠금 오류 33으로 exit 1에 종료됐다(root exec 89474, 출력 e3064d). 2개 경로의 실제 부재와 6개 잔여 경로를 확인했다. 전체 성공으로 보고하지 않았다. manifest.pending은 없다.
- 중단된 apply의 8개 예약은 PID 24592의 정확한 완료 기록에 근거해 recover_reservation을 시도했으나 catalog.lock 점유로 거절됐다. 보호 예약·레지스트리를 수동 수정하지 않았다. 재개 조건은 지원되는 owner가 카탈로그 잠금을 획득하는 것이다. 예약 복구 후 부재 항목을 reconcile/finalize하고, 남은 항목은 fresh review/apply와 실제 부재 확인 후 finalize한다.
- 보관 승인 질문은 아래 남은 7개 실행 묶음에 한정한다. 목적은 실패한 정리의 안전한 재개이며, 변경한 앱의 수동 수용을 위한 보관은 아니다. 확인된 6개는 등록 당시 합계 157229487 bytes(약 150MiB), 마지막 미등록 묶음은 크기 미확인이다. 재귀 재측정을 반복하지 않았다. 보호된 복구 증거/receipt와 예약은 기존 maintenance owner의 제어 정보로 남긴다. 임시 index/request/review 제어 파일은 사용 종료 후 별도로 삭제한다.

| 그룹 | 실제 경로 | 등록 당시 bytes / 상태 |
| --- | --- | --- |
| run:EN-02-actual-tps-native:20261029T055702611Z-1140999b-c3fc-442f-9bf0-11172277aeec | `artifacts/tasks/EN-02-actual-tps-native/runs/20261029T055702611Z-1140999b-c3fc-442f-9bf0-11172277aeec` | 101688635 / 삭제 확인 |
| run:verify-context-compaction-render:20261029T055812010Z-bd7afc5e-2d00-4ea3-ba85-36272c8d2899 | `artifacts/tasks/verify-context-compaction-render/runs/20261029T055812010Z-bd7afc5e-2d00-4ea3-ba85-36272c8d2899` | 55204235 / 삭제 확인 |
| run:EN-02-actual-tps-render-command:20261029T055803022Z-7ce3f550-d6a4-4802-8bf3-0557745f9815 | `artifacts/tasks/EN-02-actual-tps-render-command/runs/20261029T055803022Z-7ce3f550-d6a4-4802-8bf3-0557745f9815` | 3685 / 잔여 |
| run:EN-02-actual-tps-final-native:20261029T063739889Z-74989138-d773-470b-b1be-35ed22772729 | `artifacts/tasks/EN-02-actual-tps-final-native/runs/20261029T063739889Z-74989138-d773-470b-b1be-35ed22772729` | 101279199 / 잔여 |
| run:verify-context-compaction-render:20261029T062100464Z-6015f8a5-e962-4864-a8cb-9d133506823e | `artifacts/tasks/verify-context-compaction-render/runs/20261029T062100464Z-6015f8a5-e962-4864-a8cb-9d133506823e` | 55933317 / 잔여 |
| run:EN-02-actual-tps-ui:20261029T055556323Z-7b1f25a3-1c0a-4ac2-816a-81fb2e1cd78b | `artifacts/tasks/EN-02-actual-tps-ui/runs/20261029T055556323Z-7b1f25a3-1c0a-4ac2-816a-81fb2e1cd78b` | 8623 / 잔여 |
| run:EN-02-actual-tps-render-command:20261029T060132135Z-3e128c19-153e-4b3c-a323-cfc873b68466 | `artifacts/tasks/EN-02-actual-tps-render-command/runs/20261029T060132135Z-3e128c19-153e-4b3c-a323-cfc873b68466` | 1508 / 잔여 |
| run:EN-02-actual-tps-render-command:20261029T055926481Z-db175798-9fbe-44be-86fa-ceccfee619d0 | `artifacts/tasks/EN-02-actual-tps-render-command/runs/20261029T055926481Z-db175798-9fbe-44be-86fa-ceccfee619d0` | 3155 / 잔여 |
| run:verify-context-compaction-render:20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948 | `artifacts/tasks/verify-context-compaction-render/runs/20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948` | 크기 미확인 / 잔여 |
| run:verify-context-compaction-render:20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948 | `artifacts/tasks/verify-context-compaction-render/runs/20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948/inputs` | 크기 미확인 / 잔여 |
| run:verify-context-compaction-render:20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948 | `artifacts/tasks/verify-context-compaction-render/runs/20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948/temporary` | 크기 미확인 / 잔여 |
| run:verify-context-compaction-render:20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948 | `artifacts/tasks/verify-context-compaction-render/runs/20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948/logs` | 크기 미확인 / 잔여 |
| run:verify-context-compaction-render:20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948 | `artifacts/tasks/verify-context-compaction-render/runs/20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948/reports` | 크기 미확인 / 잔여 |
| run:verify-context-compaction-render:20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948 | `artifacts/tasks/verify-context-compaction-render/runs/20261029T055937998Z-3cbd59c7-f99f-4c43-934a-144236cb6948/outputs` | 크기 미확인 / 잔여 |

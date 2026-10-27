상태: 기존 구현·Windows 검증 완료. 2026-10-25 색상·정렬 후속 수정은 소스/집중 검사 완료, 실제 화면 검증 차단으로 커밋 대기. 제품 빌드·설치·배포 제외.

# 요청별 40분 TPS와 모드 평균

## 확정 범위·권한
[계약](../../docs/architecture/context-policy.md#recent-request-graph)에 따라 최근 40분, 요청별 점선과 HH:mm 시작 시각, 새 턴 측정 전 이력 유지, Standard 파랑/Fast 주황/Ultrafast 보라, 기본 꺼짐인 모드별 가중평균 토글을 구현한다. 현재 응답 평균은 새 턴에서 측정 대기를 표시한다. 사용자 승인에 따라 소스·검증·정리·작업 커밋까지 수행하며 제품 빌드/설치/배포는 제외한다.
공통 대상은 로컬 Windows x64·glibc Linux x64·macOS ARM64. 이번 실제 검증은 Windows이며 원격·컨테이너·다른 OS·실제 제공자·설치본은 별도이다. 기존 평균·0출력·취소/누락·replay·가격/압축·접근성을 보존한다.

## 책임·선행 조건
root는 protocol/core의 시각·호출별 선택 모드·최근 턴 이력과 native 전달/replay, 파생 schema/SDK, 문서/feature inventory, 통합 검증·커밋을 소유한다.
tps_ui는 scripts/inject-provider-context.cjs, test-provider-context.cjs, verify-context-compaction-render.mjs를 독립 구현하고 native React/Switch와 theme token을 재사용한다. 재위임/커밋/제품 빌드 금지.
확정 wire: ResponsePerformance에 nullable startedAtUnixMs/observedAtUnixMs, history 배열을 추가한다. history는 turnId,startedAtUnixMs,minuteSamples를 갖는다. Sample minute은 턴 시작 후 분, mode는 standard/fast/ultrafast 또는 null이며 동일 분에 다른 모드가 있을 수 있다. snapshot 교체는 idempotent하며 최근 40분으로 자른다. 누락된 과거 필드는 default로 읽는다.
기존 std::time, serde/schema generator, token-usage 저장/알림/replay를 확장한다. 새 dependency, polling, token별 처리 없음.

## 검증·정리
protocol: 분배·0·공백·같은 분 모드 구분·이력 보존/중복/40분 pruning·과거 JSON.
core: 선택 모드 고정·시작 시각·취소/중복 guard·요청 시간 분리·턴 시작 이력 전달.
appserver/schema/SDK: 새 필드 왕복과 파생 계약 일치·과거 optional 호환.
UI: 새 요청 측정 전 유지·HH:mm·모드색·가중평균 토글/defaultoff·대화격리·무효값·기존 가격/압축. native React/CSS 밝음/어두움·360폭·키보드/마우스 조작의 실제 렌더 확인.
고정 engine 입력, 기존 Cargo owner/preflight와 가용 warm cache를 사용한다. 생성물은 producer lifecycle로 등록하고 delete/defer 결정을 적용한다. 임시 입력/프로필은 소비 종료 후 정리하며 로그/receipt/screenshot은 검토 근거로 보존한다.

## 실행 근거
시작: 2026-10-23 (Asia/Seoul). checkout의 다른 작업 수정/staged 상태를 보존하고 이 작업만 분리한다. UI 담당이 독립 구현하는 동안 root는 engine과 검증 준비를 진행한다. Python은 PATH에 없어 설치된 Python312의 절대 경로를 사용한다.

산출물 경계: 기존 artifacts/tasks/BO-01-session-tps는 legacy-custody 보관 그룹이 보호하므로 수정하지 않고 새 artifacts/tasks/BO-02-tps-history를 사용한다. history-r1은 고정 engine 입력(10,832 files, SHA256 884ca044a1db84c233d5518ab7b20c1f1f871b6b3645d0a183be7e10a534e4de), native-r1은 순차 protocol/core/appserver/schema 실행, schema-r1은 파생 계약 변환을 소유한다. 기존 Cargo target을 단일 producer로 사용한다.

UI: provider-context 23/23 exit 0 후 통합 검토에서 새 턴 graphEstimated=false 경계, 최신 부분 분의 가중치, 가까운 시작 시각의 겹침을 보완했다. 최종 TPS focused 1/1 exit 0, native React/CSS 렌더 75 checks exit 0. 두 테마·1000/360폭·스위치 마우스/키보드·기존 가격/압축을 확인했다. root도 dark360 screenshot을 확인했다. 성공 run은 artifacts/tasks/verify-context-compaction-render/runs/20261022T164250225Z-c5924dc6-f996-4ecb-bf56-94fe6734bad2. 첫 등록 시 catalog.lock이 실제 사용 중이라 우회하지 않았고 자연 해제 뒤 재시도했다. 첫 등록된 렌더는 React rerender 대기 누락으로 실패해 대기 조건과 16px line-height를 보완한 후 새 run에서 통과했다. 두 browser의 종료를 확인했으며 lifecycle 정리는 최종 수용 후 수행한다.

native-r1 protocol exit 0 (시작 01:45:43, 종료 01:51:19 Asia/Seoul); core/appserver/schema는 동일 입력으로 계속 실행 중이다. 최종 소스는 기존 emit_turn_started의 token-count 알림을 재사용하며 중복 admission 알림을 추가하지 않는다. 이 차이를 고정한 history-r2의 입력으로 코어 검증을 추가 수행한다. turn_timing 두 파일은 기존 CRLF 형식을 보존했으며 고정 입력과 Rust 토큰 내용은 동일하다.

전체 UI 선택 회귀 명령은 61/61 exit 0 (01:59:15–02:01:56 Asia/Seoul). native project_tests의 one-shot 실행은 exit 124였으므로 통과로 취급하지 않았다. 동일 등록 명령을 기존 CLI owner로 실행한 결과가 61/61이다. 명령 종료 후 catalog.lock 경합으로 producer 종료 기록이 실패해 CLI exit 1을 보존했다. 실제 명령 결과와 producer 실패를 별도로 기록하고, producer가 종료된 근거로 lifecycle을 failure/exit 1로 닫았다. run:BO-02-tps-history:2026-10-22T16-59-15-384Z-f9c70837-231c-41bc-a8d8-19e156381071.

통합 검토에서 Forked 초기화가 부모 token info 전체를 복사함을 확인했다. 기존 대화별 측정 격리를 지키기 위해 토큰 합계는 보존하고 response_performance만 지운다. 자식 rollout 끝에 지운 TokenCount를 기록하여 첫 요청 전 cold resume에서도 부모 그래프가 돌아오지 않게 한다. session/tests.rs의 fork→저장→resume 검사를 추가했으며 기존 core 보존 wrapper와 preparation recipe가 timing과 fork TPS 필터를 모두 실행하도록 연결했다. 최종 core 입력은 이 수정도 포함해야 한다. native-r1이 읽는 고정 입력은 실행 종료까지 수정하지 않는다.

native-r1 core의 typeCheck exit 0 (19m12s), selection Cargo exit 0 (owner token 3c669e68-5746-46c3-9fd3-e892711644c1) 뒤 catalog.lock 충돌로 wrapper가 exit 1로 종료됐다. 실제 테스트 execution은 시작하지 않았다. 동기 실행 종료 결과와 기존 owner.json의 success/exit 0을 사용해 finishTargetOwner를 재실행하여 같은 종료를 기록했고 native-r1은 failure/exit 1로 닫았다. 새 실행은 지원되는 INSTA_PENDING_DIR를 작업 소유 경로로 명시하여 공유 pending 등록 충돌을 줄인다.

세션 중단 후 이전 launcher는 native 새 run을 만들지 못하고 종료됐다. catalog.lock은 독점 FileShare.None 열기가 성공해 소유 핸들이 없음을 확인했으며 일반 Remove-Item 후 실제 부재를 확인했다. 사용 중인 잠금은 삭제하지 않았다. 종료된 native-r1의 실행 참조가 해제됐고 history-r1의 inbound consumer가 없음도 확인한 뒤 같은 경로에 지원되는 새 generation final-core-r3를 등록했다. 최종 수정 6파일만 갱신한 입력 SHA256은 2fcbeff81965c1dfdbf8b0b007905c5d857237cf62a2b778c3cb262e06229c9e이며 reports/final-core-r3.json이 전체 파일 해시와 이전 입력 신원을 보존한다. native-r2는 이 고정 입력으로 appserver→stable schema→experimental schema→최종 core를 순차 실행한다. 제품 빌드는 수행하지 않는다.

UI 독립 근거는 acceptance-ui-r1에 보관했다(원래 run 경로·복사본 SHA256·75 renderer checks·61 UI tests·실제 producer 종료 코드 포함). recipe 검사 10/11 exit 1 중 새 TPS 검사와 기존 기본 계약은 통과했으며 다른 작업 engine.usage-window.native의 미등록 recipe 1건만 실패했다. 이 unrelated 선언은 변경하지 않았다. UI 임시 run 4그룹의 native register 시 producer catalog writer active가 반환되어 정리는 대기 중이다.

UI 정리 완료: 재등록→registered review에서 4그룹 모두 blockers/references 없음→명시 delete를 적용했다. 두 renderer run·UI 회귀 run·recipe run 모두 status deleted, remaining false를 확인했다(논리 크기 약 111.3MB). retained acceptance-ui-r1의 독립 근거를 유지한다. producer metadata finalize는 native 종료 뒤 수행한다.

native-r2 appserver는 typeCheck/선택/실행 모두 exit 0, 왕복 1/1 통과(03:33:31–03:43:42 Asia/Seoul). 직후 DC-01 다른 작업이 동일 Cargo target을 먼저 획득하여 schema-stable이 Cargo 시작 전에 차단됐다. r2는 failure/exit 1을 보존하고 종료 참조를 해제했다. native-r3는 같은 고정 입력/기존 target을 사용하여 stable→experimental→core만 실행한다. 캐시 소유자 종료 이벤트를 기다리고, 실제 resource-conflict 종료에만 새 attempt를 기록하여 재시도한다. 통과한 protocol/appserver/UI는 반복하지 않는다. 등록 writer와 Cargo를 중복시키지 않도록 나머지 산출물 정리는 최종 native 종료 뒤 수행한다.

native-r3 stable 생성 03:51:04 exit 0, experimental은 첫 attempt가 외부 target 소유권 충돌로 차단된 뒤 attempt2 03:53:24 exit 0이었다. 담당자가 실제 generator test 1/1·execution 0을 확인한 뒤 그 출력만 소비했다. 12개 파생 파일 갱신, native-shape 비교 13개, 기존 Python generator/호환·roundtrip 모두 exit 0. 최종 검증은 비TPS JSON 4파일 및 stable/experimental precomputed의 관련 없는 바이트를 그대로 보존함을 확인했다. 초기 formatter PATH 및 숫자 표기 보존 harness 문제는 고치고 실패 로그도 보존했다. reports/final-validation.json을 root가 수용했고 source evidence 참조도 해제됐다.

native-r3 core typeCheck는 추가한 분기 테스트의 Session/Arc 타입 오사용 E0308 1건으로 exit 101. make_session_and_context의 반환값에 맞춰 attach_thread_persistence(&mut session)로 수정했다. 다른 코드/계약은 바꾸지 않았다. 이전 producer와 source 참조 종료 후 history-r1을 final-core-r4 generation으로 갱신했다(SHA256 ead1a716ff9ff374c1f6df1d74b39fbe49916f8402c61f0fffec634d2254d894). 첫 core-r4 등록은 다른 writer의 .run-claim.lock 때문에 시작 전에 차단됐으며, 재시도는 catalog/run-claim/target 각 소유자의 실제 해제 이벤트를 기다리도록 했다. core만 재실행하며 기존 성공 검사는 재사용한다. 파생 담당자는 소스 변경 없이 acceptance-schema 근거 보관 및 종료된 schema/native run 정리를 병행한다.

최종 core-r4 attempt2 exit 0 (04:06:10–04:26:29 Asia/Seoul): timing 16/16, fork→저장→재개 1/1. 각 필터의 typeCheck/유효 test selection/실제 execution 모두 exit 0. 첫 attempt는 외부 target 소유권 충돌로 Cargo 시작 전 차단된 기록을 보존한다. 기능 검증은 Windows에서 모두 완료됐으며 producer close는 다른 catalog writer의 해제 이벤트를 기다린다. 제품 빌드/설치/다른 OS 검증은 수행하지 않았다.

acceptance-schema-r1은 schema/native 실패 및 성공 로그·보고서 36개(9,596,307 bytes), 입력 inventory와 원본 경로/SHA256 manifest를 보관한다. 12개 최종 소스 해시 일치를 확인했다. schema-r1/native-r1/native-r2는 native registered review 후 명시 delete로 remaining false를 확인했고 producer metadata도 finalize했다. native-r3는 register의 OS2(경로 없는 missing-file) 불확실성 때문에 삭제하지 않았다. 담당자의 1,146개 파일 한정 읽기 검사에서는 파일 오류나 symlink가 없었으므로 native 등록 문제를 재현·해소한 뒤 재검토한다. 이 deferred 진단 경계는 우회하지 않는다.

## 최종 수용·보관 결정

core-r4 launcher도 실제 exit 0으로 종료됐다. reports/producer.json은 producerStopped=true, 두 child closed=true, complete/membership_complete=true이며 history-r1의 실행 참조도 해제됐다. 종료를 기다리는 동안 입력은 변경하지 않았다. 최종 Windows 근거는 protocol 8개(수동 검사 1개 ignored), core 17개, appserver 1개, stable/experimental generator 각 1개, UI 61개, 실제 렌더 75 checks와 schema 비교 13개 및 Python 계약 검사이다. 관련 명령 exit 0과 앞선 실패는 위 기록 및 보관 로그에서 구분한다. recipe 전체 회귀의 unrelated 미등록 recipe 1건은 미해결이며 해당 suite 전체 통과로 보고하지 않는다.

최종 staged 29파일을 검토했고 공용 설정·recipe·feature inventory는 이 작업 hunk만 포함했다. staged JSON 두 파일과 CRLF 인식 diff --check는 exit 0이다. UI source hash는 검증 당시 값과 일치한다(렌더 검사 스크립트는 Git LF 정규화 전후 내용 일치). 다른 작업의 이후 working-tree 수정은 커밋에 넣지 않는다.

정리 결과와 남은 경계:
- 삭제된 7그룹: renderer 2개, UI 회귀, recipe, schema-r1, native-r1, native-r2. 실제 remaining=false를 확인했다. 마지막 3그룹 producer metadata finalize도 완료했다. 앞의 UI 4그룹 finalize는 catalog.lock EEXIST로 차단되어 메타데이터를 보존한다. 실제 잠금 소유자 종료 뒤 현재 참조·부재를 다시 확인하고 supported finalize를 재시도한다.
- history-r1/history-r2: 소비는 끝났으나 root의 마지막 native 등록도 producer catalog writer is active로 실패했다. 삭제하지 않고 보관한다. 다른 writer 종료 뒤 현재 registerRequest로 등록하고, 독립 보관된 입력 inventory·최종 소스 및 검증 근거를 확인하여 fresh review/delete한다. 등록 실패를 우회하지 않는다.
- core-r4: 최종 코어 검증 로그·입력 identity·producer 종료 근거를 보관한다. 작업 커밋 참조와 프로젝트 보관 검토가 끝나고 필요한 근거를 독립 보존한 뒤 등록/review를 수행한다.
- acceptance-ui-r1: 실제 화면·UI 회귀의 독립 근거를 보관한다. native 등록/defer가 아직 완료되지 않았으며 writer 종료 뒤 현재 registerRequest로 처리한다. 작업 커밋 참조와 프로젝트 보관 검토 후 재검토한다.
- acceptance-schema-r1: 기존 native 등록/defer는 성공했다. 삭제 receipt 두 개를 추가한 뒤 재등록은 여러 차례 활성 writer로 차단됐다. root가 이 미완료 상태를 인계받았고 추가 worker 재시도는 중단했다. payload/receipt는 보존하며 writer 종료 뒤 현재 registerRequest 전체 재등록과 fresh review/defer를 수행한다. 기존 측정값이 최신 receipt를 포함한다고 주장하지 않는다.
- native-r3: 앞서 기록한 OS2 등록 불확실성이 해소될 때까지 보관한다. 사용 중인 공용 Cargo target과 legacy BO-01 자료는 이 작업 정리 대상에서 제외한다.

기능 변경은 수용하지만 산출물 등록·정리의 위 제한은 남아 있다. 잠금 삭제나 다른 경로의 강제 정리는 수행하지 않았다. 설치본·실제 제공자·Linux/macOS는 검증하지 않았다.

## 색상·시각 정렬 보정

2026-10-25 사용자 스크린샷에 따라 Fast 주황을 조금 어둡게, Ultrafast 보라를 조금 밝게 조정하고 시각/점선 정렬을 수정한다. 공통 Windows x64/Linux glibc x64/macOS ARM64 webview 표시 변경이며 실제 검증은 Windows Chrome의 pinned native React/CSS에 한정한다. 설치/제품 빌드와 engine 계약 변경은 포함하지 않는다.

원인은 시각의 별도 HTML 백분율 좌표와 오른쪽 80% clamp이다. SVG max-height에 의한 좌우 여백도 HTML 좌표와 일치하지 않을 수 있다. 같은 SVG 안에서 점선의 x 좌표에 HH:mm의 중심을 맞추고 가까운 요청은 y 행만 나눈다. 기존 테마 토큰에 color-mix를 적용하여 점/선/범례/평균에 같은 보정색을 쓴다. 이력·40분·가중평균·기본 off·대화 격리는 보존한다.

기존 provider-context/model-picker 회귀와 native 렌더 검사를 확장해 양 테마 1000/474/360폭에서 시각 중심/점선 실제 좌표, 가까운 요청 겹침, 주황/보라 실제 luminance와 차이 0.05 미만을 검증한다. 같은 좌표계 회귀와 밝기 동작 검사는 보존 계약이므로 기존 retained 검사에 유지한다. 단위 로그는 새 BO-02-tps-history run, 렌더는 기존 verify-context-compaction-render의 새 고유 run에 기록한다. 임시 browser/profile은 종료 확인 뒤 현재 lifecycle 등록/review/apply 절차로 정리하고, 필요한 독립 로그·스크린샷은 보관한다. 기존 staged 타 작업 4파일은 유지하며 이번 파일만 선택하여 커밋한다.

실행 결과: unit wrapper는 .run-claim.lock EEXIST, renderer는 catalog.lock EEXIST로 실제 검사/산출물 생성 전에 exit 1이었다. catalog.lock의 FileShare.None 열기가 공유 위반으로 실패해 실제 사용 중임을 확인했다. fs.watch로 두 잠금의 실제 부재를 10분 기다리는 시도도 no run started checkpoint로 exit 1이었다. 별도의 대기 launcher 첫 시도는 ESM require 문법 오류로 시작 전 종료됐으며 import 문법으로 고쳤다. 어느 시도도 browser를 시작하지 않았고 새 fixture/profile이나 수용 근거는 생성되지 않았다. 기존 보호 잠금을 수정하지 않았다.

파일 생성 없는 `node --test --test-name-pattern "timestamped TPS" scripts/test-provider-context.cjs`는 최종 수정 후 1/1, exit 0이다. 양 끝 x=24/264와 가까운 요청의 시각/점선 동일 좌표, 기존 이력/평균/default off를 확인했다. 세 JS/MJS의 node --check와 선택 파일 git diff --check도 exit 0이었다. Fast는 테마 주황 95%+black 5%, Ultrafast는 테마 보라 95%+white 5%로 최종 조정했다. 초기 15%/20% 보정은 pinned 팔레트 수치 계산에서 과도하여 실행 전에 줄였다. 이 계산은 실제 browser 측정 대신이 아니다.

남은 일: 다른 catalog writer가 종료되면 기존 wrapper로 UI 회귀를 실행하고 native renderer의 양 테마·세 폭·실제 luminance/정렬/겹침 검증, 화면 검토 및 해당 신규 run 정리를 수행한다. mandatory 실제 UI 검증이 차단됐으므로 현재 후속 수정은 커밋하지 않았다. 기존 staged 타 작업 4파일은 그대로 두며 현재 다섯 변경 파일만 후속 커밋 대상으로 유지한다. 이전 Windows 수용 근거를 이 후속 수정의 렌더 통과로 재사용하지 않는다.

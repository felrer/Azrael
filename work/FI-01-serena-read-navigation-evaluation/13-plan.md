상태: 사용자 요청으로 테스트 중지·정리 완료. v3 구현·기능 검증과 중지 전8세션은 완료됐으나 성능 집계는 중단했다. 제품 등록/설치는 범위 밖.

# v3 함수 검색과 후보 메타데이터 비교

## 중지와 변경된 시험 범위

사용자는 테스트 중지, 기존 버전 재실험 금지, 새 버전 시험1회를 지시했다. 지시 전에 기존/v1/v2/v3 각2회로 시작한8개 세션은 모두 terminal DONE과 task_complete 기록을 마친 상태였다. 반복2를 없었던 것으로 처리하거나 새 버전을1회만 실행했다고 보고하지 않는다.

추가 모델 세션·native probe·재시험·전체 rollout 성능 분석을 시작하지 않는다. 기존에 완료된 실행의 최소 중지/검증 근거 보존과 활성 backend/process tree 정상 종료, typed reference 해제 및 새 run 정리만 수행한다. 중지 뒤 성능 결과를 완성하려고 원래8회 계획을 계속하지 않는다.

이후 시험에서는 기존 버전을 다시 실행하지 않고 기존 근거를 재사용하며 새 버전만1회 실행한다. 이 추가1회도 이번 중지 뒤에 자동으로 실행하지 않는다. 시험 재개는 사용자의 후속 요청에 따른다. 중지 뒤 추가 시험·native probe·모델 실행·성능/토큰 집계는0회다.

v3 소스·단위 검증 소스는 유지한다. 전체 성능 우위·최종8개 답변 정확성 수용을 주장하지 않는다. root는 중지 전에 첫 반복4개 답변의 핵심 규칙을 고정 원문/rubric과 대조했으며 나머지4개 답변의 독립 검토 및 토큰/호출 성능 집계는 미수행이다.

## 목적·확정 계약

사용자는 v2의 전체 목록 대신 함수 검색을 추가한 v3 구현과 시험을 요청했다. 기존 ID·줄 범위·시그니처·기존 문서 주석 첫 문장을 유지하되 검색된 후보만 모델에 반환한다. v1/v2와 과거12-plan/verification은 그대로 보존한다.

- scripts/serena-read-tools-v3.py의 SerenaReadToolsV3는 v2를 재사용한다. find_symbols(relative_path,query)는 v2와 같은 배열 항목 {id,start_line,end_line,signature,doc?}를 반환한다.
- query는 필수 비공백 문자열이다. 공백으로 나눈 각 검색어에 Unicode casefold를 적용하고 ID·시그니처·제공되는 문서 주석 첫 문장에 대해 부분 일치시킨다. 검색어는 필드에 걸쳐 모두 일치해야 한다(AND). 순서·ID·기존 메타데이터는 보존한다.
- 본문·주변 일반 주석·문서 주석의 두 번째 이후 문장은 검색하지 않는다. 정규식·fuzzy·모델 생성 설명·출력 제한·펼치기 API를 추가하지 않는다. 일치 없으면 빈 배열, 빈 검색어는 오류다.
- 내부적으로 검증된 v2 목록과 AST를 재사용하되 v3 모델 도구에는 list_ids를 제공하지 않는다. 전체 후보를 내부에서 조사하는 비용과 모델에 출력하는 비용을 구분한다.
- read_symbols의 알려진 ID 직접 읽기·교차 파일 일괄 조회·중복/오류·소스 변경 감지·경로 보호는 그대로 상속한다.
- 파일 단위 JS/JSX/CJS/MJS/TS/TSX/CTS/MTS를 실험 지원한다. 지원 의미는 OS 공통이나 실제 검증은 Windows x64/Python3.13/Node/Serena2.1/설치된 TypeScript에 한정한다. 다른 OS·언어·전체 앱 실행·UI 검증을 주장하지 않는다.

## 변경 소유와 재사용

root는 신규 v3 adapter/test·과제·guide 수용·8개 trial·정답·13-plan·최종 통합을 소유한다. 기존 minimal_reader_tests는 새 run 준비·native 통합·고정 입력·backend/client·계측·13-verification.json·producer 정리만 소유한다. 공유 작업공간의 기존 변경을 보존하고 추가 자식 위임·전역 도구 등록·빌드·설치를 하지 않는다.

v2의 메타데이터 추출과 v1의 native body 조회를 그대로 재사용한다. 같은 계약을 중복 구현하거나 새 의존성을 도입하지 않는다. 공개 검색 결과에서 필터링하며 모델에 전체 목록을 먼저 주지 않는다.

## 검증 계획

최소 단위 검증은 이름·시그니처·문서 주석 검색, casefold·복수 검색어 AND, 없음/잘못된 query, 본문/일반 주석 제외, 반환 순서/스키마 유지, 검색 후 batch 읽기 및 소스 변경 거부다. native 통합은 v1/v2/v3 동일 ID와 원문 메타데이터·본문 및 실제 검색 결과의 일치를 확인한다. v1/v2 보존 검증을 재사용/실행하고 actual exit와 입력 SHA를 남긴다.

이전 small18세션에서 reader 사용이0이었으므로 이번 성능 시험은 도구가 실제 사용되는 큰 파일 과제에 집중한다. 기존/v1/v2/v3 각 독립2회, 총8개 fresh sol_executor를 동일 고정 소스로 실행한다. 과거12수치를 새 대조군으로 재사용하지 않는다.

과제: analytics-app 메인 대시보드(App.tsx)의 표 열 너비 자동 계산을 조사하세요. content sizing·숫자·날짜·장문·일반 열마다 목표 너비와 최소/최대 제한이 어떻게 정해지는지, 샘플링·빈값·percentile 및 dense 설정이 결과에 어떻게 영향을 주는지 설명하세요. 실제 함수/상수 위치를 근거로 들고 화면을 실행·검증했다고 주장하지 마세요.

정답 기준은12-plan의 large 독립 rubric과 실제 고정된 App.tsx/tableSizing.ts 원문이다. guide에는 정답·함수명·검색어 예시를 주지 않고 자연어 과제만 준다. 기존 조건은 추가 함수 도구가 없다. v1/v2는800줄 초과 시 목록/본문, v3는800줄 초과 시 검색/본문을 사용하며 파일 전체/부분 터미널 조회는 허용한다. 그 외 읽기 정책은 동일하다. 모델 도구 호출·명령·backend API·모델 요청은 서로 다른 단위로 기록한다.

출력은 실제 전달량, 컨텍스트는 마지막 요청 입력−첫 입력과 누적 입력을 별도로 비교한다. cached/출력/원문은 구분하며 비용으로 환산하지 않는다. 직접 터미널·줄 수 확인·오류·재시도·출력 잘림을 포함한다. 후보/본문 조회량·검색 횟수·검색 결과 수·문서 주석 포함 수를 함께 기록한다. 샘플2회·공유 backend/cache·정책 차이가 있어 통계적 우위나 도구 단독 인과효과로 일반화하지 않는다.

## 구현·초기 검증

신규 adapter는 v2의 내부 metadata 목록을 재사용하고 검색된 후보만 반환한다. public v3에는 전체 목록 도구를 노출하지 않는다. 본문 읽기 보호는 상속하며 오류의 재검색 안내를 v3 find_symbols에 맞춘다. 코드·테스트는 동결 후 backend 소유자에게 SHA와 함께 인계했다.

Windows x64의 보존된 Python 환경에서 v1 9개·v2 8개·v3 6개 단위 검증 exit0. 실행 종료는 native exec session74484의 실제exit0로 확인됐으며 로그는 새run/impl-test/unit-v1.log, unit-v2.log, unit-v3.log에 귀속한다. v3 재실행은 오류 안내를 아직 노출되지 않은 list_ids 대신 find_symbols로 맞춘 뒤 실시한 검증이며 실패를 숨긴 재시도는 아니다.

첫 native preflight는 검색어 estimateTableColumnWidth가2개만 찾는다는 검증기 기대값 오류로 exit1이었다. 실제로는 ID에 부모 경로가 포함된 콜백3개까지 총5개가 일치하는 것이 정한 부분 일치 계약과 기존 native 근거에 맞는다. 이어 probe가 CRLF 원문과 text-mode LF 문자열을 직접 비교한 가정도 교정했다. 원본 v3 코드는 바꾸지 않고 probe의 기대값/줄바꿈 비교만 수정했다. 실패 근거와 on_shutdown/정확한 자식5개 remaining[]를 보존했고 trial0개 상태에서 native/public preflight exit0을 확인했다.

실제 native 검증은 ID/메타데이터·Unicode casefold·필드 간 AND·본문/일반 주석/문서 두 번째 문장 제외·빈 query 거부·알려진 ID 직접 읽기·batch/dedup/stale/path 보호를 통과했다. 대표 검색5항목/686자는 기능 preflight 근거이며 성능 세션의 실제 사용량으로 제시하지 않는다. App.tsx는 원문482항목이고 doc0이므로 주석 검색의 기능 검증과 실측 효과를 구분한다.

694개 고정 입력은 preflight 전후 동일했다. source manifest SHA c84a20d811c86166820f4a0162d9d29c5697d42e0e6552314e0aaa9419dfed43, input manifest SHA5275c87bcc1ce87799441eac970a0287bdcb59be36cc9ee53c0d9d65fb7a7f24다. 활성 성능 backend는 session36021/PID9856/create1793677127.3014777로 소유하며 임의 중복 실행하지 않는다.

유지하는 v3 검증은 향후 최적화 때 빈 query가 전체 목록을 되돌리거나 AND를 OR로 바꾸고, 본문/임의 주석을 섞어 검색하거나, 기존 batch/소스 변경 보호를 누락할 수 있는 구체적인 실수를 방지한다. 임시 native fixture와 실행 material은 별도 owner가 정리한다.

## 산출물·정리

새 run: artifacts/verification/minimal-id-v3-eval-20261103-64d5b20a; lifecycle run:serena-read-eval:20261103:v3-64d5b20a. root 임시 단위 fixture/log는 이run/impl-test 아래만 둔다. 보존 승인된 sr04는 읽기 전용 환경 의존성으로 typed reference를 등록하고 새 cache/output은 새 run에 둔다.

v3 구현 readiness 후에 source/reader/client/control을 freeze하고 실제 native 검증·입력 불변 preflight가 통과해야 trial을 시작한다. 소스 구현과 backend 준비는 독립 병행한다. 각 단계 시작/끝과 대기 원인·수정 재실행을 소유 로그/현재 문서에 남긴다.

최소 독립 근거는13-verification.json로 보존한다. 정확한 producer/process tree 종료와 참조 해제 후 지원 standalone maintenance_owner의 등록·fresh review·delete·실제 부재·finalize로 run을 정리한다. 원본 v1/v2·승인된 sr04 보관 조건을 바꾸지 않는다. 임시 material을 유지할 필요가 생기면 임의 보관하지 않고 기존 owner 경계에서 판단한다.

## 중지 후 정리 결과

성능 backend session36021/PID9856/create1793677127.3014777은 중지 요청 후 정상 exit0/on_shutdown=true로 종료됐고 정확한 자식5개 remaining[]를 확인했다. 실행 소유자는 중지 전8개 task_complete 원문과 기존 단위/native preflight·준비 결함·고정 입력·중지/종료 최소 근거만 [13-verification.json](13-verification.json)에 보존했다. 이 파일은224,094바이트, SHA2564f44c55fa145d92ebfc8af0de13e7854cd482741d8b26e6871d914e3141ae778이며 lifecycle close evidence이므로 수정하지 않는다. rollout/토큰/성능 분석은 하지 않았다.

현재 sr04 typed execution reference를 해제하고 새 run을 정상 producer 종료 의미의 complete rev2/refs[]로 닫았다. 이 close는 성능 실험 성공 판정이 아니며 별도 중지 상태를 보존했다. 기존 sr04 보관 승인과 내용은 유지한다.

검증된 standalone maintenance_owner의 등록·fresh review·delete는 모두 exit0이었다. item444ae90b392d591576c25df5719d65589f3bebcb04947b02fd1e26c4311d6b45, decision0552175461dc3d780b393ff675c349f2157f01560d9f9703a6f5abdcf8850bae, attempt-35564-5550-1793677754146. 새 run123,227,154바이트를 실제 삭제했고 statusdeleted/remainingfalse 및 finalize exit0/finalized/remaining[]/references[]/blockers[]와 실제 경로 부재를 확인했다. 추가 생성물·활성 producer는 남지 않았다. 유지할 v3 source/test와 최소 근거만 남긴다.

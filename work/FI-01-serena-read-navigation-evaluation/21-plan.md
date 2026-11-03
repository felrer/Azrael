상태: 완료 — v5 구현·단일 실험·독립 정확도/사용량 검수·지원 owner 정리를 완료했습니다. 기존 버전은 재실행하지 않았습니다.

# v5 이름 검색·줄 위치·선택적 축약 시그니처 실험

## 결과

v5는 이름 검색5회 모두 include_signature:true를 요청했습니다. v4보다 전달 출력4.9%·컨텍스트 증가3.7%가 줄었고, 요청 수·누적 입력은 거의 같았습니다. 일반 입력은 캐시 적용량 감소로 크게 늘어 비용 개선을 확인할 수 없습니다. 기존 버전은 재실행하지 않았습니다.

| 지표 | 기존: 보관2회 평균 | v3.2: 보관1회 | v4: 보관1회 | v5: 이번1회 |
| --- | ---: | ---: | ---: | ---: |
| 모델 전달 출력(자) | 41,596.5 | 46,160 | 47,838 | 45,480 |
| 컨텍스트 증가(토큰) | 13,396.5 | 13,049 | 13,912 | 13,395 |
| 누적 입력(토큰) | 235,140.5 | 207,403 | 174,007 | 173,988 |
| 일반 입력: 캐시 제외(토큰) | 31,044.5 | 35,243 | 35,639 | 68,772 |
| 캐시 입력(토큰) | 204,096 | 172,160 | 138,368 | 105,216 |
| 출력(토큰) | 2,267 | 2,505 | 2,597 | 2,715 |
| 모델 요청 | 7.5 | 7 | 6 | 6 |
| 모델 도구 호출 | 6.5 | 6 | 5 | 5 |
| 모델 수행시간(초) | 77.113 | 71.533 | 93.487 | 57.525 |
| 핵심 정답 | PASS | PASS | PASS | PASS |

v5 첫 입력21,758/최종35,153의 차이가13,395입니다. root가 고유 response ID6개의 입력173,988·캐시105,216·출력2,715 합계와 실제 모델 응답45,480자를 독립 재계산했습니다. reasoning20은 출력의 부분집합으로 더하지 않습니다. 준비230.131초와 probe/단위/정리 시간은 모델 수행57.525초에서 제외합니다. 단일 실행의 속도 차이를 일반적 성능 향상으로 확정하지 않습니다.

### 실제 옵션·범위 사용

모델 도구 호출5회 안에서 이름 검색5회와 terminal5회(내부 총10회)를 실행했습니다. 옵션 true5회/false0회, 전체60행 중37행에 축약 시그니처가 포함됐습니다. query/결과/문자는 width15행/766자, table42행/2,729자, asNumber1행/32자, formatValue1행/57자, calculateTableSizing1행/161자이며 총3,745자입니다. 필요에 따라 옵션을 켜고 끄는 선택적 행동은 관측되지 않았고 모든 조회에 요청했습니다. 시그니처를 실제 판단 근거로 삼았는지는 확인할 수 없습니다.

첫 width 조회와22,624자의 넓은 rg를 같은 functions.exec에 미리 함께 작성했습니다. await 실행 순서는 있지만 모델이 메타데이터를 보고 그 rg 범위를 좁힌 것은 아닙니다. 이후 반환된 asNumber120–129/formatValue143–168 범위와 맞춰 App120–168을 읽었고, 작은 tableSizing.ts는1–61 전체를 읽었습니다. 메타데이터 반환 뒤의 범위 읽기 정합성은 확인되지만 인과효과는 분리하지 않습니다. 번호를 붙여 반환한 소스 범위는 v4의410줄에서337줄로 줄었습니다(rg 일치 줄 제외). terminal 원문은44,484→39,496자였으며 broad rg는 줄지 않았습니다. terminal5개 모두 actualexit0, tool 오류·출력 잘림0, MCP startup 실패2개는 별도 환경 사건입니다.

### 캐시와 비교 한계

v4 대비 누적 입력은19토큰 감소했지만 캐시 입력은33,152토큰 감소했고 일반 입력은33,133토큰 증가했습니다(+93.0%). v5의3번째 요청은 입력28,531에 캐시0, 마지막은 입력35,153 중 캐시21,888입니다. 이는 캐시 적용량 차이를 확인한 것이며 provider가 다르게 적용한 원인은 미확정입니다. 일반 입력 증가를 새 코드 읽기량이 두 배가 된 것으로 해석하지 않습니다. 동시에 관측된 API 비용 개선으로 주장하지도 않습니다.

과제 핵심2파일·engine·prompt는 같지만 v4 전체 manifest가 요약만 보존되어 전체 corpus 동일성은 확인할 수 없습니다. 이번 source643/control14는 사후에도 불변입니다. N=1 역사 비교이고 줄 위치와 시그니처 옵션을 함께 추가했으므로 개별 변경 효과·일반적 우위를 확정하지 않습니다.

## 승인·계약

사용자가 v4의 이름 전용 검색을 유지하면서 줄 위치와 선택적 축약 시그니처를 제공하는 v5 구현·실험을 승인했습니다. 이전 실험과 같은 대형 코드 조사 과제를 gpt-6.1-sol/OpenAI/medium으로1회 수행하고 기존 버전은 재실행하지 않습니다. 제공 도구 활용을 권하는 효율 안내 한 문장만 사용하며 파일 크기 기준·도구 사용 강제·터미널 제한·권장 탐색 순서를 추가하지 않습니다.

find_names(relative_path, query, *, include_signature=False)는 [nativeID,start_line,end_line] 배열을 반환합니다. include_signature=true이면 callable에만 네 번째 값으로 이름·function 키워드를 뺀 시그니처를 붙이고 일반 데이터·클래스는 세 필드를 유지합니다. 함수의 generic·매개변수 타입/기본값·명시적 반환 타입·async/static/get/set/generator 의미는 보존하며 타입 추론이나 설명 생성은 하지 않습니다. 선언 이름만 Unicode casefold literal substring으로 검색하고 부모 경로·시그니처·본문·주석은 검색하지 않습니다. 빈 query·잘못된 옵션 타입을 조회 전에 거절합니다. v4의 포함/제외 종류와 기존 native scoped ID·순서는 유지하며 전체 목록·본문 조회 API는 없습니다.

## 구현과 분담

root는 새 scripts/serena-name-search-v5.py, scripts/serena-name-metadata-v5.cjs, 직접 계약 단위 검사와21-plan/21-verification, 최종 검수·비교·커밋을 소유합니다. v4 선언 분류·native provider·v1 파일 경계·설치 TypeScript AST를 재사용하고 구버전 코드는 수정하지 않습니다. v5 helper는 v4 분류 결과에 AST 위치와 시그니처를 연결하며 정확한 문자열/기본값을 보존하기 위해 AST printer를 사용합니다. 기존 제품 catalog·공유 지침·계정 파일 수동 편집·새 의존성 설치·제품 빌드는 없습니다. 실험 어댑터에 국한되어 제품 architecture/feature inventory 개정은 필요하지 않습니다.

v32_large_runner는 새 run 생성 전 소유 등록, 독립 환경 준비, root READY 후 소스·의존성 동결, 단위/실제 native preflight·thread 준비, root START 후 단일 실행·계측·종료·독립 결과 인계·지원 owner 정리를 소유합니다. 추가 위임·다른 작업 변경 되돌리기를 금지합니다. 입력 동결·구현 검증 전 실제 inference는 시작하지 않습니다. 정상 계정 owner에서 기존 사용자 지정 kmw만 재선택할 수 있고 credential 복제/수동 편집·다른 계정 선택·guard 우회는 금지합니다.

## 검증·해석

실제 TS AST와 bounded mock/native provider에서 v4 선택 보존·casefold·이름 검색만 수행·선언 범위·옵션 true/false·축약 시그니처의 이름 중복 제거·명시 타입/기본값/async/generic 보존·타입 추론 없음·상수/클래스 가짜 시그니처 없음·입력/경로/변경/중복 보호를 검증합니다. 보존 검사는 이후 시그니처/필터 최적화 시 이름 외 검색·타입/문자열 손상·범위/기본 옵션 오류를 재도입할 구체적인 위험을 막는 작은 계약 검사로 한정합니다.

공통 JS/TS 의미를 대상으로 하되 이번 실제 검증은 Windows x64/설치 Python·Node·TypeScript·engine에 한정합니다. 다른 OS·언어·기본 제품 도구 통합·UI 실행은 미검증입니다. 과제 핵심 파일 SHA와 runtime을 비교하고 전체 corpus 변경·초기 입력 차이를 기록합니다. 전 버전 재실험 없이 보관 baseline2회 평균/v3.2 1회/v4 1회와 비교합니다. 줄 위치와 시그니처 옵션을 함께 추가하므로 개별 변경의 인과효과를 분리하지 않습니다.

실제 전달 출력, 초기/최종 컨텍스트와 증가량, 누적/일반/캐시 입력·출력, 모델 요청·모델 도구 호출·내부 이름/terminal 호출, 모델 수행시간·정확도와 시그니처 옵션 선택 여부를 보고합니다. 이름 결과를 확인한 뒤 rg 범위를 좁혔는지, 같은 호출에 넓은 rg를 미리 함께 작성했는지도 확인합니다. 준비시간·실패와 모델 시간을 분리하고 N=1 결과를 일반화하지 않습니다.

## 정리·완료

새 run의 fixture/snapshot/cache/log/하네스는 생성 전 등록하고 최소 독립21-verification을 고정한 뒤 producer 종료·참조 해제·현행 owner native register/review/delete/finalize와 실제 부재를 확인합니다. sr04는 기존 승인 범위의 읽기전용 실행 참조만 사용하고 해제합니다. source/test·작업 기록·독립 수용 근거만 보존하며 task-owned disposable을 남기지 않습니다. 원본과 기존 staged/concurrent 변경을 보존하고 이번 변경만 task commit합니다.

## 준비 검증 근거

run artifacts/verification/minimal-id-v5-names-20261103-6c8d42f1, lifecycle run:serena-read-eval:20261103:v5names-6c8d42f1을 생성 전 등록했습니다. reader SHA4a6bbeb5362d773cd37c0af7537c418d822e2525b665366837c6191f5a4600a7, helper a99ce62672e1ec43d09f97b4b6f3f330dd5a0f63875d901c454798d133fb1bc1, unit6de6c5bb47d549e7dea0f304df89f2d431539f17e789986902e12117f8da853e를 고정했습니다. 단위8개 PASS/actual exit0, unittest12.530초·producer12.739초입니다. 실제 App의15개 ID·범위·대소문자 일치·callable 시그니처·data3필드가 검증됐고 backend actualexit0입니다.

대표 native fixture14개 검사에서 이전 v4 Unicode 기대값이 IDs-only로 남아 harness exit1이었습니다. 실제 [['Straße',24,24]]가 새 계약과 일치함을 별도 corrected assertion으로 확인했고 원래 실패를 보존했습니다. 다른14개 ID/범위/옵션 검사는 해당 실패 전에 통과했고 native backend는 actualexit0입니다. 재실행 없이 관측값을 검수했으며 root도 단위·수정 근거·App 반환·schema를 직접 확인했습니다.

source643파일/8,838,048바이트와 control14개를 동결했습니다. manifest SHAcc31c3bb36c7244743a9249927d8e1c181a3a552172b3dc11f76ebba5d320eb0입니다. App/tableSizing와 설치 engine은20과 동일합니다.20은 전체 파일별 manifest 대신 요약만 보존되어20대비 모든 변경 경로를 정확히 복구할 수 없다는 한계가 있습니다. 이번에는 향후 비교용 전체 manifest를 독립 근거에 보존합니다.

정상 kmw 계정이 이미 선택돼 재선택하지 않았습니다. 실제 OpenAI/gpt-6.1-sol/medium thread01a1a16a-356e-7a53-8364-6c1a9113f3c4, session24635를 준비했고 초기화230.131초는 모델 수행시간에서 제외합니다. 현재 성능 backend의 사전 warm조회는0입니다. prompt SHA99b9778ac9b83df3059ccdb7a150d09073f570cd729d9248ae487bf9dd8829cc는20과 같고, tools SHAfdc94d4ba44bf24bad7f1d48fb2e3f008bfa98c0d46994ae9b2d75c81d98f6fc입니다. root가 이를 수용해 start-turn.json을 exclusive 생성했습니다. 이 이전 실제 inference는0회입니다.

## 독립 검수·고정 근거

root가 전체 답변을20에 보존한 독립 소스 근거와 대조해 핵심 정답 PASS로 판정했습니다. 이번 고정 App.tsx SHA00f9fc90a21ae913fe23cc31404f971fc29c9f870e67868015eb6ff84ec908ab와 tableSizing.ts SHAeb2aa6bc525a7b9c254b78f65c31137341704cb775a37ee52ffbb2cdddfb6021을 직접 확인한 뒤 근거를 재사용했습니다. content/숫자/날짜/장문/일반의 계산·순서·상한, 첫50행·표시문자열·빈값·P90·dense·수동 폭 우선·후단 폭 분배를 정확히 설명하고 화면 실행을 주장하지 않았습니다.

[21-verification.json](21-verification.json)은369,821바이트/SHA256 a4cd750cf60efb827f448805aa1c7f075724dd01d044dabda1cfd9b5ca68d326로 고정했습니다. 전체 파일별 manifest·실제 모델 응답/usage/호출/전체 답변·핵심 소스·unit/native 원래실패+관측보정·원본 불변·실제 하네스·종료 근거·캐시 해석을 독립 보존했습니다. terminal aggregatedOutput은 같은 원문이 모델 응답에도 있어 중복을 없애고 명령·문자 수·exit를 보존했습니다. 계정 원문/credential은 제외했으며 close-bound 이후 수정하지 않습니다.

driver/engine/backend actualexit0, 각 native/App/final backend의 on_shutdown·LSP remaining[]와 관측128개 PID/생성시각의 부재·현재 run 관련 명령행0을 확인했습니다. 주기적 표본이 모든 짧은 프로세스 포착을 보장하지 않는 한계는 유지합니다.

현행 maintenance owner SHAc0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680에서 run close actualexit0/rev2/complete/producer actual0/refs[]와 sr04 이번 참조만 해제한 rev8/refs[]를 확인했습니다. inventory/register/freshreview/apply 모두 actualexit0, item7d6aae54098266455d6fa681f19d934c0f86edef29eb921c3816172161006a3a, decisionac6163d2655ded121b0825998135de0dbea80764b39707fd0ae221741459dc37, attempt-46600-5743-1793710217395입니다. 논리69,285,395바이트 deleted/remaining:false와 실제 run 부재를 확인했고 물리 회수량은 미측정/null입니다. finalize actualexit0/finalized/remaining[]/references[]/blockers[]입니다. 보호 control receipt는 artifacts/maintenance/lifecycles/b531c63eaaf70f97476a1b2a0298289d27864c69ede0c08a33e3f1aa5ace6eac.json입니다. sr04 payload·원본·독립21 JSON과 다른 공유 host를 보존했으며 이 작업의 disposable 잔여·활성 producer는 없습니다. 추가 모델·구버전 실험은0회입니다.

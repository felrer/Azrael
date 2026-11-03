상태: 완료 — v4 구현·단일 실험·독립 정확도/계측 검수·지원 owner 정리를 완료했습니다. 기존 버전은 재실행하지 않았습니다.

# v4 선언 이름 검색 실험

## 결과

이름 검색은 자발적으로 사용됐지만 이번 실행에서 넓은 rg 출력을 대체하지 않았습니다. 요청 수·누적 입력은 줄었으나 전달 출력·컨텍스트 증가·일반 입력은 줄지 않았습니다. 구버전은 재실행하지 않았습니다.

| 지표 | 기존: 보관2회 평균 | v3.2: 보관1회 | v4: 이번1회 | v3.2 대비 |
| --- | ---: | ---: | ---: | ---: |
| 모델 전달 출력(자) | 41,596.5 | 46,160 | 47,838 | +3.6% |
| 컨텍스트 증가(토큰) | 13,396.5 | 13,049 | 13,912 | +6.6% |
| 누적 입력(토큰) | 235,140.5 | 207,403 | 174,007 | −16.1% |
| 일반 입력: 캐시 제외(토큰) | 31,044.5 | 35,243 | 35,639 | +1.1% |
| 캐시 입력(토큰) | 204,096 | 172,160 | 138,368 | −19.6% |
| 출력(토큰) | 2,267 | 2,505 | 2,597 | +3.7% |
| 모델 요청 | 7.5 | 7 | 6 | −14.3% |
| 모델 도구 호출 | 6.5 | 6 | 5 | −16.7% |
| 모델 수행시간(초) | 77.113 | 71.533 | 93.487 | +30.7% |
| 핵심 정답 | PASS | PASS | PASS | 유지 |

v4 첫 입력21,697/최종35,609의 차이가13,912입니다. 누적 입력은 고유 response ID6개의 합이며 캐시 입력은 그 부분집합입니다. reasoning51은 출력2,597에 포함되어 더하지 않습니다. root가 usage 고유ID·각 합계·모델 전달 응답5개의47,838자를 독립 재계산했습니다. 누적 입력 감소만으로 비용 개선을 주장하지 않습니다.

### 실제 도구 사용과 병목

모델 도구 호출5회 안에서 find_names5회와 terminal5회(내부 총10회)를 실행했습니다. 이름 검색 query/결과 개수/원시 응답 문자는 width15개/501자, siz9개/315자, tableColumnFormat1개/21자, asNumber1개/12자, calculateTableSizing1개/24자입니다. 모두 성공했고 동일 query 반복0입니다. 목록 전체/본문 조회는 제공하지 않았습니다.

width 응답은 v3.2의4,202자에서501자로88.1% 감소했습니다. 그러나 첫 width/siz 조회와 넓은 rg를 같은 functions.exec 코드에 미리 함께 작성하여 이름 결과를 보고 rg 범위를 좁히지 않았습니다. 나머지 이름 검색3회도 다른 rg와 함께 미리 작성했습니다. 넓은 rg는22,452자(이전22,624자)로 거의 유지됐고, App1–90/340–445/2384–2453 읽기도13,573자를 반환했습니다. terminal 원문 전체는35,673→44,484자로 늘었습니다. 이름 검색 결과가 작아진 효과와 작업 전체의 탐색 방식 변화는 구분해야 합니다. 모델의 내부 판단 이유나 도구의 인과적 효과는 확인할 수 없습니다.

terminal5개 중4개 exit0/1개 exit1입니다. Windows에서 tableSizing*를 literal 경로로 전달한 rg의 OS123 오류였고 정확한 경로 읽기로 회복했습니다. 오류도 호출·출력에 포함했습니다. 잘림0이고 MCP startup 실패2개는 별도 환경 사건으로 기록했습니다. source642/control11은 실행 전후 불변입니다.

root는 전체 답변을 고정 소스의 상수·숫자 변환·표시 포맷·p90·열 유형 분기·필터 후 첫50행·저장 폭 우선·dense·후단 폭 분배와 대조해 PASS로 판정했습니다. 코드/화면 실행을 주장하지 않았습니다. 작업 과제·핵심 파일·engine은 같지만 다른 corpus39개 변경·1개 추가와 초기 컨텍스트 차이가 있어 N=1 결과를 일반화하지 않습니다.

## 승인과 성공 기준

사용자는 v4 구현·실험을 승인했고 대소문자 구분 없는 검색을 명시했습니다. 기존 버전은 다시 실행하지 않으며, report18과 같은 대형 코드 조사 과제를 v4로 1회만 실행합니다. 모델에는 도구와 효율적인 작업을 위해 사용하라는 짧은 안내만 제공합니다. 터미널 자유 사용, 파일 크기 조건 없음, 사용 강제 없음입니다.

find_names(relative_path, query)는 해당 JS/TS 파일의 선언 이름만 casefold literal substring으로 검색하여 기존 native scoped ID 문자열 배열만 반환합니다. 빈 검색어는 거절합니다. 시그니처·문서·본문·줄 위치는 검색하거나 반환하지 않습니다. 전체 목록·본문 읽기 도구는 제공하지 않습니다. 이름 있는 함수·함수형 변수/속성·메서드·클래스와 파일 최상위 변수/상수를 포함합니다. 일반 지역 변수·매개변수·일반 객체 속성/클래스 필드·익명 콜백 가상 이름·import/재수출 별칭·interface/type/enum은 제외합니다. 부모 이름의 일치로 자식 결과를 확장하지 않습니다.

## 구현·소유·의존 관계

root는 scripts/serena-name-search-v4.py, scripts/serena-name-positions-v4.cjs, 직접 계약 단위 검사와 이 문서·20-verification.json·최종 비교·커밋을 소유합니다. 기존 TypeScript AST와 Serena native overview/ID, v1의 파일 경계 검사를 재사용합니다. 공개 v4 객체는 find_names만 노출하며 v1/v2/v3 코드는 변경하지 않습니다. 기존 중첩 도구 등록 경로를 재사용하는 실험 어댑터이며 기본 Azrael 제품 catalog/공유 지침/설치 변경은 없습니다. 따라서 제품 architecture/feature inventory 변경도 없습니다.

v32_large_runner는 새 run 생성 전 소유 등록, 환경·과제 입력 준비, root READY 뒤 고정 소스/의존성 복사, native preflight, root START 뒤 단일 추론, 실제 계측·정확도 확인·독립 결과 인계·지원 owner 정리를 소유합니다. 다른 작업과 기존 staged 변경은 보존하고 자식 위임은 하지 않습니다. API와 입력 동결 전 준비 작업만 병행합니다. 원본 과제 파일과 과거 결과는 수정하지 않습니다.

## 검증과 해석

최소 검사: 실제 TS AST + bounded native mock으로 포함/제외 종류·leaf-only 검색·대소문자·literal substring·입력/경로 보호·이름 문자열만 반환·body/list API 부재를 확인합니다. 이후 실제 Serena provider에서 대표 함수·최상위 변수·객체 메서드와 제외 종류를 확인한 뒤 모델 실행합니다. 보존 단위 검사는 향후 심볼 필터나 검색 범위를 바꾸면서 본문/주석/매개변수를 다시 포함하거나 이름/ID 경계를 혼동할 구체적 재발을 막기 위한 소수 계약 검사로 한정합니다.

공통 JS/TS 의미를 유지하며 이번 실행 환경은 Windows x64, 설치 Python/Node/TypeScript와 설치 engine입니다. Linux/macOS·일반 배포·기본 catalog 통합은 검증 범위 밖입니다. 제품 빌드·설치·네트워크 배포는 하지 않습니다.

실제 전달 출력 문자 수, 초기/최종 컨텍스트·증가량, 누적 입력·캐시/일반 입력·출력 토큰, 모델 요청/도구 호출·내부 terminal/name 호출, 소요시간과 동일 답변 정확도를 보고합니다. 도구 자발 사용 여부 및 rg와 중복 사용 여부를 구분합니다. 과거 baseline 2회 평균/v3.2 1회와 비교하되 새로운 1회 결과를 인과적 효과나 일반적 성공률로 해석하지 않습니다. 과제/reader/runtime/corpus 동일성과 차이는 최종 근거에 기록합니다.

## 정리와 완료

run/fixture/log/cache/control snapshot은 생성 전 owner 등록하고 원문은 필요한 결과를 20-verification.json으로 인계한 뒤 producer 종료·참조 해제·native 등록/review/delete/finalize와 실제 부재 확인을 거칩니다. 승인 보관 중인 sr04는 읽기전용 소비 참조만 사용하고 반환합니다. 미확인 프로세스·보호된 항목은 삭제하지 않습니다. 저장된 검증 근거와 유지 소스·단위 검사·이 문서는 deliverable로 보존합니다. root는 최종 diff와 기존 staged 항목을 확인하여 이 작업만 커밋합니다.

## 현재 검증 근거

run은 artifacts/verification/minimal-id-v4-names-20261103-1e64a9bd입니다. 동결 v4 unit은 실제 exit0/5개 PASS, unittest 9.634초입니다. 설치 TypeScript5.9.3/Node26.7.0/Python3.13.15/Windows x64에서 실행했습니다. 별도 대표 fixture의 실제 Serena provider는 허용 선언 좌표 누락0·width/WIDTH 결과14개 동일·Unicode casefold·제외 대상 보존을 확인했고 backend actual exit0입니다. 실제 App에서도 대소문자 일치·계산 함수와 상수 반환을 확인했습니다. root가 unit-result/native-preflight-result/tool-contract/prompt를 직접 검수했습니다.

과제 App.tsx/tableSizing.ts와 설치 engine은 report18과 동일합니다. 동결 corpus642파일/8,819,345바이트, SHA ad1ffc6e14f6c02588e587e709bcf1450f7834bfff3227c902d7cb971301ad40이며 report18 대비39개 변경·1개 추가·누락0입니다. 전체 corpus 동일 비교는 아닙니다. App 사전 native 조회는 prep1에서만 수행했고 최종 성능 backend에는 반복하지 않았습니다.

첫 engine 준비는 initialize 응답288.710초로 client 대기180초를 넘겼습니다. 중지 직전 identity guard에서 이미 정상 종료한 것을 확인하여 Stop-Process는 실행하지 않았습니다. driver actual exit1(timeout), engine/backend actual exit0이며 관측 driver 트리25개와 LSP5개의 잔존0을 확인했습니다. 응답 지연 자체의 정확한 원인은 미확정입니다. 실패 준비는 유지하고 대기만600초로 늘린 동일 조건의 무추론 재준비를 승인했습니다. 기존 unit/native 근거는 재사용하며 성능 START는 별도 root 수용 전0회입니다. 준비시간은 모델 수행시간과 구분합니다.

prep2는 initialize 즉시 성공 뒤 정상 계정 owner에서 currentAccount:null/activeProfileId:null과 계정 사용 불가를 반환하여 중단했습니다. driver actual exit1, engine/backend actual exit0, thread/start와 inference는0입니다. 기존 사용자의 kmw 지정에 따라 유일하게 확인된 kmw 저장 프로필만 정상 switch/read RPC로 재선택하도록 승인했습니다. 다른 계정 선택·credential 읽기/복제·raw 상태 편집·guard 우회는 금지하며 새 사용자 로그인이 요구되면 해당 경계에서 중단합니다.

prep3 정상 owner에서 kmw 재선택과 account/read에 성공했습니다. thread01a1a13b-28fd-70c0-95e2-bfd01d1f1749, session66315, 실제 OpenAI/gpt-6.1-sol/medium 응답·source642/control11 불변을 확인했습니다. root가 prompt SHA99b9778ac9b83df3059ccdb7a150d09073f570cd729d9248ae487bf9dd8829cc와 tools SHA95de5205b0f8cc2a9451ec048141134c011ae57fd96f11f7088ba12fbb398a15 및 native 결과·단위 결과를 검수하고 start-turn.json을 exclusive 생성하여 1회 시작했습니다. App 사전 조회는 prep1에서 수행했고 현재 성능 backend에는 반복하지 않았습니다. 이전 warmed 설명은 현재 backend에 적용되지 않습니다. 익명 콜백 자체는 결과에서 제외되지만 이름 있는 중첩 함수의 기존 native 부모 ID에는 callback[1] 같은 경로가 남을 수 있습니다.

## 독립 근거와 종료

[20-verification.json](20-verification.json)은203,205바이트/SHA256 c54048eebe8fe25599916bb0fece403595a64fdd216620a4a93ba953b6db9af7로 고정했습니다. 전체 답변·실제 모델 출력·usage·호출·핵심 소스·단위/native·불변 입력·준비 실패·종료 근거·하네스와 비교 수치를 독립 보존했습니다. 동일 원문이 모델 응답에도 있는 terminal aggregatedOutput은 중복 보존하지 않고 명령·문자 수·exit·오류 근거만 남겼습니다. 계정 원문/credential은 포함하지 않습니다. 이 파일은 close-bound 이후 수정하지 않습니다.

session66315/engine/backend actual exit0, 모든 backend의 on_shutdown 정상 및 LSP remaining[]입니다. 관측142개 PID/생성시각 잔존0·현재 run 관련 명령행0을 확인했습니다. 주기적 표본은 모든 짧은 프로세스 포착을 보장하지 않으며 실제 exit와 별도 근거로 해석합니다.

현행 maintenance owner SHA c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680에서 lifecycle close 실제exit0/rev2/complete/references[]와 sr04의 이번 참조만 해제한 exit0/rev6/references[]를 확인했습니다. native inventory/register/fresh review/apply 모두 actualexit0, blockers[]입니다. item568d90a1bc8781b8c778d7d19abed7237186325166105c7710422936cff002c1, decision1ea59c37d61f389cb40ff4d4367709cb5630c80c8e2d78f60d9797d131d15239, attempt-18896-5740-1793707343900입니다. 논리65,450,251바이트 deleted/remaining:false, 실제 run_exists:false이며 물리 회수량은 미측정/null입니다. finalize actualexit0/finalized/remaining[]/references[]/blockers[]입니다. 보호 sr04 payload와 원본·다른 공유 host를 보존했고 이번 task-owned disposable 잔여와 활성 producer는 없습니다. 독립20 JSON과 구현/helper/unit은 고정 SHA 그대로 유지했습니다.

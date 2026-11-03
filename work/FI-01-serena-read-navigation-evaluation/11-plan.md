상태: 완료 — 12개 trial 분석·독립 검증·정상 종료·지원 owner 정리 완료. 제품 소스 변경 없음.

# 최소 ID 도구의 다영역 읽기·토큰 비교

## 최종 결과

이번 3개 소규모 수정 과제에서는 총 토큰 절감을 확인하지 못했다. 최소 ID 조건의 마지막 요청까지 컨텍스트 증가는 평균6.9% 작았지만, 요청 횟수가 늘어 반복 컨텍스트를 포함한 누적 입력은34.4%, 출력은36.6% 늘었다. cached를 뺀 입력도15.5% 늘었다. 입력 증가량을 누적 청구량으로 해석하거나 실제 달러 비용으로 환산하지 않는다.

각 조건6세션, 영역별2세션의 평균 또는 합계다. 모든 결과·오류·재시도를 포함하며 선별 재실행하지 않았다.

| 지표 | 기본 | 최소 ID | 최소 ID 변화 |
| --- | ---: | ---: | ---: |
| 세션당 컨텍스트 증가 평균(input_growth) | 10,150 | 9,450 | -6.9% |
| 누적 입력 합계(Σrequest input_tokens) | 1,204,089 | 1,618,144 | +34.4% |
| cached 입력 합계 | 1,089,536 | 1,485,824 | +36.4% |
| uncached 입력 합계(input-cached) | 114,553 | 132,320 | +15.5% |
| 출력 합계 | 7,380 | 10,083 | +36.6% |
| reasoning 출력 성분(출력에 다시 더하지 않음) | 101 | 254 | 별도 성분 |
| 모델 요청 합계 | 39 | 52 | +33.3% |
| backend 조회 합계(check_patch 포함) | 24 | 34 | +41.7% |
| 읽기 조회 합계 | 18 | 26 | +44.4% |
| check_patch 호출 / 통과 / 거부 | 6 / 6 / 0 | 8 / 6 / 2 | 거부 포함 |
| backend 원문 문자 합계 | 1,129,945 | 504,068 | -55.4% |
| 모델 전달 문자 합계 | 207,637 | 177,710 | -14.4% |
| 잘린 도구 출력 메시지 수 | 7 | 4 | 모두 포함 |
| 세션 소요초 평균 | 37.843 | 46.386 | +22.6% |

| 영역(각 조건2회 평균) | 컨텍스트 증가 기본→ID | 누적 입력 기본→ID | 출력 기본→ID | 모델 요청 기본→ID | 전달 문자 기본→ID | 소요초 기본→ID |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 일반 코드 | 8,558.5→8,056 (-5.9%) | 179,980→209,343.5 (+16.3%) | 996.5→1,105.5 | 6→7 | 28,728→26,723 | 34.178→35.415 |
| 웹 표 | 12,000.5→13,446.5 (+12.0%) | 239,694→399,171 (+66.5%) | 1,422.5→2,523 | 7.5→12 | 42,377.5→41,457.5 | 43.288→64.129 |
| 데스크톱 모달 | 9,891→6,847.5 (-30.8%) | 182,370.5→200,557.5 (+10.0%) | 1,271→1,413 | 6→7 | 32,713→20,674.5 | 36.062→39.615 |

고유 response_id91개를 중복 제거하여 usage를 집계했다. 모든 요청에서 input/cached가 정수이고 0≤cached≤input임을 확인한 뒤 uncached를 차감했다. input_growth는 마지막-첫 요청 입력이며, 누적 입력은 각 요청의 반복 컨텍스트를 포함한다. 처음 요청 입력은 기본24,566, ID24,570(+4); 안내 문자 평균은3,321/3,922(+601)이다. 원문 문자는 Python len, 전달 문자는 실제 모델 도구 응답의 JS text.length이며 안내·wrapper·오류·잘림을 포함한다. 모델 요청/전달/증가량 정의는 이전08의4세션 결과 재현 및 중복/누락 usage 자체검사로 확인했다.

code/app은 ID 목록→본문의 추가 단계와 함께 모델 요청이 각각1회 많았다. web_minimal1은 처음 App.tsx의 다른 함수를 읽어 잘못된 target 후보를 제출했고, 이후 정확히 일치하지 않는 old_text로 한 번 더 거부됐다. 이2회 거부와 모든 조회를 포함했다(해당 세션 입력509,229, 요청15, 검사3,86.822초). 원인을 도구 정책 하나로 단정하지 않는다.

ID 목록은6회: rootResumeProtocol.ts12개/311문자, DataTable.jsx75개/2,883문자, dialogs.mjs19개/829문자를 각각2회 반환했다. read_symbols7회에서15본문을 반환했고 selection 오류·중복은 없었다.15본문 모두 snapshot 원문과 일치했다(8개 그대로,7개 CRLF→LF만 정규화). 코드 parser는657문자, 웹 sortRows839/numeric261/columnType669문자, 앱 callback775/highlight671/renderItems2,238문자였다. 잘못 선택한 웹 compareTableValues537문자도 계측에서 제외하지 않았다.

## 최종 정확성·입력·종료 증거

root가12개 최종 변경 원문과 설명을 독립 검토해 모두 요구 동작·최소 변경 적합으로 판정했다. 원본에서 제출 changes를 다시 적용해 생성한 SHA가 보고 SHA와 마지막 모델 passed SHA 모두에 일치했다. 독립 재검사348개 전부 통과: CODE4×39, WEB4×28, APP4×20. behavioral 검사 실패는0이고, 위2회는 적용 경계 거부다. 제품 소스에 후보를 반영하지 않았다.

각 세션 실제 task_started부터 terminal까지를 사용했으며 실제58개 backend 호출이 모두 창 안에 있다. 별도 preflight 호출은 제외했다.1wave93.987초,2wave62.761초, 첫 시작부터 마지막 완료165.824초(사이9.076초 포함)다. 세션 소요시간 합계를 전체 wall time으로 부르지 않는다.

665개 snapshot 소스9,200,159바이트와 frozen/control을 포함한693개 입력의 전후 SHA가 동일했다. 실제 저장소의 reader/helper/과제 대상 및 직접 의존6파일도 불변이다.12guide Unicode exact 검사를 통과했고 model 접근 manifest에는 verifier/known-correct/분석기가 없다. backend 소스·guide·reader는 trial 도중 바꾸지 않았다.

native session23744의 실제 exit0, Python PID6384/create_time1793665941.2051923의 agent.on_shutdown 성공, LSP shutdown 응답·exit notification·exit0을 확인했다. 시작 때 기록한5개 자식의 PID+create_time을 종료 후 다시 확인해 remaining[]였다. 독립 근거는 [11-verification.json](11-verification.json)에 보존했다. 해당 파일 SHA f2e5ca98fa3a8186852f0bfb453767236ea7ddd5ff5de5fa644e95dd4f7a6212는 lifecycle close evidence로 고정되어 있으며 cleanup_pending은 그 시점의 상태다. 최종 정리 상태는 아래와 같다.

## 최종 정리

run:serena-read-eval:20261103:frontend-a93b207c를 producer stopped/exit0, complete revision2, refs[]로 닫았다. 고정 신원 standalone maintenance_owner(SHA c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680)의 native register→fresh registered review(blockers[])→delete apply를 수행했다. 대상 item068d4b95682cfb85bef54a68613438f5066735e542e423fdadffb5ae722670bc, 논리 크기75,214,880바이트였다.

native apply 실제 exit0, decision d886934b74640f14f4d72bea7e64b63b0d1c71bebb50a3777a44f823ccb5ed97, attempt attempt-34316-5496-1793667358237, status deleted/remaining:false였다. lifecycle finalize도 exit0, status finalized/remaining[]/references[]/blockers[]였고 artifacts/verification/minimal-id-frontend-eval-20261103-a93b207c의 실제 부재를 확인했다. payload/config/cache/helper/log를 모두 해당 owner로 삭제했으며 강제 삭제나 우회는 없었다. 독립 문서2개만 남겼다. 승인 보관된 sr04 runtime은 읽기 재사용 후 typed execution 참조를 해제했으며 내용·기존07~10 근거는 바꾸지 않았다.

표본은 영역별 조건당2회이고 직렬 backend·native/model cache를 공유했다. 안내 정책 차이와 추가 ID 조회 단계도 있어 통계적 유의성·일반적인 코딩 성능·도구 단독 인과효과를 주장하지 않는다. 이전08/10의 다른 과제·snapshot 결과와 합산하지 않는다. 실제 검증은 Windows x64의 함수/DOM callback unit과 native 코드 조회이며 전체 React 빌드·실제 브라우저/Electron·visual/mobile·다른 OS/CPU는 미검증이다.

## 실행 준비 기록

사용자는 개선 버전으로 일반 코딩·웹·앱 프런트엔드 추가 시험과 토큰 절감 측정을 요청했다. 제품 소스/설정 변경 없이 고정 reader와 실제 Serena backend를 사용한다. root가 과제·루브릭·최종 snapshot·수정안 또는 patch 경계 및 12개 독립 trial을 소유한다. 검증 executor는 backend/client/입력 격리/계측/독립 근거/정리를 소유하며 추가 위임하지 않는다.

새 고유 run은 artifacts/verification/minimal-id-frontend-eval-20261103-a93b207c, lifecycle run:serena-read-eval:20261103:frontend-a93b207c, owner work:serena-read-eval/version minimal-id-multidomain-comparison이다. 생성 전에 예약했고 기존 sr04 runtime에 typed execution 참조를 달았다. sr04 내용 및 기존07~10 근거는 바꾸지 않는다. 새 snapshot/frozen reader·AST/TS/config/cache/log/helper는 모두 새 run 아래에 둔다.

계획은 code/web/app 각각 base/minimal·독립2회, 총12 trial을6개씩2wave로 root가 실행하는 것이다. 승인된 공통 check_patch는 task의 원본 frozen source1파일에 old_text가 정확1회 있는 비겹침 변경만 메모리 적용한다. 매 호출은 원본 기준이며 누적하지 않는다. 실제 제품/공유 snapshot은 쓰지 않는다. 기존 common files/search/read_file와 minimal list_ids/read_symbols도 재사용한다. 과제와 최종 roots는 root가 확정했고 이 준비 인계 뒤에만 trial을 시작한다.

Windows x64/Python3.13/Serena2.1.0, TypeScript/React TSX와 plain renderer.mjs native 조회를 최소 preflight로 확인한다. guide 한국어는 apply_patch UTF-8로 작성하고 원문 exact assert를 실행한다. 모든 고정 입력은 전후 SHA로 확인한다. 비교 정의는 이전10의 backend calls/raw, actual delivered/input growth/model requests/time/truncation을 유지한다. usage의 total input/cached/output/reasoning 토큰 합산을 별도 기록하되 총 청구량이나 순수 읽기 비용으로 단정하지 않는다.

root의 terminal 결과·정확성 판정 후 정상 agent.on_shutdown/정확 자식 PID·create_time 종료와 독립11-verification 근거를 보존한다. lifecycle close/register/fresh review/apply/finalize를 지원 owner로 수행하고 새 run 실제 부재를 확인한다. 승인된 sr04 보관 예외는 그대로 유지한다.

## 고정 과제·범위

CODE는 resume/cancel의 공백 reservationId 거부와 원문 ID/list/키/revision 보호다. WEB은 명시 number/percent/currency 열의 null·undefined·NaN·숫자 해석불가 값이 양방향 정렬에서 마지막에 남도록 하며 기존 숫자 파싱·안정성·불변성·문자 정렬을 보존한다. 빈 문자열의 기존 numeric→0 처리를 임의로 바꾸도록 요구하지 않는다. APP은 pick 모달의 Home/End 활성 항목을 처음/마지막으로 옮기고 기본동작 차단·highlight·빈 결과·Arrow/CtrlSpace/Escape/일반 입력을 보호한다. 입력 포커스를 옮기는 UI 변경이 아니라 기존 highlight에 따른 활성 표시 갱신이다.

source roots는 scripts, extensions/azrael-ex/src와test, plugins/data-analytics/src/analytics-app, apps/azrael-desktop/renderer다. node_modules/dist/artifacts를 제외한 JS/CJS/MJS/TS/TSX/JSX/CSS/HTML/JSON665개9,200,159바이트를 복사했다. reader/AST helper 및 기존 TypeScript5.9.3 package.json/lib/typescript.js를 바이트 동일 고정 복사했다. 총693개 input/control SHA가 inputs-before.json에서 unchanged다. 질문은 apply_patch UTF-8 literal로 생성했고12개 guide의 정확 한국어 질문과 조건 계약을 검사했다.

## 실제 검증 준비 결과

check-patch.cjs는 CODE의 실제 parseRootResumeMessage/isRecord, WEB의 실제 sortRows와 AST 의존함수 closure, APP의 실제 dialog keydown callback을 추출해 TS transpile/격리 VM 실행한다. 검사에 제품 로직을 복제하지 않았다. candidate hash/causal first failure/case counts를 반환하며 전체 검사로그는 run에 둔다. root-only known-correct 변경은 trial source manifest에 들어가지 않는다.

controlled preflight exit0: CODE39개에서 원본 요구4실패·기존 보존0실패→known-correct39통과, WEB28개에서 원본 내림차순3실패·보존0실패→28통과, APP20개에서 원본 Home/End6실패·보존0실패→20통과다. 잘못된 target, 없는 old_text, 겹치는 변경을 거부했다. 이를 실제 제품 전체 테스트 통과로 해석하지 않는다.

실제 mailbox preflight7묶음 exit0: 정확 Unicode12guide, controlled verifier, manifest/glob, 정확 구간/rg/no-match, base ID 차단·verifier 원문 접근 차단, React TSX/JSX·plain renderer.mjs·TS의 native filtered ID/완전 코드 본문, 공통 check_patch 실행·case counts다. App.tsx482개, DataTable.jsx75개, dialogs.mjs19개, rootResumeProtocol.ts12개의 native reading-unit ID가 실제 조회됐다. native source body는 필요시 CRLF→LF만 정규화하여 확인했다.

준비 중 model patch-state는 생성되지 않았다. preflight known-correct는 model의 last-passed 상태를 채우지 않는다. 최종 task_complete는 changes와 candidate_sha256을 포함하고, 분석기는 원본에서 다시 생성한 hash·마지막 model passed hash·보고 hash의 일치 및 별도 unit 실행을 확인한다. check_patch reject와 behavioral fail을 따로 센다.

## 계측·인계 상태

analyze.cjs는 이전08 네 rollout의 전달/입력증가/모델요청/도구호출/잘림 값을 재현했고 response_id 중복 제거·미제공 필드 null·reasoning/output 비중복 합산 조건도 통과했다. 새12개 metadata는 trial-manifest.json의 lanes에 rollout 절대경로/wave로 전달한다. 세션 실제 task_started~terminal 완료 window를 사용해 preflight를 제외하며 모든 조건/실패를 포함한다. 첫 요청 fixed prompt input 차이, input_growth, Σinput/Σcached/Σoutput/별도 Σreasoning을 구분하고 누적 청구량으로 부르지 않는다. wave별 span과 전체 span(중간 대기 포함)을 따로 표시한다.

준비 시 native session23744, Python PID6384/create_time1793665941.2051923에서 backend를 시작했다.5개 자식의 정확 identity/명령행과 TS server의 automatic typing acquisition 비활성 및 cancellation/cache 경로가 run 안임을 확인했다. 이후12개 rollout mapping과 결과를 독립11-verification에 보존했으며 최종 종료·정리 결과는 위에 기록했다.

실제 검증 환경은 Windows x64/Node26.7.0/Python3.13/Serena2.1.0/TypeScript5.9.3다. CODE/WEB은 추출 함수 unit, APP은 DOM callback unit이다. 전체 React 빌드, 실제 웹/Electron 화면·포커스·visual/mobile·다른 OS/CPU는 미검증이다. 수정안은 실험 내부 candidate이며 제품 소스는 바꾸지 않았다.

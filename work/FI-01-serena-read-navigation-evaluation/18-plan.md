상태: 완료 — 승인된 v3.2 대형 코드 조사1회·실제 함수 도구 사용·독립 정확성/계측 검수·지원 owner 정리 완료. 기존 버전은 재실행하지 않았다.

# v3.2 대형 코드 조사 단일 실험

## 결과

사용자가 사진으로 지정한15-plan의 large 코드 조사 과제를 v3.2로1회 수행했다. 함수 도구는 기본 터미널과 같은 중첩 tools 영역에 실제 노출됐고, 모델이 find_symbols/read_symbols를 사용하여 정상 결과를 받았다. 핵심 정답은 독립 대조 PASS다. 기존(12의2회 평균)·v3(14의1회)·v3.1(15의1회)은 보관값이며 재실험하지 않았다.

| 지표 | 기존(보관2회 평균) | v3(보관1회) | v3.1(보관1회) | v3.2(이번1회) | 기존 대비 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 모델 전달 출력(자) | 41,596.5 | 57,016 | 39,862 | 46,160 | +11.0% |
| 컨텍스트 증가(토큰) | 13,396.5 | 18,504 | 13,365 | 13,049 | −2.6% |
| 누적 입력(토큰) | 235,140.5 | 368,030 | 246,567 | 207,403 | −11.8% |
| 모델 요청 | 7.5 | 11 | 8 | 7 | −6.7% |
| 모델 도구 호출 | 6.5 | 10 | 7 | 6 | −7.7% |
| 모델 수행 시간(초) | 77.113 | 88.228 | 65.513 | 71.533 | −7.2% |
| 핵심 정답 정확성 | PASS | PASS | PASS | PASS | 유지 |

v3.1 대비 출력+15.8%/컨텍스트 증가−2.4%/누적 입력−15.9%/모델 요청−12.5%/모델 도구 호출−14.3%/시간+9.2%다. v3 대비 출력−19.0%/컨텍스트 증가−29.5%/누적 입력−43.6%/요청−36.4%/도구 호출−40.0%/시간−18.9%다. 출력은 줄지 않았고 컨텍스트 증가 차이도 작다. 이번 관측에서는 요청 횟수와 누적 입력이 줄었으나 함수 도구 제공의 인과효과나 전반적 우위를 확정하지 않는다.

첫 입력21,824/최종34,873토큰의 차이가 컨텍스트 증가13,049다. 누적 입력207,403은 고유 response ID7개의 합이며 cached172,160/uncached35,243은 그 부분집합이다. 출력2,505토큰에 reasoning10이 포함되므로 더하지 않는다. 실제 모델 도구 응답6개의 텍스트 합46,160자와 terminal raw35,673자·dynamic raw8,178자는 서로 다른 표현이므로 합산하지 않는다. root도 usage 고유ID7개·입력합·캐시합·응답문자합을 독립 재계산했다.

## 실제 선택과 병목

모델 도구 호출6회 안에서 터미널6회와 동적 함수 도구9회(find_symbols7/read_symbols2)가 실행됐다. 본문은 estimateTableColumnWidth1개 및 asNumber/formatValue2개 일괄 조회로 총3개를 읽었다. 함수를 찾는 키워드 width, tableColumnFormat, asNumber, formatValue, normalizedTableTextLength, isNumericTableColumn을 사용했고, 빈 검색어1회는 nonempty query 오류로 처리됐다. 오류도 호출수와 컨텍스트에 포함했다. 잘림0이며 terminal6개는 실제 exit0이다. 기존 MCP liam/laio startup 오류2개는 별도 환경 사건으로 기록한다.

가장 큰 단일 터미널 출력은 넓은 rg 검색(percentile|dense|content|sizing|sample|Width|width)의 stdout22,624자였다. 함수 도구를 사용해도 넓은 grep 결과가 사라지지는 않았다. 이후 필요한 App.tsx 일부와 작은 tableSizing.ts 전체를 터미널로 읽고 함수 본문을 혼용했다. 함수 조회 순서·횟수나 전체/부분 읽기를 강제하지 않았다. 검색과 본문 조회가 실제 작동했고2개 함수 일괄 읽기도 자발적으로 수행됐다는 점은 확인됐다.

## 승인된 과제와 정책

과제: analytics-app 메인 대시보드(App.tsx)의 표 열 너비 자동 계산을 조사하세요. content sizing·숫자·날짜·장문·일반 열마다 목표 너비와 최소/최대 제한이 어떻게 정해지는지, 샘플링·빈값·percentile 및 dense 설정이 결과에 어떻게 영향을 주는지 설명하세요. 실제 함수/상수 위치를 근거로 들고 화면을 실행·검증했다고 주장하지 마세요.

동적 도구의 설명·JSON schema는 중립적으로 제공하고 효율 지침은 “효율적인 작업을 위해 제공된 도구를 활용하세요.” 한 문장이다. 파일 크기·800행 기준·함수 조회 의무·터미널 제한·권장 순서·정답 힌트는 없다. 고정 corpus 경계·원본/verifier/config/credential 접근 금지·수정/설치/빌드/추가 모델/위임 금지는 유지했다. 모델은 설치 home/checkout AGENTS를 native instructionSources로 받았으며 과거 sol_executor profile과 완전히 같은 하네스는 아니다. 실제 developer/user wire는 승인 prompt와 일치했다.

root는 과제/노출/START 수용·독립 정답·비교·이 문서·최종 커밋을, v32_large_runner는 run/lifecycle·backend/driver·동결·계측·18-verification·producer 종료·owner 정리를 소유했다. 자식 추가 위임·제품/공유 지침·공유 설정·cache 수동 변경·새 빌드/설치·계정 임의 전환은 없었다. user가 지정한 kmw 정상 owner를 재사용했다.

## 도구 노출과 준비 검증

16에서는 등록 요청 수용만 확인돼 실제 registry 노출이 미검증이었다. 이번에는 설치 engine SHA2f794a059517870f5fccc2e2d2c798cf749470c2304bf15736fb1b00815571f4의 실제 모델 요청을 loopback 무인증 fixture가1회 캡처했다. gpt-6.1-sol/code_mode_only 아래 exec_command와 같은 tools 영역에 find_symbols/read_symbols의 설명·인자 선언이 포함됨을 root가 직접 확인했다. 최상위 직접 함수가 아닌 builtin-equivalent 중첩 노출이다. 진단의 실제 모델 inference는0이며 의도한 HTTP400 diagnostic_stop 뒤 engine actual exit0이었다. fixture의 URL/auth/응답 차이는 유지하되, 이후 실제 OpenAI 성능 실행에서 함수 도구 dispatch와 응답까지 성공해 실제 사용도 확인됐다.

진단 turn/start 이전 준비 실패4개와 별도 성능 준비 initialize timeout1개가 있었다. TOML 인자·inherited window proxy·격리 home account guard·정상 account binding과 model metadata 경로를 수정하여 준비했고 성능turn 반복은0회였다. 준비·계정·기술 대기·root 검증·정리는 모델 수행71.533초에 포함되지 않으며 전체 작업 완료 시간이71.533초라는 뜻은 아니다. 정상 auth owner 기동 중 공유 models cache hash 변경이 관측되어 전체 home 불변을 주장하지 않는다. 수동 credential/config/cache 수정·복제는 없었다.

16의 효율 지침 한글이 깨졌다는 준비 중 보고는 Windows 콘솔 인코딩 표시 오판이었다. root와 실행자가 실제 JSON 문자열/codepoint를 재확인해 정상 문장·U+FFFD0임을 확인했고 손상 주장을 철회했다. 보관16 JSON은 수정하지 않았다.

## 입력·실행과 비교 한계

run은 artifacts/verification/minimal-id-v32-large-20261103-f28e406b, lifecycle은 run:serena-read-eval:20261103:v32large-f28e406b다. 생성 전 등록했다. 성능 corpus641파일/8,756,293바이트/manifest SHA940eb103887045474ab6bca501d0d76ca49507860f0b6d65f1d045c4620f1399를 고정했다.15 대비44개 변경·29개 누락·추가0은 다른 소유자의 현재 변경을 보존한 결과다.

과제 App.tsx SHA00f9fc90a21ae913fe23cc31404f971fc29c9f870e67868015eb6ff84ec908ab와tableSizing.ts SHAeb2aa6bc525a7b9c254b78f65c31137341704cb775a37ee52ffbb2cdddfb6021 및 reader/의존7개는 과거와 같다. source641/control11은 사후에도 불변이다. 기존 unit/native 기능 근거를 재사용했으며 성능을 위한 신규 unit/native symbol probe는0회다. 기존 TS-LSP150파일/25,973,024바이트를 새run에 복사하여 로그·cache를 격리했고 새 설치는 없었다. 승인 보존 sr04 환경만 typed 실행 참조로 재사용했다.

실제 thread/start는 openai/gpt-6.1-sol/medium, thread01a1a088-0c38-7ac3-9dbd-df24a8110724/session97874다. prompt SHA7af15f66e65ae113350eaa68502f58cc52b4b26ba31df739040ef39f29d0e41b와 tools SHA519f564cb9f87e48cf2f524e1babf53ffdcd66740dbdfbda9aee1be8add764e1을 root가 수용했다. experimentalRawEvents:true로 실제 tool output/usage를 수집했다. root가 start-turn.json을 wx exclusive 생성한1회만 승인했고 단일turn은 completed/error:null이었다.

과제 원문·핵심 소스·reader는 같지만 전체 코퍼스·하네스·초기 지침과 컨텍스트는 동일하지 않다. v3.1 첫 입력24,488토큰 대비 이번21,824토큰으로 초기 조건부터 차이가 있다. 이번 결과는 역사 N=1 비교이며 절감 전부를 함수 도구 효과로 돌릴 수 없다. Windows x64/설치 engine/JS·TS 실측이고 다른 OS·언어·제품 UI 실행은 미검증이다.16 모델링 과제와 이 수치를 섞지 않는다. 제품 기능을 바꾸지 않아 architecture/feature inventory 개정은 없다.

## 독립 정확성·종료·정리

root가 전체 답변을 고정 App.tsx23–34/120–128/143–150/305–434/2384–2418/2653–2654 및tableSizing31–60에 대조했다. 첫50행·표시문자열 정규화·빈값/헤더·nearest-rank p90·숫자 추론·content→숫자→날짜→장문→일반 분기·목표/clamp/dense·사용자 폭/후단 분배를 정확히 설명하고 화면 실행을 주장하지 않아 핵심 PASS다. formatTableCellValue 링크359행은 실제 선언360행과1행 차이였으나 핵심 정확성에는 영향이 없다. 이는 정적 조사 판정이며 앱 실행 검증은 아니다.

session97874/engine/backend 실제exit0, backend 하위27개 PID+생성시각 및 LSP5개 정상 종료·잔존0을 확인했다. 샘플러는 venv launcher 아래 backend 트리만 기록했으므로 engine 형제 하위 전체를 사전 관측했다고 주장하지 않는다. engine 자체 exit0, terminal6개 exit0, 현재 관련 명령행 잔존없음은 별도 증거다. 기존 공유 code-mode-host는 실험 전 생성된 다른 프로세스이므로 건드리지 않는다.

독립 [18-verification.json](18-verification.json)은307,987바이트/SHA256 d2d135a3182299701f7abb3e1883e22aa8752f663a42d92e2da080cf10972089로 close-bound 고정했다. 전체 답변·usage·호출·출력·실제 도구 선언·핵심 소스·오류·종료 검증의 범위와 한계를 보존했다. root도 해시/크기 및 실제 run 부재를 확인했다. 이 JSON과 보관12–16의 JSON은 수정하지 않는다.17-plan은 별도 작업이라 건드리지 않았다.

prep1 및 이번 실행에서 기록된 관련43개 PID+생성시각 잔존0, 현재 run 관련 프로세스0을 확인했다. engine 형제 트리 전체의 사전 표본 부재는 별도 한계로 유지한다. lifecycle close는 실제 producer success/exit0·complete/references[]이며 실험 수용과 구분했다. 첫 close의 owner 키 누락은 guard가 변경 전에 거절했고 올바른 owner를 명시한 뒤 성공했다. sr04 이번 typed 실행 참조 해제는 exit0/rev4/references[]였으며 기존 명시 보존 승인은 유지한다.

검증된 maintenance owner SHA c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680의 register/fresh review/apply 실제exit0을 확인했다. item b05dc027f4d81b410ee6798f0938d4560b09323fe6f2bc554c21c24d291af2f9, decision9a66e2dfe33dbd387fe8281e0c97016212f3627163455cc7ef3ab9a4a5256c49, attempt-29932-5652-1793695395646이다. 논리92,628,168바이트 삭제/deleted/remaining:false 및 실제 run_exists:false를 확인했다. 물리 회수량은 미측정/null이다. finalize 실제exit0/finalized/remaining[]/references[]/blockers[]이며 task-owned disposable 잔여와 활성 producer는 없다. kmw 선택과 다른 공유 host4개는 보존했다.

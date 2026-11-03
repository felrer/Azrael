상태: 완료 — 승인된 v3.1 단일 실험·독립 정확성 PASS·입력 불변·producer 종료·지원 owner 정리 완료. 함수 도구는 사용하지 않아 기능 자체의 효과는 미평가.

# v3.1 자유 선택 단일 실험

## 결과

파일 크기 기반 정책과 함수 도구 사용 유도 문구를 모두 제거한 v3.1을 동일 large 과제로1회 실행했다. 기존/v1/v2/v3 재실험·추가 반복은0회다. 답변은 기존 핵심 정답 기준을 통과했다. 모델은 find_symbols/read_symbols/list_ids를0회 사용하고 터미널 rg3회와 공통 read_file5회를 선택했다.

| 지표 | 기존(보관2회 평균) | v3(보관1회) | v3.1(이번1회) | v3 대비 |
| --- | ---: | ---: | ---: | ---: |
| 모델 전달 출력(자) | 41,596.5 | 57,016 | 39,862 | −30.1% |
| 컨텍스트 증가(토큰) | 13,396.5 | 18,504 | 13,365 | −27.8% |
| 누적 입력(토큰) | 235,140.5 | 368,030 | 246,567 | −33.0% |
| 모델 요청 | 7.5 | 11 | 8 | −27.3% |
| 모델 도구 호출 | 6.5 | 10 | 7 | −30.0% |
| 소요(초) | 77.113 | 88.228 | 65.513 | −25.7% |
| 정확성 | PASS | PASS | PASS | 유지 |

기존 참고값 대비 출력−4.2%/컨텍스트 증가−0.2%/누적 입력+4.9%/요청+6.7%/도구 호출+7.7%/시간−15.0%다. v3보다는 개선됐고 기존과 비슷한 읽기 양으로 돌아왔으나 기존보다 누적 입력이 낮아진 결과는 아니다.

초기 입력24,488/최종37,853토큰이며 증가13,365는 마지막−첫 입력이다. 누적 입력246,567(cached209,792/uncached36,775)은 모든 요청의 입력 합이며 출력2,469토큰과 구분한다. 반복 컨텍스트를 합산하므로 컨텍스트 증가와 누적 입력을 같은 지표로 취급하지 않는다. 비용으로 환산하지 않는다.

## 실제 선택과 병목

모델 도구 호출7회와 내부 exec 명령10개(guide1/rg3/read_file5/완료1)를 구분한다. read_file4개는 Promise.allSettled로 한 모델 도구 응답에 묶여 전달됐다. 원래 동적 문자열로 요약된2개 명령 그룹은 실제 상수 배열·fulfilled 출력·완료 기록을 정적으로 복원했으며 임의 코드를 재실행하지 않았다.

read_file의 App.tsx 범위는310–440/120–163/299–311/2384–2426이며 작은 tableSizing.ts는 전체1–61행을 읽었다. API 표시292행/고유290행으로310–311의2행만 중복이다. API 같은 요청 반복은0회다. rg 표시203/고유187행, 둘을 합친 표시495/고유442행이다. 이는 모델에 표시된 소스 행이며 파일 열기·OS 읽기 횟수가 아니다. 모든 API 응답은 고정 원문과 일치했다.

v3에서는 TableContent 전체269행을 함수 본문으로 읽었지만 이번에는 필요한 앞부분43행을 읽었다. 함수 전체 본문의 주변 코드를 피했고4개 범위를 한 모델 응답에서 병렬로 읽어 요청 횟수가 줄었다. 전체 파일·부분 읽기 선택의 자유가 있는 상태에서 이런 행동이 관측됐다는 의미이며 지침 제거가 원인이라고 확정하지 않는다.

전달39,862자는 guide3,201/터미널rg21,942/read_file메시지14,543/완료176으로 중복 없이 나뉜다. API raw13,097/실제 응답 내 고유 일치 serialized payload13,800은 별도 관점이므로 전달 합에 다시 더하지 않는다. rg 출력은 전체 전달의55.0%로 여전히 크다. 넓은 첫 keyword 검색 stdout18,052자가 남아 있어 함수 도구 사용을 강제하는 것만으로 검색 중복 문제가 해결됐다고 볼 수 없다. 이 문자 분해로 도구별 토큰 인과 기여도를 소급 배분하지 않는다.

find_symbols/read_symbols 사용은0회다. 따라서 이번 결과는 자유 선택 상태에서의 전체 조사 효율을 측정하며 함수 검색 기능의 성능·개선 효과를 입증하지 않는다. 오류·잘림·폴링·추가 trial은0회다.

## 승인 범위와 정책

사용자가 v3 도구를 그대로 제공하고 파일 크기 기반 정책을 모두 제거한 실험을 승인했다. 함수 도구 미사용도 유효하며 사용을 유도하려고 반복하지 않는다. 제품 등록·설치·reader 구현·공유 지침 변경은 없다.

v3의 find_symbols/read_symbols 기능 및 인자만 중립적으로 설명했다. 800줄/크기 확인 요구, 함수 조회 의무·우선·권장 사용, 일괄 읽기 권장, 터미널 읽기 제한을 guide와 trial handoff에서 모두 제거했다. frozen source 경계·원본/verifier 접근 금지·계측·완료 절차는 유지했다. 실제 exec 검색·전체/부분 읽기는 자유이며 검색어·정답 힌트는 주지 않았다. guide 전체를 root가 수용했다.

과제: analytics-app 메인 대시보드(App.tsx)의 표 열 너비 자동 계산을 조사하세요. content sizing·숫자·날짜·장문·일반 열마다 목표 너비와 최소/최대 제한이 어떻게 정해지는지, 샘플링·빈값·percentile 및 dense 설정이 결과에 어떻게 영향을 주는지 설명하세요. 실제 함수/상수 위치를 근거로 들고 화면을 실행·검증했다고 주장하지 마세요.

## 소유·입력·실행

root는 요구·guide 수용·단일 trial·정답 판정·15-plan·최종 수용, minimal_reader_tests는 새 run의 lifecycle·backend/client·고정·계측·15-verification·종료정리를 소유했다. trial은 /root/v31_once_trial sol_executor/fork_turns none1개다. 자식 추가위임·동시 변경 되돌리기·제품 수정은 없었다.

run artifacts/verification/minimal-id-v31-20261103-8c2d6a41, lifecycle run:serena-read-eval:20261103:v31-8c2d6a41. guide SHA d30b2b47cf0d02d4afb38aebc0d1a0ed6110f8a8b61954c2ee21e3e502fab493/2,947자. 689개 입력 동결/manifest SHA28155edc7819b0ae178295905843688fa9261d83d169309ce87a1a738f9a93a4. 전후 고정 입력 및 checkout 관련8개 파일 SHA 불변이다.

source670파일/9,231,895바이트/SHA d40e256f6f723e47e9aaaa371b1920ff302f7ba0deb88dc76ad5f1f9ccfb7a47. 과제 App.tsx/tableSizing.ts·reader v3 SHA9f234444813d2fc7a3f94daf9a65c2057d63e2662a8a3f79833c284c498b0837·의존7개·기존unit소스는14와 동일하다. 기존 검증을 재사용했으며 신규 unit/native probe/더미 조회는0회다. 실제 backend 기동·연결은1회다. 승인 보존 sr04 환경을 typed reference로 읽기 전용 재사용하고 새 로그/cache는 새 run에 두었다.

전체 코퍼스에는14 대비 다른 소유자의 동시 변경7개가 있었다. 과제 원문과 도구가 동일함을 확인하고 현재 고정 복사본을 사용했으며 타인 변경을 되돌리지 않았다. 과거 보관값은 동시 대조가 아니고 guide 길이와 전체 source도 다르다. 단일 관측의 행동 차이를 지침 제거의 인과효과·통계적 우위·다른 개발 과제의 효과로 일반화하지 않는다.

JS/TS 도구 의미는 그대로이고 실측은Windows x64/Python3.13/Node/Serena2.1/설치된TypeScript다. 다른 OS·제품 UI 실행·다른 언어는 미검증이다.

## 정확성·근거·정리

root가 완료 report.answer/evidence 원문을 기존 large rubric과 동결 App.tsx23–34/143–171/305–438/2384–2424행에 대조했다. 첫50행/표시문자열 정규화·빈값 제외와label 포함/p90/숫자 추론/분기순서/목표·clamp·dense/사용자 폭 및 후단 분배가 맞아 핵심 PASS다. 실제 화면·제품 실행을 주장하지 않았다. 이는 정적 조사 정확성 판정이다.

독립 근거 [15-verification.json](15-verification.json),378,421바이트/SHA256 6b0b0334facd6ed4bd71db91837ca7921f02698bb1654a30583d73ac16ebcdf6는 close-bound 불변 파일이며 수정하지 않는다. root도 hash와 실제 run 부재를 확인했다.

backend native session47759/PID22460/create1793683409.5907853은 실제 exit0 및 정확한 자식5개 종료를 확인했다. lifecycle close exit0/rev2/complete/references[]/producer stopped-success-exit0, sr04의 이번 typed reference 해제를 확인했다. sr04 기존 보관 승인은 유지한다.

검증된 standalone owner SHA c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680를 사용했다. 등록·fresh review·delete·finalize 실제 exit0. 논리68,855,889바이트/item5745408b20c0f0b327a214c3e9849c8f260334c3606fddc91d4b6a7f92ea2162/decision0e6d5aa7887d79ee3cd7a31c0bf8021cfedb5e547e3247c40a027876e0576afd/attempt-40136-5584-1793684160965. deleted/remaining:false 및 실제 run_exists:false/finalize remaining[] references[] blockers[]다. 물리 회수량은 측정되지 않아 논리 크기와 구분한다. 새 disposable material·활성 producer·남은 정리 항목은 없다.

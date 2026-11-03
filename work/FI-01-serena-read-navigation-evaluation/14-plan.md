상태: 완료 — v3 단일 시험·분석·정상 종료·지원 owner 정리 완료. 검색 기능은 모델이 사용하지 않아 효과 미평가. 기존 버전 재실험·추가 반복·제품 등록/설치·소스 수정 없음.

# v3 단일 성능 시험과 보관 근거 비교

## 단일 실측 결과

승인된 새 모델 실행은 v3 1회뿐이며 구버전 재실험·추가 반복은0회다. 답변은 핵심 정답 기준을 충족했다. 다만 find_symbols를0회 사용해 검색 기능 자체의 모델 효과는 이번 시험에서 관측하지 못했다. 모델은 터미널 rg에서 얻은 정확한 ID로 read_symbols를4회 호출해3/4/3/3개, 총13개의 고유 본문을 읽었다. 전체 목록 조회·중복 선택·backend 오류·출력 잘림은0회다. 알려진 ID 직접 읽기는 확정된 정책에 부합하며 사용을 강제하려고 재실행하지 않는다.

| 지표 | 기존(보관2회 평균) | v1(보관2회 평균) | v2(보관2회 평균) | v3(이번1회) |
| --- | ---: | ---: | ---: | ---: |
| 전달 출력(자) | 41,596.5 | 75,646 | 89,545 | 57,016 |
| 컨텍스트 증가(토큰) | 13,396.5 | 22,028.5 | 27,797.5 | 18,504 |
| 누적 입력(토큰) | 235,140.5 | 356,535 | 413,196 | 368,030 |
| 모델 요청 | 7.5 | 10 | 10.5 | 11 |
| 모델 도구 호출 | 6.5 | 9 | 9.5 | 10 |
| 소요(초) | 77.113 | 102.6045 | 101.8155 | 88.228 |

v2 보관값 대비 전달−36.3%/컨텍스트 증가−33.4%/누적 입력−10.9%지만 기존 보관값 대비는+37.1%/+38.1%/+56.5%다. v1 대비 출력과 컨텍스트는 줄었으나 누적 입력은+3.2%다. 이는 단일 실행과 과거 평균의 참고 비교이며 검색 기능의 개선 효과나 통계적 우위로 해석하지 않는다.

초기 입력은24,471토큰(보관 기존24,492/v1·v2 24,498)이다. 누적 입력368,030 중 cached326,528/uncached41,502이며 출력은3,282토큰이다. 반복 컨텍스트를 합산한 누적 입력과 마지막−첫 요청 입력인 컨텍스트 증가는 별개이며 비용으로 환산하지 않는다.

## 읽기 경로와 증가 요인

실제 응답을 call_id로 대조해 전달57,016자를 guide4,940/순수 터미널26,212/순수 본문 client4,722/본문+터미널 혼합20,966/task_complete176으로 분리했다. 혼합 응답은 한 번만 합산한다. 소스 관련 명령6회와 body client4회는 혼합2회에서 겹치므로 합을 독립 조회 수로 쓰지 않는다. 모델 도구 호출은10회이며 폴링은0회다.

본문 자체는 원문18,590자, 실제 전달 JSON 안에서 고유 일치한 escape 표현은20,259자였다. 이는 문자 단위의 분해이며 도구별 컨텍스트 토큰 기여도로 소급 배분할 수 없다.13개 본문 모두 원문과 일치했고 일부는 native CRLF→LF 정규화만 있었다. TableContent 한 함수가12,916자로 본문 원문의69.5%를 차지했다. 함수 단위 읽기도 큰 함수의 전체 본문을 가져오면 많은 주변 코드가 포함될 수 있다.

이번 흐름에서는 검색 결과/메타데이터 출력이0이었고 목록 비용을 피한 점은 관측됐다. 하지만 본문4배치와 터미널 조회를 거쳐 모델 요청11회가 발생했다. 출력 감소만으로 누적 입력 감소를 보장하지 않으며 이번에는 기존 참고값보다 누적 입력이 컸다. 이보다 세부적인 인과 기여도는 단일 관측으로 확정하지 않는다.

## 승인된 범위

사용자는 테스트 중지를 거쳐 기존 버전 재실험 금지·새 버전1회 정책을 정했고 이번에 v3 시험과 결과 분석 재개를 요청했다. 새 모델 성능 trial은 large_v3_once 단1개다. 기존/v1/v2는 재실행하지 않고12-verification의large 과제 각2회 평균을 참고한다.13의중지전v3두실행은이번결과와합산하거나재분석하지 않는다. 실패하더라도 모델시험을자동반복하지 않는다.

root는 과제·guide 수용·단일 trial·정답·14-plan·최종 수용을 소유한다. minimal_reader_tests는 새 고유 run·backend/client·고정 입력·계측·14-verification.json·producer 정상 종료·정리만 소유한다. 공유 변경을 보존하고 자식 추가위임·소스 변경·구버전 재시험은 하지 않는다.

## 과제와 정책

과제: analytics-app 메인 대시보드(App.tsx)의 표 열 너비 자동 계산을 조사하세요. content sizing·숫자·날짜·장문·일반 열마다 목표 너비와 최소/최대 제한이 어떻게 정해지는지, 샘플링·빈값·percentile 및 dense 설정이 결과에 어떻게 영향을 주는지 설명하세요. 실제 함수/상수 위치를 근거로 들고 화면을 실행·검증했다고 주장하지 마세요.

12/13과 같은 자연어 질문을 사용하며 답이나 검색어 예시는 주지 않는다. 실제 터미널 검색·읽기는 허용하고800줄 초과 코드에서는find_symbols/read_symbols를 사용한다. 알려진ID는직접읽기,여러본문일괄읽기,함수밖상수/import·미지원/오류는필요구간터미널읽기허용. v3에는전체list_ids나펼치기를노출하지 않는다. 검색은13에확정된대소문자무시/공백term AND/id·signature·doc첫문장부분일치다. 별도 출력/파일/선택 개수 상한을 만들지 않는다.

정답 기준은12의large rubric과고정App.tsx/tableSizing.ts 원문이다. 실제 화면·제품 실행이 아닌 정적조사 정확성만 판단한다.

## 재사용·실행 선행조건

v3와기존의코드/의존성이13의식별과같으면보존된단위·native기능검증을재사용한다. 기존unit9/v2unit8/v3unit6 또는nativeprobe matrix를다시실행하지않는다. 새run의필수source freeze·backend기동·client연결같은readiness만확인하고단일trial을시작한다.

지원 의미는JS/TS공통이고실제환경은Windowsx64/기존Python3.13·Node·Serena2.1·TypeScript다. 제품/웹화면·다른OS·언어는미검증이다. 보존승인sr04를읽기전용의존성으로 typed reference하고새출력/cache/logs는새run소유다. 고정소스가과거12와같은지SHA로확인하며조건이달라지면비교한계로명시한다.

## 계측·수용

실제전달출력,컨텍스트증가(마지막입력−첫입력),누적입력·cached·출력토큰,모델요청·모델도구호출·터미널명령·backend API·검색결과수·본문수·중복·오류·잘림·소요시간을구분한다. 직접터미널/guide/재시도도포함하며정확히분리불가한응답은mixed로남긴다. raw backend와모델전달량은합치지않는다.

최종비교는과거12의large 기존/v1/v2 평균과이번v3단일실측이다. 새동시대조·통계적일반화·반복재현성·달러절감을주장하지않는다.13의문서주석기능검증을재사용하되실험App.tsx의doc0은주석효과미측정으로명시한다.

## 산출물과 종료

root가승인한모델실행은 /root/v3_once_trial 하나뿐이며 terminal DONE/task_complete exit0을확인했다. root는그답변원문을고정소스의기존large rubric과대조해핵심정확성PASS로판정했다. 50행샘플·p90·빈값·숫자/날짜/장문/content분기·너비수치·dense·후단공간배분을맞게설명하고함수/상수위치근거를제시했으며제품화면을실행했다고주장하지않았다. 이는정적조사의정확성판정이며실제UI검증이아니다.

새 run은 artifacts/verification/minimal-id-v3-once-20261103-92e16fd8, lifecycle run:serena-read-eval:20261103:v3once-92e16fd8이다. source/guide/client/reader/control 689개 입력을 고정했다(input manifest SHA867f4405f01f6a5949a6a94f041791225ab9bbbdcc722bdd3623b08b15e4ed89). guide는13과같은정책/질문이며lane과새cwd만갱신했다. v3 SHA9f234444813d2fc7a3f94daf9a65c2057d63e2662a8a3f79833c284c498b0837와핵심의존7개·기존unit소스동일성을확인해이전검증을재사용했다. 신규unit/nativeprobe/더미검색은0회다.

실제 준비된 backend는 native session38617/PID20864/create1793680733.8869183이며 자식5개가활성이다. root가guide를검토한뒤 /root/v3_once_trial 딱1개를fork_turns none/sol_executor로시작했다. 재시도세션은시작하지않는다.

현재전체corpus는670files/9,225,863bytes/source SHA c619fd174f5b6887d8ee4d393c3d2c3dbcbd371870c83909df02e2d8a729baf5로12와다르다. 추가된 export-readme-cursor.cjs·export-readme-harness-diagrams.cjs와변경된 instruction-workbench-view.cjs가차이이며 과제 App.tsx/tableSizing.ts는동일하다. 이차이를감추기위해source를다시구성하거나대조군을재실행하지않고역사적참고비교의한계로남긴다.

실행소유자는새고유run경계를lifecycle에planned등록한뒤생성한다. root가중복producer를시작하지않는다. readiness뒤source/guide/client/reader/control을동결하고1trial뒤해당입력불변과최소근거를14-verification.json에보존한다.

정확한producer와자식tree종료확인·typedreference해제·검증된standalone maintenance_owner의등록/review/명시delete/실제부재/finalize까지완료한다. 새run폐기물은정리하며보존된sr04/기존보고는그대로유지한다. 로그·fixtures·환경복사본을임의영구보관하지않는다.

## 최종 검증·정리

실제 신규 모델1회/대조군0회/추가 반복0회/새 unit·native probe0회다.689개 고정 입력 및 checkout의관련8개 파일은 전후 SHA가 같았다. 기존 기능 검증을 재사용한 범위와 이번 정적 답변의 핵심 PASS를 구분하며 다른 OS·실제 UI·검색 기능의 모델 사용 효과는 미검증이다.

독립 근거는 [14-verification.json](14-verification.json),378,278바이트/SHA256 bb913027ad3ad5ad85b9ff834c0fc8a6c3c81370b2d66c4e1925360d6e297d05로 고정했다. lifecycle close evidence이므로 수정하지 않는다. 토큰 및 문자수 세부 분해는 이 근거에 있으며 혼합 응답을 중복 합산하지 않았다.

backend native session38617/PID20864/create1793680733.8869183은 실제 exit0/on_shutdown=true 및 정확한 자식5개 remaining[]로 종료를 확인했다. sr04의 이번 실행 참조를 해제하고 기존 보관 승인 내용은 유지했다.

지원 standalone maintenance_owner의 등록·fresh review·delete는 모두 실제 exit0이었다. 등록 session91930이 오래 걸렸으나 추가 스캔 없이 실제 완료를 기다렸고 phase별 출력이 없어 lockwait와 측정 시간을 분해할 수 없었다. item869f07a953f5d7d12021a94ae82c3b6c51107952663058bbb8d68a6508f3baea/논리70,238,697바이트, decision7c1043bf9093598a39f38e87b395628e070419c80c047d65107229729244eeda, attempt-45208-5562-1793681558937. statusdeleted/remainingfalse와 finalize exit0/finalized/remaining[]/references[]/blockers[] 및 실제 새run 부재를 확인했다. 새 disposable material과 활성 producer는 없다.

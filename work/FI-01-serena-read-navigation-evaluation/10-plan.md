상태: 완료 — 새4세션 비교·정확성 판정·정상종료·독립근거 보존·새 run 정리 완료.

# 데이터 심볼 제외 후 최소 ID 도구 비교

사용자는 수정된 도구의 성능 비교를 승인했다. d77f6c5c의 reader/AST helper를 고정하여 같은 두 질문을 base2개·minimal2개 독립 cold sol_executor, 총4세션으로 새로 실행했다. 제품 최적화·기본 도구 통합·설정 변경은 하지 않았다. root는 과제·trial·정확성 판정을, 검증 executor는 snapshot/backend/guide/client·계측·정리를 소유했다. 기존08 결과와07/09 hash 고정 근거는 수정하지 않았다. 결과 유불리에 따른 trial 재실행은 없다.

## 현재 대조군과 비교 결과

이번 표본에서 최소 ID 조건은 평균 조회·실제 전달·입력 증가가 줄었고 모델 요청은 늘었다. 시간은 거의 같았다. 원시 backend 출력은 오히려 늘어 모든 비용이 줄었다고 말할 수 없다. 같은 모델2회씩의 소규모 결과이며 일반 우위나 통계적 유의성을 주장하지 않는다.

| 실행 | 조회 API | 원시 응답 문자 | 실제 도구 전달 문자 | 입력 증가 토큰 | 모델 요청 | 모델 도구 호출 | 잘림 | 초 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| base1 | 27 | 214,364 | 100,917 | 29,960 | 13 | 12 | 1 | 102.727 |
| base2 | 29 | 364,170 | 131,715 | 38,376 | 13 | 12 | 1 | 99.784 |
| minimal1 | 17 | 377,940 | 91,235 | 27,345 | 12 | 11 | 1 | 91.573 |
| minimal2 | 27 | 395,331 | 112,522 | 33,559 | 16 | 15 | 1 | 109.556 |
| 기본 평균 | 28 | 289,267 | 116,316 | 34,168 | 13 | 12 | 1 | 101.2555 |
| 최소 ID 평균 | 22 | 386,635.5 | 101,878.5 | 30,452 | 14 | 13 | 1 | 100.5645 |
| 최소 변화 | -21.4% | +33.7% | -12.4% | -10.9% | +7.7% | +8.3% | 같음 | -0.7% |

첫 실제 task_started부터 마지막 terminal task_complete까지 전체 경과는127.618초다. 세션 시간 합계를 전체 소요로 표시하지 않는다. 기본의 경로 오류는1/2개, 최소는0개였다. errors를 제거하거나 실패·잘림이 있는 세션을 제외하지 않았다. 네 세션 모두 넓은 출력이 잘린 뒤 필요한 소유 파일과 범위를 좁혀 재조회했다.

## 목록 축소와 실제 본문 사용

두 최소 세션의 실제 ID 목록은 같았다. 일반 데이터는 제외되고 callable/type 경로가 남았다.

| 파일 | 이전08 목록 개수/문자 | 이번 목록 개수/문자 |
|---|---:|---:|
| scripts/inject-provider-context.cjs | 859 / 44,371 | 104 / 5,397 |
| scripts/maintenance-owner-config.cjs | 151 / 5,631 | 16 / 540 |
| scripts/test-maintenance-owner-config.cjs | 이전에 조회하지 않음 | 14 / 1,591 |

주요 두 소유 파일의 목록 합계는 이전50,002자에서 현재5,937자로 약88.1% 작아졌다. 이번에 추가로 읽은 테스트 파일 목록까지 포함하면 세션별7,528자다. 이는 기존 보고값과 이번 실측값 비교이며 과거 snapshot 전체가 현재와 동일하다고 주장하지 않는다.

각 최소 세션은 read_symbols로2개+6개+1개, 총9개 본문을 읽었다. 전체6호출18개 선택은 모두 성공했고 native 선택 오류·중복은0개였다. 다중4호출에16개, 단일2호출에2개가 포함됐다. gaugeProgress/decorateGauge, 실행기 선택 핵심4개 및 테스트 callback 등7개는 질문/검증 근거에 직접 사용됐다. waitCapability와 resolveMaintenanceOwner는 관련 보조2개이며 모든 선택이 필수였다고 과장하지 않는다.

본문18개를 frozen source와 대조했다.14개는 원문 문자열 그대로 일치했고 inject-provider-context의4개는 native Serena가 CRLF를 LF로 정규화하여 줄바꿈 정규화 후 코드가 완전히 일치했다. 최초 byte-substring 추가 검사는 이4개에서 exit1이었다. 해당 진단을 보존하고 native 본문 계약에 맞게 CRLF→LF만 허용하는 검사를 적용했다. 누락·요약·소스 코드 변경은 발견하지 못했다. read_file은 원래 줄바꿈을 유지한다. 새 제품 수정이나 평가 재실행은 하지 않았다.

목록이 작아진 뒤에도 넓은 탐색이 원시 출력의 주된 비용이었다. minimal1의 receipt|fallback executor 검색1건은304,274자, minimal2와 base2의 runner 검색은 각266,318자였다. base1도 launcher 검색141,466자를 받았다. 최소 전체의 list_ids는15,056자, read_symbols35,440자에 비해 search는686,815자였다. 기본 전체 search는476,685자다. 탐색 선택·안내·소규모 변동과 섞여 있으므로 raw 증가나 전체 개선을 ID 필터 하나의 인과 효과로 단정하지 않는다.

## 이전08 결과와의 구분

| 실험/평균 | 조회 | 원시 문자 | 실제 전달 문자 | 입력 증가 | 모델 요청 | 초 |
|---|---:|---:|---:|---:|---:|---:|
| 이전08 기본 | 13 | 128,244.5 | 77,711.5 | 22,908 | 7.5 | 60.692 |
| 이전08 최소 | 20.5 | 640,511.5 | 136,309.5 | 39,137.5 | 13 | 97.6695 |
| 이번 기본 | 28 | 289,267 | 116,316 | 34,168 | 13 | 101.2555 |
| 이번 최소 | 22 | 386,635.5 | 101,878.5 | 30,452 | 14 | 100.5645 |

이번 최소의 전달/입력은 이전 최소보다 작아졌지만 기본도 이번에 더 많은 조회·입력을 사용했다. 이전 대비 개선율을 제품 성능 향상으로 해석하지 않는다. 핵심 판단은 이번 fresh base와 minimal의 같은 환경 비교이며, 목록 축소 효과와 전체 탐색/모델 왕복 비용을 구분한다.

## 정확성 판정

root가 네 terminal 답변을 고정 원문과 rubric에 따라 독립 검토하여 모두 Q1/Q2 핵심 통과로 판정했다. Q1의 I/L, 자동압축 off와 I>=L/finite C>L에서 (I-L)/(C-L), threshold reset/clamp/fallback, 황색/추가 용량 안내와 테스트 근거가 맞았다. Q2의 default receipt ENOENT 조건부 legacy fallback, 명시 missing/corrupt fail-closed, override plain-file-only, executable hash/capability/acceptance 근거도 맞았다. 네 세션 모두 실제 제품 테스트나 live UI 검증을 했다고 주장하지 않았다. 기본 경로 오류3건과 최소의 관련 보조본문2개씩도 평가 기록에 포함했다.

근거 소유 파일/심볼은 scripts/inject-provider-context.cjs:gaugeProgress26-31 및 decorateGauge171-215, scripts/test-provider-context.cjs148-155/171/185/196-206, scripts/maintenance-owner-config.cjs:resolveMaintenanceCommand40-71/plainFile/installationPath/validateCapabilities, scripts/test-maintenance-owner-config.cjs10-64다. 질문에 필요한 핵심 source는 root가 확인했으며 이 실험 자체가 테스트 실행 통과나 실제 설치 상태를 증명하지 않는다.

## 조건·계측·변경 한계

Windows x64/Python3.13/Serena2.1.0/gpt-6.1-sol, 공통 직렬 backend1개와 실제 LspApi를 사용했다. 현재 scripts의 JS/CJS/MJS/TS/JSON544개7,566,958바이트를 고정 복사했고 원래543개7,562,771바이트와 완전히 같은 입력이라고 주장하지 않는다. reader/helper와 기존 TypeScript package.json/lib/typescript.js는 바이트 동일 복사·고정했다. reader SHA는8de78f5f782a6f7fe99f69bc537b6aa0c4a2cd3a1cef8cd581199acda60e75ca, helper329f95b7ae3cc65afcd62b5a3e369800251e43580e7d35fe569105a8c962bc76다. 최종 source/guide/helper/config 등561개 입력은 전후 SHA unchanged였다.

삭제된 원 helper는 같은 공개 boundary로 재구성했다. files는 manifest fnmatch, search는 실제 rg regex/line-context/rg_glob, read_file은1-based inclusive 원문 구간이다. 최소에만 list_ids/read_symbols를 노출하고 일반 fallback을 허용했다. source·줄·응답·선택 개수에 하드 제한은 두지 않았다. guide는 이전 rollout에서 복구했으며 경로/lane, CRCRLF→LF, search fnmatch wrapper 표기→실제 rg_glob 계약(양 조건 동일), 최소 callable/type·ordinary-data 제외 설명이 달라졌다. 기본 안내2,163자, 최소2,757자 차이도 효과의 일부다.

첫 READY에서 root가 한국어 질문이 '?'로 손상된 준비 결함을 발견했다. 원인은 PowerShell native stdin의 기본 인코딩이었다. trial0개인 상태에서 apply_patch의 UTF-8 literal로 정확 질문을 복원하고4guide8질문 완전일치 assert를 preflight에 추가했다. source/backend/reader는 그대로 유지하고 guide4개·preflight와 새 검사helper만 지원 준비절차로 재고정했다. preflight6묶음 exit0 이후에4trial을 시작했다. 준비 결함은 성능 trial 오류로 세지 않았다.

원시는 backend Python len(text), 실제 전달은 rollout tool-output text의 JS string.length다(guide/wrapper/오류/잘림 포함). 토큰으로 환산하지 않았다. 입력 증가는 첫 모델 요청 input과 마지막 답변 생성 요청 input 차이이며 누적 청구 입력이 아니다. 모델 요청/도구 호출/조회 API를 별도로 센다. 실제 usage response_id 중복 없이 기록을 사용했고 이전08 네 rollout으로 전달/입력/요청/도구호출/잘림 값을 모두 정확히 재현하여 정의를 확인했다. 잘림은 중첩 warning 개수가 아니라 잘린 전달 메시지 개수다.

세션별 actual task_started~terminal task_complete로 window를 잡았다. 실제 trial 조회100건을 모두 포함했고 밖에 있던 base1의4건은 두 번의 준비 preflight가 의도적으로 ID 도구 차단을 확인한 오류뿐이다. 전용 preflight lane도 제외했다. 한 native backend/cache 공유, 조건별 안내, 두 세션의 작은 표본, 탐색 선택/도구 출력 상한/환경 변동 때문에 일반적인 모델 우위·다른 언어/OS/실제 코드 수정 성공률은 미검증이다.

## 독립근거·종료·정리

[10-verification.json](10-verification.json)은 네 답변/정확성 판정, 세션 window와 rollout 경로, 호출 인자·chars·오류, ID목록/선택본문 해시·유용성, 이전08 정의 재현, 고정 입력·guide 차이·Unicode 준비 오류, 실제 프로세스 종료를 독립 보존한다. lifecycle close의 hash 고정 근거이므로 이후 변경하지 않는다.

새 run은 artifacts/verification/minimal-id-eval-filtered-20261103-f40ce289, lifecycle run:serena-read-eval:20261103:filtered-f40ce289(owner work:serena-read-eval/version minimal-id-filtered-comparison)다. 생성 전에 예약하고 sr04 runtime에는 typed execution 참조를 달았다. 모든 config/cache/log/snapshot/helper는 새 run에 격리했으며 sr04/07/08/09 내용은 변경하지 않았다.

root의 네 결과 인계 후 stop을 전달했다. native exec session50545 exit0, worker PID45816/create_time1793664166.423348 exit0, agent.on_shutdown 정상, LSP shutdown response/exit notification 후 exit0을 확인했다. 정확한 PID/create_time으로 관측한 자식5개는 모두 종료되었고 children_remaining=[]다. 독립 근거 보존 후 lifecycle close revision2 complete/refs[]로 실행 참조를 해제했다.

검증된 standalone maintenance_owner(c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680)로 새 run99,915,471바이트를 register exit0으로 등록했다. fresh registered review는 blockers=[]/참조0개였고 최신 item token으로 apply exit0, group/item deleted, remaining=false를 확인했다. decision_id는0d50c7b7d800b844c95fb6f27990b68f155e5b68bddcdf98d00ae21e02764b4c다. finalize exit0에서 remaining/references/blockers가 모두 빈 배열이며 실제 새 run 경로도 부재였다. 새 snapshot·guide/client/backend·parser/LSP/npm/cache·raw log·일회용 분석기를 남기지 않았다. 독립10-plan/10-verification만 유지하며 10-verification은 삭제 전에 고정한 근거이므로 당시 cleanup_pending 상태를 담고 있고 실제 정리 완료는 이 절이 소유한다. 기존 sr04 사용자 보관 승인과 overlap 보호는 그대로 유지한다.

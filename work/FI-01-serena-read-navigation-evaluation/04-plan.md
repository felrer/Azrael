상태: 5유형·10개 수정 작업·시각/보존 검증·임시 환경 정리 완료 — 추가 사용자 조치 없음.

# 비백엔드 시각 작업의 구조 조회 비교

## 목표·범위

사용자가 선택한 3(3D 모델), 7(애니메이션), 8(이미지·그래픽), 9(영상), 10(문서·시각화)에 대해 동일 작업물·수정 목표에서 일반 조회와 구조 개요/일괄 조회를 작은 subagent 작업으로 비교한다. 유형별 한 쌍, 총 10개 독립 sol_executor 세션이다. 첫 pilot이므로 통계적 우위나 모든 실제 디자인 워크플로에 일반화하지 않는다.

실제 설치된 Blender 5.2.2 LTS/FFmpeg로 3·7·9의 .blend를 읽고 수정한다. 8은 SVG 벡터 그래픽, 10은 self-contained HTML 슬라이드이며 Chrome headless로 실제 렌더한다. 생성형 래스터 이미지·상용 영상 편집기·PowerPoint·GUI 작업의 검증은 아니다. API 기반 작은 파일 편집과 시각 검증을 수행한다. Blender 공식 온라인 API 문서는 조회가 402로 실패했으므로 실제 설치 runtime API를 확인한다.

일반 조건에도 이름/종류 목록, 필터, 단일 상세의 fields 선택, 전체 덤프, 일괄 수정, preview, verify를 제공한다. 구조 조건은 여기에 hierarchy/짧은 속성 개요와 같은 상세의 read_many를 제공하고 우선 사용하도록 안내한다. 불필요한 대형 dump나 무제한 geometry 출력을 일반 조건에 강제하지 않는다. 실제 외부 Blender MCP와 Serena 제품을 비교하는 것이 아니라 실제 형식에 연결한 실험 어댑터의 정보 제공 방식을 비교한다. Serena 코드/기본 도구/사용자 설정/공유 지침은 변경하지 않는다.

root는 공통 계약·worker/client·계측·통합·최종 시각 검증·정리를 소유한다. native/document 어댑터 구현은 지정 sol_executor에게 파일을 나눠 맡기고, 각 비교 세션은 자기 variant만 수정한다. 모든 하위 agent의 추가 위임을 금지한다. adapters가 실제 preflight를 마치고 source hash를 고정한 뒤 각 쌍을 실행한다. backend는 단일 queue로 직렬 실행해 Blender/Chrome CPU·GPU 경합을 줄이고, 모델은 준비된 독립 유형을 병행할 수 있다. 대기 시간을 도구 자체의 지연으로 해석하지 않는다.

## 측정·수용

코드/API 조회 횟수, 수정·preview·검증 요청, 원시 텍스트와 실제 tool output 문자, 이미지 반환 횟수/크기, 모델 input token 증가·도구 왕복·시간, 잘못된 대상/재조회, 목표 달성·무관 객체/구간 보존을 기록한다. 각 세션은 수정 전후 실제 preview를 보고 작업한다. 이미지 토큰이 별도 제공되지 않으면 텍스트 토큰과 분리 추정하지 않는다. 오디오 작업은 이번 영상 자막 평가에 포함하지 않는다.

시드·variant·영상·PNG·Chrome profile·어댑터·로그·분석은 생성 전에 등록한 lifecycle run:creative-read-eval:20261102:r1, owner work:serena-read-eval, artifacts/verification/cr01 한 root다. root가 필요한 이미지·검증을 확인하고 결과를 이 문서에 독립 요약한 뒤 stopped process tree 확인과 기존 maintenance owner register/review/apply/finalize로 삭제한다. 보고서만 유지·로컬 커밋하며 unrelated source/index를 보존한다. 제품 정상 동작 확인을 기다릴 변경은 없다.

## 실행 조건과 제외

Blender 실제 API probe에서 5.2 Action slot/layer/channelbag 및 VSE strips를 확인했다. native adapter는 실제 조회·수정·보존 fault 검출·저장 바이트 불변 PNG 7개, MP4 96프레임/H264 384×288 22,838바이트 생성 preflight를 exit 0으로 완료했다. document adapter는 Blender bundled Python stdlib XML/XHTML roundtrip·atomic 수정·무관 요소 훼손 검출을 exit 0으로 완료했다. root가 Chrome/Blender preview 5유형을 실제 렌더해 확인했다. 어댑터 source hash와 시드 hash를 고정하고 두 조건의 초기 파일 hash가 같은 것을 확인했다.

baseline과 구조 조건 모두 target 이름/수정값이 명시된 쉬운 작업이다. 이름을 모르는 복잡한 문서·장면 탐색, 조형 감각, 원본 이미지 생성 같은 작업을 대변하지 않는다. baseline도 fields와 query 필터를 사용해 실용적인 작은 상세만 반환하며, geometry 전체는 요청한 경우에만 읽는다.

native/document 제작 agent는 사전 검증 중 인코딩 문제를 바로잡은 뒤 안정 source를 고정했다. 비교 세션 중 최초 base_animation은 모델 capacity 오류로 실행을 시작하지 못했다. 이 세션은 제외하고 같은 sol_executor 모델/목표/입력의 신규 base_animation_retry로 한 번 교체했다. 활성 모델 수를 줄여 이후 준비된 작업을 시작했다. 원래 실패는 성능이 불리해서 제외한 사례가 아니다. model/graphic baseline 세션의 여러 JSON을 한 stdin에 보낸 client 오류는 정상 실행 내부 재시도로 유지하고 실제 전달 출력/컨텍스트에 포함한다.

## 작업물과 실제 결과

| 유형 | 입력/수정 목표 | 결과 |
|---|---|---|
| 3. 3D 모델 | .blend 램프 갓 폭 1.8→2.6, 하부 발광 패널 1.6→2.4 | 양쪽 실제 저장·폭/무관 상태 검사 통과 |
| 7. 애니메이션 | 주황 공 Z 정점(frame12) 2.4→3.6, 끝 키 frame30→42(값 .61 보존) | 양쪽 키/다른 채널·객체 검사 통과 |
| 8. 그래픽 | SVG 행사 카드 날짜 November 14→16, 해당 CTA fill #a14b32 | 양쪽 전체 XML의 요청 외 내용 보존 통과 |
| 9. 영상 | Blender VSE Closing caption 문구 변경, 시작61→65·길이30 유지 | 양쪽 텍스트/범위/다른 strip 보존, MP4 실제 생성 |
| 10. 문서·시각화 | HTML 슬라이드 Q3 8→9, 막대135/y35·값 라벨9/y26 | 양쪽 비례·내용·다른 슬라이드 보존 통과 |

별도 sol_executor 10개를 같은 역할/설정으로 실행했다. 이전 코드 탐색의 luna_explorer 결과와 직접 평균내지 않는다. 비교 세션은 자기 lane의 API로만 수정했고 일반 조건에도 query/fields와 일괄 apply를 제공했다. 구조 조건에는 overview와 read_many를 추가해 우선 사용을 안내했다. 이 안내가 이미 명확한 대상에 불필요한 개요를 읽게 할 수 있다는 한계가 있다.

## 측정 결과

아래는 일반→구조 조건이다. 조회는 list/get/dump/overview/read_many 요청 수이며 실패 응답도 포함한다. 전체 요청에는 apply/preview/verify도 포함한다. 모델 전달 텍스트는 guide·wrapper·실패를 포함한 rollout tool call_output의 텍스트 문자 합계다. 이미지의 base64를 문자량에 합치지 않았다. input 증가는 첫 요청부터 최종 답변 생성 요청까지의 모델 보고 토큰 차이로, 이미지와 텍스트의 비용을 별도로 분리하지 않는다.

| 유형 | 조회 수 | 전체 API 요청 | 모델 전달 텍스트 문자 | input token 증가 | 실제 본 이미지 |
|---|---:|---:|---:|---:|---:|
| 3. 모델 | 4→2 | 8→6 | 6,323→6,859 | 3,775→3,721 | 2→2 |
| 7. 애니메이션 | 3→2 | 8→6 | 6,579→7,816 | 3,998→4,384 | 2→2 |
| 8. SVG 그래픽 | 3→2 | 7→6 | 5,869→9,855 | 4,045→4,735 | 2→2 |
| 9. VSE 영상 | 3→2 | 7→6 | 5,936→7,043 | 3,798→3,988 | 2→2 |
| 10. HTML 슬라이드 | 7→2 | 11→6 | 7,226→10,520 | 4,998→5,099 | 2→2 |
| 5유형 합계 | 20→10 | 41→30 | 31,933→42,093 | 20,614→21,927 | 10→10 |

조회 합계는 −50%, 전체 API 요청 −26.8%였지만 전달 텍스트는 +31.8%, input 증가는 +6.4%였다. 모델 orchestration 도구 호출은 56→47회, 모델 요청은 61→52회였다. 서로 다른 유형 한 쌍씩 합친 값이며 모집단 평균이나 재현 가능한 감소율로 주장하지 않는다. token 증가에는 모델 작성 명령/응답과 지침 비용도 포함돼 텍스트 문자와 비례하지 않는다.

| 유형 | 조회 API 원시 텍스트 문자 | 모든 API 원시 텍스트 문자 | 모델 도구 호출 | 세션 초 |
|---|---:|---:|---:|---:|
| 3. 모델 | 376→1,376 | 1,087→2,099 | 10→10 | 76.656→88.754 |
| 7. 애니메이션 | 1,380→2,235 | 2,280→2,977 | 10→9 | 76.680→79.582 |
| 8. SVG 그래픽 | 483→4,205 | 1,199→4,939 | 9→8 | 72.594→93.923 |
| 9. VSE 영상 | 617→1,512 | 1,338→2,245 | 11→10 | 79.648→67.513 |
| 10. HTML 슬라이드 | 918→4,590 | 1,715→5,405 | 16→10 | 128.596→76.674 |
| 합계 | 3,774→13,918 | 7,619→17,665 | 56→47 | 병렬 실행이므로 합산 안 함 |

모든 유효 세션의 출력 잘림은 0회였다. 일반 조건의 선택 필드/필터 조회는 매우 작았고 구조 개요는 다른 객체의 속성과 계층도 포함해 더 컸다. 이미지 2장은 그래픽/슬라이드에서 960×720, 모델에서 384×288, 애니메이션/영상에서는 3프레임을 가로로 합친 1176×288 contact sheet였다. 같은 유형 두 조건의 크기는 같다. image block 20개를 실제 rollout에서 확인했으며 별도 이미지 token 항목은 제공되지 않았다.

초기 파일은 두 조건에서 byte hash가 같았다. 완료 PNG는 애니메이션·그래픽·영상·슬라이드의 양쪽 최종 SHA-256이 일치했다. 모델 렌더는 byte hash가 달랐으나 두 최종 이미지를 root가 직접 비교해 같은 폭 변경/배치와 눈에 띄는 결함 없음을 확인했다. 패널 하부가 카메라에서 잘 보이지 않아 폭은 실제 데이터 검증으로 보완했다. 애니메이션의 끝 frame42와 영상의 경계 프레임/전체 재생은 별도 시각 수용을 하지 않았다.

## 실제 선택·오류와 공정성 한계

구조 조건은 다섯 실행 모두 overview 1회를 사용했다. read_many는 모델/그래픽/슬라이드에서 각각 1회, 대상 2/2/4개에 사용했다. 한 객체를 수정하는 애니메이션과 한 caption을 수정하는 영상은 get 1회를 사용해 불필요한 batch를 채우지 않았다. 다중 대상 선택은 목표에 맞았고 엉뚱한 객체/strip 변경은 없었다.

일반 애니메이션은 동일한 list(query:'Orange')를 2회, 초기 preview를 2회 요청했다. 두 초기 PNG의 hash는 같았으며 실제로 본 것은 초기 1장과 최종 1장이었다. 모델의 자기 보고에는 중복이 없다고 했지만 실제 로그를 우선해 중복을 기록한다. 모델/그래픽/슬라이드의 일반 세션은 복수 JSON을 한 stdin에 보내 파싱 오류를 냈고 별도 호출로 복구했다.

일반 슬라이드는 지원하지 않는 read_many를 1회 시도했다. 허용 도구 목록에는 없었지만 공유 api_notes에 read_many 설명이 섞여 있어 안내 혼동 가능성이 있다. 그 오류를 모델 능력 차이나 일반 방식 자체의 필수 비용으로 귀속하지 않는다. 표에는 실제 실패를 포함했고, 해당 1회를 제외하면 슬라이드 성공 조회는 6→2, 전체 성공 조회는 19→10이다. 동일 list 중복까지 제외한 일반 조회는 18회다. 오류/중복 때문에 실제 감소 수치가 커졌으므로 단순 비교를 순수 batching 효과로 해석하지 않는다. 지침을 수정해 유리한 값이 나올 때까지 재시도하지 않았다.

## 검증·종료·실행 기록

root의 최종 control verify도 10/10 통과했다. 시드와 고정 adapter/worker/client/guide 생성기 input hash의 변경은 0건이었다. native 검사는 요청된 폭/키/strip 값과 나머지 geometry/material/keyframe/strip 상태를 비교했다. 애니메이션 변경 채널의 자동 파생 handle 좌표와 evaluated pose는 보존 비교에서 제외하되 다른 채널의 키와 값은 비교한다. document 검사는 whitespace-only formatting 외 전체 XML tree를 요청 변경만 허용해 비교했다. 모든 종류의 숨은 상태를 완전히 보존했다고 일반화하지 않는다.

Blender는 기본 실행에서 Python 오류에도 exit 0을 반환했다. 최초 final export는 media_type 설정 누락으로 실제 MP4/완료 JSON이 없었는데 exit만 보고 성공으로 잠시 보고했다. 로그/파일 확인 후 즉시 정정했고, media_type='VIDEO' 및 --python-exit-code 1로 재실행해 실제 두 MP4 파일과 FINAL_EXPORT_PASS를 확인했다. 최종 export exit 0, 각 96프레임·22,838바이트, .blend source hash 보존을 확인했다. 인코딩 성공과 전체 재생 시각 확인은 구분한다.

worker session 50575는 stop 파일 후 native exit 0으로 끝났다. 기존 프로세스 identity 1개(PID+생성시각)를 고정했고, 최종 export/resource probe도 native exit 0 뒤 관련 프로세스 0·기존 identity 생존 0을 CIM으로 확인했다. ps1 파일 실행은 로컬 execution policy로 거부돼 정책을 바꾸지 않고 허용된 대화형 CIM cmdlet/stop 파일 작업을 사용했다. 강제 종료나 삭제 우회는 사용하지 않았다. Blender의 실제 CONFIG/SCRIPTS/DATAFILES/TEMP 경로가 모두 cr01 아래임을 별도 runtime probe로 확인했다. Chrome profile도 variant 아래였고 종료 후 관련 프로세스가 없었다.

등록/준비는 UTC 2026-11-02 13:52경, worker 준비는 13:59경, 비교 모델은 14:00~14:04경 겹쳐 실행됐다. 이후 root의 시각 비교·control verify·최종 export 오류 진단/재실행·리소스/종료 확인을 수행했다. 전체 시간에 fixture/adapter 구현과 root 검증이 포함되므로 세션 시간 합을 총 소요로 표시하지 않는다. 단일 backend queue에서 native 작업을 직렬 실행했고 모델 제공자의 capacity 오류도 있어 속도 차이를 도구 고유 지연으로 주장하지 않는다.

## 판단

Serena의 핵심 원리인 계층 개요·대상 식별·관련 대상 일괄 읽기는 이 다섯 유형에 적용 가능했다. 그러나 .blend의 객체/애니메이션/strip, SVG의 layer/element, 슬라이드의 chart/group을 다루는 native adapter가 필요했다. 코드 심볼 조회를 그대로 붙인 검증은 아니다. 실제 Blender MCP·Serena plugin·GUI 조작의 비교로 표현하지 않는다.

이번처럼 대상이 이미 알려진 작은 수정에서는 개요 우선 사용이 불필요한 읽기가 될 수 있다. 목표별 판단은 다음과 같다.

- 3D: 두 연관 부품을 한 번에 읽는 이점이 있지만 전체 장면 개요가 꼭 필요하지는 않았다.
- 애니메이션·영상: 대상 하나에서는 채널/시간 구간의 필요한 속성만 읽는 것이 핵심이며 batch 이점은 작았다.
- SVG·슬라이드: 관련 element들을 묶어 읽는 것은 유효했지만 전체 문서 개요 비용이 커졌다. branch/slide/selected group 범위 개요가 더 적합한 후속 후보이다.
- 구조를 먼저 항상 읽도록 강제하기보다, 이미 대상 ID를 아는 경우 곧바로 선택 필드 일괄 조회하고 모를 때만 scoped overview를 여는 정책을 후속 검토한다. 적용 가능성과 비용 절감은 별개다.

생성형 이미지의 prompt/참조 탐색·픽셀 마스킹·모델 생성 반복, 조형 품질·물리 simulation·리깅·복잡한 긴 영상/오디오·실제 PowerPoint·다른 모델/OS는 미검증이다. 작업 수 1쌍/유형이므로 일반적 우열 판단은 유보한다.

## 정리 전 독립 증거

상세 일회성 자료는 아래 hash와 위 결과를 보존한 뒤 삭제한다. 원래 모델 rollout은 기존 Azrael 세션 owner에 남고 정리 대상으로 복사/재등록하지 않는다.

| cr01 자료 | SHA-256 |
|---|---|
| analysis.json | 934b811a4d25ca4dce68fe50c508eb4bf995274192d67e0666858043b8c2e043 |
| calls.jsonl | c8f137b6ac4e993e9ceaa33191b0569d1777a94de665a86ad9acb60939927d65 |
| frozen-inputs.json | 32b51d0e0abd6a011ad3d337c57014d957bc985270cb76f288d94e0ca26c6f92 |
| input-verification.json | 5b93f951cea6f6d685cee0c28663c428c2d96cccac395da467089afe7a6568b0 |
| final-checks.json | c270e459b874579f4120b31ddae99c432ed48d7ab0dee6703cc22c43d2f1529b |
| final-export.json | 3b34f9b391a3bdd18fc15a9d31cdb87313ff64fe93bb5f1e2c87c9a7959d9a00 |
| resource-paths.json | 2914912482ae8ba6b217ea8bd3230b2554345b68bad6a30e8c461cda5be93e86 |
| process-stop-verification.json | ac35efa85d9f4c6c4f74f1bb0eb97b7404639bf299aeafb899e5c893721b9fd9 |

## 정리 완료

현재 resolveMaintenanceCommand가 검증한 standalone owner의 register·registered review·apply는 각각 exit 0이었다. review blockers/references는 비어 있었다. 논리 크기 49,506,128바이트의 fixtures/variants/MP4/PNG/Chrome profiles/cache/일회성 adapter/harness/log를 fresh token의 delete로 처리했다. attempt `attempt-45612-5379-1793629165720`, group/item deleted, remaining:false, error:null, aborted/cancelled false였다. 실제 cr01 부재와 lifecycle finalized(remaining/references/blockers 빈 배열)를 확인했다. 강제 삭제·권한 변경은 하지 않았다.

보고서만 유지한다. 제품 source·Serena 기본 연결·사용자 설정·공유 지침은 변경하지 않았으며, 모델 원본 rollout은 기존 세션 owner가 관리한다. 이 문서만 로컬 커밋하고 다른 작업의 source/index를 보존한다.

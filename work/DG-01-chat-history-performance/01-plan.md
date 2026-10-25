상태: 추가 최적화 구현, Windows 소스 21개·화면 155개 검증과 임시 산출물 정리 완료. 이번 변경만 로컬 커밋하며 빌드·설치는 별도 범위다.

# 채팅 기록 목록 성능 개선

## 추가 최적화 — 2026-10-25

- 사용자가 최신 설치본에서 속도 개선을 확인했으며 더 빠른 첫 표시를 요청했다. 설치본의 정확한 버전과 click→paint 수치는 독립적으로 확인하지 않았다.
- 기존 50개 페이지·일반 200개 범위·스크롤 없는 후속 조회·전체 메타데이터 검색·native 필터/키보드 동작은 보존한다. 공통 UI 변경으로 Windows x64, Linux x64, macOS ARM64에 적용하며 실제 실행 검증은 Windows에서 한다. 빌드·설치·배포는 이번 범위에 포함하지 않는다.
- 재사용 조사: native On 트리거가 이미 z() recent-history feed를 구독하지만 주입한 검색 훅도 별도로 z()를 호출한다. 트리거 feed를 vn 메뉴에 전달하여 중복 registry/query 구독을 제거한다. native 컴파일러 메모에 loadAll 의존성을 추가해 행 배열이 같아도 host/scope 변경을 전달한다. 새 라이브러리는 필요하지 않다.
- root 소유: injector, 해당 동작 회귀 테스트, owning UI 문서, 본 기록. history_render 소유: 기존 renderer의 임시 성능 비교 모드와 최종 native light/dark 검증. 렌더러에 전달하는 historyQuery 계약은 동일하다. 실행 중인 입력은 고정한다.
- 행 렌더링 비용 후보는 50행(진단용), 200행, 200행+CSS content-visibility 비교로 평가한다. 목록 범위를 50으로 축소하지 않는다. CSS 후보는 성능·키보드·스크롤 근거를 얻기 전 제품에 적용하지 않는다.
- 첫 벤치마크는 공유 catalog.lock 점유로 등록 전에 exit 1; 브라우저와 산출물은 생성되지 않았다. 잠금은 제거/우회하지 않았다. 중복 구독 변경과 테스트 준비는 독립적으로 진행하며 실행 검증은 정상 해제 후 재개한다.
- 사용자는 다른 작업이 실행 중이라고 확인했다. 첫 대기 감시의 결과 전달은 실행 환경의 btoa 미지원으로 실패했으며, 이후 직접 확인에서도 잠금이 존재했다. 이 감시 실패를 잠금 해제나 테스트 성공으로 취급하지 않는다. Node 감시 프로세스가 직접 종료 신호를 쓰는 방식으로 대기를 재개한다.
- 완료 조건: source 동작 회귀, pinned native React/CSS light/dark 상호작용, 성능 측정의 한계와 결과 기록, 산출물 정리 및 이번 변경만 로컬 커밋. 실제 설치본 가속 배수는 측정 없이 주장하지 않는다.
- 소스 회귀 21개 통과(exit 0), UTC 07:09:16.224~07:11:06.078, 109.854초. 결과: artifacts/tasks/DG-01-chat-history-performance/runs/2026-10-25T07-09-16-192Z-9d488d2c-0f60-4d91-87e8-7a44d3cba805/reports/results.json. 변경된 runner의 fixture 사전검사 계약(files)이 누락된 첫 호출은 산출물 생성 전 TypeError로 종료됐고, 동일 bundle의 files를 제공해 재실행했다.
- 행 렌더링 비교는 theme별 8회 준비 후 30표본을 교차 수집했다. double-rAF paint 기회 proxy 중앙값/p95(ms): light 50행 89.8/105.8, 200행 334.5/389.5, 200행+CV 313.4/341.2; dark 50행 91.7/107.4, 200행 334.2/404.8, 200행+CV 319.7/399.7. DOM은 50행 1,070개, 200행 4,220개이며 CV도 4,220개다. native 팝업 배치·설치 bridge/IPC·조회 구독 비용은 측정 범위 밖이다. 첫 rAF 시각 뒤 강제 geometry 계산이 있어 이 시각을 실제 첫 paint로 해석하지 않는다.
- timing run의 마지막 행 focus 진단은 CV에서 실패(exit 1). timing 재수집 없이 진단만 재실행해 양테마 baseline 50/200은 focus 후 visible=true, CV 200은 focus됐으나 visible=false이며 explicit scrollIntoView 후에만 보이는 것을 확인했다(exit 0). 따라서 CV CSS는 제품에 적용하지 않는다. 사용자 설치본의 개선 배수나 공유 feed 변경의 독립 가속 수치는 이 비교로 확정하지 않는다.
- normal 화면 검증의 최초 실패는 concurrent waiting UI가 static blue로 바뀌었지만 fixture가 회전을 기대했기 때문이다. owning injector와 verify-team-ui-render의 최신 계약에 맞춰 해당 기대만 수정한다. 두 공유 잠금(native maintenance.lock과 producer catalog.lock)은 등록/정리 시 다시 점유돼 실패한 시도가 있으며 기존 잠금은 그대로 보존했다.
- 임시 benchmark/replay 제거 후 최종 normal155는 exit 0, 약 34.2초. 제품 입력 SHA256 192f306dee1e137ee3fc7c0c0e4801ba0103b2c38f3925aff5b558bcf8308946으로 timing/진단과 동일하다. 담당자가 light/dark 검색 loading/ready/error 및 waiting screenshot 8개를 직접 확인했고 브라우저 exit0, processIds[]와 producerStopped를 확인했다. 공유 feed·host callback 전달 회귀 테스트는 지속 계약 보호용으로 유지한다.
- 독립 검증 자료는 artifacts/tasks/DG-01-chat-history-performance/runs/20261025T071825635Z-88a6cccc-52c2-4d76-9630-01aaa6e8f0ab 에 source 결과/로그, 5개 renderer run의 summary/producer, 최종·진단 screenshot을 보존했다. source 결과의 현재 경로는 reports/source-results.json이다. 원본 browser profile은 이 자료에 포함하지 않았다. native 등록이 다른 작업의 잠금으로 여러 번 거절돼 대기했고 정상 해제 후 같은 경로로 재개했다.
- 정리 결과: native register→registered review→명시적 apply를 거쳐 원본 source 1개·renderer 5개 묶음 285,187,118 logical bytes를 삭제했다. 6개 모두 status=deleted, remaining=false, error=null이며 소유 lifecycle도 finalized, remaining/references/blockers=[]로 마감했다. 물리 회수 바이트는 도구가 산출하지 않아 주장하지 않는다. 독립 근거 743,554 bytes는 설치 수용이 이 소스 버전을 포함하거나 해당 동작을 폐기할 때 재검토하도록 명시적 defer했다. 이전 작업/다른 작업의 자료는 삭제하지 않았다.
- 최종 제품 입력 해시는 위 검증 해시와 일치함을 재확인했다(exit 0). 임시 성능 측정 코드는 제거했으며 제품에는 공유 구독만 적용했다. 실제 설치본의 추가 가속 수치와 Linux/macOS 실행은 미검증이다.

## 합의된 목표와 권한
- 첫 50개부터 즉시 반영하고, 스크롤 없이 다음 페이지를 미리 조회한다. 일반 목록의 기존 200개 범위는 유지하며 50개씩 끝까지 자동 prefetch한다.
- 검색은 현재 작업공간의 전체 적격 로컬 대화 메타데이터를 cursor 종료까지 조회한 뒤 결과를 표시한다. 일반 200/expanded 500 제한을 검색에 적용하지 않는다. 검색 대상은 기존 제목 매칭이며 대화 본문 전체 검색으로 변경하지 않는다. Cloud task 조회는 기존 native owner를 유지한다.
- 이번 권한은 구현·문서·테스트이다. 설치·배포·원격 push는 별도 권한이며 실행하지 않는다.
- 공통 적용 대상: Windows x64, Linux x64, macOS ARM64 로컬 UI. Windows에서 소스·구문을 확인했으며 실제 호스트와 타 OS 수용은 아직 확인하지 않았다.

## 설계와 재사용
- scripts/inject-recent-chat-filter.cjs가 pinned upstream UI 26.1007.21434의 native runRecentConversationRefresh, Uva query hook, vn 메뉴를 변환한다. 기본 50→200 변경이 기존 코드와 계약에 확인되었다.
- 기존 상태 저장·active/pinned 유지·정렬·콜백 batching을 native publish 부분에서 재사용한다. 페이지당 50개, 페이지별 publish와 event-loop yield 후 다음 페이지 자동 조회. warm 목록은 마지막 페이지 전까지 유지하고 후속 페이지 실패 시 이미 표시한 행을 보존한다.
- 원래 native hydration, state DB 조회, refresh 요청 병합과 직렬화, originator/cwd/provider/source/archive 필터를 유지한다.
- 검색은 azrael-search mode로 적격 host 요청을 수행한다. 전체 성공 전에는 메뉴에 native loading, 실패 시 native error/retry를 사용한다. 검색 중 텍스트 변경은 동일 요청·완료 snapshot을 재사용한다.
- snapshot 행은 현재 manager 상태로 재해석해 제목 변경·보관·삭제를 반영한다. 별도 snapshot으로 일반 200행 refresh가 전체 검색을 잘라내지 않게 한다. 검색 해제/재진입과 unmount 후 늦은 응답은 token과 effect cleanup으로 분리한다.
- native searchThreads는 thread/search의 본문 snippet 의미가 다르고 listAllThreads는 최근 목록의 표시/작업공간 경계를 그대로 보장하지 않는다. 기존 recent-thread 요청과 hydration writer를 확장한다. 새 의존성이나 가상화는 추가하지 않는다.
- namespace transform cache에 query asset도 연결하고 기존 ui.recent-chat-filter feature와 테스트를 확장한다.

## 변경 소유
- root: injector, source tests, namespace cache target 연결, owning architecture와 같은 작업 기록, project-maintenance의 이번 두 test bundle 및 feature inventory의 이번 범위.
- history_render 담당자: scripts/verify-session-flags-render.mjs의 native light/dark 검색 fixture 확장. 다른 작업 변경은 보존한다.
- 관련 architecture: docs/architecture/azrael-ex.md Recent-chat list, docs/architecture/ui-presentation.md Recent-chat header initialization. 새 동작은 검증 전 target으로 기록했다.

## 검증 준비와 결과
- source bundle recent-history-progressive: node --test scripts/test-recent-chat-filter.cjs scripts/test-session-flags.cjs scripts/test-namespace-cache-owner.cjs.
- render bundle recent-history-render: node scripts/verify-session-flags-render.mjs. 기존 native React/CSS와 입력/플래그 검증에 전체 검색 loading·완료·재시도·부분 결과 비노출·query 해제/늦은 응답·일반 cap 갱신 보존을 추가한다.
- source 테스트는 20개 모두 통과(exit 0). 페이지별 50/100/150/200 반영, 다음 페이지 지연 중 첫 페이지 표시, 후속 실패 보존, 짧고 빈 페이지·중복 행·반복 cursor, 617행 전체 검색, warm/active/pinned 유지, 실제 native query owner 및 production transform 통합을 확인했다.
- 최종 소스 결과: artifacts/tasks/DG-01-chat-history-performance/runs/2026-10-22T15-14-09-766Z-5fe96a03-92e5-46ce-a8e0-b2eecfc5d978/reports/results.json 및 같은 run의 logs/01-recent-history-progressive.stdout.log. 실제 suite 시간 약 41.30초, runner 시작/종료 UTC 15:14:09.774~15:14:51.151.
- 화면 검증은 Windows pinned native React/CSS에서 155항목 통과(exit 0), light/dark screenshot 24개를 보존했다. 이 중 검색 loading·완료·error screenshot 6개를 담당자가 직접 열어 확인했다. 실제 브라우저 입력으로 query 변경·초기/중간 결과 비노출·최종 결과·재시도·검색 해제 후 늦은 응답·일반 capped refresh 후 전체 snapshot 보존을 확인했다. renderer 시간 약 29.31초, UTC 15:15:11.622~15:15:40.930이며 브라우저 종료 및 profile 소유 프로세스 부재를 확인했다.
- 독립 화면 근거: artifacts/tasks/DG-01-chat-history-performance/runs/20261022T151714784Z-2e67a52a-d6fb-40c7-8ed1-3c610b84ad62/reports/render-summary.json, renderer-producer.json 및 outputs/의 screenshot 24개. 원본 summary의 sourceRunRoot와 inputSha256을 보존했다.
- 초기 테스트에서 전체 검색 요약을 지우는 native cleanup 조건과 중복 헤더 anchor가 발견돼 수정했다. 이후 native project_tests 실행은 10초 one-shot 한도에서 exit 124, producer_completed:true로 종료했다. 이 실패를 성공 receipt로 바꾸지 않고 기존 test-project.runSelection의 동일 bundle argv를 실행해 위 결과를 얻었다. 테스트 명령/원인/원래 상태는 native run-61016-1483-1792681927289741400(exit 1), run-61016-1487-1792681960788597700(exit 124)에 남는다.
- 최초 renderer 시도는 catalog.lock EEXIST로 exit 1, native test 시도는 exclusive lock 오류로 시작하지 못했다. 사용자에게 다른 작업 실행 중임을 확인했고 잠금을 제거하거나 우회하지 않았다. 두 잠금의 실제 해제를 fs.watch 완료 신호로 확인한 뒤 재실행했다. 완료 신호 workId: 23d7ab1d-0d84-45c7-aa48-e42ed5c9f5c9. 시간 지연은 이 공유 자원 대기와 위 두 원인에 따른 재실행을 포함한다.
- 최종 source/render 입력 소비 중 제품 소스 변경은 하지 않았다. node --check, git diff --check와 JSON parse도 exit 0이었다. native receipt, source 동작 확인, 화면 fixture 수용, 실제 설치본 수용은 서로 구분한다.

## 남은 작업과 수용 조건
1. renderer 원본 run:verify-session-flags-render:20261022T151511622Z-20600ea0-d74a-439f-8736-313ffc5d4a99는 독립 근거 보존과 producer 종료 확인 후 project_inventory 등록·review를 거쳐 delete했다. project_cleanup_apply의 실제 결과는 deleted, remaining:false, error:null이며 약 95,695,342 logical bytes의 profile/fixture/raw run을 제거했다. 다른 작업이나 사용자 프로필은 정리하지 않았다.
2. source 결과 약 4.8KB와 독립 화면 근거 약 331KB는 같은 관리 경로에서 명시적으로 defer한다. 이후 설치 수용 근거가 이 검증을 포함하거나 해당 기능 버전을 폐기하면 재검토한다. fixture/profile 전체를 근거 보존을 이유로 남기지 않는다.
3. project-maintenance.json과 scripts/azrael-feature-contracts.json은 기존 다른 작업의 변경이 있어 이번 bundle/feature 부분만 index에 반영했다. 나머지 작업 파일과 이 기록을 함께 커밋한다. 원격 push는 하지 않는다.
4. 실제 사용자 설치 환경의 click→첫 paint 성능 수치는 아직 측정되지 않았다. 빌드·설치를 실행하지 않았으며 설치본 적용이나 속도 배수는 보장하지 않는다. Linux/macOS 실행 검증은 하지 않았다.

상태: 구현·격리 재현 진행 중. 2026-10-13 사용자 지시로 코드 수정과 격리 프로필 재현·원인 분석·검증을 수행한다. 일반 프로필 설치·전체 앱 배포 빌드는 이번 범위에 포함하지 않는다.

# 세션 재개에 따른 작업 묶음과 시간 기록 수정 계획

새 세션에서 한 턴만으로 작업 묶음과 조회 오류가 표시되는 동작을 고친다. 모델의 세션 재개 도구 사용이 3회 이상일 때 묶음을 표시하고, 재개 관계·기록 조회·상태 병합·대화 경계가 같은 기준을 따르도록 바꾼다.

## 결정할 기준

횟수 3은 확정된 사용자 요구다. 다음 두 가지는 구현 전에 확정해야 한다.

1. 횟수를 같은 연속 작업 안에서 셀지, 대화 전체 누적으로 셀지 결정한다. 같은 연속 작업 안에서 세는 방식을 추천한다. 서로 다른 요청의 사용 횟수가 더해져 새 작업이 처음부터 묶이는 현상을 막을 수 있다.
2. 성공적으로 대기를 등록한 도구 사용 3회를 셀지, 실제 자동 재개가 실행된 3회를 셀지 결정한다. 문구에 맞춰 성공한 도구 사용을 추천한다. 세 번째 대기에 들어간 시점부터 표시되며, 도구 오류·중복 이벤트는 세지 않는다. 성공 등록 후 취소·교체된 예약은 이미 사용한 횟수에 남긴다. 실제 실행을 선택하면 세 번째 재개가 시작될 때 표시되며, 재개 전 취소·교체된 예약은 세지 않는다.

새 사용자 메시지가 자동 대기를 대신하면 자동 재개와 별도로 구분하는 것을 추천한다. 모델이 다른 세션의 링크를 읽어 작업을 이어가는 행위는 현재 대화의 자동 재개로 세지 않는다. 기존 수동 작업 나누기·합치기는 보존하고, 자동 표시 기준과 어떻게 조합할지 위 기준과 함께 정한다.

## 범위와 권한

허용된 작업은 코드 조사, 작은 읽기 중심 진단 실험, 수정 계획 작성이다. 제품 코드·기능 계약의 구현 변경, 앱 전체 빌드·설치·게시를 실행하지 않는다. 기존 및 동시 변경은 보존한다.

표시·집계·메타데이터 계약은 로컬 Windows x64, Linux x64, macOS ARM64 공통 요구다. 이번 실제 조사는 Windows 체크아웃의 source와 합성 입력 실험이다. 설치된 사진 대상 윈도우의 오류는 source 조사만으로 확정하지 않는다. 원격·컨테이너 환경의 지원 변경은 범위에 없다.

## 현재 구조에서 확인한 문제

| 지점 | 확인한 사실과 영향 | 수정 방향 |
| --- | --- | --- |
| 첫 표시와 조회 | inject-task-work-time.cjs:37은 entries가 하나라도 있으면 요약 행을 삽입한다. :19에서 바로 전체 기록을 조회한다. 재개 횟수 조건이 없어 새 세션에서도 요약·오류가 나타난다. | 표시 자격과 조회 준비 상태를 독립적으로 판정한다. 자격 전에는 묶음·이중선·이 기능의 오류 배너를 만들지 않는다. |
| 새 세션의 조회 준비 | 엔진은 rollout이 없을 때 loaded thread를 찾고, 없으면 thread not loaded를 반환한다. ephemeral thread도 thread/turns/list를 지원하지 않는다. 현재 helper는 준비 판정 없이 조회하고 실패 원인을 일반 문자열로 처리한다. | 기존 connection/loaded-thread gate와 조회 캐시를 재사용하고, 아직 생성 중인 상태와 지원하지 않는 상태를 일반 조회 오류와 구분한다. |
| 작업 관계 | task-work-time.cjs:32는 첫 턴부터 기본 한 그룹을 만들고 수동 경계만 읽는다. 서로 다른 rootTurnId도 한 그룹이 되는 것이 실험에서 재현됐다. | 대화 전체와 연속 재개 작업을 분리하고, 같은 작업으로 확인된 턴만 집계한다. |
| API 관계 누락 | thread/turns/list는 rootTurnId와 rootResumeWait만 전달한다. 저장된 parentTurnId·turnTrigger는 history 재구성에서 빠진다. 사용자 입력이 대기를 대체한 턴도 이전 rootTurnId를 이어받아 root만으로 새 작업 경계를 구분할 수 없다. | 이미 저장된 attribution을 history·wire·live 계약에 연결하고 사용자 대체 턴과 자동 재개 턴을 구분한다. |
| live 결합 | task-work-time-history.cjs:65의 정규화에서 rootTurnId가 빠진다. 신규 live 턴은 root 식별자를 잃고, 누락 턴은 배열 끝에 추가돼 a,c,b 순서가 된다. | 관계 필드를 모든 데이터 경로에서 보존하고 native 기록 순서·parent 연결로 일관된 순서를 구성한다. |
| 늦은 상태 | :80 이후 대기 병합은 같은 reservationId일 때만 revision을 비교한다. 다른 예약의 stale live 대기가 새로운 완료 예약을 덮어쓰는 것이 재현됐다. | reservationId가 다른 기록의 선후 관계를 별도로 검증한다. terminal 동결과 최신 종료 경계를 유지한다. |
| 화면 경계 | 요약은 대화 맨 앞, 하단 선은 마지막 entries에 붙는다. 수동으로 여러 작업을 만들거나 기록이 일부만 로드돼도 선은 해당 작업의 실제 범위를 식별하지 못한다. | 자격 있는 작업의 첫·마지막 실제 턴에 맞춰 이중선을 배치하고 native 가상 목록에서 측정한다. |
| 검증 경계 | 기존 renderer는 합성 metadata manager와 scroll controller를 사용한다. 실제 native 조회 실패나 session 준비 상태를 검증한 근거로 확대할 수 없다. | native 계약 검사와 실제 동일 패키지의 새 세션·재개·기록 조회 수용을 별도로 추가한다. |

실험은 현재 함수를 그대로 호출했다. 서로 다른 root의 결합, 신규 live root 소실, 병합 순서 역전, stale reservation 덮어쓰기를 확인한 소형 근거는 artifacts/logs/task-work-time/investigation/structure-repro.json에 있다. 이 실험은 설치 앱의 오류 원인을 확정하지 않는다.

## 재사용할 재개 기록

모델 도구는 azrael_agents.defer_root이며 엔진의 ROOT_RESUME_TOOL_NAME은 defer_root다. 예약은 originating_turn_id, root_turn_id, call_id, resume_turn_id와 고유 reservation ID를 보존한다. tool result와 history flush가 맞는 뒤 Waiting으로 전환되고 originating 턴이 deferred가 된다. 자동 재개 턴은 미리 지정된 resume_turn_id, 같은 root_turn_id, parent_turn_id=originating_turn_id, turn_trigger=root_resume로 생성된다. 별도의 영속 재개 횟수 필드는 없지만 이 기록을 이용할 수 있다.

단, 사용자 입력이 활성 예약을 대체해도 그 예약의 root_turn_id를 이어받는다. rootTurnId 하나만으로 자동 재개를 판정해서는 안 된다. 실패 호출·준비 중인 예약·서브에이전트 재개·다른 대화의 링크 읽기를 자동 재개 횟수로 섞지 않는다. 같은 이벤트를 다시 받은 경우에도 reservation/call 식별자로 한 번만 처리한다.

thread/turns/list의 Turn에는 parentTurnId·turnTrigger가 없다. TurnStartedEvent.turn_attribution에는 두 필드와 rootTurnId가 저장되어 있지만 thread_history.rs:1309의 handle_turn_started는 rootTurnId만 복사한다. ThreadHistoryTurnMetadata와 wire Turn 변환도 두 필드를 전달하지 않는다. 기본 3회 판정은 기존 rootResumeWait로 가능하지만, 사용자 입력 대체 이후의 새 작업 경계를 정확하게 나누려면 이 저장된 attribution을 노출해야 한다.

따라서 기존 저장 필드를 history builder·metadata·wire Turn·live 변환·생성 타입에 연결하는 것을 제안한다. 오래된 기록에 attribution이 없으면 추측으로 자동 재개를 확정하지 않고 불확실 상태를 유지한다. 메시지 전체를 다시 불러오거나 새 별도 집계 저장소를 먼저 만들 필요는 없다.

## 시간 기록 조회와 사진의 오류

Pinned native caller는 manager.listThreadTurns(threadId, options)의 결과를 response.data로 읽는다. cursor, limit, sortDirection=asc, itemsView=notLoaded는 유효한 protocol이다. 현재 helper의 호출 형식이 잘못됐다는 근거는 없다.

엔진 thread_processor.rs:3100 및 :3525 이후 경로는 저장 rollout이 없을 때 loaded thread를 찾고, 없으면 InvalidRequest(thread not loaded)를 반환하며 ephemeral thread에는 해당 API를 지원하지 않는다. 따라서 생성·로드 전 조회가 실패할 수 있다. 현재 helper에는 readiness gate와 오류 분류·진단이 없고, dispose는 늦은 화면 게시만 억제한다. transport 자체의 timeout/cancel 계약은 기존 native 요청 경계에 맞춰 확인한다.

기존 native 상태 조회에는 connection/app-server gate, host 재확인, 기본 retry 1회와 staleTime 30초의 cache가 있다. tail_history 경로의 background 조회와 scripts/root-resume-wait.cjs의 event 기반 조회·query_failed 진단을 우선 재사용한다. 새 무한 polling이나 준비 상태에 대한 즉시 반복 요청을 추가하지 않는다.

사진의 실패 메시지는 helper의 일반 오류 표현이므로 원인은 아직 특정하지 않았다. 사진 대상 host·현재 thread ID·실행 패키지·창 reload 상태를 확인하고, 실제 첫 실패의 method/error code/readiness를 기존 진단 경로에서 수집한다. message body나 도구 인자를 진단에 추가하지 않는다. 준비 중, 일시 연결 실패, 기록 누락·손상, API 지원 불일치를 분류한 뒤 대응한다. 유효한 기존 snapshot은 유지하되 부분 합계임을 표시하고, 새로 비어 있는 결과를 0시간의 확정 총계로 표현하지 않는다.

## 수정 순서와 소유권

1. root resume 예약·턴 관계의 native metadata 계약을 확정한다. 기존 parentTurnId·turnTrigger 저장 필드를 history builder·Turn metadata·wire 변환·live 변환·생성 타입에 연결한다. call/result 중복·취소·교체·사용자 입력 대체와 과거 attribution 누락을 포함한다. 산출물은 UI가 읽는 동일한 관계·횟수 판정 규칙이다. scheduler 자체의 동작 변경을 표시 기능과 섞지 않는다.
2. task-work-time-history.cjs를 native metadata adapter로 정리한다. 관계 필드·기록 순서·최신 상태를 보존하고, 실제 조회 실패 원인에 맞춰 준비·복구·구독 해제를 처리한다. 기존 query/cache/transport 기능을 우선 재사용한다.
3. task-work-time.cjs에서 작업 구성과 시간 합산을 분리한다. 재개 3회 자격과 수동 경계를 적용한 뒤 기존 실행·자동 대기 구간의 합집합 계산을 재사용한다. 사용자 응답 대기 제외와 병렬 중복 제거를 보존한다.
4. inject-task-work-time.cjs에서 자격 있는 작업만 native 측정 행으로 표시한다. 각 작업의 실제 대화 범위를 이중선으로 표시한다. 조회 실패를 숨겨서 해결하지 않고, 표시 자격과 실제 데이터 준비를 구분한다.
5. native 계약·상태·새 세션·실패 복구·빠른 스크롤을 검증하고 소유 계약 및 ui.task-work-time 보존 목록의 검사를 갱신한다. 전체 빌드·설치가 필요하면 별도 지시 범위를 확인한 뒤 수행한다.

현재 선행 조건은 위의 횟수 의미와 사용자 입력 대체 시 작업 경계의 합의다. native 관계 노출의 부족은 확인됐으며 보완 범위는 위 1단계에 명시했다. 계약을 확정하면 metadata adapter와 계산을 연결하고 UI가 이를 소비한다. 이번 조사 담당자는 읽기 전용이며 구현 파일을 소유하지 않는다. 구현 시 공유 계약을 root가 먼저 고정하고 수정 소유권을 배정한다.

## 성공 기준과 검증

- 재개 0·1·2회인 새 세션에서는 요약·이중선·시간 조회 오류 배너가 없다. 3회에서 정확히 한 번 나타나고 처음 작업부터의 시간과 해당 대화 범위를 표시한다.
- 실패·중복·교체·취소·수동 재개·서브에이전트·다른 세션 링크 읽기의 횟수가 합의한 기준에 맞는다. reload 이후에도 판정과 총계가 같다.
- 사용자 입력이 대기를 대신한 턴과 독립 작업을 자동 continuation으로 오인하지 않는다. 수동 나누기·합치기와 기존 경계 저장을 검증한다.
- 실제 native manager/protocol로 다중 페이지와 새 thread readiness를 확인한다. 과거·live가 역순 도착하거나 예약 ID가 바뀌어도 관계·순서·완료 시간을 되돌리지 않는다.
- API 실패·연결 복구·늦은 응답·대화 전환·종료 이후 결과를 검증한다. 다른 대화의 결과가 현재 대화에 섞이지 않는다. 표시에 자격이 없을 때 새 구독·요청을 남기지 않는다.
- 각 작업의 이중선과 요약이 native 가상 목록 높이 측정에 포함된다. 일부 history, 추가 로드, 새로운 마지막 턴, 여러 작업, 밝은·어두운 테마, 빠른 스크롤을 실제 화면 위치로 검증한다.
- 시간 계산의 사용자 응답 대기 제외·자동 대기 포함·병렬 중복 제거·완료 동결·불확실 기록 표시를 유지한다. 소스 검사, native fixture, 실제 package/installed 검증 범위를 구분한다.

## 근거 위치

- 현재 소유 계약: docs/architecture/task-work-time.md.
- 표시·조회·병합·계산: scripts/inject-task-work-time.cjs, scripts/task-work-time-history.cjs, scripts/task-work-time.cjs.
- 준비·지원 조건: engine/codex-rs/app-server/src/request_processors/thread_processor.rs:3100, :3525. 기존 진단·event 복원: scripts/root-resume-wait.cjs:128, :202.
- native 호출: artifacts/upstream-ui/26.1007.21434/webview/assets/app-initial-c014f9ee4429.js:1246의 Yqi, local-conversation-thread-2429c4b61076.js:1의 tail_history/thread_hydration.
- 재개 등록·commit·dispatch: engine/codex-rs/core/src/tools/handlers/root_resume.rs:19, core/src/session/root_resume.rs:303, :386, :818, :869, :954 및 core/src/session/turn_input.rs:307.
- 재개 metadata: engine/codex-rs/protocol/src/root_resume.rs:82, app-server-protocol/src/protocol/thread_history.rs:107 및 protocol/v2/thread_data.rs:386.
- 저장 attribution과 API 누락: engine/codex-rs/protocol/src/protocol.rs:2246, protocol/src/turn_input.rs:56, app-server-protocol/src/protocol/thread_history.rs:105·136·1309, protocol/v2/thread.rs:1773 및 protocol/v2/thread_data.rs:386.

계획 검토 뒤 확정된 요구만 owning architecture에 반영한다. 이 계획 작성으로 제품 코드를 수정하거나 미검증 동작을 current로 표시하지 않는다.

## 실행 기록

- 2026-10-13: 같은 연속 작업의 성공한 defer_root 대기 등록 3회를 기준으로 실행한다. 사용자 입력이 대기를 대체한 경우 새 자동 작업 경계로 구분한다. 기존 사용자 수동 경계는 보존한다.
- 선행 조건: 기존 구현 사본을 artifacts/verification/task-group-20261013/baseline-scripts에 고정했다. engine metadata와 UI 그룹 구성은 독립 담당자가 소유하고 root는 history adapter·실제 격리 프로필 재현·통합·검증을 소유한다. 기존 dirty 변경을 보존하며 별도 worktree는 만들지 않는다.

- 공통 제품 동작은 지원 대상의 로컬 대화에 적용한다. 이번 실제 검증 환경은 Windows x64이며 Linux/macOS 및 원격·컨테이너 수용은 검증하지 않았다. 전체 앱 빌드·일반 프로필 설치·배포는 이번 실행 범위에 포함하지 않는다.
- 05:40 UTC: pinned native 가상 목록을 사용하는 격리 Chrome renderer 검사 70개 통과(exit 0). 기존 장식 적용 목록은 화면 밖에서 돌아온 뒤 접을 때 높이가 5535.890625px에서 53.140625px로 바뀌며 ResizeObserver loop 오류가 2회 발생했다. 같은 176개 행의 원본 native 목록에서는 오류가 없었다. native 동기 측정 갱신을 대상별 프레임 배치로 바꾼 뒤 오류가 사라졌다. 관리 객체·scroll controller는 합성 fixture이며 실제 VS Code 호스트 수용과 구분한다. 로그: artifacts/logs/task-group-20261013/ui/.
- 첫 사용자 메시지 전 native thread/turns/list의 materialization 오류를 실제 app-server로 재현했다. baseline helper는 일반 실패로 표시했고 수정 helper는 notLoaded/error=null로 분류했다. 실제 turn/started 뒤 interrupt 및 재조회에서는 ready/1턴으로 회복했다. ephemeral 미지원도 구분했다. 이것은 API 준비 상태 재현이며 사용자가 첨부한 원래 사진의 동일 원인을 확정하지 않는다. 로그: artifacts/logs/task-group-20261013/native/summary.json.
- UI 집중 검사 31개, history 최종 검사 14개, deferred/history 통합 검사 57개가 각각 exit 0으로 통과했다. 중복되는 검사를 합산한 테스트 수로 보고하지 않는다. parent/trigger 보존, native 기록 순서, 서로 다른 예약 ID의 revision 비교 금지, terminal 상태 및 알려진 관계 보존을 확인했다. 로그: artifacts/logs/task-group-20261013/ui/node-tests.log 및 history/.
- 05:27 UTC: native protocol thread_history 검사 67개 통과(exit 0). 생성 schema의 Turn 관계 필드 및 압축 bundle의 기존 항목 보존 검사가 통과했다. SQLite 신규/기존 history migration은 예약·시간 정보를 보존하고 관계 필드만 nullable로 추가했다. store/app-server 테스트와 테스트용 CLI는 공유 Cargo cache의 타 작업 잠금이 풀릴 때 진행한다. 별도 중복 컴파일이나 타 작업 종료는 수행하지 않는다.
- 실제 VS Code baseline 프로필 실행은 vscode-updating mutex로 30초 뒤 exit 1이 됐다. 외부 CodeSetup updater가 확인됐으며 간섭하지 않았다. 실패 fixture는 보호 경로·프로세스 참조 확인 후 일반 삭제했고, 재시도 입력과 네이티브 UI 검사를 준비 중이다. 로그: artifacts/logs/task-group-20261013/host/baseline/. 다음 확인 기준은 05:56 UTC이며 업데이트 완료를 시간 경과만으로 가정하지 않는다.
- 05:55 UTC: 격리 host의 실제 namespace transform 경로에서 virtualized-turn-list 출력 SHA가 입력과 동일했다. transformAsset의 선행 파일 선택 gate가 ROW_ASSET을 제외해 RAF observer 수정에 도달하지 않는 통합 결함이다. 개별 injector 렌더 검사와 실제 pipeline 적용을 구분하며 gate 수정 및 실제 transform 호출 회귀 검사를 추가한 뒤 새 입력 ID로 fixture를 준비한다.
- ROW_ASSET 선택 gate 수정 후 실제 namespace 변환 회귀 8개 통과(exit 0). 해당 신규 회귀는 수정 전에 실패(exit 1)했다. 입력 SHA 13c14c88… → 출력 9ae35cb4…이며 출력은 앞선 70개 renderer 검사 입력과 동일하다. helper 1회, TS parse 오류 0, 두 번째 변환의 동일 출력/추가 변경 없음 확인. 로그: artifacts/logs/task-group-20261013/ui/native-row-namespace-receipt.json.
- native 저장소 첫 검사 exit 101은 신규 테스트가 존재하지 않는 StoredTurnItemsView::Full을 참조한 컴파일 오류였다. 저장 계층의 NotLoaded/Summary로 고쳤으며 Full은 protocol wire 검사 범위다. r2 입력은 유지하고 r3(hash 12e74d96f5fc5ac9a6a81e0234b29323de8d14be955f63ff4a24abee0bece79c)를 06:01:23 UTC에 고정해 같은 집중 검사를 재실행한다. 공유 Cargo lock 대기는 외부 자원 대기이며 테스트 통과로 취급하지 않는다.
- host 최초 실패 summary/log는 후속 prepare 단계에서 덮어써진 문제가 확인됐다. 확정된 도구 출력의 mutex 오류·30,484ms·launch/검사 exit 1·cleanup exit 0만 initial-launch-failure-recovered.json에 복원했다. 이 파일은 원본 raw log가 아니다. 이후 시도는 새 fixture ID와 prepare/seed/launch별 timestamp 영수증으로 분리한다. 새 patched-gatefixed-0600 입력과 합성 4턴·3성공 대기 historical replay 준비 exit 0은 네이티브 화면 검증 통과를 뜻하지 않는다.
- 원본 native-state 재현 fixture는 host의 own seed 사본 인계 후 절대 경로·link·live process 참조를 확인해 일반 PowerShell 삭제를 시도했으나 Hidden .git 및 ReadOnly Git pack 객체에서 실패했다(exit 1). 조회 결과 7,409개 잔여 항목 중 보호 속성 항목 8개이며 진단은 native/cleanup-failure-diagnosis.json에 보존했다. 개별 일반 파일만 선별하는 축소 삭제도 자동 승인 검토가 blocked by policy로 거절했고 구체적인 추가 사유는 반환하지 않았다. 강제 삭제·속성 우회·다른 셸/API 재시도 없이 잔여 fixture를 보존한다. 이후 제거 조건은 프로젝트의 일반 삭제 규칙을 만족하는 정리 경로가 확보되는 것이다.
- scripts/check-task-work-time-native.cjs로 protocol/store/app-server의 실제 집중 검사 범위를 보존 목록 engine.task-work-time에 연결했다. manifest 검사 및 wrapper 구문 검사 exit 0. 현재 작업과 별개인 공유 SOURCE.json drift는 이번 파일 목록에 섞어 재기록하지 않는다. 테스트 입력 provenance는 frozen source manifest·binary receipt로 구분하며 패키징 전 전체 source receipt의 정확한 delta 조정은 별도 소유자들과 합쳐 확인해야 한다.
- 사용자 답변: 업데이트 버튼이 사라졌고, 업데이트하면 작업 세션이 종료되므로 업데이트 없이 작업해야 한다. 기존 Code 창·업데이터·일반 프로필을 유지한다. installed Code.exe는 1.140.0/commit 07f806f999227108933c2e30515b26eecc1fda74이며 새 대기 버전은 1.141.0이다. installed mainImpl.js의 mutex 검사는 user/system target에 적용돼 disable-updates가 해결하지 않는다. 제품 코드나 mutex flag를 변조하지 않는다.
- 공식 ZIP 1.140.0을 별도 검증 fixture에 사용하는 경로를 선택했다. HEAD 200, 355,156,158bytes, redirect commit은 현재 버전과 동일하다. URL: https://update.code.visualstudio.com/1.140.0/win32-x64-archive/stable. 공식 portable 문서 https://code.visualstudio.com/docs/setup/portable 는 Windows ZIP에서만 지원하며 ZIP 자동 업데이트가 없다고 명시한다. 다운로드·추출 hash/버전 확인과 실제 격리 실행은 host 담당자가 소유한다. 이 준비는 업데이트·설치 또는 실제 화면 통과와 구분한다.
- 06:10 UTC: r3 저장소 검사가 공유 Cargo lock을 획득해 state/rollout 컴파일을 시작했다. 같은 단일 batch에서 store → app-server 집중 검사 → 테스트용 CLI 순서로 진행하며 필요한 결과가 준비되는 즉시 호스트 검사에 인계한다.


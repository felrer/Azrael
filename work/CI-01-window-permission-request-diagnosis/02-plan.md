상태: 최신 설치본을 복사한 격리 프로필에서 재현·실시간 잠금 사유 수집 중. 사용자 전역 설치·실제 세션 변경은 범위 밖이다.

# 전체 액세스 메뉴 비활성화 진단

사용자는 앞선 오류 이후 권한 재설정 UI가 잠기고 다른 세션에서도 전체 액세스가 동작하지 않는다고 보고했다. 스크린샷에는 권한 메뉴 trigger가 회색으로 보인다. 사용자는 Window Use 중지 오류와 전체 액세스 잠금을 권장대로 수정하도록 승인했다. 중지 안내와 기존 사용자 재개 경계를 보존하고, 모델 로딩을 전체 권한 pending에서 분리한다. 새 재개 UI·권한 확대는 도입하지 않는다. 공통 JS 로직, Windows x64 설치본 2026.0.10을 조사했다. 실제 다른 OS 및 스크린샷 시점의 React store 값은 확인하지 않았다.

## 확인한 코드와 재현

### 최신 설치본과 지정 세션의 추가 확인

현재 추가 조사는 원인 확인만 승인됐으며 제품 코드·권한 변경, 빌드·설치·사용자 창 재로드는 수행하지 않았다. 대상은 Windows x64 로컬 설치본 `azrael-ex-local.azrael-2026.0.11`, 실행 엔진 `artifacts/build/b13/artifacts/releases/w11aa/engine/azrael.exe`, 세션 `01a16406-4cfe-7671-b08e-107d7c9370a6`, 프로젝트 `C:/Users/felre/Desktop/SufThreads`다. 공통 UI 로직을 조사했으며 다른 OS 실행 검증은 없다.

- 설치 자산의 QXr에서 모델 loading을 전체 permissions pending에서 분리한 기존 수정이 확인됐다. 따라서 아래 2026.0.10의 모델 loading 재현을 현재 증상의 확정 원인으로 적용할 수 없다.
- 해당 창 로그 `C:/Users/felre/AppData/Roaming/Code/logs/20261023T032416/window1/exthost/azrael-ex-local.azrael/Azrael.log`에는 `thread/read`가 `thread belongs to another window`로 실패한 뒤, 복원 응답은 `:danger-full-access / never`인데 UI가 기본 `workspaceWrite / on-request`를 계산한 기록이 있다. 그러나 현재 읽은 globalStorage heartbeat의 해당 세션 권한은 `:danger-full-access / never / user / dangerFullAccess`로 정상이다. 과거 복원 불일치만으로 현재 잠금을 확정하지 않는다.
- state_5.sqlite와 해당 세션의 최신 rollout도 `never` 및 disabled permission profile을 보존한다. 사용자 설정의 해당 프로젝트는 trusted이며 프로젝트 `.codex/config.toml`은 없다.
- 기존 관리 브리지의 읽기 연결 시도는 종료 코드 1로 실패했다. 해당 결과는 조회 성공이 아니다. 연결 실패 후 살아 있는 브리지 프로세스는 없으며 기존 엔진은 종료하지 않았다.
- 같은 설치 엔진을 별도 stdio 연결로 실행해 `initialize`, `config/read`, `configRequirements/read`, `permissionProfile/list`만 호출했다. 모델 요청·thread resume/start·설정 쓰기는 없다. 프로젝트의 명시적 권한 override는 null, requirements는 null, `:read-only`, `:workspace`, `:danger-full-access` 세 프로필 모두 allowed=true였다. stdin 종료 후 실제 엔진 exit code 0. 이 검사는 동일 바이너리·사용자/프로젝트 설정의 조회 결과이며 기존 창의 React cache 또는 window context 조회 결과는 아니다.
- 설치된 QXr/FXr를 기존 test helper로 메모리 실행했다. config/requirements/model loading=false, cwd 고정 시 workspaceKind=`project`이면 permissionsPending=false, workspaceKind=null이면 permissionsPending=true였다. 실제 exit code 0. 이는 추가 잠금 조건의 재현이며 해당 창에서 workspaceKind가 실제 누락됐다는 증거는 아니다.

현재 실시간 React 값과 `yn.wt` 또는 `tn.pe`의 최종 잠금 사유는 기존 로그에 없다. 사용자는 격리 프로필에서 재현해 정확한 원인을 확인하도록 승인했다. 설치본을 새 fixture에 복사하고 user-data/shared-data/extensions/CODEX_HOME을 분리한다. 제품 배포 빌드·전역 설치·실제 사용자 창 재로드는 하지 않는다. fixture-only 계측으로 dropdown 경로, pending 세부 boolean, 오류 boolean, 선택지 수, workspaceKind 존재 여부 및 잠금 사유를 수집한다. 원문 대화·설정·인증 데이터는 결과 요약에 수집하지 않는다. root는 설치 UI 호출자와 조건 추적, 검증 수용 및 이 문서를 소유하고 `isolated_permission_repro` 실행자는 `scripts/verify-permissions-disabled-host.cjs`와 `beginArtifactRun`이 선등록한 `artifacts/tasks/permission-disabled-host/runs/<unique>/` 안의 호스트·프로필·로그를 소유한다. 기존 호스트 검증의 CDP/URI·synthetic auth·loopback metadata 경로를 재사용하고 정상 새 상태 및 세션 복원/창 경계를 비교한다. 실제 권한 제한은 보존하고 실제 모델 요청은 보내지 않는다. 실제 launch·종료·프로세스 확인 후 묶음을 등록·검토하여 보존 또는 삭제하며, 실패 결과도 유지한다. 실제 계측값과 코드 조건이 연결되면 재현으로 수용하고, 재현하지 못한 시나리오는 그대로 기록한다.

격리 실행의 첫 환경 준비 결과: run `20261023T141104502Z-189404e7-9d42-4c4d-8577-1d1f38a29fee`는 설치 VS Code의 `vscode-updating` mutex 대기 후 host 시작 전 실제 exit 1로 끝났다. 실행자 보고상 fixture 프로세스 참조는 없다. 권한 UI 재현 결과가 아닌 환경 실패다. root는 같은 격리 범위에서 기존 task-owned 공식 Windows x64 archive의 읽기 재사용 또는 공식 archive의 새 run 내 다운로드·압축 해제를 승인했다. 전역 업데이트 잠금과 사용자 프로세스는 변경하지 않는다. 재실행은 별도 run으로 보존한다.

현재 격리 관측은 공식 VS Code 1.108.2 archive(SHA-256 `7eb164a3293023a7fcf2d10ac3c02dcf93fb02fc36d370e9ee4d9f0b2cf71ba0`)와 복사한 설치 Azrael 2026.0.11을 사용한다. 사용자 설치 VS Code 버전과 동일하다고 주장하지 않는다. 새 대화(`rmvl25slz`) 및 completed synthetic legacy 대화(`rmvl29kv0`)는 모델·설정 ready 시 메뉴가 활성화됐다. 실제 별도 두 창(`rmvl2hlw0`, fixture `artifacts/pd4`)에서 ownership 오류를 재현했어도 양쪽 workspaceKind=project, modelLoading=false, permissionsPending=false, 실제 DOM 권한 버튼 disabled=false였다. 따라서 ownership 오류 단독을 현재 잠금의 원인으로 볼 수 없다. 최종 two-window command exit0, 두 host 정상 종료, 최대50초 native drain 후 소유 process 검사 exit0이며 [중간 진단 요약](../../artifacts/tasks/permission-disabled-host/runs/rmvl2hlw0/reports/diagnosis-summary.json)에 입력 identity와 관측이 있다. 원인 확정은 아니다.

다음 비교는 알려진 차이인 실제 `paginated/full-access`와 네 권한 선호만 맞춘 synthetic 대화, 필요하면 지정 세션 한 개의 immutable read-only snapshot이다. 원본 `state_5.sqlite`에서 정확한 thread row와 그 rollout만 읽어 격리 DB/파일로 옮기고 cwd/rollout_path를 fixture로 바꾼다. auth·계정·다른 세션·큐·goals·전체 사용자 globalStorage는 복사하지 않는다. 허용된 prefs는 `User/globalStorage/state.vscdb`의 extension memento `azrael-ex-local.azrael` → `persisted-atom-state` 내 `config-derived-agent-mode-by-host-id`, `agent-mode-by-host-id`, `permission-selection-by-host-id:local`, `preferred-non-full-access-agent-mode-by-host-id` 네 개뿐이다. 조회·재개·표시만 수행하고 inference/tool 실행은 하지 않는다. 실행자가 다음 immutable 입력과 소비 참조를 관리하며 root가 결과 수용과 전체 run 정리를 맡는다.

### 이전 설치본에서 확인한 원인

설치본 `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.10/webview/assets/app-initial-7a199c66e670.js`의 QXr에서 Auto-Review 변환이 `azraelAutoReviewModel=gh(e.conversationId).modelSettings`를 읽고 `F=m||h||g||j||E||T==null||azraelAutoReviewModel.isLoading`을 전체 권한 설정 pending으로 반환한다. 변환 소유자는 scripts/inject-auto-review.cjs의 QXr 변경이다.

설치본 `permissions-mode-dropdown-66a2c48ceb22.js`의 yn은 `wt=it||Ct<=1&&(we.length===0||Je!=null)`를 버튼 disabled로 사용한다. it는 위 isConfigDataPending이다. 따라서 설정과 요구사항이 정상이어도 모델 loading이 true이면 권한 메뉴 전체가 잠긴다. Window Use user_stopped 검사는 이 경로에 없다. 모델 로딩은 Auto-Review 사용 가능 여부 판정에는 필요하지만 전체 권한 메뉴 잠금에까지 전파되고 있다.

설치본 QXr 함수를 VM에서 추출 실행했다. 설정과 요구사항 ready를 고정하고 모델 isLoading만 false/true로 변경했다. 각각 permissionsPending false/true, Auto-Review supported true/false였다. 실제 exit code 0, 파일/앱 입력 없음. 이는 잠금 코드 조건의 재현이며 해당 스크린샷의 실시간 React 상태를 입증하지 않는다.

기본 모델 hook iPn은 기존 대화의 resumeState가 resumed가 아니면 모델 로딩으로 취급하고, 대화 없는 fallback/모델 기본 설정 로딩도 반영한다. 그러므로 모델/대화 준비 상태가 지속되면 권한 메뉴도 지속적으로 비활성화될 수 있다. 여러 세션에서 발생하는 공통 경로와 부합하나 각 세션의 로딩 원인은 아직 특정하지 않았다.

이외에도 설정·요구사항·프로젝트 경로 준비 대기 또는 선택 가능한 모드가 하나뿐인 경우에 메뉴가 비활성화된다. 스크린샷만으로 이 후보들을 완전히 제외할 수 없다. window6/window8의 기존 Azrael 로그에서 config/model/thread-resume RPC 실패로 원인을 확정할 근거는 찾지 못했다. 주변 HTTP 403 및 ResizeObserver 로그를 이 문제 원인으로 단정하지 않는다.

## 승인된 해결과 검증 범위

모델 로딩 여부는 isAzraelAutoReviewSupported에만 적용하고 전체 권한 isConfigDataPending은 설정/요구사항의 실제 준비 상태로 판단하도록 분리하는 것이 최소 수정이다. 모델 loading 중에도 준비된 기본/전체 액세스 메뉴는 유지하고 Auto-Review만 준비될 때까지 제외한다. 실제 정책으로 금지된 선택, 실제 설정 미준비 및 선택지 수에 따른 기존 경계는 보존해야 한다. 모델 loading/ready와 config pending, 정책 제한을 조합해 검사하고 설치본에서 실제 메뉴 선택까지 검증해야 한다.

이전 커밋 57d69b19는 User stop requires explicit resume의 오류 정보만 바꿨다. 메뉴 비활성화나 실제 권한 적용에는 영향을 주지 않으며 아직 앱에 설치하지도 않았다. 앞선 user_stopped 진단은 해당 요청 실패에 한정되고 전체 액세스 UI 잠금 전체의 원인으로 확대할 수 없다.
## 실행 기록과 산출물 소유

Root가 scripts/window-control-errors.cjs 및 Auto-Review 변환·검사·렌더 검증, 관련 architecture 최소 설명을 소유한다. 앞선 수정과 동일한 중지 원인인 창 재선택에도 구조화된 안내를 적용한다. 기본 권한/전체 액세스는 모델 로딩 중에도 사용 가능하며 실제 정책 제한과 설정 pending은 유지한다. Window Use 승인·재개·권한 제한은 변경하지 않는다.

CI-01 실행 run `permission-fix-r1`의 예정 산출물은 `artifacts/verification/ci01-permission-fix-r1`(브라우저 fixture/profile)과 `artifacts/logs/ci01-permission-fix-r1`(소스 검사·렌더 로그/스크린샷/summary)다. 현재 모두 없는 새 경로를 사용한다. 소유자는 root/CI-01이며 실행 입력은 이번 코드와 pinned UI 26.1007.21434, 설치 TypeScript, 로컬 Node/Chrome다. 소비자는 root 검증이다. 실제 종료 결과와 생성 파일을 확인한 후 native maintenance에 완전한 그룹으로 등록하고 삭제/보존을 결정한다. 영구 검증 요약은 이 문서에 남긴다. 앱 빌드·패키징·설치와 실제 사용자 세션 제어는 이 실행 검증에 포함하지 않는다.

## ?? ??

- source-tests.log: node --test scripts/test-auto-review.cjs scripts/test-asset-transform-cache.cjs, 20? ??, ?? 0, ?? exit code 0, 138.5?. Auto-Review ????? pending ????? ????? ?? payload??? request manager ?? ????? ?? ??? ????. ?? ??? ??? cache-scope-test ????? ?? ???? ?? ???? ?? ?? ??? ???? ???.
- window-errors.log: ??/??/MCP ?? 6? ??, ?? 0, ?? exit code 0. ?? production ??? ???? ???? ????backend? stub ????. stop ? ?? 2/4 ??? ???? ?? ?? 0?? ???? ?? ??? ???? ??? resume ? fresh ??? ???. ??? fixture?? ?? ??.
- render.log ? render/summary.json: production transformAsset ??? ???? QXr/FXr?????? ???React/CSS ?? 32? ??, ?? 0, ?? exit code 0. Chrome browserExitCode 0, signal null. light/dark?? ?? loading ? ??/Full access ??, Auto-Review ??, ?? ?? ??/?? ?? ??, config pending ? ?? ??. ?? ??? ??? ?? ?? ??? ????. light-model-loading.png? dark-model-loading.png? ?? ????. host hook? localization? synthetic?? ?? VS Code/?? ?? ?? ?? ??? ???? ???.
- ??? ???? ?? ??? ??? ????? source ?? ?? ? ?? ?? ??? ????. ?? ???? ?? ?? ?? ??? ??? 5??6?? ?? ????. ??/?? ???? ???. JS ?? ??? ???? ?? CRLF ??? ????. git diff --check? cr-at-eol ???? ????.
- ?? feature: ui.auto-review? ui.window-control. ?? owning architecture? ?? ??? ???? inventory? ?? owner ? stop-recovery ??? ????. ?? ??? provider_handoff inventory ??? ???? ????.

??? fixture/profile? ????? ??? ?? ??? ????. ?? ??? ?? ????? ???? ?? ???? ??? ?????? native maintenance ?? ci01-permission-fix-r1? ????? ? ?? ???? ? ?? ?? remaining:false? ????. ?? ??????? ????????? ??? ?? ???? ???.


추가 재현 경계: pd7 native preflight는 paginated history의 missing source rollout으로 exit1, process inspection0이며 아직 UI 관측 결과가 아니다. frozen thread-store의 history_base.thread_id는 physical rollout ID다. 대상 logical thread가 명시적으로 참조하는 이전 physical revision의 prefix만 최대8단계 read-only 복사하도록 허용했다. 다른 logical thread는 제외한다. cwd 치환으로 변하는 source prefix byte length에 맞춰 fixture end_byte_offset을 재계산하고 end_ordinal_exclusive를 보존한다. 원본 hash 전후와 boundary mapping을 기록하며 원본 및 pd6 fixed snapshot은 변경하지 않는다. 완결된 lineage 입력은 native preflight와 UI 실행에서 재사용한다.


pd11 수용 기록: run rmvl4971r의 runner/native/host/process inspection은 모두 exit0. 실제 target의4 physical lineage를 복원했고 원본 hash 전후 일치, native fullaccess never/user, fixture cwd/runtime roots assertion 통과. UI는 modelLoading=false, workspaceKind=project, permissionsPending=false, legacy optionCount3/disabled=false로 증상은 미재현이다. native와 UI read-only 표시 차이가 남는다. 정적 소유자 확인: vn의 modern 분기는 Mti atom의 gate4226282475로 결정되며 실제 gate 값은 미확인이다. Windows readiness는 iFn/ZJ의 선택지 제한에 영향을 준다. 원본 config의 allowlisted Windows 설정은 [windows] sandbox=unelevated이며 fixture에는 누락돼 있었다. pd12는 해당 필드만 반영해 readiness=ready를 확인하고 fixture-only modern gate=true 조건을 비교한다. 이는 실제 gate 활성의 증거가 아니며 원래 현상 원인은 아직 확정하지 않는다. 전체16 run lifecycle index와 본문 없는 요약은 rmvl4971r/reports 안에 있다.


최종 격리 비교 pd13(rmvl4okue): root config 귀속과 windows.sandbox=unelevated/readiness=ready 검증 후 modern gate를 fixture에서만 true로 고정했다. native/runner/host/process 검사 모두0. modern loading=false, configPending=false, selectionsLoading=false, selectionsError=false, modelRequiredPending=false, 선택지3개, 현재·표시full-access, disabled=false. iFn required=false와 wmr 필수값 정상. 실제 gate 활성은 미확인이다. 따라서 동일 native history/prefs/Windows setup을 재현해도 원래 잠금은 재현되지 않았으며 원인은 미확정이다. 실제 창의 read-only 개발자 도구 상태 관측은 사용자 추가 허용을 요청했다.

보호 표현 정정: archive/pd6 소비 관계는 reports/index 및 root의 보존 판단에만 기록되어 있었으며 lifecycle outbound/inbound references는18그룹 모두 비어 있다. producer.status=stopped, close_receipt, membership_complete=true는18개 모두 확인됐다. 초기 debugger run/pd1/pd2는 revision3, 나머지15개 revision2다. 추가 close/release는 필요 없으며 root의 현재 보존결정은 archive source/pd6/pd11/pd13을 진단 재개 시까지 유지하는 것이다. native 등록·검토 결과가 나오기 전에는 삭제하지 않는다.


현재 인계 상태: 격리 비교는 완료했지만 사용자 증상 재현과 정확한 원인 확인은 미완료다. 실제 창의 개발자 도구 read-only 관측 허용 답변을 기다린다. 18개 run은 모두 stopped이며 추가 producer는 없다. 중간 실패는12개, 성공6개로 실패 결과를 성공으로 변경하지 않았다. 주요 준비 실패는 Code update mutex/long-path 압축/pwsh 부재/inspector/SUN_LEN/지연 daemon 검사/autoimport UNIQUE/history lineage 누락/filename guard/page-only collector/TOML table scope이며, 최종 비교 결과로 혼동하지 않는다. 초기 source archive/pd6/pd11/pd13 및 나머지 중간자료는 현재 그대로 보존됐다.

최신 rmvl4okue는 native inventory 등록 및 registered-mode group review를 완료했다. run root191186 bytes와 pd13 temporary2142679844 bytes의2 live member다. pd13 producer metadata에 generated/protection_known가 선언되지 않았고 configured managed roots 밖이라는 blocker가 확인됐다. 삭제를 우회하지 않았다. 두 member 모두 native cleanup_apply의 explicit defer 결과 status=deferred/remaining=true를 확인했다. 재검토 조건은 실제 창 진단 완료와 supported producer temporary 소유권/생성 보호 및 exact managed root 확인 뒤 fresh review다. 나머지17그룹의 native 등록/삭제 정리는 아직 하지 않았다. 향후 정리 시 보호 입력4개는 유지하고, 나머지14개는 중간 실패 인과를 본 문서와 기존 summaries로 보존한 후 exact native 등록/리뷰를 수행한다. 삭제가 실제 성공하고 경로가 없을 때만 supported artifact-lifecycle finalize를 실행한다.

상태: 소스 구현·대상 검증·임시 자료 정리 완료. 전체 제품 보존 검사는 별도 기존 오류로 미통과이며 task-level commit은 보류한다.

# Team / Direct 역할 프로필

## 목표와 권한

합의된 Team / Direct 프로필 시스템을 구현한다. 앱 설치·배포와 제품 전체 빌드는 별도 요청 범위이며 수행하지 않는다. 대화에서 확정한 요구와 실행 권한을 유지한다.

## 설계와 완료 기준

[Team / Direct](../../docs/architecture/work-orchestration.md#team-and-direct)와 [역할 프로필](../../docs/architecture/instructions.md#role-profiles-for-team-and-direct)을 따른다.

- 프로필: 이름·허용 역할·모델·reasoning·지침. 기본 Lead/root/sol_executor/luna_explorer를 제공한다.
- 생성: Team Lead→root→subagent, Direct root→subagent. native 실행에서 프로필을 검증하고 임의 모델·기존 agent_type 우회를 거절한다.
- 분리: 부모 역할 지침을 자식에게 활성 지침으로 상속하지 않는다. 공통 지침·작업 맥락·부모 관계는 보존한다.
- 저장: Team에 복사본을 저장하며 이후 Team 복사본 수정은 새 자식부터 적용한다. Direct는 공통 설정을 새 root 생성 시 캡처한다. 사용자 모델·reasoning 직접 변경은 해당 세션과 재개에 보존한다.
- 승인: Team은 Lead 화면, Direct는 root 화면에서 사용자 응답을 받아 원래 요청·실행 세션으로 전달한다. Lead 모델에 요청자 컨텍스트를 보내지 않는다.
- 보존: 기존 일반 대화·Team 변경 관리/관측·프로필 패키지와 스킬 기능을 보존한다.

## 범위와 검증

공통 대상은 Windows x64, glibc Linux x64, macOS ARM64 native local host다. 실제 실행 환경은 Windows x64이며 원격·컨테이너는 제외한다. 기존 검사를 확장하고 feature inventory에 연결한다. UI는 기존 OpenAI 스타일과 밝은/어두운 테마의 실제 상호작용을 검사한다. native 검사는 관련 필터로 수행하며 제품 빌드·설치를 대신하지 않는다.

## 소유권과 실행 순서

root는 저장/생성/승인 공유 계약, 호스트 연결, 패키징 입력, 통합과 수용을 소유한다. 독립 조사 결과를 바탕으로 native 역할 정책, 저장 계층, 설정 UI를 별도 담당자에게 배정했다. 자식 재위임은 금지한다. 기존 및 동시 변경을 보존하며 동일 Cargo 캐시의 중복 생산자를 실행하지 않는다.

## 산출물 수명

유지 산출물은 변경 소스·필요한 테스트·설계와 이 작업 기록이다. 로그/fixture는 각 artifact-run 소유자가 생성 전에 등록하고 종료 확인 후 프로젝트 standalone maintenance owner로 정리한다. 계획 할당용 tempfile은 제거와 부재 확인을 마쳤다. 제품 빌드·설치물은 생성하지 않는다.

## 진행과 검증 근거

- UI/service: Windows host+HTTP server 검사 9개, Chrome 밝은/어두운 테마 16개, 한국어 실제 HTTP/저장 연결 10개, 활성 Team 복사본 HTTP 편집 4개 통과(각 exit 0). 실제 production renderer 범위이며 설치본 수용이 아니다. 브라우저 process tree 종료와 일회성 harness 제거 확인.
- 저장 계층: Windows catalog/저장/마이그레이션/복사본/경로 보호/UTF-8 4MiB 경계 검사 11개 통과(exit 0).
- 생성/승인: 실제 namespace 조합·프로필 runtime·주입·native 승인 segment 통합 15개 통과(exit 0). Team host/runtime/UI 검사 통과(exit 0). Window 승인 기존 40개, 밝은/어두운 테마 실제 승인 renderer 107개 통과(exit 0). 승인 원본의 cwd/패치/요청과 host 격리를 검사하며 Lead 모델로 컨텍스트를 전달하지 않는다.
- 회귀: TypeScript noEmit 통과(exit 0). 지침 workbench 최초 51개 중 fixture 1개 실패는 __dirname/새 runtime 로딩 누락으로 수정했다. 해당 파일 22개와 전체 checker 51개 통과(exit 0). 이후 trusted role-profile 내부 명령 4개를 일반 webview 명령 전달 경로에서도 차단했고 주입/namespace 통합 7개 통과(exit 0).
- 보존 연결: `ui.role-profiles`, `engine.role-profiles`의 매니페스트 검증과 새 native recipe 경계 검사 1개 통과(exit 0). 전체 매니페스트는 다른 동시 작업의 `apps/azrael-desktop/renderer` 디렉터리 owner 참조 때문에 실패한다. 전체 recipe 검사는 기존 `check-task-profile-skills`의 변경된 source hash 때문에 실패한다. 해당 외부 변경을 이 태스크에서 덮어쓰지 않는다.
- native 역할 정책·부모 지침 분리·루트 도구 권한은 고정 소스에서 관련 Cargo 필터 실행 중이다. Linux/macOS 및 설치 앱 수용은 미검증이다.
- 실행 기록: 구현 담당자 작업은 약 09:20–09:50 UTC에 병행했다. native 도구 시작 시 다른 작업의 maintenance 잠금 때문에 실행 관측이 없는 unknown 기록 2건이 발생했다. 독립 조사 후 보호만 복구했으며 성공으로 간주하지 않는다([복구 근거](02-native-run-recovery.json)). 09:52 UTC 같은 artifact/Cargo 소유자와 고정 입력을 쓰는 명령 도구로 재시작했고 09:58 UTC Rust 컴파일 진행을 확인했다. 중복 Cargo는 실행하지 않았다.
- native 첫 실행은 10:01:59 UTC에 실제 Cargo exit 101로 종료했다. `thread-store/src/in_memory.rs`가 새 `params.role_profile`을 이동한 뒤 `params`를 저장하는 partial-move 오류 1건이다. 해당 필드 clone으로 수정하고 10:03 UTC 새 고정 입력으로 재시작했다. 첫 실행은 테스트 실행 0개이며 통과로 계산하지 않는다.
- 두 번째 native 실행은 10:11:10 UTC 실제 Cargo exit 101이다. 기존 task-profile 모듈의 managed provider `Cow<str>`/`String` 타입 불일치와 Windows 생산 코드의 dev-only `windows-sys` 의존성 2종을 발견했다. 생성/재개 통합의 컴파일 전제이므로 provider를 소유 문자열로 맞추고 Windows 정상 의존성으로도 선언했다. 기존 파일/계정 검증 동작은 유지하며 세 번째 고정 입력 실행을 시작했다.
- 세 번째 native 실행은 생산 라이브러리 컴파일을 통과했으나 10:23:01 UTC 기존 task-profile 테스트 fixture의 `model` 이동 후 재사용으로 Cargo exit 101이다. JSON key에 `model.clone()`을 사용하도록 해당 한 지점만 수정했다. 이 실행도 실제 libtest 실행 0개로 기록한다. 공식 config/protocol schema 생성은 이 종료된 고정 소스를 재사용하며, 생성물과 테스트 수정이 모두 준비된 뒤 8개 native 검사 범위를 새 입력으로 실행한다. 코드 의미가 없는 기존 CRLF의 diff whitespace 진단은 `core.whitespace=cr-at-eol`로 구분해 확인했다.
- 공식 생성 실행: config generator exit 0, stable/experimental protocol ignored generator 각각 실제 1개 통과(exit 0). 생성 비교가 기존 공개 TS/JSON 10개와 설정 harness 정의의 누락을 발견해 전체 run은 exit 1로 종료했으며 이를 성공으로 변경하지 않는다. 사용자가 **“기존 스키마 동기화 포함”**으로 추가 범위를 승인했다. 현재 소스와 생성 입력의 일치를 재확인한 뒤 해당 공개 파일, experimental 내장 스키마와 config harness 정의까지 동기화한다. 이 단계는 기존 런타임 동작을 추가/삭제하지 않는다. 파일별 SHA와 생성 근거는 [스키마 동기화](03-schema-sync.json)에 보존한다.
- 승인된 생성 파일 13개 반영과 바이트 일치 확인을 마쳤다. 반영 전 guard가 다른 작업의 `project-maintenance/src/registry.rs` 변경을 발견해 중단했으며, 이 crate의 소비자는 core/app-server이고 schema generator(config/app-server-protocol)의 의존성이 아님을 manifest로 확인했다. 해당 동시 변경은 보존하고 생성 의존성·대상 fixture의 일치 조건을 유지해 반영했다. 10:44 UTC 스키마 포함 native 8개 범위 검사를 시작했다.
- 플랫폼 패키징 검토에서 Linux/macOS 스테이징에 기존 workbench 의존성이 누락된 것을 확인했다. 이 프로필 화면이 사용하는 Windows와 같은 모듈 closure를 포함하고 목록 회귀 검사 1개 통과(exit 0). 실제 다른 플랫폼의 패키징/실행 검증으로 해석하지 않는다.
- 실패 후 재시도: 최초 계획 본문 할당 시 PowerShell native stdin의 문자 인코딩 문제로 한국어가 손상되어 UTF-8 원문으로 이 계획을 교체했다. 소스 기능 실패로 해석하지 않는다.

- 네 번째 native 실행은 `role_profile` 6개 통과(exit 0), `spawn_agent_fork` 5개 통과·1개 실패(exit 101)로 종료했다. 실패는 기존 fixture가 backend를 선택하지 않는 `Feature::MultiAgentV2`를 disable하여 V1을 기대한 데서 발생했다. 현재 `agents_enabled=true`는 V2를 선택하며 해당 선택 로직과 fixture는 HEAD에도 존재한다. 실행 정책은 변경하지 않고 generic compaction test를 실제 V2의 local retained authorization 및 metadata에 맞췄으며 부모 token/compaction sanitation 검증을 보존했다. 기존 history의 `legacy_checkpoints_mark_user_messages_incomplete`는 missing checkpoint의 불완전성 검증을 유지한다.
- 새 positive test는 실제 shared `prepare_agent_spawn_config`에서 같은 모델·다른 지침의 두 프로필, V1/V2 옵션과 full-history fork, 부모 설정 불변을 검사한다. 원래 네 번째 snapshot 뒤에 추가되어 별도 실행이 필요하다.
- 네 번째 실행의 종료·known failure·소비자 없음·cleanup reservation 없음과 원본 hash를 확인한 뒤, 지원되는 lifecycle 새 generation으로 동일한 owned source path를 재사용한다. 변경은 위 두 테스트 파일뿐이며 생산 코드 및 나머지 고정 입력은 유지한다. 이전 실패는 변경하지 않고 [세대 전환 근거](04-native-rerun.json)에 보존하며 8개 native 검사 범위를 다시 실행한다.
- 마지막 통합 검토에서 Team 생성 오류 시 복사본의 처리 범위를 확인했다. 일반 native 오류/응답 유실은 session 미생성을 증명하지 않으므로 보존하고, dispatch 이전 실패가 확실한 경로만 기존 store owner의 `discardTeamConfiguration`으로 정리한다. 내부 명령은 webview 임의 호출 경로에서 차단한다.
- 해당 보완 후 actual namespace/runtime 검증 32개(8+2+22), standalone Team runtime, extension TypeScript noEmit와 scoped whitespace 검사 모두 exit 0이다. 새 disposable artifact는 남기지 않았다.
- 유지 테스트의 재발 방지 범위는 후속 spawn refactor에서 프로필을 모델명으로 다시 축소하거나 부모 지침을 재사용하는 실수, 내부 host 명령을 webview 경로에 열어 두는 실수, staging 목록 수정 때 workbench/defaults 의존성을 누락하는 실수다. 기존 직접 경계 검증을 확장하고 일회용 browser harness는 정리했다.
- 두 번째 세대의 native 동작 검증은 실제 27개 통과했다(6개 필터 각각 exit 0: 프로필 7, fork 6+1+1, root coordination 11, defer registration 1). 일곱 번째 스키마 필터의 Cargo launch 전 `catalogSnapshot`이 동시에 삭제 중인 approval render의 `inputs`를 `lstat`하다 ENOENT로 중단했다. 이 세대의 전체 exit 1은 그대로 보존하고 스키마 2개는 미실행으로 기록한다. [검증 요약](05-native-results.json). 공유 catalog/파일 경합이 확인되었으므로 현재 owner 정리 종료 후 고정 소스를 재사용해 미실행 2개만 수행한다.
- 최종 schema 재실행은 설정 1개와 protocol fixture 4개 모두 실제 통과(exit 0)했다. generator용 ignored 1개는 통과 수에 포함하지 않는다. 앞선 27개와 합해 선택한 8개 native 범위에서 실제 32개 통과다. [최종 schema 결과](06-schema-results.json). 해당 Windows 결과를 Linux/macOS 또는 설치본 수용으로 확대하지 않는다.
- 현재 primary와 고정 소스의 핵심 native owner 29개 파일이 바이트 일치하고, 승인된 생성 스키마 13개도 공식 생성 결과 SHA와 일치함을 최종 재확인했다. production build/install/push는 실행하지 않았다.
- 마지막 전역 보존 검사 재확인: 전체 feature manifest는 여전히 다른 기능의 `apps/azrael-desktop/renderer` 디렉터리 owner 참조 때문에 exit 1이다. 전체 Cargo recipe 검사는 15개 중 14개 통과·1개 실패(exit 1)이며 기존 `engine.task-profile-skills.isolation`의 변경된 wrapper source hash가 원인이다. 새 role-profile recipe 검사는 통과했다. 관련 없는 source/owner 선언이나 검토되지 않은 hash를 이 태스크에서 바꾸지 않았다. 전체 제품 보존 검사가 통과했다고 주장하지 않으며, 해당 실패와 기존/동시 변경 분리 문제 때문에 task-level commit은 보류한다.
- 최종 검토 시 staged 27개 경로와 전체 약 800개 변경 경로가 존재한다. 작업 진입 때부터 있던 변경 및 동시 변경과 같은 파일을 공유하므로 태스크 전체를 안전하게 분리할 근거가 없는 경우 task-level commit은 보류하고 이유를 보고한다. 다른 작업의 index나 소스를 되돌리거나 함께 commit하지 않는다.

## 정리 상태

- UI 3개, 저장 fixture 5개, 성공한 workbench 1개의 owner 삭제·실제 부재·finalize 확인을 마쳤다.
- 최신 owner 배치 exit 0: 종료된 native 초기 3개, 공식 schema 생성 1개, approval host/render 5개, 실패한 workbench 1개 등 10개 그룹을 삭제했다. 모든 확장 member의 `remaining:false`, 실제 경로 부재, lifecycle finalize까지 확인했다.
- 중간에 설정 동시 변경과 stale review token으로 거절된 정리는 새 검토·토큰을 사용해 완료했다. guard를 우회하거나 실패를 성공으로 변경하지 않았다. 약 10:50–11:25 UTC에 진행된 배치와 native 사전 준비·실행이 겹쳤으며, 삭제 중 catalog ancestor 조회 경합이 native 후반부 재실행을 유발했다. 이후에는 삭제와 native catalog 사용을 직렬화한다.
- 마지막 native source/run과 최종 schema 검사/run도 소비자 종료 후 owner review/apply exit 0으로 삭제했다. 확장 member 5개 모두 `remaining:false`, 실제 경로 부재 및 두 lifecycle의 finalize를 확인했다. [최종 정리 결과](07-cleanup-results.json). 총 21개 태스크 disposable 그룹 정리를 마쳤으며 기존 shared Cargo cache는 기존 소유자·소비자 범위로 유지한다.
- **사용자 보관 승인:** `artifacts/tasks/BQ-01/runs/host/temporary/8a3c49b8-df6a-43d0-9edb-5e9d1d80c736`만 55,087바이트(31개 파일) 보존한다. 이번 host 테스트가 생성한 Git fixture이며 상위 `team-change-implementation-host` retained 그룹이 포괄 소유해 개별 등록이 거절됐다. 상위 자료를 보호하고 guard를 우회하지 않았다. 사용자 답변 “해당 fixture 보관 허용”에 따라 이 정확한 하위 경로만 예외로 남기며, 소유자의 하위 경로 분리 정리 절차가 마련되면 재검토한다. 상위 그룹의 다른 자료에 대한 변경/삭제/보관 권한으로 확대하지 않는다.

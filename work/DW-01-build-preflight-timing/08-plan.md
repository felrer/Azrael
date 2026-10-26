상태:129개 파일 검토 및 오래된 검사 부분 삭제·현재 지침 검증 대체 완료. 관련125개 검사와 생성물 정리 확인 완료. 추가 사용자 결정 없음.

# source 테스트의 오래된 계약과 중복 제거

- 권한: 129개 파일 중 오래되거나 불필요한 테스트를 검토 후 삭제한다. 특히 지침1.0.0 고정 요구를 제거한다. 단순히 느리거나 버전 문자열이 오래됐다는 이유로 현재 기능·복구·권한 계약을 없애지 않는다. 현재 계약 검증으로 대체할 수 있으면 같은 task에서 대체하고 남은 전용 helper·fixture·manifest·문서 참조도 정리한다.
- 적용 범위: 테스트 실행·선택 의미는 Windows x64, glibc Linux x64, macOS ARM64 공통이다. 실제 검증은 현재 Windows x64/Node26.7.0/Python3.12 환경에서 수행하며 다른 OS 실행 증거로 확대하지 않는다. 제품 기능·지원 OS·설치·배포는 변경하지 않는다.
- 입력: DW07에서 선택된129개 source 파일을 현재 선택기 결과와 대조한다. root는 최종 삭제 판단·통합·검증·정리를 소유한다. 독립 범위의 읽기 전용 파일 조사는 위임할 수 있으며 구현 파일 소유권은 따로 정한다.
- 판단: 유지(현재 계약), 대체 후 삭제(현재 검사로 충분히 덮음), 삭제(퇴역 계약·중복·무효 테스트)로 각 파일을 분류하고 근거를 본 문서에 기록한다. 가짜 버전의 작은 fixture는 SemVer/rollback/손상 등의 현재 동작을 검증하는 경우 유지할 수 있다.
- 접근: 전체129개 선언·참조를 분류한 뒤 지침 legacy integration·deprecated pins·중복 통합/구조 검사 후보를 실제 구현 및 preservation inventory와 대조한다. 기존 API·manifest·현재 버전 metadata를 재사용하고 새 검증 프레임워크는 도입하지 않는다. 삭제·대체 범위의 owning 문서를 최소 수정한다.
- 검증: 변경 경계의 실제 동작과 삭제된 검사의 대체 계약을 targeted로 검증하고 selection/fixture readiness/manifest 참조를 확인한다. 불필요한 전체129개 재실행·제품 빌드는 하지 않는다. 실제 exit·검사 수·미검증 범위를 기록한다.
- 생성물: root 소유 run:DW-08:test-retirement 및 artifacts/tasks/dw08-tests, 짧은 TEMP artifacts/tasks/tw08을 실행 전에 lifecycle로 선언한다. .git/dw08-*는 이번 작업의 단기 제어 파일이며 즉시 일반 삭제한다. 필요한 결과만 본 문서로 옮긴 뒤 설치된 최적화 maintenance_owner로 두 root를 등록/review/apply/finalize하고 실제 부재를 확인한다. 남은 cleanup 대상은 정확한 경로로 사용자 보존 승인이 필요하다.
- 완료: 삭제 근거·유지 계약 및 실제 삭제 범위를 기록하고 필수 targeted 검증·참조 정리·생성물 정리 후 task commit을 만든다. 다른 staged/unstaged 변경은 보존한다.

## 검토 판단과 삭제 범위

-129개는 UI55/Window·Computer Use31/빌드·캐시·runner29/지침14개로 나눠 선언·소유 모듈·겹치는 검증을 검토했다. 세 읽기 전용 조사자는 코드 수정이나 테스트를 실행하지 않았고 root가 삭제 판단을 통합했다. 각 파일 전체가 퇴역했다고 판정할 근거는 없었다. 버전 문자열·보수적 선택만을 이유로 전체 파일을 지우지 않는다.
- 삭제: Cargo cache의 historical schema2-vs-schema4 benchmark45줄(과거 성능 비교·mock 실행·AF-01 고정 보고서 생성). 현재 schema4의 실제 cold/warm·손상·강제 무효화·semantic identity 검증은 같은 파일의 다른 검사로 유지된다. legacy cache 데이터 보존 테스트는 현재 소유권 계약이므로 유지한다.
- 삭제: preservation-integration의 NAMESPACE 소스 문자열 파싱 테스트1개. 기존 project-selection의 실제 선택기 검사에 namespace의 필수 두 파일 포함 검증을 통합하여 소스 표현 의존 없이 같은 계약을 확인한다.
- 삭제: project-selection의 과거 영역 수12개/원래8개를 고정한 migration 주장. 동일 테스트의 settings/accounts/window-control/build-cache 실제 선택·제외 동작은 유지한다.
- 삭제: instructionService의 별도 pin/unpin/rollback/empty-selection 반복 case1개. pin/unpin은 personal-library failure case, offline rollback은 restarted adapter case, component 선택·빈 선택은 backend 및 view case가 검증한다. 고유 repository 전환 후 상태 분리·기존 파일 보존 검증은 restarted adapter case에 통합한다.
- 대체: host 서비스의 review-1.0.0 디렉터리·1.0.0 tag/manifest·playbook-work 고정 의존을 삭제한다. 현재 instructions metadata/extension appVersion/실제 workspace component로 검증하고 기존 buildRelease로 깨끗한 현재 공개 입력을 한 번 준비해 case 간 공유한다. 현재 working source의 캐시·개인 자료는 수정하지 않는다. 실제 native staged validator는 유지한다.
- backend의 current generated-release integration은 외부 자료가 없어 skip하던 경로를 삭제하고 같은 현재 fixture builder를 통해 항상 검증한다. Native engine이 명시되면 기존 실제 validator를 사용한다. 오래된 버전 합성 fixture는 SemVer·pin·rollback·오류 동작 검증을 위해 유지하며 실제1.0.0 릴리스를 요구하는 호환 계층으로 취급하지 않는다.
- 영향: 제품 동작·지원 플랫폼·기존 UI pin과 migration 검증은 유지한다. scripts/azrael-feature-contracts.json의 기존 동시 변경은 보존하고 이번 current fixture helper owner1줄만 추가한다. native validation/계정·권한·복구·프로필 격리 검증은 삭제하지 않는다.

## 검증 결과

- current-service: 기존 host wrapper의 --run-ts instructionService, actual exit0/signal=null,6개 통과/실패·skip0,37.212초. 현재 metadata 기반 공유 release와 실제 설치 engine의 엄격한 staged validator를 사용했다.
- retirement-regressions: node --test --test-concurrency=2로 instruction-package/project-fail-fast/project-selection/preservation-integration/cargo-verification-cache 다섯 파일. actual exit0/signal=null,118개 통과/실패·skip0,90.154초. 현재 공개 소스88파일·컴포넌트12개·관리 대상67개 실제 적용/오프라인 재열기/실제 native validator까지 확인했다. 과거 benchmark 보고서를 생성하지 않았다.
- instruction-view: 기존 wrapper에서 instructionView를 선택, actual exit0/signal=null, wrapper1개 통과,0.836초. 실제 view 포트의 pin/unpin/rollback/빈 component 전달 검증이 유지된다.
- 위 세 실행은 관련125개를 검증했다. source 전체129개 파일·제품 빌드·설치·타 OS 실행은 수행하지 않았다. 개별 실행 시간의 겹침을 전체시간 또는 속도 향상으로 합산하지 않는다.
- 지침1.0.0 고정 manifest/디렉터리·playbook-work·old Cargo benchmark 경로 참조는 변경된 owner에서 더 이상 검색되지 않았다. diff 검사에서 정적 검사 삭제 후 남은 EOF 빈 줄1개를 제거했으며 실행 의미는 바뀌지 않았다.

## 정리 및 커밋 범위

- 설치된 최적화 owner SHA256을 대조하고 기존 catalog421개 group을 조회했다. 새 DW08 group의 두 member를 등록하고 fresh registered review에서 complete membership·stopped producer·references 없음·blocker 없음을 확인했다.
- 같은 delete 결정으로 native apply actual exit0, 두 member deleted/remaining=false/error=null/attributes=[], aborted=false를 확인했다. apply25.632초는 테스트 실행 시간과 별도다. 두 root의 ENOENT 및 producer registry finalize/부재를 확인했다. 이번 실행 이후 생긴 다른 외부 group은 없었다.
- raw 로그·fixture·복사한 현재 지침·단기 controller는 필요한 수치만 본 문서에 남긴 뒤 삭제한다. 유지되는 새 helper는 현재 릴리스 검증의 실제 의존성이므로 상시 source로 남긴다.
- task commit은 이 task의 테스트·fixture owner/helper·최소 문서 변경만 포함한다. 기존 manifest 변경214줄과 다른 staged/unstaged 작업은 보존한다. 파일 전체 삭제0개, 중복 case2개와 과거 benchmark 및 고정 수 assertion을 제거했다. 필수 기능·지원 범위를 없애지 않고 오래된 검증 방식만 정리했다.

## 129? ?? ?? ??

| ?? | ?? ?? | ?? |
| --- | --- | --- |
| scripts/test-account-settings.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-account-switch-queue.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-artifact-lifecycle.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-asset-transform-cache-retention.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-asset-transform-cache.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-auto-review.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-btw.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-build-platform.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-capacity-retry-stop.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-cargo-preflight-recipes.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-cargo-scheduling.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-cargo-target-owner.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-cargo-test-preparation.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-cargo-verification-cache.cjs | Build/cache/runner | 과거 benchmark 삭제, 현행 cache 검증 유지 |
| scripts/test-cargo-verification.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-command-drag-block.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-compaction-progress.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-composer-draft.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-computer-use-approvals.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-computer-use-injection.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-computer-use-runtime.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-custom-api-host-integration.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-deferred-turn.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-devin-native-host.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-edit-stop-integration.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-engine-check-selection.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-error-presentation.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-feature-preservation-cache.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-feature-preservation.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-fetch-response.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-file-open-menu.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-image-file-open.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-image-sketch.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-immediate-stop.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-independent-host-instructions.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-instruction-library-host.cjs | Instructions | wrapper 유지, instructionService는 현재 지침으로 대체 |
| scripts/test-instruction-settings.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-integrated-entry.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-linux-host-preparation.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-linux-native-supervision.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-local-file-drop.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-macos-signing.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-max-reasoning.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-mcp-lazy-startup.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-missing-image.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-namespace-cache-owner.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-namespace-source.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-native-verification-cache.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-optional-diagnostics.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-ordinary-runtime-node.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-package-local-host.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-paginated-history.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-pdf-file-open.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-pets-cleanup.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-pipeline-preflight.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-pipeline-preservation.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-preservation-integration.cjs | Build/cache/runner | 문자열 검사 삭제, 실제 선택기 검증으로 대체 |
| scripts/test-profile-menu-render.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-project-drafts.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-project-fail-fast.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-project-maintenance.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-project-selection.cjs | Build/cache/runner | 과거 영역 수 고정 삭제, 실제 선택 유지 |
| scripts/test-provider-context.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-provider-model-picker.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-question-queue.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-queue-consumption.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-queue-refresh.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-queued-compaction.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-recent-chat-filter.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-recovery-bridge.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-recovery-presentation.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-recovery-state.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-root-resume-controls.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-scroll-fade.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-session-flags.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-session-links.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-sky-control-policy.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-student-design.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-submit-only-thread.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-task-work-time-history.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-task-work-time-ui.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-task-work-time.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-team-integration.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-thread-branch.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-ui-cleanup.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-ui-health.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-ui-input-diagnostics.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-ui-test-transform-fixture.cjs | Build/cache/runner | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-url-safety-transport.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-use-control-settings.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-use-settings-host.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-use-settings-integration.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-use-settings-ui.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-webview-drag.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-webview-idle.cjs | UI/runtime | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-approval-notifications.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-approval-ui-integration.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-async-approval-host.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-child-reconnect-integration.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-child-reconnect.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-child-recovery.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-child-session.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-child-viewer.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-control-errors.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-control-injection.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-control-mcp.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-control-policy.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-control-runtime.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-desktop-authority.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-input-revalidation.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-installed-application.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-installed-launch.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-permission-preparation.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-use-async-approvals.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-use-isolation.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-use-resources.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-use-stage-authority.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/test-window-use-staging.cjs | Window/Computer Use | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/tests/codex-environment-engine.test.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/tests/inject-task-profile.test.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/tests/instruction-catalog.test.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/tests/instruction-library.test.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/tests/instruction-migration.test.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/tests/instruction-module-packaging.test.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/tests/instruction-package.test.cjs | Instructions | 외부 레거시 자료 의존 삭제, 현재 릴리스 항상 검증 |
| scripts/tests/instruction-playbooks.test.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/tests/instruction-publisher.test.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/tests/sync-codex-environment.test.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |
| scripts/tests/task-profile-runtime.test.cjs | Instructions | 유지: 현재 기능·식별·오류·복구 계약 |

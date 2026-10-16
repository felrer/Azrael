상태: 지정 범위 삭제·관련 검증·임시 산출물 정리 완료. 기존 창 안전성 검사 1건은 선행 실패로 남아 있으며 제품 설치 수용은 수행하지 않았다.

# 레거시 및 미사용 기능 전수조사

## 승인된 삭제 범위와 실행

사용자는 구 설치·복구·companion 코드와 옛 OpenRouter 검색·캐시 구현 삭제를 요청했다. 기존 조사 중 U1, L1–L3와 삭제된 실행 경로를 생성하는 옛 packaging 분기를 이번 실행 범위로 확정한다. 현재 native/integrated host, 통합 계정 payload, 현재 호스트 rollback·원본 Codex·다른 확장 보존, Anthropic catalog와 custom API는 유지한다. U2 설정 helper, U3 upstream CLI metadata, Devin ACP, alias 및 Goal/Plan은 이번 삭제 범위 밖이다. 실제 설치본·계정·대화·기존 복구 산출물을 삭제하거나 설치/빌드/배포하지 않는다. 구 companion을 현재 설치자의 소유 대상으로 해석하는 호환 코드를 제거하며, 이미 존재하는 구 companion은 다른 확장과 같이 그대로 보존한다.

Windows 전용 설치 스크립트와 모든 플랫폼의 공통 provider 소스가 영향을 받는다. 의도 지원은 Windows x64/Linux x64/macOS ARM64이고 이번 검증 환경은 Windows다. root가 공용 계약/작업 문서, packaging/wrapper, 검사 등록과 최종 검증을 담당한다. 독립 소유자는 provider의 OpenRouter 하위 구현·전용 테스트·UPSTREAM 문서, 다른 소유자는 구 installer/checker 삭제 및 현재 설치자의 companion 호환 분기·관련 회귀를 수정한다. 각 소유자는 자신의 파일만 수정하고 서로의 변경을 보존한다.

완료 조건은 구 실행 경로와 생성 지점/활성 문서의 참조 제거, 운영 미참조 OpenRouter 하위 구현 제거, Anthropic·현재 host/설치 보존 회귀 통과, 작업 산출물의 삭제/유보 검토와 단일 작업 커밋이다. 보존 검사는 기존 host window-safety/namespace, extension backup-plan, cleaner, provider catalog/inference/image/reasoning를 재사용하고 삭제된 동작만 검사하는 fixture는 함께 폐기한다. source 수준과 package/설치 수용은 구분한다.

## 핵심 결과

등록된 67개 기능을 전수 대조하고 주요 자사 실행 경계를 추적했다. 운영 경로에서 분리된 옛 OpenRouter catalog 하위 구현, 설정 helper와 upstream CLI용 metadata가 우선 정리 후보이고, 구 설치/복구·companion·Devin ACP는 아직 호출 가능한 레거시다. native host와 integrated host의 병존 여부가 큰 정리 범위를 결정한다. 아래 후보 표와 정리 전제에 따라 후속 삭제 범위를 정해야 한다.

정적 조사이므로 실제 설치본의 이용 여부와 외부 소비자까지 증명하지 않는다. 기능 기존 정적 조사에서 삭제·비활성화·실제 계정 요청은 수행하지 않았다. 아래 조사 결과의 코드 위치는 삭제 전 기준이며 실제 삭제 범위와 검증은 위 실행 절이 소유한다.

## 목표와 권한
현재 Azrael의 기능·진입점·호출 관계를 조사해 사용되지 않는 기능과 정리 후보를 근거별로 구분한다. 산출물은 범위별 조사표, 코드 위치와 도달 가능성, 대체 경로, 삭제 전제와 우선순위다. 기능 삭제는 이번 요청의 실행 범위가 아니다.

## 범위와 기준
주 소스는 `engine/`이며 `engine/SOURCE.json`과 `docs/ops/development.md`의 통합 소스 선택을 따른다. 호스트 확장, provider 어댑터, 운영·변환 스크립트, native backend, 기능 보존 목록을 대조한다. vendor·외부 plugin·upstream·생성 산출물은 자사 미사용 기능과 분리해 포함 관계만 확인한다. Windows x64, Linux x64, macOS ARM64 의도 지원을 함께 검토하며 현재 Windows 호스트에서 실행하지 않았다는 이유로 타 플랫폼 기능을 폐기로 판정하지 않는다.

단순 문자열·파일명 검색 결과는 후보 발견에만 사용한다. 실제 import·등록·CLI·동적 호출·보존 계약을 확인해 확정 미사용, 폐기됐으나 도달 가능, 호환 유지, 현재 사용, 미확정으로 분류한다. 정적 조사로 실제 사용자 이용률이나 모든 런타임 분기를 증명하지 않는다.

## 조사와 역할
root는 전체 추적 파일·기능 보존 목록·설계 상태와 결과 통합을 담당한다. 독립 읽기 조사로 엔진 Azrael 경로, 호스트·provider, 운영·빌드 도구를 나눠 병행한다. 공유 인터페이스 변경과 파일 수정은 없다. 각 조사 결과는 경로·심볼·호출/등록 근거·대체 경로·삭제 전제를 반환한다. 수집 후 상충하는 판정과 누락 범위만 추가 확인한다.

## 검증과 완료 기준
주요 기능 소유 영역과 추적 코드 파일을 집계하고 모든 등록 기능을 조사 영역에 연결한다. 각 정리 후보에 근거와 불확실성 및 보존 전제를 기록한다. 조사 문서의 경로·심볼과 분류의 일관성을 확인한다. 실제 기능 변경이 없어 제품 회귀·컴파일·설치 검사는 실행하지 않는다. 기존 병행 작업은 보존한다. 영구 설계는 변경하지 않으며 조사 결과는 이 작업 문서가 소유한다.

## 조사 기준선과 누락 방지

조사 시작 시 HEAD는 `a820e507a3837cf40cb5a850c50799772335a5d4`다. `providers/opencodex/inference.ts`, 관리형 provider/모델 하네스 문서, 기존 BU/BW 작업에는 병행 변경이 있다. 현재 소스를 조사하되 이 변경은 수정하거나 이번 작업에 포함하지 않는다.

| 영역 | Git 추적 파일 수 | 이번 조사 방법과 경계 |
| --- | ---: | --- |
| `engine/` | 9,266 | 주 통합 소스. 보존 등록·Azrael 실행/인증/provider 및 deprecated 경로 중심 호출 분석. upstream 전체 심볼의 미사용 증명은 제외 |
| `extensions/` | 299 | manifest·activation·통합/standalone 등록·계정/사용량/채팅 경로 |
| `providers/` | 1,214 | 자사 어댑터의 등록과 호출 분석. vendored 코드 1,145개는 의존 경계로 분리 |
| `scripts/` | 485 | 명령·빌드/준비/설치·변환·검증 경로와 공개 운영 문서 대조 |
| `native/` | 17 | Windows/Linux backend 및 child-session 진입점 확인 |
| `plugins/` | 5,380 | 62개 plugin root와 두 marketplace의 참조 무결성 확인. plugin 내부 개별 기능의 사용자 사용률은 제외 |
| `instructions/` | 50 | 유지 라이브러리와 배포 component 경계 확인. 출처·과거 버전 이름은 미사용 판정이 아님 |
| `docs/` | 144 | current/partial/target/archive 분리. 목표 설계만으로 기존 구현을 대체 완료로 판정하지 않음 |

보존 목록은 기능 67개(분류 필드 기준 engine 22, ui 45), 고유 구현 소유 경로 372개, 필수 검사 정의 149개다. 소유 경로는 모두 존재한다. 경로 존재는 기능 작동이나 사용 사실의 증명이 아니다. 두 marketplace는 각각 65/50개 entry(로컬 62/47개)를 포함하며 로컬 경로 누락이 없고, 추적 plugin root 62개는 모두 어느 한 목록에 등록되어 있다. marketplace 등록은 설치·실사용 증거가 아니다.

### 등록 기능 전체 대조표

각 행은 삭제 누락 방지를 위한 보존 등록 현황이다. `호출 조사`는 해당 경계의 조사 담당을 뜻하며 행별 실제 사용자 이용 검증을 뜻하지 않는다. 아래 후보 표에 별도 지적하지 않은 항목은 미사용 확정 근거가 없는 상태로 보존한다. 모든 필수 검사를 이번 조사에서 실행했다는 의미도 아니다.

| 기능 ID | 설계 소유자 | 등록 소유 경로/필수 검사 수 | 호출 조사 |
| --- | --- | ---: | --- |
| `engine.shared-engine` | [azrael-runtime.md](../../docs/architecture/azrael-runtime.md) | 55/4 | 엔진 |
| `engine.source-provenance` | [upstream-preservation.md](../../docs/architecture/upstream-preservation.md) | 7/1 | 엔진 |
| `engine.parent-requests` | [root-resume.md](../../docs/architecture/root-resume.md) | 33/2 | 엔진 |
| `engine.api-context` | [custom-api-models.md](../../docs/architecture/custom-api-models.md) | 8/3 | 엔진 |
| `engine.root-resume-reasoning` | [root-resume.md](../../docs/architecture/root-resume.md) | 5/1 | 엔진 |
| `engine.model-harness-profiles` | [model-harness-profiles.md](../../docs/architecture/model-harness-profiles.md) | 14/3 | 엔진 |
| `ui.submit-only-thread` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/2 | 호스트·도구 |
| `engine.managed-tool-identities` | [managed-providers.md](../../docs/architecture/managed-providers.md) | 2/1 | 엔진 |
| `engine.meta-provider` | [managed-providers.md](../../docs/architecture/managed-providers.md) | 10/2 | 엔진 |
| `engine.task-work-time` | [task-work-time.md](../../docs/architecture/task-work-time.md) | 13/3 | 엔진 |
| `ui.task-work-time` | [task-work-time.md](../../docs/architecture/task-work-time.md) | 22/4 | 호스트·도구 |
| `ui.webview-idle` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 6/2 | 호스트·도구 |
| `ui.team-change-management` | [work-orchestration.md](../../docs/architecture/work-orchestration.md) | 8/3 | 호스트·도구 |
| `ui.team-lead` | [work-orchestration.md](../../docs/architecture/work-orchestration.md) | 5/2 | 호스트·도구 |
| `ui.session-flags` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 4/2 | 호스트·도구 |
| `ui.account-settings` | [accounts.md](../../docs/architecture/accounts.md) | 3/2 | 호스트·도구 |
| `ui.instruction-settings` | [instructions.md](../../docs/architecture/instructions.md) | 16/3 | 호스트·도구 |
| `ui.student-design` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/2 | 호스트·도구 |
| `ui.recovery` | [reload-recovery.md](../../docs/architecture/reload-recovery.md) | 3/2 | 호스트·도구 |
| `ui.project-drafts` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/2 | 호스트·도구 |
| `ui.fetch-response` | [reload-recovery.md](../../docs/architecture/reload-recovery.md) | 3/2 | 호스트·도구 |
| `ui.url-safety-transport` | [computer-use.md](../../docs/architecture/computer-use.md) | 3/2 | 호스트·도구 |
| `ui.computer-use` | [computer-use.md](../../docs/architecture/computer-use.md) | 9/2 | 호스트·도구 |
| `ui.window-control` | [window-use.md](../../docs/architecture/window-use.md) | 18/2 | 호스트·도구 |
| `ui.file-open-menu` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/2 | 호스트·도구 |
| `ui.image-file-open` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/2 | 호스트·도구 |
| `ui.missing-image` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/2 | 호스트·도구 |
| `ui.local-file-drop` | [azrael-ex.md](../../docs/architecture/azrael-ex.md) | 5/3 | 호스트·도구 |
| `ui.composer-draft` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/2 | 호스트·도구 |
| `ui.auto-review` | [auto-review.md](../../docs/architecture/auto-review.md) | 3/2 | 호스트·도구 |
| `ui.image-sketch` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 4/2 | 호스트·도구 |
| `ui.ui-cleanup` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/3 | 호스트·도구 |
| `ui.pets-cleanup` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 5/3 | 호스트·도구 |
| `ui.content-fonts` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 7/2 | 호스트·도구 |
| `ui.provider-context` | [context-policy.md](../../docs/architecture/context-policy.md) | 5/4 | 호스트·도구 |
| `ui.deferred-turn` | [root-resume.md](../../docs/architecture/root-resume.md) | 5/3 | 호스트·도구 |
| `ui.parent-request-activity` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 4/2 | 호스트·도구 |
| `ui.work-segment-folding` | [root-resume.md](../../docs/architecture/root-resume.md) | 3/2 | 호스트·도구 |
| `ui.compaction-progress` | [queued-compaction.md](../../docs/architecture/queued-compaction.md) | 3/2 | 호스트·도구 |
| `ui.queue-refresh` | [queued-compaction.md](../../docs/architecture/queued-compaction.md) | 3/2 | 호스트·도구 |
| `ui.account-switch-queue` | [accounts.md](../../docs/architecture/accounts.md) | 3/2 | 호스트·도구 |
| `ui.queue-consumption` | [queued-compaction.md](../../docs/architecture/queued-compaction.md) | 3/2 | 호스트·도구 |
| `ui.provider-model-picker` | [managed-providers.md](../../docs/architecture/managed-providers.md) | 3/2 | 호스트·도구 |
| `ui.btw` | [side-questions.md](../../docs/architecture/side-questions.md) | 6/3 | 호스트·도구 |
| `ui.thread-branch` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/2 | 호스트·도구 |
| `ui.paginated-history` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/2 | 호스트·도구 |
| `ui.capacity-retry-stop` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/2 | 호스트·도구 |
| `ui.immediate-stop` | [reload-recovery.md](../../docs/architecture/reload-recovery.md) | 3/2 | 호스트·도구 |
| `ui.queued-compaction` | [queued-compaction.md](../../docs/architecture/queued-compaction.md) | 3/2 | 호스트·도구 |
| `ui.max-reasoning` | [managed-providers.md](../../docs/architecture/managed-providers.md) | 3/2 | 호스트·도구 |
| `ui.recent-chat-filter` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 3/2 | 호스트·도구 |
| `ui.session-links` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 4/2 | 호스트·도구 |
| `engine.response-tps` | [context-policy.md](../../docs/architecture/context-policy.md) | 9/3 | 엔진 |
| `engine.provider-context` | [context-policy.md](../../docs/architecture/context-policy.md) | 31/4 | 엔진 |
| `engine.thread-auto-compaction-integration` | [context-policy.md](../../docs/architecture/context-policy.md) | 7/1 | 엔진 |
| `engine.capacity-recovery` | [reload-recovery.md](../../docs/architecture/reload-recovery.md) | 7/1 | 엔진 |
| `engine.recovery` | [reload-recovery.md](../../docs/architecture/reload-recovery.md) | 13/2 | 엔진 |
| `engine.accepted-input` | [reload-recovery.md](../../docs/architecture/reload-recovery.md) | 1/1 | 엔진 |
| `engine.auto-account-switch` | [accounts.md](../../docs/architecture/accounts.md) | 1/1 | 엔진 |
| `engine.devin-native` | [devin.md](../../docs/architecture/devin.md) | 1/1 | 엔진 |
| `engine.devin-code-mode` | [devin.md](../../docs/architecture/devin.md) | 1/1 | 엔진 |
| `engine.devin-agents` | [devin.md](../../docs/architecture/devin.md) | 1/1 | 엔진 |
| `ui.input-diagnostics` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 4/2 | 호스트·도구 |
| `engine.task-profile-skills` | [instructions.md](../../docs/architecture/instructions.md) | 6/1 | 엔진 |
| `tool.project-maintenance` | [project-maintenance.md](../../docs/architecture/project-maintenance.md) | 54/7 | 엔진 |
| `engine.error-classification` | [managed-providers.md](../../docs/architecture/managed-providers.md) | 20/4 | 엔진 |
| `ui.error-presentation` | [ui-presentation.md](../../docs/architecture/ui-presentation.md) | 13/2 | 호스트·도구 |

### 보존 목록만으로 발견할 수 없는 범위

`project-usage.md`, `root-coordination.md`, `prompt-image-preparation.md`, `provider-brand-assets.md`, `diagnostic-logging.md`, `multi-platform.md`, `window-use-visualization.md`는 직접 contract로 연결된 독립 등록 항목이 없다. 이는 삭제 근거가 아니라 보존 범위 점검 항목이다. 일부는 다른 공통 owner/check에 간접 포함될 수 있으므로 독립 ID의 부재를 검사 전무로 단정하지 않는다. 예를 들어 프로젝트 사용량은 `accountService.ts:82` → `PROJECT_USAGE_METHOD` 요청과 `usageView.ts`에서 참조되므로 미사용으로 볼 수 없다. 후속 정리에서 이 영역을 명시적으로 함께 검토해야 한다.

## 우선 정리 후보와 근거

이번 정적 조사에서는 **운영 경로에서 분리된 OpenRouter catalog 하위 구현과 내부 설정 helper를 확인했다.** 파일/모듈 전체를 안전하게 삭제할 수 있다고 입증한 결과는 아니다. 아래는 운영 코드 미참조, 사용 종료된 설치 경로, 아직 호출 가능한 호환 경로를 구분한 결과다. 테스트에서 사용되는 함수와 안전한 거절 분기는 자동 삭제 대상으로 삼지 않는다.

| ID / 우선순위 | 대상과 위치 | 확인된 근거 / 현재 경로 | 판정과 정리 전제 |
| --- | --- | --- | --- |
| U1 / 1 | `providers/opencodex/catalog.ts:245`의 옛 OpenRouter discovery/cache/캐시 reasoning 조회 | `discoverOpenRouterCatalog`, `readOpenRouterModelReasoning`은 테스트만 참조하고 `clearOpenRouterCatalog`는 옛 discovery가 호출한다. 현재 `inference.ts:548`은 `MANAGED_PROVIDERS`만 열거해 OpenRouter를 제외하며 `tests/inference.test.ts:108`이 이를 명시한다. | 운영에서 분리된 하위 구현. OpenRouter 전용 검증/캐시 구조와 함수 묶음을 정리할 수 있는 우선 후보다. Anthropic와 공유하는 코드·현재 모델 목록 기능은 보존하고 옛 catalog 테스트/UPSTREAM 설명을 함께 갱신한다. 외부 deep import는 별도 확인한다. |
| U2 / 1 | `extensions/azrael-ex/src/nativeAzrael.ts:22` `azraelSettingKeys` | 선언 외 참조가 `test/nativeAzrael.test.ts`뿐이다. 다른 `nativeAzrael` 함수는 채팅/설정 진입점에서 쓰인다. | 운영 미참조 내부 함수. 파일 전체를 지우지 않는다. 실제 설정 탐색의 보존 범위를 확인하고 이 함수만 검증하는 테스트를 대체/폐기한다. |
| U3 / 1 | `providers/opencodex/package.json:6`의 `main`/`exports`/`bin`/배포 `files` | `bin/package-main.mjs`, `bin/ocx.mjs`, `src/index.ts`는 해당 디렉터리에 없다. 현재 제품은 helper/inference bundle을 직접 만든다(`build-platform.cjs:181`). | upstream CLI용으로 남은 로컬 런타임 미사용 metadata. 의존성·lockfile·출처·라이선스를 보존하고 이 디렉터리의 독립 npm/CLI 배포 의도가 없는지 확인한 뒤 로컬 package 목적에 맞게 축소한다. |
| L1 / 2 | `scripts/install-existing-vscode.ps1:20`, `check-existing-vscode.ps1:38` | 설치자는 verification 경로만 허용하며 제품 설치를 거절한다. checker가 호출한다. `docs/maps/README.md:84`도 regression fixture only로 명시한다. | 폐기된 제품 설치의 회귀 fixture. 현재 `install-azrael.ps1`/host acceptance로 필수 보장을 대체한 뒤 fixture 묶음을 함께 정리한다. |
| L2 / 2 | `install-isolated-vscode.ps1`, `launch-installed-azrael.ps1`, `restore-original-codex.ps1`, `check-isolated-install.ps1:119` | 현재 제품 설치는 `install-azrael.ps1:25`에서 Isolated/Existing을 거절한다. 구 checker는 설치/launch/restore를 여전히 호출하고 코드 맵은 구 설치 복구용 보존을 명시한다. | 폐기됐지만 복구·fixture에서 도달 가능. 구 설치본·바로가기·receipt·복구 의존을 확인하고 보존 기능을 대체해야 삭제할 수 있다. 기존 사용자 상태는 별도 보호 대상이다. |
| L3 / 2 | 별도 companion ID `azrael-ex-local.azrael-ex`의 설치·제거·검증 분기 | 현재 확장은 `azrael-ex-local.azrael`이다. `install-native-vscode.ps1:107` 등은 남은 구 companion을 정리한다. `extensions/azrael-ex/README.md:1`은 별도 설치하지 않는 내부 payload임을 설명한다. | 별도 제품은 종료됐지만 구 설치 migration 경로는 살아 있다. 이전 설치를 지원할 기간/대상과 회귀 coverage를 결정한 뒤 정리한다. 통합 계정 payload 소스는 삭제 대상이 아니다. |
| L4 / 3 | `engine/codex-rs/core/src/devin/runtime.rs:58`의 ACP fallback | 일반 Devin turn(`session/turn.rs:2820`)에서 native helper env가 있으면 native, 없으면 ACP로 진행하고 `runtime='acp'`를 기록한다. 문서는 기존 ACP thread만 유지한다고 설명한다(`devin.md:97`). | 레거시지만 호출 가능. 모든 지원 launcher의 helper 설정/실패 처리를 확인하고 기존 ACP thread·sidecar 보존 또는 명시 migration을 마련한다. 새 ACP 생성도 가능한 소스 분기를 먼저 명확히 제한한 후 삭제 범위를 정한다. |
| D1 / 결정 필요 | `prepare-native-vscode.ps1`, `install-native-vscode.ps1`, `src/chatView.ts` 등 native host 경로 | `package-azrael.ps1:24,88,101`은 현 manifest에서 native-host 패키지/안내를 생성한다. `extension.ts:35,74`에서 직접 `ChatView`를 등록하고 `native-vscode-host-check.cjs:23`이 검사한다. 별도로 integrated entry는 공식 UI를 활성화하고 account payload만 붙인다. | 두 호스트 경로 모두 소스 도달 가능. 현 운영 문서는 integrated host를 설명하므로 정책·문서 불일치가 있다. 향후 native host를 지원할지 먼저 결정해야 한다. “standalone 채팅=미사용”으로 삭제할 수 없다. |
| D2 / 후순위 | `features/src/legacy.rs:11`, `cli/src/doctor.rs:1187`, `core/src/config/mod.rs:3409` | 구 feature alias는 현재 feature로 해석되고 doctor에 표시된다. 구 root `profile = ...`는 `--profile`로 안내하는 오류를 낸다. 현재 harness profiles는 startup/request에서 실제 적용된다. | 기존 config 호환/오류 안내 코드. 실제 설정 adoption과 migration을 확인해야 하며 `harness_profiles`와 혼동하면 안 된다. |
| D3 / 후순위 | `package-azrael.ps1:24`의 `<0.2`/`0.2`/`0.3` 버전 분기와 legacy isolated packaging | 현재 `azrael` 0.4+ manifest는 nativeHost 분기로 들어간다. 코드에는 옛 packaging mode와 안내도 남아 있다. | 현 manifest에서 선택되지 않는 과거 입력 호환 분기. 과거 패키지를 입력받는 지원 계약과 L2 복구 경로의 의존을 먼저 확인한다. |

### OpenRouter 후보의 정확한 경계

운영 미참조 묶음은 `catalog.ts`의 OpenRouter 전용 validation/snapshot/options 및 cache helper(`:28`, `:46`, `:58`), `:245`부터 파일 끝 `:318`까지의 세 exported 함수다. 직접 운영에서 참조하지 않는 export는 `discoverOpenRouterCatalog`와 `readOpenRouterModelReasoning`이며, `clearOpenRouterCatalog`는 그 옛 discovery 내부에서 쓰인다. 파일 전체가 미사용인 것은 아니다.

`validId`, `safeCacheDirectory`, `CATALOG_FRESH_MS`, `MAX_CACHE_BYTES`, `MAX_MODELS`, outbound/discovery·registry helper와 Anthropic options의 기반은 Anthropic도 사용한다. `CATALOG_STALE_MS`는 옛 OpenRouter snapshot reader 및 테스트에 쓰인다. 정확한 삭제 시 공유 type/import를 별도로 정리해야 한다.

vendor에는 별도 server의 `GET /v1/models` → `fetchAllModels` → `gatherRoutedModels`와 OpenRouter registry/live discovery가 남아 있다(`vendor/src/server/index.ts:1976`, `server/management/shared.ts:239`, `providers/registry.ts:1993`, `oauth/index.ts:1167`, `codex/catalog/provider-fetch.ts:1862`). 이것은 관련 upstream 구현이 존재한다는 근거이며, **현재 Azrael 로컬 inference가 그 vendor server를 실제 사용하는 증거는 아니다.** 옛 text/tool filtering/cache 계약과 자동 동등하다고 보지 않는다. 후속 정리는 현재 로컬 카탈로그에서 OpenRouter를 제외한 계약(`tests/inference.test.ts:108`)과 현재 custom API 경로를 보존하면서 수행한다. `tests/catalog.test.ts`와 `UPSTREAM.md:35`의 옛 설명을 같이 검토한다.

## 정리 대상으로 오인하기 쉬운 현재 기능

| 대상 | 유지 근거 |
| --- | --- |
| 공용 엔진 내부 창별 `MessageProcessor`/`AuthManager`/config | `azrael_shared_server.rs:335`가 창별 컨텍스트를 만들고 config/auth를 묶는다. 계정·모델·정책 격리의 현재 구현이며, 별도 엔진 프로세스가 아니다. 이전 OpenAI 사용량 문제에서 수정한 정책 소유권도 이 경계에 있다. |
| `azrael` wrapper / daemon / `azrael-bridge` | `app-server/src/main.rs:187`, `app-server/src/lib.rs:1036`, `app-server-daemon/src/azrael.rs:139`의 공용 엔진 연결/기동과 `app-server-client/src/bin/azrael-bridge.rs:29`의 관리 RPC를 각각 담당한다. |
| in-process app-server / CLI / TUI 기반 공통 구현 | `app-server-client/src/lib.rs:265`와 `cli/src/main.rs:1281`에 호출이 있다. 현재 VS Code에서 직접 보이지 않는다는 이유로 공통 crate를 지울 수 없다. 전체 TUI 지원 폐기는 별도 범위 결정이다. |
| Goal·Plan UI 제거 뒤의 도구 | `app-server/src/extensions.rs:76`/`ext/goal/src/extension.rs:533`에서 create/get/update goal이 등록되고 Goal feature 기본값은 true다(`features/src/lib.rs:1822`). `update_plan`은 별개 opt-in 도구다(`spec_plan.rs:1363`). UI 등록 제거는 도구 폐기의 증거가 아니다. |
| Pets/Goal/Plan/Code-review cleanup injector | upstream 자산에서 해당 UI를 제거하는 현재 변환 기능이다. 제거된 UI와 그것을 제거하는 코드를 함께 지우면 UI가 다시 나타날 수 있다. 공유 서비스와 원본 입력의 라이선스·출처도 별도다. |
| 모든 `inject-*.cjs` | namespace 등록과 대조했으며, 중앙 목록 밖의 `inject-linux-supervision.cjs`는 `prepare-platform-host.cjs:78`, `inject-sky-control-policy.cjs`는 `computer-use-runtime.cjs:6`에서 호출된다. 현재 고아 injector는 확인되지 않았다. |
| Windows build/install PowerShell와 common platform producer | `deploy-azrael.ps1`이 현재 Windows producer를 호출한다. `multi-platform.md:55`는 공통 producer의 Windows 수용 전까지 기존 경로 유지를 요구한다. 새 경로가 존재한다고 migration이 완료된 것이 아니다. |
| `prepare-ordinary-vscode.ps1`, `ordinary-runtime.cjs` | 역사적 이름이지만 현재 호스트 준비와 provider 환경 설정에 재사용된다. |
| `providers/devin` 및 non-vendor OpenCodex 모듈 | `ordinary-runtime.cjs:58` → `devin-native-host.cjs`/`provider-accounts-host.cjs`, 계정 서비스의 private helper, 엔진의 catalog/inference 경로, build bundle로 연결된다. extension src 36개 모듈에서도 완전 고아 파일은 발견되지 않았다. |
| `setApiSecretFactoryForTests` (`custom-api-config.ts:80`) | 테스트 전용임이 이름과 구현에 명시된 keyring 대체 seam이다. 실제 secret 저장소를 건드리지 않는 테스트에 쓰인다. 운영 호출이 없다는 이유로 정리하지 않는다. |
| `helper.ts:234`의 `addKey` | 명시적으로 unsupported 오류를 반환하는 거절 계약이다. 지원하지 않는 명령이 성공하거나 다른 경로로 처리되지 않게 한다. 기능이 살아 있다는 증거도, 삭제가 필요하다는 증거도 아니다. |
| 기존 API-key auth 및 저장 credential 보존 | Azrael auth는 `shared_for_azrael(..., false)`로 ChatGPT를 강제하지만 일반 auth manager는 API key를 사용한다. `azrael_unmanaged_tests.rs:370`은 저장 키는 보존하되 Azrael에서 무시하는 계약을 확인한다. 사용자 custom API 연결 기능과도 구분한다. |
| 독립 Computer Use skill과 stage-4 backend | `window-use.md:73`은 설치된 중복 entry 정리가 아직 남았다고 명시하고 `:90`은 unified stage4 수용 뒤 제거하도록 제한한다. 중복 entry 정리와 runtime/backend 제거는 별개다. vendor cache·사용자 설치 skill은 일괄 삭제 대상이 아니다. |
| Unix/Windows transport·Linux backend·Mac 후보 | 의도 지원 플랫폼의 조건부 경로다. 현재 Windows 호스트의 비활성 분기를 미사용으로 보지 않는다. native/window-control 및 windows-child-session의 build/runtime 참조가 있다. |
| plugin / instruction / source provenance / cleanup script | plugin root는 모두 marketplace에 연결된다. instruction 전체 tree는 component별 배포 대상이며 SOURCE 역사 기록은 출처 증거다. cleaner들은 build/deploy/운영 문서에서 사용된다. `upstream/`과 frozen release/cache는 별도 provenance·실행 참조를 확인해야 한다. |

## 권장 후속 순서

1. U1/U2와 로컬 package metadata를 작은 변경으로 정리한다. OpenRouter의 모델 목록·reasoning 회귀와 현재 설정 진입 동작을 보존한다. 테스트 seam은 유지한다.
2. 지원할 호스트 경로(D1)를 결정하고 코드·운영 문서·검증 경로를 일치시킨다. 이 결정이 native ChatView와 installer의 삭제 가능 범위를 좌우한다.
3. 구 설치 fixture/복구/companion(L1–L3)과 버전 호환 packaging(D3)을 한 묶음으로 검토한다. 현재 설치·직전 복구본과 실제 참조를 먼저 조사하고 대체 검증을 마련한다.
4. Devin ACP(L4)의 새 진입을 제한할지, 기존 대화 migration을 제공할지 결정한 뒤 제거한다. 사용자 대화·계정 기록은 보존한다.
5. alias/config 호환(D2), Computer Use 중복 skill 설치, 보존 목록의 누락 owner를 별도 명시 범위로 정리한다.

## 조사 한계와 검증

- 정적 호출·등록·명령·설계 대조 조사다. 실제 계정·대화·비밀 정보·브라우저를 열지 않았고 사용자 환경을 변경하지 않았다. 현재/과거 설치본의 사용률, shortcuts·복구 receipts의 실제 참조는 확인하지 않았다.
- 자사 TypeScript/JavaScript/설정 609개 파일에서 exported named function 133개를 교차 참조했다. 같은 파일 내부 호출과 테스트 호출을 분리해 후보를 수동 확인했다. 이 보조 검색은 class/arrow export, 반사·외부 deep import, 모든 엔진 Rust symbol의 완전한 compiler reachability 분석이 아니다.
- `engine/`은 Azrael 실행·창/인증·provider·설정/legacy/도구 경계와 localIntegration 경로를 조사했다. upstream 엔진 전체 9,266개 파일이나 외부 vendor/plugin의 모든 심볼을 미사용 분석한 것으로 주장하지 않는다. 등록 기능 전수 대조와 주요 자사 실행 경계 조사 결과다.
- 컴파일·제품 회귀·실제 provider 사용·설치 수용은 수행하지 않았다. 후보의 삭제 안전성을 runtime으로 검증한 보고서가 아니다. 이번 산출물은 조사 문서뿐이며 기능 변경·삭제·빌드·설치·상태 migration은 없다.

### 완료 검토

세 영역 조사 결과를 통합하고 OpenRouter 하위 경로는 추가 호출 분석으로 확정했다. 문서의 상대 링크 67개가 모두 존재하고 등록 기능 67개가 빠짐없이 조사표에 있다. UTF-8 대체 문자는 없다. 조사 도중 HEAD의 추가 변경은 기존 BU 작업 문서뿐인 것을 확인했으며 병행 source 변경은 이번 작업에 포함하지 않는다. root의 export 후보 검색은 최초에 파일 내부 호출도 누락 후보로 보았으나 같은 파일 참조를 포함해 재분류하고 네 export(세 catalog/settings 함수 및 test seam)만 남긴 후 직접 확인했다. 이 선별 과정의 중간 후보는 삭제 근거로 사용하지 않았다. 소스·테스트·제품 상태는 수정하지 않았고 생성 build/cache/log 산출물이 없어 별도 산출물 삭제는 없다. 조사 보고서는 후속 정리 범위를 결정하는 보존 작업 문서로 유지한다.

## 삭제 실행 결과

- 구 isolated/existing 설치·복구·launcher·검사 11개 파일을 삭제했다: `install-existing-vscode.ps1`, `check-existing-vscode.ps1`, `existing-vscode-host-check.cjs`, `install-isolated-vscode.ps1`, `launch-installed-azrael.ps1`, `restore-original-codex.ps1`, `check-isolated-install.ps1`, `check-vscode-host.ps1`, `vscode-host-check.cjs`, `start-azrael.ps1`, `check-launcher.ps1`. package producer가 old Launch.ps1/launcher 의존 파일을 생성하는 분기도 제거했다. 현재 native 및 integrated-host 경로는 보존했다.
- 현재 installer/host checker/cleanup에서 구 설치 companion ID 관리·제거·backup·receipt/discovery 필드를 제거했다. 구 ID가 실제 설치되어 있어도 unrelated extension guard의 보호를 받는다. 현재 내부 계정 payload의 `CompanionVsixPath`, bundle 파일명, build cache 이름은 독립 확장 설치 기능이 아니므로 유지한다. cleaner는 native `azrael >=0.4.0`와 integrated account `azrael-ex >=0.3.0`의 현재 artifact identity를 구분한다.
- `catalog.ts`에서 OpenRouter 전용 cache/discovery/lookup 하위 구현과 전용 `tests/catalog.test.ts`를 삭제했다. Anthropic 구현과 공유 helper/정책은 보존하고 옵션 타입을 일반 이름으로 정리했다. 현 관리형 provider에서 OpenRouter를 제외하는 계약과 custom API/vendor 구현은 변경하지 않았다.
- 현재 아키텍처·운영·코드 맵과 provider UPSTREAM 설명을 갱신했다. 삭제된 구 설치/검사 경로는 feature inventory의 owner/check에 등록되어 있지 않아 삭제할 등록 항목이 없다. 유지된 등록 기능의 owner/check 경로가 존재하고 `validateManifest`가 통과하는 것을 확인했다. 다른 작업의 inventory 추가는 이번 변경에 포함하지 않는다.

### 검증 결과와 제한

Windows x64 source/fixture 검사만 수행했다. 제품 build·패키징·설치·실제 계정 요청은 실행하지 않았다. 첫 검증은 source 입력 SHA-256을 시작/종료에 비교했고 모든 입력이 동일했다. 네 경량 검증을 병행했으며 실제 명령별 결과는 `artifacts/tasks/BX-01/evidence/retirement-01/results.json`에 보존한다.

| 검증 | 실제 결과 | 재사용·범위 |
| --- | --- | --- |
| Bun Anthropic catalog / images / inference / reasoning | 최초 29 pass, 1 fail, exit 1. 이미지 기대값 정정 후 images 5 pass, 0 fail, exit 0 | 첫 실행의 나머지 세 파일 25개 통과와 정정 후 이미지 5개를 결합해 30개 검증. Anthropic 운영 구현은 변경하지 않음 |
| Node provider host / ordinary runtime / integrated entry / window-safety | 22 pass, 1 fail, exit 1 | 창 안전성의 선행 source assertion만 실패. 22개 독립 host/provider 검사는 통과 |
| extension backup selection·production guards | 38 pass, 0 fail, exit 0 | current host만 소유하고 구 companion 파일/등록도 unrelated로 보존하는 검사 포함 |
| legacy release/cache cleaner | 52 assertion pass, exit 0 | 현재 두 payload 인정, 구 standalone payload 거절/보존, 설치/프로세스·참조 보호 포함 |
| 실제 package producer의 입력 거절/진입 fixture | 6 pass, harness exit 0 | 구 0.1/0.2 companion·0.3 native·타 publisher 거절. 현재 integrated/native 입력은 source-root 검증으로 진입. 모든 case가 실제 provenance/build 앞에서 중단하며 output directory를 생성하지 않음 |
| PowerShell parser | 7 edited scripts pass, exit 0 | 설치·package·cleaner·검증 source syntax |
| static retirement / feature manifest | pass, exit 0 | 11 source 경로 부재, 활성 source/doc 참조 없음, 제거된 OpenRouter symbol 운영/테스트 참조 없음. 등록 owner/check 누락 없음 |

**창 안전성 선행 실패:** `test-independent-vscode-window-safety.cjs:8`은 현재 `check-independent-vscode.ps1`에 없는 keep-open runner 형태를 요구한다. 검사는 변경한 host-check 모듈을 읽기 전에 실패한다. 두 파일 모두 이번 수정 전 HEAD와 동일함을 정규화 byte 비교로 확인했다. 이 기존 불일치를 감추기 위해 테스트를 지우거나 제품 checker를 범위 밖에서 고치지 않았다. 따라서 전체 host 검증 통과나 설치 수용 완료로 보고하지 않는다.

**이미지 검증 기대값:** 현재 Anthropic SDK prefix 보존 계약(`managed-providers.md`와 기존 inference 구현)에 맞춰 이미지 테스트 한 줄을 literal full-prefix + 원래 fixture instructions의 strict equality로 갱신했다. 도구/이미지 검사는 유지했다. 원 producer 종료와 입력 무결성 확인 뒤 수정했고 해당 파일만 다시 검증했다. 실패한 첫 receipt를 성공으로 덮어쓰지 않는다.

검증은 cleaner의 169.41초가 네 병행 실행의 전체 시간을 결정했다. provider는 38.54초, backup은 5.65초, host는 0.79초였다. 결과 대기 중 package 입력 6건과 참조/문서 검토를 진행했다. 전체 source suite를 다시 돌리지 않고 입력이 동일한 독립 성공 결과를 재사용했다. 상세 명령·시각·exit와 source fingerprint 및 실패 진단은 보존 evidence에 남긴다.

### 증거 보존과 정리

원 실행의 로그·source fingerprint·명령/시각/실제 exit·38개 backup case 결과와 실패 진단을 [검증 증거](../../artifacts/tasks/BX-01/evidence/retirement-01/preservation.json)에 복사하고 SHA-256 일치를 확인했다. `bx01-retirement-verification` 전체를 explicit delete로 처리했고 `runs/retirement-01`의 실제 부재를 확인했다. backup fixture가 남긴 Junction 1개는 소유 run과 실제 target이 같은 task 안에 있는지 확인한 뒤 ordinary link removal로 해제해 producer teardown을 마쳤다. 링크를 따라 재귀 삭제하지 않았다.

`bx01-retirement-evidence`는 결과·실패 진단과 재현 control을 함께 유보한다. 패키지/설치 수용과 기존 창 안전성 불일치가 해결되거나 동등한 독립 검증으로 대체되면 전체 증거 묶음 삭제를 재검토한다. cleanup apply의 run `remaining=false`, evidence `remaining=true` 결과를 확인했다. 기존 설치본·사용자 데이터·다른 작업의 source/산출물은 변경하지 않았다.

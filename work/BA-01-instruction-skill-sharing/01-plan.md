상태: 핵심 기능 소스 구현·검증 완료. 설치된 앱과 실제 GitHub의 수용 검증은 남아 있다. 앱 전체 빌드·설치 및 원격 저장소 생성·실제 업로드는 별도 실행 대상이다.

# 선택 지침 패키지·작업 프로필과 개인 스킬 관리

## 목표와 합의

Azrael에서 개인 스킬 전체를 한 화면으로 관리한다. 공개 / 고정 협업 그룹 / 로컬 전용 세 범위를 사용한다. 공개·협업 콘텐츠는 별도 GitHub 저장소이며 로컬 전용은 Git 추적·공유 산출물에서 제외한다. 저장소 이름과 생성은 미실행이다.
새로 만들거나 처음 가져온 스킬의 기본 범위는 협업 그룹 공유다. 저장은 로컬 원본, 적용은 설치본, 게시는 변경 확인 후 GitHub 공유를 각각 수행한다. 적용과 게시 순서는 독립적이다. 설치 변경은 새 대화부터 사용한다.

## 담당 설계와 확정 정책

상세 동작·구조·실패 처리는 [지침 문서 설계](../../docs/architecture/instructions.md#personal-skill-management)가 소유한다. 기존 합의와 추가 제안을 구분했다.

| 정책 | 확정 내용 | 영향 |
| --- | --- | --- |
| 공개 범위 축소 시 과거 자료 | Git 이력·배포본 보존, 이후 게시 제한, 과거 게시 있음 표시 | 이미 공유한 내용을 비공개로 회수했다고 표시하지 않는다. 범위 변경은 과거 자료 삭제·Git 이력 변경을 수행하지 않는다. |
| 협업자 게시 권한 | 실제 GitHub 쓰기 권한이 있는 협업자 모두 | 고정 협업 그룹에서 공동 관리한다. 게시 버튼과 실행 검사는 실제 저장소 쓰기 권한을 따른다. |

나머지 세부 제안: 개인 원본 가져오기는 원본 설치를 보존하고 지원 파일까지 함께 처리한다. 시스템·플러그인 스킬은 제공자 관리로 표시하며 개인 파생본은 별도 이름으로 만든다. 설치본 외부 수정·원격 동시 수정은 충돌로 표시한다. 신규 개인 설치 대상은 현재 CODEX_HOME/skills와 같으며 프로젝트 원본 위치와 적용 범위를 구분해 보여준다. GitHub 인증은 설치 호스트의 session 지원을 확인해 재사용하고 필요 시 SecretStorage 대안을 둔다. 기존 baseline instructions/ 소유권과 개인 라이브러리를 구분해 중복 원본을 피한다.

## 선택적 지침 공유와 작업 특화 제안

사용자는 앱과 함께 설치하는 공통 지침보다 선택적으로 포함할 수 있는 지침을 중심으로 공유하는 방향을 요청했다. 모델과 제공 컨텍스트를 함께 저장하는 조합 작업 프로필을 개별 지침 공유와 함께 제공한다. 기존 공개/협업/로컬 범위, 협업 기본값, 저장/적용/게시 분리는 유지한다.
현재 manifest는 전역 AGENTS, 2 agent roles, 5 skills, workspace app-logging playbook, agent-config의 10 components다. 이것은 배포 구성이지 원격 게시 완료 근거는 아니다. 계정 profile, named config profile, harness profile의 소유권을 구분했다. config profile에는 model/provider/reasoning이 있고 harness profile은 behavior template과 tool preset을 조합하지만 task resource 참조·공유·선택 UI는 추가 구현이다.
추천 공유 단위는 skill / agent-role / context / task-profile의 버전 패키지다. 작업 profile은 기본 모델과 필요한 패키지의 고정 참조를 조합하며, 개별 패키지도 독립적으로 가져온다. 동일 문서를 profile마다 복제하지 않는다. 상세 제안은 [선택 지침·작업 프로필 설계](../../docs/architecture/instructions.md#selectable-instruction-packages-and-task-profiles)가 소유한다.
적용 범위 제안은 library 저장과 task 활성화를 분리하고 새 대화에서 profile을 명시적으로 선택하는 방식이다. 개인 설치 경로에 파일이 있다고 해서 전 대화에 모든 지침을 켜지 않는다. native prompt·catalog·tool admission 연결 검증이 필요하다. 필수 런타임·root·권한 지침은 선택 패키지로 취급하지 않는다.
확정 모델 정책: 추천 모델을 저장하고 적용 시 사용자의 명시적 변경을 허용한다. 변경 후 필요한 기능과 제공자/도구 호환성을 확인하며 실제 선택을 기록한다. 모델을 자동 대체하거나 공유 profile을 조용히 변경하지 않는다. 개별 지침 + 조합 프로필 제공과 이 모델 정책은 합의되었으며 세부 패키지·활성화는 draft다.
확정 적용 범위: 작업 profile은 선택한 새 대화에만 적용한다. 전역·프로젝트 기본값, 진행 중인 대화와 해당 profile을 선택하지 않은 다른 새 대화는 변경하지 않는다. 가져오기만 한 profile의 지침은 활성화하지 않는다. 주요 공유·적용 정책은 정리되었으며 실제 resolver·context projection·설치 경계의 구현과 검증이 필요하다.
설계 검증 범위: 실제 manifest와 engine config/src/profile_toml.rs, harness_profiles.rs 및 기존 architecture의 native contract를 확인했다. 새 코드·모델 실행·profile activation 실험은 수행하지 않았다.

## 현재 근거와 구현 차이

instructionView.ts에는 미구현 제목이 고정되어 있으나 instructionService.ts와 instruction-package.cjs에 릴리스 조회·문서 미리보기·다운로드·해시 확인·선택 적용·충돌 검사·고정·롤백·복구가 있다. 개인 편집·게시·권한·다중 소스는 추가 구현이다. 현 backend는 비공개 GitHub 인증을 전달하지 않는다. 캐시는 version만 경로에 사용하므로 저장소/source identity별 격리와 설치 영수증 전환이 필요하다.
build-instruction-release.cjs는 소스 전체를 순회한다. 따라서 gitignore만으로 공유 제외를 보장할 수 없다. 필터된 고정 입력으로 ZIP·manifest·documents·release notes를 모두 만드는 게시 경계가 필요하다. GitHub 커밋과 릴리스는 단일 원자적 작업이 아니며 원본 공유 성공과 배포본 완료를 구분한다.

## 구현 인계 순서와 검증

1. 스킬 registry·가져오기·원본 편집·상태 비교 및 로컬 전용 보호 경계를 마련한다. 기존 baseline 소유자는 보존한다.
2. 다중 소스 설치 ledger·캐시 migration과 기존 staged apply·복구를 연결한다. 서로 다른 저장소의 같은 이름·버전을 검증한다.
3. GitHub 연결과 읽기 권한, 비공개 다운로드, 게시 고정 입력·비강제 branch 반영·draft release·재개를 연결한다.
4. 공개 범위 전환과 상태 표시, 원격 충돌과 일괄 게시 결과를 연결한다.
5. OpenAI 스타일 설정 화면의 목록·상세·연결·적용/게시 preview를 렌더링하고 실제 설치 환경에서 전체 흐름을 확인한다.

계약은 플랫폼 공통이며 파일 경로·인증·보안 저장소는 해당 호스트 소유다. 최초 실제 검증 대상은 Windows 설치본으로 제안하며 Linux/macOS 수용은 별도 근거가 필요하다. 원격 workspace는 관리 라이브러리와 credential 소유 호스트를 명시적으로 선택한다.
필수 수용은 지원 파일 포함 import, 저장/적용/게시 독립성, 무권한 접근 차단, local-only 내용·이름의 모든 공유 산출물 부재, 설치·원격 충돌, 커밋 후 release 실패와 복구, 과거 이력 있는 범위 전환, offline 동작, light/dark UI 및 새 대화 적용이다. 기존 ui.instruction-settings 보존 항목은 구현 단계에서 실제 추가 owner/check에 연결한다.

## 이번 설계 검증

기존 코드·설치/배포 설계와 비교하고 GitHub 공식 refs/releases 및 VS Code 인증 API를 확인했다. 문서 링크 검사 종료 코드 0 (8개 로컬 대상), 작업 diff 검사 종료 코드 0. 첫 검사 helper의 기본 인코딩 오류를 UTF-8 명시로 수정한 뒤 재검사했다. 이 작업에서는 native build, 앱 실행, GitHub 계정 접속이나 게시 실험을 수행하지 않는다. 문서 검증과 제품 동작 검증은 구분한다.

선택 지침 추가 설계 검증: 로컬 문서 링크 검사 종료 코드 0, 작업 파일 diff 검사 종료 코드 0. native profile 활성화와 설치 검증은 수행하지 않았다.

## 실행 배정과 현재 선행 조건

root: 공통 JSON/TS 계약, host adapter·GitHub 인증, native 새 대화 전환, 패키지 포함·보존 목록과 최종 검증.
library_backend: scripts/instruction-library.cjs와 전용 test — 버전 library, immutable plan, apply/recovery.
github_publication: scripts/instruction-publisher.cjs와 전용 test — remote Git API·release, auth redirect, 실패 복구.
library_ui: instructionView와 test, inject-instruction-settings와 test — UI와 두 client.
task_activation_evidence: native thread/start config·task-only skill/role 발견 경계 read-only. root의 task admission 연결이 후속 소비자다.
공유 계약: 원격 packages/<id>/<digest>/ immutable snapshots와 heads를 사용해 기존 recipe의 고정 dependency를 보존한다. planPublish는 rootIds/heads를 명시하고 current sharing으로 historical export도 검사한다.
확정 소비자가 없는 native 활성화 연결만 조사 결과를 기다리며 library·publisher·UI는 독립 진행한다. extension 컴파일은 UI 변경 준비 이후 root 한 번만 실행한다. 실제 GitHub와 현재 사용자의 설치 skill·계정에는 fixture 검증 중 쓰지 않는다.

## 구현 결과와 검증 상태

공통 계약: skill / agent-role / context / task-profile을 같은 local registry에서 관리한다. 기본 collaborators, Save / Apply / Publish 분리, 현재 공유 범위에 따른 historical dependency 게시 차단, 별도 public/private sources와 실제 writer 권한 검사를 구현했다. Windows 소스·격리 Chrome·네이티브 관련 모듈이 실제 검증 대상이다. Linux/macOS와 설치된 앱의 새 대화 lifecycle은 수용했다고 표시하지 않는다.

로컬 backend는 immutable ID/digest snapshots, profile 고정 dependency resolver, 지원 파일·binary import/edit, Git 무시 경계와 decoded credential/path exclusion을 소유한다. Apply는 기존 baseline installer와 공통 writer lock을 사용한다. 이미 설치된 동일 bytes의 explicit adoption은 원본을 보존하고, 이후 이름/파일 변경에서 복원한다. 외부 변경·다른 owner와 baseline journal은 mutation을 막는다. 두 library의 실제 경쟁, stale owner 복구와 원본 보존을 테스트했다.

GitHub backend는 resource repository의 nonforce commit, draft Release+asset 검증, 응답 소실·경쟁·commit 후 실패와 고정 bytes 복구를 구현했다. source-committed 사실은 즉시 history로 기록하고 재시작에서도 local journal로 복구한다. Source commit 전 공유 범위를 local로 바꾸면 이전 prepared 게시를 재개할 수 없다. 인증·frozen plan은 host에 보관하며 webview에는 검토용 summary/preview와 opaque token만 전달한다. 실제 GitHub나 사용자의 저장소에는 요청하지 않았다.

네이티브는 per-thread skills.extra_roots를 추가하고 기존 shared skill service의 cwd cache로 흘러들지 않게 했다. 모델/provider/reasoning 및 지원 builtin harness 조합은 native catalog로 확인하고 대체하지 않는다. role은 선택 thread config로 연결하며 짧은 profile instructions는 additive, context 참조/skill body는 on-demand로 둔다. origin-bound one-use token은 프로젝트 선택으로 새 패널에 이동할 때 프로필을 유지하며 일반 New Chat에서는 취소한다. thread association은 firstTurnPending을 저장하며 첫 turn의 model/effort와 collaboration settings를 고정하고 정상 turn 응답에서만 해제한다. 이후 native picker와 다른 대화·기본 config의 의미는 보존한다. cold resume는 고정 snapshot을 재사용한다. role은 root의 명시 v1/v2 capability와 enabled native feature를 요구하고 child 모델 availability도 첫 turn 전에 다시 확인한다.

검증 근거:

- 로컬 backend 17/17, 종료 0. 기록: artifacts/logs/instruction-library-20261014/node-test.log. 최종 범위에 adoption, 공통 lock와 encoded secret 차단 포함.
- GitHub protocol 17/17, 종료 0. 기록: artifacts/logs/instruction-publisher/tests-final.log. 실제 library→복구→verified reimport interop과 hostile ZIP/redirect를 포함한다.
- 최종 root 통합 source 실행 27/27, 종료 0, 39.893s. 기록: artifacts/logs/instruction-integration-20261014/integrated-source.log. 이 숫자에는 TS host test 세 파일을 각각 격리 subprocess에서 실행한 wrapper 3개가 포함된다. 내부 renderer 6, 기존 baseline adapter 6, 개인 adapter 7개 사례를 실제로 수행한다. 설정 injection 6개, publisher 17개, account-ui dependency layout 실제 module-load fixture 1개도 포함한다.
- TypeScript semantic --noEmit 종료 0. 기록: artifacts/logs/instruction-integration-20261014/typescript-verified.log. source root를 직접 검사하며 앱 package를 생성하지 않았다.
- 네이티브 codex-config skills_config 11/11, 종료 0, 최종 33.600s; codex-skills-extension host_roots 12/12, 종료 0, 153.180s. 기록: artifacts/logs/task-profile-native-skills/results.txt와 관련 logs. 두 초기 schema assertion 실패는 실제 schema 생성기의 ref/settings에 맞춰 고쳤다. 마지막 formatting-only 변경은 동작을 바꾸지 않았다. 기존 target cache를 재사용하고 별도 cache를 생성하지 않았다.
- 실제 Chrome 렌더링 35/35, 종료 0. light/dark 편집·지원/binary 파일·미저장 draft·게시/적용/task token·source별 version·keyboard import 확인. 360px에서 발견한 digest/grid overflow를 고친 후 scrollWidth=clientWidth=345px, desktop editor 552px 보존. 기록: artifacts/logs/instruction-library-ui/summary.json와 작은 theme screenshots. Chrome과 fixture/profile을 종료·제거하고 부재를 확인했다. 이후 summary bilingual 처리만 변경했으며 renderer/semantic tests로 확인했다.
- 최종 task transport 실행 18/18, 종료 0, 46.301s. 기록: artifacts/logs/BA-01-task-profile-final/validation-final.log. 프로젝트 transfer·재생 방지·first-turn 실패 재시도·native context 보존을 포함하며 실제 pinned APP/HOST/BRIDGE 전체 namespace 변환 각각 task bridge 1개, source/output SHA256 일치와 TypeScript parse errors 0을 확인했다. 후속 리뷰에서 native MultiAgentVersion의 disabled/unknown 차단과 first-turn child model 재검사를 추가했고 runtime 최종 14/14, 종료 0으로 확인했다. 기록: artifacts/logs/BA-01-task-profile-final/validation-runtime-capability.log. 이 수정에서 injector는 바뀌지 않아 전체 namespace 근거를 재사용한다.
- 최종 host adapter/renderer 및 account-ui module layout 재검사 wrapper 4/4, 종료 0, 47.853s. 기록: artifacts/logs/instruction-integration-20261014/final-host-layout.log. 마지막 runtime capability 수정 이후 module layout은 별도 재확인했다. TypeScript --noEmit과 feature owner/check 목록 검사는 종료 0. 기록: typescript-final.log, feature-contracts-final.log (동일 root integration log directory).

기존 baseline adapter 검증은 이미 존재하는 artifacts/instructions/review-1.0.0과 codex_latest_20261010_r15_isolated 배포본의 native validator를 재사용했다. 이 바이너리를 변경된 현재 source로 생성했다고 주장하지 않는다. 모든 fixture는 격리 CODEX_HOME을 사용하고 사용자 설치본·skill·credential을 수정하지 않았다. 새 module packaging 및 host adapter fixture 제거를 확인했다. 최초 TypeScript 로그가 잘못 만들어진 extensions/azrael-ex/artifacts는 root log 위치로 옮긴 뒤 빈 디렉터리 제거·부재를 확인했다.

설치/전체 빌드 선행 조건: 기존 build playbook은 일반 구현 요청과 전체 앱 빌드·설치를 구분한다. 전체 앱/배포본 생성·설치 및 실제 GitHub 공개는 실행하지 않았다. 엔진 provenance recorder를 이번 6개 source path에 한정해 실행했으나 종료 1: 현 SOURCE.json 이후 실제 delta는 193개이며 187개는 다른 작업의 기존 변경이다. expected-path와 정확히 일치하지 않아 recorder가 mutation을 거부했고 SOURCE.json hash가 그대로임을 확인했다. 기록: artifacts/logs/instruction-integration-20261014/native-source-record.log. 다른 작업을 무조건 승인하거나 provenance에 섞지 않았다. 전체 빌드 전 해당 source owner들의 출처 기록 통합이 필요하다.

실행 시각은 로그 생성/최종 수정 timestamp로 관찰해 artifacts/logs/instruction-integration-20261014/log-times.json에 보존했다. UTC 기준 root 통합 source 04:59:22–05:00:02, 최종 native config 04:30:16–04:30:50, host_roots 04:31:08–04:33:41이다. 생산자 시작/종료 자체를 별도 측정한 시간표로 주장하지 않으며 병렬 실행 시간을 더해 전체 소요 시간으로 보고하지 않는다. Frontend 요청 한도는 backend에서 허용한 binary 지원 파일을 base64 전송해 편집할 수 있게 조정했고 renderer 회귀를 확인했다.

현재 제공 범위는 개별 패키지 생성·폴더 가져오기·파일 편집·공유 범위와 독립 저장/적용/게시, 고정 dependency profile과 선택한 새 대화 시작이다. profile 조합은 JSON 편집을 사용한다. 설치/provider-managed 원본의 자동 inventory, maintained-source 등록, source pin UI, package별 persistent loading 선택과 custom shared behavior template은 추가 제품 확장으로 남는다. 현재 사용자 설치본과 저장소를 변경하거나 해당 확장을 구현했다고 표시하지 않는다.

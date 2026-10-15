상태: 초기 변경 관리·병목 관측 소스 구현과 Windows 검증 완료. 설치본 적용·전체 스케줄러 수용은 별도다.

# Team 변경 관리 시스템 검토

## 목적과 범위
공유 대화의 Scion·로컬 Changeset 제안을 기존 Team 설계와 비교하고, 후속 합의에 따라 Git 위의 변경 관리와 병목 관측을 구현한다. [Team 설계](../../docs/architecture/work-orchestration.md)가 동작 계약을 소유한다. [UI 작업](../AZ-01-team-lead-ui/01-plan.md)의 기존 동작을 보존한다. 제품 전체 빌드·설치·사용자 저장소의 실제 변경 통합·push는 이번 실행에 포함하지 않는다. 격리된 검증 저장소의 커밋·ref 갱신은 기능 검증에 포함한다.

요구·변경·검증 상태의 의미는 지원 플랫폼 공통이다. 파일 격리와 디스크 최적화는 OS·파일시스템·local/remote 경계의 혼합 요구다. 초기 검토는 Windows에서 소스와 공식 문서를 읽었고, 후속 구현은 Windows x64 Node 26.7의 실제 격리 Git 저장소와 transformed native host fixture로 검증한다. 다른 OS·실사용 모델·설치본 수용과 실제 작업 성능 개선은 별도다.

## 검토 당시 근거와 출발점
- 공유 원문: https://chatgpt.com/share/6ad0b0d4-9940-83ec-a2f3-b771c181cf6c . 웹 추출은 제목만 반환했다. HTTP 200 HTML의 React Router stream을 JSON 데이터로 파싱해 current_node의 부모 경로에 속한 메시지만 읽었다. 실행 코드로 평가하지 않았다. 원문의 핵심 제안은 로컬 변경 이력과 외부 Git 이력의 분리, 독립 Changeset, 의존성·검증 상태 관리다.
- Anthropic 공식 원문: https://www.anthropic.com/engineering/redesigning-source-control . 2026-10-13 공개. 초대규모 서버 환경의 내용 주소 기반 객체, API, sparse/virtualized checkout, post-merge/pre-deploy 검증 사례다. Azrael의 효과나 잠금 제거의 근거로 그대로 일반화하지 않는다.
- 현재 Team 설계에는 고정된 작업 기준, 설계 버전·결과 커밋, 시도 ID, 통합 잠금, 마지막 검증 완료 기준의 구분이 이미 있다. 확인한 native Team registry 구현은 host·Lead·member 식별자 중심이며 본 제안의 변경 관리 runtime은 확인한 구현 범위에 없다.
- `scripts/deployment-input-snapshot.cjs::snapshotProject`는 파일 inventory/hash를 산출한다. 파일 내용을 보관해 복원하는 snapshot 저장소나 실행 입력의 불변성을 강제하는 기능으로 간주하지 않는다.
- `scripts/artifact-lifecycle.cjs::recordLifecycle`는 소유 그룹·member·참조·expected_revision·기록 교체를 제공한다. 새 변경 관리의 검증 로그·산출물 소속에 재사용할 후보이며 코드 버전 관리와 통합 transaction을 대신하지 않는다.
- Git 2.55.0.windows.3 확인. `jj`는 현재 PATH에서 찾지 못했다. 설치 전체의 부재를 뜻하지 않는다.

## 추천 구조
Git 객체/커밋과 task worktree를 코드의 권위 있는 저장소로 유지하고, 그 위에 Team 변경 관리 서비스를 둔다. 별도 patch/blob DB를 함께 코드 원본으로 운영하지 않는다. 변경 서비스는 요구 버전, Change ID, 수정 버전, 작업·시도·세션, 의존 결과, 코드 참조와 검증·반영 상태를 소유한다. Work 문서는 설계·요청·결과의 읽기 쉬운 참조를 제공하며 live 상태 원장을 중복 편집하지 않는다.

Change는 논리적인 작업 결과 묶음이다. 재시도·rebase·수정으로 Git SHA가 바뀌어도 Change ID는 유지하고, 불변 revision을 추가한다. 준비 조사처럼 코드 결과가 없는 작업은 별도 실행 결과로 끝낼 수 있다. 한 revision에는 저장소 ID, 고정 base/result commit 또는 tree, 설계 버전, 범위, 정확한 선행 revision, 실행 시도, 테스트 입력/환경/명령/실제 종료/로그 참조를 연결한다. `tests: passed` 같은 boolean만으로 통합 가능 상태를 정하지 않는다.

Lead는 요구를 같은 설계에서 누적한다. 실행 root가 고정된 요청을 작업에 배정하고 worker는 checkpoint/submit 같은 API로 결과를 제출한다. 작업자는 통합·권한·공통 요구 결정을 임의로 확장하지 않는다. 정상 상태 변경은 구조화된 이벤트로 수집하고 모델에는 필요한 요약·예외만 제공한다.

새 요구 추가와 이미 실행 중인 작업 변경은 구분한다. 실행 중인 계약을 문서 수정만으로 바꾸지 않고 대상 Change/Task·요구 버전과 적용 접수를 남긴다. 개별 세션의 사용자 개입도 같은 식별자에 연결한다. 범위 안의 방법 조정과 공통 계약 변경을 구분하며 후자는 Lead/root가 영향받는 작업만 갱신한다. 도구 중단 요청과 실제 종료를 구분한다.

## 통합과 복구
초기안은 이미 합의한 Team 단일 통합 담당과 검증 종료까지의 잠금을 유지한다. 제출 revision, 현재 Team 기준과 정확한 의존 결과를 확인하고 후보를 생성한다. 충돌 해결 후 나온 후보의 정확한 코드·리소스·설정에서 검증한 뒤 Team 반영 완료로 바꾼다. worker 테스트 통과는 이 후보 검증을 대신하지 않는다. 같은 제출/이벤트 재전달은 같은 operation ID로 중복 적용을 막는다.

Git ref 갱신과 메타데이터 저장을 하나의 DB transaction처럼 취급하지 않는다. 작업 의도·expected old commit·candidate·operation ID를 먼저 보존하고, 적용 후 실제 ref와 기록을 대조해 복구한다. stale 통합 담당을 배제할 권한 세대와 실행 경계가 필요하다. Git `update-ref`의 old-oid 비교는 ref 갱신의 전제 확인이며, 활성 worktree의 index/파일 갱신이나 전체 transaction을 대신하지 않는다.

검증 실패는 후보와 증거를 보존하고 마지막 검증 완료 기준을 유지한다. private 작업 복원도 이미 생긴 사용자 변경을 덮어쓰지 않는 조건에서 수행한다. 이미 반영된 변경의 취소는 뒤따른 의존 결과를 확인한 새 수정/되돌림으로 처리한다. Team 전체를 과거로 무조건 되감지 않는다.

통합 대기가 실제 병목으로 측정되면 별도 고정 후보에서 검증하고 짧게 승격하는 방식을 다음 후보로 비교한다. 기존 잠금 범위를 바꾸는 후속 설계 결정이다. 기준이 바뀐 후보는 재조합·필요 검증 후 승격하며 이전 후보의 통과를 그대로 사용하지 않는다. 디스크·CPU 비용과 검증 취소/재실행이 늘 수 있다. Scion처럼 먼저 반영 후 검증하는 정책은 기본안으로 추천하지 않는다.

## 도구와 용량
Git은 unchanged 객체를 재사용한다. linked worktree는 객체 저장소를 공유하므로 작업자별 clone을 전제로 한 Scion 규모의 이득을 가정하지 않는다. sparse worktree를 유지하고 큰 binary/Unity 에셋·설정의 충돌과 Library/빌드 산출물 용량을 따로 관리한다. 논리적 Changeset 도입만으로 디스크 중복이나 의미 충돌이 없어지지 않는다. untracked·ignored·LFS·파일 모드·symlink 등은 명시적으로 포착/참조 정책을 정해야 한다.

공식 Git `merge-tree --write-tree`는 실제 working tree/index를 건드리지 않고 병합 tree를 계산하므로 후보 사전 분석에 재사용할 수 있다. 객체는 생성할 수 있으며 읽기 전용 시험과 동일하지 않다. 완전한 제품 검증·자원 격리·접근 제어는 별도다. 근거: https://git-scm.com/docs/git-merge-tree 와 https://git-scm.com/docs/git-update-ref .

Jujutsu는 Git backend와 작업 이력의 후보이나 공식 호환성 문서가 .gitattributes·LFS·Git worktree 등에 제약을 설명한다. Unity·Windows·현재 Git 도구 통합 검증 없이 초기 backend로 교체하지 않는 편을 추천한다. 근거: https://docs.jj-vcs.dev/latest/git-compatibility/ .

## 도입 순서와 판단 기준
1. 기존 Git/worktree 위에 Change/revision/의존성/검증/적용 이벤트 모델과 최소 제출·복구 API를 검증한다. 이 초기 단계부터 단계별 시간·차단 원인·실패·재작업·자원·관측 신뢰도 수집을 포함한다.
2. 최근 채팅의 기존 Team 표시를 재사용하고 변경 목록에서 요구 버전·담당·의존 대기·검증 대기·충돌·Team/메인 반영을 구분하는 UI를 검토한다. 현재 UI 변경은 실행하지 않는다.
3. 수집한 기준선에서 임계 경로의 대기와 재작업을 찾아 개선안을 비교한다. 파일 복사나 Git이 실제 병목일 때만 별도 overlay/VCS를 비교한다. 전체 완료 시간·품질·token·자원 비용으로 개선 전후를 판단한다.

구현 전 정할 것은 메타데이터 소유 process/저장소, 내부 checkpoint와 외부 Git commit 대응, 사용자 변경의 즉시 적용/다음 시도 적용, 자동 실행·메인 반영 권한, 유지·GC 정책이다. 요구 계약은 공통이고 OS별 파일 격리는 각 대상에서 검증한다. 현재 설계의 단일 통합 정책을 바꾸는 최적화는 별도 선택으로 남긴다.

## 병목 관측 요구와 후속 검증

소유 계약은 [병목 관측과 개선](../../docs/architecture/work-orchestration.md#병목-관측과-개선)이다. 요구 이관, 실행 가능 작업의 배정, 선행 작업·자원 대기, 공간 준비·import, 모델·도구, 통합·충돌·검증, 공유 자원·산출물 및 수집 서비스 자체를 감시한다. 단계 이벤트를 Change/revision·실행·후보·환경과 연결하고 모델에는 요약·예외만 전달한다. 사용자 대기·관측 불가·수집 누락은 별도 상태로 보존한다.

런타임 구현 시 필수 수용 범위는 다음과 같다.

- 정상·실패·취소·재시도·중단 후 복구의 타임라인을 재구성하고, 종료 누락·중복 이벤트를 성공 또는 0초로 잘못 표시하지 않는다.
- 선행 결과 대기와 실행 가능한 작업의 배정 지연, 자원·캐시 잠금과 실제 실행, 병합·충돌·검증의 시간을 구분한다. 동시 실행과 복수 차단 원인을 중복 합산하지 않는다.
- 원격 시계 오차·미지원 OS 지표·provider usage 부재를 표시한다. 요구 변경과 실행 실패의 재작업 원인을 구분한다.
- 알려진 대기·적체를 주입해 원인·영향받은 후속 작업과 경보를 확인한다. 저장 실패·수집 누락·버퍼 상한·필수 증거 보호와 수집 비용도 검증한다.
- 비교 가능한 입력·환경의 기준선과 표본 수를 남기고, 전체 완료 시간·실패·재작업·token·자원 비용을 함께 비교한다. 검증 범위를 줄여 얻은 수치를 개선 근거로 쓰지 않는다.

소스 구현과 실제 배포·설치 수용을 구분한다. 관측은 런타임 상태 이벤트와 호스트 도구 경계에서 수집하고, 별도 대시보드·알림 채널은 추가하지 않는다. 구체적인 용량 상한과 미수집 표시를 구현·검증한다.

## 실행 배정과 수용

공통 요구는 요구·revision·상태·이벤트 의미와 관측 요약이다. Git 경로·원자적 저장·호스트 자원 수집은 OS 및 local/remote 경계의 혼합 요구다. 기존 native local Team을 실행 진입점으로 연결하고 remote는 실제 transport 가용성을 확인한다. 현재 검증 호스트는 Windows x64 Node 26.7이며 다른 환경의 수용은 별도다.

root는 API·권한 계약, native 연결, 보존 목록·문서와 최종 통합을 소유한다. `team_change_core`는 새 변경 서비스와 실제 Git fixture 검사를, `team_observability`는 새 관측 모듈과 검사만 소유한다. `team_runtime_hooks`는 native 도구·이벤트 연결 경계를 읽기 전용 조사한다. 담당자 간 직접 조율 없이 root가 계약 차이를 전달한다.

변경 서비스는 불변 revision·정확한 의존 결과·요구 적용 확인·idempotent 쓰기·배타적 통합 예약·복구 원장을 제공한다. 후보 생성과 테스트 실행은 기존 권한을 가진 도구에서 수행하고, 서비스는 활성 checkout을 직접 수정하지 않는다. 검증 근거는 제출 출처를 표시하며 명시적 coordinator 검토 후에만 전용 verified ref를 승격한다. 자동 작업 분해·무인 후보 생성은 이 서비스의 실제 가용성과 구분한다.

초기 필수 검사는 실제 Git 저장소에서 불변 제출·stale 요구·의존 결과·동시 쓰기·오류/중단 복구, 관측 누락·상한·privacy·재개·시간 계산, native 호출자의 Team/역할·호스트 경계, 기존 Team 생성·재개 회귀다. 테스트 입력과 로그는 사전 등록한 `artifacts/tasks/BQ-01/runs/{core,observer,host}/`에 한정한다. 각 산출물은 생성 전 lifecycle `team-change-implementation-{core,observer,host}`로 등록했다. 최종 결과 검토 후 임시 저장소를 보통 삭제하고 작은 근거 로그만 보존한다.

## 자료 소속과 검증 범위
검토 입력·JSON 파싱 산출물은 `artifacts/logs/team-change-review/`에 이 작업 소속으로 한정해 보존했다. 현재 대화 본문의 추출·분기 선택을 다시 확인할 근거로 후속 구현 준비의 입력·보존 판단까지 보존하며 앱 데이터·빌드·실사용 세션은 만들지 않았다. lifecycle ID `team-change-review-20261015`에 실제 생성 소속을 기록한다. 초기 수집 후 현재 규칙을 확인해 기록했으며 사전 등록으로 소급 주장하지 않는다. 임시 plan-body는 문서 생성 후 보통 삭제하고 실제 부재를 확인했다.

초기 검토는 공유 원문 HTTP/데이터 파싱, 공식 문서와 기존 설계·지정 코드 owner의 비교이며 문서 링크·anchor 검사를 통과했다. 후속 소스 실행 검증은 아래 기록을 따른다. 목표 설계와 소스 fixture 검증은 설치된 앱 수용이나 실제 작업의 성능 향상을 뜻하지 않는다.

## 구현 결과와 검증 근거

변경 서비스·관측기·native 어댑터를 `scripts/team-change-service.cjs`, `team-observability.cjs`, `team-runtime-host.cjs`에 구현하고 기존 Team 주입에 번들링했다. native 도구 등록·직접 응답·실제 부모 소속 확인과 기존 도구·권한 보존을 검증한다. 번들 입력 모듈의 hash를 host transform cache에 연결하고 feature ID `ui.team-change-management`로 보존한다. 새 UI 화면은 추가하지 않았다.

첫 Team 회귀에서 Computer Use의 재주입 검증이 Team prefix와 충돌해 실패했다. 두 소유자의 정확한 prefix 조합을 검증하도록 수정한 뒤 재실행해 통과했다. 토큰 기준 부재는 정상 usage로 간주하지 않으며 첫 host 검사 기대값도 이 계약에 맞춰 수정했다.

- `node --test scripts/test-team-ui.cjs scripts/test-team-runtime.cjs scripts/test-team-integration.cjs scripts/test-team-change-service.cjs scripts/test-team-observability.cjs scripts/test-team-runtime-host.cjs scripts/test-namespace-cache-owner.cjs`: 15/15 통과, exit 0, 경과 47.43초. 로그 `artifacts/tasks/BQ-01/runs/host/logs/final-team-checks.log`.
- 후속 잠금 복구·collector 보강 뒤 `node --test scripts/test-team-change-service.cjs scripts/test-team-observability.cjs scripts/test-team-runtime-host.cjs scripts/test-team-runtime.cjs`: 4/4 통과, exit 0, 경과 12.12초. 로그 `artifacts/tasks/BQ-01/runs/host/logs/final-runtime-checks.log`.
- `node --test --test-name-pattern 'Maintained Lead' scripts/test-team-integration.cjs`: 최신 번들 모듈·host 한정 cache 입력 검사 통과, exit 0. 로그 `artifacts/tasks/BQ-01/runs/host/logs/final-cache-inputs.log`.
- feature inventory·owner·transform rules 검증 통과, exit 0. 개별 회귀 로그는 각 `core/logs/core-test.log`, `observer/logs/observer-test.log`, `host/logs/host-test.log`에 둔다.

관측기 기본 상한과 불완전 상태, 명시적 검토 뒤의 전용 verified ref 승격, 동일 로컬 PID 부재를 확인하는 저장 잠금 복구를 구현했다. 제출된 base/result 커밋을 전용 ref로 고정하고 작업 브랜치 제거·reflog 만료·실제 Git GC 이후에도 남는지 검증했다. 깊은 Windows fixture에서 Git 경로 제한을 발견해 사용자 설정을 변경하지 않는 명령별 `core.longpaths=true`로 수정하고 다시 검증했다. 필수 원장·후보 코드를 자동 정리하지 않는다.

실제 자동 작업 배정·worktree 생성/병합/에디터 쓰기 강제·메인 반영·실사용 모델의 호출·앱 빌드/설치는 수행하지 않았다. 실행 root에 coordinator 역할을 별도로 부여하는 경계는 미구현이며 현재 승인자는 등록된 Lead다. 이 제한은 소유 설계의 현재 소스 경계에 명시했다.

최종 수정 전체에서 최초의 7개 파일 검사를 다시 실행해 15/15 통과했다(exit 0, 46.86초). 로그는 `artifacts/tasks/BQ-01/runs/host/logs/accepted-team-checks.log`다. 관측기 내부 회귀는 14개 계약 그룹을 포함한다. 최신 모듈이 포함된 transformed host에서 도구 응답을 실행했으며 정규 namespace 파이프라인의 최종 hash와 소스 구문도 확인했다. 문서 2개의 로컬 링크·anchor 15개와 whitespace 검사를 통과했다. 실제 성능 단축 비교는 하지 않았다.

검증 프로세스 종료 뒤 생성된 임시 저장소 8개 정리 단위와 fixture junction 8개를 삭제하고 부재를 확인했다. 첫 보통 삭제의 실패 원인이 생성된 Git 객체의 ReadOnly/Hidden 속성이어서, 소속·경계·참조를 확인한 생성 파일 210개의 해당 속성만 정규화한 뒤 보통 삭제했다. System·ACL·소유권은 변경하지 않았다. 실제 결과와 속성 변경 영수증은 `artifacts/tasks/BQ-01/runs/host/logs/cleanup-fixtures.json`이다. 소스 비교 입력과 작은 검증 로그는 재검토 근거로 보존하며 바이너리·앱 프로필은 만들지 않았다.

다른 작업의 기존 staged/unstaged 변경은 보존한다. 공유 파일 3개는 이번 추가만 반영한 별도 Git index로 커밋을 검토한다. 커밋용 임시 index·도구의 최종 삭제 결과는 `artifacts/tasks/BQ-01/runs/host/logs/cleanup-commit.json`에 기록한다. 작업 기록의 완료 범위는 위 소스 계약과 검증이며 후속 제품 수용을 포함하지 않는다.

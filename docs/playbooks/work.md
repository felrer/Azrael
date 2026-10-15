# Azrael 개발 작업 Playbook

적용 범위: 이 프로젝트의 구현, 수정, 리팩터링, 마이그레이션, 검증과 폐기 정리 작업에 적용한다.
공통 조사·구현·검증·정리 원칙은 설치된 `implementation` 스킬이 소유하며, 이 문서는 함께 적용할
Azrael 고유의 제약과 담당 문서를 연결한다.

## 작업 진입과 문서 소유자

- [프로젝트 문서 안내](../README.md)에서 현재 작업의 문서 소유자를 찾는다. 동작과 계약은
  [아키텍처](../architecture/README.md), 코드 진입점은 [코드 맵](../maps/README.md),
  실행 명령과 반복 절차는 [운영 문서](../ops/README.md)가 소유한다.
- 새 작업 계획은 [Work Artifacts](../README.md#work-artifacts)에 지정된 프로젝트 로컬 `work/`에 저장하고,
  [작업 문서](../../work/README.md)의 세션·계획 규칙을 따른다. 별도의 작업 계획 저장소를 만들지 않는다.
- [다중 플랫폼 계약](../architecture/multi-platform.md)의 지원 정책과 현재 계획의 공통·한정·혼합·미결 요구를 확인한다.
  필요한 OS·CPU·버전/ABI·로컬/원격·데스크톱 조건과 제외 환경을 명시하고, 요구 대상·코드 소유권·회귀 영향·실제 검증 환경을 구분한다.
  플랫폼 미지정을 현재 호스트 한정으로 해석하지 않으며, 기존 결정과 권한을 이어받는다. 현재 검증된 지원은 Windows에 한정된다.
- [Playbook 진입점](README.md)에서 현재 작업에 해당하는 지침을 함께 선택한다.
  해당 지침이 연결한 문서는 필요한 담당 절만 읽는다.

생성 입력·로그·보고서·백업·버전 근거를 다룰 때 [산출물 수명주기와 이전](artifact-lifecycle.md)을 함께 적용한다. 새 프로젝트 도입과 기존 경로 이전은 해당 playbook의 조사·매핑·시험 이전·참조 전환·검증·모델 정리 순서를 따르며, 문서 복사만으로 파일을 이동하지 않는다.

## Azrael 변경과 검증

- 공통 진입 지침으로 대화의 목표·산출물·허용 작업을 확인한 뒤, 연결된 선택을 논의하는 `design-collaboration` 또는 질문을 계획에 모으는 `development-workflow`로 시작한다. 작은 작업도 필요한 만큼 짧은 계획을 사용하며, 전환은 같은 기록과 기존 권한을 이어간다.
- 관련 architecture와 기존 코드·테스트·실제 동작을 대조해 보존할 기능·제약·권한을 확인한다. 문서에 없는 기능도 보존한다. 승인되지 않은 설계 차이 또는 오류 회피를 위한 삭제·숨김·비활성화·검증 축소는 관련 구현 전에 변경분을 검토받는다. 완료 시 오류 해결과 기존 기능 보존을 각각 확인한다.

- 실제 변경과 통합 위험에 맞춰 공통 검사, 플랫폼 계약 검사, 대상 환경의 네이티브 실행과 호스트 검증을 선택한다.
  공통 변경의 Windows 회귀를 확인하고, 요구 대상과 실제 검증 환경·방법·미검증 범위를 작업 기록과 완료 보고에서 구분한다.
  단일 OS 통과를 다른 환경의 수용 근거로 확대하지 않는다. 이 확인만을 위해 별도 계획이나 전 OS 전체 검사를 만들지 않는다.
- 엔진 코드를 조사하거나 수정하기 전에 [엔진 소스 선택](../maps/README.md#select-the-engine-source)에
  따라 실제 소스 루트를 확인한다. 실행 중인 배포본의 문제는 해당 배포본과 소스의 관계를 먼저 확인한다.
- UI 변경은 [UI 표현 계약](../architecture/ui-presentation.md)을 따른다. 고정된 upstream UI의
  기존 컴포넌트, 레이아웃과 테마 토큰을 재사용하고, 실제 렌더링과 상호작용을 밝은 테마와 어두운 테마에서
  검증한다. 소스 검사만으로 화면 검증을 완료 처리하지 않는다.
- 패키징, 설치, 업데이트, 롤백과 빌드 산출물 정리는 [빌드·재설치 Playbook](build.md)을 적용한다.
  소스 변경, 패키징 성공, 기능 검증과 설치 상태를 구분하고, 변경 영역의 검사는
  [기능별 검증 절차](../ops/development.md#feature-checks)를 참조한다.
- 로깅 변경이나 로그 부족으로 원인 추적이 어려운 작업은 [앱 로그와 오류 진단 Playbook](app-logging.md)을
  적용한다. 기존 앱의 오류 조사 경로는 [네이티브 진단](../ops/native-diagnostics.md)을 참조한다.
- 문서는 [문서 상태와 소유권](../README.md#document-state-and-ownership)에 따라 현재 내용을 갱신한다.
  이번 작업의 실행 결과는 작업 기록에, 반복할 절차는 운영 문서에 유지한다.

## 기능 변경과 업데이트 보존

- 기능을 추가·변경·폐기할 때 [아키텍처 기능 유지 기준](../architecture/README.md#feature-maintenance)에 따라
  해당 기능의 소유 절을 같은 작업에서 갱신한다. 현재 동작, 실패·복구, 데이터·권한과 적용 환경 중
  변경된 계약을 기록하고, 문서·절의 구현 상태와 검증 범위를 구분한다. 계약이 유지되는 내부 수정은 문서를 불필요하게 변경하지 않는다.
- [기능 보존 목록](../../scripts/azrael-feature-contracts.json)의 안정적인 기능 ID, 설계 소유 문서,
  구현 소유자와 필수 검사를 함께 유지한다. 관련 설계 절이 어떤 보존 항목에 연결되는지 문서 링크나
  기능 ID로 찾을 수 있게 한다. 기존 항목과 검사를 확장할 수 있는지 먼저 확인한다.
  UI와 엔진에 걸친 기능은 양쪽 동작의 검증 범위를 연결하고, 문서 기록이나 소스 출처 확인만으로 동작 검증을 대신하지 않는다.
- Codex UI·엔진 업데이트는 [upstream 기능 보존 계약](../architecture/upstream-preservation.md)에 따라
  기준 릴리스의 설계·보존 목록과 후보를 대조한다. 구현된 부분과 유지하기로 확정된 계약을 절 단위로 확인하고,
  설계 전체가 `target` 또는 `partial`이라는 이유로 기존 구현을 보존 범위에서 제외하지 않는다.
  미구현 목표·초안은 구현 요구와 구분한다.
- 보존 항목·검사의 삭제, 범위 축소 또는 적용 제외는 대응하는 설계 변경과 기존 작업의 승인 근거를 확인한다.
  자동 검사가 없는 대조는 작업 기록에 근거를 남긴다. 누락·실패·미검증 항목은 해결하거나 명시적으로 결정된
  범위 변경으로 정리하기 전까지 해당 업데이트 후보의 수용을 완료하지 않는다.
- 이번 작업에 허용된 검증을 수행하고 결과와 미검증 범위를 기록한다. 소스 변경 완료와 업데이트 후보 수용은
  구분하며, 후보 수용에는 실제 선택한 UI·엔진·패키지에 연결된 필수 검증이 필요하다.
  이 규칙은 전체 빌드·설치·배포의 실행 권한을 추가하지 않는다.

## 테스트 묶음과 생성물 검토

- 테스트 목적 `one_off`/`retained`와 단계 `prepare`/`test`/`build`를 구분한다. 등록·실행은 [프로젝트 관리 운영](../ops/project-maintenance.md)을 따르며 기존 필수 검사와 테스트 추가 기준을 유지한다.
- 일회성 묶음도 실패 수정·재실행에 사용한다. 결과 검토 후 모델이 각 항목의 삭제 또는 보류를 판단하고 실제 정리를 확인한다. 보류에는 이유와 재검토 조건을 남긴다.
- 내장 도구가 제공되는 엔진에서 관리 도구를 사용한다. 도구가 없으면 기존 명령으로 같은 원칙을 적용하며 관리 기능을 이유로 전체 앱 빌드·설치 범위를 확대하지 않는다.

## Windows 산출물 삭제

- 정리는 [빌드·재설치 Playbook](build.md)의 보호·보존 기준을 따른다. 검증 fixture는
  [검증 산출물 정리 스크립트](../../scripts/clean-verification-artifacts.ps1), 등록된 엔진 캐시는
  [엔진 캐시 정리 스크립트](../../scripts/clean-engine-caches.ps1)를 우선 사용한다.
  대상 경로와 미리보기 결과를 확인하고, 해당 환경에서 허용되는 호출로 적용한다.
- 삭제는 한 PowerShell 세션에서 네이티브 `Remove-Item -LiteralPath`로 수행한다.
  재귀 삭제는 절대 경로가 이번 작업의 소유 디렉터리 안에 있고, 실행 중인 프로세스·현재/직전 설치본의
  참조와 연결 경로가 없음을 확인한 대상에만 사용한다. 와일드카드, 문자열로 조립한 삭제 명령,
  `cmd /c`·배치 명령이나 다른 셸로 경로를 전달하는 삭제는 사용하지 않는다.
- 복잡한 경로 계산과 보호 검사는 기존 정리 스크립트에 유지하고 호출에는 필요한 매개변수만 전달한다.
  허용 여부는 실제 실행 결과로 확인한다. 특정 명령 형식이나 스크립트 사용 자체를 허용의 근거로 삼지 않는다.
- 정책이 삭제를 거부하면 사유와 대상 범위를 확인한다. 개별 파일이나 비어 있음을 확인한 디렉터리만
  선택하는 등 실제 삭제 범위를 줄일 수 있을 때 허용된 방식으로 처리한다. 같은 삭제를 다른 셸,
  인코딩, 별도 스크립트나 이름 변경으로 숨겨 재시도하지 않는다. 해결되지 않으면 보존 경로·사유·제거 조건을
  작업 기록과 완료 보고에 남긴다.
- 종료 코드만으로 삭제 완료를 판단하지 않는다. 정리 결과의 삭제·보존 상태와 대상 경로의 실제 부재를
  확인한다. 보존할 소형 영수증은 담당 로그 위치에 두고, 사용자 인증·대화·설정은 정리 대상으로 포함하지 않는다.

## Worktree lifecycle

- When a task uses a newly created worktree, integrate all of its changes into the primary checkout (`main`, or the repository's existing primary branch), preserve existing work, resolve conflicts, and verify the combined result before task completion. Uncommitted changes must also be integrated.
- You MUST delete the task worktree after integration, without exception. Verify that both its Git worktree registration and its directory are gone. Preserve required provenance and reusable build caches outside the worktree before deleting it.
- These requirements do not authorize commits or publishing; follow the user's existing instructions for those actions.

## 작업별 커밋과 완료

- 각 개발 작업의 구현, 필요한 검증과 정리를 마친 뒤 해당 작업의 변경사항을 묶어 커밋한다.
  코드, 관련 테스트·스크립트와 문서 변경을 같은 작업 단위에 포함하고, 서로 다른 작업의 변경을 섞지 않는다.
- 커밋 전에 diff와 스테이징 내용을 확인한다. 기존 사용자 변경과 다른 작업의 변경은 보존하고,
  이번 작업에 속한 파일이나 변경 부분만 명시적으로 스테이징한다. 임시 검증물과 빌드 산출물은 포함하지 않는다.
- 커밋 메시지는 작업의 목적과 결과를 설명한다. 완료 보고에는 커밋 식별자와 검증 결과를 남긴다.
  필수 검증 실패나 변경 분리 문제로 커밋하지 못하면 그 이유와 남은 작업을 보고한다.
- worktree를 사용했다면 [Worktree lifecycle](#worktree-lifecycle)에 따라 기본 checkout에
  변경을 통합하고 검증한 뒤 worktree를 제거한다.
- 작업별 커밋 규칙은 원격 push나 게시·배포 권한을 부여하지 않는다. 해당 작업은 사용자의 별도 지시를 따른다.

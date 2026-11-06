상태: 구현·검증·정리 완료 — 실제 제품 전체 빌드·설치 수용은 다음 릴리스 범위.

# Azrael 내장 maintenance CLI 연결

## 목표·권한·범위

사용자가 다음 Azrael 배포물의 관리 기능을 로컬 스크립트가 사용하도록 변경하는 것을 승인했다. 현재 2026.0.14와 설치된 3b1f9bf4 standalone은 유지한다. 다음 Windows 버전(2026.0.14 이후)의 설치가 검증된 앱 실행파일을 기본 관리 경로로 게시한다. 묶음·잠금·삭제 코어, durable 예약·복구와 저장 형식은 변경하지 않는다.

공통 CLI/호출 계약과 Windows 배포 연결을 구현한다. 다른 OS는 기존 플랫폼별 native 수용 조건을 유지하고 수용 전 전환하지 않는다. 전체 앱/배포물 빌드·설치·저장 형식 이관은 실행하지 않는다. 기존 docs/architecture/project-maintenance.md의 target 명령을 재사용한다.

## 설계·구현

공통 cli::run_if_requested를 실제 azrael_main 초기화 이전에 연결하고 standalone도 같은 모듈을 재사용한다. capability 응답과 request/lease 인자 경계를 유지한다. 로컬 descriptor는 실행파일과 maintenance 접두 인자를 함께 전달하며 override도 모드를 함께 전달한다.

Windows 설치기는 capability·실제 lease·격리 register/review/apply·target 부재·fixture 정리를 통과한 뒤 상태 루트 schema2 영수증을 OS lease 안에서 원자적으로 게시한다. 준비 전용과 이전 버전은 선택을 유지한다. 새 영수증이 없는 경우만 legacy bootstrap을 허용하며 손상·해시·플랫폼·기능·수용 불일치는 오류다. 최소 helper 세 파일을 배포물의 integrity inventory에 포함한다.

Root가 요구사항·선택/호출/설치·통합 검증을 소유했다. read-only 조사자는 실제 entry/배포 경계를 확인했다. native owner는 cli 모듈·standalone·app-server 진입·직접 의존성만, caller owner는 기존 6개 스크립트의 접두 인자와 override 전달만 수정했다. 서로의 변경과 기존 미커밋 변경을 보존했다.

## 성공 기준·검증

- 현재 설치와 pin은 바꾸지 않는다: selector raw SHA와 현재 정상 resolver 확인.
- 공통 코어와 기존 standalone 계약 유지: 고정 입력 native 전체 검사와 shared CLI probe 컴파일/실행.
- 새 app 명령 연결: 실제 app 진입의 초기화 전 분기, 같은 함수의 probe로 capability·lease·CLI 검증. 전체 Azrael 바이너리 검증은 다음 릴리스에서 필수.
- 로컬 호출/배포 연결: 통합 모드 lifecycle·lease, 재배치 helper의 실제 선택 게시와 기본 pointer lease, PS native recovery 및 package/install 조건 검사.
- 손상된 선택에서 fallback 금지: retained resolver 경계 검사. 새 설치 gate 생략 방지: 다음 버전 synthetic installer 거부 검사.
- 임시 입력·컴파일 산출물·fixture·로그는 독립 최소 근거 보존 뒤 현 설치 owner의 등록·fresh 심사·삭제·finalize로 정리한다.

## 현재 결과

task-owned minimal native workspace를 offline lock 준비 후 고정했다. shared Cargo owner의 selected-tests-v2로 229개 실제 검사 actual0, shared CLI probe/standalone 빌드 actual0, 입력 불변을 확인했다. 격리된 설치 receipt와 재배치 helper/공통 CLI probe로 capability·lease·register/review/apply·target/fixture 부재·선택 영수증 게시·게시된 기본 pointer lease까지 actual0이었다. 전체 제품 실행파일 및 Linux/macOS 실기는 검증하지 않았다.

통합 모드 Node 검사 중 lifecycle·lease·resolver 207개는 통과했다. 같은 호출에 인자형 standalone packaging 검사를 node --test로 넣어 fixture 인자 오류가 난 결과는 전체 passing으로 취급하지 않는다. 올바른 fixture로 재시도한 packaging 검사는 pwsh PATH 누락으로 실패했고, 환경을 바로잡아 해당 검사만 재실행한다. 통과한 lifecycle 205개를 반복하지 않는다.

별도 package 20개 검사는 actual0이었으나 설치 버전 경계 조정과 시점이 겹쳐 최종 입력 검증으로 사용하지 않는다. 입력을 고정하고 영향받는 packaging·새/구 설치·통합 PS recovery 검사를 다시 실행한다.

진입 wrapper 첫 시도는 root 호출부 중복 변수명 구문 오류로 Cargo 전에 actual1, 두 번째는 task target에 shared-cache 설정을 함께 준 환경 선택 오류로 Cargo 전에 actual1이었다. 수정한 새 실행만 229개 실제 검사를 수행했다. 실패를 passing evidence로 바꾸지 않는다.

retained checks는 향후 CLI 인자/상수 변경과 실행파일만 넘기고 prefix를 누락하는 변경, 새 설치 검사를 생략하거나 손상된 selector에서 fallback하는 실수를 방지한다. 실행 로그와 상태는 artifacts/tasks/eq-cli/runs/r1 아래에 귀속한다.

최종 추가 수용: 고정 입력으로 packaging-r2 45.659초, integrated InvalidationOnly 51.052초, 새/구 설치와 closure·PrepareOnly 4개 Python 검사 75.693초가 각각 actual0이었다. 병렬 수행이므로 합계를 전체 경과 시간으로 쓰지 않는다. 검토 후 저장 형식 capability에 legacy·partitioned-v1 모두를 요구하고 게시 후 release 오류 메시지가 이전 선택 보존을 단정하지 않도록 보강했다. 이 영향 범위는 최종 resolver 검사 및 새 경로로 helper를 재배치한 실제 게시/기본 pointer lease 검사로 다시 검증하여 actual0이었다. installer의 제어 흐름 변경은 없으며 PowerShell 4개 파일 구문 검사를 통과했다.

현재 설치 selector raw SHA는 기존 값과 동일하다. 실제 앱 실행파일 전체 빌드는 프로젝트 규칙상 별도 제품 빌드 지시가 필요하며 이번 범위에 포함하지 않았다. 다음 릴리스에서는 실제 Azrael 실행파일과 패키지에 대한 native 관리 수용을 설치 gate가 수행한다. 작업용 probe는 실제 제품 실행파일의 수용 근거로 취급하지 않는다.

## 완료·정리와 남은 수용 범위

최소 독립 근거는 26-maintenance-cli-integration.json에 보존했다. 정리에서는 초기 catalog 경합과 재획득 실패를 그대로 기록했고, 실제 종료가 관측된 등록 실패 child의 정확한 예약을 27-registration-stop-proof.json에 고정해 지원 recover_reservation으로 복구했다(actual0, execution_outcome_changed=false). 타 작업의 PID 부재를 그 작업 전체 트리의 종료나 삭제 권한 근거로 삼지 않았다. 타 작업의 짧은 catalog 갱신을 관측해 이번 정리 요청에만 lock_wait_ms5000을 명시했으며 제품 기본 즉시 실패 정책은 바꾸지 않았다. 이후 Windows OS33이 반복되어 타 작업 경합만으로 원인을 단정한 설명을 철회했다. 대상2,532개 파일·루트 catalog 제어 파일의 읽기 전용 관측에서는 읽기 실패가 없었고 정확한 OS33 발생 경로·원인은 확정하지 못했다.

기존 opt-in timing을 켠 동일 설치 owner의 최종 등록·fresh review·apply가 모두 actual0으로 끝났다. 667,323,352 logical bytes의 task run 결과 status deleted/remaining false, 실제 경로 부재 및 producer record finalize/부재를 확인했다. 물리 회수량은 측정하지 않았다. 정리 근거는27-maintenance-cli-cleanup.json에 최소 timing 요약·실패·복구·실제 삭제 결과와 함께 보존했다. 별도 one-off 읽기 진단 파일은 이 근거에 통합 후 일반 삭제·부재 확인했다. 임시 입력·컴파일 결과·검사 fixture·raw 로그와 일회용 스크립트는 남기지 않았다. 잠금 파일 제거, 권한 변경, force 삭제와 보호 우회는 없었다.

최종 구현 코드 해시는 검증 이후 같고, 고정 native source도 현재 선택 소스와 일치했다. 공유 보존 목록에는 다른 작업의 변경이 들어왔으나 이번 CLI owner·source check가 모두 유지된 것을 확인했다. 현재 기본 standalone의 실행파일·selector는 바꾸지 않았다. 현재2026.0.14는 유지하며, 다음 Windows 버전 설치가 실제 앱 CLI 수용 후 전환한다. Linux/macOS 실행 및 실제 다음 Azrael 실행파일의 빌드·설치 수용은 이번에 수행하지 않았다.

기존 미커밋 변경이 같은 core·스크립트·보존 목록에 상호 의존해 있으므로 타 작업을 포함하지 않는 독립 task commit을 만들지 못했다. 기존 변경과 다른 작업의 변경은 보존했다. 현재 요청 범위의 구현·자동 검증·정리는 완료했으며, 다음 제품 빌드/설치 전까지 현재 설치물의 동작 전환은 없다.

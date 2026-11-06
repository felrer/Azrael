상태: 구현·Windows standalone 기본 전환·수용 검증·남은 정리 완료. 기존 혼합 staged 변경을 보존해 task commit은 보류했으며 추가 사용자 결정은 없다.

# 관리 요청과 영구 근거의 저장 경계

## 목표와 범위
- 일회용 요청·결과는 작업 소유 폴더에서 생성·소비·정리한다. 관리 영역은 상태와 참조되는 최소 수용·복구 근거를 보존한다.
- 공통 CLI에 표준입력 JSON 요청을 추가해 일회용 요청 파일 생성을 피하고, 파일 방식도 작업 폴더에서 계속 지원한다. 관리 영역의 요청 파일 실행은 명확한 오류로 거절해 잘못된 배치를 방지한다.
- 기존 native·Node lifecycle·잠금·승인·참조·예약 보호는 유지한다. 복구 API가 요구하는 evidence/receipt 경로는 바꾸지 않는다.
- 현재 Windows x64 standalone을 빌드·검증 후 기본값으로 전환한다. 앱 전체와 내장 도구 재설치는 포함하지 않는다. Linux x64/macOS ARM64와 공통 의미를 유지하되 이번 실기 검증은 Windows x64다.
- 기존 EM-02 관리기록은 이름이나 확장자만으로 삭제·이동하지 않는다. 현재 보호를 우회하는 compaction 기능을 임의로 추가하지 않는다.

## 확인한 구조와 접근
- 내장 project_*는 이미 객체를 전달하며 raw 요청 파일을 생성하지 않는다. standalone CLI는 호출자가 정한 파일 경로를 읽고 있어 ad-hoc 호출의 관리 영역 저장을 막지 못한다.
- `artifacts/maintenance/evidence/cleanup` writer는 예약의 finish가 참조하는 영구 삭제 근거이며 일회용 결과와 다르다. 실제 근거 저장을 줄이거나 옮겨 복구 참조를 깨뜨리지 않는다.
- 기존 Rust stdio/파일 JSON 해석, CLI dispatch, OS 권한 및 파일 경로 검사를 재사용한다. 의존성을 추가하지 않는다.
- CLI 및 보존 검증 → 공통 운영/모델 지침과 embedded 동일본 갱신 → 고정 입력의 최적화 실행기 및 실제 기본 경로 수용 → 기존 owner를 통한 임시 묶음·사용 종료 버전 정리 순서다.

## 검증과 완료 기준
- 표준입력과 기존 작업 폴더 파일 요청이 같은 native 동작을 수행한다. 관리 영역 raw 요청은 실행 전 거절하며 해당 파일·상태는 보존한다.
- malformed/과대 입력, 잘못된 경로와 기존 복구·소유·권한 보호를 유지한다. 구체적 재발 경로인 모델의 관리 영역 raw 요청 생성은 모델 지침과 CLI 경계 양쪽에서 막는다.
- Windows focused native/CLI 검증과 지침 동일성 검사, 현재 feature inventory의 관련 필수 검사를 수행한다. 기존 OS33 고침도 함께 보존한다.
- 현재 변경과 타 작업의 미커밋 변경을 분리하고 index를 보존한다. 최소 독립 수용 근거만 남기고 임시 run 및 구형 설치물의 실제 삭제·부재·finalize를 확인한다.

## 실행과 수용
- Windows x64 stable 1.98.0, native package 232 passed/0 failed, actual exit 0. 단일 managed Cargo test가 약 165초 걸렸고 source/입력 불변을 확인했다. 기존 OS33 회귀도 통과했다. 두 CLI 테스트는 이후 전송 refactor에서 관리 영역 요청 파일 허용이나 stdin의 별도 dispatch로 되돌리는 구체적인 재발 경로를 막기 위해 보존했다.
- 같은 입력의 최적화 release standalone 빌드는 약 39초, actual 0이었다. 축소 workspace는 실제 package/dependency/lint/profile을 재사용하며 외부 dependency 77개의 name/version/source가 원래 lockfile의 부분집합이다. 관련 live source 37개와 frozen hash가 일치한다.
- 후보/실제 기본 경로에서 stdin·작업 폴더 파일 요청, 관리 영역 raw 파일 거절 및 원본 불변, malformed stdin 거절, 실제 stdin 등록·심사·삭제와 경로 부재, Node lease를 통과했다. 후보 PowerShell RegistryOnly의 실제 예약 복구와 기본 RecoveryOnly도 actual 0이다. 공통 지침 동일성 검사 5개 actual 0, 설치된 공통 스킬과 원본 및 metadata hash/size 일치를 확인했다.
- SHA-256 `2e30f1bbfb248688d350547298f7120262322fc207b542635e229952225fb861`, 2,653,184 bytes다. version `version:maintenance-owner:fc02:stdin-20261102`에 신규 installation 참조를 먼저 추가하고 maintenance→catalog 잠금 아래 selector와 설치 영수증을 같은 identity로 CAS 전환했다. 실제 기본 경로 수용 후 정확한 구형 installation 참조만 지원 API로 해제했다.
- 독립 근거는 `03-request-candidate.json`, `04-request-deployment.json`, `05-request-default.json`, `06-request-completion.json`이며 version의 verification에도 필요한 근거를 보존했다. Cargo/CLI/Node/PowerShell 자식의 실제 종료를 확인해 run을 닫았다. 내장 엔진과 모델 주입 지침의 실행 중 앱 반영은 이번 standalone 전환과 구분하며 앱 재설치는 하지 않았다. 로컬 공통 스킬은 직접 동기화했다.
- 초기 `check-instruction-modules.cjs` 호출은 필수 account-ui 인자 누락으로 usage 단계에서 exit 1이었고 검사 본문은 실행되지 않았다. 해당 host 모듈은 이번 markdown 변경의 검증 대상으로 선정하지 않았으며 공통 지침/설치 metadata 검증으로 해당 변경을 확인했다.
- CLI 파일은 다른 작업에서 이미 stage되어 있었고 같은 maintenance/운영 문서·스킬 metadata에도 기존 변경이 있었다. 타 작업 index와 변경을 보존했고 이번 변경을 섞는 task commit은 보류했다.
- 새 표준입력 경로로 main root의 native inventory·등록·fresh 심사·삭제를 수행했다. `run:FC02:request-transport-r1` 924,461,834 bytes와 사용 종료한 `version:maintenance-owner:fc01:os33-20261102` 2,601,847 bytes를 모두 actual 0, `deleted / remaining:false`, 실제 부재 및 producer finalize로 확인했다. 합계 927,063,681 logical bytes이며 물리 회수량은 측정하지 않았다. 빈 task 상위 폴더와 일회용 controller도 일반 삭제·부재 확인했다. 관리 영역에 일회용 요청·raw 결과 파일을 생성하지 않았고 남은 cleanup 대상은 없다. 실제 selector/설치 영수증 SHA 동일·실행파일 SHA 동일·stdin capability·신규 installation 참조 및 구형 참조/retired producer 부재를 확인했다. [07-request-cleanup.json](07-request-cleanup.json)과 설치 version의 `verification/final-installation.json`이 최종 근거다.

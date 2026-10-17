상태: 구현·필수 검증 완료. 사용자 추가 결정 없음. 전체 제품 빌드·설치는 실행하지 않았다.

# 빌드 사전 점검과 Rust 검사·캐시 실행 개선

## 목표와 범위

긴 검사 전 의존성 경로·패키지 구성·인터페이스·테스트 출력 경로를 한 번에 점검하고, Rust 검사 조합 및 Cargo 캐시 소유 경합을 개선하며, 충분한 동일 입력·환경·통과 증거가 있는 결과만 재사용하도록 사용자 요청을 반영했다. 지침·실행 코드·필요한 회귀 검사가 허용됐다. 제품 재빌드·설치·실제 계정/Windows 서비스 변경은 범위 밖이다.

공통 Node 검사 조율과 Windows/네이티브 플랫폼 빌드 진입점이 대상이다. Windows x64에서 실행 검증했고 Linux/macOS의 실제 Rust 실행과 전체 시간 절감은 미측정이다. 다른 BW-01 작업의 소스·문서·등록 변경은 보존한다.

## 확정 동작과 소유

- root: docs/playbooks/build.md에 네 경계의 통합 사전 점검, 생성될 선행 산출물의 소비자 차단, 변경된 경계만 재검사, 검증된 통과 결과 재사용을 명시했다. 기본 target 공유 문구를 명시적 소유·호환성·비용 비교로 교체했다. docs/ops/development.md와 docs/architecture/azrael-ex.md를 같은 계약에 맞췄다. 공통 설치 스킬을 복제·변경하지 않았다.
- Cargo 실행 담당: 기존 동기 실행 API에 physical target별 원자적 소유권을 추가했다. 관리되는 Cargo test, Windows 직접 native compile, Windows 제품 build, 공통 build-platform 진입점이 같은 소유 경계를 사용한다. 경합 시 Cargo 실행 전에 명확히 거부한다. 정상 종료만 자신의 token을 해제하고 signal/unknown은 보존한다. target alias를 물리 경로로 고정하고 CLI target-dir 불일치 및 CLI --config 우회를 실행 전에 거부한다. 기존 managed recipe에는 --config가 없다.
- root: 독립적인 source-root-only Cargo 검사 6개를 core-lib, core-lib-isolated, appserver-protocol-lib-isolated의 세 실행 그룹으로 모았다. 원래 command/package/feature/profile/filter와 개별 결과는 유지하고 다른 검사의 상대 순서는 유지한다. 힌트는 실행 순서에만 사용하며 호환성·통과 증거를 대신하지 않는다. 실제 실행 순서를 receipt에 기록한다.
- Insta는 INSTA_UPDATE=no를 유지하고 임시 기록을 선택 소스 밖으로 보낸다. 기본 공유 출력은 프로젝트 artifacts/verification/cargo-pending/<physical-target-hash>이며 기존 lifecycle API로 생성 전 등록하고 종료 후 상태를 조정한다. 명시 출력은 실행 시 물리 경계를 재검증하고 고정한다. 출력 junction 재지정 회귀를 확인했다.
- 기존 Cargo evidence key의 전체 엔진·환경·unknown field 안전성은 유지하고 새 helper/lifecycle 코드도 입력에 묶었다. 따라서 엔진 전체 입력이 바뀌면 보수적 재검사가 계속 필요하다. 새 release 이름·실행 사본 경로만 달라진 경우의 기존 동일 입력 재사용은 유지한다. 전체 gate 전후 무결성과 설치 전 6개 host 단계는 유지한다.

## 검증과 증거

로그 루트: artifacts/tasks/windows-2026-0-9/runs/build-efficiency-r1. root와 실행 담당은 별도 범위를 검증했고 실제 Rust 컴파일은 중복 실행하지 않았다.

| 범위 | 실제 결과 | 증거 |
| --- | --- | --- |
| 물리 target 소유·wrapper·우회/출력 경계 최종 | 43 pass, exit0 | cargo-owner/cargo-owner-hardening-tests.log |
| 기본 pending lifecycle·물리 alias 최종 보강 | 10 pass, exit0 | cargo-owner/cargo-owner-lifecycle-tests-r3.log |
| 기존 Cargo cache 키·재사용·입력 무효화 | 17 pass, exit0 | cargo-owner/cargo-cache-tests.log |
| 그룹화·누락 방지·불허 입력·등록 검사 전체 유지 | 5 pass, exit0 | scheduling.log |
| 플랫폼 빌드 invocation·기존 플랫폼 fixture | 12 pass/1 기존 Windows 조건부 skip, exit0 | build-platform.log |
| 기존 gate·source cache·실패/입력 드리프트/재사용 | 27 pass, exit0 | preservation.log |
| 최종 fixture 출력 경로 변경에 해당하는 cold/hit·영향 선택 재검사 | 1 pass, exit0 | output-routing.log |
| Cargo fixture 출력 경로 변경에 해당하는 실제 등록 그룹 cold/hit | 1 pass, exit0 | cargo-cache-output-routing.log |
| 현재 전체 feature manifest 및 새 파일 참조/6개 hint | valid, exit0 | manifest-validation.json |

실제 wrapper의 모든 Cargo 호출을 모의 실행해 각 그룹의 package/flag/환경 compilation signature가 일치하는 것도 확인했다. 성공 시 exitCode를 생략하는 wrapper의 fixture assertion만 보정한 뒤 5개가 통과했다. owner 최초 41pass 뒤 config override/출력 junction 수정에 해당하는 suite만 43pass로 다시 실행했다. 기존 cache17과 gate27의 충분한 증거는 재사용하고 최종 단순 fixture 출력 위치 변경은 관련 cold/hit 1개로 검증했다. 테스트 수를 중복 실행 합계나 성능 개선량으로 해석하지 않는다. Windows 제품 스크립트 구문 및 변경 diff 검사도 exit0이다. Unix mode 조건부 1건은 Windows에서 실행되지 않았다.

## 정리와 남은 한계

소유 fake Cargo/junction/모의 unknown lease fixture는 정상 삭제했고 실제 프로세스 종료 후 fixtures 부재를 확인했다(cargo-owner/cleanup.txt). gate/cache 임시 root도 suite after 훅에서 정상 삭제됐다. 출력 경로 변경 이전 기존 전역 fixture summary는 공유 reader 불확실성 때문에 그대로 보존하고 task 독립 사본을 preservation-evidence에 남겼다. 이후 task 지정 fixture/evidence는 같은 run으로 모인다. 로그·SHA·검증 요약은 이번 commit 검토와 회귀 근거로 model defer하며 이후 동일 계약 검증으로 대체되고 소비자가 없을 때 재검토한다. 다른 runtime·공유 Cargo 캐시·기존 빌드 산출물은 정리 대상으로 삼지 않았다.

직접 Cargo를 실행하는 외부 작업은 이 관리 lease를 따르지 않으므로 사전 점검에서 별도 조율해야 한다. 동기 supervisor는 실행 중 coordinator PID를 기록하고 child PID는 반환 후 알 수 있다. 따라서 PID 부재만으로 unknown 소유권을 자동 복구하지 않는다. 실제 시간 단축은 다음 승인된 제품 빌드에서 측정하며 이번에는 주장하지 않는다.

상태: 소스 수정·162개 테스트·standalone 빌드·기본 실행기 교체 검증 완료. 임시 payload 정리 완료. 이전 삭제의 pending 제어 기록 1건 정합화는 미완료.

# 보호 정보 갱신 잠금 경합 수정

## 목표와 범위

- 사용자가 Windows x64 standalone 빌드·기본 실행기 교체까지 승인했다. 앱 전체 빌드·설치와 내장 엔진 교체는 제외한다. 정확한 검증 입력과 실행파일 identity, 직접·기본 resolver acceptance 및 설치 참조 전환을 확인한다.
- 사용자가 보호 정보 갱신 중 관리 잠금 경합으로 거부된 요청의 해결을 요청했다. 기존 archive 이관은 별도 상태로 유지한다.
- 기존 잠금·권한·소유·예약·멤버십 보호를 보존하면서 짧은 경합은 정상적으로 기다린 뒤 갱신하도록 한다. 실제 점유가 계속되면 유한 시간 안에 명확히 실패해야 한다.
- 공통 Rust 경로의 변경이며 Windows x64 로컬에서 회귀 검증한다. Linux x64/macOS ARM64 의미는 보존하고 미검증 환경을 구분한다. 앱 전체 빌드·설치·공개 배포는 범위 밖이다.

## 조사와 계획

- 실제 기본 소스는 docs/ops/development.md와 engine/SOURCE.json이 지정하는 engine/이다. 설치된 standalone owner는 owner-installation.json의 경로·SHA256으로 별도 고정된다.
- 기존 native lease의 최대 5초 대기와 10ms 간격 정책을 재사용할 수 있는지 확인한다. refresh_group의 갱신 전 관리/카탈로그 잠금 획득 경계와 기존 테스트를 조사한다.
- 재시도는 미커밋 잠금 획득에 한정하며 저장 오류·권한 오류·알 수 없는 잠금·활성 예약을 재시도로 숨기지 않는다. 대기 후 최신 상태와 보호를 재검증한다.
- root가 구현·통합·검증·정리를 소유한다. 읽기 전용 조사자는 refresh 경로와 기존 회귀 계약을 확인한다. 소스 확정 뒤 고정 입력으로 해당 crate만 검증한다.

## 확정한 구현과 검증 범위

- 기존 Sentinel은 실제 OS 잠금에서 WouldBlock을 즉시 반환했다. 오류에 경로가 없어 이전 39개 실패가 어느 잠금에서 발생했는지는 소급 확정할 수 없다.
- lease의 대기 루프를 공통 내부 함수로 재사용했다. refresh_group의 Store와 catalog 획득을 한 시도로 묶고 실패 시 RAII로 모두 반환한 다음 10ms 간격, 전체 5초 한도로 재시도한다. 각 시도는 manifest와 junction 허용 정보를 다시 읽는다. 갱신·예약 검사·save는 루프 밖에서 한 번만 실행한다.
- Sentinel의 실제 WouldBlock만 경합으로 분류하며 다른 OS 오류·권한·legacy/unknown 보호는 즉시 실패한다. 경합 오류에 정확한 경로와 operation을 포함했다.
- 기존 `tool.project-maintenance` feature inventory가 수정한 acquisition/registry/storage 파일과 library native check를 이미 연결하므로 중복 항목을 추가하지 않는다.
- 실제 OS 잠금 두 종류의 해제/계속 점유, partial lease 반환, 대기 중 새 writer 상태·producer 보호 반영을 기존 registry 회귀에 추가했다. 기한 및 오류 유형 회귀까지 세 테스트는 드문 동시성 오류의 반복 방지 가치가 있어 유지한다. 기존 refresh identity/측정값·멤버십·권한·예약 검사도 library suite에서 검증했다.
- 검증 run: `run:EC-01:refresh-lock-r1`, 예정 경로 `artifacts/tasks/EC-01-unused-file-archive/runs/refresh-lock-r1/`. 입력·target·로그를 이 소유 경계에서 생성한 뒤 결과 검토 후 정리한다. 최초 생성 기록 등록은 카탈로그 경합으로 exit 1이었고, 종료가 확인된 획득 실패만 재시도해 등록했다.
- SOURCE.json은 기존 다른 작업 변경이 있는 파일이다. 기존 로컬 통합 영수증을 보존하며 이번 소스 delta만 기록한다. 사용 가능한 baseline 디렉터리가 없어, 이전 지원 복원 절차의 정확한 Git blob과 raw receipt SHA로 독립 원본을 준비하고 full importer 검증을 통과시킨 뒤 사용한다.

## 실행 결과와 재검증

- 첫 실행은 Cargo PATH 부재로 프로세스 생성 전에 실패했다. 수정한 PATH의 두 번째 실행은 pinned Rust 1.95.0에서 typeCheck·161개 nonzero selection은 exit 0, 실제 suite는 exit 101이었다. 새 timeout 회귀의 Windows 경로 문자열 비교에서 slash 표현 차이가 원인이며 두 경로를 같은 separator로 비교하도록 수정했다. 실제 잠금 해제/partial lease 반환 회귀는 통과했다.
- 읽기 전용 코드 리뷰에서 만료 후 추가 시도와 임의 오류 문자열의 오분류 가능성을 발견했다. 다음 시도 전에 기한을 검사하고 typed LockAcquireError::Busy만 재시도하도록 보완했다. Store/registry acquisition에서 이 유형을 보존하고 API 바깥은 기존 String 오류를 유지한다. 짧은 기한 만료 및 유사 문구의 정책 실패를 구분하는 helper 회귀도 추가했다. 고정 입력을 바꾸지 않고 새 입력 identity로 검증한다.
- 최종 입력: SOURCE 영수증 SHA256 `ebc36ce27a406c17e2c941dd954387872a5f713b16a9da72cf89a07d672d46b5`. 지원 recorder와 고정 입력의 실행 전후 provenance 검증이 모두 exit 0이며 snapshot이 동일하다. 기존 다른 작업의 SOURCE file descriptor는 그대로 유지했다.
- 최종 Windows x64 결과: typeCheck exit 0, nonzero selection 162개/exit 0, 실제 테스트 162개 전부 통과/exit 0. 최종 명령 wall time은 22:11:41.498Z–22:19:50.725Z(약 8분 9초)다. 별도 Cargo 작업과 캐시를 공유하지 않았으며 중복 검증 producer를 띄우지 않았다. rustfmt와 diff 검사는 exit 0이다.
- 추가한 3개 Rust 회귀는 실제 OS 경합·partial lease 반환·timeout 불변성·typed 오류 구분이라는 지속적인 제품 계약을 검증하므로 유지한다. 배치용 일회성 acceptance 스크립트와 fixture는 빌드 run과 함께 폐기한다.
- 독립 근거: [02-verification.json](02-verification.json). 실패 이력과 실제 exit를 보존하며 최종 성공으로 덮어쓰지 않았다. 생성 run도 첫 native 실패 101을 유지한 failed 상태로 공식 종료하고 현재 결과 검토 후 전체를 정리한다. 정리 결과는 [02-cleanup.json](02-cleanup.json)에 기록한다.
- 기존 SOURCE.json에는 이번 작업 전부터 다른 소스 44개의 영수증 변경이 있었다. 이를 이번 커밋에 섞지 않으며, 겹치는 집계 필드와 누적 출처를 안전하게 분리하기 전에는 task commit을 만들지 않는다. 기존 사용자 수정과 앞선 archive 작업 수정도 그대로 보존했다.

## 승인된 standalone 적용

- 이전 run의 정리 등록은 진행 중인 상태 그대로 유지한다. 측정 중인 payload·캐시는 수정하지 않는다.
- 새 `run:EC-01:standalone-build-r2`의 별도 입력·release target을 사용한다. 기존 target은 test profile만 준비되어 release 컴파일 재사용 이점이 작고 정리 측정과 겹치므로 공유하지 않는다. 입력은 primary의 같은 SOURCE SHA와 전체 provenance로 고정해 이미 통과한 native source 근거와 결합한다.
- 새 실행파일은 새 version 경로에 두고 native lease/실제 경합 refresh를 검증한다. 기존 설치의 참조를 확인해 새 version 보호를 먼저 확립하고 selector를 전환한다. 실행 중인 구 owner는 중지하지 않는다.
- release 빌드는 22:35:27.102Z–22:36:10.288Z(약 43초), 실제 exit 0이다. 전체 provenance 실행 전후 결과는 동일하다. 실행파일 SHA256은 `3f10cedc20d10acc36b69c06591150a4a7bf2217df2acdc8eebe6aadaf2f61e0`이며 `artifacts/versions/maintenance-owner-3f10cedc-win-x64-ec01-lock-wait/`에 설치했다.
- 실제 실행파일은 maintenance/catalog 각각 약 0.54초의 일시 점유 뒤 refresh exit 0, 계속 점유 시 약 5.03/5.05초에 exit 1과 manifest 불변, 해제 뒤 exit 0을 확인했다. identity·측정값을 보존하고 대기 중 바뀐 보호 정보를 다시 읽었다. 기본 resolver의 native lease와 refresh도 exit 0이다. 설치 참조는 새 version을 먼저 보호한 뒤 이전 참조만 공식 해제했으며 installation revision은 8이다.
- binary acceptance 첫 시도는 JSON 오류의 이스케이프 경로를 디코딩하지 않은 검증 코드 때문에 exit 1이었다. 새 fixture의 수정된 비교는 통과했다. publication 첫 시도도 기존 정리 등록의 commit catalog 점유로 최초 획득이 거부되어 exit 1이었다. 목적지·레코드 생성 전 실패를 확인하고 기존 등록의 실제 exit 0 뒤 재시도했다. 제품 소스 변경이나 추가 컴파일은 없었다.
- 독립 설치 근거는 [02-standalone-verification.json](02-standalone-verification.json)과 설치 version의 `verification/`에 둔다. 기존 [02-verification.json](02-verification.json)은 이전 소스 검증 종료 근거이므로 승인 전 상태를 역사 그대로 보존한다. 앱 내장 엔진과 다른 OS 실기는 이번 수용 범위에 포함하지 않는다.
- [02-native-lease-verification.json](02-native-lease-verification.json)은 직접·기본 resolver 양쪽의 native lease 프로세스 실제 종료 exit 0을 추가로 기록한다. 응답만으로 프로세스 종료를 추정하지 않았다.
- 이전 version은 설치 참조 해제와 실제 프로세스 부재를 확인한 뒤 native 등록·fresh review·producer 예약을 유지하며 `archive/EC-01-retired-maintenance-owner-20261028/`로 이동했다. 10개 파일/7,339,896바이트의 identity와 원본 부재, archive의 명시적 defer/remaining true, 원래 producer finalize를 확인했다. 삭제가 아니며 사용자 요청 보관물이다.

## 정리 결과와 남은 제어 기록

- 이전 검증 run의 물리 삭제는 실제 `deleted/remaining:false`였으나, 22:54:39.370Z terminal 저장에서 뒤따른 신규 등록과 maintenance 잠금이 경합했다. native exit 0에도 API는 `aborted:true`와 pending intent를 남겼으므로 성공 영수증으로 취급하지 않았다. 겹친 관리 트랜잭션을 피하지 못한 실행 순서를 기록하며 이후 정리는 등록 완료 → review/apply 완료 순서로 진행한다.
- 정확한 native PID 71364의 실제 terminal, Windows 삭제 worker의 정상 `wait` 및 non-breakaway kill-on-close Job 종료 경계, 알려진 자식 91560/9560의 후속 부재로 전체 종료를 확인했다. 단순 PID 부재만 사용하지 않았다. `recover_reservation`은 PID 83168/exit 0으로 예약만 공식 해제했다. [독립 근거](../../artifacts/maintenance/evidence/ec01-cleanup-result-persistence-20261028.json)와 [정리 결과](02-cleanup.json)에 실패와 실제 부재를 보존했다.
- 기존 API는 예약 복구로 pending intent를 수정하지 않는다. native manifest의 이 pending 1건 및 관련 원래 producer 제어 기록은 보호된 진단·복구 정보로 남긴다. raw registry/manifest 편집이나 새 defer로 이전 실패를 성공으로 바꾸지 않았다. 이 제어 기록의 정합화는 아직 완료되지 않았다. payload·원시 로그·복제 입력은 모두 없다.
- 새 standalone 빌드 run은 별도 등록 exit 0 뒤 순차 review/apply를 실행했다. 실제 apply exit 0, `aborted:false`, 항목별 `deleted/remaining:false`, producer `finalized`와 원본 부재를 확인했다. 결과는 [02-build-cleanup.json](02-build-cleanup.json)에 보존하고 일회성 스크립트·캐시·복제 입력·fixture·로그 및 임시 요청 파일을 제거했다. 비어 있는 task 컨테이너도 ordinary rmdir로 제거했다. 유지하는 것은 설치 version의 실행파일/최소 검증, 사용자 요청 archive, 작업 요약 및 미확정 제어·복구 근거다.

## 성공 기준

- maintenance 및 catalog의 일시 점유 해제 후 refresh가 성공한다.
- 계속 점유 중이면 제한 시간 뒤 경로/단계가 식별되는 실패를 반환하며 갱신하지 않는다.
- 잠금 대기 동안 다른 관리 잠금을 붙잡지 않고, 재획득 후 최신 metadata와 권한을 사용한다.
- identity/측정값 보존과 변경된 멤버십·소유·참조·예약 차단 회귀를 유지한다.
- 실행 결과·실제 exit code와 적용된 소스/설치본의 차이를 기록하고 task-owned 임시 생성물을 정리한다.

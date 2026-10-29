상태: 완료. 보호 적용 실측과 측정용 파일·로그 정리를 확인했으며 사용자 추가 조치는 없다.

# 보호 적용 실측

## 요청과 범위

현재 프로젝트에서 적당한 파일을 대상으로 보호 적용 시간을 실측한다. 사용자가 허용한 측정과 그에 필요한 임시 자료 생성·보호·해제·정리만 수행했다. 제품 코드, 지침, 설계 및 기존 산출물은 변경하지 않았다. 동작 변경이 없어 아키텍처 갱신과 제품 회귀 빌드는 필요하지 않다.

Windows x64 로컬 실행만 확인했다. Linux/macOS, 네트워크 파일시스템, 대형 트리 및 경합 없는 환경의 성능으로 일반화하지 않는다. `development-workflow`, `implementation`, `testing` 절차를 적용했다.

## 방법과 환경

- 기존 `scripts/artifact-lifecycle.cjs`의 `recordLifecycle`, `releaseReferences`, `registerRequest`, `finalize`와 설치된 `maintenance_owner.exe`의 `register`·`refresh_group`·`review`·`apply`를 재사용했다. 별도 보호 구현이나 지속 테스트를 추가하지 않았다.
- Windows `10.0.26200`, x64, Intel Core i7-10700K, 논리 CPU 16개, Node `v26.7.0`.
- 실행파일 SHA-256: `9bc66314681460df3d6da3a9dc923eac52411e22d1fb595b08371477ac492a26`. 설치 선택 기록과 실제 바이너리 identity를 확인했다.
- 시작 시 lifecycle catalog에는 648개 기록이 있었다. 새 작업 경로와 기존 소유 경로가 겹치지 않음을 확인하고, 생성 전에 pending 그룹을 기록했다.
- 측정 대상은 새로 생성한 1,048,576바이트 일반 파일 1개다. 파일 생성·완료 기록·삭제 검토·참조 해제는 보호 적용 시간에서 제외했다.
- `performance.now()`로 소비 참조 추가 API 호출과 native `refresh_group` 프로세스 호출을 각각 측정했다. native 수치는 프로세스 시작을 포함하고 요청 JSON 작성 및 `registerRequest` 투영 비용은 제외한다. 합산은 두 호출의 측정값 합이며 전체 작업 경과 시간이 아니다.
- 1 MiB·32 MiB 단일 파일과 작은 파일 100개를 비교할 계획이었으나, 잠금 충돌로 1 MiB 파일의 3회 측정까지 수행했다. 32 MiB 파일은 준비만 했고, 100개 파일의 경로는 생성하지 않았다.

## 결과

| 회차 | 소비 참조 추가(ms) | 보호 갱신(ms) | 두 호출 합산(ms) |
| --- | ---: | ---: | ---: |
| 1 | 15422.2681 | 13977.8825 | 29400.1506 |
| 2 | 9889.2101 | 9020.2531 | 18909.4632 |
| 3 | 6746.0096 | 6298.3331 | 13044.3427 |

중앙값은 참조 추가 **9.89초**, 갱신 **9.02초**, 두 호출 합산 **18.91초**다. 최초 native 등록은 별도로 **172523.2727ms(172.52초)** 걸렸으며 한 번만 측정했다. 보호 갱신의 잠금 획득 대기 한도 5초는 전체 실행 시간 한도가 아니다.

측정 중 native 등록·갱신·검토는 종료 코드 0을 반환했다. 1·3회 검토에서는 `producer inbound consumer protects group: work:EQ-01-protection-timing:control`과 `references active or unknown`으로 삭제가 차단됐다. 2회에는 활성 참조 차단과 함께 `lifecycle membership source changed or is unavailable; re-register full current membership`도 나타났다. 따라서 모든 반복을 경합 없는 동일 조건의 순수 성능으로 해석하지 않는다.

별도의 `test-deploy-azrael` / `ec01-test-policy` 작업이 같은 catalog를 사용 중임을 프로세스와 명령행으로 확인했다. 추가 대상 준비는 `catalog.lock` 5초 대기 소진으로 종료 코드 1을 반환했다. 파일 용량만으로 지연 원인을 단정할 수 없으며, 이번 수치는 동시 작업의 영향을 포함한 현재 프로젝트 환경의 실제 호출 시간이다.

## 실행과 정리

- 산출물 기록 시작: 2026-10-29 23:54:36 KST. 정리 후 부재 재확인: 2026-10-30 00:25 KST. 초기 문서 조사는 이 구간에 포함하지 않는다. 전체 경과에는 준비·등록, 잠금 경합, 복구, 다른 작업 종료 대기 및 삭제가 포함된다.
- 임시 루트: `artifacts/tasks/EQ-01-protection-timing/`. `single-1m`, `single-32m`, `control`, 생성되지 않은 `many-100`을 각각 소유 기록으로 관리했다.
- 소비 참조는 지원되는 release API로 해제했다. 잠금 충돌로 실패한 등록·삭제는 실패 결과를 유지했고, 정확한 종료 관찰과 프로세스 트리 확인 후 native `recover_reservation`으로 해당 작업의 예약만 복구했다. 점유 잠금, ACL 및 강제 삭제를 사용하지 않았다.
- 배포 검증 wrapper PID 35924의 생성 identity를 고정해 종료를 기다렸다. 대기 실행 ID는 `8b5bf3e0-4d81-4d31-9e3b-046c873261c4`이며 executor 종료 코드 0을 확인한 후 현재 점유 상태를 재확인했다.
- 일괄 삭제는 Windows `os error 33`으로 실패했다. 이후 그룹별 fresh review/apply를 사용했다. 32 MiB 항목의 첫 개별 적용은 종료 코드 0이었지만 결과가 `blocked` / `stale review token after authorization`였으므로 삭제 성공으로 취급하지 않았다. 새 검토 토큰으로 재검토한 다음 정상 삭제했다. 이 토큰 변화의 정확한 원인은 이번 실측으로 확정하지 않았다.
- 최종 삭제는 세 그룹 모두 native 종료 코드 0, `status:deleted`, `remaining:false`를 확인했다. 실제 디렉터리 부재와 lifecycle `status:finalized`도 확인했다. 생성하지 않은 `many-100`은 부재·종료 근거를 확인해 소유 기록을 정리했다.
- 삭제한 논리 데이터는 1 MiB 파일, 32 MiB 준비 파일, 로그/제어 자료 24,471바이트다. 물리 회수 용량은 측정하지 않았다.
- 임시 요청 `work/EQ-01-protection-timing/cleanup-request.json`, 문서 할당용 임시 본문 및 비워진 작업 루트를 삭제했다. 측정용 스크립트는 stdin으로 실행해 파일을 남기지 않았다.

## 보존 증거와 완료 기준

이 요약과 `02-reservation-recovery.json`부터 `07-reservation-recovery.json`까지의 작은 불변 복구 증거만 유지한다. 이 JSON들은 native 복구 영수증이 SHA-256으로 참조하는 제어 증거이며, 임시 payload·raw 로그가 아니다. 임시 로그는 필요한 수치를 이 기록에 반영한 뒤 삭제했다.

해당 작업 폴더의 `.gitattributes`는 복구 JSON의 자동 줄바꿈 변환을 끈다. 이후 checkout에서도 native 영수증이 참조하는 바이트 해시를 보존하기 위한 작업 범위 내 설정이다.

실측 시간, 실제 보호 차단, 실행 결과와 한계, 작업 소유 자료의 해제·삭제 및 실제 부재를 모두 확인했다. 제품 변경, 설치, 전체 빌드, 원격 배포는 수행하지 않았다.

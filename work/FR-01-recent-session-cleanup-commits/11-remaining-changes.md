# 미커밋 변경과 정리의 남은 경계

상태: 완료 변경만 커밋한다는 사용자 결정에 따라 미완료·수용 미확정·공유 의존 변경을 보존한다. 이 문서는 소스나 실패 결과를 완료로 승격하지 않는다.

## 소스 변경

| 기능군 | 확인된 근거와 남긴 이유 | 다음 조건 |
| --- | --- | --- |
| FA 지침 workbench·통합 배포 | `FA-01/01-plan.md`의 최종 제품·패키지·설치 gate 진행 기록. extension·namespace·프로필·패키징과 여러 파일 공유 | 원래 실행의 실제 종료와 필수 gate 확인 후 같은 입력의 변경만 분리 |
| FI 기본 `find_names` | helper/runtime 검증은 있으나 `FI-01/24-plan.md`에서 필수 Rust·설치 수용 미완료. 다른 세션의 unresolved Cargo 보호 있음 | 기존 보호를 우회하지 않고 원래 owner의 종료 근거와 필수 검증 확보 |
| EK 사용자 응답 대기 시간 | `EK-01/01-plan.md`가 사용자 요청 일시 중지 상태. 최종 결합 Cargo 검증 미완료 | 명시적 재개와 남은 필수 검증. 중지된 작업을 이 정리 요청으로 재개하지 않음 |
| FE 유지관리 개인 설정 | `FE-01/core-verification.json`의 Cargo101/실행0을 보존. 후속 FH prerequisite 수정은 과거 실패를 통과로 바꾸지 않음 | 최종 입력의 필수 core 경계 검증 |
| FH 역할 프로필·FK 작업 메모리 | FH 선택 native32개와 FK 저장소7/core2 통과, 각 작업 정리 완료 기록. 현재 공유 파일은 FA 등의 후속 변경을 함께 포함 | 검증된 기능 부분과 후속 미검증 부분을 분리하고 protocol/schema·출처의 일관성 검증 |
| FC/FF 유지관리 최적화·Unix 삭제 | Windows 및 Linux/macOS 검증과 정리 완료 기록 존재. 현재 CLI/registry/잠금 파일에 FE 등 변경이 혼합 | 동작·호출자·출처를 함께 분리. 현재 소스 전체를 임의로 완료 커밋에 포함하지 않음 |
| FP legacy 도구 | goal namespace 7파일은 순수 기능군이며 Windows27개 검증 기록. 해당7파일의 SOURCE descriptor가 실제 bytes와 불일치 | 기존 supported recorder로 독립 입력 출처를 올바르게 기록한 뒤 커밋. SOURCE 전체의 타 작업 변경은 흡수하지 않음 |
| EM Anthropic 프로필·FA 계정 캡처 | helper/inference에 두 기능이 혼합. EM controls는 아래 보호 상태 | 공유 부분 분리와 원래 기능의 필수 검사·정리/보존 조건 해결 |
| EZ Window Use | 역사 snapshot 보존은 독립 커밋. 활성 native/backend/설정/승인/패키징은 여러 후속 단계가 혼합 | 검증·확인된 범위와 별도 보호·미완료 통합을 구분하여 분리 |
| EV/EW 빌드·검사 정리 | 완료 검증 기록은 있으나 현재 다수 테스트에 후속 FA fixture 변경 등이 중첩 | 원래 검증된 부분과 후속 fixture를 분리하고 필요한 source 경계만 재검증 |

계획 경로는 `work/`의 해당 접두 폴더를 가리킨다. 기존 staged37경로와 Git submodule 상태, 알 수 없는 `maintenance-activity.lock`을 보존한다. 이 잠금 이름은 실제 preferences owner가 사용하는 이름이며 단순한 빈 임시 파일로 간주하지 않는다.

## 정리

기존 관리 실행기 SHA를 검증하고 native inventory의 등록 그룹부터 조사했다. 전체 payload를 재귀 재측정하거나 이름·나이로 삭제하지 않았다. 선택한 종료된 검사 그룹만 fresh review 토큰으로 삭제하며, 실제 부재와 producer finalize까지 별도로 확인한다.

`10-blocked-cleanup.json`은 이번에 구체적으로 확인한 보호 항목의 정확한 paths/groups·등록 크기·해제 조건을 소유한다.

- `run:permission-disabled-host:rmvl4okue`: 두 경로 합계 2,142,871,030 logical bytes. 구성원 보호, generation/사용 불확실성 및 관리 루트 밖 경로 때문에 삭제 차단. 해당 원본·보호를 변경하지 않았다.
- `run:EM-02-controls`: 관리 영역의25개 파일·66,287 bytes. 이전 작업도 지원되는 control evidence compaction 또는 정확한 보존 승인을 기다린다. 기존 보호를 우회하지 않았다.
- EN/ER 등의 기존 삭제 예약과 FA/FI/EK의 active/unknown/재개 입력, 사용자 정상동작 확인 전 설치 복구물은 그대로 보호한다. 현재 체크아웃에 등록된 모든 그룹의 삭제 적격성을 확인했다는 뜻은 아니다.

위 항목은 삭제 완료가 아니다. 관리 상태·최소 복구/수용 근거와 사용자 원본은 임시 생성물로 바꿔 분류하지 않는다. 전체 정리가 끝났다고 보고하지 않으며, 필요한 지원 owner 처리나 정확한 보존 결정이 남아 있다.

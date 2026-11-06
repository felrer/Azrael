상태: OS33 소스 수정·Windows 기본 standalone 교체·검증·남은 정리 완료. 기존 혼합 변경과의 분리 문제로 task commit은 보류했고 index는 보존했다.


# 잠금 가용성 확인의 OS33 처리 수정

## 승인된 실행기 교체

현재 수용: 기본 전환 actual 0, override 없는 기본 경로의 lock-owner 검사 및 격리 CLI 등록·심사·삭제 actual 0, PowerShell `-RecoveryOnly` actual 0. selector와 기존 설치 영수증은 모두 새 SHA `480e125e…`를 선택한다. 신규 installation 참조를 먼저 추가하고 실제 기본 경로 수용 후 정확한 구형 installation 참조만 해제했다. 버전과 빌드 producer를 지원 API로 닫았고 빌드가 사용한 원래 검증 입력의 execution 참조도 해제했다. 37개 관련 Rust source 파일의 현재/고정 입력 해시는 일치한다. `deployment.json`, `default-acceptance.json`, `build-completion.json`이 근거다. 설치 version에 독립 수용 근거를 복사했다.

전환 준비의 반복 busy는 각 lifecycle 쓰기 사이에 다른 세션이 catalog를 재획득한 결과다. 전체 전환의 짧은 maintenance→catalog 배타 구간 안에서 기존 API를 호출해 전환을 완료했다. 각 획득의 대기 상한 5초와 실제 점유 보호를 유지했으며 잠금을 제거하지 않았다. 임시 run 두 개와 사용 종료한 구형 version은 모두 native fresh 심사·명시적 삭제 actual 0, `deleted / remaining:false`, 실제 경로 부재 및 producer record finalize를 확인했다. 합계 927,445,333 logical bytes이며 물리 회수량은 측정하지 않았다. 빈 task 상위 디렉터리와 일회용 제어 파일 8개도 일반 삭제·부재 확인했다. 현재 남은 cleanup 대상은 없다. 최종 근거는 [cleanup-completion.json](cleanup-completion.json)이다.

마지막 실제 selector·설치 영수증 raw SHA 동일, 실행파일 SHA `480e125e…` 동일, 신규 installation 참조 및 구형 참조·retired producer record 부재를 확인했다. 새 version의 `verification/final-installation.json`에 최종 identity·수용을 보존했다. 작은 작업 근거와 native 복구 영수증이 참조하는 두 독립 proof는 유지한다. 구형 실행기를 사용하던 외부 작업이 끝난 후에만 구형 version을 삭제했으며 다른 세션이 새 기본 실행기로 요청하는 것도 관찰했다. 실제 점유 경합은 계속 구조화된 busy로 처리되고 스케줄러나 앱 내장 실행기는 변경하지 않았다.

사용자가 수정된 Windows standalone 기본 실행기 교체와 남은 정리를 승인했다. 앱 재빌드·설치와 예약 실행기 추가는 범위 밖이다. 기존 230개 native 검증 입력을 재사용해 release 빌드했고 최종 `--offline --locked` actual 0, 입력 해시 불변을 확인했다. 초기 locked 준비 실패 3회는 exit 101이며 오프라인 준비 후 고정 빌드에 성공했다. 의존성 버전 변경은 없고 원래 검증 입력은 보존했다.

후보 SHA-256은 `480e125e26c1c6955a8ed013935a1b06f542472f71d226614047656ab1e50855`, 2,566,144 bytes다. Node 잠금 검사 actual 0, lifecycle 첫 실행은 204 pass/1 fail (`pwsh ENOENT`), 실행 경로 보완 후 해당 1개 재검증 actual 0이다. 격리 CLI 등록·심사·삭제 actual 0 및 실제 부재를 확인했다. `candidate-acceptance.json`이 독립 근거를 보존한다.

교체 준비 중 다른 작업 EH-01/DO3의 native 등록이 catalog 잠금을 점유해 version close가 구조화된 `maintenance_busy`로 두 번 거절됐다. 점유 잠금을 제거하지 않았으며 기본 선택은 아직 구형이다. 새 version은 pending이며 교체·기본 경로 수용·구형 참조 해제·fresh cleanup을 이어간다.

## 범위와 권한
- 승인: `check_available`가 잠금 메타데이터를 읽기 전에 공유 OS 잠금을 얻도록 수정하고 검증한다.
- 기존 owner·identity·legacy marker·권한·복구 보호를 유지한다. 예약 실행기 추가·제품 빌드·설치·push는 제외한다.
- 공통 Rust 소스는 Windows x64/Linux x64/macOS ARM64 대상이다. 이번 실행 검증은 Windows x64이며 다른 OS의 실기기 수용을 주장하지 않는다.
- 기존 작업의 파일 변경과 index를 보존한다. 별도 worktree는 만들지 않는다.

## 구현과 검증
1. 기존 `wait_for_lock`, `held_observation`, 표준 File 잠금을 재사용한다. 잠금 획득 전에는 메타데이터 bytes를 읽지 않는다.
2. 기존 잠금 테스트에 실제 배타 잠금 보유 시 구조화된 busy, 해제 후 성공, legacy marker 거절을 확인한다. 필요한 경우 transient wait 사례를 추가한다.
3. owning architecture와 feature inventory의 기존 항목에 검사 범위를 연결한다.
4. 고정 입력·명시적 Cargo cache/owner로 focused native 회귀를 실행하고 결과·실제 exit를 기록한다. 설치본은 교체하지 않는다.
5. 진단용 임시 입력·fixture·로그는 필요 종료 시 기존 owner로 삭제한다. 최소 독립 검증 근거는 이 작업 문서에 유지한다.

## 수용 기준
- 잠금 파일 bytes 관찰이 공유 잠금 획득 이후에만 이뤄진다.
- 경합 시 raw OS33 대신 기존 maintenance_busy 계약을 유지하고, 허용 대기 중 해제되면 성공한다.
- 알 수 없는 marker·권한 거절·identity 변경은 계속 차단된다.
- 실제 실행 결과와 미검증 플랫폼, 정리 결과를 구분한다.

## 구현과 검증 결과
- `check_available`는 공유 OS 잠금 획득 전 bytes 관찰을 제거했다. 기존 `wait_for_lock`과 `held_observation`을 재사용하여 잠금 아래 메타데이터 형식·경로 identity·내용을 확인한다.
- 기존 `os_release_keeps_inode_and_legacy_markers_are_not_acquired`는 busy code/path/retryable과 legacy marker 거절을 직접 검사한다. 새 `availability_waits_for_exclusive_owner_before_reading_metadata`는 배타 소유자의 메타데이터 변경과 해제 후 대기 성공을 검사한다. 향후 잠금 검사 단순화에서 메타데이터 읽기를 잠금 앞으로 옮기는 구체적 재발을 막기 위해 기존 module에 유지한다.
- owning architecture의 OS 잠금 항목을 갱신했다. 기존 feature `tool.project-maintenance`의 구현 owner 및 필수 `tool.project-maintenance.library` 검사가 변경 파일과 module 테스트를 이미 포함하므로 중복 inventory 항목이나 검사 명령은 추가하지 않았다.
- Windows x64 Rust stable 1.98.0에서 패키지 전체 `cargo test -p azrael-project-maintenance --offline --locked -- --test-threads=4`: 실제 exit 0, passed 230 / failed 0, selected-tests-v2 accepted=true. 시작 2026-11-02 09:52:34 KST, 종료 09:55:02 KST, 약 148초. 고정 입력 전후 일치 및 관련 live source 일치를 확인했다. rustfmt와 scoped diff --check도 exit 0이다.
- 첫 준비 시도는 축소 workspace에서 원본 Cargo.lock을 그대로 사용하여 --locked가 pruning을 거부했다(exit 101, 실행 테스트 0). 원본 입력은 유지하고 별도 inputs-r2를 오프라인 준비했다. retained external dependency 77개의 name/version/source가 원본 lock의 부분집합임을 확인했으며 버전 갱신은 없다. 재시도는 1회다.
- 독립 근거: [verification.json](verification.json). Linux/macOS 실기기, 배포 바이너리 및 설치된 앱은 이번 검증 범위가 아니다.

## 정리와 통합
- 임시 root `artifacts/tasks/fc01/r1`, producer group `run:FC01:os33-r1`, owner `os33-lock-availability`. 고정 입력·독립 target·test temp·raw 로그·일회 helper를 포함한다. 현재 용량은 미확정이다. producer close는 실제 동기 종료와 독립 검증 근거로 complete/revision 2이다. 구형 기본 실행기 `3b1f9bf4…`로 등록을 시도했지만 OS33 또는 `maintenance_busy`로 반복 실패했다. native 등록·fresh review·삭제·실제 부재·finalize는 미완료다.
- 보존 예약을 남긴 두 실패는 정확한 동기 종료·자식 생성 없는 등록 경로와 원래 lease owner/fence/SHA를 고정한 근거로 recover_reservation actual exit 0을 확인했다. execution_outcome_changed=false / pending_intents_changed=false다. 최초 복구 요청의 proof schema 누락 두 건은 변경 전에 거절됐고, 필드를 보완한 뒤 정상 복구했다. 마지막 실패의 reservation JSON 부재를 확인했다. [cleanup.json](cleanup.json)이 실제 실패와 복구 상태를 소유하며, 소비된 일회 요청·결과 파일 7개는 일반 삭제·실제 부재를 확인했다.
- 동일한 구형 실행기를 이용한 재측정·재시도는 중단한다. 수정한 Windows standalone을 빌드·검증하고 기본 실행기로 전환하는 권한을 받으면 현재 보호·소유·참조를 다시 확인하고 지원 owner 경로로 정리를 이어간다. 권한 없이 설치 실행기를 교체하거나 다른 삭제 API로 우회하지 않는다. 현재 잔여를 보존 승인이나 전체 완료로 간주하지 않는다. 독립 복구 근거 `cleanup-recovery.json`, `cleanup-recovery-r2.json`은 native 복구 영수증이 참조하므로 보호한다.
- 작업 시작 시 lock_recovery.rs, architecture, feature inventory와 다수 maintenance 파일에 기존·동시 작업의 미커밋 변경이 있었다. 이 작업의 작은 hunk만 반영하고 기존 index는 바꾸지 않았다. 필수 task commit은 관련 미커밋 구현과의 의존성·분리가 확인되기 전까지 보류한다. 설치·push 권한으로 해석하지 않는다.

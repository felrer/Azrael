상태: 완료. 승인된 10개 폴더는 관리자 native 실행기 실제 exit 0, 전 항목 deleted/remaining=false, 정확한 10개 경로 부재와 제외 5개 존재를 확인했다. 삭제 전 논리 크기는 7,753,724,175 bytes = 7.2212GiB다. 관리 별칭도 지원 API로 해제했다. 기능 변경은 `b4e5f750`에 분리 커밋했고 전용 worktree의 디렉터리와 Git 등록 부재를 확인했다. 검증용 임시 산출물 7개 묶음·22개 경로도 삭제·부재·소유 기록 finalize를 완료했다. 링크 보호가 있는 실패 baseline 4개는 명시적 보류로 남긴다.

## 승인 후 구현과 검증

- 범위: 관리 라이브러리의 명시적 `retire_managed_roots` 검토·적용과 한정된 소유자 실행기. 기본 root 보호, live member 누락 금지, 권한·참조·실행·링크 검사는 유지한다. 설정 범위 확대나 원본 manifest 직접 수정은 하지 않는다.
- 폐기는 정확한 ID·owner·reason·evidence_ref를 토큰에 묶고 기존 native intent/일반 삭제를 재사용한다. 설정과 역사 기록을 보존하며 실제 payload 삭제와 별칭 해제를 구분한다. 실패 시 실제 잔여를 남긴다.
- 공통 라이브러리 정책은 Windows/Linux/macOS 대상이다. 이번 실물 삭제와 회귀 검증은 Windows 로컬이다. UI 변경·전체 제품 빌드·설치·배포는 범위 밖이다.
- 소유: `/root/root_retirement`는 crate 구현·회귀 테스트·실행기를 전담한다. `/root/verification_prep`는 읽기 전용 실행 준비 조사를 담당한다. root는 계약·문서·고정 입력·검증·실물 삭제·통합을 소유한다. 다른 작업의 변경을 보존한다.
- 선행 조건: 구현 완료 후 고정된 crate 입력으로 기존 library 검증 wrapper의 type-check·nonzero selection·전체 crate test를 실행하고 owner 실행기를 준비한다. 기본 보호와 변경 토큰 거부, 완결성·소유·참조·권한·중첩 범위 회귀를 확인한다. 실제 삭제 전 최신 사용 참조를 확인하고 기존 보존 증거를 재사용한다.
- 계획 출력: `artifacts/verification/dn01-root-retirement/`에 고정 소스·Cargo 출력·검증 로그를 이 작업 소유로 준비하고, 삭제 검토·결과와 잔여 목록은 기존 `temp-delete-evidence-20261024/`에 보존한다. 실패 로그는 진단 완료 전 보존한다. 정리 후 보존 이유와 재검토 조건을 기록한다.
- 결과 인수 조건: 정확한 10개만 모두 부재, 제외 항목 보존, native 결과의 실제 remaining 일치, 테스트 실제 exit 0, 소유 문서·feature inventory 반영 및 task commit. 미완료이면 완료로 보고하지 않는다.
- 구현 파일: crate `retirement.rs`, `lib.rs`, `apply.rs`, `src/bin/maintenance_owner.rs`, `tests/root_retirement.rs`. evidence는 프로젝트의 보호된 `artifacts/maintenance/evidence/` 아래 읽기 가능한 1 MiB 이하 파일이며 내용 identity도 토큰에 포함한다.
- 사전 검증: 기존 adapter bundle은 tool boundary 10초 제한에서 exit 124로 종료됐다(producer_completed=true). 직접 재실행은 실제 exit 1, 10개 중 9개 통과였고 stale fixture의 최상위 `files` 필드 누락이 원인이었다. 제품 검사는 유지하고 fixture만 `files: []`로 보완한 뒤 실제 exit 0, 10/10 통과했다(`adapter-fixed.log`).
- native 준비: 공용 `engine/codex-rs/target`은 다른 producer가 점유하고 있어 별도 임시 target을 선택했다. 최초 시도는 PATH에 Cargo가 없어 spawn 이전 실패했으며 컴파일러는 시작되지 않았다. 동일한 고정 입력 identity를 검증해 재사용하고 `C:/Users/felre/.cargo/bin`을 process PATH에 추가했다. frozen `codex-rs/rust-toolchain.toml`의 Cargo/rustc 1.95.0을 확인했다. 타입 검사와 nonzero 선택(90 tests)이 exit 0으로 끝났고 실제 전체 crate 검증은 진행 중이다. 최초 실패와 재시도는 각각 별도 lifecycle run으로 기록했다.
- native 최종 결과: 타입 검사·선택·실제 crate 테스트 **90/90**, owner 실행기 컴파일 모두 실제 exit 0. suite별 11+32+27+12+8개이며 폐기 회귀 8개가 포함된다. 고정 소스의 실행 전후 전체 inventory identity가 일치했다. source/temporary cache는 현재 사용자 중단된 정리의 재개에 필요한 진단·재현 자료로 보존한다. 실제 정리 종료 또는 재개 취소 때 해당 lifecycle 참조를 해제하고 전체를 정리한다.
- 실제 폐기 검토: 기존 10개 그룹 전체를 등록 검증 모드로 검토했고 모든 blocker가 비었다(`retirement-review.json`). 7,753,724,175 bytes의 등록된 논리 크기를 확인했다. 복사한 실행기 SHA256은 `a278cec878bb0c170c3fa614aa031bc2ea845e746bae1959d60929f68d1b286b`다. 승인된 descriptor와 fresh token으로 apply 요청을 만들고, 관리자 script가 바이너리·요청 hash를 확인한 뒤 같은 native 라이브러리만 호출하도록 했다.
- 관리자 실행 결과: `Start-Process -Verb RunAs`가 **The operation was canceled by the user**로 끝났다. 관리자 자식 exit는 null이며 owner 실행기는 시작되지 않았다. 호출 shell의 exit 0은 승격/삭제 성공이 아니다. 재시도·일반 권한/다른 API 우회는 하지 않았다. 이후 정확한 10개와 제외 5개가 모두 남아 있음을 확인했다. 삭제 0 bytes. Windows 재요청에 대한 사용자 응답 후 새 검토로 이어간다. 근거: `retirement-uac-cancelled.json`, `native-validation.json`, `native-library.log`, `native-owner-build.log`.
- 소스 기록: 원래 importer receipt를 가진 Git commit `ccbcbf93906a72cc7654aa9c57c670d5e2e3831d`에서 원본을 복원했다. 기본 archive는 autocrlf 변환으로 importer가 거부했고, raw archive도 receipt 외 추가 파일·과거 drift 6개·Windows symlink placeholder 표현 차이가 있었다. 원본 receipt raw SHA `12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6`와 canonical `028f02a89b108c40b56c857f13ddc481608be2508336b0941318c2c3d5271c21`를 유지하고 정확한 SHA가 일치하는 Git blob으로 새 baseline을 복원하여 최종 full importer 검증은 통과했다. 기존 실패 사본을 패치하거나 receipt hash를 바꾸지 않았다. `original-blob-recovery.json`, `provenance-lifecycle-handoff.json`에 출처·실패·소유 자료를 보존한다.
- recorder 이전 동시 작업 보호: 마지막 producer는 기존 daemon 보존 검사의 잘못된 경로 때문에 실제 exit 1로 끝났으며 SOURCE 변경은 시작되지 않았다. 실패 종료 기록은 공유 `artifacts/maintenance/lifecycles/catalog.lock`으로 거부됐다. root의 실행 중 lifecycle writer는 없으나 실제 잠금 소유자와 종료를 확인할 수 없어 잠금을 제거하지 않았다. 정확한 producer 종료 근거는 보존하며 결과를 성공으로 만들지 않는다. 잠금이 정상 해제되거나 지원된 복구 절차가 실제 소유 producer tree의 종료를 입증한 뒤 owner API로 실패 producer를 닫고, 검증된 최종 baseline을 재사용해 fresh recorder를 실행한다. 다른 작업의 `engine/SOURCE.json`·daemon 수정은 그대로 보존했다. source receipt 기록과 task commit은 미완료이며 제품 설치·빌드를 수행하지 않았다.
- 재개 인계: Windows UAC 재요청에 사용자 응답이 필요하다. 응답 후 검증된 2.28MB owner 실행기를 재사용하고 C:/Temp의 정확한 기존 그룹을 다시 검토해 삭제한다. provenance/검증 출력은 해당 단계 재개·실패 진단에 필요하므로 지금 보존하며, pending lifecycle 종료와 실제 정리 완료 또는 작업 취소 이후 전체 group 단위로 review/delete한다. 실패 baseline을 원래 원본으로 사용하거나 미확정 잠금을 삭제하지 않는다.
- 재승인 실행: 사용자가 UAC 재요청에 “네”로 답했다. 최신 프로세스 참조 없음과 전체 10개 blocker 없음 확인 후 새 토큰으로 apply 요청을 만들었다. 관리자 PowerShell `-File` 시도는 실제 exit 1, owner/result 생성 전 종료됐으며 현재 기본 실행 정책은 서명 없는 스크립트를 허용하지 않았다. 실행 정책을 바꾸지 않고 검증된 owner 바이너리 자체를 Windows Shell `RunAs`로 직접 실행했다. 바이너리 SHA256은 기존 값과 같고 apply 요청 SHA256은 `b02fd7d7a9a59ecd84e2c4b1850f55c45ad718e50637c00b9277c905e25c2a13`다. native PID 23120 시작과 durable manifest의 첫 항목 deleted/다음 pending을 확인했다. 실제 terminal 결과와 전체 경로 부재를 확인하기 전 완료로 보고하지 않는다.
- 공유 잠금은 새 턴의 확인에서 정상적으로 없어져 재개했다. 다섯 번째 실패 producer를 관측 exit 1로 owner API에서 닫았고, 새 등록 run에서 정확한 최종 baseline으로 source recorder를 시작했다. 잠금 제거·실패 성공 변환·원본 baseline 재생성은 하지 않았다.
- 실제 최종 삭제: 관리자 native owner PID 23120은 2026-10-24 15:40:38 KST에 실제 exit 0으로 끝났다. 중간 기록에서 1개 및 7개 삭제를 확인했으며 중복 삭제 producer나 보호 우회를 실행하지 않았다. 최종 root 검증은 전 항목 status deleted/remaining=false, 정확한 승인 10경로 lstat ENOENT, 제외 5경로 존재다. [최종 실물 검증](temp-delete-evidence-20261024/retirement-final-verification.json), [native 결정](temp-delete-evidence-20261024/retirement-final-native-decisions.json), [관리자 실행 결과](temp-delete-evidence-20261024/retirement-elevated-owner.json). 논리 크기와 실제 디스크 여유 변화는 구분한다.
- `azrael-legacy-temp-20260913` 별칭은 `project_inventory unregister_project`에서 status unregistered/project_files_changed=false로 해제했다. C:/Temp의 작은 설정·증거·native 이력은 보존한다. 2024/c7496cdc/refusal/live-diagnosis/current-run.json은 삭제하지 않았다.
- primary source recorder와 engine-provenance snapshot은 실제 exit 0. 정확한 소스 delta는 우리 Rust 5개뿐이며 기존 daemon SHA `fa09ffa4c1caa17eda4c9f511eaeb863c6e07efca5ea9b0cc0158f07c505cb52`는 전후 동일하다. primary SOURCE는 `9abb36...`→`1a097f65...`로 갱신했으나 원래 다른 작업의 daemon/receipt 수정이 함께 존재하여 전체 파일을 task commit에 섞지 않는다. 같은 HEAD의 전용 task worktree에서 우리 5개만 반영한 supported receipt를 만들어 index에 올리고 primary의 결합된 working SOURCE는 보존한다. full product 빌드·설치는 수행하지 않는다.

## 승인된 실행

통합·임시 자료 정리: task-only SOURCE는 supported recorder/snapshot 실제 exit 0, 원래 HEAD 대비 정확한 Rust 5개 inventory delta이며 frozen90 검증 입력과 byte identity가 같다. 커밋된 6개(5개+SOURCE)를 전용 worktree와 대조한 뒤 일반 Git restore/remove로 worktree를 제거했다. primary의 다른 daemon 변경과 결합된 working SOURCE는 보존했다. 모든 자체 producer 11개는 알려진 실제 종료 결과를 유지한다. 작은 원인 로그·검증·삭제 증거를 `temp-delete-evidence-20261024/`로 보존한 뒤 owner API로 정확한 참조와 flags를 정리했다. 실제 LICENSE symlink가 있는 실패 baseline 4개는 native 링크 보호 때문에 보류한다. 나머지 7개는 native 등록·fresh 검토·적용에서 22개 전 항목 deleted/remaining=false, aborted=false를 확인했다. 논리 크기 합계 601,311,977 bytes(573.46MiB)를 정리했으며 owner finalize도 7개 전부 remaining=[]/finalized, 실제 exit 0이다. [적용 결과](temp-delete-evidence-20261024/artifact-cleanup-applied.json), [부재·기록 정리](temp-delete-evidence-20261024/artifact-cleanup-finalized.json), [보류 4개와 재검토 조건](temp-delete-evidence-20261024/artifact-cleanup-deferred.json). 최초 등록은 전체 내용 측정이 필요해 수 분이 걸렸고, 이후 등록된 측정값을 재사용했다. 삭제는 파일 권한·링크 확인과 일반 삭제를 기다렸으며 중복 실행하지 않았다. 보류의 재검토 조건은 지원된 소유자 링크 정리 절차와 완전한 membership 재조정이다.

- 정확한 대상: host-fixture 1005/1010/1020/1030/1040 5개, account-check 0a349e33/1e5075cd/a9a14fd1/9b38cb81 4개, host-bin-20260913-0953 1개. c7496cdc/refusal/live-diagnosis/2024/current-run.json 제외.
- 소유: `/root`가 승인된 정리와 생성 근거 확인을 담당. 원래 테스트 generator는 Azrael host/account verification. 기존 증거·바이너리 복사 receipt·후속 통과 결과를 재사용하며 역사적 종료 결과는 변경하지 않음.
- 관리 방법과 실패: 별도 `C:/Temp/project-maintenance.json`에 정확한 10개 하위 폴더만 managed_roots로 설정하고 `azrael-legacy-temp-20260913` 관리 루트를 명시적으로 등록했다. root 자체를 member로 설정한 것은 실행 준비 오류였다. 최초 등록 후 review가 전부 `managed root itself is protected; select owned descendants`로 차단했다. 허용된 하위 145항목으로 같은 그룹의 전체 재등록을 시도했지만 `group update cannot drop a live member`로 실패했다. 첫 등록 그룹 10항목은 그대로 유지됐고 하위 항목 등록은 반영되지 않았다. 설정 범위 확대·raw registry 수정·rename/다른 API를 통한 보호 우회는 수행하지 않았다.
- 계획된 보존 출력: `work/DN-01-disk-cleanup-candidates/temp-delete-evidence-20261024/`의 작은 원본 결과·식별 receipt와 SHA256 목록, 삭제전 보호 확인, native 등록/검토/결과 및 실제 잔여 보고. 해당 출력은 본 정리 작업의 증거이며 삭제 대상 밖에 둠.
- ReadOnly 파일은 native 소유 절차에 맡기되, 속성 변경이 원본/다른 hardlink에 영향을 주지 않는지 확인. 현재 사용 확인 후 fresh review token으로 정확한 10개만 delete. 미확정·보호·실패가 생기면 중단하고 실제 잔여를 기록.

## 초기 보호 거부 당시 기록 (후속 구현·삭제 완료 전)

- **파일/폴더 삭제 0, 원본 속성 변경 0, 강제 종료 0. 확보 공간 0.** 두 보호 오류가 발생하여 destructive delete 결정을 제출하지 않았다. fresh review 후 10개 전부를 명시적으로 defer 처리했고 native 결과는 `aborted:false`, group status `deferred`, 전 항목 `remaining:true`다.
- 현재 확인: 승인된 폴더 10개가 모두 존재하며 직접 자식 145개도 남아 있다. c7496cdc/refusal/live-diagnosis/2024/current-run.json도 그대로 존재한다. [실제 잔여 확인](temp-delete-evidence-20261024/remaining-paths.json).
- 16개 작은 결과/바이너리 식별 receipt(합계 9,461 bytes)를 별도로 복사하고 각각 원본·사본 SHA256 일치를 확인했다. [보존 목록](temp-delete-evidence-20261024/evidence-index.json).
- ReadOnly 25개 모두 fsutil 조회에서 hardlink 1개임을 확인했다. 첫 PowerShell attribute-filter 조회는 상위 바이너리 4개만 반환해 coverage가 부족했으므로, 전체 파일 열거 후 필터링으로 보완했다. 이후에도 원본 속성은 변경하지 않았다. [확인 결과](temp-delete-evidence-20261024/readonly-hardlinks.json).
- 실행 직전 확인한 프로세스 및 일반/외부 프로필 설정 4경계에서 Temp 테스트 사용 참조는 없었다. 이는 보호된 관리 경계 삭제를 허용하는 근거로 사용하지 않았다.
- 최초 등록은 lock 생성 2026-10-24 13:52:58 KST에서 native registered_at 14:11:07 KST까지 약 18분이었다. 이후 구성 변경으로 전체 재측정이 한 번 추가됐고, 14:33 KST에 최종 오류·잔여 상태를 확인했다. 재작업의 원인은 root/member 경계를 사전에 정확히 구분하지 못한 실행 준비 오류다. 등록의 성공과 삭제의 성공을 구분한다.
- 새로 남긴 관리 상태: `C:/Temp/project-maintenance.json`, `C:/Temp/artifacts/maintenance/`의 native 기록, `azrael-legacy-temp-20260913` 별칭. 보호 실패를 숨기거나 우회하려고 제거하지 않았다. 기존 Azrael 프로젝트의 관리 설정과 제품 코드는 변경하지 않았다.
- 다음 재검토 조건: 보호를 유지하는 정식 관리 경계 해제 또는 동일 소유의 live membership 전환 절차가 지원되고 검증될 때 정확한 10개 폴더를 fresh review한다. 현재 공개된 도구 action에서 해당 전환 경로는 확인하지 못했다. 새로운 관리 기능/코드 보완은 이번 파일 삭제 승인과 구분해 별도 범위를 합의해야 한다. 이미 받은 10개 폴더 삭제 승인은 계속 유지한다.
- 추가 확인: 사용자 요청에 따라 Windows UAC `Start-Process -Verb RunAs`로 비파괴적 관리자 확인 프로세스를 실행했고 exit 0으로 관리자 권한을 확인했다. 해당 프로세스는 종료됐으며 파일 삭제는 수행하지 않았다. 앞서 `approval_policy=never`를 Windows UAC 요청까지 불가능하다고 설명한 것은 잘못으로 정정했다. UAC 승격은 native의 managed-root 보호를 해제하지 않는다.
- 기존 해제 경로 코드 확인: `engine/codex-rs/project-maintenance/src/groups.rs:152`는 존재하는 member의 제거를 거부하고, `lib.rs:843`은 관리 경계 자체를 보호한다. dispatch의 지원 operation에는 live group/member의 등록 해제·경계 퇴역 전환이 없다. alias `unregister_project`는 문서상 별칭만 해제한다. `scripts/artifact-lifecycle.cjs` finalize도 실제 member가 사라진 뒤에만 metadata를 정리하므로 삭제 선행 단계로 사용할 수 없다. 원본 tool state 직접 수정·관리 범위 확대·관리자 프로세스를 이용한 우회 삭제는 하지 않았다.
- 원본 기록: [최초 등록](temp-delete-evidence-20261024/native-registration.json), [root 보호 거부](temp-delete-evidence-20261024/blocked-root-review.json), [구성 변경 실패](temp-delete-evidence-20261024/failed-child-registration.json), [최종 검토](temp-delete-evidence-20261024/final-review.json), [최종 보류 결과](temp-delete-evidence-20261024/final-defer-result.json).

# 최초 조사 범위와 결론

Windows 로컬 `C:/Temp`의 오래된 Azrael 테스트 자료만 조사했다. 같은 세션의 기존 로그 이관/삭제 작업은 별도이며 해당 파일을 수정하지 않았다. `C:/Temp/2024`는 생성 소유를 확인하지 않았으므로 제외한다. 제품 코드·지원 플랫폼 변경은 없다.

13개 테스트 폴더에서 **8,202,042,958 bytes = 7.6387GiB**, 파일 74,649개를 확인했다. 모두 마지막 내부 변경이 2026-09-13이다. 링크와 접근 오류는 없고 ReadOnly 파일이 28개 있다. 크기는 논리 크기이며 실제 회수 공간을 보장하지 않는다.

현재 쓰이는 설치본의 자료가 아니라 초기 Azrael 0.1.0 및 엔진 0.154.0-alpha.6.2의 테스트 실행 복사본임을 결과 JSON, 바이너리 복사 provenance 및 테스트 실패 stack에서 확인했다. 현재 실행은 `artifacts/build/b13/artifacts/releases/w11aa`와 일반 Codex extension을 사용한다.

# 정확한 삭제 후보

| C:/Temp 아래 상대 경로 | bytes | 판단 |
|---|---:|---|
| `azrael-host-fixture-20260913-1005` | 1,100,952,118 | 초기 host 검증 실패. extensionKind 예상 불일치. 후속 1040 통과 기록 있음. |
| `azrael-host-fixture-20260913-1010` | 1,182,899,759 | accounts Webview 대기 시간 초과. |
| `azrael-host-fixture-20260913-1020` | 1,180,417,016 | accounts Webview 대기 시간 초과. |
| `azrael-host-fixture-20260913-1030` | 1,180,415,546 | Webview 탭 식별 대기 시간 초과. |
| `azrael-host-fixture-20260913-1040` | 1,086,242,554 | 후속 host 검증 passed=true, Azrael extension 0.1.0. |
| `azrael-account-check-0a349e33` | 366,583,732 | run-result exitCode=1, reconnect 후 fixed-home config/thread 보존 검사 실패. |
| `azrael-account-check-1e5075cd` | 553,202,556 | run-result exitCode=1, 같은 계열 보존 검사 실패. |
| `azrael-account-check-a9a14fd1` | 368,545,362 | run-result exitCode=1, fixed-home state 검사 실패. |
| `azrael-account-check-9b38cb81` | 368,739,883 | run-result exitCode=0, verification status=passed. 실패 재시도 뒤 통과한 검증. |
| `azrael-account-check-c7496cdc` | 448,318,467 | 초기 thread/read -32600 실패 로그는 있으나 run-result 종료 영수증 없음. 삭제 실행 전에 종료·진단 인계 근거 보완 대상으로 구분. 성공으로 취급하지 않음. |
| `azrael-host-bin-20260913-0953` | 365,725,649 | 초기 codex.exe/bridge와 VSIX 2개. 기록상 source/copy hash 일치. 현재 파일을 재해시한 결과는 아님. |
| `azrael-account-refusal-0ff94daf` | 316 | ipc 디렉터리 사전 존재에 대한 거절 로그와 fixture 3개 파일. 정상 통과 증거로 해석하지 않음. |
| `azrael-live-diagnosis` | 0 | 오래된 빈 m.lock 1개뿐. lock 파일의 존재만으로 사용 중이라고 판단하지 않음. |

호스트 fixture 5개 합계 5.3373GiB, 계정 테스트 5개 합계 1.9608GiB, 바이너리 묶음 0.3406GiB. 종료 영수증 없는 c7496cdc(0.4175GiB)를 보류하면 나머지 12개 폴더는 약 7.2212GiB다.

별도 포인터 **`C:/Temp/azrael-account-current-run.json` (365 bytes)** 은 정상 종료한 `9b38cb81`의 state/bin과 이미 사라진 `azrael-acct-ipc-9b38cb81/control.sock`을 가리킨다. 현재 프로세스 참조를 발견하지 않았으며 오래된 테스트 포인터로 판단한다. 해당 계정 fixture를 삭제할 때 이 파일도 함께 정리할 범위로 선택하는 것을 권장한다.

# 사용·소유·데이터 검증

- 5개 host-result는 모두 loginPerformed=false, modelRequestPerformed=false. 최종 계정 verification도 realLogin=false, modelRequest=false, userCredentialRead=false, usageCreditConsumeRequests=0, modelRequests=0이다. 합성 계정 프로필과 테스트 thread/state를 사용한 기록이며 일반 `.azrael-ex` 사용자 데이터와 분리되어 있다. 모든 DB 내용과 이전 실패 실행의 자격증명을 전수 조사한 것은 아니다.
- Win32_Process에서 C:/Temp/azrael-* 실행 파일·명령줄 참조 없음. 조사 명령 자체는 제외했다. 현재 프로세스 실행 경로는 별도 w11aa runtime과 일반 Codex extension이다.
- 일반 프로필과 av18 외부 프로필의 Azrael extension JSON/CJS, `.azrael-ex/config.toml`, Code User settings에서 C:/Temp/azrael-* 참조 없음. 검색한 범위 밖 다른 사용자 프로필 전체까지 검증한 것은 아니다.
- Task Scheduler 액션, Desktop/Public Desktop/Startup/CommonStartup의 바로가기 27개에서도 관련 참조 없음.
- 현재 프로젝트 scripts/docs/work Markdown에서 해당 폴더명·명명 패턴을 참조하는 문서를 찾지 못함. 이는 모든 다른 프로젝트나 외부 문서에 참조가 없다는 증명은 아니다.
- 상위/계정 state의 EXE·SQLite·log·lock 등 핵심 파일 **71개를 FileAccess.Read / FileShare.None으로 열고 닫는 검사에 성공**. 이 검사는 비파괴적이며 삭제 시점의 전체 파일 무점유를 보장하지 않는다.
- 현재 native inventory 632항목 전 페이지에 C:/Temp 항목 없음. 미등록 레거시이고 프로젝트 외부라서 등록된 artifacts 삭제 대상으로 취급하거나 관리 루트를 확장하지 않았다.

# 현재 남은 조건

승인한 세 분류 10개 폴더의 삭제와 별칭 해제는 완료됐다. 제외 5개는 보존했다. 기능 변경의 task commit과 검증용 산출물의 그룹별 삭제·보류 결정을 완료했다. 실제 symlink가 든 실패 baseline 4개는 관리기의 링크 보호를 유지하며 보류하고, 지원된 소유자 정리 절차가 마련되면 재검토한다. 다른 작업의 코드·소스 receipt·산출물은 보존했다.

# 증거

- [현재 전체 구성·크기·파일 속성·선별 결과](temp-audit.json), [조사 스크립트](temp-audit.py). 스크립트 exit 0, 링크/접근 오류 0. 작업 계획 생성 첫 호출은 상대 session 경로를 거부하여 문서를 만들지 않았고, 절대 경로로 재호출하여 이 03-plan.md를 생성했다.
- 원본 `C:/Temp/azrael-host-fixture-20260913-1040/host-result.json`, 각 account `run-result.json`, `9b38cb81/state/verification.json`, `azrael-host-bin-20260913-0953/host-pair-hashes-final.json`, 각 실패 로그.

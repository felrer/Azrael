상태: 사용자가 정식 이관 후 삭제를 요청하여 지원 이관 경로를 보완하는 중입니다. 기존 두 그룹·세 경로(논리 503838바이트)의 [부분 삭제](03-approved-deletion-result.md)는 유지합니다.

## 정식 이관 실행 계획

- 범위: 앞서 승인된 구버전·버전 미확정 `artifacts/logs` 경계 중 생성 근거와 현재 소비 해제를 확인한 경로. 원본·유일 복구 백업·현행 설치/활성 입력·미확정 생성 소유는 보호한다. 관리자 권한·강제 삭제·일반 record의 false→true 변경은 사용하지 않는다.
- 구현: 기존 producer metadata helper에 증거·정확한 소유자/revision·선택 경로·다른 소유/참조를 확인하는 명시적 custody transfer를 추가한다. 일반 record의 보호 승격 거부는 유지한다. 신규 target을 pending으로 먼저 기록하고 source에서 선택 경계만 이관한 뒤 target을 확정한다. 중단 시 보호 및 동일 요청 재개를 검증한다. native 등록/검토/삭제의 검사와 권한 경계는 그대로 사용한다.
- 소유/의존: 실행 담당 `/root/custody_transfer`가 helper와 해당 테스트만 담당한다. root는 증거·현행 프로세스/설치 참조·문서·feature inventory와 통합, 실제 파일 삭제를 담당한다. helper 검증 완료가 pilot 이관의 선행 조건이며 증거 준비는 독립 실행한다. 자식 재위임은 금지한다.
- 플랫폼: metadata 이관 의미는 공통 Node 구현. 실제 검증·삭제는 현재 Windows x64 로컬만 수행한다. Linux/macOS 수용·제품 빌드·설치·배포는 별도이며 하지 않는다.
- 검증: 기존 promotion 거부, evidence/owner/revision/path/link/ownership/consumer 보호, 실패 단계별 보호와 동일 요청 재개 회귀. 작은 실제 구버전 로그 pilot을 이관→fresh native register/review→delete→실제 부재/finalize한 뒤 확인된 독립 묶음에 확대한다. 미확정 항목은 이유와 정확한 잔여를 보고한다.
- 실행 자료는 `artifacts/tasks/DN-01-disk-cleanup-candidates/runs/formal-custody-handoff-20261024-r3/`로 귀속하며 전체 producer를 생성 전 등록했다. 새 제품 동작 없이 metadata 관리 절차만 확장하므로 기존 `tool.project-maintenance` owner와 관련 검사에 연결한다.

후속 실행 범위: `artifacts/logs`의 로그를 기존 버전·작업 소유 그룹에 연결하여 분류하고, 2026.0.10 이하로 확인되며 현재 설치·활성 작업·필수 검증 증거의 참조가 없는 묶음을 정리합니다. 최신·버전 미확정·소유 불명·활성 참조 묶음은 이유와 재검토 조건을 기록해 보존합니다. 사용자 데이터, 일반 캐시, 연구 자료 및 최신 산출물 삭제는 포함하지 않습니다. 관리 도구의 그룹 보호와 실제 삭제 결과를 확인합니다. 기존 후보 조사 결과는 당시 스냅샷으로 유지합니다.

# 범위와 검증

- 요청: Windows 로컬 컴퓨터의 Azrael 2026.0.10 이하 산출물·로그, 레거시 캐시·코드 및 기타 대용량 삭제 후보.
- 허용 행동: 읽기 조사와 보고서 작성. 삭제, 프로세스 종료, 설치 변경, 참조 해제 없음. 제품 설계·지원 플랫폼 변경 없음.
- 조사 대상: `C:/Users`, `C:/Temp`, `C:/tmp`, `C:/NVIDIA`, `C:/ProgramData`, `C:/Eden-Talos-Research`, D:, E:. Windows 시스템 폴더와 C: Program Files 전체, G:/H: 가상 드라이브는 조사하지 않음.
- 등록 항목 533개와 그룹 320개를 조회하고, 대용량 그룹을 native `project_cleanup_review`의 registered 모드로 검토. 미등록 경로는 파일 내용을 읽지 않고 디렉터리 메타데이터로 측정. 등록 경로 내부는 재귀 측정하지 않고 기존 논리 크기를 재사용.
- 크기 집계: 2026-10-24 10:01경 시작, 약 17분 26초 후 정상 종료(exit 0). 첫 실행은 기본 인코딩 오류(exit 1)로 실제 순회 전에 종료하여 UTF-8 모드로 재실행. 집계 도중 진행 중 빌드가 있어 원자적 스냅샷은 아님.
- 접근 실패 6,127건, reparse/link 항목 10,208건 제외. 따라서 조사 영역의 완전한 실사용량을 보장하지 않음. 크기는 GiB(2^30 bytes), 논리 크기이며 hardlink·압축·sparse·등록 시점 차이로 실제 회수량과 다를 수 있음. 상위·하위 행은 중복이므로 합산 금지.
- 처음 C: 여유 약 4.72GiB, 조사 중 약 3.06GiB, 마지막 약 9.92GiB. 본 작업의 삭제로 늘어난 공간이 아님. D: 2.99GiB, E: 11.34GiB.
- 증거: [전체 크기 집계](scan.json), [조사 스크립트](scan.py), [등록 크기 자료](registered.json), [보호 검토 원본](review.json), [검토 요약](registered-review.md). review 토큰은 후속 삭제 때 재사용하지 말고 새 검토 필요.

# 추천 순서

## 1. 재생성 가능한 캐시·완료 테스트 자료

아래 첫 6개 항목의 합은 약 298.7GiB이며 서로 중첩되지 않음. 아직 삭제 가능 확정량이 아니라 우선 검토 범위다. 캐시 삭제 후 재빌드·재다운로드 시간이 발생한다.

| 후보 | 논리 GiB | 판단과 삭제 전 조건 |
|---|---:|---|
| `engine/codex-rs/target/x86_64-pc-windows-msvc/debug/incremental` + `target/debug/incremental` | 189.88 + 37.17 = 227.05 | 최우선 빌드 캐시 후보. 조사 초기에 Rust 컴파일이 `target/debug`를 사용했고 마지막 프로세스 조회에서는 cargo/rustc가 없었음. 이는 소유 작업 종료·lease 해제의 증명은 아니므로 작업 소유자 확인 후 삭제. 전체 target 348.38GiB와 중복 계산하지 않음. |
| `artifacts/verification/AK-02-api-context-fix/target` | 41.09 | 별도 검증 캐시. fixture 전체는 41.80GiB. 해당 작업 완료·실패 진단 및 재사용 참조 종료 확인 후 관리 절차로 정리. |
| `C:/Temp`의 오래된 Azrael fixture/account-check/host-bin | 7.64 | 대부분 2026-09-13 host fixture와 테스트 복사본. 다른 파일도 포함한 상한. 현재 프로세스·프로필 및 상태 데이터 보존 확인 후 정확한 하위 경로 선택. |
| `C:/Users/felre/.cache/bazel-repo-contents-cache` | 12.66 | 재생성 가능한 repository cache 후보. 활성 Bazel 작업과 캐시 소유 확인. |
| `C:/Users/felre/.gradle/caches` | 6.42 | Gradle 버전/의존성 캐시. 관련 빌드·daemon 종료 및 오프라인 재사용 필요 확인. |
| `C:/Users/felre/AppData/Local/npm-cache` | 3.86 | npm 다운로드 캐시. 관련 설치 작업 종료 후 소유 도구로 정리. |
| `C:/Users/felre/AppData/Local/Temp` | 10.84 | 파일별 사용·소유가 혼재. 폴더 통째 삭제 금지, 종료된 작업의 임시 파일만 선택. |
| `C:/Users/felre/AppData/Local/uv` | 3.61 | uv 데이터 후보. 하위 구성을 아직 확인하지 않아 전체가 캐시라고 확정하지 않음. |
| 관리 도구 검토에서 차단 없음: CU native-v1/v2, DD failure run, DC reply-native-prep-1/native-9 등 | 0.74 | 이번 검토에서 차단 사유 없는 완료 테스트 자료. 정확한 경로는 registered-review.md. 삭제 직전 fresh review와 작업 진단·인계 완료 여부 확인. |

## 2. 2026.0.10 이하 버전과 관련된 산출물·로그

운영 문서의 일반 프로필 2026.0.10 설치 설명은 현재 상태보다 오래됐다. 실제 설치 extension `azrael-ex-local.azrael-2026.0.11/package.json`과 실행 중인 `artifacts/build/b13/artifacts/releases/w11aa/engine/azrael.exe`로 2026.0.11 사용을 확인했다. 반면 `C:/Users/felre/av18/artifacts/f/extensions`에는 실제 2026.0.10 extension이 남아 있다. 버전 조건만으로 전부 삭제할 수는 없다.

| 후보 | 논리 GiB | 판단과 조건 |
|---|---:|---|
| `artifacts/n10a` | 43.03 | 운영 기록상 2026.0.10 일반 프로필 빌드. 내부 target 29.33GiB 포함. 2026.0.11 교체 이후 기존 설치·복구·증거 참조가 해제됐는지 확인한 뒤 전체 버전 묶음 정리. |
| `artifacts/build/u22c` + `artifacts/build/q` | 8.11 | 2026.0.10 외부 프로필/host 검증 묶음. 현재 관리 도구가 active/unknown reference로 차단. 외부 프로필의 실제 사용과 인계 완료를 확인해야 함. |
| `artifacts/build/u21a` | 5.31 | `u22c/.git/objects/info/alternates`가 실제로 u21a의 Git 객체를 참조. u22c 유지 중 단독 삭제 불가. |
| `artifacts/build/u17a` | 4.43 | `version:window-use-u17b` 소비 참조 및 membership 불일치로 차단. 현재 producer 기록을 확인하고 참조/등록을 정리해야 함. |
| `artifacts/e10` | 2.59 | `windows-2026.0.10-host` 검증 fixture. 사용 보호 미확인 및 native managed root 밖이라 차단. 기존 소유 절차로 진단·상태 보존 확인 필요. |
| `artifacts/logs` 전체 | 5.34 | 여러 버전·작업의 로그가 혼재. 전부가 2026.0.10 이하라고 확인된 것은 아님. 버전별 payload·snapshot·검증 기록과 연결하여 구버전 전체 묶음으로 정리하고 현행 버전이 참조하는 최소 증거는 먼저 이관. |
| `C:/Users/felre/AppData/Local/azrael-ex` | 6.23 | 별도 설치 루트 후보. 하위 버전과 설치 참조 확인 전 전체 삭제 불가. |
| `C:/Users/felre/av17`, `av18` | 2.87 / 3.36 | 테스트/외부 프로필이며 계정·설정·세션 포함 가능. 실행 payload와 사용자 상태를 분리 검토. av18의 2026.0.10 설치 존재 확인. |

다른 대형 산출물: `artifacts/build` 총 115.46GiB, `artifacts/verification` 48.74GiB, `artifacts/tasks` 20.13GiB, `artifacts/tools` 17.17GiB, `artifacts/workspaces` 10.46GiB, `artifacts/w14w` 10.32GiB, `artifacts/iy17b` 7.93GiB. 서로 다른 버전·활성 작업이 섞여 있으므로 이름만으로 구버전 여부를 확정하지 않음. build/c23b 16.83GiB 및 v11k 12.62GiB 등은 별도 최신 작업일 수 있어 <=2026.0.10 목록에 자동 포함하지 않음.

## 3. 그 밖의 대용량 후보 — 내용 필요성 결정 필요

| 경로/자료 | 논리 GiB | 판단과 조건 |
|---|---:|---|
| `C:/Users/felre/.azrael-ex/tmp/devin-native` | 53.73 이상 | Azrael 자식 프로세스의 TMP/TEMP 공용 임시 영역(`scripts/devin-native-host.cjs:55`). 현재 `providers/opencodex/tests/antigravity.test.ts:16`도 이 환경 아래 `azrael-antigravity-*` 테스트 home을 생성하고 가짜 계정·설정을 기록하며 afterEach에서 삭제하도록 구현됨. 실제 같은 이름의 잔여 폴더와 접근 거부 경로를 확인. 테스트별 종료/삭제 실패 원인과 종류별 용량 비중은 미확인. 종료된 테스트 잔여물은 유력 후보지만 전체 53.73GiB를 재생성 가능한 캐시로 확정하지 않음. 활성 provider 런타임·상태·인증과 소유 정책 확인 후 정확한 하위 폴더만 검토. `.azrael-ex` 전체 정리 대상 아님. |
| `C:/Users/felre/Virtual Machines/Azrael-CUA-Test/downloads/26300.9457.26h2-enterprise-eval-ko-kr.iso` | 7.66 | 테스트 설치 ISO. 설치·복구·VM 마운트에서 더 사용하지 않는 경우 유력 후보. |
| `C:/Users/felre/Desktop/Desktop-file/Sid-Meiers-Civilization-VI-SteamRIP.com.rar` | 18.19 | 대형 설치 압축파일. 필요 없으면 삭제 후보. 내용 검증하지 않음. |
| `C:/Users/felre/Desktop/Desktop-file/videos.zip` | 13.19 | 보관 영상 압축본. 유일 원본인지 확인 필요. |
| Desktop-file과 Downloads의 `MSOffice2024.zip.Lock` | 각각 5.04 | 이름과 크기가 같은 후보 2개 발견. 동일 내용은 해시 검증하지 않았으므로 중복 확정 아님. |
| `C:/Users/felre/Desktop/data` | 24.53 | 실험 결과 ZIP 9.00GiB와 풀린 자료 내부 export.tar.gz 7.14GiB 등이 있음. 보관 책임자에게 원본/복사본 관계 확인. |
| `C:/Users/felre/AppData/Local/ktcloud-ai-nexus/wsl/ubuntu-24.04/ext4.vhdx` | 77.06 | WSL 가상 디스크 자체는 캐시가 아님. 내부 환경·작업 데이터 확인 후 불필요 파일 정리/디스크 축소 또는 환경 폐기를 별도 선택. 파일 직접 삭제 후보로 추천하지 않음. |
| `C:/Users/felre/.android/avd/LAIO_Pixel8_API_36_1_4GB.avd/userdata-qemu.img.qcow2` | 16.39 | Android 에뮬레이터 사용자 데이터. 미사용 AVD라면 AVD 관리자를 통해 폐기, 앱 테스트 상태 유실 고려. |
| `C:/Users/felre/AppData/Local/Programs/Steam` | 55.76 | 게임 설치 영역. 안 쓰는 게임을 Steam에서 제거하는 후보. |
| `C:/Users/felre/Desktop/Eden/.research` | 187.42 | 연구 산출물이 큼. character-combat-test 85.24GiB, battle-props-lab 64.89GiB. 실패/중복 실험 여부와 재현 증거 확인 전 삭제 추천 확정 불가. |
| `C:/Eden-Talos-Research` | 145.33 | 2026-10-09 영역만 131.98GiB. native-source-rocks-v3 29.86GiB, v4 25.83GiB 등 실험별 소스/산출물 복사본 후보. 코드 원본/독립 수정 여부 확인. |
| `D:/Eden-Talos-Research` | 71.11 | C: 자료와 유사한 이름이나 내용 중복은 확인하지 않음. D: 확보용 별도 후보. |
| `D:/archived-projects` | 5.35 | 레거시 코드 보관 후보. 원격 백업·미커밋/미푸시 변경·현재 프로젝트 의존성 확인 후 정리. |
| `E:/취미/애니메이션` | 349.90 | E: 용량의 최대 영역. 보관할 콘텐츠를 사용자가 선택해야 하며 C: 용량은 확보되지 않음. |

## 보존 대상과 후속 절차

- 현재 2026.0.11 실행 runtime, 진행 중 작업의 source/target/lease, 현재 checkout과 Git 기록은 보존.
- `.azrael-ex/sessions` 14.12GiB 및 `thread_history_1.sqlite` 약 4.20GiB는 사용자 대화 데이터. 인증·설정과 함께 본 정리 추천에서 제외.
- D: `pagefile.sys` 20GiB는 시스템 파일이므로 직접 삭제하지 않음.
- 원본 소스 코드를 제거하는 것보다 캐시·복제된 빌드 입력·종료된 검증 fixture를 먼저 정리하는 편이 확보 용량 대비 영향이 작다. 실제 소스 기능 삭제는 이 요청의 조사 범위가 아님.
- 권장 다음 단계: 첫 표 약 299GiB 후보에서 완료 작업·재사용 필요를 확인하여 삭제할 정확한 범위를 결정한다. 이어 2026.0.10 이하 버전의 외부 프로필·Git alternates·증거 참조를 해제할 범위를 정하고 payload부터 로그까지 소유 그룹 단위로 정리한다.
- 등록 항목은 fresh review/apply, 미등록 항목은 소유·구성·참조 확인 및 기존 관리 절차를 사용. 차단 시 우회하거나 강제 삭제하지 않음. 작업과 무관한 앱·연구 자료는 별도 선택.

# devin-native 하위 테스트 잔여물·참조·접근 거부 조사

상태: devin-native 5,917개 삭제, 선택 잔여2,937개 중25개 명시 보류·2,912개 미삭제. 후속 승인된 Windows 숨김 실행 수정·엔진 재빌드·집중 회귀와 소스33/33 검증을 완료했으나 core 후속검증·패키지·설치·실행 중 도구 반영은 미완료다. 검증된 별도 캐시까지 삭제 승인은 확장됐지만 추가 삭제0이며 보호·불확실성으로 보류한다. 마지막 C: 여유3,748,573,184B로 대형 후속검증을 보류하고 설치 승인은 응답 대기한다. ACL 복구·강제 삭제·사용자 작업 종료는 하지 않음. 이 절의 실행은 별도로 진행되는 artifacts/logs 정리 상태와 구분한다.

## 식별 결과

최상위 항목 35,083개의 메타데이터를 수집했다. 전체를 다시 순회하지 않고 코드에서 생성 용도를 확인할 수 있는 아래 네 종류 중, 생성·최상위 수정 시각이 마지막 OS 부팅(2026-10-16 00:57:13 KST)보다 이전인 경로를 선택했다. 따라서 원래 생성한 테스트 프로세스는 부팅을 넘어 생존할 수 없다는 점에서 종료가 확인된다. 이것은 이후 재사용·증거 보존 필요까지 부정하는 근거는 아니다.

| 종류 | 부팅 이전 잔여 폴더 | 읽을 수 있는 논리 용량 | 확인 근거 |
|---|---:|---:|---|
| `chatwidget-tests-*` | 438 | 5,268.35MiB (약 5.14GiB) | `engine/codex-rs/tui/src/chatwidget/tests/helpers.rs:7`에서 테스트 Codex home을 생성. 대표 폴더에 테스트용 SQLite DB·skills·writer locks 등이 남아 있음. |
| `codex-core-*` | 7,958 | 2.61MiB | `core/tests/integration_test_setup.rs:16` → `test-binary-support/lib.rs:47`의 테스트 binary 임시 home. 전체 7,989개 중 부팅 이후 31개는 이 목록에서 제외. |
| `codex-exec-server-*` | 226 | 0.077MiB | `engine/codex-rs/exec-server/tests/common/mod.rs`의 테스트 binary dispatch → 같은 TempDir 생성 경로. |
| `azrael-antigravity-*` | 10 | 0.011MiB 이상 | `providers/opencodex/tests/antigravity.test.ts:15`가 별도 Codex/OpenCodex home과 가짜 계정 데이터를 생성. 9개 내부는 접근 거부라 용량 미포함. |
| 합계 | **8,632** | **약 5.15GiB 이상** | 이 값은 전체 devin-native 53.73GiB와 별개인 선택 범위이며 물리 회수량 보장 아님. |

정확한 8,632개 이름·시각·개별 크기와 오류는 [선택 목록](devin-native-ended-test-sizes.json)에 보존했다. 링크/reparse 항목은 따라가지 않았다. 나머지 `.tmp*` 21,165개, `azo-*`, 업데이트·도구 임시 파일 등은 위의 테스트 종료 분류에 자동 포함하지 않았다. 특히 `azo-*`는 `scripts/ordinary-runtime.cjs:99`에서도 쓰므로 테스트 전용 이름이 아니다.

## 현재 사용·참조 확인

- 실행 중 전체 프로세스의 executable·command line을 관찰하고, 184개 관련 사용자 프로세스를 선택하여 Windows 파일 핸들 2,851개를 읽기 전용으로 조회했다. 선택 후보 8,632개에 대한 현재 파일 핸들/명령행 참조는 발견되지 않았다. 다른 프로세스의 핸들을 닫지 않았으며 조회용 복제 핸들만 닫았다.
- 실제 사용 중인 `.tmp4tuHRu`, `.tmphCit04`, `.tmpLk5peO`에는 각각 Node kernel/trusted-worker가 연결돼 있다. 이 셋은 보존 대상이다. `adb.log`도 `adb.exe` PID 56452가 열고 있다.
- 별도 `cargo test ... codex-core ... claude`와 테스트 binary가 실행 중이다. 따라서 이 경로 전체 또는 일반 `.tmp*` 일괄 정리를 정당화할 수 없다.
- 관리 control JSON 및 명시한 현재 설정 파일 471개를 읽어 확인했다. 선택 후보의 현재 consumer 참조는 발견하지 못했다. maintenance manifest의 root 경로 일치는 과거 stdout에 나온 `azrael-sky-gate-GisfyK` 오류였으며 선택 후보의 live reference가 아니다.
- 핸들 조회/복제 7건은 실패했다. 프로세스·파일은 조사 뒤 변할 수 있고, 선택하지 않은 시스템 프로세스·다른 설치 프로필·과거 작업 인계 전체를 모두 증명한 것은 아니다. 발견되지 않았다는 결과를 전역적인 무참조 증명으로 취급하지 않는다. 실제 삭제 전 fresh check와 소유 작업의 진단·증거 보존 필요 검토가 남는다.
- 최초 핸들 probe는 pipe를 경로로 조회하는 과정에서 멈춰, 정확히 확인한 본 조사용 Python PID 57056만 종료했다(exit 1). pipe를 제외한 수정 probe는 정상 종료(exit 0). 사용자 앱·빌드·테스트는 종료하지 않았다.

## 접근 거부의 직접 원인

Antigravity 10개 모두의 루트와 `codex/azrael/providers/opencodex` ACL을 읽었다. 9개의 내부 디렉터리에서 소유자는 현재 사용자 SID이나, DACL은 **보호됨 + ACE 0개**였다(SDDL 끝이 `D:PAI`). NULL DACL이 아니라 빈 DACL이므로, 읽기를 허용할 항목이 없고 상위 권한도 상속되지 않는다. 이 상태가 실제 디렉터리 열기의 WinError 5와 일치한다. 권한·소유권·파일 속성은 변경하지 않았다.

해당 9개: `azrael-antigravity-36yJGO`, `-3wB8gd`, `-bXiAqt`, `-hPs6jY`, `-jplyrV`, `-nUQdpd`, `-roIU77`, `-v3wKiA`, `-vdZMu2`(두 번째부터는 공통 접두사 생략). `azrael-antigravity-0rxvuz`는 현재 사용자 Full Control ACE가 있으며 접근 가능하다. 대표로 확인한 codex-core 2개와 chatwidget 2개의 루트 ACL에는 이 빈 DACL 문제가 없었다. 전체 테스트 폴더 ACL이 정상이라는 뜻은 아니다.

## 누적/권한 손상의 원인 판단 범위

- 현재 `windows-secret-acl.ts`는 현재 사용자 권한을 먼저 주고 상속을 제거하도록 구현돼 있다. 파일 상단은 반대 순서에서 중간 실패하면 보호된 빈 DACL을 남길 수 있다는 과거 실패 형태를 설명한다. 실제 9개가 어느 버전·어느 호출에서 이렇게 됐는지는 과거 ACL 실행 로그가 없어 확정하지 않았다.
- `config/paths.ts:31`의 설정 읽기는 비동기 ACL hardening을 시작할 수 있고, `flushConfigDirHardeningForTests`는 이를 기다리는 API다. 코드의 주석은 icacls 자식이 디렉터리를 잡고 있으면 teardown이 EPERM/EBUSY로 실패할 수 있다고 명시한다.
- 현재 `antigravity.test.ts:32` teardown은 이 flush를 기다리지 않고 재귀 정리를 시도한다. CODEX_HOME/OPENCODEX_HOME의 이전 값도 복원하지 않는다. 이는 잔여물 누적에 영향을 줄 수 있는 코드상 후보이나, 이 10개의 과거 실패 원인이 확정됐다는 뜻은 아니다. 코드 수정·테스트 실행은 이번 요청에 포함하지 않았다.
- 과거 로그에서 `ACL hardening timed out`, `ACL hardening failed`, `hardening still incomplete`, `Config mutation coordination directory ACL hardening did not complete`, `EPERM`, `EBUSY`와 정확한 폴더명을 확인하면 생성 실패 원인을 더 좁힐 수 있다. 이 조사에서 해당 9개의 원인을 확정할 과거 로그는 확보하지 못했다.

증거: [상위 목록](devin-native-entries.json), [ACL](devin-native-acls.json), [프로세스 관찰](devin-native-all-processes.json), [참조 검토](devin-native-references.json), [파일 핸들 관찰](devin-native-handles.json), [선택 범위 크기·오류](devin-native-ended-test-sizes.json). 크기 집계는 약 60초, 정상 exit 0, 접근 거부 9건이다. 직접 원인인 빈 DACL은 확인됐고 과거 생성 원인은 아직 추정이라는 구분을 유지한다.

## 승인된 devin-native 삭제 실행

- 사용자 지시 `보존할거 말고는 전부 삭제해주세요`는 현재 대상 devin-native의 검증된 잔여물 정리로 적용. 현재 runtime, adb.log, 활성/종료 미확인 항목, 용도·소유 미확인 항목 및 권한 차단 9개를 보존. 전체 컴퓨터의 최초 후보 목록에는 삭제 지시를 확대하지 않음.
- 기존 8,632개 선택 경로의 생성·수정 메타데이터를 재확인하여 변경·링크 경로를 제외. 권한 차단 9개를 보류하고 8,623개/약 5.15GiB를 삭제 검토 대상으로 선택.
- 기존 경계 밖 경로에는 프로젝트 운영 절차에 따라 `C:/Users/felre/.azrael-ex/tmp/project-maintenance.json`을 새로 생성. ID `azrael-devin-native-legacy`, managed root는 `devin-native` 하나이며 알려진 활성 파일·폴더를 protected_paths로 지정. 기존 설정은 덮어쓰지 않음. 이 작은 제어 파일과 native 관리 기록은 삭제 결과 추적을 위해 보존한다.
- 기존 생산자의 소유 관계를 유지한 70개 묶음(묶음당 최대 128개의 서로 독립된 테스트 home)으로 최초 등록하여 native 측정을 받는다. 등록 → fresh review → 전체 구성원에 같은 delete/defer 결정 → apply 결과 확인 순서. 원래 생성자는 테스트이며 이 정리 작업이 원본 소유를 새로 주장하지 않는다.
- 새 프로세스 스냅샷과 파일 핸들 조회는 완료됐으며 실제 삭제 직전에도 다시 확인한다. 사용자 process를 종료하지 않는다. native 도구의 불확실성·차단은 우회하지 않는다.
- 실행 입력·보고서 위치: [선택과 보류](cleanup-selection.json), `cleanup-requests/`, `native-registration-results.json`, `native-cleanup-results.json`. 기존 조사 보고서와 현재 작업 기록은 유지한다.
- 추가 조사한 LAIO 자동 테스트 전용 폴더 628개 중 생성·수정이 마지막 부팅 이전인 231개를 29개 소유자별 묶음으로 추가 선택했다. 부팅 이후 397개는 원래 테스트의 종료 근거가 부족하여 보존한다. 입력은 [LAIO 선택과 보류](cleanup-selection-laio.json) 및 같은 `cleanup-requests/` 디렉터리에 있다. LAIO 제품 코드와 사용자 DB는 변경하지 않는다.
- LAIO 생성 근거는 `C:/Users/felre/Desktop/Life-All-In-One/apps/laio_app/test/`의 각 테스트 mock PathProvider에 있는 `Directory.systemTemp.createTempSync('laio_*_test_')`이다. 예: `features/search/service/app_search_service_test.dart:35`, `features/draft/service/draft_sync_coordinator_test.dart:43`. `lib/services/runtime_profile.dart:160`과 `lib/services/local_db.dart:319`가 해당 테스트용 ApplicationSupport 경로 아래 DB를 만든다. 테스트 지침 `docs/ops/test-guidelines.md:89`는 폐기 가능한 테스트 DB를 규정한다. 일부 teardown이 DB만 닫고 임시 디렉터리를 삭제하지 않는 것도 확인했다. 원본 사용자 프로필의 복제 근거는 발견하지 않았다.
- 최초 128개 chatwidget 묶음의 등록·review는 완료됐다. 약 0.909GiB에 차단 사유가 없었고 native apply가 진행 중이다. 2026-10-24 12:05:37 KST 제어 기록에서 111개가 삭제되어 부재함을 확인했다. apply의 전체 종료 전에는 묶음 완료로 취급하지 않는다.
- 2026-10-24 12:11 KST경 첫 apply가 정상 반환했다. 첫 묶음 128개 모두 `status: deleted`, `remaining: false`, 오류 없음, 그룹 `deleted`, `aborted: false`다. 논리 용량 0.9091484900563955GiB이며 실제 물리 회수량은 도구가 보고하지 않았다. 상세는 [첫 삭제 결과](native-cleanup-results.json)에 보존했다. 다음 chatwidget 묶음을 최초 등록 중이다.
- 2026-10-24 12:29 KST경 두 번째 128개 묶음의 등록도 정상 종료했다. 이후 순차 native 작업과 `native-results/` 실행 증거 소유는 `/root/devin_cleanup_execute`에 전달했다. root는 이 기록과 최종 수용 대조를 담당한다. 동일 관리 잠금으로 삭제 실행을 중복하지 않는다. 소스의 해시·경로 검사와 항목별 상태 저장 때문에 시간이 길며, 파일 수 비례 예상은 보장 시간이 아니다. 최종 수용용 `audit-native-cleanup.py`는 고정 선택 목록과 각 native 결과의 구성원·삭제 상태·잔여·논리 용량을 대조하고 알려진 활성 4개 경로의 존재만 확인한다. payload를 재순회하지 않는다.
- 후속 실행 보고: 두 번째 chatwidget 128개도 모두 `deleted`, `remaining: false`, 오류 없음, `aborted: false`, 그룹 `deleted`로 끝났다. 논리 용량 1,630,496,350B, apply 실측 1,821.941초다. 누적 256개/약 2.428GiB 삭제 확인. `native-results/dn-legacy-codex-tui-chatwidget-tests-001-{references,review,apply}.json`에 증거를 보존했다. 세 번째 128개/2,392,938,044B 묶음은 등록·최신 참조 검사·review를 통과하여 apply 중이며, 나머지 묶음은 직렬 실행 루프가 담당한다. 전체 완료 대조 전에는 이 중간 결과를 전체 완료로 취급하지 않는다.
- 1차 실행 담당 인계: chatwidget 전체 438개/5,524,261,965B를 포함해 13그룹 전체와 `core-009` 중 103개까지 누적 1,693개/5,524,695,105B 삭제 확인. `core-009`의 `codex-core-testsa4LCHT` 하나가 native `failed`, `error: ""`, `remaining: true`였고 후속 24개는 그룹 실패 규칙으로 차단되어 잔여 25개를 보존했다. 실제 호출은 종료됐다. 원본 partial 요약은 `native-results/worker-summary.json`에 유지한다. 실패 그룹과 무관한 나머지 85개 그룹만 기존 담당에게 후속 실행을 지시했다. 실패 그룹의 payload 재시도·강제 삭제는 하지 않는다.
- 실패 진단: root와 하위 6개 경로를 읽기 전용으로 열 수 있었고, root 사용자는 Full Control이며 ACL 상속이 켜져 있었다. 내용은 디렉터리 3개와 `.lock` 0B, `applypatch.bat`/`apply_patch.bat` 각 182B다. `core-009-failure-acls.json`에 모든 ACL 관찰을 보존했다. 실행 원본 `b13/engine/codex-rs/project-maintenance/src/paths.rs:963`의 하위 PowerShell 비정상 종료 시 stderr를 그대로 반환하는 분기가 빈 오류 기록과 일치한다. 실제 하위 프로세스 종료 코드는 native 결과에 없으므로 값을 추정하지 않는다. 15:25~15:31 KST Application 이벤트 1000/1001 조회는 0건이다. 직접 원인은 확정되지 않았으며 Antigravity 9개의 빈 DACL 문제와 같은 원인으로 단정하지 않는다.
- 후속 담당 인계: core-010~042 33그룹/4,224개를 추가 삭제하여 총 5,917개/5,526,149,097B 삭제 확인. `native-results/worker-summary-continuation.json`에 보존했다. core-043은 등록 후 참조 검사에서 `node.exe` PID7300의 OpenProcess error87로 멈췄고 review/apply는 실행하지 않았다. 선택 잔여는 2,937개(실패 그룹 보존 25개 포함)이며, 현재 native 호출은 모두 종료됐다. PID 재사용·종료 경합 여부는 새 스냅샷으로 재검증하기 전까지 미확인이다.
- 새 사용자 지시 `터미널을 숨겨서 실행해주세요`에 따라 새 native 실행을 보류했다. 직접 명령은 지금까지 tty 없는 pipe 방식이었지만, 실제 설치 원본 `b13/engine/codex-rs/project-maintenance/src/paths.rs:944`는 내부 `powershell.exe`를 숨김 옵션 없이 시작한다. 현재 도구 인터페이스에는 이 내부 생성 옵션을 지정하는 항목이 없다. stage1 창 목록은 해당 시점에 터미널을 반환하지 않았지만, 잠깐 나타나는 창이 없다는 증거로 취급하지 않는다.
- `computer-use` 및 `window-use` 지침을 읽었다. 터미널 UI 조작은 `Do not automate terminal applications` 제한 때문에 사용하지 않았다. 별도 창 제어 승인이나 우회 API도 실행하지 않았다. 기존 정리 승인은 제품 코드 변경·재빌드를 포함하지 않으므로, 내부 PowerShell 숨김 실행 수정·재빌드 허용 여부를 비동기 사용자 질문으로 요청했다. 응답 전 제품 코드·설치본 변경과 새 native 정리를 시작하지 않는다.
- 담당의 재개 요청 `01a16d84-e131-78d0-9e1e-24ec1d5fb02a`에는 deferred로 응답했다. 재개 조건은 root가 지원되는 숨김 경로 또는 승인된 변경을 검증해 명시적으로 재개하고, core-043을 재등록하지 않은 채 새 참조 검사가 불확실성 없이 통과하는 것이다. 실패 core-009는 여전히 재삭제하지 않고 추후 fresh review/defer할 예정이다. 최종 전체 대조는 아직 실행하지 않았다.
- 사용자 답변 `숨김 실행 수정·재빌드 허용`으로 추가 변경을 승인받았다. 범위는 Windows 로컬 maintenance 내부 PowerShell과 junction 테스트 cmd의 콘솔 생성 억제이며, 기존 `codex_utils_process::background_command`를 재사용한다. Windows 전용 Cargo 의존성과 소스 회귀 검사를 추가했다. 삭제 정책·권한·참조·실패 보존 규칙과 Unix 동작은 변경하지 않는다. 기존 실행 세션을 강제 종료하거나 실행 중 b13 파일을 덮어쓰지 않는다.
- 소스 회귀 검사 `Windows maintenance shells use the shared background command policy`는 실제 exit 0, 1개 통과, 전후 입력 동일이다. 로그·결과: `artifacts/tasks/DN-01-disk-cleanup-candidates/hidden-source-01/`. 테스트 뒤 lifecycle 종료 인자의 누락을 실제 결과에 근거해 수정하여 같은 producer를 닫았으며 테스트를 중복 실행하지 않았다. 아직 네이티브 컴파일·실제 숨김 회귀·제품 재빌드·활성화는 미검증이다.
- 후속 입력: 기존 원본 baseline 두 경로가 사라져 기록된 원본 Git blob과 importer receipt로 독립 기준본을 복구한다. 담당 `/root/devin_cleanup_execute`는 새 소유 run에서 원본 full 검증, 지원 recorder의 정확한 3파일 delta 기록, 고정 engine 사본을 준비한다. root는 이 readiness를 받아 library 검사와 기존 detached-parent 콘솔 회귀를 먼저 실행하고 지원 빌드 경로로 이어간다. 새 정리 호출은 숨김 경로 활성화와 core-043 최신 참조 검사가 통과할 때까지 보류한다.
- 기준본 복구·원본 importer 검증·정확한 3파일 recorder는 각각 exit 0이다. SOURCE raw SHA는 `64c38e2710ff8fe001a76f621439105587c4bc608009ecd72d8f998738da6ab3`이며 누적 integration을 유지했다. 최초 복사 마지막 검사에서 Windows 긴 경로 오류(exit 1)가 발생해 실패 사본을 보존했다. 기존 importer의 확장 경로 처리를 재사용한 새 짧은 소유 경계 `artifacts/verification/dn01-hidden-native-input/engine`은 파일별 해시·입력 전후·사본 일치·importer 검증을 모두 통과했다. 9,315파일/100,363,342B, source SHA `637c0d57a76c6416324ae1683dc39abaccf79365a868527130fc3dc1bc1e9f24`. 증거: `artifacts/tasks/dn01-hidden-native-freeze/runs/20261024T141232548Z-21e28fd4-cd72-4c34-9e92-d0f09243b129/reports/result.json`.
- 전체 adapter 회귀는 11/11, 실제 exit 0이다. 첫 전체 검사 이후 입력 명세의 직접 의존 파일명을 보완했고, 공유 run claim과의 일시 충돌 시에는 검사 시작 전에 멈췄다(잠금 조작 없음). 준비 담당 등록 뒤 새 run에서 11/11을 재확인했으며 명시한 입력은 전후 동일했다. 최종 증거: `artifacts/tasks/DN-01-hidden-adapter/runs/20261024T141626205Z-376ec671-91aa-484d-b2c1-1fdf05939964/`. root는 고정 engine 입력으로 native library와 detached-console 검사를 시작했다. 담당은 이와 독립적으로 지원 deployment workspace owner를 사용해 고정 project/working 사본을 준비한다. Cargo와 제품 빌드는 이 담당에게 아직 지시하지 않았다.
- 최초 native 검사는 Cargo 생성 전 기존 공용 cargo-pending generation에 종료 producer가 없어 차단됐다. exact invocation의 recordPending→spawn 순서·producerPid null·종료 세션/exit 1을 근거로 지원 `recoverTargetOwner` API에서 이번 lease만 복구했고 unknown/null을 유지했다. 기존 공용 pending 기록은 변경하지 않았다. 새 검사는 작업 소유 temporary/pending을 명시하여 같은 warm target을 재사용했다. 이는 지원된 caller-owned 출력 경로이며 타입 검사·nonzero selection·캐시 lease 검사를 그대로 수행한다. 복구 증거: `artifacts/tasks/DN-01-hidden-cargo-recovery/runs/20261024T142030116Z-f1ab4842-9b7a-4182-b467-bfc8cce1f095/`.
- native 재검사: library 90/90(11+32+27+12+8), detached-parent 콘솔 회귀 1/1, 모든 타입 검사·선택·실행 실제 exit 0. 고정 engine source fingerprint 전후 동일. 증거: `artifacts/tasks/DN-01-hidden-native/runs/20261024T142046814Z-e62f13cf-5b0f-4593-a90f-f7e0cf171d6f/`. 소스 검증 완료와 설치된 실행기의 반영은 구별한다. project 사본 준비와 독립적으로 준비된 engine 입력을 사용해 유지된 build-azrael engine recipe의 Cargo owner 명령으로 engine/bridge 빌드를 먼저 시작했다. 완성 시 동일 source receipt를 가진 3실행파일 bundle만 후속 product 빌드에 재사용한다.
- 실패 core-009 잔여 25개는 native fresh registered review 후 같은 defer 결정으로 기록했다. 실제 25개 모두 deferred/remaining=true, group deferred, aborted=false. payload 재삭제와 PowerShell 삭제 실행은 하지 않았다. 재검토 조건은 이전 일반 삭제 실패 원인 진단, 지원 숨김 runtime 활성화, 소유·참조·보호 재검증이다. `core009-defer-review.json`, `core009-defer-apply.json`에 현재 보류와 원래 partial 기록을 구분해 보존했다.
- engine component 빌드 완료: Cargo 실제 exit 0, 컴파일 11분39초. 이어 source record/verify도 exit 0으로 끝났고 controller 세션 68483 실제 exit 0을 관측했다. immutable source `637c…`와 일치하는 `azrael.exe`/bridge/code-mode-host 묶음: `artifacts/tasks/DN-01-hidden-engine-build/runs/20261024T142516899Z-88a13c48-58ef-4669-a789-77acf2c363cd/outputs/engine`. 결과·로그는 같은 run의 reports/logs에 있다. b13 host는 변경되지 않은 해시로 복사했으며 제품 ABI/호스트 수용 검사는 아직 별도다. 제품 사본 준비와 이후 검사·패키징이 남았다. feature manifest 78개 전체 정적 검증도 실제 exit 0이다.
- 추가 설치 승인은 질문 `["request_user_input_async","01a16e55-c1ca-7302-9680-33a77e331d87",0]`으로 요청했으며 아직 응답 전이다. 기존 승인은 수정·재빌드이며, 설치와 사용자 앱 재로드는 완료하지 않았다. 열린 창은 자동 종료/재로드하지 않는다. 공용 Cargo target은 이후 다른 작업의 running owner `63cabe9c-d045-4a66-96fb-e373bf314cfd`(`artifacts/workspaces/d/engine/codex-rs`)가 점유한 것으로 관측돼 추가 native 검사를 겹쳐 실행하지 않았다. 다음 준비 결과가 나오면 공용 캐시와 독립적인 source/package 준비부터 진행한다.
- 제품 입력 준비는 실제 exit 0으로 완료됐다. 지원 prepare/verify 및 71개 child가 통과했고, project 25,322파일/543,249,759B, SHA `cb517a60aca9906a718d0d314712475a436e47aa01dd198f3f25a52447acc89a`다. input `artifacts/build/dnh1i/project`, working `artifacts/build/dnh1`, engine 원본/불변/working 모두 `637c…`로 일치한다. context와 lifecycle handoff: `artifacts/tasks/dn01-hidden-product-prep/runs/20261024T141917947Z-7004354d-be08-4d0e-9124-623655c63263/reports/`. controller/input은 complete, workspace는 후속 실행용 pending이며 참조를 보존한다.
- 공용 cache가 정상 해제된 뒤 consumers 검사를 시작했다. prompts 1/1은 실제 exit 0이다. core 타입 검사 도중 C: 여유가 약 28.3GB에서 2.79GB로 급감해 용량 보호 취소를 시도했다. exact controller 64020→checker21220→rustup30004→cargo40732와 후손을 CIM 스냅샷으로 제한했고 Force 없는 Stop-Process를 사용했다. 취소 명령은 중간 identity guard로 멈췄으므로 모든 단계 성공으로 주장하지 않는다. 최종 Cargo는 실제 exit101, rustc 종료 값0xffffffff이며 해당 tree와 Cargo lease는 종료·해제됨을 별도로 관측했다. core 테스트 선택/실행 및 설치 수용은 미완료이며 코드 오류나 공간 부족 오류로 단정하지 않는다. 원본 실패와 취소 자료는 `native-consumers-cancel-process-tree.json`, `artifacts/tasks/DN-01-hidden-native-consumers/runs/20261024T145554985Z-14583c70-c3d5-4ef6-9308-c7e6de103ad8/`에 보존한다.
- 현재 C: 여유 약 2.1GiB이므로 추가 build/copy/설치를 보류한다. Win32_PageFileUsage의 C:/pagefile.sys 할당은 45,640MiB이나 이전 할당 관측이 없어 급감 원인으로 확정하지 않으며 시스템 파일을 변경하지 않는다. 기존 current Cargo target은 owner 절차의 보호 대상이므로 임의 partial clean이나 삭제를 하지 않는다. 범위를 별도 종료 빌드·검증 cache까지 확장할지 사용자 질문 `["request_user_input_async","01a16e7a-1bfa-7ec2-956c-81f1bebe313f",0]`으로 요청했다. 응답 전 실제 삭제 범위를 확장하지 않는다.
- 추가 읽기 후보: `artifacts/verification/AK-02-api-context-fix/target`은 최초 조사상 41.09GiB이며 지금도 존재한다(재측정 아님). 10/13 run-native.ps1:5의 CARGO_TARGET_DIR 지정과 target/debug/codex-app-server.exe를 별도 test-engine으로 hash 검증 복사하는 절차를 확인했다. 원래 producer는 마지막 부팅 이전이고 현재 해당 경로를 명령행에서 참조하는 process는 발견하지 않았다. 이것만으로 전체 소비 해제·삭제 가능을 확정하지 않는다. 확장 승인 후 소유·설치/재사용/복구 참조·구성·관리 경계를 더 검증할 후보이며 지금 삭제/등록/속성 변경하지 않았다. source 담당의 이미 시작한 읽기 검증과 소규모 mock 회귀만 계속하며 새 build/Cargo/copy는 지시하지 않았다.
- frozen project source 검증은 33개 중 32개 통과, 실제 exit 1이다. 실패는 `test-feature-preservation.cjs:429`의 실제 manifest 검증에서 working project의 generated pristine UI `header-57b689833777.js`가 없어 발생한 ENOENT이다. fixture preflight는 ready였으나 이 의존성을 검출하지 않았다. 입력 전후 검증은 project `cb517a60…`/engine `637c0d57…` 동일로 통과했다. 원본 결과: `artifacts/tasks/dn01-hidden-source-check/runs/20261024T150614076Z-23db40dc-8133-425e-b24f-cbebfdf907c2/reports/result.json`; session28166 실제 exit1. 기존 모든 producer 종료 후, root는 main의 해당 manifest UI 파일 3개 합계13,753,954B 존재를 확인했다. C: 여유2,083,545,088B에서 이 정확한 3개만 lifecycle·해시 검증 후 준비하고 동일 소스 검증을 재실행하도록 기존 담당에게 지시했다. 추가 Cargo/build/install/대용량 copy와 삭제 범위 확대는 계속 보류하며 사용자 승인 질문 두 건은 미응답이다.
- AK 후보 판단 정정: 경로명과 다른 task명 때문에 최초 lookup에서 찾지 못한 실제 owner 기록 `work/AK-01-heretic2-api-validation/02-plan.md`를 확인했다. 상태는 구현·재현 검증 중이며 generation4 입력·독립 엔진·core 후속검사를 남긴다. 기존 `work/AT-01-artifacts-cleanup-audit/01-plan.md`, `work/DH-01-project-storage-review/01-plan.md`도 해당 target 41.09GiB를 미완료 작업/재현 소유권 때문에 보존한다. 마지막 부팅이 원래 producer 종료만 설명하고 보존 참조 해제를 설명하지 않으므로, 이 캐시를 현재 삭제 후보에서 제외하며 사용자에게 정정했다. 승인 확대가 와도 이 근거만으로 삭제하지 않는다. 최초 넓은 JSON 검색은 출력이 과다해 결론 근거로 사용하지 않고 위 실제 owner 문서의 좁은 범위를 다시 읽었다.
- 사용자는 질문 `01a16e7a-1bfa-7ec2-956c-81f1bebe313f`에 `검증된 캐시까지 정리 허용`으로 답했다. devin-native 외 별도 빌드·검증 캐시도 종료·소유·무참조를 확인한 뒤 정리할 수 있으며 불확실한 항목과 사용자 데이터는 보존한다. 설치 승인 질문은 여전히 미응답이다. 숨김 pwsh와 기존 cache owner의 preview를 새 task run에서 실행했다. Cargo owner preview는 실제 exit0/status preview/errors[]/선택0이며 현재 target 0.162.0을 보존했다(`artifacts/tasks/dn01-cache-owner-preview/runs/20261024T152437724Z-41eb6711-125e-4bbf-90bd-c7ddf3332fb9/reports/result.json`). Module owner preview는 실제 exit1/status blocked, `Missing registered cache project: …/artifacts/w31b`로 삭제 전 차단됐다(`artifacts/tasks/dn01-module-cache-preview/runs/20261024T152552330Z-947a5e69-1430-41dd-bc1e-4e0b0d131b6e/reports/result.json`). 기존 retirement 경로도 실제 project 디렉터리를 요구하므로 missing registration을 임의 제거하거나 빈 디렉터리를 만들지 않는다. 두 preview의 owner source SHA는 전후 동일이며 삭제는 0이다.
- 전역 Bazel cache 읽기 담당은 기존 metadata의 13,592,327,820B와 exact bin 10,422,707,200B를 확인했으나 재측정하지 않았다. `engine/.bazelrc:7,10`은 해당 repo_contents_cache와 remote repository contents cache를 계속 설정한다. 프로세스 snapshot에는 Bazel/Bazelisk/BlazeServer가 없었으나 열린 파일은 검증하지 못했고, 기존 로컬 owner의 명시적 정리 경계도 확인하지 못했다. official Bazel 옵션은 이 cache가 공유 fetched repo directory이며 idle GC의 max-age/idle-delay 설정을 가진다고 설명한다. 이것을 직접 무참조·삭제 승인 근거로 취급하거나 서버/빌드를 시작해 GC를 유발하지 않는다. source 조회 404와 넓은 검색의 truncated 결과는 결론 근거에서 제외했다. 현 증거로 추가 cache 삭제는 0이며 보존한다.
- source 재검증 최종 확정: 동일2파일/동시성2의 33/33 pass, fail/cancel/skipped0, source CLI·wrapper·fixture controller 모두 실제 exit0/complete/stopped. 지원 전후 입력 검증에서 project `cb517a60aca9906a718d0d314712475a436e47aa01dd198f3f25a52447acc89a`와 engine `637c0d57a76c6416324ae1683dc39abaccf79365a868527130fc3dc1bc1e9f24`가 동일하다. 결과: `artifacts/tasks/dn01-hidden-source-check/runs/20261024T152425527Z-6b4e491c-3aad-49c7-bdd6-1dc04301f661/reports/result.json`. 정확3UI파일 준비의 전후 원본·사본SHA와 identity/lifecycle은 `artifacts/tasks/dn01-hidden-source-ui/runs/20261024T152410507Z-a37e001c-d568-493f-a86d-1abe7d83ab9e/reports/fixture-copy.json`에 보존한다. 기존33중1실패 결과는 덮어쓰지 않았다. 이후 Cargo/build/install/cleanup은 실행하지 않았다. `n10a`는 DH owner 기록의 원래 정리·사전검사·잠금 인계가 남아 있어 중복 처리하지 않는다. `v11b/v11g/v11h`는 지금 부재이며 이번 작업 성과로 집계하지 않는다.

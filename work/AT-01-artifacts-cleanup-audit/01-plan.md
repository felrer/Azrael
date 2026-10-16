상태: 구 배포 ZIP 4개 삭제 완료. 승인된 로그 정리는 일부 삭제 후 속성·파일 점유와 자동 승인 검토 차단으로 부분 완료.

# artifacts 정리 후보 조사

- 목표: `artifacts`의 용량 상위 항목과 레거시 재생성 가능 캐시 후보를 구분한다.
- 권한: 조사에 이어 사용자가 우선순위 1의 부분 정리를 승인했다. 삭제 범위는 `artifacts/build/codex-0160-rust-target/debug/incremental`만이며, 형제 deps/build, 전체 target, 다른 캐시와 빌드·설치 변경은 범위 밖이다.
- 대상 환경: 현재 Windows 로컬 체크아웃. 다른 OS나 `engine` 루트는 이번 정리 대상에서 제외한다.
- 보존 계약: 현재/직전 설치본, 실제 프로세스·도구 참조, 최신 선택본, 진행 작업, 소스·출처 기록, 사용자 상태를 보호한다. `latest.json`만으로 설치 여부를 판단하지 않는다.
- 절차: 기존 정리 소유자 확인 → 폴더별 파일 크기 집계 → 정리 미리보기와 실행 참조 대조 → 후보·보류 항목과 예상 확보량 보고.
- 검증: 파일 크기 기준 용량, 정리 도구 후보 사유, 보호/차단 결과를 기록한다. 링크와 접근 실패는 별도 제한이다.
- 설계 문서 변경: 제품 동작 변경 없이 조사만 수행하므로 필요 없음.

## 조사 결과

2026-10-13 KST, Windows 로컬 파일 크기 기준 약 452.06GB. 폴더 집계 실행 시간 210초, 종료 0. 앞선 전체 Desktop 조사 약 450GB와 집계 시점이 다르며 현재 작업 중인 산출물이 존재한다. 링크·재분석 지점은 제외했고 긴 경로 등 접근 오류는 첫 30개만 표본으로 기록하여 일부 합계가 과소 집계될 수 있다. 압축·하드링크·실제 할당량은 계산하지 않았다. 상세 [sizes.json](sizes.json), [scan.log](scan.log).

| 우선순위 | artifacts 기준 경로 | 크기 GB | 판단과 삭제 전 조건 |
|---|---|---:|---|
| 1 | build/codex-0160-rust-target | 232.48 | 알려진 대체 Cargo 캐시. 파일 최종 갱신 10/09. 현재 코드/문서/작업 기록 검색에서 테스트의 예시 외 해당 경로 참조를 발견하지 못했고 프로세스 snapshot에서도 직접 참조를 발견하지 못했다. 기존 cleaner가 후보로 인식했으나 cargo/rustc 실행 때문에 blocked. 빌드 종료와 현재 참조 재검사 후 전체 캐시 정리 우선 권고. |
| 1의 부분 정리 대안 | build/codex-0160-rust-target/debug/incremental | 121.09 | 위 전체 232.48GB에 포함. 동일 보호 조건이며 용량을 중복 합산하지 않는다. deps 99.85GB, build 3.49GB도 같은 캐시의 구성 요소다. |
| 2 | cache/modules | 1.07 | companion 2개(각 0.383GB), providers 1개(0.301GB). 설치 도구 참조 보호와 새로 선택된 key 검사를 적용한 후 미사용 key만 정리. 현재 compiler 실행으로 3개 모두 preserved. |
| 2 | w12b, wp1, a4e, rt6, w12repair, p5 아래 artifacts/cache | 약 4.17 | 각 1.153/0.960/0.960/0.562/0.275/0.260GB. 복제 작업별 module cache 후보. 해당 작업 종료·설치 도구와 재사용 입력 참조가 없음을 확인한 후 key 단위 정리. 부모 폴더 전체 삭제 권고가 아니다. |
| 추가 검토 | rtp, rtp11, rtp12, rtp13 | 합계 7.82 | 각 약 1.954GB, stage 폴더 약 1.42GB씩. 패키징 준비본으로 보이며 프로세스 snapshot 직접 참조 없음. 완료/실패 진단 기록·현재 및 rollback 경로 확인이 필요하며 캐시로 확정하지 않았다. |
| 추가 검토 | logs/codex-stable-source-update/ui-full-source-v1, logs/ui-pipeline-optimization/validation | 합계 약 2.78 | 로그 owner 내부의 대형 소스/검증 복사본 후보. 간결한 결과와 출처 증거 보존 후 재현·후속 참조 여부 확인. 로그 전체 삭제 대상이 아니다. |

## 보류·보존 대상

- verification/AK-02-api-context-fix/target 44.12GB: 오늘 갱신된 private Cargo cache. work/AK-01-heretic2-api-validation/02-plan.md가 구현/재현 검증 중이고 run-native.ps1이 해당 target을 명시하므로 레거시 삭제 후보에서 제외한다.
- build/window-control-native/target 1.53GB: 현재 build-azrael.ps1 및 build-window-control.ps1의 기본 타깃 경로이므로 레거시로 간주하지 않는다.
- w13b, w6a, wb1, w14p: 프로세스 snapshot에서 각각 42/2/1/3개 process의 참조가 확인됐다. runtime/source/release가 혼재하므로 부모 전체 삭제를 보류한다. 이들 아래 cache 합계 약 3.95GB도 자동으로 삭제 가능하다고 판단하지 않는다.
- isolated/codex-latest-execution-20261009-r7: latest.json이 nested release를 가리킨다. root releases의 all_changes_20261007_r6는 live executable, latest_20261008_r2 및 window_observation_recovery_20261008_r1는 설치/보호 참조가 있다.
- upstream-ui/26.1007.21434는 현재 preparation의 기본 입력. 구 UI 버전도 pristine source/test dependency일 수 있어 버전 이름만으로 정리하지 않는다.
- source-snapshots, sources, worktrees, deployments 및 app-releases는 소스·증거·배포본 영역이므로 캐시 일괄 삭제에서 제외한다.

## 기존 도구 검증 결과

- clean-engine-caches.ps1 preview: shell 종료 0이나 report status blocked. codex-0160-rust-target 후보가 cargo.exe(54624), rustc.exe 실행으로 차단. engine/codex-rs/target는 현재 캐시로 보존. [engine-preview.json](engine-preview.json).
- module/staging preview: 종료 0. module 3개와 legacy staging 9개 preserved. compiler 실행 때문에 미사용 여부만으로 선택되지 않았다. [module-preview.json](module-preview.json).
- clean-legacy-releases.ps1 preview: 종료 0, preview, errors 없음. root release 5개 모두 보존(활성/보호 참조 또는 ownership 불명). receipt: artifacts/logs/legacy-release-cleanup/audit-20261013-2315.json.
- clean-verification-artifacts.ps1 preview: 종료 0, preview, errors 없음. 79개 모두 retained; 대다수 unknown/incomplete이며 진단 완료 여부를 조사 없이 가정하지 않았다. [verification-preview.json](verification-preview.json).
- [process-references.json](process-references.json)은 executable/command에 보이는 artifacts 경로만 기록한다. 열린 파일·작업 디렉터리·환경 변수의 전체 사용 여부를 보증하지 않는다.
- build-module-cache.ps1의 실제 삭제 branch에는 Remove-Item -Force가 존재한다. 이번에는 Preview만 호출했고 삭제하지 않았다. 향후 실행은 사용자 지침의 일반 삭제 규칙을 준수해야 한다.

추천 실행 순서: 빌드 종료 후 232.48GB 대체 Cargo 캐시 재검사 → 해당 캐시 정리 → 복제 작업/모듈 캐시 key별 보호 조건 검토 → stage와 로그 내 대형 복사본의 작업 종료 확인. 현재 조사만으로 즉시 안전 삭제를 보증하는 총량은 제시하지 않는다.

## 승인된 부분 정리의 현재 실행 상태

2026-10-14 사용자 요청으로 `debug/incremental`에 한해 일반 PowerShell 삭제가 승인됨. 기존 `clean-engine-caches.ps1` 미리보기를 재실행했다. shell 종료 0이나 report는 `blocked`이며 해당 대체 Cargo 캐시가 cargo.exe(18216), rustc.exe(35760) 실행으로 차단되었다. 새 프로세스 조회에서도 두 컴파일러를 확인했다. 보호 검사를 우회하지 않고 삭제를 보류했다. `incremental`과 형제 `deps`, `build`가 존재함을 확인했으며 확보 용량은 0이다. 산출물: [engine-preview-20261014.json](engine-preview-20261014.json), [incremental-cleanup-20261014.json](incremental-cleanup-20261014.json). 다음 실행 조건은 컴파일 종료와 최신 미리보기/참조 검사 통과다. 사용자가 이미 승인한 부분 정리 권한은 유지하며 재승인 단계는 추가하지 않는다.

## 캐시 외 대용량 후보 추가 조사

2026-10-14 조사 권한만 추가됨. 배포·도구·UI·로그·rtp 및 복제 작업의 release/deployment/log 소유자를 순회하되 cache/target/node_modules/.git/incremental을 제외했다. 100MB 이상 파일 120개, 오류 0, 52초, 종료 0. 산출물 [large-noncache-files.json](large-noncache-files.json), [large-noncache-scan.log](large-noncache-scan.log). 디렉터리 합계는 직전 조사 결과를 재사용하며 현재 파일 존재 및 보호 정보와 대조했다. 이번 조사는 artifacts 범위이며 Desktop 전체 재조사는 아니다.

| 후보 | 파일 크기 합계 | 판단 |
|---|---:|---|
| root deployments의 보호 대상 외 package/stage 13곳 | 약 18.26GB | 구 패키징 중간 복사본. 최신 미리보기는 deploy-latest_20261008_r2 및 deploy-window_observation_recovery_20261008_r1/package를 보호한다. 나머지 13곳도 설치된 배포 stage, 진행 작업, 미해결 진단, 링크를 개별 확인한 후 선택해야 한다. deployment.json 등 영수증은 남긴다. |
| rtp/rtp11/rtp12/rtp13 | 약 7.82GB | 약 1.417GB의 펼쳐진 stage와 약 0.536GB VSIX씩. 현재 direct process 참조는 발견되지 않았으나 완료/롤백/후속 참조 확인이 필요하다. 네 VSIX SHA-256은 모두 다르므로 byte-identical 중복으로 분류하지 않는다. [rtp-package-hashes.json](rtp-package-hashes.json). |
| app-releases/2026.0.0, 2026.0.1, 2026.0.2, 2026.0.3 Windows ZIP | 약 3.28GB | 구버전 로컬 배포 원본. 후속 버전 2026.0.5 Windows asset도 존재한다. 게시/복구에 실제 필요한 asset과 원본 보존 정책을 결정한 뒤 삭제 여부를 정한다. 원격 재다운로드 가능성은 검증하지 않았다. |
| logs/codex-stable-source-update/ui-full-source-v1 | 약 1.416GB | bin/out/resources/webview 등을 갖춘 펼쳐진 UI 복사본. 현재 과정에서 코드·문서 직접 경로 참조를 발견하지 못했지만 출처·회귀 입력 의존이 없음을 추가 확인하고 compact evidence를 보존한 후 정리한다. |
| tools/clang+llvm-23.1.1-x86_64-pc-windows-msvc.tar.xz | 0.901GB | 같은 이름의 추출 디렉터리 약 4.278GB도 존재한다. 추출 완전성과 offline 재설치/출처 요구를 확인하면 압축 원본만 정리 검토 가능. 추출 도구 전체 삭제는 권고하지 않는다. |
| rusty-v8 toolchain의 rustc_driver PDB 두 위치 | 각 0.582GB | 두 SHA-256 동일. bin 경로 fsutil hardlink list에는 그 경로 하나만 출력되어 해당 파일의 다른 hardlink는 확인되지 않았다. 중복 내용이지만 toolchain inventory/디버깅 참조를 검증하지 않았으므로 별도 낮은 우선순위 검토 대상. [pdb-hashes.json](pdb-hashes.json). |

단일 큰 파일은 app-releases/2026.0.6-linux-x64/archive 1.184GB 및 releases/pr1-linux-20261012-r2/archive 1.178GB다. 크기가 다르고 현재 Linux 배포/입력 소유권이 있으므로 중복 삭제 대상으로 확정하지 않는다. 현재/직전 Linux/Mac asset도 OS별 복구 요구가 별도여서 Windows 구버전과 같은 기준으로 정리하지 않는다.

현재 프로세스 summary는 w13b/w6a/wb1/w14p/releases/logs뿐 아니라 rt6도 참조함을 확인했다. 이전 snapshot과 달리 rt6가 새로 포함되어 부모 전체 정리 대상에서 제외한다. [noncache-process-summary.json](noncache-process-summary.json). 현재 레거시 release preview의 root release 5개는 모두 preserved이고 오류 없음, 종료 0. artifacts/logs/legacy-release-cleanup/noncache-audit-20261014.json. manual-integrated_latest_20261007_r3의 stage를 기존 fixture cleaner로 개별 preview한 결과 종료 0, 오류 없음이나 `retained / Active command path: 38268`이었다([old-stage-preview.json](old-stage-preview.json)). 실행 인수 자체가 검사 대상 경로를 포함하는 영향과 실제 consumer를 분리하지 못했으므로 이 결과를 설치 중이라는 증명 또는 삭제 가능 근거로 사용하지 않는다. 13곳을 바로 지울 수 있다고 보고하지 않는다.

이전 logs/ui-pipeline-optimization/validation 1.36GB 후보는 current-cache 및 cold/warm 검증 캐시가 섞여 있어 이번 캐시 외 후보 합계에서 제외한다. 설치 보호 경로를 제외한 stage도 즉시 삭제 가능한 총량으로 해석하지 않는다. 실제 삭제는 수행하지 않았고 승인된 incremental 삭제의 보류 상태를 변경하지 않았다.

## 전체 프로젝트 용량과 정리 범위 재평가

사용자가 전체 약 700GB 대비 정리 여지가 더 있는지 질문하여 engine의 현재 target을 추가 조사했다. 조사 권한이며 삭제 권한 확대가 아니다. 2026-10-14 Windows에서 engine/codex-rs/target을 집계: 19초, 오류 0, 종료 0. [engine-target-sizes.json](engine-target-sizes.json), [engine-target-scan.log](engine-target-scan.log).

- 현재 engine target 합계 약 290.57GB: debug 225.83GB(그중 incremental 153.84GB, deps 66.19GB), x86_64-pc-windows-msvc 63.36GB(그중 debug 62.56GB), release 1.38GB.
- 이전 조사 레거시 artifacts/build/codex-0160-rust-target 232.48GB와 합쳐 재생성 가능한 두 Cargo target의 논리 파일 크기가 약 523.05GB다. 사용 중인 primary cache 290.57GB는 레거시로 분류하지 않으며 기존 cleaner가 보호한다. 전체 삭제는 이번 승인 밖이며 재컴파일 시간과 외부 입력/오프라인 가용성 비용을 고려해야 한다.
- 레거시 incremental 121.09GB(기승인)와 primary debug/incremental 153.84GB(미승인)를 합치면 약 274.93GB지만 primary incremental은 현재 사용 여부·빌드 종료 조건과 별도 실행 범위 결정이 필요하다.
- 프로세스 조회에서 cargo.exe(7892), rustc.exe(58440)가 실행 중이었다. 열린 파일·환경·cache lock의 전체 사용 여부는 확인하지 않았고 삭제하지 않았다.
- 캐시 외 30GB대 목록은 전체 정리 상한이 아니라 좁은 추가 조사 결과였다. named 복제 작업 폴더(w*, a4*, rt6, p4/p5 등)는 직전 집계 약 78.44GB이지만 runtime/source/cache가 섞이고 실행 참조가 있으므로 전체 삭제 후보로 합산하지 않는다.
- 추천 범위 판단: 빌드 종료 뒤 기승인 레거시 incremental → 원하면 미사용 legacy target 전체로 범위를 확대하여 232.48GB 정리 → primary incremental까지 필요할 때만 비용과 사용 조건을 검토. primary 전체를 레거시 cleaner로 보호 우회하지 않는다. 숫자는 서로 포함되는 구성 요소가 있으므로 중복 합산하지 않고 실제 확보량으로 보증하지 않는다.


## 2026-10-15 현재 프로젝트 전체 재조사 (이번 추천의 기준)

상태: 후보 선별 완료. 이번 요청의 권한은 조사·후보 제시이며 삭제하지 않았다. 이전 수치는 당시 기록으로만 유지하며 아래 현재 측정값이 우선한다. 대상은 현재 Windows 로컬 체크아웃이며 원격·다른 OS·사용자 홈은 조사하지 않았다. 제품 동작·설계 변경은 없다.

전체 집계는 301.2초, 5,146,908 files, exit 0, 접근 오류 0. 최초 시도는 오래된 패키지의 긴 경로에서 exit 1로 중단되어 용량 근거로 사용하지 않았다. Windows 긴 경로와 재분석 지점 제외를 적용해 다시 측정했다. 파일 논리 크기 합계 약 749.853GiB이며 압축·희소 파일·하드링크에 따른 실제 디스크 확보량은 별도다. 실행 중 생성물의 변화가 가능하므로 원자적 스냅샷이 아니다. [현재 크기 원본](current-sizes-20261015.json)에 depth 5까지 집계를 보존했다.

| 추천 순서 / 분류 | 프로젝트 기준 경로 | 현재 GiB | 판단 및 삭제 전 조건 |
|---|---|---:|---|
| 우선 검토 | artifacts/rtp, rtp11, rtp12, rtp13 | 7.278 | 패키징 stage와 VSIX. 현재 프로세스 인수의 직접 참조는 발견되지 않았지만 완료·복구·후속 입력 참조 확인 필요. 기존 조사에서 VSIX 해시는 서로 달랐으므로 동일 파일 중복으로 부르지 않는다. |
| 우선 검토 | artifacts/deployments/*/package/stage-* (15곳) | 19.794 | 전체 stage 용량. 현재/직전 설치·진행 작업 보호분을 빼기 전 후보 풀이다. deployment.json·결과·출처 영수증 보존, stage별 기존 cleaner preview 필수. |
| 우선 검토 | artifacts/logs/codex-stable-source-update/ui-full-source-v1 | 1.319 | 로그 안에 남은 펼쳐진 UI 복사본. 출처/검사 입력 의존과 진단 종료 확인 후 간결한 결과만 보존. |
| 우선 검토 | artifacts/logs/ui-pipeline-optimization/validation | 1.266 | 검증 복사본·cold/warm 캐시 혼재. 전체 로그 일괄 삭제 대신 완료 fixture/cache별 선별. |
| 우선 검토 | artifacts/build/cua-repair-1004-154621-source 및 cua-repair-1004-154109-source | 2.764 | 과거 빌드용 소스 복사본. 재사용·미해결 재현·원본 유일성 확인 전에는 제거 확정 아님. |
| 재생성 가능 캐시 | artifacts/cache/modules, ui-test-transform, namespace | 1.639 | 현재 입력 key·실행 lease·설치 도구 참조를 제외한 미사용 key만 정리. |
| 승인 후 삭제 완료 | artifacts/app-releases/2026.0.0, 2026.0.1, 2026.0.2, 2026.0.3의 Windows ZIP | 3.056 삭제 | ZIP 4개 부재 확인. manifest·SHA256SUMS·소형 영수증은 보존. |
| 다운로드 압축본 검토 | artifacts/tools/clang+llvm-23.1.1-x86_64-pc-windows-msvc.tar.xz | 0.839 | 추출 디렉터리 3.984GiB 존재. 추출 완전성·재설치/오프라인 복구 요구 확인 후 압축본만 검토. |
| 큰 추가 후보 풀 | artifacts의 named 복제 작업 폴더 42곳 | 160.071 | source/runtime/cache/deployment가 섞임. 부모 전체 삭제 확정 아님. w26a 13.001, w29a 10.192, w18a 9.160, w27a 7.823, w25a 7.770GiB를 우선 소유권 검토. 프로세스 직접 참조가 없다는 사실만으로 안전성을 확정하지 않음. |
| 별도 비용 결정 | engine/codex-rs/target/debug/incremental | 146.160 | 현재 캐시의 일부이며 레거시가 아님. 컴파일 종료·사용/잠금·warm 검증 보호 확인 후 범위를 정해야 한다. 삭제하면 재컴파일 비용 발생. |

기본 Rust target 전체는 449.478GiB: debug 215.860GiB, x86_64-pc-windows-msvc 232.337GiB 등이다. 전체 캐시와 incremental을 중복 합산하지 않는다. artifacts는 298.151GiB, 그중 logs는 8.186GiB다. logs/tasklogs 루트에는 이번 조회에서 일반 파일이 없었다. 로그 공간 대부분은 artifacts 쪽 조사 대상이다.

### 보존 및 불확실성

- 이전 232GB 후보 artifacts/build/codex-0160-rust-target은 현재 부재다. 해당 경로와 하위 incremental에 대한 과거 예상 확보량은 현재 후보에서 제외한다. 삭제 주체·시점은 이번 조사로 확정하지 않았다.
- 기본 engine target은 기존 cleaner에서 preserved-current-or-newer. 최신 preview exit 0, status preview, errors 없음. [preview](engine-preview-20261015.json). 이 결과는 다른 후보의 삭제 가능성을 보증하지 않는다.
- 프로세스 snapshot에서 artifacts/w14w, w6a, wb1, rt6 및 releases/verification에 직접 참조가 확인돼 해당 부모 전체 정리를 보류한다. 열린 파일·환경 변수·작업 디렉터리 전체 사용 여부는 확인하지 않았다. 조사 초기에 cargo test 실행도 확인했다. 삭제 직전에 새 확인이 필요하다.
- artifacts/verification/AK-02-api-context-fix/target은 41.089GiB. 기존 미완료 작업/재현 소유권이 있어 일반 레거시 후보에서 제외한다. artifacts/verification 전체 45.633GiB도 일괄 삭제 대상으로 권고하지 않는다.
- artifacts/build/window-control-native 1.422GiB, tools, upstream-ui, source-snapshots, 현재/직전 설치본 및 사용자 상태는 보존한다. 복제 폴더 안에도 같은 보호 규칙이 적용된다.
- 위 후보들은 조건부 검토 목록이다. 보호분을 빼기 전 합계를 즉시 확보 가능한 용량으로 제시하지 않는다. 소스/미커밋 변경/기존 작업 결과는 수정·삭제하지 않았다. 이번 작업은 기존 본 계획의 현재 결과와 소형 조사 JSON만 갱신했다.


## 승인된 구 배포 ZIP 정리 결과

사용자의 “구배포본 삭제” 지시에 따라 앞서 제시한 Windows 2026.0.0~2026.0.3의 배포 ZIP 네 개만 삭제했다. 현재 등록 확장 2026.0.7의 runtime(w14w/w14y), 별도 설치 2026.0.4·2026.0.5 및 소형 버전/해시/검증 영수증은 보존했다. 이번 권한은 다른 생성물·캐시·Linux/Mac 배포본으로 확대하지 않았다.

각 파일을 manifest의 제품·버전·파일명·크기·SHA-256과 대조하고, 절대 경계·연결 경로·최신 프로세스 직접 참조를 확인한 뒤 같은 PowerShell 세션의 일반 Remove-Item -LiteralPath로 삭제했다. 강제 옵션·재귀 삭제·속성 변경은 사용하지 않았다. preflight, 적용, 최종 확인 모두 exit 0. 4개 부재, manifest 및 SHA256SUMS 존재, 현재 runtime 및 별도 설치 폴더 존재를 확인했다. 파일 크기 합계 3,281,044,733 bytes(3.056GiB, 약 3.28GB)를 제거했다. 실제 디스크 여유 공간 변화는 동시 작업 영향을 분리해 측정하지 않았다. 제품 소스·동작·설계 변경과 빌드/테스트/설치/원격 삭제는 수행하지 않았다.

항목별 경로·해시·결과: [정리 영수증](old-app-assets-cleanup-20261015.json). 다른 후보는 기존 보존 조건을 유지한다.

## 승인된 로그 전체 정리
사용자가 구버전 로그를 포함한 프로젝트 로그 전체 삭제를 지시했다. 현재 Windows 체크아웃의 생성 로그 폴더 및 .log 파일을 대상으로 하며 Git 내부 기록과 사용자 홈 상태는 제외한다. root가 실행 참조·관리 경계·링크를 확인하고 일반 PowerShell 삭제 후 잔여 경로를 검증한다. 기존 소형 검증 로그/영수증 보존 방침은 이번 로그 삭제 지시 범위에서 해제하되, 로그 바깥의 설치 runtime·소스·배포본은 보존한다. 결과는 log-cleanup-result-20261015.json에 기록한다.


### 로그 정리 최종 확인

이번 로그 삭제 지시는 기록 보존 예외까지 포함해 진행했다. 로그 디렉터리 85곳과 폴더 밖 .log 3788개를 제거했고, 연결 경로 10개는 링크 자체만 제거한 것을 확인했다. 원래 선택과 잔여 파일의 논리 크기 차이는 595063687 bytes(약 0.554GiB)다. 실제 여유 공간 변화는 동시 작업 영향을 분리해 측정하지 않았다.

남은 경로는 artifacts/logs, artifacts/rt6/artifacts/logs, artifacts/verification/heretic2-api-20261013/profile/logs다. 테스트 fixture의 Hidden/ReadOnly 속성과 다른 프로세스가 점유한 agentSessionsOutput.log가 일반 삭제를 막았다. 속성 변경과 재귀 삭제를 결합한 명령은 automatic approval review가 blocked by policy로 거부했고, 범위를 일반 파일 개별 삭제 및 빈 폴더 제거로 줄인 명령도 같은 사유로 거부했다. 두 명령은 실행되지 않았으며 속성을 변경하지 않았다. 구체적 정책 사유는 제공되지 않았다. 다른 셸/API·인코딩·별도 스크립트로 재시도하지 않는다.

처음 실행한 소유 정리 셸은 파일별 WMI 반복 비용을 줄이기 위해 종료(exit -1)하고 잔여 경로를 확인한 후, snapshot 조회를 공유하는 방식으로 재개했다. 재개 명령 exit 0은 작업 전체 성공을 뜻하지 않으며 receipt status partial이다. 최종 읽기 전용 검증 exit 0, 접근 오류 0. 현재 설치 runtime, artifacts/build, artifacts/upstream-ui 존재를 확인했다. .git 내부 기록과 사용자 홈 상태는 정리하지 않았다. 세부 결과는 [로그 정리 영수증](log-cleanup-result-20261015.json)에 보존한다. 전체 삭제 완료로 보고하지 않는다.

상태: Windows x64 2026.0.14 빌드·격리 인수·일반 VS Code 프로필 설치와 설치 후 자동 확인 통과. 창 다시 로드 및 정상 사용 확인 대기, 복구 백업 정리 보류. 기존 archive 이동은81개 묶음·193개 경로에서 완료했으며, 현재 사용·예약·종료 미확인·소유권 불명확 자료는 원래 위치에 보존했다. 보호 항목을 포함한 전체 정리 완료로 표시하지 않는다.

## 현재 산출물과 정리 범위

- 실제 설치 후속 실행: `run:EU01-install-014:install-bf`, 도구 완료 신호 `fcca079f-2a77-45b2-b355-6dd308b55b2d`. `scripts/install-azrael.ps1`에 exact release/package를 전달한다. 검증 완료 VSIX를 재생성하지 않는다. 현재 계정·세션·환경을 유지하기 위해 `-SkipCodexEnvironmentSnapshot`을 선택하고 `.azrael-ex/config.toml` 전후 SHA256을 기록한다. 사용자 창을 닫거나 reload하지 않으며 installer의 기본 pin/shortcut/protocol 갱신을 적용한다. 실제 종료 코드와 보존 결과는 `artifacts/tasks/EU01-install-014/runs/install-bf/result.json`을 따른다. registry/shortcut 복구 파일은 정상 동작 확인까지 유지하고 최신 사용자 지시에 따라 이후 archive로 옮긴다. 실행 중인 과거 release는 보존한다.
- 실제 설치 종료0, 후속 ordinary inventory `azrael-ex-local.azrael@2026.0.14` 및 원본 `openai.chatgpt@26.1021.22027` 확인0. 설치 manifest2026.0.14/integrated account marker/pinned:true 확인. 원본 Codex·다른 확장·VS Code settings·Azrael config SHA 보존. 실제 profile runtime의 reload·로그인·모델 요청은 수행하지 않았고 사용자 확인 대기다.
- 설치 영수증: `artifacts/deployments/independent-20261101-194615-298/deployment.json`, 상태 `installed-reload-required`. shortcutUpdated:true, Launched:false, session protocol registered. 해당 `session-protocol/`은 현재 URI launcher가 참조하는 활성 설치 자료이므로 이동하지 않는다. nested final version은 `work:EU01-installed014-reference`의 installation 참조로 보호했다.
- 사용자 확인·복구 묶음: `work:EU01-install-014:install-bf-recovery`, 위 설치 폴더의 `extensions-before.json`3,940 bytes와 `previous-azrael-shortcut.lnk`1,367 bytes, 합계5,307 bytes. registry·바로가기 복구용이다. 사용자에게 정상 동작 확인 대기와 정확한 묶음을 안내했다. 명확한 정상 확인 뒤 보호를 재검토하고 최신 archive 지시에 따라 이 두 백업을 이동한다. 과거2026.0.13 실제 설치 및 그 release/protocol은 실행·복구 참조가 해제될 때까지 보존한다.

- 최종 VSIX: `artifacts/u14t/artifacts/deployments/deploy-win014-eu01-20261101-aw-product/package/azrael-host.vsix`. 709,114,626 bytes, SHA256 `c3789bbf371937cc1da2e41745b5a0d585d7a9d21b27b36a1cfa28a11de3d042`.
- 최종 acceptance-bd의 inventory/install/finalInventory/coexistence host/standalone host 실제 종료 코드 모두0. 필수 native 7개 invocation과 최종 고정 입력 재검증 통과. Windows x64 검증이며 다른 OS의 native 인수나 실제 로그인·모델 요청을 뜻하지 않는다.
- 독립 검증 보고서: `artifacts/u14t/artifacts/releases/win014-eu01-20261101-aw-product/build-acceptance.json`. 필요한 검증·종료·복구 증거는 같은 working의 `artifacts/logs/verification-evidence/deploy-win014-eu01-20261101-aw-product/`에 보존한다.
- 삭제 중단 증거: 위 verification-evidence의 `cleanup/archive-transition-stop-result.json`. 삭제 coordinator 실제 -1, 마지막 등록 child 실제0, 남은 해당 프로세스 없음. 기존 삭제 실패·중단을 성공으로 바꾸지 않는다. `cleanup-be/archive-only.json`으로 과거 삭제 runner를 비활성화했다.
- 사용자가 남은 자료의 `archive/` 보존을 명시했다. 대상은 비활성·소유권 확인된 임시 자료이며 현재 제품·공유 cache·현재 immutable014ao·EW01 소비 입력은 제외한다. 목적지는 `archive/EU01-install-014-20261101/`; 별도 maintenance storage root에서 원래 owner와 실패 결과를 유지한다. 새 archive 삭제 요청 전까지 보존한다.
- 이동 계획과 실제 결과의 소유 문서: 목적지의 `artifacts/control/EU01-install-014/mapping.json`, `result.json`. 원본 provenance alias와 필요한 종료 증거를 유지하며 primary의 `artifacts/tasks/EU01-install-014/archive-handoff.json`에서 새 위치를 연결한다. 같은 드라이브 rename이므로 디스크 공간 회수로 보고하지 않는다. 전환 전에 이미 삭제된 자료는 archive에 포함되지 않는다.
- 실제 archive producer 종료0, 81개 묶음·193개 경로의 dev/ino/birthtime 식별자와 원래 owner/state/outcome을 모두 확인했다. 58개 종료 증거 파일과 4개 과거 관리 설정은 원래 위치에도 남겨 관리·복구 기록을 유지한다. `verification.json`이 대조 결과를 소유한다. 최종 VSIX SHA256 재확인 일치; final version lifecycle은 complete/membership_complete:true로 닫았다.
- 보호 예외: 현재 u14t source·ao fixtures·immutable014ao·freeze-resume-ao(EW01 소비); acceptance-ba의 미확정 lifecycle과 그 입력 acceptance-az; active cleanup reservation이 남은 freeze-readonly-ac; 중단 삭제 기록 cleanup-be; 외부/불명확 e/z가 포함된 readonly-handoff-ab; wu14h의 metadata 증거 controller. 이들은 이동·삭제하지 않았다. 현재 입력은 해당 소비 종료 후, 예약은 지원 owner가 해제한 뒤, 미확정 lifecycle은 exact producer 종료·소유권을 확인한 뒤 다시 검토한다. 세 과거 verification group은 이미 payload가 없어 이동 대상으로 세지 않았다.

# Cargo 컴파일 시간 단축

## 목표와 범위
사용자는 Rust Cargo 컴파일 시간 단축을 요청했고, 비교용 반복 빌드 없이 단일 재측정과 V8 소스 빌드를 승인했다. Windows 실행 경계 수정과 실제 release 컴파일을 마쳤다. 기존 세션 잠금 해제 보류, 설치·배포·공유 캐시 초기화 제외는 유지한다. 이후 사용자 archive 요청으로 현재 작업의 삭제 실행기만 종료했다. 설치 엔진·사용자 세션 프로세스는 종료하지 않았다.

## 확정된 결정
release 최적화와 필수 검증은 유지한다. 기존 stable compilation source와 고정한 동일 제품 소스로 단일 컴파일을 측정했다. Cargo.lock 갱신은 허용됐으나 불필요함을 확인해 변경하지 않았다. 사용자는 V8 소스 빌드를 선택했고 잠금/예약 보호를 유지한 archive 전환을 요청했다. 비교용 반복 빌드, LTO·codegen-units·incremental 변경은 수행하지 않았다.

## 확인된 사실
- 과거 .13 Cargo 2960.765초, local crate 121개 Compiling, 외부 dependency Compiling 0, lock wait 0. 과거 crate별 dirty 원인은 trace가 없어 확정하지 않는다.
- 동일 바이트 새 source 사본의 mtime에 따른 stale/dirty는 기존 EC-01 실험에서 재현됐으나 제품 49분의 실제 절감률은 미측정이다.
- 현재 build-azrael.ps1은 shared owner와 AZRAEL_CARGO_STABLE_SOURCE=1을 사용한다. cargo-stable-source.cjs는 변경 없는 파일을 다시 쓰지 않아 identity/mtime을 유지한다. 환경/경로 미지원이면 frozen source로 fallback한다. 이미 구현된 기능을 중복 개발하지 않는다.
- explicit legacy target은 frozen source를 유지한다. 실제 cache 선택·stable 모드·fallback 원인은 run 영수증에서 확인해야 한다.
- release 설정은 thin LTO, codegen-units=4, line-tables-only다. 설정은 변경하지 않았다.
- 관련 helper에 기존 미커밋 변경이 있으므로 보존하고 수정 범위를 분리해야 한다.

## 실행 순서와 검증
1. source/provenance·현재 도구·선택 cache·실행 중 producer 및 CPU/RAM/디스크를 확인하고 입력을 고정한다. 활성/불명확한 lease는 건드리지 않는다.
2. Cargo 공식 --timings와 fingerprint trace로 crate별 시간·재사용·병목·동시성을 측정한다. 기존 owner를 통해 물리 target당 한 producer만 실행한다.
3. 동일 입력 반복 build에서 unchanged source 유지와 불필요한 local 재컴파일 유무를 확인한다. 한정 변경 비교가 필요하면 입력과 후속 산출물 범위를 먼저 확정한다.
4. 실제 결과에 따라 cache 경로·fallback·환경 차이부터 수정한다. profile 변경은 별도 결정이다.
5. 변경 owner의 최소 회귀와 provenance·변조 거절을 검증한다. Cargo 실제 exit, 전체 wall time, 준비/검증 시간, warm 여부와 compiler unit/fresh를 구분한다. 측정하지 않은 절감률을 주장하지 않는다.

## 플랫폼과 완료 기준
공통 cache/provenance 의미는 Windows x64/Linux x64/macOS ARM64를 보존한다. 우선 실측은 Windows x64 MSVC이며 다른 OS 수용으로 확대하지 않는다. runtime 동작·same-source host 규격·검증·storage 보호를 유지한다. 동일 입력/환경의 비교로 개선을 입증하고 일회성 산출물은 기존 owner 절차로 정리한다. 제품 빌드·설치는 아직 실행하지 않았다.

## 근거
- work/EC-01-unused-file-archive/04-plan.md: 과거 빌드 시간·캐시 조사·stable source 구현 검증
- scripts/build-azrael.ps1, scripts/cargo-target-owner.cjs, scripts/cargo-shared-cache.cjs, scripts/cargo-stable-source.cjs
- engine/codex-rs/Cargo.toml: profile.release
- https://doc.rust-lang.org/cargo/reference/timings.html
- https://doc.rust-lang.org/cargo/reference/profiles.html

## 확정된 실행 범위
Windows x64 release 엔진·bridge·same-source code-mode host를 한 번만 컴파일한다. 반복 비교·설치·패키징·profile 변경은 수행하지 않는다. 기존 primary shared cache에는 debug만 있으며 이번 release는 warm release 측정이 아니다. 기존 e/artifacts/h Cargo registry cache는 재사용한다. 입력은 소스와 실행 scripts의 독립 사본으로 고정하고, 오래된 SOURCE.json의 delta는 그 사본에서만 기존 recorder로 갱신한다. 원본 SOURCE.json과 Git index는 변경하지 않는다. 공유 cache는 향후 반복 빌드용 기존 owner에 남기고 일회성 입력·로그는 결과 추출 후 정리한다. 보고는 재측정 시간 위주로 제한한다.


## 실제 결과
준비 m1은 snapshot --file 인자 누락, m2는 고정 scripts의 maintenance owner 설치 경로 누락으로 Cargo 실행 전 종료했다. 같은 고정 source/scripts를 execution 참조로 재사용해 준비를 보정했다. m3의 Cargo 호출은 단 한 번이며 245275.525ms(약4분5초) 후 exit101로 종료했다. stable source 준비196820.074ms와 종료 source 검증29828.589ms가 상위 시간에 포함된다. Cargo.lock 갱신 필요와 --locked 충돌이 직접 오류이며 Compiling 행0/Finished 행0이다. 이 값을 Rust 컴파일 시간이나 성능 개선 실측으로 사용하지 않는다. --locked를 제거하거나 profile/소스를 바꾸거나 비교·재빌드를 하지 않았다. primary SOURCE.json/index/설치/프로세스는 변경하지 않았다. 독립 결과는 cargo-single-measurement.json, 준비 실패는 cargo-measurement-preparation-failure.json 및 cargo-measurement-owner-preparation-failure.json에 보존한다. shared cache source는 기존 cache owner의 향후 빌드 준비물이며 일회성 m1/m2/m3는 native registered review/apply/finalize로 정리한다.


## 정리 결과
검증된 standalone owner의 register3회/review/apply는 모두 실제 exit0이다. 임시 자료3그룹 합계115,167,451bytes는 모두 deleted/remaining=false, 실제 부재와 지원 lifecycle finalize를 확인했다. 빈 상위 디렉터리·측정/정리 controller·요청 JSON도 일반 삭제 후 부재를 확인했다. 해당 run lifecycle 잔여0이다. 독립 최소 결과와 정리 영수증은 work에 유지한다. 기존 shared Cargo cache는 기존 owner로 유지하며 삭제·초기화하지 않았다. 제품 소스/빌드 로직 변경이 없어 새 코드 commit은 없고 기존 staged 변경은 그대로 유지했다. 원래 컴파일 단축 목표는 달성하지 못했으며 재측정 실패로 보고한다.


## 갱신 승인 후 확인된 원인과 실행 범위
사용자는 Cargo.lock 갱신을 허용했고, 이후 기존 host 재사용 대신 V8 소스 빌드부터 진행하도록 명시했다. metadata full/no-default-features/Windows target 조회도 기존 Cargo.lock SHA256 ddae2e76bff1b29cf223c4c74563e864d7173d20900b51c59213e96d69e858f9 그대로이며 변경0이다. 고정 소스의 일반 cwd에서는 --locked --offline metadata actual0, 동일 소스의 Windows 확장 namespace cwd에서는 actual101/동일 오류가 재현됐다. 따라서 잠금파일 노후화가 원인이라는 초기 해석은 철회한다. 필요 없는 의존성 갱신은 하지 않는다.

scripts/cargo-target-owner.cjs에서 MAX_PATH 미만 cwd의 일반 표기를 유지하고 긴 cwd만 기존 namespace를 적용하도록 Windows 실행 경계를 보정한다. 기존 real offline stable-source 회귀에 실제 local path dependency를 추가해 --locked 성공·두 번째 Fresh를 함께 확인한다. source·target/provenance·긴 경로·검증 기준은 유지한다. 이 변경은 Windows 실행 방식이며 Linux/macOS는 기존 일반 cwd를 유지한다.

V8 150.4.0 공식 release API에는 Windows MSVC asset8개가 있으나 sandbox lib/binding 자산은0이다. 같은 소스 code-mode-runtime은 v8_enable_sandbox를 요구하므로 기능을 끄지 않는다. sourcebuild 준비/컴파일 시간과 Azrael Cargo 시간을 구분한다. V8 사전조건은 v8_source_readiness agent가 읽기 전용으로 조사하고 root는 Cargo 호출부·회귀·통합·측정/정리를 담당한다. 제품 설치·배포·최적화 profile 변경·비교용 반복 전체빌드는 제외한다. 기존 tools payload는 준비 근거를 확인해 재사용하며 새 output/cache는 현재 owner로 생성 전에 등록한다.


## V8 준비 및 다음 실행 조건
Cargo stable-source 회귀6/6, actual0(20.342초)이며 local path dependency를 가진 실제 --locked build 및 두 번째 Fresh를 포함한다. 고정 scripts의 owner/test SHA는 이 회귀의 현재 파일과 같다. feature inventory는 기존 engine.shared-engine의 owners 및 recurring check를 그대로 연결한다.

소스·scripts 고정 source-v8는 actual0/검증 완료이며 primary lock SHA는 그대로다. V8 준비용 기존 rustc 1.96-nightly Chromium/LLVM23, Python3.13.15, VS18 실제 버전 조회가0이었다. 기존 LLVM19는 실행 가능하지만 설치된 MSVC14.51 STL은 Clang20 이상을 요구한다. 따라서 기존 libclang23을 실제 load/version 검사하고 공식 V8가 지정한 Chromium clang을 사용한다. 최초 V8 준비는 공식36,296,166byte crate checksum 검증/추출35.913초, pinned Rust toolchain 재사용50.792초, GN/Ninja2.967초, Chromium clang10.275초 후 clang.exe가 아닌 Windows clang-cl.exe 실행명 차이에서 중단했다. Cargo/CPP는 실행 전이었다. 이 입력·도구를 재다운로드/재추출하지 않고 v2가 execution 참조로 재사용한다.

v2 outputs는 tool-specific Windows 출력 길이를 줄이기 위해 artifacts/cache/v8-t1로 미리 소유하고 generated/protection_known을 기존 writer로 명시했다. V8 sandbox/정적CRT/release 의미를 유지한 네이티브 source build와 실제 version API 링크 검사가0일 때만 library·생성 bindings를 작은 재사용 dependency version으로 승격한다. 그 입력이 준비된 뒤 단일 Azrael engine/bridge/same-source host Cargo 컴파일을 실행한다. 두 무거운 컴파일은 메모리와 의존 관계상 직렬이다. raw V8 source/tool/target는 최종 소비 후 정리하고 최소 재사용 library/bindings/독립 출처만 보존한다. V8 source build 시간은 기존49분의 동일 조건 비교값으로 표시하지 않는다.

v2 Cargo는 63.277초/actual101이며 Ninja가 필수 Rust build.rs를 찾지 못했다. 해당 파일은 stat으로 실제 존재(28,266bytes)를 확인했고 GN cwd+상대경로 원문은269자다. Windows Ninja 경로 제한이 유력하므로 v3는 source도 artifacts/cache/v8-s2/v8, output도 artifacts/cache/v8-t2에 소유 등록해 경로를 줄인다. 기존 공식 source/tool을 content-verified copy로 재사용하며 source/feature/profile은 변경하지 않는다. v2 실패 결과는 v8-source-v2-failure.json에 독립 보존하고 source-v8 고정 제품 입력은 그대로다. v3 완료 이후에만 후속 Cargo producer 및 폐기물 owner 정리를 실행한다.
v3는 이전 build.rs 경로 오류를 통과한 뒤 Cargo79.826초/actual101로 ICU common/icudtl.dat 누락에서 중단했다. 공식 crate Cargo.toml의 exclude에 해당 파일이 명시돼 있다. V8 DEPS의 ICU revision ee5f27adc28bd3f15b2c293f726d14d2e336cbd5에 대해 공식 Gitiles common 디렉터리 blob을 조회했고 기존10,822,192byte 파일의 Git blob d1a12cb93065157498a11ff5f4b9a6501ee22506 및 SHA256 1cf67874b5a87a8363a86fb3f81e3cbbed54d389062dab8fb52308d5cf8c8612 일치를 확인했다(v8-icu-identity.json). v4는 실제 실패 종료 확인 뒤 v3에 execution 참조를 걸고 같은 owner의 짧은 source/target를 재사용하며 이 파일만 보충한다. v3의 failed outcome은 보존하고 새 실행 결과는 v4로 별도 기록한다. 원래 기존 tools는 읽기 전용 유지한다. 소비 후 두 그룹 모두 최신 실제 내용으로 native registration/review/apply한다. 비교용 반복 측정은 수행하지 않았고 선행조건 실패 시간은 성공 컴파일 시간에서 분리한다.
v4도 Ninja 선행 입력 확인에서 Rust vendor 누락으로 실패했다. 이후 컴파일 재시작 전 ninja -t inputs obj/rusty_v8.lib와 -t targets all을 대조했다. 전체7643입력/7621생성target 중 원본 누락812개는 모두 chromium_crates_io/vendor의45패키지다. 기존 tools에 전부 있으며 V8 DEPS가 고정한 Rust revision26e8ff47f18a8d28d6187a04b6a16cb7332356f8의 공식 Gitiles vendor tree와45/45 package tree SHA1이 일치했다. displaydoc update-readme.sh의 공식100755모드만 Windows 검산에서 반영했으며 원본 파일은 변경하지 않았다(v8-vendor-identity.json). v5가 source/target를 재사용하고 고정 tree 재검산·content-verified copy 후 Ninja 누락0을 필수 선행조건으로 검사한다. 실패 실행v3/v4의 결과는 그대로 유지하고 새 결과는v5로 별도 기록한다. 실제 C++ 컴파일/완료시간은 성공 여부 확인 전 확정하지 않는다.
v5의 실제 Cargo3282.331초는 Ninja2421/2421 및 obj/rusty_v8.lib 생성까지 완료한 뒤 bindgen의 max_align_t 헤더 오류로101이었다. libclang23 설치는 bin/bindings만 있고 builtin resource headers가 없다. 공식 V8 build.rs는 Linux에만 resource-dir 보정을 하므로 Windows에서는 BINDGEN_EXTRA_CLANG_ARGS=-resource-dir=<이미 사용한 동일 Chromium clang23/lib/clang/23>로 지정한다. v6는 이 환경만 바꾸고 v3 source/target의 완성된 네이티브 결과를 재사용한다. 성공 V8 결과에는 native Cargo 소요와 재개 소요를 각각 기록하며 둘을 합한 경과를 main 보고에 사용한다. 초기 입력 누락 실패들을 컴파일 성능 측정으로 표시하지 않는다. v5 실패 근거는 v8-source-v5-native-complete.json에 보존했다.
v6는 actual0으로 완료했다. V8 native Cargo3282.3307365초와 재개42.9123166초의 합계3325.2430531초(55분25초)이며, 재개에서 기존 native 결과를 사용하고 binding 생성/실제 링크 버전 조회15.0.245.2-rusty가0이었다. sandbox=true는 GN args로 확인했다. library225,795,284bytes/bindings41,559bytes와 SHA256을 독립 영수증에 기록했다. main consumer는 version:v8-source:150.4.0-win64-sandbox:EU01에 최소 library/bindings/독립 근거를 승격한 뒤, 고정 source/scripts와 기존 shared Cargo owner로 Windows release engine/bridge/same-source host 단일 Cargo를 시작했다(work_completion dd3a77d6-f94f-4b71-809f-5e275a07f709). 설치/배포/비교 재측정은 하지 않는다. Cargo 종료 후 raw V8/source/tool/run을 기존 native owner로 순차 정리한다.
## 재측정 결과와 사용자 지정 archive 전환
Windows release engine/bridge/same-source host 단일 Cargo는 actual0, Compiling970개, Finished53분15초다. 관리 호출3549.041초(59분9초)는 stable source 준비148.977초/종료 source검증196.453초 등을 포함하며, 별도 최초 source snapshot93.680초는 여기에 포함하지 않는다. unchanged9344/added0/changed0/removed0, source SHA7b9e772871c318bb9d4847ee44d2694fcbcf7015fda54191839e57a8ca4e9eb3이다. 바이너리3개 SHA는 cargo-source-v8-measurement.json에 기록했다. V8는55분25초이며 별도 선행 빌드다. 성공실측은 이 조건의 값일 뿐 기존49분 대비 단축을 입증하지 않는다. Cargo.lock은 그대로며 native 제품 설치/배포는 하지 않았다. 회귀6/6의 owner/test SHA와 현재 파일이 일치한다. 기존 staged23개/다른 작업의 owner136줄 및 build문서32줄 변경, 기존 untracked stable 테스트가 혼재해 현재 작은 수정만 독립 task commit으로 분리하지 않았으며 기존 index는 보존했다.

사용자는 native 삭제가 오래 걸려 남은 자료를 archive/로 옮기도록 명시했다. 삭제 실행기20760과 자식 포함4개의 실제 프로세스 핸들을 고정하고 종료 signaled를 확인했다(eu01-archive-stop.json). 중단된 삭제는 성공으로 바꾸지 않는다. schema2 파일은 영속 OS lease여서 종료 때 잠금이 풀리며 삭제하지 않는다. 구형 sentinel recover_lock은 unsupported sentinel metadata로 거절돼 변경0이며 그 시도는 별도 영수증에 보존했다. source reservation은 공식 recover_reservation으로 정확한 owner/token/fence/SHA/종료증거를 검증해 해제했다. PowerShell 파일 실행 정책이 이동 스크립트를 거절했으나 정책 변경 없이 승인된 일반 Move-Item 명령으로 이동했다. 원본13개 payload root는 이미 삭제됐고 남은 마지막 V8 준비 root만 archive/EU01-cargo-time-20261101/v8-source로 이동, 원본 부재/목적지 존재를 확인했다(cargo-archive-move.json). 원래 해당 group 크기는2,984,187,554bytes였으나 중단 시점 일부 삭제 상태여서 실제 보관 크기는 전수 재측정하지 않는다. 사용자 요청에 따른 명시적 보관이며 자동 재삭제하지 않는다. 재사용 V8 version 및 기존 공유 Cargo cache는 계속 유지한다. 나머지10개 예약 복구와 작은 일회성 controller들의 같은 archive 보관을 마무리한다.

## 최종 정리 및 보관 확인
남은 현재 작업 삭제 예약0, 이미 삭제된10개 lifecycle은 지원 finalize로 실제 제거했다. 마지막 V8 source의 중단된 native 삭제 이력은 원래 outcome과 함께 보존한다. archive/EU01-cargo-time-20261101/v8-source 원본 부재/목적지 존재, controllers15개 합계87,029bytes는 전부 원본 부재/보관 bytes 일치를 확인했다. 이동 명령의 출력 합계 계산만 PowerShell hashtable 파이프 오류였으며 이동 영수증 재검증은 actual0이었다. native 삭제를 성공으로 바꾸거나 영속 OS lock 파일을 제거하지 않았다. archive는 사용자가 명시한 보관 예외이며 재삭제하지 않는다. 독립 최소 측정·회귀·보관·복구 영수증은 work에 유지한다. 이번 승인한 단일 재측정 및 archive 전환은 완료했고, 컴파일 단축 효과 검증은 미달성이다.

## 2026.0.14 빌드 및 사용자 프로필 설치
사용자가 최적화 검토를 종료하고 정확한 버전 2026.0.14 빌드·설치를 승인했다. Windows x64 MSVC 사용자 프로필 대상이며 release LTO/codegen 설정은 유지한다. 현재 소스 전체를 immutable input/working copy로 고정하고 기존 공유 Cargo 캐시와 측정 시 실제 소스 빌드한 code-mode host를 명시적으로 재사용한다. 호스트는 imported 출처로 기록하며 엔진/호스트 IPC, 변경 소스·기능 보존, exact VSIX fresh-state acceptance를 통과해야 설치한다. 원본 Codex·사용자 데이터·열린 창을 보존하고 설치 후 reload-required 상태로 인계한다. 새로운 최적화 구현은 포함하지 않는다. 생성물은 기존 lifecycle owner로 등록하고 불필요한 임시물은 설치 후 정리한다. 기존 타 작업 변경은 staging/commit하지 않는다.

## 2026.0.14 installation execution checkpoint
Windows x64 user-profile installation remains in progress. Immutable base input: artifacts/iu14b; derived script-delta input: artifacts/iu14h; execution project: artifacts/wu14h. The derived manifest is artifacts/tasks/EU01-install-014/runs/deploy-20261101-h/reports/deployment-inputs.json (SHA256 072ea4771b9a5085f92d447c1fde1a3729f138bf006106f30dec3e6261a47829). No release profile or Rust source bytes were changed for this installation. engine/SOURCE.json was reconciled by the official recorder against the verified original baseline.

The necessary build-only fix adds the already-reviewed ordinary-Win32-cwd helper SHA256 df3700e9b780cc6645a8bd700db6721f793014d07bfd0a1a420ac62397c4ae0a to scripts/cargo-verification-cache.cjs audit identities; unknown helpers still fail closed. Focused cache regression: 20/20, actual exit 0. Windows PTY preflight: 9/9, actual exit 0.

Preparation failures a-g preceded product compilation: stale source receipt, explicit maintenance-owner selection, engine feature mapping, reused fixture ownership, missing fixture assets/Bun, and the audit identity above. Attempt h source regression failed only on a missing pinned virtualized-turn-list fixture; attempt j failed three instruction publisher cases because the same persistent fixture root was reused. Both runners cancelled their owned build trees; their Cargo outcomes remain unknown/null, not success. Exact tree-stop census and supported lease recovery evidence are retained under runs i/j/k. No installed engine or user window was terminated.

Attempt k uses fresh per-attempt fixture roots under artifacts/wu14h/artifacts/sk and release win014-eu01-20261101-k. Its focused publisher probe, source fixtures, dependencies and 22 source-preflight invocation groups passed. The source regression group and build metrics/module-cache groups have actual exit 0; further source/native/package checks and the release compile remain active at this checkpoint. All 33 engine feature IDs are explicitly selected because the installed .13 source baseline is absent. The source-built compatible V8 host is imported with SHA256 f6574f97b200c637c5203805acef94801b842befb7d24aac10ca37aa98d15fc5; no V8 native rebuild is scheduled. Installation success and cleanup have not yet been established.


### Extension failure isolation and product-build separation
Attempt k source and build helper groups passed, but extension-changed returned actual 1 (258/261): three instructionService native staged-validation calls exceeded their 30-second process limit. The deploy runner consequently cancelled its build tree at 2026-10-31T19:01:39Z, preserving unknown Cargo outcome. A minimal isolated validator completed in 377 ms. Diagnostic m used the wrong fixture-parent location and diagnostic n had a tracing wrapper that interfered with promisified child_process return values; those diagnostic failures are not product evidence. The unmodified complete extension-changed group then passed 261/261 with actual exit 0 in 32,406 ms, without a competing product build (run extension-regression-o). This establishes successful isolated execution, not a definitive CPU/IO root cause.

The next product build is deliberately independent (run product-build-p, release win014-eu01-20261101-p-product), using the same frozen inputs and unchanged release profile. A copy of the already source-compatible validator will avoid using a mutable Cargo output during later tests. Supported EngineDirectory/SkipEngineBuild deployment will reuse only a completed, source-provenance-verified bundle; all mandatory source/native/VSIX/standalone/coexistence checks remain required before installation. This prevents a later source-test failure from cancelling the long compile again.


### Completed release Cargo and verifier correction
The p preparation stopped before compilation because its verification context omitted moduleCacheProjectRoot; no source identity actually changed. Run q supplied the complete manifest context and passed immutable verification. Its Cargo completed with actual exit 0 (19m17s compiler-reported; managed 1,316,223 ms), source unchanged9344/added0/changed0/removed0. Engine SHA256 294319ccff9e0914c4d70ce14601fc98830fe918d168fde46bdf737450fa3024; bridge a359207ce369a26deedf5acfb283b1ae15fc3aea726d38f03a1902c085b6acb0; imported host f6574f97b200c637c5203805acef94801b842befb7d24aac10ca37aa98d15fc5. The official record/verify against execution and retained source all passed before a build verification failure.

The shared-engine checker unconditionally passed --disable-plugin-startup-tasks-for-tests, which app-server/src/main.rs intentionally compiles only with debug_assertions. The new release correctly rejects it. The checker now probes argument parsing with --version before startup, preserves the debug suppression option where supported, and omits only that exact explicitly unsupported option for release. Missing executables, timeouts, and unrelated invalid options remain fatal. Existing checker/host source regression: 23/23, actual0 (checker-release-r). Its first native check reached endpoint discovery but the diagnostic TEMP path exceeded Windows AF_UNIX 108-byte capacity. checker-release-s uses a registered shorter fixture root. Future frozen execution root artifacts/w yields a maximum default fixture socket example of106 bytes versus110 under artifacts/wu14h; no socket limit is relaxed.

Cleanup-diagnostics-r1 registered native-validator-l but encountered a busy shared catalog before completing m registration/review. No apply or physical deletion ran. Its pending producer reconciliation must be completed after the active build/check owners stop; no lock was removed or bypassed.


### Installation blocker and required scope decision
Native checker u reproduces thread/read timeout after plugin startup is disabled in the fixture; plugin sync therefore is not established as the direct cause (correcting the earlier hypothesis). Native proxy evidence shows source session attachment waiting while the original window is still subscribed, then rejecting during fixture shutdown. bind_session_scope_if_unsubscribed returns busy for any existing subscriber, while the proxy attaches even for the first metadata read. The owning runtime contract explicitly requires original-engine routing beginning with metadata reads. A temporary bypass that read through the selected engine was reversed before any build or receipt update; engine/codex-rs/app-server-daemon/src/session_handoff.rs exactly matches the frozen approved bytes again.

Further runtime changes require deciding/authorizing a bounded fix that preserves original-engine read routing and automatic connection/transfer. User approval was requested (async question 01a19383-11f7-7211-9325-d1bce029017d). No 2026.0.14 package has passed mandatory acceptance and no installation has run. Completed release compiler output remains valid for the unchanged Rust source; 23 checker/host unit cases passed. Build-only checker corrections remain local and are not yet frozen into a new deployment input. Native u reports and source are retained for the correction; obsolete diagnostic raw bundles are being retired through the verified native owner.


### Diagnostic cleanup outcome and current handoff
cleanup-diagnostics-w recovered the exact failed m registration reservation after binding its original ID/token/lease owner/hash and independently observed stopped producer/tree. The initial v recovery request lacked required proof-binding fields and changed no reservation; w succeeded without weakening guards. Native registered review found l/m/r deletable; n/o/s/t are protected because their external temporary roots fall outside configured managed_roots. No configuration boundary was broadened. cleanup-diagnostics-x actual exit0: l/m/r deleted, every root absent, all three lifecycle records finalized. Deleted measured bytes:1,305,349. Four protected groups retain3,041,261 measured bytes plus their zero-byte external roots; this is unresolved cleanup, not user retention approval. Exact results/paths are in build-install-014-diagnostic-cleanup.json. The cleanup/recovery control runs and current build/input/blocker evidence remain needed until scope is settled. No archive move or force deletion was used.

Next action requires the pending user decision on preserving original-engine metadata routing while fixing read-only attachment blocked by active subscribers. Do not apply the reverted selected-engine metadata bypass. Do not claim completed package/build acceptance or install: Cargo success alone is insufficient. Retain the q source-compatible compiler bundle and u real failure evidence for diagnosis. Resume required verification/package/install and final owner-based cleanup only within the resulting authority.


## 승인된 읽기 전용 접근 수정 및 설치 재개
사용자는 기존 자동 연결·이관을 유지한 읽기 전용 접근 문제 수정과 2026.0.14 설치 진행을 승인했다. 새 기능 검토나 release profile 최적화를 다시 시작하지 않는다. 공통 세션 권한 규약을 변경하며 실제 수용 대상은 Windows x64 MSVC이고 다른 OS의 native 수용은 미검증이다. readOnlyAttach capability를 광고하는 원본 엔진에만 선택적 readOnly attach를 보낸다. preview는 원본 metadata를 읽되 실행/구독/승인/이관 권한을 받지 않는다. 명시적 재개 시 대기 중인 읽기와 callback이 없을 때 연결을 닫고 기존 full attach admission을 다시 검사한다. 이전 peer는 기존 규약을 유지한다. 원본 ThreadStore의 내부 flush와 writer 무결성은 기존 API에 맡긴다. 추가 승인은 필요하지 않다.
root는 proxy/Attach 규약·문서·빌드/설치를, readonly_source_scope는 source scope와 기존 테스트를 맡았으며 변경 파일은 안정화됐다. read-only evidence agent는 thread/read가 subscriber를 추가하지 않고 handoff가 다른 subscriber/callback을 재검사함을 확인했다. parser 검사는 통과했으며 타입/실행 회귀 후 새 immutable 입력을 고정한다. 기존 input은 수정하지 않고 최종 native/VSIX/standalone 수용을 통과한 뒤에만 설치한다.

### Approved read-only fix: verification and final input
The user approved fixing original-engine read-only access while preserving automatic version routing/transfer, then proceeding to 2026.0.14 installation. The implementation adds capability-negotiated readOnly attachment without subscriber/writer authority, retains identity/workspace/storage/auth checks, rejects callbacks/mutations/handoff in preview, and reacquires normal admission on explicit resume only after pending reads drain. Legacy peers retain full attachment behavior.
Rust cfg(test) type checking passed (readonly-check-aa, actual0, 31,668ms) after correcting a new test's non-Clone native process identity. Initial handoff run ab exposed a fixture close-handshake error; that test now uses the existing probe-close convention. Run ad passed daemon14, core10, Attach7 and thread locator9. Both new source-scope tests passed; the complete source scope returned19/20 because the unchanged 2-second diagnostic fsync test returned an empty snapshot while full input copying was active. That failure remains recorded; an unchanged isolated20-test rerun gates product-build-ah.
Final immutable preparation freeze-readonly-af completed successfully. Its context/manifest under artifacts/tasks/EU01-install-014/runs/freeze-readonly-af/reports owns artifacts/inputs/014af and working artifacts/x. Earlier freeze-readonly-ac is superseded (preparation1,046,229ms) after the fixture test changed; it is not the final build source. No existing immutable inputs were edited. Pinned UI closure and Bun1.4.2 are ready under artifacts/x/artifacts; fixture assets lifecycle completed with the exact proof hash after the initial fixtures-ag control close failed for a missing hash (original failure preserved).
Product-build-ah first repeats only source scope, then verifies the complete frozen input and builds from artifacts/x/engine with retained immutable engine, existing release settings/jobs4/shared target and the source-built imported V8 host. Installation has not run; mandatory native/exact-package/standalone/coexistence acceptance and owner cleanup remain pending. Superseded copies and protected diagnostic cleanup are unresolved and are not approved retention.

### Paused at explicit user request
User requested a temporary stop. No further edits, compilation, installation or cleanup will be started until resumed. Product-build-ah Cargo completed28m43s with actual compiler0 and both execution/retained-source provenance verified, but overall build returned1 because real cross-generation thread/read includeTurns returned RPC-32601 list_turns is not supported yet. No .14 package/install was accepted or installed; ordinary user profile remains .13 as last verified. Agent readonly_session_api_evidence was interrupted while tracing that missing store implementation; do not claim the cause established. Resume by obtaining its bounded evidence, resolving the read API issue within approved scope, then rerunning affected verification/build and final installation gates. Final input context is freeze-readonly-af; primary project-maintenance.json subsequently contains the user-approved exact9 short roots. Cleanup-diagnostics-al completed actual0; its independently readable summary reports 4 finalized groups and 0 blocked groups. Preserve current diagnostics, frozen inputs, caches and recovery references while paused.

## 2026.0.14 빌드 재개 (현재 요청)

상태: 2026.0.14 제품·최종 패키지 인수 통과, 임시 산출물 정리 중. 이번 요청은 빌드 산출물까지이며 실제 사용자 프로필 설치는 수행하지 않는다.

### 범위와 수정

- Windows x64 MSVC release, 기존 LTO/codegen/jobs4 및 공유 Cargo target을 유지한다. 다른 OS native 인수는 미검증이다.
- 중단 세션의 product-build-ah는 Cargo 성공 후 includeTurns 읽기 검사에서 실패했다. LocalThreadStore에 list_turns 구현은 있지만 첫 사용자 메시지 이전에는 metadata 생성이 지연된다. 최초 metadata 검사만 includeTurns:false로 정정하고 이후 실제 turn의 history 검사는 유지했다.
- 재접속 approval의 transport ID는 연결별 namespace이므로 동일 ID 대신 동일 params를 확인하고 재접속 ID로 응답한다. 권한 거부·중복 inference·원래 turn 완료 검사는 유지했다.
- native-read-am/an은 metadata·원본 재접속·approval·code-mode delegate 경계를 확인했다. an은 마지막 창 종료 후 read_only scope가 원본 daemon과 자식 수명을 붙잡아 실제1로 실패했다. 제품 no-window gate에서 read_only scope를 실행 소유자로 세지 않도록 수정했고 owning runtime 문서에도 반영했다. 일반 attach lease와 grace·권한 검증은 유지했다.
- 지원 recorder로 SOURCE.json에 정확한 두 Rust 변경 경로(기존 승인된 test 삭제 및 수명 gate 수정)를 기록했다. frozen 입력은 직접 수정하지 않았다. 임의의 ThreadStore API나 selected-engine 읽기 우회는 추가하지 않았다.

### 고정 입력과 제품 빌드

- freeze-resume-ao: 실제0, 01:56:59.504–02:18:29.929 UTC. 기존 read_only_ native2/2 통과(198,509ms), 입력 준비872,692ms. context와 manifest는 artifacts/tasks/EU01-install-014/runs/freeze-resume-ao/reports에 있다.
- manifest SHA256: 3f2e3c45f31aaa545bb93dea95079b738f135947bcd92fbd442e09e4c7cfbbd3. immutable artifacts/inputs/014ao/project/engine, working artifacts/u14t. input:66b9e879d0a15d55e7ebda6c 및 workspace:66b9e879d0a15d55e7ebda6c.
- product-build-ap: 실제1, 02:19:52.657–03:01:18.962 UTC. Cargo 실제0(2,241,671ms), execution/retained-source provenance 및 실제 engine/host IPC·마지막 창 종료·세대별 독립 종료 모두 통과했다. 후속 companion staging에서 전달 PATH 중복 때문에 Get-Command npm.cmd가 같은 경로를 두 번 반환하여 실패했다. 실행 환경만 중복 제거했다.
- product-aw: 실제0, 03:16:51.276–03:27:24.579 UTC. 완료 엔진 bundle을 재사용하고 companion/provider 모듈 조립, packaged provenance, 짧은 경로에서 IPC 검사를 모두 통과했다. release: artifacts/u14t/artifacts/releases/win014-eu01-20261101-aw-product.
- 엔진 SHA256 2f794a059517870f5fccc2e2d2c798cf749470c2304bf15736fb1b00815571f4. bridge e7c701f7b35fa76f76c3d1609ecdcd06e4e2c6d03a59a313750943d9c063f7c0. imported source-built compatible host f6574f97b200c637c5203805acef94801b842befb7d24aac10ca37aa98d15fc5.
- companion key a45998129931c2a881b28f4fc6ca25ce6e2675513d7b2a0e46bb91ece1d60910, provider key70b905151ce82f782f360d0275b1e778c8ec3c3033f3f0b27e5984f352a10a1f. 실제 TypeScript는 companion cache의 pinned node_modules를 사용한다.
- source-deps-aq: npm ci 및 실제 TypeScript/node-pty load 실제0, 약26초. fixture-assets-ar: 기존 x의 pinned fixture와 Bun1.4.2를 복사·검증했고 work:EU01-install-014-ao-fixtures로 소유 등록했다.

### 재시도와 실제 결과

- deploy-as 준비 wrapper는 command JSON의 env 키를 잘못 읽어 child 시작 전에 실패했다. deploy-at에서 키를 사전 확인하고 수정했다. 제품 소스 변경은 없다.
- deploy-at: 실제1, 03:04:29.257–03:08:06.274 UTC. 실제 node/npm 단일 경로와 환경 준비는 통과했다. source preflight fixture-guards만 catalog.lock 충돌로 실패했고 다른3개 invocation은 통과했다. 잠금을 제거하지 않았다.
- deploy-au: 실제1, 03:09:28.200–03:10:29.803 UTC. 이전 실패가 등록한 artifacts/v claim과 충돌하여 검사 시작 전에 거절됐다. 새 fixture identity를 사용했다.
- deploy-av: 실제1, 03:11:17.762–03:15:41.065 UTC. SourceTestConcurrency1에서 source preflight4개 invocation 모두 실제0/receipt passed. 이후 generic deploy가 짧은 TEMP를 working/artifacts/t로 덮어써 Windows107byte 소켓 제한에 걸렸다. 제한과 frozen 소스는 유지하며 개별 build/verification owner를 사용하는 product-aw 및 후속 인수로 전환했다. 취소된 source 실행은 통과로 재사용하지 않는다.
- acceptance-ax: 실제1. fixed input 재검증 통과 후 source changed-only121개 파일을 직렬 실행(03:30:28.468–03:59:56.937 UTC). 총1969건 중1950 pass,12 fail,7 intentional skip,0 cancelled. 실패는 cargo-owner recovery5건의 project artifacts 경로, UI 원본 누락5건, 준비된 외부 환경에서 미준비를 기대한 runner fixture1건, instruction package parent1건이다.
- 기존1950건의 통과는 변경 범위를 확인하여 재사용하고 전체121개를 반복하지 않는다. 실패12건은 fixture와 실행 환경을 바로잡아 해당 범위만 다시 실행한다. 제품·frozen 테스트 소스를 임의 수정하거나 전체 실패를 통과로 바꾸지 않는다.
- fixture-repair-ay: 실제0, 04:02:08.884–04:04:02.905 UTC. stopped producer가 확인된 ao fixture group에 새 generation full-closure-ay를 기록했다. primary pinned UI 기존36개 SHA 일치, 누락19,596개/1,423,303,571bytes 복사 및 각 SHA 확인. 전체 원본은 빌드에 필요하며 새 producer 완료 증거는 fixture-repair-ay/reports/closure.json이다.
- acceptance-az: 실행 중. 새 run temporary e/6, outputs working/artifacts/azf, logs/native temporary working/artifacts/n을 사전 소유 등록했다. cargo-owner와 instruction packaging fixture를 현재 working의 artifacts 아래로 이동하고 미준비 검사에만 준비된 instruction 환경을 제거한다. 실패11건과 미준비1건 재실행 후 sourceConcurrency1로 engine.shared-engine preservation, 정확한 .14 package 인수로 이어간다. 완료 신호bdaf408d-39d8-4891-a5b1-0ecf1c79c50a, exec38355.

### 후속 인수와 정리

- 최종 acceptance-bd 실제0, 06:37:58.278 UTC 완료. inventory/install/finalInventory/coexistence host/standalone host가 모두 실제0이며 fresh state와 공식 Codex 원본 보존을 확인했다. verifier syntax·instruction-view 단위 검사·engine receipt 재검증 및 고정 입력 재검증도 실제0이다. 기존 source1950건과 보완12건의 실제 통과를 합쳐 재사용했으며 전체 회귀를 반복하지 않았다.
- 최종 VSIX는 artifacts/u14t/artifacts/deployments/deploy-win014-eu01-20261101-aw-product/package/azrael-host.vsix, 709,114,626bytes, SHA256 c3789bbf371937cc1da2e41745b5a0d585d7a9d21b27b36a1cfa28a11de3d042이다. release/build-acceptance.json에 독립 요약을 보관하고 version의 verification-evidence에 native receipt·source 결과·host 결과·입력 identity·중단 Cargo 복구 증거를 보존한다. 중첩 PowerShell inventory 직렬화만 요약으로 줄였으며 검사 결과·제품 bytes는 바꾸지 않았다.
- cleanup-be는 고정 SHA의 설치된 standalone maintenance_owner로 기존 등록 목록부터 확인하고, 종료·구성·소유·참조가 확인된 정확한 묶음만 fresh review/apply/finalize한다. 정리 요청·실제 결과는 최종 version evidence에 둔다. EW01-fixed-input:final-a가 읽기 소비 중인 input:66b9e879d0a15d55e7ebda6c와 freeze-resume-ao는 보호하며 다른 작업의 참조를 해제하지 않는다. 이 소비자의 reuse.json은 immutable014ao를 선택한다.
- 작업용 프로젝트의 허용 범위 안에서 실패 버전·테스트·중단 Cargo pending 12개 묶음의 apply와 부재 확인·finalize를 실제0으로 완료했다(06:58:13.922 UTC). 별도의 앞선 두 source fixture 묶음과 recovery-bb도 삭제·finalize됐다. 작업용 artifacts/t·v·v-a·v-b는 설정된 관리 경계 밖이므로 보호하며, 정확한 경계 추가와 정리 승인을 사용자에게 요청했다. 기존 e/z는 사전 존재한 거절 TEMP이므로 생성물로 승격하거나 삭제하지 않는다.
- 주 프로젝트 정리는 work completion e68c49fa-d21a-45a3-a38d-83c8ee7e4edd / exec33708로 진행 중이다. 첫 Bun junction 거절 후 링크가 해당 fixture 내부 디렉터리를 가리키는 것을 확인했다. 지원된 verified_junctions를 사용하되, 과거 일부 external temporary 구성원의 generated/protection 필드도 누락돼 있어 근거에 따른 보완·새 등록이 필요하다. 실행 중인 같은 catalog의 잠금을 건드리지 않고 현재 owner의 종료 뒤 보완한다. 원래 실패·미확인 결과와 현재 보호를 유지하며 직접 삭제로 우회하지 않는다.
- 사용자가 4개 작업용 임시 경계 추가와 정리를 명시 승인했다(question 01a195e5-a42a-7bc3-a2ac-3fc1992e6510). working project-maintenance.json만 정리용으로 변경하고 원래 설정 bytes와 SHA를 version evidence에 보존했다. immutable014ao와 제품·VSIX bytes는 바꾸지 않았다. artifacts/t·v·v-a는 실제 삭제·부재·finalize 완료. artifacts/v-b 등록 중단 예약은 원래 owner40732/parent53576의 전체 scoped process 부재, 변경 없는 maintenance/catalog/group lock exclusive open과 정확한 token/fence를 근거로 recover_reservation 실제0을 기록했다. execution_outcome_changed/pending_intents_changed는 모두 false다.
- e68c49fa 실행은 사용자의 중단으로 cancelled/실제1이 확인됐다. 동일 실행을 통과로 바꾸지 않았다. 생존 producer가 없는 것을 확인하고, 남은 정리를 등록 후 일괄 review/apply하는 새 실행 72608cb1-1152-40b2-bdcb-f7ab59d23a66 / exec25733으로 이어간다. 원래 4개 junction 묶음(f, h-fixtures, ax-fixtures, k)은 path를 member 기준 상대 경로로 주는 지원 schema에 맞춰 후속 helper를 정정했다. 이미 실행 중인 입력은 바꾸지 않았으므로 이번 실행에서 거절된 해당 네 묶음은 다음 fresh 등록에서 처리한다.
- profile 정리 실행 283a4c00-a043-46df-91d0-c6d35f0b26f9는 실제0으로 보고를 마쳤지만, membership의 누락된 protection 필드 때문에 삭제는 보류됐다. checker의 기존 새 경로·claim 거부 코드, 종료 증거와 승인 범위를 대조하여 정확한 세 member의 누락 필드만 supported recordLifecycle로 보완했다(revision4). path/role/owner/outcome은 유지했다. 기존 내용 측정은 재사용하고 refresh_group 후 새 review/apply를 실행 중이다(exec49562). 종료 코드0이나 도구 호출 완료만으로 삭제 완료를 주장하지 않는다.
- 남은 과거 working catalog 조사: wu14h 34개(complete26/failed8), wu14b 17개(complete8/failed8/pending1), x failed version1개, w 0개. 이들 원래 producer와 참조를 닫고 지원 owner로 generated output을 정리하기 전에는 workspace의 project-maintenance.json을 포함한 source 구성원을 삭제하지 않는다. 과거 9개 exact root 승인과 현재 보호를 유지한다. 실제 final version이 남는 u14t의 관리 설정·version evidence와 EW01 소비 입력은 별도 보존 대상이다.

- acceptance-bc: native aggregate 실제0(05:44:47.154–06:07:12.587 UTC), .14 prepare 실제0(06:07:13.017–06:15:56.100 UTC). 생성 VSIX SHA256 c3789bbf371937cc1da2e41745b5a0d585d7a9d21b27b36a1cfa28a11de3d042. 최종 host 검사 실제1(06:15:57.592–06:20:26.382 UTC): inventory/install/finalInventory 실제0, standalone 프로세스0이지만 AccountService 결과 관찰30초가 먼저 만료되었다. 공존 host 단계는 미실행이다. raw sqlite telemetry에서 engine socket listening은06:20:26으로 시작 약36초 후였다. 이후 관련 fixture 프로세스가 모두 종료된 사실을 직접 확인했다.
- 제품 AccountService의 기본 startupTimeoutMs는70,000ms인데 verifier는30,000ms였다. primary operational checker의 관찰만75,000ms로 맞춰 제품의70초 최종 결과를 관찰한다. 제품 timeout·성공 조건·runtime bytes는 변경하지 않았다. frozen working 소스는 수정하지 않는다. 별도 verifier 입력의 전후 SHA 및 fixture로 실제 복사된 runner SHA를 기록·확인한다.
- acceptance-bd는 원래 .14 VSIX를 그대로 사용하여 primary check-independent owner와 새 parent-owned fixture e/8/v로 검증한다. verifier syntax 및 기존 instruction-view 단위 검사는 실제0. 설치된 사용자 프로필을 변경하지 않는다. host 인수 후 기존 native receipt와 고정 입력을 재검증한다. 완료 신호5f38ca51-7fbe-4730-976e-c8cad1b63e79, exec56237.

- acceptance-bc 확인 시점: source fixture-guards/stable-source/host/appserver/session-handoff/manifest-policy/package-default 7개 invocation 모두 실제0을 기록했다. handoff 마지막 app-server7건도 실제0이다. aggregate receipt는 아직 running이며 최종 input identity 확인 및 package 인수 결과 전에는 전체 완료로 표시하지 않는다.

- recovery-bb 실제0: exact Cargo token/hash를 확인하고 coordinator/descendant·compiler/test 실행 전체 조사와 debug/release Cargo lock exclusive open 증거로 recoverTargetOwner를 실행했다. 결과는 recovered:true, 기존 status unknown/exitCode:null 유지. 수동 lock 삭제나 registry JSON 편집은 없었다.
- acceptance-bc는 동일 제품·source·native compiler target을 재사용하되 새 owned INSTA_PENDING_DIR을 사용한다. 중단된 pending generation을 임의 성공/실패로 바꾸거나 재시작하지 않는다. 이 실행환경 변경 때문에 맞지 않는 검사 캐시는 재실행하며 완성 컴파일 산출물은 Cargo가 재사용한다. 기존 source1950건 및 보완12건의 실제 통과는 재사용한다. native aggregate receipt를 새로 완성한 뒤 .14 prepare/exact host/standalone 및 고정 입력 재검증을 이어간다. 완료 신호af048f41-e1ba-487a-b8c1-d39bf7a95f7d, exec63831.

- 사용자가 continue로 재개했다. acceptance-ba executor는 cancelled/실제1이며 전체 성공이 아니다. UI diagnostics·instruction-current·미준비 gate는 모두 실제0이다. native receipt는 fixture/stable-source/host/appserver/manifest/package-default 실제0을 기록했고 handoff 도중 중단됐다. daemon handoff14건의 실제0 로그는 있지만 그 invocation 전체 완료를 뜻하지 않는다.
- 중단 Cargo owner는 token effc6e85-5a08-40ad-8001-581936a7ea68, coordinator11488, core session::handoff::tests::, phase spawn-attempted, producerPid 미기록이다. PID 부재만으로 회수하지 않는다. recovery-bb에서 executor 취소, 전체 CIM process/descendant·compiler/test 경로 조사와 Cargo debug/release lock의 exclusive open을 독립 증거로 남긴 뒤 exact token/hash를 지원 recoverTargetOwner에 전달한다. 기존 결과는 unknown/nullable exit로 유지한다. 새 성공을 만들어내지 않는다.

- acceptance-az 실제1: 04:05:40.642–04:05:47.274 UTC의 제한 재검사11건 중9건 통과. 나머지 UI diagnostics는 앞선 같은 파일의 변환 초기화 test가 필요했고 instruction-package는 env 전용 parent 대신 os.tmpdir()를 직접 사용했다. 제품 결함으로 해석하지 않으며 성공한9건은 재사용한다.
- acceptance-ba는 UI diagnostics 파일 전체, instruction-current 단일 case(TEMP/TMP/TMPDIR를 working artifacts의 package fixture로 설정), 미준비 gate 단일 case(준비된 instruction env 제거)를 실행한다. 이후 동일한 native/package 인수 순서를 유지한다. 새 소유 경로: e/7, working artifacts/baf 및 o. 완료 신호b8b95284-1206-4fd5-8072-e5261601c3b3, exec86451. 아직 실제 결과 전에는 통과로 기록하지 않는다.

- HostVersion 2026.0.14를 명시한 prepare-independent-vscode, fresh state의 exact VSIX inventory/install/coexistence/standalone, engine receipt 및 최종 고정 입력 재검증을 수행한다. 공식 공존 입력은 현재 설치된 matching Codex/audio26.1021.22027이며 Azrael UI 빌드 입력은 pinned26.1007.21434를 유지한다.
- 소비 중인 입력·캐시·완성 release를 보호한다. 기존 am/an 및 as/at/au/av/ax 실패 진단, 임시 경로, source fixtures와 superseded snapshot은 진단·소비 종료 후 지원 owner로 정리하고 실제 부재를 확인한다. 기존 사용자 승인 archive는 자동 삭제하지 않는다.
- 관련 source/doc diff --check 실제0. 기존 변경과 index가 크게 겹치므로 관계없는 변경을 포함한 commit은 하지 않는다. 최종 결과와 남은 검증·정리 항목을 실제 증거대로 기록한다.

상태: 구현·빌드·외부 VS Code 프로필 설치 및 Windows 수용 검증 완료. 설치에 필요한 산출물과 검증 근거는 보존한다.

# 지침 문서 버전 관리 및 가져오기 오류

## 요청과 범위

사용자 화면의 `Cannot find module 'yazl'` 원인을 해결한다. 사용자 승인 범위는 권장안 구현, 빌드·검증·로컬 설치이며, 최신 지시에 따라 설치·수용 대상은 사용자 데이터·확장·CODEX_HOME을 분리한 외부 VS Code 프로필이다. 일반 사용 프로필을 교체하거나 원격 게시하지 않는다. 앱 버전은 유지한다. 공통 JavaScript 의존성과 패키징 문제로 분류하며 실제 검증 환경은 Windows x64다. Linux/macOS 공통 패키징 경로도 보완하되 해당 OS 실행 수용은 별도 미검증으로 표시한다.

## 확인한 원인

- `scripts/instruction-publisher.cjs:9`는 로드 즉시 `semver`, `yazl`, `yauzl`을 요구한다. 설치본 파일은 현재 소스와 바이트가 동일하다(SHA-256 `392b66e3be174482de9ed54e97ab48312d5a9a5cc50260bc45b2ba66d5f6c25d`).
- `extensions/azrael-ex/package.json`의 런타임 dependencies에 `yazl`이 없다. lockfile의 `node_modules/yazl`은 버전 2.5.1, `dev: true`이며 개발 도구 `@vscode/vsce`의 의존성이다.
- 개발 폴더의 `require.resolve`는 세 모듈 모두 성공하지만 설치본 account-ui에서는 semver/yauzl만 성공하고 yazl은 MODULE_NOT_FOUND다. 설치본 publisher를 직접 require하면 화면과 동일한 오류가 재현된다. 실험 명령 자체 종료는 0이며 예외를 잡아 출력한 것이므로 모듈 성공을 뜻하지 않는다.
- `scripts/build-module-companion-recipe.ps1`는 npm ci 후 VSCE package를 호출한다. `prepare-independent-vscode.ps1`는 companion VSIX를 풀고 publisher 등 스크립트를 추가한다. 설치본에는 publisher가 있지만 yazl은 없다.
- `instructionLibraryService.ts:42`는 로컬 상태 조회 시에도 publisher를 초기화한다. `instructionService.ts:88`의 library snapshot 실패는 바깥 catch로 전파되고, catch는 currentVersion 등을 null/빈 값으로 반환한다. 따라서 화면의 '적용되지 않음'만으로 실제 설치 상태를 판정할 수 없다.

## 검증 공백

`instructionLibraryService.test.ts`는 publisher를 대역으로 바꾼다. 개발 소스에서 실제 publisher를 시험해도 개발 의존성이 누락을 가릴 수 있다. 기존 VSIX 필수 엔트리 검사는 publisher 존재를 검사하지만 그 런타임 의존성 로드를 확인하지 않는다. 최종 설치본에서 실제 GitHub production HTTPS 목록 조회는 성공했다. 현재 호환 안정 릴리스가 0개여서 실제 원격 다운로드는 실행하지 못했다. 기존 review-1.0.0 릴리스 자산을 전송하는 격리 검증에서는 다운로드·해시·적용·고정·복구가 모두 통과했다.

## 승인된 해결안과 순서

1. 기존 2.5.1 재사용을 우선 검토하여 yazl을 정식 runtime dependencies에 명시하고 lockfile을 동기화한다. 전이 의존성 buffer-crc32도 최종 산출물에서 확인한다. 개발 의존성 전체를 배포에 포함할 필요는 없다.
2. companion 및 통합 VSIX 생성 후 저장소·개발 node_modules를 참조하지 않는 격리 환경에서 실제 instruction-package/library/publisher 모듈을 로드한다. 파일 존재 검사와 실제 호스트 snapshot 검증을 함께 둔다. 잘못된 패키지는 설치 전에 차단한다.
3. 기본 지침 배포 상태와 개인 라이브러리 오류를 구분해, 일부 초기화 실패 시 확인된 적용 상태를 보존하고 해당 작업 오류를 표시하도록 제안한다. 오류를 단순 무시하거나 버전 관리 기능을 숨기는 방식은 사용하지 않는다. publisher 지연 초기화는 복구 기록 조회 계약과 함께 검토하며 단독 해결책으로 취급하지 않는다.
4. 고정 입력으로 수정 패키지를 만들고 Windows 설치본에서 설정 열기, 기존 상태/캐시 읽기, 호환 버전 조회, 다운로드 및 무결성 검증을 확인한다. 적용·복구는 격리 CODEX_HOME에서 보존 계약과 함께 확인한다. 지원 대상별 패키징 경로를 점검하고 다른 OS의 미검증 범위를 명시한다.

## 실행 책임과 의존 관계

root는 런타임 의존성, service 오류 경계, 동작 회귀, 문서·보존 inventory, 통합·빌드·외부 프로필 수용을 소유한다. 패키징 검사 담당은 공유 checker와 기존 packaging fixture 및 Windows/portable preparation 연결만 소유하며 root의 의존성 선언을 소비한다. root가 소스 검증 완료 후 고정 입력을 생성하고 이를 빌드·최종 검증·설치에 일관되게 사용한다. 기존 사용자 변경은 보존하고 커밋에는 이 작업의 변경만 포함한다.

## 완료 기준과 제한

생산 의존성 기반 fixture와 실제 산출물에서 모듈 로드가 성공하고, 누락된 직접/전이 의존성은 개발 폴더로 우회하지 못해야 한다. 라이브러리 실패 시 기본 버전·고정·캐시·동작이 보존되고 오류가 표시되어야 한다. 기존 지침 호환성·해시 검증·로컬 수정 충돌 보호·복구 검사를 유지한다. 외부 프로필 설치 후 6개 호스트 단계와 지침 설정 동작을 확인하고, live GitHub 및 타 OS 미확인 범위는 구분한다. 사용자 원본 지침·계정·대화와 일반 프로필을 보호하며 작업 산출물은 소유·정리 기준에 따라 처리한다.

## 실행 및 검증 근거

- 런타임 의존성: 기존 개발용 yazl 2.5.1을 production dependencies로 승격하고 npm --package-lock-only --ignore-scripts로 lockfile을 갱신했다. 원본 node_modules를 제거하지 않았다.
- Windows 소스 회귀: 실제 종료 0, 91개 중 90 통과·1 skip. 지침 library/publisher/package/task-profile 및 호스트 adapter 검사를 포함한다. 로그: artifacts/tasks/instruction-yazl/runs/a/source-tests.log. 타입 검사 실제 종료 0: 같은 경로 typecheck.log. skip은 기존 조건부 검증이며 설치본 취득·적용 검증을 별도로 수행한다.
- 내장 project_tests 첫 시도는 10초 뒤 124로 종료되어 성공 근거로 사용하지 않았다. 후속 직접 명령은 세션 종료와 exit 파일을 확인한다. 일시 등록한 bundle은 제거했으며 기존 project-maintenance.json 내용은 보존했다.
- 현재 checkout 엔진과 기존 w09h-r2 엔진은 fingerprint가 달라 재사용 검사가 종료 1이었다(engine-reuse.log). 이번 지침 수정은 엔진 변경이 아니므로, w09h-r2가 기록한 고정 소스 artifacts/n9g/engine과 그 엔진 묶음을 명시 선택해 재검증한다. 이를 현재 checkout 엔진을 새로 빌드한 것으로 보고하지 않는다.
- 입력 고정 첫 시도는 사전 생성이 필요한 대상 디렉터리가 없어 종료 1(capture.log)이며 source/payload 출력은 없었다. 빈 소유 디렉터리 생성 후 두 번째 capture-b.log로 재실행한다. 최종 고정 입력 대상: artifacts/iy17b. 외부 설치 대상: artifacts/versions/instruction-2026.0.8-iy17a/external-profile. 일반 프로필 보호 SHA: run/a/user-profile-before.json.

- 최종 입력 고정은 capture-c.log 실제 종료 0이다. SHA-256 `363169ac8edec70b1e939fd8ab4e7fffa51c4ef04bcc41c86b701ac6e4705f41`, 24,399개 파일/472,709,668바이트, 476.194초. 사전 clone --no-checkout으로 root·중첩 Git 메타데이터를 준비한 새 iy17b에서 성공했다. 첫 두 실패 로그와 최종 frozen-input-b.json은 run/a 소유로 보존한다.
- 선택한 고정 엔진 소스 artifacts/n9g/engine과 w09h-r2 엔진의 provenance/binary 검사는 실제 종료 0(engine-selected-reuse.exit/log). ignored source 검사 의존성과 Bun·기존 instruction review assets를 별도로 준비했다(preparation.exit 0). 제품 빌드는 고정 입력 scripts/build-azrael.ps1에서 ReleaseName iy17b, SkipEngineBuild, 명시된 기존 engine/source/runtime/plugin/shared cache를 사용한다.
- 배포 빌드 iy17b는 실제 종료 0, build-metrics.status success, 2026-10-16T23:37:00Z 시작/약 627초 소요다. 계정 UI 모듈은 새 캐시 72df2ee1377fcb9cca18553cf3bad50967e8d65f25c5f148340f737641a37d01에서 생성했고 yazl을 포함한다. 기존 엔진과 provider는 검증 후 재사용했다. release/build-info.json에 실제 해시와 moduleBuild 도구 경로를 보존했다.
- 통합 준비는 고정 scripts/prepare-independent-vscode.ps1, HostVersion 2026.0.8, 명시적 pristine UI/TypeScript 및 외부 state/ordinary-home로 실행한다. ChangedOnlyTests를 사용하지 않고 UI preservation 기본 게이트와 새 instruction-module-verification을 유지한다. 로그 run/a/prepare.log. 이 단계 성공 후 새 fixture에서 6개 호스트 검증을 실행하고 같은 패키지를 외부 프로필에 설치한다.
- 빌드 후 고정 입력 재검사 종료 0: frozen-after-build.json의 sha256/fileCount/bytes가 원래 capture와 모두 일치했다. 외부 UI/runtime/plugin identity도 external-inputs-after-b.exit 0으로 일치했다(첫 wrapper는 상대 모듈 경로 오류로 종료 1 후 절대 경로로 수정).
- 첫 통합 준비 종료 1은 제품 코드 오류가 아니라 UI preservation 사전조건 `Check uses another UI candidate: scripts/test-namespace-cache-owner.cjs`다. 검사 소스가 project/artifacts/upstream-ui/26.1007.21434를 직접 참조하므로 동일 pristine UI를 frozen의 ignored 경로에 복사하고 새 package-r2 출력으로 재실행한다. 기존 실패 receipt preservation-TQWaL1은 보존한다. 고정 tracked 입력은 변경하지 않았다.
- 실패한 capture iy17a는 정리 review에서 `not a managed descendant` 및 lifecycle group protection으로 삭제 차단됐다. 강제 삭제 대신 현재 token으로 defer를 제출했다. 보호 정책이 이 정확한 root를 인식하고 후속 review가 보호 해제를 확인할 때 재검토한다. 최종 실행 로그와 성공 입력은 계속 소비된다.
- 두 번째 통합 준비 package-r2는 종료 1이다. 최종 preservation receipt는 66개 기록 중 65개 exit 0, ui.instruction-settings.library만 exit 1이며, 첫 원인은 fixture가 새 release의 engine/codex.exe를 요구한 ENOENT다. 실제 배포 실행 파일은 azrael.exe다. 중간 진행 상태는 check.status가 없으므로 실패 판별에 exitCode를 사용한다. AZRAEL_INSTRUCTION_TEST_ENGINE을 해당 release/engine/azrael.exe로 지정해 최소 재현을 먼저 실행한다. 검사 조건과 제품 소스는 변경하지 않는다.
- 외부 profile 원본 Codex/audio 복사와 CLI inventory는 external-bootstrap.exit 0이며 26.1007.21434 두 확장이 확인됐다. 이 프로필에만 후속 설치한다.
- 실패 입력 iy17a에 대한 cleanup apply 결과는 group/item 모두 deferred, remaining=true였다. 현재 보호 조건을 우회하지 않았다.
- 지침 최소 host regression은 명시 azrael.exe로 실제 종료 0(3개 host 그룹, 약 49.4초). 세 번째 package-r3 UI preservation에서는 지침 library가 통과했고 computer-use.behavior만 종료 1이었다. 원인은 PC에서 제거된 기본 pristine runtime 경로와 frozen에 없는 과거 v3 runtime 상대경로다. 제품 변경과 별개인 검사 환경 누락으로 분류한다.
- Computer Use runtime 최소 재현에 명시 AZRAEL_TEST_COMPUTER_USE_RUNTIME=기존 sky074-pristine, AZRAEL_TEST_LEGACY_COMPUTER_USE_RUNTIME=기존 all_changes_20261007_r6/computer-use를 지정하여 실제 종료 0, 4개 모두 통과했다(computer-runtime-preflight.log/exit). 후속 전체 UI 검사에도 동일 명시 경로를 사용하며 코드·검사 조건을 바꾸지 않는다.
- package-r4 전 담당자가 남은 검사 36개/스크립트 52개의 필수 Chrome/UI/TypeScript/font 경로를 확인했다. 추가 fatal 누락은 발견되지 않았다. 선택 native config/child-helper 검사의 env 미지정 skip은 실행 수용으로 보지 않는다. runtime 두 경로와 instruction engine 경로를 지정한 run-prepare-r4.ps1을 실행하며 새 package-r4 산출물만 후속 검증·설치에 사용한다.
- package-r4 최종 UI receipt는 103개 중 102개 exit 0, ui.session-links.behavior만 과거 26.928.31416 UI fixture 누락으로 exit 1이었다. 같은 원본에서 LEGACY_SESSION_LINK_ASSETS 4파일만 frozen ignored 경로에 복사하고 SHA/바이트를 확인했다(legacy-session-fixture.json). 최소 test-session-links.cjs 재현은 실제 종료 0이다. package-r5 새 출력에서 동일 source/env로 전체 게이트를 실행하며 유효 passing cache만 재사용한다. 이후 check/install wrapper 모두 package-r5로 고정한다.
- 성공 frozen-b 그룹의 native 등록은 maintenance exclusive lock unavailable로 거부됐다. artifacts/maintenance/maintenance.lock은 현재 엔진 pid=32256을 가리키므로 제거·우회하지 않았다. 재시도 request는 run/a/pending-frozen-registration.json에 보존한다. 사용 중인 frozen runtime/profile/검증 로그는 보존하며, 정상 잠금 해제 후 등록·review/defer를 재개한다. 이전 실패 입력 iy17a의 defer 결과는 이미 확인했다.
- package-r5 준비는 실제 종료 0/metrics passed, UI 103개 모두 exit 0, instruction-module-verification 및 archive-contract passed다. HostVersion 2026.0.8, VSIX SHA-256 F0EDF2109F1BE54E7D95DA58D88DF3968FF831711B5991CC2A828FDC3D871109. 약 1269.4초 소요. 첫 fresh-host 실행은 Windows AF_UNIX 107-byte 제한 사전검사에서 종료 1이며 fixture를 생성하지 않았다(path-preflight-host-check.log).
- 외부 profile의 긴 state path도 같은 제한에 걸리므로 설정을 정식 변경하는 새 package-r6을 준비한다. 제품 코드/엔진은 그대로다. StateRoot=PRIMARY/artifacts/tasks/iy17/s, SourceCodexHome=같은 iy17/o. 둘 다 별도 외부 테스트 상태이며 소켓 주소 104 UTF-8 bytes다. 실제 host fixture=PRIMARY/artifacts/tasks/iv17, StateRoot=iv17/s(104 bytes). profile group에 iy17 root를 추가했고 fixture lifecycle도 별도 기록했다. 설치 후 임의 runtime 파일 수정으로 우회하지 않는다. probe/launch/check/install 경로도 이 구성과 일치하도록 수정하고 syntax 검사 종료 0이다.

## 최종 수용 결과

- package-r6: 실제 종료 0, preparation-metrics.status passed, 약 978.6초. 기본 UI preservation 103개 모두 종료 0, 격리 instruction module 및 archive 검증 통과. 최종 통합 VSIX SHA-256 `0b697f180f578122e2a8454cc21d7c280961585347d15cace6700dd37026637c`, HostVersion 2026.0.8.
- fresh fixture `artifacts/tasks/iv17`: initialInventory/hostInstall/finalInventory/namespace/standaloneHost/host 6단계 모두 실제 종료 0, check-result.passed true. package-r6과 VSIX SHA 동일. 첫 호출은 PowerShell 5.1로 인한 #requires 7.0 시작 거부였고, PowerShell 7 재실행에서 성공했다.
- 외부 설치 실제 종료 0. 영수증 `artifacts/iy17b/artifacts/deployments/independent-20261017-100822-518/deployment.json`: 별도 user-data/extensions, state=artifacts/tasks/iy17/s, original CODEX_HOME=iy17/o. desktop shortcut 변경 없음. frozen-before-install fingerprint가 원본 입력과 일치한다.
- 설치본 기능 결과 `artifacts/tasks/instruction-yazl/runs/a/installed-instructions.json`: passed true/error null. 설치 폴더의 실제 service/store/library/publisher를 로드하고 snapshot → refresh → preview → download → apply(global-instructions) → pin → unpin → cached rollback 모두 통과했다. 문서 28개, 격리 상태 iy17/a2에만 적용했고 외부 런타임의 AGENTS.md/config.toml 보존도 확인했다. ko/en embedded mount 및 localized 상태 검증도 통과했다.
- 최초 disposable probe의 instanceof 검사는 VS Code 확장별 모듈 로더가 만든 별도 클래스 객체 때문에 실패했다. 실제 constructor 구현 SHA가 양쪽 모두 `5f998f7f6b6d878b98198a0b5bdc283d96362f62e5f734143a5f668a5df48f28`임을 확인하고 구현 일치 검사와 실제 기능 실행으로 검증했다. 제품 입력은 바꾸지 않았고 실패 보고서를 attempt1로 보존했다. 실행 wrapper의 로그 중복 열기 오류도 수정 후 다시 실행했다.
- 실제 felrer/Azrael HTTPS listReleases 성공, versionCount/compatibleCount 0. 호환 안정 릴리스 부재로 실제 네트워크 다운로드는 미검증이며 원격 게시·로그인·모델 요청은 하지 않았다.
- Window Use observation-4에서 정확한 외부 `[Extension Development Host] Azrael Settings - workspace` 창의 Instruction Documents/Library/Baseline distribution을 확인하고 baseline을 펼쳤다. 배포 소스 felrer/Azrael, 깨끗한 외부 상태의 Not applied가 보이며 yazl 모듈 오류는 없다. 시각 검증 metadata는 run/a/visual-inspection.json이다. UI Automation을 위해 이 테스트 프로필에만 editor.accessibilitySupport=on을 설정했다.
- 일반 프로필 보호 검사 user-profile-after.json: global extensions.json, 기존 Azrael package/runtime, Code User settings 4개 모두 이전 SHA와 동일하다. 이 4개 파일 외 사용자 데이터 전체의 byte 비교를 수행한 것은 아니다.
- 실제 실행 검증은 Windows x64에서 수행했다. Linux/macOS에는 공통 production dependency 및 portable preparation checker를 연결했으나 해당 OS 실행은 검증하지 않았다.
- 외부 테스트 창과 설치 profile, frozen runtime, 최종 host fixture 및 검증 로그는 설치 소비·수용 근거로 보존한다. 네 lifecycle의 실제 구성과 참조를 조정하고 native inventory 등록 및 review/defer로 연결한다. 앞서 차단됐던 maintenance.lock은 현재 해제되어 정상 등록을 재개했다. 실패 iy17a는 기존 관리 경로 보호에 따른 defer를 유지한다.
- frozen-b native 등록은 테스트 fixture의 reparse/link 경로 artifacts/iy17b/artifacts/tasks/BQ-01/runs/observer/temporary/contracts-9eHzY1/linked를 만나 거부됐다. 이 경로를 제거하거나 검사 정책을 우회하지 않는다. 설치에서 참조하는 frozen 전체와 실패 시도·검증 fixture를 보존하고, 소비 참조 해제 후 정식 lifecycle/링크 정책을 충족하는 구성으로 등록할 때 정리를 재검토한다. run/a native 등록은 성공했다.

- 최종 native 결과: 외부 프로필 등록은 실행 중인 프로필 파일의 byte-range lock(os error 33)으로 실패했고, 후속 host fixture 등록은 exclusive maintenance lock unavailable(os error 80)로 실패했다. native 호출은 terminal error이며 등록 성공·정리 완료로 보고하지 않는다. 관찰 watcher는 12분 제한에 도달했으며 성공 근거가 아니다. 사용 중인 profile/runtime과 로그·fixture는 producer retained/참조 기록에 따라 전부 보존한다. lock 제거, ACL 변경, 별도 삭제 경로로 우회하지 않는다. 앱을 닫고 관리 잠금의 정상 해제·복구를 확인한 후 native 등록/review/defer를 재개하는 조건으로 보류한다. 기능·패키지 수용에는 영향이 없다.

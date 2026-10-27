상태: 전수 테스트 조사·집중 검증과 소유권 분리를 완료했다. 이후 사용자가 삭제 중단·archive 이동을 지시하여 실행기를 즉시 중단했다. 중단 전 21개 fixture는 삭제됐으며 남은 6개와 작업 제어 파일 5개는 `archive/dw15-cargo-fixtures-20261027-user-archive/payload/material/`로 이동·무결성·원래 경로 부재를 확인했다. 기존 289개 경로와 소비 참조는 보존했다. 앞선 정리 3건은 커밋 `1b7f7af`에 반영됐다. 전체 제품 빌드·설치는 실행하지 않았다.

# 전체 빌드 테스트 정리

## 전체 조사 재개

- `current`/`standalone`/`build` exhaustive 선택, 전체 feature inventory의 source/native 검사, extension 전체 테스트, 준비·패키지·최종 host 검사의 합집합과 플랫폼 조건부 경로를 추적한다. 마지막 빌드의 17개 feature로 제한하지 않는다.
- 조사 기준은 HEAD `1b7f7af545983ff9761706c2644c9030ab75d1c1`과 현재 작업 파일의 바이트 해시다. 1차 목록은 source 진입 파일 206개(40,315줄), extension 테스트 38개, native wrapper 31개다. 하위 호출과 Rust selector를 추적해 목록을 보완한다. 숫자는 조사 완료나 삭제 목표를 뜻하지 않는다.
- 사용자가 전수 조사를 요구했으므로 [15-audit.json](15-audit.json)에 파일 해시와 검토 범위의 완료 상태를 기록한다. 변경 없는 테스트마다 별도 유지 심사표를 만들지는 않는다. 호출 누락·미검토 본문·입력 변경을 해소한 뒤에만 전체 조사 완료로 판정한다.
- root가 호출 목록·공유 계약·최종 결정·편집·검증·정리를 맡는다. 읽기 전용 조사자는 서로 겹치지 않는 source 10개 범위, extension 2개 범위, native 호출 해석과 패키지/host 경계를 맡는다. 조사자는 재위임하거나 파일을 변경하지 않는다. native 본문 조사는 selector 해석 결과가 준비되는 즉시 이어간다.
- 독립된 source/extension 본문 조사를 먼저 시작했다. root는 하위 호출 누락을 보완하고 정리 후보의 실제 보호 가치를 확인한다. 단순 문법·파일 수·구현 내부 구조만으로 삭제하지 않는다. 시작 시 C: 여유 공간은 27,179,356,160바이트이며 현재는 읽기 위주로 진행한다.

## 목표와 승인 범위

- 사용자가 `docs/playbooks/test-cleanup.md`를 적용해 전체 빌드 과정의 테스트 정리만 먼저 수행하도록 승인했다. `development-workflow`와 `implementation`을 같은 작업에 적용한다.
- 대상은 `deploy-azrael.ps1` → `test-project.cjs`의 full current/standalone 소스 검사, feature inventory가 연결한 source/native 검사, 준비·패키지·최종 host 검사의 테스트 소스와 테스트 전용 fixture/setup이다. `--FullRegression`과 조건부 선택의 차이를 구분하고 현재 선택된 17 engine feature만을 전체 지원 기능으로 혼동하지 않는다.
- 허용 작업은 보호 가치 없는 검사 제거, 동일 경계·입력·조건을 검증하는 중복 통합, 불필요해진 테스트 전용 setup/참조 정리다. 제품 동작·소스 선택 정책·성공 기준·필수 게이트·지원 플랫폼은 축소하지 않는다. 특히 여섯 final host gate와 보안·권한·소유·프로토콜·동시성·출처 검사는 유지한다.
- 공통 계약의 영향은 Windows x64/Linux x64/macOS ARM64이며 실제 실행 가능한 검증 환경은 Windows x64다. 플랫폼 고유 보호를 대체할 증거가 없으면 보존한다. 기존 실행 실패나 환경 제한은 삭제 근거가 아니다.
- 이전 생성물 전체 정리나 이전 빌드 재시도는 이번 변경에 포함하지 않는다. 새로 만드는 검증 생성물만 현재 소유 아래 선언하고 즉시 정리한다.

## 기준과 역할

- 시작 기준 HEAD `74df098938038ef019e6faddb656afb42b20ba31`. 기존 working tree와 unrelated staged 4파일은 보존한다. 다수 테스트에 기존 수정이 있으므로 파일 단위가 아니라 소유한 변경 범위만 커밋한다.
- root는 호출 경계·필수 의무·PowerShell 배포/cache/metrics 검사, 삭제·통합 결정, 변경 및 최종 검증을 소유한다. 세 read-only auditor가 Node source, UI/extension, native/preservation의 독립 경계를 조사한다. 자식 위임·제품 코드 변경·빌드·외부 설치는 허용하지 않는다.
- 각 후보는 제거 대상 assertion/case, 잡는 결함, 존속 검사와 동등한 경계·입력·실행 조건 또는 보호 계약 부재, runner/manifest 소비자 확인을 근거로 결정한다. unchanged 검사 전수 목록이나 삭제 할당량은 만들지 않는다.

## 실행과 수용

1. 실제 full build 호출과 테스트 선택/feature 의무를 확인한다.
2. assertion과 제품 경로를 읽어 keep/consolidate/rewrite/retire/remove/defer를 판단한다. 불확실한 검사는 유지한다.
3. 증거가 충분한 테스트 소스와 불필요한 test-only setup만 정리하고 관련 명시적 참조를 맞춘다.
4. 변경한 경계의 가장 작은 실제 검증과 필수 검사로 존속 보호를 확인한다. 새 테스트 파일·coverage 도구·전면 빌드를 추가하지 않는다. 실행한 실제 test 수/exit와 미검증 환경을 구분한다.
5. 새 disposable 자료의 실제 부재, staged diff의 소유 경계, 필수 게이트 유지를 확인하고 task commit 후 결과·남은 불확실성을 보고한다. 테스트 수 감소를 측정된 속도 개선으로 표현하지 않는다.

## 보관 범위 충돌 해결

- 현재 두 retained/incomplete 기록은 `cargo-owner-tests` 전체를 각각 `legacy-input`, `legacy-custody`의 generated:false/protection_known:false로 주장한다. 나머지 자료의 출처를 확정하거나 보호를 낮추지 않는다. 현재 직접 자식 316개 중 확인된 새 fixture 27개만 분리한다.
- 기존 `transferCustody`는 정확한 기존 member root만 선택하며 다른 owner와 겹치면 거절한다. native nested retirement도 같은 owner·완결된 묶음이 필요해 적용하지 않는다. 기존 shared catalog lock/atomic record writer/evidence 검증을 재사용해 Node owner에 `refine-custody`를 추가한다. native 삭제·권한·링크·review/token 규칙은 바꾸지 않는다.
- 요청은 두 owner/revision, 정확한 parent·27개 직접 자식, 외부에 보존한 생성·종료·소비 해제 근거와 새 target owner를 고정한다. target을 pending으로 먼저 기록하고, 기존 parent claim은 나머지 현재 직접 자식의 동일한 unknown-protection claim으로 바꾼 뒤 target을 complete로 마친다. 다른 member·state·보호 값은 보존한다. 중단 시 pending target과 남은 보관 claim이 보호하며 같은 identity로만 재개한다. 기존 기록이 분리한 경로를 ordinary writer로 다시 주장하지 못하게 한다.
- 공통 Node 동작의 Windows/Linux/macOS 의미는 같으며 실제 검증은 Windows x64에서 한다. root는 owner 구현·실제 migration/native 정리·문서를, 독립 executor는 기존 lifecycle test file의 경계/중단 회귀와 disposable 검증 group 정리를 맡는다. 새로운 test file이나 제품 빌드는 만들지 않는다.
- 첫 실제 적용은 과거 DM consumer의 inbound dependency를 발견하여 변경 전에 거절됐다. 해당 consumer의 Oct24 고정 구성 4개는 원래 SHA와 일치하며 별도 workspace/runtime/instruction 경계만 읽는다. 새 Oct27 fixture를 읽지 않는다는 owner/revision/reference identity·외부 증거를 `consumer_exclusions`로 고정하여 분리한다. 기존 consumer 기록·참조는 그대로 보존한다. 미확인/새 소비자, 변경된 owner/revision/ref/경로/증거와 target inbound는 거절한다. source 참조를 해제하거나 pending producer의 종료를 주장하지 않는다.

## 전수 조사와 추가 정리 결과

- source 진입 206개 전체, extension 38개 전체, source 진입이 부르는 artifact/PowerShell/Python 및 provider 하위 검사, 패키지·host의 실제 검사 본문을 읽었다. native 55개 check 진입/31개 wrapper의 Cargo selector를 풀어 현재 `engine/codex-rs`의 선택된 본문·등록·helper와 Windows/Linux/macOS 조건부 경로를 20개 독립 범위로 검토했다. 모든 검토 범위가 완료됐다. `15-audit.json`에 초기 바이트 identity와 현재 identity, 범위·누락 해소·실행 한계를 기록한다. 이는 전체 테스트를 실행했다는 뜻이 아니다.
- `test-local-history.py`는 전체 빌드의 호출 폐쇄에 없으며 유지한다. `verify-work-segment-folding-render.mjs`는 feature의 입력으로만 참조되고 선택된 실행기가 부르지 않는다. 선택된 folding 동작 검사와 package/host 검사 본문은 검토했으며 수동 renderer도 유지한다. 최초 permissions 조사에서 잘못 읽은 `upstream/codex` 결과는 폐기하고 `engine/codex-rs` 전체 해당 범위를 다시 읽었다.
- 오래된 `test-independent-vscode-baseline.ps1`과 `test-independent-vscode-window-safety.cjs`를 삭제했다. 제거된 helper를 추출하고 이미 바뀐 launch 계약을 강제하던 독립 테스트이며 실제 호출자는 없다. 현재 host gate의 `initialInventory`/`hostInstall`/`finalInventory`/`namespace`/`standaloneHost`/`host` 여섯 단계와 runtime path·계정·renderer·프로필 검사는 유지했다.
- URL safety의 마지막 official-host idempotence 사례는 같은 asset·환경 fallback·injector 입력을 쓰는 앞선 pinned-real-host 사례와 동일해 삭제했다. catalog의 세 source 문자열 assertion은 실제 CLI의 잘못된 catalog/누락 모델 거절·상태 미생성 검사에 보호가 남아 제거했다. Python inspector의 같은 `SECRET` 부재 assertion 두 줄 중 한 줄만 제거했다.
- artifact helper의 success/failure/unknown 및 미종료 child 표를 `test-artifact-run.cjs`의 기존 사례로 통합했다. 누락됐던 failed/unknown 초기 상태, 세 outcome의 producer.json exit와 동일 ID 재사용 거절 assertion을 존속 사례에 보존했다. 실제 CLI와 PowerShell guard 실행은 유지하고 writer 소스 문자열 채택 검사만 없앴다.
- 동일 wrapper 안의 중복 선택 네 곳을 정리했다. recovery의 `session_restore_` 세 사례는 모두 `host_approval`에 남는다. model-harness의 explicit Claude 사례는 `claude` 필터에 남는다. deletion 승인 routing은 `tools::approvals::tests::deletion_approval_`로 좁혀 다른 patch 필터와 겹치는 사례만 제외했다. Linux resume network 사례는 `thread_resume::` 등록 아래에 남아 별도 실행만 제거했다. Cargo 준비 recipe와 wrapper hash pin도 함께 맞췄다. 독립 feature 간 반복 선택은 각 단독 gate의 보호를 위해 유지했다.
- Rust 본문 정리: capacity 상태의 sampling 이름만 붙은 same-ID 반복 사례와 reconnect/legacy 반복 사례를 삭제하고, 기존 same-ID reentry/전체 overload sequence 사례를 유지한다. sandbox의 None-mode 단독 사례는 legacy ordering 표에, 세 backend keyword 입력은 더 강한 full-field normalize 표에 남긴다. MCP read-only/Auto 거절은 승인 모드 표의 같은 입력에 남긴다. maintenance empty review의 연속 동일 assertion 한 블록만 없앤다. 네 파일 총 62줄 삭제이며 제품 동작 변경은 없다.
- `test-cargo-test-preparation.cjs`의 `reuse-*`와 `test-cargo-verification.cjs`의 각 command fixture는 `context.after`에 현재 생성한 정확한 디렉터리의 ordinary 제거와 실제 부재 확인을 추가했다. 잠금·권한 우회나 force 옵션을 사용하지 않는다.
- 스크립트 검증: catalog 4개, Cargo preparation 14개, inspector 21개, URL 15개, host instructions 15개가 실제 exit 0이었다. artifact-run 14 check group과 ownership 2 check group도 실제 exit 0이다. 현재 wrapper/preparation 64개는 exit 0/pass64/skip0이며 Win/Linux/macOS 명령 계획을 실제 wrapper와 pinned recipe에서 비교한 추가 검증도 exit 0이다. 이 플랫폼 비교는 VM에서의 명령 계획 검사이며 해당 OS에서 Rust를 실행한 결과가 아니다. host live 설치·전체 native 회귀는 실행하지 않았다.
- 검증 중 도구/기대치 수정: 첫 inspector 호출은 PATH의 `python` ENOENT로 child가 시작하지 않았다. 절대 Python3.12 경로로 실행한 21개 검사는 exit 0이다. producer의 원래 실패 exit1은 성공으로 바꾸지 않았다. model-harness 중복 선택 제거 후 mock의 옛 5회 기대치가 실패했으며 남은 4개 실제 명령 목록으로 맞춘 뒤 64개를 다시 통과했다.
- 통합 검토에서 normal ID 재사용 거절 assertion이 새 표와 중복돼 한 줄을 더 제거했다. 마지막 artifact-run 재실행은 실제 exit0/14 check이며 입력 SHA `14feb2f58c206dea127caa176877443e2e7b4234e86ca2ab15836f9ad1840cf2`가 전후 같다. 새 fixture의 여섯 멤버는 삭제·finalize/부재 확인을 마쳤다. 다른 네 집중 검증은 입력이 같아 재사용했다.
- Rust 최종 집중 결과는 Windows x64/toolchain1.95.0에서 실제 exit0이다. sandboxing 8개, MCP 1개, maintenance groups 1개, capacity 컴포넌트 4개를 실행했다. typecheck/list/runtime 각각 sandboxing 60.335/28.024/4.800초, MCP 99.073/218.360/29.059초, groups 6.430/9.786/2.739초였다. capacity의 정확한 std-only 파일을 `rustc --test`로 컴파일한 시간은 0.301초이며 whole-core 통합 통과를 뜻하지 않는다. 전체 runner 경과는 03:47:57.621–03:55:36.745 UTC(약 459초)이며 겹치는 시간의 합을 총 경과로 사용하지 않는다. 새 source 경로 때문에 일부 의존성이 다시 컴파일됐다. 최저 관측 여유는 22,063,874,048바이트다.
- frozen 입력의 편집 후·실행 후 전체 출처 SHA `45e93f8d16a5c53d4ac5beeb2e49c8dff2af573511e43c52abe69810cf1f7713`와 receipt가 같으며 source/helper bytes도 고정됐다. Cargo lease는 해제됐고 pending snapshot은 없다. 첫 one-off harness는 없는 선택 입력 `.cargo/config.toml`을 필수처럼 읽어 Cargo 시작 전에 실패했다. 실제 engine config는 frozen tree에 포함되어 있으며, 선택 입력 처리를 바로잡아 검증을 진행했다. 이 실패와 실제 검증 성공은 별도 증거로 남긴다. 독립 요약은 `test-cleanup-full-rust-verification.json`이며 전체 native나 다른 OS가 통과했다고 해석하지 않는다.
- native 현재 출처 전체 검증은 편집 전 exit 0/9,326파일이었다. 원래 SOURCE receipt SHA는 `57c554cd56b56cb87d313fdf806b6d6a80f8c6dad569bac304f133f0a0f544fb`다. 첫 recorder 시도는 이미 receipt에 있지만 Git에서 untracked인 `is_deletion_command.rs`의 index mode 때문에 92.132초 후 exit1이었다. 내용·receipt 일치를 확인하고 recorder 동안만 index mode를 맞춘 재시도는 66.721초/exit0이며, 해당 파일을 원래 untracked 상태로 복구하고 내용 SHA도 그대로임을 확인했다. 새 receipt SHA는 `b552b0aa3456ad225480e745bc18d8336faf1948d42754a49ade8e574f4ef1d0`다. 전후 files map은 정확히 네 파일만 달라지고 추가·삭제는 없으며 originalReceipt도 동일하다. 기존 staged 네 파일과 내용은 보존한다. 독립적인 `artifacts/tasks/test-cleanup-full-rust-20261027` 소유의 새 frozen source로 집중 컴파일/실행을 확인하며, 과거 binary를 현재 소스 통과로 재사용하지 않는다.
- 생성물 정리: 다섯 집중 검사의 fixture group은 optimized native owner의 fresh review/apply로 전부 삭제·finalize했고 모든 여섯 멤버 경로가 부재다. 독립 증거는 `artifacts/tasks/dw13-build/test-cleanup-full-verification.json`에 있다. teardown 추가 전 세 mock 실행이 만든 27개 Cargo fixture(13,586바이트)는 `test-cleanup-full-cargo-fixture-cleanup.json`의 생성·종료 근거와 현재 tree·파일 해시가 일치했다. 두 과거 보관 claim을 지원 writer로 분리했고, 미확정 나머지 289개 경로와 기존 소비자의 bytes·참조를 보존했다. 현재 teardown 검증은 새 아홉 fixture의 종료 제거 assertion을 모두 통과했다.
- Rust 검증 생성물 정리도 native apply 실제 exit0/group deleted/remaining false이며 `artifacts/tasks/test-cleanup-full-rust-20261027`의 실제 부재와 lifecycle finalize의 remaining[]/references[]/blockers[]를 확인했다. frozen source·runner·binary·raw logs 등 104,418,765 logical bytes를 삭제했고 archive는 없다. 기존 warm Cargo cache는 원래 owner 아래 후속 빌드에 재사용하며 lease는 없다. 독립 검증·정리 요약과 필요한 control evidence는 진행 중인 DW13 report owner에 남긴다. 마지막 diff 검사 exit0, URL EOF 공백 정리 후 재실행 15개/exit0/2.469초다.
- 최종 사용자 결정은 “삭제하지 말고 archive로 옮겨주세요”다. 실제 native 삭제 실행과 관측한 worker를 중단했고, 전체 tree 종료를 별도로 확인해 두 abandoned sentinel을 지원 `recover_lock`으로 복구했다. 원래 apply는 exit4294967295/261.368초의 중단 결과이며 성공으로 바꾸지 않는다. 중단 전 durable 삭제 결과 21개와 실제 부재가 일치했고 남은 6개는 제어 파일 5개와 ordinary `Move-Item`으로 옮겼다. 내용·dev/ino·원래 경로 부재와 unrelated index 4파일 불변을 확인했다. 독립 근거는 `test-cleanup-cargo-archive.json` 및 `test-cleanup-cargo-refinement-result.json`이다.
- archive는 기본 lifecycle/관리 경계 밖이므로 primary allowlist를 넓히지 않았다. archive 전용 작은 `project-maintenance.json`과 pending 관리 기록을 두고, 이동 후 완전 구성으로 native 재등록·fresh review·명시적 defer했다. archive의 payload는 20,820바이트이며 관리·이동 영수증은 별도 보호한다. 재검토 조건은 사용자의 archive 정리 요청 후 해당 전용 관리 루트에서 현재 참조·소유권을 재검토하는 것이다. 원래 27개 native 항목은 remaining:false로 재등록했고 빈 producer record는 지원 finalize로 정리했다. 새 삭제는 하지 않았다.
- 소유권 기능의 기존 lifecycle 검사에 경계·소비 참조 보존·중단 재개 보호를 추가했다. 이 검사는 반복적인 보관 이관에서 권한 없는 소유 변경과 중단 후 자료 손실을 검출하므로 유지한다. 실제 Windows x64 전체 lifecycle122/122, paired platform12pass/1플랫폼skip은 exit0이며 다른 OS 실행은 검증하지 않았다. 최초 누락된 pwsh는 공식 portable7.4.13의 SHA·실행 버전을 확인해 검증했고 도구·로그·fixture는 당시 owner 정리로 실제 삭제했다. 최신 archive 지시는 그 후 남은 자료에 적용했다.
- 커밋 경계: 이번 소유권 writer·회귀·운영/아키텍처의 해당 부분과 작업 기록만 별도 커밋한다. 기존 다른 작업의 staged 4파일은 그대로 복원·확인한다. 앞선 전수 정리의 `check-selected-upstream-native.cjs`와 `check-deletion-approval-native.cjs`는 시작부터 untracked였고 이번 소유는 각각 중복 selector 한 부분뿐이다. `engine/SOURCE.json`도 기존 미커밋 delta가 크므로 파일 전체를 이번 변경으로 stage하지 않는다. recorder 직전 receipt의 Git blob은 `926892b64ac99b33396094497084dc2d9450a4c4`이고 해당 files-map delta는 정확히 네 Rust 파일이다. 이 앞선 테스트/receipt 변경의 분리 커밋은 남아 있으며 unrelated code·index를 이번 커밋에 섞지 않는다.

## 앞선 부분 조사와 정리 결과

- full current/standalone 선택은 현재 policy 기준 159 소스 파일, exhaustive는 160 파일이며 extension-all이 별도다. 이 수는 삭제 목표가 아니며 유지할 검사 전수 목록을 새로 만들지 않는다.
- 통합: `test-deploy-azrael.ps1`의 `temporary references preserved`는 `full install`과 동일한 성공 설치 인자·경로를 실행하고 다른 temporary 소비자 참조만 추가했다. 그 참조 생성과 모든 참조 보존 assertion을 `full install`로 옮겨 동일 워크플로를 한 번만 실행한다. 기타 정상 설치·검증·필수 여섯 host 결과와 실패 게이트는 그대로다. 이름 소비자는 해당 fixture뿐임을 확인했다. 이 사례는 실패를 이유로 없앤 것이 아니며 이전 r8에서 실패한 참조 보존 검사는 존속한다. `verify only`/`parallel prepare`는 스케줄 조건과 명시적 mandatory 소비자가 달라 유지했다.
- 제거: `test-ui-input-diagnostics.cjs`의 `loaded-turn scan timing is bounded and recorded`는 1,000회 같은 결과를 확인하고 시간을 출력할 뿐 시간 임계값이 없다. 같은 snapshot 기능은 `identity remains while representations change...`가 검증하고, 실제 500 ID/10,000 항목 상한과 rate/repeat/render 캐시 한도는 해당 기능 검사에 남긴다.
- 개선: `test-asset-transform-cache.cjs`의 generic descriptor case는 두 경로가 같은 `runProviderContext`를 호출해 동일 no-op도 통과했다. 입력의 settings descriptor는 `Azrael settings`로 바뀌고 RPC/URL 문자열은 원래대로 남는 독립 expected text를 두 공개 경로에 확인한다. marker idempotence와 cache fingerprint invalidate/hit assertion은 유지한다.
- 보존/미결정: Node source 선택기·fixture·task-time 직렬화와 UI 경계는 서로 다른 결함을 잡으므로 삭제하지 않는다. provider-context의 pipeline parse는 cache 행렬과 경계가 달라 유지하며 조건부 실행되는 행렬만을 근거로 cache 검사를 없애지 않는다. Native feature별 wrapper의 동일 Cargo selector는 실제 중복이 있지만 단독 feature 선택과 check ID별 의무가 있으므로 이번 테스트 소스 정리에서 삭제하지 않는다. 교차 check 실행 결과 공유는 별도 설계 범위다. PowerShell의 출처/배포 wiring 검사는 스타일만으로 제거하지 않는다.
- 깊은 검토는 위 후보와 존속 검사·호출 경계를 중심으로 수행했다. 나머지 큰 queue/recovery/student-design 및 upstream Rust assertion을 모두 줄 단위로 검토했다는 뜻은 아니다. 추가 후보는 증거가 충분할 때 후속 정리한다.
- 이번 Node 검증의 cache fixture는 기존 `test-asset-transform-cache.cjs` 소유 `artifacts/cache-scope-test-<mkdtemp>`에서 생성돼 existing after hook의 ordinary 제거로 종료됐다. 실행 전 해당 생성 경로와 cleanup owner를 선언했으며 새로운 유지 fixture나 테스트 파일은 추가하지 않았다. 결과 로그·독립 요약은 기존 빌드 작업 소유 `artifacts/tasks/dw13-build/test-cleanup-*`에 둔다. PS fixture는 `run:deploy-checks:9ca1f9da00444db490e5c1afb2f59c86`이 `artifacts/tasks/deploy-checks/runs/tc15-r1`과 정확한 shortTemporary를 소유했으며 실제 exit 0/1 case 확인 뒤 supported close/native review/apply로 삭제·finalize했다.

- 검증 실제 결과: 통합 `full install` workflow 1개(PS7, session 17823) exit 0; generic label contract 1개(Node26.7) exit 0; diagnostics snapshot/한도 2개 exit 0. 새로운 cache-scope-test prefix 경로는 existing after hook 종료 후 0개임을 확인했다. `test-cleanup-verification.json`(SHA `b41e182ab126c3cbf22365ed379bc1a9d6df3a1fa9bf0d116e745d54d03a9aae`)에 현재 test hashes·모의 설치 metrics·선택한 version 참조 해제/다른 version 참조 보존 증거를 독립 보존했다. PS producer supported close success/exit0/revision3/ref[] 완료.
- 정리 차단: dx05 SHA를 다시 확인하고 register 실제 exit 0/6.352초, fresh registered review exit 0/5.335초였다. `C:/Users/felre/Desktop/pi-harness-init/artifacts/t-9ca1`은 0바이트 빈 디렉터리지만 PRIMARY managed_roots 밖이라 `outside configured managed roots`로 차단됐다. 같은 그룹의 `C:/Users/felre/Desktop/pi-harness-init/artifacts/tasks/deploy-checks/runs/tc15-r1`(408,859 logical bytes)도 그룹 보호로 함께 차단됐다. 삭제·archive·직접 API 우회는 수행하지 않았다. 이전 r7의 shortTemporary는 PRIMARY의 `artifacts/workspaces` 아래라 삭제 가능했던 것으로, 현재 위치에 적용 가능한 예외 절차는 없었다.
- 승인된 추가 범위: `project-maintenance.json`의 다른 현재 변경은 보존한 채 정확한 빈 `artifacts/t-9ca1`만 임시 관리 경계로 추가하고 native `retire_managed_roots`의 현재 증거·fresh review/apply로 이 그룹을 정리한 뒤 그 임시 경계만 제거한다. 상위 `artifacts` 전체 경계 확장이나 다른 폴더 삭제 권한을 뜻하지 않는다. 사전 config SHA `bb5cb61aa3b117feb46099407b7bb8fd355a0df394e032a7a905e8e699e0654a`, 임시 config SHA `f85e9848a8ea39be615188c192526aa60327c3f776caccde4359ac40a2e5b464`로 기록했다. 보호된 관리 근거는 `artifacts/maintenance/evidence/test-cleanup-tc15-r1-retirement.json`이며 정확한 item 하나의 경계 폐기와 승인·검증 identity를 포함한다. 새 retirement review actual exit 0/5.949초, 두 expanded 멤버 blockers[]를 확인한 fresh token으로 delete를 한 번 시작했다.
- 승인 범위의 정리 실제 결과: retirement apply(session 13703) actual exit 0, aborted false, 두 native 항목 모두 deleted/remaining false/error 없음. 원래 producer의 5개 멤버 경로는 전부 lstat ENOENT이며 supported finalize 결과 remaining[]/references[]/blockers[]다. 임시 `artifacts/t-9ca1` 설정 한 줄만 제거한 config SHA가 작업 전 `bb5cb61aa3b117feb46099407b7bb8fd355a0df394e032a7a905e8e699e0654a`와 같아 다른 현재 설정을 정확히 보존했다. archive·cleanup 잔여물 없음. 독립 결과는 `artifacts/tasks/dw13-build/test-cleanup-cleanup-result.json`, 경계 폐기 근거는 보호된 bounded management evidence 아래 보존한다.
- Git stage는 이번 3파일의 정확한 부분 7추가/10삭제와 이 작업 문서만 포함한다. 기존 다른 작업의 staged 4파일 및 각 파일의 사전 수정은 보존한다. 실제 정리 완료 후 일반 task commit을 수행하며 push/빌드/설치는 하지 않는다.

원래 빌드·설치는 여전히 미완료이며 이번 정리 통과가 제품 빌드 통과를 뜻하지 않는다.

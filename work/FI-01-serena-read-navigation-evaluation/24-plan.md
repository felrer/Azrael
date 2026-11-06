상태: 현재 변경을 포함한 출처 정합성 갱신·관련 검증 진행 중. 사용자는 제품 빌드를 제외했다. 패키징·설치도 실행하지 않으며, 기존 native 결과를 재사용하고 소스 검증·task commit·필요한 정리를 마무리한다.

# v5 이름 검색 기본 도구와 공통 프롬프트 반영 계획

## 확정된 입력과 빌드 제외

제품 빌드 사전 검사에서 현재 고정 engine의 `SOURCE.json`과 실제 파일 20개가 달라 `Copied source differs: codex-rs/app-server/src/azrael_shared_server.rs`로 actual exit1을 확인했다. 대상은 로그인·계정·유지관리의 다른 작업 변경이며 `find_names` handler/helper는 기존 승인 SHA와 같다. 원본 소스·출처 영수증과 실행 중 native 입력은 변경하지 않았다.

사용자는 현재 변경을 함께 포함해 검증하는 방향을 선택한 뒤 빌드는 하지 않는다고 정정했다. 따라서 현재 20개 파일의 출처 정합성과 필요한 소스 검증까지 수행하며 제품 컴파일·패키징·설치와 설치 후 수용은 이번 실행 범위에서 제외한다. 새 Cargo 컴파일은 시작하지 않는다. 기존 native 검증 이후 해당 20개 파일 및 SOURCE.json의 내용은 달라지지 않았음을 확인했다. 사전 검사 run `artifacts/tasks/FI-01-find-names/runs/preflight-20261106`은 출처 불일치 원인 확인에 필요한 진단 묶음이며 사용 종료 후 owner 정리한다.

## 목적과 권한

사용자는 v5를 Azrael 기본 도구로 반영하는 계획과 지침 수정안을 검토하고 “좋습니다. 구현해주세요”로 구현·검증을 승인했다. 최신 지시에 따라 제품 빌드·패키징·설치는 제외한다. 직전 단순 v5 1회 결과는 기존 대비 전달 출력7.4%·입력 증가5.1%·누적 입력15.6%·일반 입력2.5% 감소, 요청7→6·도구6→5, 핵심 답변 유지였다. 단일 실험과 시그니처 미사용 결과이므로 일반적 비용 절감이나 시그니처 효과를 보장하지 않는다.

## 권장 범위와 유지 계약

첫 반영은 현재 검증된 JS/TS(.js/.jsx/.cjs/.mjs/.ts/.tsx/.cts/.mts) 이름 검색이다. Rust/Python 등은 기존 검색 경로를 유지하고 지원 확대를 추정하지 않는다. find_names(relative_path, query, include_signature=false)를 기본 read-only 도구로 제공한다. 이미 아는 한 파일의 선언 이름에 Unicode casefold 리터럴 부분검색을 적용하며 함수·메서드·클래스·callable initializer·파일 최상위 변수/상수를 현재 v5 기준으로 포함한다. 매개변수·일반 지역변수·일반 필드·import alias·interface/type/enum·익명 callback 자체는 제외한다.

기본 응답은 [id,start,end], 줄은1-based inclusive다. include_signature=true일 때 callable만 네 번째 필드로 축약 시그니처를 추가한다. 명시적 반환 타입·매개변수·기본값 등을 보존하고 타입을 추론하지 않는다. 빈 query로 전체 목록 반환·본문 반환·펼치기 API는 추가하지 않는다. rg/terminal 사용과 파일 전체 읽기를 막거나 800줄 기준을 추가하지 않는다.

## 제품 구현 경로와 중요한 선행조건

실험 v5의 AST parser는 scripts/serena-name-metadata-v5.cjs와 serena-name-positions-v4.cjs를 재사용할 수 있다. 다만 native id는 별도 Serena get_symbols_overview/get_name_path에서 온다. 현행 extension의 TypeScript는 devDependency이며 기존 제품 AST bridge나 Serena ID provider는 확인되지 않았다. 단순 스크립트 등록만으로 배포 런타임·ID 호환성이 확보된 것으로 보지 않는다.

권장 제품화 경로는 검증된 TypeScript AST 자산을 전용 검색 helper로 묶고 기본 native handler에서 호출하는 방식이다. 첫 단계에서 기존 runtime을 재사용할 실행 경로·배포 의존성을 고정하고 기존 ID·선언 범위·줄 범위·시그니처와 대표 fixture/App 결과의 동등성을 오프라인 확인한다. 기존 개발용 node_modules나 사용자 전역 Python/Serena 설치를 제품 전제로 두지 않는다. 별도 실험용 engine을 제품 기능 실행마다 띄우지 않으며 helper 수명은 단순하고 제한된 형태로 설계한다.

제품 helper는 메모리 내 TypeScript 5.9.3 language service의 navigation tree와 기존 AST 분류를 재사용한다. 기존 fixture14개 및 App15개 결과와 ID·범위·시그니처가 일치했다. 별도 실제 provider 1회로 접근자와 overload를 확인했으며 getter/setter는 `Box/width[0]`, `Box/width[1]`, 본문 있는 method overload는 `Box/method[2]`를 유지한다. top-level exported overload가 기존 v5에서 누락되는 한계는 이번 호환성 반영에서 그대로 유지하고 지원 확대와 구분한다. 상시 Serena/LSP 서비스는 제품에 추가하지 않는다.

파일 접근은 제품 sandbox/읽기 권한의 기존 소유 경로를 거친다. 실험의 프로젝트 경로 포함 검사만으로 이를 대신하지 않는다. 경로 탈출·symlink·권한 거절·파일 변경을 처리하고 오류를 전체 파일 자동 반환으로 바꾸지 않는다.

## 기본 도구 등록

등록 소유 경로는 engine/codex-rs/core/src/tools/spec_plan.rs의 build_tool_router/add_core_tool_sources와 tools/registry.rs의 ToolRegistry다. 공통 registry에 read-only handler와 간결한 schema/help를 등록하고 기존 코드 모드 register_code_mode_executors를 통해 functions.exec 안에서도 같은 도구를 호출하게 한다. 메인/서브에이전트, default tool profile, provider별 변환에 같은 원래 도구 계약을 사용하며 기존 tool policy·권한·도구 없는 세션은 보존한다. 모든 provider에서 항상 노출된다고 가정하지 않고 유효한 tool mode와 정책을 검증한다.

도구 도움말 제안:

Find JS/TS declaration names in one file using case-insensitive literal matching. Returns [id,start,end]. Set include_signature=true for compact callable signatures. Query must be non-empty. Does not search or return source bodies.

도구 설명에 지원 언어·검색/반환 계약·옵션을 두고 공통 행동 프롬프트에는 역할만 짧게 둔다. 결과가 없으면 []를 반환하며 오류는 명시한다.

## 공통 프롬프트 수정안

instructions/instructions/agent-behavior.md의 Rules for getting work done 아래 현재 첫 문구는 다음과 같다.

Prefer `rg` or `rg --files` for searching source code and project files. Use another tool when it is better suited to the search target or execution environment.

이를 아래 한 항목으로 교체하는 것을 권장한다.

Use the available tools efficiently. Use `find_names` when helpful for declaration-name searches in supported source files, `rg` for text searches, and `rg --files` for file discovery.

직역: 사용 가능한 도구를 효율적으로 사용하세요. 지원되는 소스 파일의 선언 이름을 검색할 때 도움이 되면 find_names를, 텍스트 검색에는 rg를, 파일 탐색에는 rg --files를 사용하세요.

특정 도구 사용을 강제하거나 사용 순서·파일 크기·추가 조회 횟수를 규정하지 않는다. 시그니처 기본값 false와 필요한 때만 요청한다는 설명은 도구 schema/help에 둔다. 공통 문구는 기존 도구 효율 지침과 같은 위치에 두어 rg 우선 문구와 충돌하지 않게 한다.

동일 embedded copy인 engine/codex-rs/prompts/templates/agent_behavior.md도 함께 갱신하고 scripts/test-common-agent-instructions.cjs로 일치를 확인한다. engine/codex-rs/prompts/src/model_instructions.rs가 이를 포함하므로 기본 프로필에서 반영된다. 사용자 custom behavior template을 덮어쓰지 않으며 optional lean 등 별도 내장 behavior는 기존 프로필 소유 정책에 맞춰 최소 정합성을 확인한다. AGENTS나 skill에 중복 규칙을 추가하지 않는다.

## 구현·검증·배포 순서

1. 기존 자산 재사용과 ID/AST 동등성·런타임 배포 경계를 확인한다. 미확정 ID/의존성 변경이 필요하면 먼저 합의한다.
2. 공통 registry/읽기 권한/선택된 helper를 연결하고 기본·코드 모드 도구 계약을 등록한다.
3. 공통 지침의 소유 원문과 embedded copy를 갱신하고 도구 도움말을 간결하게 유지한다. 제품 owning architecture와 scripts/azrael-feature-contracts.json의 보존 owner/check를 연결한다.
4. 기존 fixture를 재사용해 casefold/이름만 검색/대상 포함·제외/빈 query/시그니처 옵션/범위/파일 변경·경로·sandbox를 최소 검증한다. core/src/tools/spec_plan_tests.rs에서 native·코드 모드 노출, 메인/서브·provider mapping·도구 없는 모드 보존을 확인한다. 지침 동일성 및 변경된 parser/helper의 실제 제품 경계를 확인한다. 별도 대규모 성능 실험·캐시 가드·진단 인프라는 추가하지 않는다.
5. 검증된 변경분을 기존 빌드·설치 절차로 반영하고 기본 도구로 직접 호출되는지 작은 smoke test를 한다. 빌드·설치 대상과 사용자 재시작 시점은 승인된 실행 계획에서 명시한다. 임시 자료는 기존 owner로 정리하며 관련 변경만 task commit한다.

## 플랫폼과 수용 한계

공통 검색 의미는 Windows x64·Linux x64(glibc)·macOS ARM64 목표에 맞추고 검증된 플랫폼을 구분한다. 기존 v5 실험은 Windows x64뿐이다. runtime/helper 패키징과 sandbox·경로 처리의 플랫폼별 확인 전 다른 플랫폼 완료로 표시하지 않는다. Windows regression을 포함하며 플랫폼 계약의 mandatory gate를 보존한다. 사용자 VS Code 종료의 원인은 미확정이고 이번 기능 계획의 성공으로 그 원인을 설명하지 않는다.

제품 기본 도구로 등록한 뒤 작은 직접 호출에서 노출·실행을 확인한다. 별도 모델 성능 실험이나 캐시 감시 인프라는 추가하지 않는다. 실험의 수치가 기본 도구 통합 후 그대로 유지된다고 보장하지 않는다.

## 실행 소유와 현재 검증

- Root: 공유 계약, 공통 지침 두 사본, architecture 및 feature inventory, 통합·최종 수용과 task commit. 기존 unrelated staged37개와 선행 수정은 보존한다.
- Native owner: handler·등록·선별 Rust 검증. Helper owner: 순수 Node parser·casefold·ID 동등성. Packaging owner: 기존 Node/host runtime·플랫폼 패키징 연결과 직접 검사. Run owner: 이 작업의 artifact lifecycle과 실제 ID probe. 각 owner는 겹치지 않는 변경을 담당하며 재위임하지 않는다.
- 제품 runtime closure는 helper, TypeScript5.9.3와 license, Unicode15.1.0 casefold1,530개 매핑과 notice다. Python은 개발 시 생성에만 사용하며 제품 의존성이 아니다. `AZRAEL_FIND_NAMES_NODE`/`AZRAEL_FIND_NAMES_HELPER`는 기존 host 소유 경로에서 연결한다.
- 작업 자료 소유 경로: `artifacts/verification/find-names-product-20261103-7f4a91c2`, lifecycle `run:serena-read-eval:20261103:product-7f4a91c2`. 이전 중단 run22는 별도 보호 상태로 유지한다.
- 공통 지침 동일성5/5 exit0. Helper 계약 및 기존 actual gold 비교 exit0. 최종 helper SHA256은 `81d209df5c8110d753387306c675f6f32984cd8e61fae4f3b41904ff7efd6917`이며 edge6query·fixture14·App15 결과가 실제 gold와 일치했다.
- Windows runtime/Devin/ordinary30/30, host source16/16, Python portable package1/1 모두 exit0. Extension TypeScript5.9.3 전체 noEmit도 exit0(`logs/extension-types.log`). JS5개 syntax 및 PowerShell4개 parser 오류0. Transpile 기반 host 검증과 실제 설치 수용은 구분한다.
- PS installer fixture의 환경 차단은 해소했다. 설치된 PowerShell7.6.9의 실제 WindowsApps 경로를 사용해 Python3.13의 portable closure와 recipient PrepareOnly relocation/same-version refusal 검사 2개가 13.357초/actual exit0으로 통과했다. 실행정책은 변경하지 않았으며 실제 사용자 설치 수용과 구분한다. 독립 결과는 `24-verification.json`에 보존했다. 사용이 끝난 `installer-20261106` run은 검증된 ff01 owner의 register/review/apply(actual exit0)로 정리했고 논리2217bytes/deleted/remaining:false와 실제 경로 부재 및 lifecycle finalize를 확인했다.
- 실제 ID edge probe는 driver/backend exit0, 정상 shutdown, 관측29개 정확 프로세스 잔존0. engine/app-server/model 실행은0회였다. 결과는 run의 `outputs/native-id-edge/result.json`에 보존했다.
- Native 선별 Cargo는 기존 shared cache 복구 후 새 고정 입력으로 실제 실행했다. 첫 `find_names`4개, reviewer policy4개, tool-free1개, 실제 packaged helper1개, missing-runtime1개가 모두 통과했다(5묶음/11개, 각 actual exit0, coordinator exit0). 최초 묶음의 ignored2개는 뒤의 전용 두 실행에서 실제 통과했다. 새 Cargo target이나 성능 실험을 추가하지 않았다.
- Helper의 method multi-span 동등성 보완과 stable closure 인계 완료. `tool.find-names` feature owner/source/native checks 및 Cargo `selected-tests-v2` wrapper를 등록했고 manifest validation exit0. 유지 검사는 parser 교체 시 이름-only·ID/옵션 누락과 build/host 변경 시 runtime closure·환경 연결 누락을 막는 데 한정한다.
- 공유 Cargo 복구 완료: `fa17-20261103-r10`의 coordinator62148/token23e94cf3-62bb-4bae-bceb-ebbcb89e823f가 시작된 뒤 Windows가 2026-11-05 17:21:37 KST에 재시작했다. `Win32_OperatingSystem.LastBootUpTime`으로 해당 로컬 프로세스 트리 전체 종료를 확인하고 `recoverTargetOwner` → `recoverExecution`을 실행했다(actual exit0). 정확한 lease 부재와 lifecycle revision221/restart authorization을 확인했으며 이전 결과는 stopped/unknown/null로 보존했다. 복구 증거·영수증은 `artifacts/tasks/FI-01-find-names/runs/recovery-20261106-boot/reports/`에 있으며 캐시 재시작에 필요한 참조 자료다.
- 재개 입력: helper와 native handler의 SHA256은 기존 검증값과 같다. 11월 3일 이후 공유 checkout 변경은 별도 작업으로 보존한다. native 검사에서 전체 engine identity가 달라졌으면 기존 frozen snapshot을 수정하지 않고 기존 checker의 새 소유 run/동결 입력을 사용한다. 대상은 기존 5개 선별 Rust 계약이며 새 성능 실험·캐시 감시·별도 Cargo target은 추가하지 않는다.
- native 재개는 2026-11-06 11:38 KST에 시작했다. `node scripts/check-find-names.cjs`, `CARGO_HOME=artifacts/ch17`, jobs2, toolchain1.95.0, 기존 물리 shared96 cache를 사용한다. work completion `c89e5a0d-2f59-4713-9bd4-f75d6153ddd5`, executor session27319, run `artifacts/tasks/FI-01-find-names/runs/20261106T023830465Z-52f61339-9ee1-497a-8852-badf36ec227d`, 새 고정 engine `artifacts/verification/fn-074404ce/engine`이다. 전체 현재 source SHA는 `dba174993424ca03a4d87d819d20550b7084ab253646bbeb9330aada76a5bce4`로 이전과 달라 이전 snapshot을 변경하지 않았다. 첫 확인 시점은 11:53 KST이며 실제 종료 전 검사 통과로 표시하지 않는다. native 결과가 제품 빌드·설치의 선행조건이다.
- 11:53 KST 체크포인트: source freeze 완료, 최초 `find_names` 테스트용 실제 Cargo는 11:40:04에 시작했다. 관측 시 rustc2개/가용RAM 약11.4GiB였으며 실제 컴파일이 진행 중이다. 결과·종료코드는 아직 없고 다음 확인은 12:08 KST 또는 completion event다. 현재 checker의 report는 동기 child 반환 전 상태이므로 중간 `accepted:false`나 `producerStopped:true`를 terminal evidence로 사용하지 않는다.
- native 최종 결과: 12:11 KST에 5개 묶음 모두 acceptedtrue/actual0, 종료와 source/frozen/helper 불변을 확인했다. 전체 경과 약32분이며 대부분 최초 test compilation에 사용했고 재실행은 없었다. 상세 명령·실제 테스트 수·report SHA는 `24-verification.json`에 보존했다. 검사 run과 고정 engine은 배포 입력 선택 및 이후 수용에 필요한 현재 handoff 자료이며, 선택 후 사용이 끝나는 묶음은 기존 owner로 정리한다. 최초 symlink 경계와 최종 package/설치/direct smoke, Linux/macOS는 별도 미검증 범위다.
- 실제 파일 변경 감지는 별도 controlled fault 1회로 확인했다. 제품 소스를 수정하지 않고 검증된 원 helper가 테스트 소스를 해석한 뒤 정확한 소유 fixture만 변경하는 임시 wrapper를 사용했다. handler가 `File changed during name search; request find_names again`으로 거부했고 예상한 Cargo exit101/실패1개와 harness exit0을 관측했다. 이는 정상 native11개 통과와 분리한 의도적 오류 검사이며 원 실패 결과를 성공으로 바꾸지 않았다. 독립 원인·범위·출력/임시 wrapper SHA는 `24-verification.json`에 보존했다. 소모성 probe 묶음은 검증된 ff01 owner의 register/review/apply(actual0)로 논리1,422,058bytes/deleted/remaining:false 및 실제 경로 부재와 lifecycle finalize를 확인했다.
- 다음 인계: 배포 입력 선택 답변 → 선택한 소스의 출처 검증·미검증 경계 확인 → 기존 제품 빌드·설치·직접 smoke → owner cleanup/task commit. 최종 수용이 남아 전체 완료가 아니며 작업 run은 현재 handoff·진단에 필요한 보호 자료다. 이전 run22 및 unrelated 변경을 건드리지 않는다.

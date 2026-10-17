상태: 승인된 레거시 정리와 Windows source/mock 통합 검증 완료. 사용자 추가 조치 없음. 실제 native engine·Linux/macOS 검증과 제품 빌드·설치는 수행하지 않았다.

# 엔진 검사 레거시·삭제 후보 조사

사용자 요청은 현재 엔진 검사에 남은 레거시 단계와 불필요한 검사를 조사하는 것이다. 이전 빌드 효율화와 연결된 별도 후속 조사이며 이후 사용자가 권장 정리와 문제 해결을 승인해 기존 보호 동작을 유지하며 실행한다.

공통 검사 선택기·feature inventory·Windows 배포 경로와 수동 엔진 fixture를 대상으로 실제 호출자, 보호 계약, 대체 검사와 공백을 확인한다. 현재 소스는 docs/ops/development.md가 선택하는 engine/ 통합 0.162.0이다. Windows x64에서 파일·호출 경로를 조사하며 네이티브 빌드나 Linux/macOS 동작을 검증하지 않는다.

root는 배포·등록·중복 검사 선택과 통합 판단을 담당한다. 읽기 전용 조사 담당은 source-test-policy의 레거시 조건 및 구형 provider fixture를 각각 독립 확인한다. 기존 BW-01 및 시작 실패 조사 변경은 보존한다.

완료 조건은 후보마다 실행 여부(기본/전체/명시 수동), 보존 동작, 대체 증거와 공백, 삭제·조건부 실행·유지 추천을 제시하는 것이다. 테스트 이름이나 오래된 파일이라는 이유만으로 폐기를 권하지 않는다. 제품·지속 설계 변경이 없으므로 현재 architecture 계약은 수정하지 않는다.

## 확인된 실행 구조

현재 working tree의 feature manifest에서 area=engine은 22개 기능, 49개 검사(source 15/native 34)다. 상위 원본 엔진 전체 Rust 테스트를 전수 평가한 수치는 아니다. 현재 HEAD는 702a2cfc이며 BW-01의 manifest/engine 변경이 별도로 진행 중이다.

배포의 source-preflight는 source만 먼저 실행하고, post-build preservation은 sourceReceiptPath로 입력·명령·로그를 검증해 source 결과를 재사용한다(deploy-azrael.ps1:259–292, feature-preservation.cjs:312–318,402–412). 이 두 단계를 그대로 중복 실행으로 간주해 없애면 안 된다. 빌드 전/후 provenance도 각 시점의 입력/바이너리 경계를 확인하므로 이름만 중복이라는 이유로 삭제할 수 없다.

## 통합·실행 축소 후보

| 후보 | 확인한 증거 | 권장안과 조건 |
| --- | --- | --- |
| Python 오류/컨텍스트 진단 검사 | engine.provider-context.safe-context-export는 python <동일.py>, engine.error-classification.export는 python -B <동일.py>다. runner는 executable+args 전체로 묶으므로 두 번 실행된다(azrael-feature-contracts.json:2387,2883; feature-preservation.cjs:342). | 두 등록의 명령을 python -B로 통일해 한 번 실행하고 두 feature 결과를 유지한다. 테스트 내용 삭제가 아니라 가장 명확한 중복 실행 제거 후보다. |
| 공통 agent 지침 검사 | test-common-agent-instructions.cjs가 parent-requests.guidance, model-harness-profiles.mapping, project-maintenance.adapter의 서로 다른 Node 묶음에 포함돼 현재 argv 기반 묶음으로 합쳐지지 않는다. | 공통 파일을 동일 argv의 공유 검사로 추출하고 모든 feature ID에 결과를 연결한다. provider mapping과 project-maintenance의 다른 테스트는 유지한다. |
| source runner와 feature gate의 반복 | 순수 select({areas:[current,standalone],changed:[],policyChangedPaths:[],exhaustive:false,deferPreservationCacheOwner:true}) 조회에서 131개 파일이 선택되고 common-agent-instructions, recovery-state, cargo-verification, cargo-target-owner, cargo-scheduling 5개 모두 포함된다. 이 파일들은 engine source preflight에도 등록돼 있다. 실제 테스트는 실행하지 않았다. | file 목록 중복만으로 자동 제외하지 않는다. command/filter/env/runtime/input/로그 증거를 묶어 동일성 입증 후 한 실행의 결과를 두 소비자에 연결한다. 현재 sourceReceiptPath는 일반 test-project 결과까지 재사용하는 계약이 아니다. |
| check-engine.mjs | 초기화·fresh logged-out account·config write/read와 disk path·empty thread list 4종 smoke다. check-management.mjs:116–160과 처음 3개가 크게 겹치지만 동일한 fresh-state empty thread 보장이 대체됐다는 증거는 없다. | 누락된 fresh logged-out empty thread assertion을 management에 합치고 실행 계약·운영 문서 참조를 옮긴 뒤 기존 스크립트를 폐기할 수 있다. 현재 바로 삭제 가능한 완전 중복으로 판정하지 않는다. 수동 운영 검사라 기본 빌드 시간 효과는 제한된다. |
| tool.project-maintenance.ao-layout | area=engine에 등록돼 있으나 composer renderer의 --describe-paths만 호출한다(azrael-feature-contracts.json:2825; verify-composer-emoticon-render.mjs:13–35). 실제 브라우저/엔진 검사가 아니라 AO artifact writer 경로 계약이며 project-maintenance.md:63에 소유 근거가 있다. | 관련 artifact-writer 검사로 분류를 옮기는 낮은 우선순위 후보다. 이식 전 삭제하면 해당 writer의 경로 계약 검사가 사라진다. |

## 유지해야 하는 검사와 판단 한계

- source-test-policy.cjs:8–32의 레거시 26.928.31416 링크·branding·cache matrix·runner selection은 이미 관련 변경 또는 exhaustive에서만 실행한다. 오래된 이름은 기존 데이터/핀 호환성 계약이다. 삭제 대체 증거가 없으며 이들을 없애도 평상시 실행 시간 이득은 제한적이다.
- parent-requests의 codex-protocol 제거는 이미 대응 필터에 테스트가 없다는 근거로 끝난 조정이다(test-engine-check-selection.cjs:58). auto-compaction의 protocol에는 auto_compaction_policy_legacy_default_and_explicit_false가 실제 존재해 동일하게 제거할 수 없다(context_policy.rs:329). lib와 token-budget integration은 다른 경계다.
- root_resume protocol 모듈도 기존 reservation 역직렬화, completion round-trip, wake-early 동작의 실제 테스트가 존재한다. protocol 패키지 전체를 불필요하다고 분류하지 않는다.
- 기본 focused 배포는 provider-context/recovery/accepted-input 3개 기능을 항상 선택하고 관련 경로/미확인 source에는 compaction integration도 추가한다(deploy-azrael.ps1:190–205). 레거시라서 폐기할 대상은 아니지만, 완전한 feature dependency/coverage 계약이 마련되면 영향 기반 선택을 정밀화할 수 있다. 현 함수의 누락 위험과 입력 증거를 확인하기 전 임의 축소하지 않는다.
- 전체 host의 여섯 단계, binary provenance/패키지 identity, source guard는 다른 실행 경계를 보호한다. Rust 컴파일 성공이나 source test로 대체하지 않는다.

## 구형 provider fixture 조사

check-managed-native-engine.mjs의 기본 mode는 스스로 legacy key-provider native fixture라고 표시하고 Google AI Studio/xAI/OpenRouter의 retired route를 여전히 assert한다고 명시한다(:33–39). 기본 assertCatalog는 legacy 모델과 OpenRouter catalog ready/151개를 요구하지만(:209–215), --claude-only와 이를 포함하는 --devin-handoff-only는 해당 route가 없어야 하고 OpenRouter fetch도 0이어야 한다(:15–16,202–206). 이는 기본 경로를 정리할 강한 근거다. default mode를 현재 release 검증의 권장 명령에서 빼고 필요한 기존 호환성 부정을 명시 검사로 옮기는 안을 우선 검토한다. Claude OAuth, OpenAI 경계, Devin handoff를 포함한 파일 전체 폐기는 권하지 않는다. 현 binary로 실행해 실패를 재현하지 않았으므로 실제 실패했다고 판정하지 않는다.

check-devin-engine.mjs는 현재 manifest의 native gate가 아니다. 그러나 docs/architecture/devin.md:97의 ACP 기존 대화 유지 계약은 살아 있고, 구형 fixture가 그 통합 동작을 보호하므로 대체 end-to-end 범위 또는 ACP 지원 폐기가 확정되지 않은 상태에서 파일 전체를 삭제할 수 없다. check-devin-native-engine.mjs는 engine.devin-native 및 engine.devin-code-mode의 현재 native gate이므로 유지한다. check-auto-review-engine.mjs도 docs/ops/development.md:368의 수동 public app-server 검증으로 사용돼 UI source 검사만으로 대체할 수 없다.

기본 managed fixture의 현재 helper는 --release-directory 미지정 시 source helper를 선택한다(check-managed-native-engine.mjs:22–24). inference-config.ts:4의 지원 목록은 google-antigravity/anthropic/meta-muse이며 inference.ts:25–26,134,168에서 미지원 ID를 거부하고 :548–555에서 지원 목록만 catalog에 순회한다. 따라서 이 기본 fixture의 google/xai/openrouter 구성(:318–325)은 첫 catalog assertion(:209–210)부터 불일치할 가능성이 높다. Rust managed_catalog.rs:61–95가 옛 ID를 문법상 인식하는 사실과 실제 provider 지원을 구분한다. docs/architecture/managed-providers.md:9 및 docs/ops/provider-accounts.md:7,46의 기본 호출·지원 설명도 함께 수정하는 후속 작업이 필요하다.

## 권장 후속 범위와 검증

우선순위 1은 구형 managed fixture 기본 mode·운영 문서의 현재 지원 계약 정합화와 중복 Python/common-agent 검사 실행 통합이다. 우선순위 2는 fresh empty-thread assertion 이식 후 check-engine.mjs를 management smoke에 흡수하고, source-runner/feature gate 사이의 동일 입력 receipt 연결을 마련하는 것이다. ACP·native Devin·자동 검토·compaction 패키지를 일괄 폐기하지 않는다.

실제 삭제·축소 전에는 (1) 유지할 feature별 assertion과 새 check ID 매핑, (2) shared invocation 하나로 여러 feature receipt 보존, (3) 누락·입력 변경·실패 시 재사용 거절, (4) 명령 선택기 및 해당 mock/native fixture를 검증해야 한다. 빌드 시간 개선은 대상 검사의 현재 실행 여부와 원래 로그 시간을 연결해 추정하고 실제 후속 빌드에서 측정한다. 수동 legacy 스크립트 삭제가 현재 기본 Rust 컴파일 시간을 줄인다고 주장하지 않는다.

초기 조사의 후보 판단은 읽기 전용 코드·문서·manifest 조회와 순수 selector 근거이며, 상위 Rust 테스트 전수 평가나 현재 binary의 구형 mode 실패 재현은 포함하지 않는다. 승인 후 구현과 source/mock 검증의 실제 범위는 아래 실행·재개 항목이 소유한다. 실사용 계정·세션·설치·서비스는 이번 정리에서 변경하지 않았다.

## 승인된 실행 범위와 분담

현재 provider 지원 동작에 맞춰 구형 key-provider positive fixture를 정리하고 Claude 기본 경로/Devin handoff/옛 route 거부를 보존한다. management에 fresh empty-thread 계약을 이식한 뒤 check-engine을 폐기한다. root는 Python/common-agent 명령 통합, source runner와 검증 gate 결과 공유, 검사 등록·문서·통합 검증을 소유한다. 기존 세션의 실행 담당들이 provider fixture와 management smoke/map을 수정했으며, 재개 후 root가 문서와 검증을 통합했다. 다른 BW-01 및 daemon version 공존 변경은 보존한다. 제품 지원 범위·사용자 데이터·설치 버전은 변경하지 않는다. 검증은 Windows x64의 scoped source/mock/public RPC fixture로 진행하고, Rust 전체 제품 빌드는 실행하지 않는다.

로그·fixture 소유는 work:engine-check-retirement-r1이고 artifacts/tasks/windows-2026-0-9/runs/engine-check-retirement-r1 아래 기록한다. 먼저 각 경계의 작은 회귀 검사를 통과시키고 최종 manifest/receipt/selection 통합 검증을 수행한다. 생성 fixture는 실제 종료 후 일반 삭제하며 로그는 후속 계약 검증으로 대체되고 참조가 없을 때 재검토한다.

## 세션 재개와 검증

기존 미완료 변경을 이어서 Windows x64에서 source/mock 통합을 검증한다. 별도 daemon 공존·provider context 변경은 다른 작업 소유로 보존한다. 설치본은 이후 다른 작업에서 2026.0.8로 rollback된 기록이 있으므로 이번 정리 작업은 설치를 변경하지 않는다. root 단독으로 잔여 통합을 수행한다. 검증 기록은 `artifacts/tasks/windows-2026-0-9/runs/engine-check-retirement-r2` 소유이며 두 one-off bundle의 출력·임시 fixture를 포함한다. 기존 r1은 이전 담당 결과와 진단 근거로 유지하며 종료·구성 확인 후 별도 검토한다. 재사용 검증에 Node 실행 파일/환경 binding과 같은 source 환경 전달을 보완했다. 제품 빌드·Rust 재컴파일·재설치는 이번 검증 범위에 없다.

검증 결과: 초기 source/mock 100개 중 97개 통과, 부분 SSE 청크 가정 2개와 새 의존성 선택 목록 1개 실패를 수정했다. 해당 재검사 6개 모두 통과(exit 0), 기능별 공유 명령 등록 검사 포함 25개 통과(exit 0), management mock 6개 통과(exit 0), 배포 mock 성공/필수 receipt 누락 2개 통과(exit 0). source 재사용의 입력·로그·receipt·환경 변경 거부와 필터 검사 제외는 초기 실행에서 통과했다. 관리 도구 첫 실행은 10초 제한으로 exit 124이며 통과로 계산하지 않았다. 해당 producer가 종료된 뒤 완료 관측이 가능한 직접 실행으로 재검증했다. 로그는 r2 `source-tests.log`, `targeted-retry.log`, `manifest-checks.log`, `management-tests.log`, `deploy-tests-r3.log`에 있다. Windows x64 source/mock 검증이며 Linux/macOS와 실제 engine/helper 동작은 미검증이다. 소요 시간 분석은 수행하지 않는다.

정리 결과: r2 임시 fixture 디렉터리와 이번 배포 모의검사 두 run을 삭제하고 실제 부재를 확인했다. 배포 결과·stage metrics·로그 및 management 결과는 삭제 전에 r2 `reports/`에 독립적으로 보존했다. one-off bundle 두 개는 검증 후 설정에서 제거했다. r2 로그·검증 요약은 이번 소스 계약의 근거로 보존하며 대체 검증 기록 확보와 소비 참조 해제 시 재검토한다. 이전 세션의 r1은 producer 종료·전체 구성 확인이 끝나지 않아 보호 보류하며, 이를 확인하고 r2와 중복되지 않는 근거를 옮긴 뒤 삭제를 재검토한다.

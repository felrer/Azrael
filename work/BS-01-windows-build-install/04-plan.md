상태: 승인된 테스트 축소 구현·관련 검증·임시 fixture 정리 완료. 진행 중 w31b 빌드 입력은 유지했다.

목표는 빌드 과정에서 불필요한 검사 비용을 줄일 후보를 현재 계약과 실측으로 분류하고, 사용자가 후속 승인한 권장 축소안을 구현하는 것이다. 현재 w31b의 고정 입력과 검사 범위는 유지한다. read-only engine/source 감사자의 조사는 완료했으며, root는 최종 패키지/호스트 경계와 분류 기준·통합 판단을 소유한다. 승인 범위의 선택 코드·관련 회귀는 수정하되 추가 제품 빌드는 시작하지 않는다.

분류는 제품 행위 단위/계약, native 통합, UI 변환, 빌드·테스트 도구 자체 회귀, 소스 문자열·형태 검사, 최종 패키지·설치 수용으로 나눈다. 조치는 영구 삭제, 동일 보장의 병합, 관련 변경 시 실행, 별도 정기 회귀와 현행 유지로 구분한다. 같은 기능명·같은 crate만으로 중복이라고 판정하지 않고 입력·실행 경계·assertion을 비교한다. 제거로 잃는 보장과 대체 증거가 확인되지 않은 후보는 제안으로 남긴다. 전체 upstream 테스트 통과나 타 플랫폼 검증을 주장하지 않는다.

검증 근거는 현재 scripts의 runner/manifest/검사 본문과 완료된 w31b receipts 및 단계 metrics다. 논리 검사 수와 실제 실행 수, 중복 receipt와 실제 중복 실행, 겹친 단계 시간과 전체 경과 시간을 구분한다. 이번 조사는 속도 개선을 구현하거나 단축 시간을 실측한 작업이 아니다.

변경 전 w31b의 분류와 비용:

| 분류 | 현재 범위 | 실측·처리 방향 |
| --- | --- | --- |
| 소스/제품 동작 회귀 | full source 121 files, extension current+standalone | source 명령 668,093ms, extension-all 37,276ms. 테스트 파일 수이며 개별 case 수가 아님 |
| 엔진 정적/계약 보존 | manifest source 12 checks | 엔진 source preflight 128,621ms, 본 검증에서 같은 입력의 통과 증거 재사용 |
| 엔진 native 통합 | manifest native 31 checks | appserver 1,536,508ms, manual-resume 1,467,404ms, parent-requests 924,004ms. 각 검사에 컴파일 준비가 포함되며 assertion 실행만의 시간은 미측정 |
| UI 변환·행위·검사 도구 | manifest source 99 check bindings | 실제 resolved command 52 groups. package feature-preservation 총 700,114ms. 같은 명령은 이미 Map으로 묶음 |
| 최종 패키지·설치 | inventory 전/후, VSIX install, namespace, standalone host, coexistence host의 6단계 | 패키지 실물과 두 활성화 조건의 경계 보장. source/mock 통과로 대체하지 않음 |
| 입력·출처·receipt 검증 | 고정 소스/선택 도구/engine·VSIX identity 및 설치 직전 재확인 | 테스트 중복과 별도인 무결성 검사. TOCTOU 경계를 확인한 후에만 별도 최적화 검토 |

현재까지 확인한 축소 후보의 우선 방향은 (1) 엔진 검사 내 반복되는 큰 테스트 준비/넓은 filter 범위 분석, (2) 도구 자체의 전체 조합 회귀를 관련 변경 또는 별도 주기로 이동, (3) full source와 preservation의 같은 파일 실행을 입력·환경이 같은 경우 한 번으로 통합, (4) 문자열/형태 assertion 중 실제 행동 검사와 동일 보장을 갖는 것만 제거하는 순서다. 소스 full과 UI 보존에 동시에 등장하는 script 파일은 59개이며 엔진 source와 full 소스의 교집합은 11개다. 파일 교집합은 같은 실행 환경·같은 증거임을 뜻하지 않으므로 제거 확정 수로 쓰지 않는다.

비용 사례: `scripts/test-asset-transform-cache.cjs:282`의 전체 pinned 대상 uncached/cold/warm·변경 miss 조합 271,542.5ms, `scripts/test-feature-preservation-cache.cjs:183` schema2 입력 변경/재사용 조합 130,071.1ms. 전자는 모든 injector의 target을 순회하며 결과·metadata 동등성과 영향 키를 검사한다. 후자는 source UI/unknown 입력 변경을 포함한 여러 cold/warm gate 실행으로 증거 오재사용을 막는다. 기능을 보장하는 검사이므로 영구 삭제보다 관련 도구·manifest·UI 입력 변경 시 실행이 우선이다. 해당 비용은 Node concurrency 8과 native build 병행 조건의 개별 case 시간이며 합산해서 전체 단축 시간으로 제시할 수 없다.

중복 오판 제외: namespace-cache-owner 44 bindings, deferred-turn 공통 명령 2 bindings, transform-fixture 4 bindings는 `feature-preservation.cjs:279`의 executable+resolved args 그룹으로 이미 합쳐진다. 99→52는 기존 동작이며 이번 개선 성과가 아니다. 최종 standalone/coexistence는 원본 확장 비활성/활성 조건과 명령 격리를 각각 확인하므로 기능명만으로 중복 판정하지 않는다.

실제 source case 수는 1,583(통과 1,578, skipped 5), extension 218(모두 통과)이다. 기본 deploy 경로는 이미 changed-only이며 `FullRegression`에서만 current+standalone 전체를 선택한다(`deploy-azrael.ps1:195–203`). 따라서 아래 분리를 기본 경로에 새로 생기는 최적화인 것처럼 계산하지 않는다. 엔진 교체/넓은 계약 변경에서는 현재 full 검증 요구를 유지한다. 그 경로 자체를 줄이려면 기능별 변경 영향과 대체 gate를 정하고 관련 계약도 함께 수정하는 후속 승인이 필요하다.

권장 후보:

| 우선 | 후보·분류 | 제안 조치 | 보장 손실·대체 / 근거 |
| --- | --- | --- | --- |
| 1 | `check-parent-requests.cjs:16–18`의 codex-protocol 선택 | 이 filtered 검사에서 `-p codex-protocol` 제거 후보. protocol 소스나 다른 검사 자체를 삭제하는 제안이 아님 | stdout의 6개 결과와 stderr의 `Running unittests` 순서를 대조해 codex_protocol harness가 실제 0 tests/371 filtered out임을 확인. 현재 parent_request/parent_response_wait 보장 손실은 없지만 미래 matching test 자동 편입은 사라짐. 후속 변경 시 실제 matching 목록 확인. 검사 전체 924s 중 제거분의 시간은 미측정이며 dependency compile은 여전히 필요할 수 있음 |
| 2 | `check-thread-auto-compaction.cjs:18–23`의 `codex-core --test all auto_compaction` | unit/contract gate와 별도로 compaction·token budget·상태 관련 변경/엔진 업그레이드 검증 및 정기 통합 회귀 lane으로 분리 후보 | `core/tests/all.rs:3–4`는 큰 통합 harness, `core/tests/suite/token_budget.rs:1306`의 시나리오는 lib와 다른 경계. 테스트 삭제 금지; 일반 무관 변경에서만 생략 검토. receipt 조사 시점에 이 검사의 종료·시간 미확정 |
| 3 | `test-asset-transform-cache.cjs:282–338`, `test-feature-preservation-cache.cjs:183–224`의 전 대상·입력변경 조합 | cache/transform/manifest/TypeScript/UI pin 변경 시 + 별도 정기 회귀로 분리. 일반 빠른 경로에는 작은 hit/miss·손상/오재사용 거부 사례 유지 | 사례 실측 271.5s/130.1s. 전체 대상 동등성·unknown 입력 무효화의 즉시 회귀 보장은 줄므로 소유자 변경 감지와 정기 회귀를 먼저 연결해야 함 |
| 4 | `test-session-links.cjs:59–74`의 구형 UI 26.928.31416 호환 | 구형 pinned 번들 사례만 링크 migration/transform/핀 변경 또는 정기 호환 lane으로 분리 후보 | 23.8s 실측. 현재 UI pin 및 native store 소유 thread migration(`:135–155`, 35ms)은 유지. 구형 지원 종료가 승인되지 않았으므로 영구 삭제하지 않음 |
| 5 | `test-project-selection.cjs:76–82,149–165,210–212`의 runner 자체 회귀 | runner/selection/config/manifest 변경 시 및 정기 도구 회귀로 분리 후보 | 테스트 선택 누락·중복·fail-fast 보장 유지 필요. 제품 전체 회귀마다 도구 자체를 검사하는 의무를 줄이는 제안이며, build 전용 PowerShell 테스트들이 current에 이미 포함된다고 주장하지 않음 |
| 6 | `test-namespace-source.cjs:27–39,168–193`의 pinned 문자열·exact count | 이미 행동 사례가 보장하는 assertion만 합치고, 실제 minified 번들의 exact count는 pin/namespace 변경 시 검사로 한정하는 후보 | 정확한 원본 anchor drift 감지가 줄 수 있음. synthetic 결과·URL/헤더 보존·workspace filtering·불일치 anchor 거부는 유지. 전체 파일 삭제 후보가 아님 |
| 7 | full source와 preservation 간 같은 script 반복 | 같은 배포에서 입력·도구·환경·실행 범위가 일치하는 경우 통과 증거 한 번으로 결합. 우선 `test-namespace-cache-owner.cjs:19–80` 비교 | source-only 경로에서는 계속 필요. 59개 교집합 모두가 같은 실행이라는 결론은 아님. 현행 gate 내부 중복 제거와 구분; 최종 package binding은 계속 수행 |

테스트 축소와 구분할 후속 준비 비용 개선: `check-model-harness-profiles.cjs:13–24`의 codex-core 4 filters는 실제 32/1/4/1개의 서로 다른 테스트다. `check-api-context.cjs:7–19` prompts 4/1개도 중복 사례가 아니며 두 번째 Cargo 호출은 약 4.1s이다. appserver 검사도 서로 다른 그룹이다. 동일 executable을 한 번 준비해 exact filters를 실행하는 방향은 보장을 줄이지 않지만, 반복 Cargo 호출이 매번 전체 재컴파일을 했다고 단정하거나 검사 전체 시간을 절감 예상치로 쓰지 않는다. Claude 32개가 불필요한지 판단할 assertion별 근거는 아직 부족하다.

유지/제외 판단: Windows PTY inherited-ignore·detached-host Ctrl+C 회귀는 이번 실제 실패를 검출했으므로 유지한다. source-shape인 `test-check-shared-engine-resources.mjs:46–59`도 인접 입력/집계 검사와 다른 소유·정리 보장으로 확인되어 제거 근거가 없다. `test-integrated-entry.cjs:296–346`의 migration/실패 정리(188ms), session-link native migration(35ms)은 작고 유효하므로 유지한다. queue/recovery 중첩 파일은 Set이 중복 제거하며, extension current+standalone은 이미 `extension-all` 한 명령이다. installed host/권한·사용자 상태 격리/출처/최종 package identity는 축소 후보에서 제외한다.

시행 순서는 0-test package 선택 제거 검증 → 긴 cache matrix의 별도 lane/변경 owner 연결 → auto-compaction 통합 lane 분리 여부와 엔진 업그레이드 full 보장 합의 → 구형 pin/문자열/runner 후보 정리 → 교차 단계 증거 통합 순서가 적절하다. 별도 주기의 빈도는 아직 결정하지 않았다. 이번 전체 경과 시간을 좌우한 엔진 검증이 그대로라면 UI 검사만 줄여도 전체 완료 시간이 같은 만큼 줄지는 않는다. 후속 구현 후 같은 입력·환경 조건의 전체 경과 시간과 누락된 보장이 없는지를 비교해야 한다.

조사 검증: 두 감사자는 해당 범위 읽기만 수행했고 새 테스트/컴파일/삭제/수정은 실행하지 않았다. root는 receipt 99→52 그룹, source/extension 실측, parent-request stdout/stderr harness 매핑과 현재 owner 명령을 확인했다. 로그 기반 시간과 정적 후보를 구분했으며 검사 의미 중복이 확인되지 않은 항목은 영구 삭제 권고에서 제외했다. 제품 입력·필수 gate는 그대로다. engine receipt는 조사 당시 running이었으므로 후반 검사 비용과 전체 통과 여부는 이 조사 결과로 확정하지 않는다.

승인 후 실행 계약: source worker는 공통 source-test-policy/helper/선택기 및 synthetic/pinned branding 분리를 소유한다. engine worker는 parent 0-test package 선택 제거와 auto-compaction all/lib/integration 모드 및 mock 검사를 소유한다. deployment worker는 정책 JSON과 동일 changedPaths의 source/prepare 전달, exhaustive와 focused integration 선택 및 격리 fixture를 소유한다. root는 manifest의 library/integration 등록, preservation의 실제 source 명령·identity 바인딩, 최종 통합과 문서를 소유한다. 기존 실행의 source/engine/host/설치 입력은 수정하지 않는다.

routine policy는 알려진 느린 사례만 정확한 이름으로 제외하고, 관련 owner나 테스트 자체 변경 시 해당 선택 사례를 포함한다. helper 변경도 이미 선택된 사례를 유지하며 무관한 전체 suite를 새로 확장하지 않는다. `--exhaustive`는 제외 없이 source 범위를 실행하고 `-ExhaustiveRegression`은 FullRegression과 package preservation 전수를 포함한다. 기존 FullRegression은 product·engine 전체와 final host를 유지하면서 무관한 도구 matrix는 conditional policy를 따른다. 자동 정기 스케줄은 만들지 않고 명시적인 exhaustive 실행 경로를 제공한다.

namespace-cache-owner 한 파일만 full deployment의 source에서 UI 보존으로 유예하며 source-only/changed-only에 적용하지 않는다. 최종 UI gate와 package binding은 그대로 필수다. 다른 59개 교집합은 입력/환경 동등성 입증이 부족하므로 제외하지 않는다. preservation receipt는 정책과 실제 skip args를 기록·hash에 반영하고 잘못된 정책 및 등록 gate 전체 유예를 거부한다. 최소 synthetic branding 행위는 항상 유지한다.

검증 중 발견한 재작업: library select에 매번 git 변경 조회를 추가한 초기 구현은 selector 회귀의 반복 조회·HEAD 없는 fixture 실패를 일으켰다. source worker가 자기 소유 초기 검증만 중단하고, CLI에서 policy 입력을 한 번 캡처해 library에 주입하는 방식으로 수정 후 다시 검증한다. 새 프로세스/캐시를 늘려 우회하지 않는다. engine mock 58개 exit 0, root preservation policy 2개 exit 0 확인. 실제 Cargo/native 재컴파일은 시작하지 않았다.

현재 통과: source helper/선택기 36개 exit 0, synthetic branding 1개 exit 0, 실제 Git inventory 기반 policy/changedPaths 변경 시 이전 receipt 거부 1개 exit 0, 잘못된 policy/외부 경로/등록 gate 전체 누락 거부 1개 exit 0. 현재 manifest 65 features 및 분리 integration 명령 참조 검증 exit 0. source의 중단된 초기 회귀 TEMP fixture 잔여 없음 확인. 최종 관련 로그는 `artifacts/tasks/windows-latest/runs/w31b/test-reduction-{source,engine,root,deploy}`가 소유한다.

배포 fixture 재작업은 Git stdout UTF-8 해석을 수정했고, 제품 흐름이 verified(27.7s)인 뒤 cleanup 약17s와 최종 lifecycle 기록이 45s fixture cap에 걸리는 것으로 좁혔다. 원인이 확인된 새 Unicode fixture만 90s로 진단했지만 다음 실행도 verified(58.976s) 뒤 정리 중 timeout이었다. 성공으로 처리하지 않았다. 이 새 full fixture는 기존 전체 흐름 4개와 중복이므로 승인된 테스트 축소 범위에서 제거하고 기존 45s cap을 복원했다. 대신 작은 fixture가 실제 원본 Git reader→정책 JSON→원본 source argv 경계를 검사하도록 보강해 최종 exit 0을 확인했다. 제품 성공 조건이나 timeout은 바꾸지 않았다. 실패 기록은 보존하며 생성 Git 객체는 소유·하드링크 확인 후 ReadOnly/Hidden만 정상화하고 일반 삭제했다.

최종 배포 검증: 실제 tracked/untracked UTF-8·정규화·exhaustive/full flags·empty/external/unknown engine 영향의 보수적 integration 선택·JSON/argv 동일성 검사가 exit 0. prepare의 잘못된 schema 거부·override·manual 기본 보존도 확인했다. 기존 4개 전체 mock fixture 통과 증거를 재사용했고 변경된 선택 경계는 최종 원본 코드로 별도 검증했다. 배포 worker 생성 fixture 8개 모두 실제 부재 및 lifecycle 반영을 확인했다. root의 등록 manifest와 source 정책 identity/누락 거부 검증, 변경 파일 diff 검사도 exit 0. 실제 Cargo/native 재컴파일·새 앱 빌드·다른 OS 검증은 수행하지 않았다. 실제 시간 단축 수치와 broad source/preservation 전체 재실행 통과를 주장하지 않는다.

최종 적용 범위는 0-test package 선택 제거, 알려진 느린 source 사례와 runner 회귀의 conditional 실행, lib/integration feature 분리와 보수적 focused 선택, synthetic/pinned 분리, namespace-cache-owner 한 파일의 full-deploy 단계 중복 제거다. full engine/미확정 영향은 integration을 유지하고 최종6 host·package identity·설치 검증은 그대로 필수다. 광범위한 59파일 증거 통합은 하지 않았다.

상태: 테스트 분류와 제거·축소 후보 조사 완료. 아래는 제안이며 실제 테스트 삭제나 필수 기준 변경은 수행하지 않았다.

목표는 빌드 과정에서 불필요한 검사 비용을 줄일 수 있는 구체 후보를 현재 실행 계약과 실측 근거로 제시하는 것이다. 현재 w31b의 고정 입력과 검사 범위는 유지한다. root는 최종 패키지/호스트 경계와 분류 기준·통합 판단을 소유하고, read-only engine/source 감사자는 각 영역의 실제 assertion·선택 규칙·중복을 조사한다. 코드 변경·새 테스트·추가 빌드는 수행하지 않는다.

분류는 제품 행위 단위/계약, native 통합, UI 변환, 빌드·테스트 도구 자체 회귀, 소스 문자열·형태 검사, 최종 패키지·설치 수용으로 나눈다. 조치는 영구 삭제, 동일 보장의 병합, 관련 변경 시 실행, 별도 정기 회귀와 현행 유지로 구분한다. 같은 기능명·같은 crate만으로 중복이라고 판정하지 않고 입력·실행 경계·assertion을 비교한다. 제거로 잃는 보장과 대체 증거가 확인되지 않은 후보는 제안으로 남긴다. 전체 upstream 테스트 통과나 타 플랫폼 검증을 주장하지 않는다.

검증 근거는 현재 scripts의 runner/manifest/검사 본문과 완료된 w31b receipts 및 단계 metrics다. 논리 검사 수와 실제 실행 수, 중복 receipt와 실제 중복 실행, 겹친 단계 시간과 전체 경과 시간을 구분한다. 이번 조사는 속도 개선을 구현하거나 단축 시간을 실측한 작업이 아니다.

현재 분류와 비용:

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

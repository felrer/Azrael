상태: 사용자의 우선 검토 요청에 따라 빌드 재실행을 보류함. 축소 후보 분석 완료, 적용 여부는 사용자 판단 대기. 이번 분석은 테스트 삭제·검증 약화·추가 빌드를 승인하지 않는다.

# 빌드 단계 source-tests 재개

- 승인: 다음 빌드 작업을 기존 단계별 측정 절차로 재개한다.10초 미만인 준비/단계는 다음으로 진행하고 첫10초 이상 성공 단계는 같은 설정으로2회 측정해 보고한다. 실패 시 다음 단계는 차단한다.
- 다음 단계는 DW05에서 실패한 source-tests이다. engine-source-preflight가 마지막 완료 단계였으며 extension-build는 아직 실행하지 않았다. 현 source-tests 선택 결과와 fixture readiness를 다시 확인한다. 제품 빌드·설치는 이 단계 통과 근거와 구분한다.
- 수정: Windows background_command guard 테스트가 powershell.exe를 옛 paths.rs에서 찾았다. 실제 소유자인 windows_delete.rs의 PowerShell과 paths.rs의 cmd 호출을 각각 검증하도록 수정하며 helper 사용/직접 Command 금지/windows dependency 검사는 유지한다. Windows scoped 검사 수정이며 제품 동작은 바꾸지 않는다. 공통 source runner는 Windows x64/Node26.7.0에서 검증하고 다른 OS는 이번에 실행하지 않는다.
- scripts/test-project-maintenance.cjs의 이 테스트11줄 전체가 시작부터 미커밋 추가였다. 이전 Windows worker는 작성자가 아니라고 확인했다. 원래 assertion 목적과 다른 변경을 보존하며 현재 실제 위치만 고친다. 원래 추가와 수정 부분을 HEAD 기준으로 분리해 커밋할 수 없으므로 이 파일을 임의로 전체 커밋하지 않는다. 필요한 경우 이번 task commit은 기록만 포함하고 이 사유와 작업트리 수정 상태를 보고한다.
- root가 소유한 run:DW-07:source-tests, artifacts/tasks/dw07-tests 및 짧은 TEMP artifacts/tasks/tw07에 controller·선택 args·입력/종료 identity·로그·fixture를 선언한다. 기존 원본 runtime/설치 engine/extension 산출물과 archive는 보존한다. Python3.12와 기존 Codex runtime/engine override를 준비 단계에서 실제 확인한다.
- source-tests CLI args-file과 SHA transport 및 concurrency4를 유지한다. 단계 선택·실행 argv/cwd/환경을 검토하고 source command만 실행한다. 명령 전후 전체 project snapshot과 실제 exit·test count·실패 원인을 확인한다. 동일한 입력으로2회 진행하는 동안 소스/기록을 수정하지 않고 다른 무거운 producer나 cleanup을 병행하지 않는다. 실행 종료 신호를 기다리고 중복 실행하지 않는다.
- 정리: 결과를 이 기록에 보존한 뒤 최적화된 maintenance_owner로 소유 두 root를 등록/review/apply하고 실제 부재/finalize를 확인한다. 각 시도의 실패 outcome은 유지하며 unresolved producer는 보호한다. junction이 native 등록을 막으면 exact 소유 fixture 생성 경로·대상을 확인하고 supported verified_junctions를 선언한다. force/guard 우회는 하지 않는다. 이번 archive 보존 예외는 없다. .git/dw07-* 임시 제어 파일은 사용 직후 일반 삭제한다.

- 실행 경계: CLI 전체 실행은 후속 build까지 이어지므로, 기존 args-file/SHA parser로 동일 selection을 구한 뒤 공개 runSelection API에 source command만 전달한다. 원래 전체 selection과 연기한 command 목록을 별도 보존하며 coverageStatus를 승격하지 않는다. 제품 CLI 변경은 없다.

- Fixture preparation: readiness first failed because review-1.0.0 assets were absent. Packaging the current library was rejected before output creation by an existing __pycache__; current library version is also 1.1.0, while these host tests explicitly require the legacy 1.0.0 release and playbook-work. Preserved the current library/cache. Prepared exact tracked instructions from historical commit 68cec656d912d08a88c1331dd37e59b57a544ca8 using git archive, then reused buildRelease API under the declared task root. No publication/install or product inputs changed. Preparation 0.424 sec; readiness ready.

- Legacy instruction service real adapter probe: exit 0, signal null, 29.725 sec. This is fixture preparation, separate from the source-tests stage timing. Source plan reviewed: Node --test --test-concurrency=4, 129 selected files, cwd project root; downstream test-incremental-extension-build / extension-build / extension-changed deferred.

## 실제 실행 결과와 중단 원인

- Windows x64 / Node26.7.0, source 129개 파일, concurrency4. UTC 2026-10-26T12:46:29.778Z →13:01:20.476Z. source command duration 890.680초, actual exit1/signal=null. 1945개: 통과1936/실패1/skip8/cancel0. 2회차 및 후속 빌드는 실행하지 않았다.
- 실패는 scripts/tests/instruction-package.test.cjs:76의 릴리스 소유권 검사다. 기본 instruction-packaging-checks 폴더를 과거 custody 두 레코드가 보존하여 새 하위 run 등록이 차단됐다. 실제 제품 패키징 실패가 아니라 테스트 fixture 위치 충돌이다. 이미 지원하는 AZRAEL_INSTRUCTION_PACKAGING_TEST_ROOT를 task-owned TEMP 아래로 지정하면 기존 보호를 유지하며 분리할 수 있다. 아직 수정·재검증하지 않았다.
- 실행 전후 complete snapshot SHA는 모두 225a9c24c2aa631c83c9bfd9c6102bb011266bb106519aaf40cdd130ddffc770이며 inventory JSON도 동일하다. 비교 보조 함수 compareSnapshots는 root inventory의 gitlink path upstream/codex/와 nested tree 상대 경로 upstream/codex의 trailing slash 차이로 Nested input inventory digest mismatch를 던졌다. 이로 인해 controller도 actual exit1이었으며 summary.runs 갱신 이전에 종료됐다. 입력 변경이나 성공으로 바꾸지 않는다. 후속 controller는 먼저 실제 결과를 기록하고 동일 complete inventory를 검증해야 한다.
- 모든 source child의 실제 close와 source results.json의 terminal result를 확인했다. 별도 read-only observer도 terminal error를 전달하고 종료했다. 신규 외부 producer group은 이번 DW07 하나뿐이었다.

## 테스트 축소 검토 — 제안, 미적용

1. 선택기 동적 의존성 범위를 정밀화한다. selection의 변경 입력848개 중 work 자료731개, scripts12개이며 reasons11914개다. source129개 중 직접 매핑37개, fallback만으로 선택92개. namespace-cache-owner의 계산 require가94개 테스트에 전파된다. scripts/test-project.cjs:253의 scriptOwners 및 :326 selectChanged에서 정적 require.resolve·고정 캐시 모듈·외부 TypeScript·생성 fixture를 구분하고, 미해결만 별도 검토한다. work 자료는 메타데이터 부하를 키우지만 scripts 범위 fallback의 직접 원인이라고 단정하지 않는다. 92개 전부 삭제 가능하다는 결론도 아니다.
2. scripts/test-asset-transform-cache.cjs:282의 전체 injector matrix(167.294초)는 각 자산의 uncached/cold 생산을 반복한다. 공통 캐시 owner·규칙·pin·전체 실행에서는 전체 matrix를 유지하고, 개별 injector 변경에서는 관련 자산 중심으로 선택하는 정책을 검토한다. 작은 대표 fixture의 cold/warm/손상·metadata/miss 검증은 계속 유지해야 한다.
3. 실제 번들 통합 변환을 공유한다. deferred-turn 전체 pipeline101.709초, Pets94.871초, namespace composition66.136초 등 같은 production pipeline이 반복된다. deferred/Pets는 host와 app-initial 두 개, 총3개 번들이 겹친다. ui-test-transform-fixture가 이미 결과 재사용 기능을 제공하므로 hit/bypass와 환경·fullPath identity의 차이부터 확인한다. 공통 immutable 출력에 각 assertion을 적용하는 방향을 권고하며 별개 runtime·변조·idempotency 계약을 지우지 않는다.
4. engine-source-preflight와 source-tests의 중복 실행을 기존 receipt 전달로 제거한다. scripts/source-preflight-reuse.cjs는 동일 프로젝트·실행 환경·입력·로그 identity를 재검증하여 전체 unfiltered bundle만 재사용한다. 배포 흐름에는 이미 연결되어 있으나 이번 수동 단계 실행에는 receipt를 전달하지 않았다. 현재는 이전 raw receipt가 정리되어 재사용을 입증할 수 없으므로 이번 결과를 임의 통과로 간주하지 않는다. 다음 연속 단계 측정에서는 소비가 끝날 때까지 receipt를 같은 작업에 유지한다.
5. 테스트 fixture 준비를 분리한다. 현재 host test는 legacy1.0.0을 요구하며 current instruction library는1.1.0이므로 그 호환 fixture를 명시적으로 유지하고 현재 릴리스 통합 검사와 구분한다. readiness 단계에서 packaging root와 모든 fixture override를 확인하여 15분 뒤 위치 충돌을 발견하는 재실행 낭비를 줄인다. 이번 root의 사전 instructionService 실제 probe29.725초는 본 source suite의 instruction host instructionService51.444초와 같은 adapter 검증을 반복했다. 매번 전체 adapter를 사전 실행하기보다 파일·해시·버전·소유 경로 readiness를 검사하고 실제 adapter는 본 suite에서 한 번 검증하는 것을 권고한다. 호환성 테스트 자체를 불필요하다고 판정하지 않는다.

- 실제 시간은 동시 실행된 개별 test duration이다. 합계를 전체890.680초의 절감 시간으로 환산하지 않는다. 축소 후 절감량은 아직 측정하지 않았다.
- child test_cost_evidence는 지정된 세 테스트와 helper의 읽기 전용 근거 조사만 수행했고 파일·테스트·빌드·생성물을 만들지 않았다. root가 선택 정책과 최종 권고를 통합했다.
- 기존 working tree의 test-project-maintenance.cjs 첫 guard test 수정은 보존한다. 원래 미커밋 추가와 분리할 수 없어 임의로 파일 전체를 커밋하지 않는다. 이번 task commit은 본 작업 기록만 포함한다.

## 정리 및 검토 완료

- 설치된 최적화 maintenance_owner의 SHA256 6ffd3d7e5787439381740a8bb3a32a7f4d4ab0d91beba4ee145c954287a06a96을 확인하고 기존 catalog group420개를 조회했다. 이번 group은 신규 등록했다.
- 최초 등록은 migration fixture junction에서 차단됐다. owning test의 Windows junction 생성·복원 경로와 9개 링크의 실제 LinkType/대상을 확인했고, 모두 이번 TEMP 내부에 있음을 확인하여 supported verified_junctions로 등록했다. 보호 장치를 우회하거나 링크 대상을 따라 삭제하지 않았다.
- fresh registered review의 두 member 모두 blocker/reference가 없고 stopped failure·complete membership이 일치했다. 같은 delete 결정을 적용하여 actual exit0, 두 결과 deleted/remaining=false/error=null/attributes=[], aborted=false를 확인했다. apply28.903초는 source 실행 시간과 별도다.
- artifacts/tasks/dw07-tests 및 artifacts/tasks/tw07의 실제 ENOENT를 확인하고 producer lifecycle finalize 및 registry 부재를 확인했다. raw 자료·legacy fixture copy는 남기지 않았다. 필요한 수치·실패 원인·제안은 본 문서에 보존했다.
- 분석 중 추가 테스트·제품 빌드·검증 축소는 실행하지 않았다. scoped diff whitespace 검사는 exit0이었다. 빌드의 다음 실행은 사용자 검토 후 이어간다.
- .git/dw07-* 임시 제어·요청·결과·observer 파일29개를 일반 삭제하고 잔여0개를 확인했다. 다른 staged 항목17509개의 index digest를 task commit 전후 비교하여 보존한다.

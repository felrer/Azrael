상태: 수정·검증·임시 자료 정리 완료. 검증된 변경만 task commit으로 기록한다.

# 소스 사전 검증 실패 수정 및 시간 보고

- 요청/권한: 앞선 engine-source-preflight 실패 세 그룹을 수정하고 실제 시간을 보고한다. 제품 빌드·설치·배포는 수행하지 않는다.
- 진입: development-workflow 조사 및 implementation 실행. 기존 DW-01 빌드 단계 측정 세션의 후속 작업이다.
- 플랫폼: 공통 Node/Bun 검증 및 제어 파일 경합 처리. 검증 환경은 로컬 Windows x64이며 Linux/macOS의 실제 실행은 미검증으로 남긴다. 엔진 Rust 코드는 이번 수정 대상이 아니다.
- 원인: runtime.deletion-approval.native의 selected-tests-v1 reviewed recipe 누락; copied-project fixture에 maintenance-lock-owner.cjs 누락; Meta 테스트가 현재 reserved rejection namespace 계약과 불일치; 병렬 source checks가 짧은 전역 .run-claim.lock을 같은 시점에 획득하려 하면 즉시 실패.
- 유지할 계약: 삭제 승인 native check의 네 Cargo 선택/환경/해시 검증, 명시한 엔진 루트, unknown tool 비실행 실패 결과와 paired history, incomplete stream의 terminal 실패, create-new marker 소유권 및 exact identity 해제, stale/변경/불확실 잠금의 fail-closed 처리. 잠금 자동 삭제·만료·PID 기반 해제는 추가하지 않는다.
- 접근: 기존 recipe builder 및 공통 mapper 계약을 재사용한다. run claim에만 최대 5초의 bounded contention wait를 적용하고 일반 acquire의 기본값 즉시 실패는 유지한다. 독립 child가 소유 잠금을 정상 해제한 뒤 claim이 획득되는 회귀와 timeout/교체/잔여 잠금 보존을 검증한다.
- 의존성/소유: root가 관련 scripts와 Meta 테스트 및 owning 문서의 변경만 소유한다. 기존 다수 동시 변경은 보존한다. 수정 전 targeted 검사로 관련 실패를 확인하고 수정 후 해당 검사 및 23개 source check 전체를 확인한다.
- 검증: recipe 전수 및 정확한 네 명령 비교, copied-project pending lifecycle, Meta incomplete rejection와 undeclared non-executing namespace, maintenance owner/artifact-run 경합·crash 안전성, 전체 engine-source-preflight. 10초 이하에는 성능 통계를 내지 않고 10초 초과 성공한 원래 preflight 단계만 같은 설정으로 2회 측정한다.
- 시간: 시작 UTC 2026-10-26 05:16:23. 수정·검증 전체 경과와 preflight CLI wall을 별도 보고한다. 병렬 체크 합계를 전체 경과로 합산하지 않는다.
- 아티팩트: 실행 전 전용 artifact-run을 기록하고 inputs/temporary/logs/reports/outputs 아래만 생성한다. 환경 override로 Cargo fixture·benchmark·SDK temp 출력을 전용 temporary로 모은다. 링크 생성 테스트의 안전한 소유자 정리를 확인하여 이번 작업의 fixture가 남지 않게 한다. 실패/성공/재실행 모두 진단 결과를 이 문서에 독립 보존한 뒤 supported 등록/review/apply/finalize로 정리한다.
- 문서: managed-providers의 현재 unknown tool 계약은 그대로 유지하며 테스트만 일치시킨다. project-maintenance 잠금 owning 절에 bounded wait 및 fail-closed 보존을 반영한다. 외부 실행/기존 source 변경·staged 항목은 커밋에 포함하지 않는다.
- 완료 기준: 실제 실패가 재현되거나 충분한 이전 증거가 있고 원인 수정 후 필수 검사 통과, 실제 exit와 timing 기록, task-owned disposable 부재 또는 정확한 잔여 경로의 사용자 승인, task-level commit.
## 사전 회귀 검사 및 추가 확인

- 첫 targeted 실행: run:DW-01:fix-20261026T052127524Z. 실제 CLI close를 기다렸고 producerStopped=true, exit1로 기록했다. 잠금 소유자 회귀와 run claim child 경합 회귀, Meta 19개 검사는 exit0였다. Cargo 묶음만 recipe 전수 검사에서 실패했다. 시간은 모두 10초 이하이므로 성능 통계를 내지 않는다.
- 기존 오류의 첫 실패 뒤에 engine.mcp-lazy-startup.native 및 selected-upstream 9개 scope의 reviewed recipe 누락도 있었다. 실제 wrapper의 Cargo argv·Windows/Unix/macOS 분기·integration runtime 바인딩을 대조해 추가하고 각 실제 suite와의 명령 비교 회귀를 유지한다. source-only evidence cache의 허용 wrapper 집합은 확대하지 않는다.
- run claim 내부의 같은 catalog를 각 member마다 다시 읽던 것을 잠금 내 1회 snapshot으로 공유한다. 원래의 모든 member 경로·중첩 검사는 유지하며 claim 유지 시간을 줄인다.
- 새 회귀는 지속 계약(명령 선택, timed contention, stale marker 보존, Meta 실패 결과 identity)을 보호하므로 유지한다. 복사 fixture의 junction은 생성한 테스트 프로세스가 teardown에서 링크만 제거하고 대상 파일은 건드리지 않는다.
## 첫 전체 실행에서 확인한 후속 원인

- run:DW-01:verified-20261026T052422772Z. recipe/실제 run-claim targeted 검사와 dependency gate는 exit0.
- 전체 source preflight actual exit1, CLI wall 307856.1689ms, feature32/check19 실행/3실패/4미실행. 실패한 표본이며 두 번 비교하는 성공 통계에 넣지 않는다.
- 원래 fixture-guards와 Meta check는 통과했다. 기존 lock 충돌도 재발하지 않았다.
- 새 실패: tool.project-maintenance.adapter 및 lifecycle-source가 공통 PowerShell 어댑터의 Get-Command node 결과 배열을 단일 실행파일로 취급하여 실패했다. fixture 실행 환경의 Node PATH 중복으로 재현되었다. 첫 Application 하나만 선택하도록 수정하고 기존 실삭제/catalog lock 회귀의 자식 PATH에 Node를 추가하여 중복 상황을 직접 검증한다.
- writers의 관리 CLI 복사 fixture도 maintenance-lock-owner.cjs가 빠져 MODULE_NOT_FOUND였다. 실제 CLI를 계속 실행하는 회귀 fixture에 이 필수 의존성을 포함했다.
- 첫 target 실패 run은 native 등록/review/apply로 실제 deleted/remaining=false를 확인했고 supported finalize의 finalized/remaining=[]/references=[]/blockers=[]도 확인했다.
## 실행 경로 보정

- 추가 targeted run: run:DW-01:verified-20261026T053106165Z. 중복 PATH에서 PowerShell 삭제/catalog lock 검사는 exit0였다. 관리 CLI 복사 fixture는 helper 누락을 해소한 뒤 Windows AF_UNIX 최대 100-byte socket 경로 검사에서 실패했다.
- 이 추가 실패는 검증 controller가 TEMP를 긴 run 경로에 두어 os.tmpdir 기반 모의 socket 인자가 길어진 환경 준비 문제다. 제품의 경로 제한을 완화하지 않는다. 다음 run은 temporary 역할을 artifacts/tasks/f<8자리 고유 ID>의 짧고 명시적으로 소유한 별도 경로에 기록한다. run 본문과 짧은 temporary를 같은 lifecycle group으로 등록·정리한다. 관리 fixture의 tasks 경계와 다른 출력 역할은 유지한다.
## 남은 fixture 의존성 점검

- run:DW-01:verified-20261026T053201980Z의 첫 full source 실행은 actual exit1, 295661.9524ms였다. 19개 check 중 lifecycle-source만 실패했고 4개가 실패 선행조건 때문에 미실행이었다. adapter와 writers는 통과했다.
- 마지막 실패는 test-platform-packaging.cjs가 실제 artifact-lifecycle.cjs를 복사하면서 maintenance-lock-owner.cjs를 누락한 것이었다. 실제 파일 복사 목록을 찾아 같은 의존성이 빠진 build-metrics fixture까지 일치시켰다. metrics 회귀의 pwsh 선택도 첫 Application으로 명확히 한다.
- 다음 full 측정 전 lifecycle source, Windows build-metrics 모의 회귀 및 앞서 막힌 verification-schedule/providers/telemetry/MCP wrapper 검사를 모두 먼저 실행한다. 제품 바이너리 빌드나 설치를 실행하는 검증이 아니다.
## 측정과 정리의 공유 자원 충돌 교정

- run:DW-01:verified-20261026T054007082Z에서 lifecycle source, 남은 source 검사, Windows build-metrics 모의 검사는 모두 exit0였다. 그러나 동시에 수행한 native cleanup이 실제 프로젝트 catalog.lock을 점유하여 full source의 새 producer 등록 및 종료 기록과 충돌했다. 이는 root의 병행 실행 순서 오류다. 전체 실패 표본(291404.7775ms)은 성공 통계에서 제외한다.
- fixture-guards의 shared Cargo fixture와 lifecycle-source는 실제 catalog EEXIST로 실패했다. adapter의 unknown-completion 회귀에는 results.json.tmp 교체 EPERM도 한 번 관측됐다. 이 회귀를 먼저 다시 확인하며 잠금/삭제 안전장치를 완화하지 않는다.
- controller 실제 exit1, source CLI close 및 모든 tracked child close의 producer.json이 이미 기록되어 있었다. 정리 guard가 정상 해제된 뒤 supported closeLifecycle로 실패 결과를 유지하여 pending 제어 기록을 종료했다. PID 부재를 종료 증거로 사용하지 않았다.
- 이제 성공한 source 단계의 2회 측정과 controller 종료까지 native 등록·review·apply·finalize 및 lifecycle control writer를 실행하지 않는다. 검증 뒤에만 남은 정리를 수행한다. 모든 실제 소스 입력은 고정한다.
## Windows checkpoint 교체 오류 수정

- 정리와 분리한 run:DW-01:verified-20261026T055016792Z에서도 adapter가 실패했다. 전체 23개 check를 모두 실행했고 22개가 통과했으며, 이번에는 test-project.cjs checkpoint의 실제 renameSync(results.json.tmp → results.json) EPERM이 다른 회귀에서도 발생했다. 따라서 EPERM을 정리 충돌의 부수 현상으로 확정할 수 없으며 별도 수정이 필요하다. 실패 wall 298664.9761ms는 성공 통계에서 제외한다.
- 기존 feature-preservation.cjs의 Windows receipt 교체 방식을 재사용하여 EPERM/EBUSY만 25/50/100/200/400ms로 제한 재시도한다. 기존 파일 삭제·강제 변경은 없으며 비 Windows·다른 오류는 즉시 전달한다.
- 실제 checkpoint를 fault injection으로 연속 EPERM/EBUSY 후 성공시키는 회귀와 6회 실패 후 이전 checkpoint/원래 예외 보존·후속 명령 미실행 회귀를 추가했다. 기존 runner의 성공·실패·미확인 실행 기록 계약을 유지한다.
## 최종 결과와 시간

- 상태: 수정·검증·임시 자료 정리 완료. 검증된 이번 변경만 task commit으로 기록한다.
- 최종 실행: run:DW-01:verified-20261026T055733357Z. Controller 실제 exit0, producerStopped=true, 모든 tracked child close 확인.
- 1회차 UTC 05:57:36.076–06:02:29.694: 293618.2202ms, exit0/signal=null.
- 2회차 UTC 06:02:29.696–06:07:11.532: 281836.1838ms, exit0/signal=null.
- 평균 287727.202ms. 각 32개 feature/23개 source check 모두 exit0. 실제 invocation group은 20개이며 passing-evidence 재사용 0개. 입력 identity는 동일하다. OS 캐시는 지우지 않았으며 캐시 효과의 인과관계는 측정하지 않았다.
- 마지막 Windows checkpoint fault-injection 및 기존 runner 회귀 검사 exit0. 10초 이하 준비/검사는 성능 통계를 생략했다.
- 시작 UTC 05:16:23에서 최종 2회 검증 종료까지 50분48.532초. 정리·분석·커밋까지 포함한 전체 시간은 최종 보고에서 별도 기록한다.
- 지속 회귀 검사는 기존 테스트 파일에서 command recipe, 실제 child 경합, Windows 교체 실패 보존, fixture 의존성 및 Meta 계약을 보호하므로 유지한다. disposable 테스트 스크립트는 추가하지 않았다.

### 삭제 전 독립 보존한 검증 증거

~~~json
[
  {
    "file": "artifacts\\tasks\\DW-01\\runs\\verified-20261026T055733357Z\\outputs\\source-1\\preservation-PlIjge\\receipt.json",
    "receiptSha256": "ccd1abdfef387d08023a9918fbbe77ab7c74c3bde45125bd60f7630fc12cff25",
    "status": "passed",
    "features": 32,
    "checkCount": 23,
    "nonzero": [],
    "reused": 0,
    "inputsSha256": "8d12b60e75280403b4ddfbeb153e247b3a5bc8b38c17fb2d10b6899315f2ebfa",
    "projectSha256": "7bc94562b5353a8eb4d0391a2cab48a3ad99f47e668be0d5a73e0c227252cd76",
    "engineSha256": "2fcce7f772adaad6296e736430dc32e7437e8afdffdc78af61440391184b7bde",
    "checkIds": [
      "runtime.deletion-approval.host",
      "engine.shared-engine.fixture-guards",
      "engine.shared-engine.host",
      "engine.shared-engine.manifest-policy",
      "engine.source-provenance.root-guards",
      "engine.parent-requests.guidance",
      "engine.model-harness-profiles.mapping",
      "engine.model-harness-profiles.guidance",
      "engine.managed-tool-identities.mapping",
      "engine.managed-tool-identities.adapter",
      "engine.meta-provider.source",
      "engine.provider-context.input-budget-helper",
      "engine.provider-context.safe-context-export",
      "tool.project-maintenance.adapter",
      "tool.project-maintenance.lifecycle-source",
      "tool.project-maintenance.ao-layout",
      "tool.project-maintenance.guidance",
      "tool.project-maintenance.writers",
      "tool.project-maintenance.verification-schedule",
      "engine.error-classification.providers",
      "engine.error-classification.telemetry",
      "engine.error-classification.export",
      "engine.mcp-lazy-startup.wrapper"
    ],
    "cache": {
      "schema": 1,
      "executed": 20,
      "reused": 0,
      "eligible": 0,
      "deferred": [],
      "scope": "all invocation groups (eligible counts source-cache groups only)"
    }
  },
  {
    "file": "artifacts\\tasks\\DW-01\\runs\\verified-20261026T055733357Z\\outputs\\source-2\\preservation-7odTNf\\receipt.json",
    "receiptSha256": "c6442da8a65bc7095b2c297b9ee30103ef8ceac226ba2f091e2c8dd56f5cf27e",
    "status": "passed",
    "features": 32,
    "checkCount": 23,
    "nonzero": [],
    "reused": 0,
    "inputsSha256": "8d12b60e75280403b4ddfbeb153e247b3a5bc8b38c17fb2d10b6899315f2ebfa",
    "projectSha256": "7bc94562b5353a8eb4d0391a2cab48a3ad99f47e668be0d5a73e0c227252cd76",
    "engineSha256": "2fcce7f772adaad6296e736430dc32e7437e8afdffdc78af61440391184b7bde",
    "checkIds": [
      "runtime.deletion-approval.host",
      "engine.shared-engine.fixture-guards",
      "engine.shared-engine.host",
      "engine.shared-engine.manifest-policy",
      "engine.source-provenance.root-guards",
      "engine.parent-requests.guidance",
      "engine.model-harness-profiles.mapping",
      "engine.model-harness-profiles.guidance",
      "engine.managed-tool-identities.mapping",
      "engine.managed-tool-identities.adapter",
      "engine.meta-provider.source",
      "engine.provider-context.input-budget-helper",
      "engine.provider-context.safe-context-export",
      "tool.project-maintenance.adapter",
      "tool.project-maintenance.lifecycle-source",
      "tool.project-maintenance.ao-layout",
      "tool.project-maintenance.guidance",
      "tool.project-maintenance.writers",
      "tool.project-maintenance.verification-schedule",
      "engine.error-classification.providers",
      "engine.error-classification.telemetry",
      "engine.error-classification.export",
      "engine.mcp-lazy-startup.wrapper"
    ],
    "cache": {
      "schema": 1,
      "executed": 20,
      "reused": 0,
      "eligible": 0,
      "deferred": [],
      "scope": "all invocation groups (eligible counts source-cache groups only)"
    }
  }
]
~~~

## 임시 자료 정리 완료

- 실제 controller close와 wrapper spawnSync 종료 결과를 대조해 legacy lifecycle-check 9개를 소유 helper로 종료 기록했다. 실패는 실패로 보존했고 같은 경로·소유자의 누락된 생성/보호 metadata만 보충했다.
- 부모 run4개, lifecycle-check9개, 해당 preflight의 test-cargo-shared-cache defaultRun4개: 총17개 lifecycle group, 21개 분리 root를 기존 producer identity로 native 등록·review·apply했다.
- native apply aborted=false, 17개 group 모두 deleted, 21개 item 모두 deleted/remaining=false, 오류 없음. supported finalize17개 모두 finalized, remaining/references/blockers 빈 배열.
- 새로 생성한 빈 artifacts/tasks/DW-01/runs 및 DW-01 컨테이너도 일반 rmdir로 제거하고 부재를 확인했다.
- 기존 archive의5개 fixture는 이전 사용자 결정대로 유지한다. 이번 작업에서 새로 보존한 disposable 자료는 없다.
- 커밋에 사용할 대체 Git index .git/DW-01-fix.index는 이번 작업의 일시 제어 파일이며 commit 후 일반 삭제·부재 확인한다. 원래 index의 무관한 staged 변경을 보존한다.

~~~json
[
  {
    "id": "run:DW-01:verified-20261026T053201980Z",
    "owner": "source-preflight-failure-fix",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\DW-01\\runs\\verified-20261026T053201980Z",
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\f10808daa"
    ]
  },
  {
    "id": "run:DW-01:verified-20261026T054007082Z",
    "owner": "source-preflight-failure-fix",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\DW-01\\runs\\verified-20261026T054007082Z",
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\f6b2ba6e7"
    ]
  },
  {
    "id": "run:DW-01:verified-20261026T055016792Z",
    "owner": "source-preflight-failure-fix",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\DW-01\\runs\\verified-20261026T055016792Z",
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\fe60af42c"
    ]
  },
  {
    "id": "run:DW-01:verified-20261026T055733357Z",
    "owner": "source-preflight-failure-fix",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\DW-01\\runs\\verified-20261026T055733357Z",
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\ff86b487a"
    ]
  },
  {
    "id": "run:lifecycle-check:a8d4766c-e823-49ad-ac02-a098aaecd3d7",
    "owner": "artifact-lifecycle-checks",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\lifecycle-checks\\runs\\a8d4766ce82349adac02a098aaecd3d7"
    ]
  },
  {
    "id": "run:lifecycle-check:3f02466c-86ab-4457-b505-b289d3ebcbf8",
    "owner": "artifact-lifecycle-checks",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\lifecycle-checks\\runs\\3f02466c86ab4457b505b289d3ebcbf8"
    ]
  },
  {
    "id": "run:lifecycle-check:d4612500-437e-4e05-a5d6-03a2ccd91e27",
    "owner": "artifact-lifecycle-checks",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\lifecycle-checks\\runs\\d4612500437e4e05a5d603a2ccd91e27"
    ]
  },
  {
    "id": "run:lifecycle-check:bbccb90b-c4bc-4db4-b663-0b04baf21725",
    "owner": "artifact-lifecycle-checks",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\lifecycle-checks\\runs\\bbccb90bc4bc4db4b6630b04baf21725"
    ]
  },
  {
    "id": "run:lifecycle-check:eab6de3b-1803-4389-ba9c-b24ea42f9825",
    "owner": "artifact-lifecycle-checks",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\lifecycle-checks\\runs\\eab6de3b18034389ba9cb24ea42f9825"
    ]
  },
  {
    "id": "run:lifecycle-check:8ff265d5-d8e5-4dee-bca9-d6adee74ddd8",
    "owner": "artifact-lifecycle-checks",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\lifecycle-checks\\runs\\8ff265d5d8e54deebca9d6adee74ddd8"
    ]
  },
  {
    "id": "run:lifecycle-check:2fe6e610-179f-486d-9f91-b9a03e09ef85",
    "owner": "artifact-lifecycle-checks",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\lifecycle-checks\\runs\\2fe6e610179f486d9f91b9a03e09ef85"
    ]
  },
  {
    "id": "run:lifecycle-check:d7be07ad-9f49-4f85-94ee-b2f32e024a1a",
    "owner": "artifact-lifecycle-checks",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\lifecycle-checks\\runs\\d7be07ad9f494f8594eeb2f32e024a1a"
    ]
  },
  {
    "id": "run:lifecycle-check:ece9305b-987a-4288-ab53-9672dde7fea9",
    "owner": "artifact-lifecycle-checks",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\lifecycle-checks\\runs\\ece9305b987a4288ab539672dde7fea9"
    ]
  },
  {
    "id": "run:cargo-cache-tests:20261026T053219096Z-fd7a0065-543e-465b-b927-dc356484ae26",
    "owner": "cargo-cache-tests",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\cargo-cache-tests\\runs\\20261026T053219096Z-fd7a0065-543e-465b-b927-dc356484ae26"
    ]
  },
  {
    "id": "run:cargo-cache-tests:20261026T055033347Z-312d85e8-1271-486c-928f-4b31d50bc7f4",
    "owner": "cargo-cache-tests",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\cargo-cache-tests\\runs\\20261026T055033347Z-312d85e8-1271-486c-928f-4b31d50bc7f4"
    ]
  },
  {
    "id": "run:cargo-cache-tests:20261026T055752356Z-1c6f89c6-63f3-46ee-875e-3963a059cfdf",
    "owner": "cargo-cache-tests",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\cargo-cache-tests\\runs\\20261026T055752356Z-1c6f89c6-63f3-46ee-875e-3963a059cfdf"
    ]
  },
  {
    "id": "run:cargo-cache-tests:20261026T060243692Z-5cbe7ddd-c4a6-4247-8a65-82ff2b8d0a89",
    "owner": "cargo-cache-tests",
    "paths": [
      "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\cargo-cache-tests\\runs\\20261026T060243692Z-5cbe7ddd-c4a6-4247-8a65-82ff2b8d0a89"
    ]
  }
]
~~~

### 삭제 결과 요약

~~~json
{
  "groups": [
    {
      "id": "run:DW-01:verified-20261026T053201980Z",
      "status": "deleted"
    },
    {
      "id": "run:DW-01:verified-20261026T054007082Z",
      "status": "deleted"
    },
    {
      "id": "run:DW-01:verified-20261026T055016792Z",
      "status": "deleted"
    },
    {
      "id": "run:DW-01:verified-20261026T055733357Z",
      "status": "deleted"
    },
    {
      "id": "run:cargo-cache-tests:20261026T053219096Z-fd7a0065-543e-465b-b927-dc356484ae26",
      "status": "deleted"
    },
    {
      "id": "run:cargo-cache-tests:20261026T055033347Z-312d85e8-1271-486c-928f-4b31d50bc7f4",
      "status": "deleted"
    },
    {
      "id": "run:cargo-cache-tests:20261026T055752356Z-1c6f89c6-63f3-46ee-875e-3963a059cfdf",
      "status": "deleted"
    },
    {
      "id": "run:cargo-cache-tests:20261026T060243692Z-5cbe7ddd-c4a6-4247-8a65-82ff2b8d0a89",
      "status": "deleted"
    },
    {
      "id": "run:lifecycle-check:2fe6e610-179f-486d-9f91-b9a03e09ef85",
      "status": "deleted"
    },
    {
      "id": "run:lifecycle-check:3f02466c-86ab-4457-b505-b289d3ebcbf8",
      "status": "deleted"
    },
    {
      "id": "run:lifecycle-check:8ff265d5-d8e5-4dee-bca9-d6adee74ddd8",
      "status": "deleted"
    },
    {
      "id": "run:lifecycle-check:a8d4766c-e823-49ad-ac02-a098aaecd3d7",
      "status": "deleted"
    },
    {
      "id": "run:lifecycle-check:bbccb90b-c4bc-4db4-b663-0b04baf21725",
      "status": "deleted"
    },
    {
      "id": "run:lifecycle-check:d4612500-437e-4e05-a5d6-03a2ccd91e27",
      "status": "deleted"
    },
    {
      "id": "run:lifecycle-check:d7be07ad-9f49-4f85-94ee-b2f32e024a1a",
      "status": "deleted"
    },
    {
      "id": "run:lifecycle-check:eab6de3b-1803-4389-ba9c-b24ea42f9825",
      "status": "deleted"
    },
    {
      "id": "run:lifecycle-check:ece9305b-987a-4288-ab53-9672dde7fea9",
      "status": "deleted"
    }
  ],
  "results": [
    {
      "id": "0c595bd8b0beafb208d7fc4b3b490f59fa6f0894b66f80f03b197c6eb15eda88",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-2976-1792995992435",
      "attributeChanges": 0
    },
    {
      "id": "11968445a13af30c6f4ccd45c113fc3aa590d03b16eac9173b866fffe5e85662",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-2979-1792996030057",
      "attributeChanges": 0
    },
    {
      "id": "ff884c6183c8c9103e4eda880522c6a079d4e308e61ba943e261397ade22ed95",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-2982-1792996069537",
      "attributeChanges": 0
    },
    {
      "id": "127a0cd80e9588896e6e0efdd6f392f6cf9236245073a63992fda8f6cf72f61c",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-2985-1792996117048",
      "attributeChanges": 147
    },
    {
      "id": "176bfffc0cb953dc90d3e68ebb31fcad49f8694791f92859f428b857588e0e58",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-2988-1792996187871",
      "attributeChanges": 0
    },
    {
      "id": "7cf39aee7052e4d57a63b4a36c0cb60a6582b491caacd826c08595c8ac8d7e74",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-2991-1792996233781",
      "attributeChanges": 0
    },
    {
      "id": "1a36d17a0e973f1fe3a240c05b7ee0ffd6830b0d37ee8415b0debd1efddc7843",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-2994-1792996279512",
      "attributeChanges": 147
    },
    {
      "id": "218d17cbf1f1f3cc9bca10bc5a937e9e37573f7109598b248fd6d292176d1ca4",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-2997-1792996348013",
      "attributeChanges": 0
    },
    {
      "id": "22c269f278e4634ff07b62d625080b90ccc8c46001d596a5621862bd008e5f18",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3000-1792996401418",
      "attributeChanges": 147
    },
    {
      "id": "5b00caa04a0f8456111cd68190e42e228d0aeaef393912af80a406dbc597fc48",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3003-1792996467009",
      "attributeChanges": 0
    },
    {
      "id": "be061a3a18acae79bb0dc94e0e5774c56ba69c13eff96f6aa8c49cd25a06425a",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3006-1792996507238",
      "attributeChanges": 0
    },
    {
      "id": "655a4069b5d58b0ba0e26edd0196e7e47103fe9734792f3822d0df5b74c25ac5",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3009-1792996544274",
      "attributeChanges": 0
    },
    {
      "id": "b3e27756c7527cb1748398257820f312177d555f48d89af810932bc2c5d7385f",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3012-1792996583308",
      "attributeChanges": 0
    },
    {
      "id": "68bfe5b2eb69fd795d39b2bbefebe147a9a76011029c9187fa54ffe945607f51",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3015-1792996625104",
      "attributeChanges": 0
    },
    {
      "id": "9064ea5e10fb41d0d6dd17968f51087f1557c0efe08c21cdc7edc74726ef099d",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3018-1792996668101",
      "attributeChanges": 0
    },
    {
      "id": "937233457e0e668d622668ff42c8e7d584cdf606e986d568851d526dac049763",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3021-1792996706114",
      "attributeChanges": 0
    },
    {
      "id": "9538f2d94ecb96faa5e0808767f4bc50afabd844f3d0e9e8f47606fb55188bb9",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3024-1792996746645",
      "attributeChanges": 0
    },
    {
      "id": "c837595f840a06d76bd59270b792612c0c42000be0377a3f862738fa9bf3d882",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3027-1792996786072",
      "attributeChanges": 0
    },
    {
      "id": "de90f8946e40ae7a4af42d14f1f342ca74766fd467b19670910cc42f82c14e1b",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3030-1792996833853",
      "attributeChanges": 147
    },
    {
      "id": "e7e803013a67419daf1b4181f76f339044ee61e255bc8f2744657cecf5eeb02c",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3033-1792996897658",
      "attributeChanges": 0
    },
    {
      "id": "f29e6d3bb89521a2cc140444ea1eab51bc2fe9ec608a5c043e4af77c8c29cfc4",
      "status": "deleted",
      "remaining": false,
      "attempt": "attempt-54328-3036-1792996938119",
      "attributeChanges": 0
    }
  ],
  "intervals": {
    "first": 1792995992435,
    "last": 1792996938119,
    "meanGapMs": 47284.2
  }
}
~~~

## 사용자 요청: 삭제 도구 속도 원인 분석

- 분석만 수행하며 성능 개선 코드·새 benchmark·빌드·설치는 수행하지 않았다.
- 실행 엔진: artifacts/workspaces/h/artifacts/releases/w13r-99afefb1/engine/azrael.exe, PID54328. build-info의 engineSourceRoot는 artifacts/inputs/dm01-w13r/project/engine. installed workspace와 고정 입력의 apply/groups/registry/paths/storage5개 파일 SHA는 일치한다. 현재 checkout과 설치본 파일 SHA는 달라, 분석은 고정 입력을 기준으로 했다.
- 정리 중 producer catalog593개 record/4788개 member/3328673bytes, manifest 약11.77MB/items868/groups412/runs72/decisions1012 관측.
- 설치본 registry.rs:307 observe는 catalog를2회 호출한다. catalog(:250)는 전체 record를 순회하며 각각2회 read하고 validate한다. validate(:158)는 모든 member의 경로를 검사하고 checked_metadata(paths.rs:310)는 ancestor마다 권한·symlink metadata를 다시 확인한다.
- 초기17개 group batch 및21개 item별 intent 저장 전후 safe_entries2회에서 source observation을 반복한다. 정상 경로 정적 추산: observe59회 → 전체 catalog118회 → record read139948회/member 경로 검증564984회. 실제 profiler 호출 횟수가 아닌 정적 추산이다.
- storage.rs:65 save는 전체 manifest를 pretty JSON 직렬화, create_new 파일 쓰기, sync_all, rename한다. 성공 삭제당 intent/result/잔존 관측3회 저장하므로21개 item은63회, 현재 크기 기준 약742MB 재기록 구조다. 과거 decision이 같은 JSON에 누적돼 작업이 늘수록 비용도 커진다.
- 실제 attempt_id 첫 intent06:26:32.435, 마지막06:42:18.119. 항목 전환 간격 평균47.2842초/최소37.036초/최대70.823초. 물리 삭제만의 시간이 아니라 검증·기록·다음 항목 준비를 포함한다. 602-byte cargo run도 비슷한 간격이므로 payload 용량만으로 설명되지 않는다.
- registered 검증으로 payload full hashing을 선택하지 않았다. 전체 catalog/ancestor 재검증과 manifest 재기록이 유력한 병목이다. CPU/I/O 기여율 및 Defender·디스크 영향은 profiler 없이 확정할 수 없다.
- 개선 권고: 구간별 elapsed/call counters부터 추가; 잠금·revision·외부 변경 및 권한 callback 변이 탐지를 보존하는 catalog snapshot/참조 index/ancestor 관측 재사용; intent/result durability를 유지하는 append-only journal+주기적 snapshot 또는 transaction store 검토. 권한·링크·새 consumer·TOCTOU 검사를 생략하거나 무조건 캐시하지 않는다.

상태: 기능·지침·writer 이전·삭제 최적화·검증과 검토한 종료 생성물 정리를 완료했다. 구버전9묶음40경로 전부 부재이고9producer finalized다. 상세 증거를 승격하고 일회성 빌드·비교·삭제 제어 파일도 제거했다. 결과는 작업별 로컬 커밋에 기록한다.

# 공통 테스트·빌드·산출물 관리

## 목표와 확정된 권한

Rust 공통 라이브러리를 Azrael 엔진에 내장하여 프로젝트가 소유한 테스트·빌드 묶음을 호출하고, 테스트·fixture·빌드 결과·캐시·백업의 목록과 보호 근거를 확인한 모델이 삭제 또는 보류를 선택하게 한다. 프로젝트마다 관리 실행파일을 설치하지 않으며 상주 서비스·예약 실행·별도 모델 호출을 만들지 않는다.

사용자는 계획대로 구현하고 현재 프로젝트에서 검증하도록 지시했고, 이후 작업/실행·버전·공유 단위의 수명 관리, 관련 공통 지침 수정, 새 프로젝트용 파일구조 마이그레이션 playbook까지 승인했다. 현재 소스·유지 지침·활성 설치 사본을 수정하고 관련 검사와 작업 산출물 정리, 작업별 로컬 커밋을 수행한다. 전체 앱/VSIX 빌드·일반 프로필 설치·배포·원격 실행·push는 수행하지 않는다. 기존 사용자 변경과 다른 작업의 producer·산출물은 보존한다.

## 합의된 동작과 지원 경계

- 프로젝트가 테스트 스크립트와 `project-maintenance.json`의 명령·입력·선행 관계·관리 루트·보호 경로를 소유한다. `one_off`와 `retained` 목적을 `prepare`, `test`, `build` 단계와 각각 구분한다. 기존 테스트 추가 기준·유효한 계약·필수 검증을 유지한다.
- 일회성 묶음도 실패를 수정하고 여러 번 재실행할 수 있다. 결과 검토와 필요한 재검증 후 현재 모델이 삭제 또는 보류를 선택한다. 통과·나이·용량·작업 종료 자체는 삭제 결정이 아니다. 보류에는 이유와 다음 조건을 남기며 기존 권한을 반복 사용자 승인으로 되돌리지 않는다.
- 테스트 준비 컴파일, 테스트 결과와 제품 빌드 결과를 구분한다. 같은 실행 의미만 공유하고 기존 selector·cache owner·고정 입력과 필수 검사 의미를 보존한다. 전체 빌드 성능 개선률은 이번 검증에서 주장하지 않는다.
- 새 생성물은 실행 전에 소유 묶음·예상 경로·입력/도구 identity·활성 참조를 기록한다. 실패·취소·종료 미확인도 실제 결과만 남긴다. producer 종료 확인과 테스트 성공을 구분하며 실제 exit를 모르면 `null`이다. 명시적 복구도 성공을 만들지 않는다.
- 관리 항목은 소유·출처·크기·버전·참조·보호/복구 조건을 가진다. 목록은 등록된 측정값을 요약하고 정밀 검토에서 필요한 identity를 다시 측정한다. 논리 크기를 실제 회수 공간으로 과장하지 않는다. 이름이나 나이만으로 생성물·폐기 가능성을 추정하지 않는다.
- 묶음의 어느 구성원이 보호되거나 불확실하면 전체를 보호한다. 최신 검토 토큰과 구성·소비 참조를 다시 확인하며 live 구성원을 빠뜨려 삭제 범위를 줄이는 우회를 거부한다. payload 먼저, 로그/근거 나중에 삭제하고 실패하면 해당 묶음의 미시도 근거를 보존한다. 실제 잔여를 확인하기 전 전체 삭제 완료를 보고하지 않는다.
- 원본·사용자 파일·현재 설치본·직전 검증된 복구본·활성 실행·고정 입력·인계 대기·필수 검증·유일한 백업을 보호한다. 확인된 생성물을 모델이 삭제로 선택한 경우에만 필요한 ReadOnly/Hidden을 정규화하고 일반 삭제한다. System/ACL/소유자 변경, 강제 삭제와 실패 후 다른 API 우회는 없다.
- 전역 지침은 특정 프로그램과 무관하게 적용된다. Azrael 전용 이름·호출법은 실제 도구가 제공될 때만 native developer 문안에 포함하고 철회한다. 소스 수정이 실행 중인 앱의 도구 가용성을 바꾸지는 않는다.

공통 의미의 대상은 Windows x64, Linux x64, macOS ARM64다. 플랫폼별 경로·권한·프로세스 경계는 각 소유자에서 다루며 현재 실기기 검증은 Windows x64 로컬에 한정한다. macOS casefold 보호는 case-sensitive 볼륨에서 보수적 과잉 보호가 가능하다. PowerShell producer/cleaner 통합은 Windows 범위이며 공통 Rust 의미와 혼합되어 있다. 다른 OS 실기기·원격·일반 설치본 수용은 미검증이다.

상세 계약은 [프로젝트 관리 설계](../../docs/architecture/project-maintenance.md), 반복 명령은 [운영 문서](../../docs/ops/project-maintenance.md), 도입과 이전은 [수명주기 playbook](../../docs/playbooks/artifact-lifecycle.md)이 소유한다. 기능 보존 ID는 `tool.project-maintenance`다.

## 작업·버전 구조와 이전

기본 구조는 다음과 같으며 프로젝트가 동등한 경로를 설정할 수 있다.

```text
artifacts/
  tasks/<work-id>/runs/<run-id>/{inputs,temporary,outputs,logs,reports}
  versions/<product-version+unique-build-id>/{payload,verification}
  shared/<cache-kind>/<content-key>/
  maintenance/
```

각 생성물은 한 소유 작업/실행·버전·공유 묶음에 속하고 다른 사용자는 명시적 소비 참조를 가진다. raw 로그는 생성 실행에 두며 버전에서 필요한 검증만 출처·내용 identity·명령/환경·실제 결과와 함께 독립적으로 읽을 수 있게 보존하고 참조를 전환한다. 임시 deploy/account fixture는 보존할 버전 payload와 별도 run이다. 성공 후 필요한 근거의 승격과 producer 종료를 확인해 기존 fixture 정리를 수행하고, 실패·미확인 fixture는 보호한다.

기존 경로를 당장 옮기지 못하는 주요 build/package/deploy producer는 같은 수명의 경로를 producer record로 연결한다. native `group` 등록은 실제 항목을 원자적으로 등록하며 서로 겹치는 raw 경로를 분리된 소유 루트로 투영한다. 작은 `membership_source` 파일/디렉터리 identity가 바뀌거나 사라지거나 읽히지 않으면 전체 재등록 전 삭제를 차단한다. 들어오는 소비 참조도 이에 포함된다. producer metadata는 실제 전 구성원 부재와 소비 참조 해제를 확인한 뒤 해당 record만 정리한다.

미등록 legacy 후보의 destructive cleanup은 `lifecycle-membership-unreviewed`로 차단한다. 공유 cache는 기존 owner의 잠금·재사용·bounded eviction을 유지한다. 사용자 런타임 복구 기록은 빌드 산출물로 분류하지 않는다. 모든 과거 경로와 독립 스크립트가 새 기본 경로로 물리 이전됐다는 뜻은 아니다.

공통 `implementation` 지침과 활성 사본에는 실행 전 등록, 결과 검토·재실행, 묶음 삭제/보류, 부분 실패와 근거 승격 규칙을 반영했다. `project-bootstrap`은 lifecycle/migration playbook을 app-logging과 함께 기본 도입/merge한다. 문서 복사만으로 파일을 이동하거나 runtime scaffolding을 만들지 않는다. 기존 프로젝트는 inventory·소유/경로 mapping·dry-run → 미래 writer 변경 → 작은 inactive pilot 복사/identity 확인 → reader 참조 전환과 실제 검증 → 모델의 이전 경로 삭제/보류 → 복구/재실행 순서다. 미확인 과거 파일, 사용자 파일, 링크, 유일한 복구본과 활성 입력은 그대로 보호한다.

## 전수 조사 근거와 발견

2026-10-15 03:33:51~03:37:09 UTC에 workspace metadata를 조사했다. `.git`과 reparse traversal을 제외한 4,823,125 파일, 0 읽기 오류, 76 reparse 제외, 198.49초다. 동시 쓰기를 허용한 비원자적 논리 크기 측정이므로 실제 회수 가능 공간이나 링크 대상의 조사 결과가 아니다.

| 조사 영역 | 당시 논리 크기 | 유지보수 의미 |
| --- | ---: | --- |
| `engine` | 417.95 GiB | 공유 Cargo target이 주된 용량; 활성 producer/기존 cache owner 보호 필요 |
| `artifacts` | 288.96 GiB | 생성물·고정 입력·기존 작업 디렉터리가 혼합됨 |
| `artifacts/verification` | 45.30 GiB | snapshot/fixture와 현재 참조를 구별해야 함 |
| `artifacts/deployments` | 27.79 GiB | 보존 버전과 검증·복구 참조를 연결해야 함 |
| `artifacts/logs` | 8.153 GiB | 로그 외 소스/fixture 복사본이 섞여 있음 |

큰 로그 소유 경로는 `codex-stable-source-update` 1.367 GiB, `codex-0160-integration` 1.360 GiB, `ui-pipeline-optimization` 1.266 GiB다. 이 수치는 삭제 허가나 불필요 판정이 아니다.

build-azrael/build-platform/deploy/package-platform, preparation/cache/verification/recovery owner와 세 cleaner의 생산·보호·삭제 경계를 조사했다. 기존 release cleaner는 본체/VSIX만 삭제해 sibling 로그·영수증이 남았고, verification cleaner의 작은 JSON/TXT archive는 다른 fixture·부모 근거와 수명을 같이하지 못했다. verification/cache report를 삭제 후보 안에 지정하면 삭제 경로를 재생성할 위험도 있었다. 관련 producer 연결과 묶음 확장, 전체 보호, report-inside 차단을 구현했다. `recovery-state`의 사용자 런타임 복구 기록은 별도 보호 대상으로 확인했다.

출처·소비·설치·복구 관계가 확인되지 않은 과거 파일은 분류 미확정 상태로 남긴다. 이번 전수 metadata 조사와 주요 owner 검토를 모든 파일의 삭제 가능성 증명이나 전체 물리 마이그레이션 완료로 확대하지 않는다.

## 실행 분담과 입력

root가 공통 계약·프로젝트 설정·feature inventory·통합·문서·최종 검증·정리와 작업별 커밋을 소유한다. library 담당은 새 Rust crate, native 담당은 handler/권한/전용 문안과 이후 PS producer/cleaner, adapter 담당은 Node 연결, instruction 담당은 유지 지침·활성 사본·bootstrap playbook을 맡았다. 읽기 전용 조사는 cleaner와 producer 경계를 나눴다. 변경 소유권을 분리했고 다른 작업의 실행은 중단하지 않았다.

초기 frozen engine v1은 10,780 files, owner fingerprint `95ff0fdd22c6f20954a0097c80158106e6822fcbe3704e661cc3ca7e2d443e4b`다. 보완한 v2는 10,773 files, Python 파일 바이트 recipe `8c179ed08aef646e09c53ca7f09834938c7d7eee943afa084dfdc908d1a149f6`다. 다른 recipe의 지문을 직접 비교하지 않는다. 최종 group/source 입력은 v2를 복사한 뒤 담당 변경을 덮어 검증했고 `freeze-platform-inputs.inventoryTree` 지문 `da17b6b606db0cc1a0badbc1b4cc146f576ada30e4c7cc71a3ea5dc158227e22`, 10,783 files다. 실행 중 입력을 갱신하지 않는다.

## 검증 결과

| 범위 | 실제 결과와 한계 |
| --- | --- |
| 공통 지침/복사 playbook | import check exit 0: 24 skill files, 10 components, 57 links. 두 skill validator exit 0. 지침 fixture 34 pass(실제 release-assets integration 제외). 활성 바이트/receipt/mapping·기존 test criteria 20 outcomes 통과 |
| 최종 config/가용성 지침 소스 | `node --test scripts/test-project-maintenance.cjs scripts/test-common-agent-instructions.cjs`: 13 pass, exit 0 |
| lifecycle/build 소스 | 등록된 source check: 21 tests 중 20 pass/1 Unix mode skip, exit 0. 작은 portable packaging 17 checks, exit 0; native Unix 실행 증거 아님 |
| 공통 Rust | 최종 standalone Windows 41 pass(기존30 + group/source11), exit 0. workspace library도 exit 0 |
| Windows cleaner | 최종 delegated fixtures exit 0: legacy35, verification36, cache11 PASS summaries. 미등록 차단, 보호 로그, payload 잠금 실패, report-inside, 새 소비자 차단과 partial finalization 포함 |
| 모의 배포 | `verify only`, `account-success`, `build-fail`: harness exit 0, 3 pass. 성공 경로의 임시 fixture 삭제/근거 보존, 실패 child17/deploy1 및 failed/incomplete 보호 확인. 실제 빌드/설치 아님 |
| 기존 native v2 | core8 + prompts1 pass, exit 0. 같은 binary에서 allowed-tools/reviewer/API tool-free 세 관련 기존 회귀 pass, exit 0 |
| 최종 native group/source | workspace library41 + prompts1 + core8 pass, 각 exit0. 고정 입력 전체 identity 불변과 담당22파일의 최종 source byte 일치를 확인. 기존 v2 permission 결과는 해당 경계의 소스 변경이 없음을 확인해 재사용 |
| 최종 긴 경로·속성 audit 수정 | standalone library44(contracts31/groups13) + native core8 pass, 실제 exit0. 제품 코드가 같은 immutable engine 입력 재사용, 현재 제품/native 소유 파일 일치와 입력 불변을 확인. 긴 경로 삭제·실제 잔여·원래 audit 경로·unchanged 제외와 기존 보호 회귀 포함 |
| 실제 모델 판단 | 독립 Node fixture 실패7→모델 보류→입력 수정→재실행0→불필요 스크립트/입력/이전 백업 삭제. 유일한 복구본 보류 후 복구 종료 근거 확인 뒤 삭제. 확인된 ReadOnly+Hidden35→32 및 일반 삭제 audit 확인 |
| 그룹 실사용 | Node producer registry를 Rust 개발 harness에 투영. 모델 검토에서3항목·blockers0 확인 후 payload/log/report 함께 delete, 전부 실제 부재, producer record finalized 확인. 초기 managed-root 자체 보호도 동작했고 올바른 부모 관리 루트로 정정 |

실제 모델 판단과 library 개발 harness, 컴파일된 native handler 검증, 설치 앱의 도구 발견/호출을 구분한다. 현재 세션의 도구 목록에 새 기능을 주입하지 않았다. 일반 앱·VSIX 배포/설치와 새 대화의 직접 도구 가용성은 이번 범위 밖이다. Linux/macOS 실기기·전체 빌드 성능·모든 과거 파일의 분류/물리 이전도 미검증이다.

## 시간·재실행과 자원

실행 시작은 2026-10-15 01:03:52 UTC다. 초기 core compile 28m24s와 테스트8.05s, v2 최종 수용 compile11m18s와 테스트11.08s를 구분했다. v2 최초 시도는 이전 library artifact 연결로 복구 동작을 몰라 core7pass/1fail, exit101이었다. 같은 입력에서 해당 새 package만 `cargo clean -p`로 무효화하고 재실행했다. 이후 디스크2.4GB에서 소유 관계를 확인한 이번 Cargo와 자식만 중단(exit-1)했고, 기존 cache owner의 `cargo clean -p codex-core --target x86_64-pc-windows-msvc`로 8,604 files/43.4GiB를 회수한 뒤 jobs2/incremental0로 수용했다. 사용자 소스·설치본이나 다른 producer를 지우거나 중단하지 않았다.

최종 group/source 입력 준비 뒤 공유 Cargo lock은 03:49:38~03:55:24 UTC에 대기했다. 464 files/88.7MiB의 해당 새 package cache reset exit0 뒤 library 검사 27.32초, prompts 검사97.39초, core 검사를 직렬 실행했다(core 03:57:29~04:08:15 UTC, 실제 검사13.43초). dispatch example 준비는04:09:18 UTC exit0, 최종 frozen identity 불변 확인은04:09:29 UTC exit0이다. 대기 중 작은 standalone 사전 검사와 독립 Node/PS 통합·문서·커밋 준비를 수행했다. 병렬 시간을 합산하거나 작은 fixture 결과를 전체 빌드 단축으로 주장하지 않는다. deep Unicode deploy mock은 Git path 길이로 초기화 실패했다. child 환경과 fixture 명령에만 `core.longpaths`를 설정했고, 초기 config 경로 자체가261자였던 wrapper 재현은 UUID 구분자를 없애고 임시 project 루트를 짧게 해서 해결했다. UUID 정보와 실행별 소속은 유지한다. 최종 Windows 진입점은 cleaner3종과 모의 배포3사례 모두 실제 exit0이다. 원래 명령의 실패 exit1과 재실행 exit0을 구별했다. 정리 전 producer 종료와 구성원 완결성을 재조정한 complete 상태는 테스트 성공을 새로 만들지 않는다. 또 fixture를 버전에 묶어 보존시키던 중간 구현은 원래 성공 fixture 정리 검사를 유지하면서 별도 run 소유로 바로잡았다.

## 정리와 완료 조건

자체 정리 최초 등록·검토는 04:12:34 UTC 이후 실행했고 약 8분 뒤 4개 소유 묶음/7항목, 논리 크기765,463,132 bytes, blockers0을 반환했다. 삭제는 시도하지 않았다. 4개 구성원 묶음의 적용 경로에서 전체 남은 구성원을44회 측정하는 중복을 확인해, 각 write authorization 뒤 원래 모델 토큰과 비교하는 fresh observation1회만 수행하도록 줄였다. 전체 preflight와 durable intent 저장 전후 경계, config·membership source·권한·보호·이미 삭제한 구성원의 재등장 검사는 유지한다. 4개 구성원에 대한 측정은 코드상44→24회이며 실제 전체 정리 시간 단축률은 아직 측정하지 않았다. leaf/ancestor traversal 재설계는 포함하지 않았다.

추가 회귀2개는 관측 횟수와 target/source의 authorization·intent 경계 변경 차단을 다룬다. `perf-validation` 실행은 기존 작업 소유 묶음을 pending/incomplete로 바꾼 뒤 새 고정 입력과 로그를 생성한다. 변경된 library 전체 및 native core 필터, 개발 dispatch를 직렬 검증하고 기존 무변경 prompt·Node·PS 검증은 재사용한다. 새 입력은 완료된 이전 snapshot을 수정하지 않고 별도 고정하며, 적용 전에는 변경된 소유 묶음을 전체 재등록·검토한다.

성능 수정 고정 입력의 `inventoryTree` 지문은 `9356d8fb0e3cdf7b6b4fa5ccdd0326ca8a96f072fa2ce9c37d94d18717981fe9`(10,783 files), 변경 package 지문은 `bdba83464ab56bb5f22239ea54343a4197d8cc9d248172ab855d676c792a282a`다. 04:25:55 UTC 최초 확인에서 Cargo package clean은 공유 artifact directory 잠금을 기다리고 있었다. 새 캐시를 중복 생성하거나 다른 producer를 중단하지 않는다. 68개 staged 파일은 이번 전용53개와 공유15개 task patch이며 예외 경로0, `git -c core.whitespace=cr-at-eol diff --cached --check` exit0이다. CRLF 파일에 기본 diff 검사를 사용한 경고와 실제 공백 오류를 구별한다.

성능 수정 최종 검증은 모두 exit0: package clean04:23:40~04:26:26 UTC(42files/56.5MiB), library04:26:26~04:26:55(30contracts+13groups=43pass, compile8.64초), core04:26:55~04:37:57(8pass, compile10m47s/test12.55초), dispatch example04:37:57~04:38:00이다. 04:38:07에 frozen 전체 불변과 현재 package byte 일치를 최종 확인했다. 원래 producer 종료0과 완료 신호를 root가04:47에 수집했다. 이 결과로 추가 mutation/관측 횟수와 기존 denied-descendant/partial-logs/standalone 계약을 수용하며, 설치 앱이나 다른 OS의 검증으로 확대하지 않는다. 같은 시간 다른 작업의 별도 커밋`f35c7f98`을 확인했고 이번68개 staged 변경은 그대로 분리되어 있다.

최종 자체 정리 재등록·검토 producer는04:56 UTC exit0 완료했다. 작업 묶음의 원자적 재등록412.166초, 나머지3개 작은 run 등록 각0.085/0.736/2.873초, 전체 정밀 검토119.414초다. 4묶음/7경로의 논리 크기958,629,858bytes, blockers0이다. 종료한 자체 작업의 `artifacts/tasks/BI-01-project-maintenance`, `artifacts/logs/BI-01-project-maintenance`, `artifacts/verification/BI-01-engine-v1`, `BI-01-engine-v2`와 세 lifecycle-check run(`b5b12bf7…`, `a2cf8168…`, `9729f548…`)만 대상으로 확정했다. root는 보존한 명령·입력 지문·실제 결과·한계가 충분하고 producer/소비가 종료했음을 확인해7항목 모두 delete를 선택했다. 약0.96GB는 논리 크기이며 실제 디스크 회수량 주장이 아니다.

첫 대량 apply는約773.610초 뒤 실패를 반환했다(수집 exec exit1, control의 explicit incomplete exit2). 작은 source run `b5b12bf7…` 한 개는 실제 삭제되어 producer record를 조정했다. v1 snapshot과 두 Windows run은 Assert-Tree의 Get-Item 단계에서 긴 경로를 없다고 보고해 attributes0/remainingtrue였고, 작업 묶음의 나머지3항목은 미시도로 차단되어 로그·근거를 보존했다. 실제 존재하는261자 snapshot을 동일 Windows PowerShell5에서 읽기 전용으로 재현했다: 일반 literal은 실패, `\\?\` 확장 literal은 성공했다. 다른 shell/API로 수동 삭제하지 않고 기존 PowerShell cmdlet의 경로 처리와 >300자 회귀 검사를 수정한다. `long-path-validation`은 작업 record를 pending/incomplete로 돌린 뒤 별도 고정 입력으로 검증한다. 대량 속성 audit의 불필요한 unchanged 기록·배열 복사도 같은 함수에서 줄인다.

첫 긴 경로 수정의 고정 입력은 `3a9e88459214818353512d9008939f2aa716b9b3e10b2953d494ea2011e0f1bf`, package `cdeab50c58d0c7eea03515282a82cdd1e5efd61229766dbbfef089f858a0a3e8`다. package clean05:15:57~05:20:11 UTC exit0 뒤 library가05:20:38 exit101로 종료했다(31contracts 중23pass/8fail). 실제 긴 파일 삭제·속성35→32와 원래 경로 audit는 동작했지만 삭제 후 Get-Item이 값 없이 반환하는 경우를 true로 판정해 statusfailed를 만들었다. native core 컴파일은 시작하지 않았다. 작은 동일 PowerShell script 진단에서 부재/존재 판정을 먼저 검증하도록 순서를 바꾸고 `long-path-final`에 새 고정 입력을 준비한다. 기존 실패 snapshot은 변경하지 않는다.

작은 진단은 동일 `powershell.exe`에서 없는 확장 경로의 Get-Item이 throw=false/null/errorcount0임을 재현했다. 실제 반환 객체로 존재 여부를 판정하도록 고친 뒤 현 source의 SCRIPT를 그대로 추출하여140자(3entries)와363자(11entries) 경로를 각각 검사했다. 둘 다 PS 및 harness exit0, 실제 부재, 속성35→32 한 건, 원래 audit 경로, unchanged 항목 제외를 확인했다. 조회 오류의 unknown 처리와 기존 보호 검사는 유지했다. Windows UNC literal 정규화는 구현했지만 실제 UNC share 검증은 없다. 전체 재검증 전 C: 여유는16.89GiB였고 jobs2/incremental0·기존 공유 cache를 유지한다.

`long-path-final` 고정 입력`72daffb47eb3258fe3d5eaf2f5be20ec0da8ebb38521bd154a7a03ab0a484820`/package`4d13fb772287378bc3bff8d68d8e5219810eed3578d74ba67839c40c22791f85`의 library는05:27:50~05:28:17 UTC에 기존30계약 통과/새test1실패(exit101)였다. 새test도 실제 삭제·remainingfalse·속성 audit는 통과했고, fixture의 `generated/long-tree` 혼합 구분자와 실제 승인 경로의 Windows 구분자 byte 비교만 달랐다. fixture를 두 `join`으로 고쳤고 단언·제품 코드는 유지했다.

다시 전체 engine을 복사·package clean하지 않고, 제품 코드가 동일한 위 고정 입력을 native-final에서 재사용한다. 전체 frozen identity와 현재 crate의 tests 제외 모든 파일, native 소유10파일 byte 일치를 실행 전후 확인한다. 수정된 테스트 전체는 crate10파일의 별도 `library-final` 고정 입력과 전용 작은 target에서 검증한다. fixture manifest에만 원래 workspace package/dependency 상속을 구성하고 원lock 기반 offline lock을 준비한다. native 전체 의존성의 중복 cache를 만들지 않는다. 두 결과가 모두 있어야 자체 정리를 재개한다.

`library-final`은05:30:22~05:31:51 UTC 실제 exit0: contracts31+groups13=44pass/0fail이다. `cargo generate-lockfile --offline`도 exit0, 검사는 `cargo test --locked --offline --target x86_64-pc-windows-msvc -- --test-threads=1`로 수행했다. 원source10파일과 source/tests/examples byte 일치, 원본·고정 입력 불변, 승인한 standalone workspace append만 manifest 차이임을 확인했다. 이 fixture의 파일 바이트 recipe source SHA는`b4fca34510ba8d5a3642f13d686e2ff5eb32f2446966c1b8fe5c14c40e0c185a`, frozen11파일 SHA는`628a727f61061390da119a00814567a6f318f263bd546abe0e9e057018d1863b`다. 이 recipe를 engine inventoryTree와 직접 비교하지 않는다.

native-final 최초20분 점검05:52:57 UTC에는 producer가 아직 종료하지 않았다. core 로그는 공유 artifact lock 대기 뒤 skills/state/exec-server 등 workspace 의존성 컴파일과 기존 unused-result 경고를 포함했고 종료 오류는 없었다. C: 여유13.17GiB를 확인했다. 다른 producer 중단·중복 native 빌드·새 대형 cache 생성 없이 같은 실행의 종료를 기다린다.

native-final 최종 실제 exit0: core05:31:09~05:53:39 UTC, 8pass/0fail(test15.15초; Cargo reported compile+wait22m11s), example05:53:39~06:01:34 UTC이다. 대기와 compile의 세부 시각을 분리 측정하지 않아 전체를 순수 compile 시간으로 주장하지 않는다. 06:01:48에 전체 입력 불변·현재 제품 파일 일치와 native owner10파일 byte 일치를 재확인했다. tests 제외 package production recipe SHA는`6f70b8f5279ea11e781eca4183b3202b08f7deb1afa0a1d8c5b803cfc65a7ea8`다. 수정된 tests 전체44개는 별도 byte 동일 standalone 결과로 확인했으며, 제품 입력에 남은 이전 fixture 표현을 최종 테스트 통과로 오인하지 않는다. 세 남은 producer record의 종료/완결성을 다시 확정한 뒤6경로를 fresh register/review한다.

재등록·검토의15분 점검06:18:57 UTC에는 첫 등록이 미종료였다. 정확한 자체 request를 처리하는 native PID31460의 존재와 read-transfer1,423,313,437bytes를 확인했다. 이 값은 OS 누적 I/O이며 고유 내용 크기나 진행률이 아니다. 현재 보수적인 ancestor/내용 재검증은 대형 묶음에서 상당한 시간이 걸리며, 최종 속도 개선률을 주장하지 않는다. 시간 경과만으로 검증을 생략하거나 다른 삭제 API로 전환하지 않는다.

이번 작업의 로그·snapshot·fixture는 `work:BI-01-project-maintenance`에 등록했고, 검증 진입점도 별도 run 소유를 실행 전에 등록한다. 최종 수용 후 필요한 identity·명령·실제 결과·한계는 이 작업 기록에 독립적으로 남기고 목적을 마친 고정 입력·원시 로그·일회성 실행 스크립트를 모델 판단으로 함께 삭제한다. producer record는 실제 부재/참조 해제를 확인해 조정한다. 공유 Cargo cache와 다른 작업 파일은 기존 owner/참조 보호 아래 남긴다.

완료는 필수 검사, source/설치 지침 일치, 자체 생성물 정리, 사용자 변경과 분리한 로컬 커밋까지 마친 뒤 보고한다. 공동 dirty 파일은 작업 전 baseline과 현재/HEAD를 대조하여 이번 변경만 stage한다. 자동 metadata 조사나 문서 bootstrap을 기존 파일의 일괄 이동·삭제 권한으로 해석하지 않는다.

06:02:52 UTC의 재등록·검토는 약29분 뒤 exit0으로 종료했다(큰 묶음 등록1,050.854초, 작은 둘1.866/4.935초, 검토688.759초). 여섯 경로의 논리 크기는1,548,541,643bytes였다. 다른 작업이 registry에 유효한 record를 추가한 탓에 큰 묶음의 전체-directory source hash만 달라져 보호되었다. 적용하지 않고 작업 record를 pending/incomplete로 되돌렸다. Node producer registry에는 명시적인 `producer_registry_v1` 의미를 부여한다. Rust가 전체 registry의 유효성을 확인하되 해당 owner 및 실제 inbound consumer만 identity·보호 근거로 삼아 무관한 작업 변경에 토큰이 무효화되지 않게 한다. 기본 opaque source 계약은 유지한다.

Node adapter/guidance 전체23검사06:38:56~06:39:08 UTC exit0, 입력5파일 불변이다. 새 Rust 검사 첫 시도는 기존44통과/신규5실패(exit101): 선택한 프로젝트 밖 상위 TEMP의 `.azrael-ex`까지 보호 경로로 검사했다. Node와 동일하게 프로젝트 상대 경로를 검사하도록 수정하고 내부 실제 보호 경로 회귀1개를 추가하여 새 고정 입력에서50검사를 실행한다. 이전 실패 입력은 변경하지 않는다.

native 통합은 이전 불변 engine 입력과 새로운 standalone crate의 Cargo `--config paths=[...]`를 사용해 재검증한다. 별도 std-only probe에서 기존 dependency1, override2 출력과 각각 exit0을 확인했다. 기존 native 입력의 다른 소유 파일·공유 target을 재사용하며 전체 engine 재복사·중복 dependency cache·전체 앱 빌드를 피한다. library 검증과 dispatch example가 준비되면 core 통합을 즉시 시작하고, 그동안 실제 adapter→Rust registry의 작은 시나리오를 검증한다.

semantic-library-final-v2 실제50검사(contract31/group13/registry6)는06:42:23~06:42:59 UTC exit0, 동일 입력 dispatch example도 exit0이다. source recipe SHA`9ccdf05f0adb1e00ff2657a4f5eb71bca5b67db1f7551f4139109786ab2b39cf`, standalone SHA`c942236b71a86d6b0506d4fe9b2f8016909640a40f5eccf6428ac11692e6d62c`, binary SHA`06b313eca88cfc8dab9a202a52877e463ccb3be9b2ca2236230ec9a9bc012123`다. 원본·고정 입력 불변 및 허용한 manifest recipe 이외 source/tests/examples byte 일치를 확인했다.

semantic adapter→Rust 실검증은06:44:50~06:44:54 UTC exit0(10호출)이다. 유효한 무관 record 추가/갱신 뒤 토큰 동일, projection→register 사이 새 inbound consumer 직접 보호, 모델 보류 뒤 파일 유지, consumer 실제 종료·부재·finalize 뒤 재등록, 무관한 revision 변경 뒤 기존 토큰으로 payload/log/report3개 실제 삭제 및 record finalize를 확인했다. 첫 fixture 호출은 필수 revisit_condition 누락을 정확히 거부했으며 새 fixture에 조건을 포함하여 통과했다. 원시 실패 fixture도 상위 작업 묶음과 함께 최종 삭제한다.

정리 실행파일 자체를 자기 묶음 삭제 중 사용하지 않도록 검증한 binary를 보호 control 경로 `artifacts/maintenance/BI-01-dispatch.exe`에 동일 SHA로 복사했다. 이것은 배포·설치본이 아니며 producer 종료 후 해당 단일 파일도 일반 삭제한다. core 통합은06:43 UTC 시작, 기존 engine 전체 identity와 native owner10파일, 새 crate source/recipe를 실행 전후 확인한다.

커밋 분리 점검에서 동시 작업의 기존 문서 전체 영문 번역이 일부 재stage에 포함된 것을 발견했다. working·활성 설치본은 유지하고, docs/playbooks/work.md·build.md는 HEAD 원문에 이 작업의 새 절만 삽입한 index blob으로 복원했다. feature manifest도 기존 기능들의 원문·의미를 유지하고 새 tool.project-maintenance 항목(44owner/6check)만 추가했다. 공유 instruction4파일과 receipt도 유지 담당자가 동일 방식으로 분리한다. 이 작업은 새 번역을 수행하거나 다른 작업 변경을 커밋하지 않는다.

최종 native 통합은06:44:00~06:55:54 UTC 실제 exit0, core8pass/0fail(test13.99초, Cargo compile+wait11m38s)이다. Cargo 로그가 새 standalone crate 경로를 실제 compile한 것을 확인했고06:56:05에 기존 전체 engine identity·새 source/manifest recipe·native owner10파일 불변을 재확인했다. 별도 engine 복사·전체 앱 빌드·설치는 없었다.

공유 지침 index 분리는 담당자 reconstruct/validate 각각 실제 exit0이다. 원래 한국어 HEAD에 implementation SKILL +16/-3, build-inputs +29/-0, app-logging +1/-0 및 lifecycle 참조를 적용했고 staged receipt24항목 hash/size·기존15항목 불변·링크·테스트 추가 기준을 확인했다. working/활성14경로 hash는 불변이다. 현재 working receipt는 동시 영문 설치본을, staged receipt는 분리된 유지 원문을 나타낸다. root feature inventory/current+staged 검사와 CR-at-EOL staged whitespace 검사도 exit0이다. 이제 모든 자체 producer와 소비를 종료하고, 원시 로그의 필요한 근거를 이 기록에 보존한 상태에서 세 묶음·여섯 경로를 재등록/검토한다.

사용자 후속 지시: 대기 중 현 프로젝트의 생성 파일을 승인된 작업/실행·버전·공유 구조에 맞춰 정리하고, 불필요한 구버전 관련 파일의 삭제 후보를 목록화한다. 현재 fresh review 대상 여섯 경로는 불변으로 두고 별도 `work:BI-01-layout-migration`에 새 조사/이전 생성물을 등록했다. 기존 전수 metadata 조사와 설치/복구/producer 근거를 재사용한다. 알려진 비활성 소속만 충돌·참조를 확인해 시험 이전 및 검증하고, 불명·활성·현재/직전 복구본은 보류한다. 후보 목록 작성은 구버전의 추가 삭제 권한으로 해석하지 않는다.

물리 이전 pilot: 완료 기록과 파일 수/크기가 일치하는 BL-01 2로그 및 AO-01 7자료, 총9files/16,804logicalbytes를4개의 task/run/{logs,reports,outputs} 경로로 복사했다. source/destination SHA-256 일치·경로 충돌 없음·링크 없음·기존 lifecycle 소속 없음 확인, 새4run을실행전pending등록후complete로조정했다. 구2루트는 migration-source 그룹 pending/incomplete로보호하고 reader링크를새자료로전환했다. AO writer를 새 unique run 경로로바꾸고기존UI검사범위를보존해검증한뒤구루트삭제를선택한다.

새 semantic source로6경로 fresh검토 실제exit0: 큰작업등록930.574초, 두run등록1.951/3.980초, 전체review337.611초. 논리합계1,583,786,747bytes,6항목모두blockers없음이다. 대기중 별도구조이전의유효한registry항목이추가됐지만무관한owner변경은차단하지않았다. 삭제전필요한검사결과/identity는이work기록에보존했고,추가audit·mapping담당자모두원본scan재참조해제ready를확인했다. 세자체묶음의원시snapshot/log/fixture사용목적이끝났으므로모델이6항목전체delete를선택한다. 판단과실제삭제결과는분리해기록한다. control dispatch는이어지는이전검증에서도사용하므로그소비가끝난뒤단일파일을일반삭제한다.

추가조사완결:9구버전그룹19,611,795,513논리bytes/42연계경로(40관측)는즉시삭제0,모두needs_discovery다. hostInstalled receipt와부재release의불일치,profile/rollback/input/acceptance참조를먼저확인한다. 구조화현재후보snapshot은보호control `artifacts/maintenance/BI-01-cleanup-candidates.json` 한파일로두고소유·미결목적·후속조정후축약조건을기록했다. 영구검토문서는02-cleanup-candidates.md,9파일의원본→새경로/SHA와writer검증은03-layout-migration.md에보존했다.

AO futurewriter구문·부작용없는경로계약10건·충돌회귀는exit0,실제WindowsChromium1회도exit0/브라우저exit0/fixture프로세스0이다. 최종충돌·독점쓰기guard보강후동일UI검사를관성반복하지않고그위험만focused검증했다. 새AO일회성run과이번mapping/audit원시입력은필요근거승격후모델native검토·삭제예정,이전한BL/AO4run은실제기록소유로남긴다.

자체6경로apply의예정점검07:43:37UTC에는producer미종료였다. 동일native PID58156(CPU580.53초,07:27:18시작)이실행중임을확인했다. 이값은삭제진행률이나회수공간이아니다. 같은manifest의후속native검토를겹쳐실행하지않고현재producer의실제종료를기다린다.

추가권한:사용자가후보중현재삭제가능한것은삭제하도록승인했다.9needs_discovery의receipt가명시한일반VSCode확장등록/profile·현재/직전복구·프로세스·입력/수용근거를추가확인하여삭제가능subset을고른다. 명시된외부프로필은참조확인만허용하고삭제는프로젝트생성물에한정한다. 이름/오래된시각/과거hostInstalled만으로삭제하지않는다. 현재자체6경로nativeapply의동일manifest잠금을존중해실행을직렬화한다.

08:10UTC추가감사후9후보모두deletion_ready권고를수용했다. 현재.7/OpenAI실디렉터리및직전.6·w13basset·currentw14y실제passed수용을확인,과거.5profiledirs/release/latest/processrefs없음과shortcut중복·registry등록만백업을확인했다. 과거버전고유package라는사실을현재유일복구본과혼동하지않는다. deployment10parent의전체구성을확인하여package형제누락없이9version lifecycle을등록했다. codexstate516,700bytes추가,전범위관측합19,612,312,213논리bytes. 공유source/UI/현재·직전복구·외부원본은보호하며nativefresh검토전후actual결과를별도기록한다.

대용량 묶음 성능 분석:root6경로apply08:07점검에도미종료였고1st190MBsnapshot실제부재를확인했다(nativePID58156누적CPU1342초/read5.94GB,성공·진행률로과장하지않음). oldbinary의독립1000×32byte파일+log그룹baseline은register5.640초/review2.471초/apply54.925초,모두exit0/실제부재이다. 저용량에서도비용이커byte해시량만의문제가아니다. 단일leaf metadata의즉시중복과동일PSancestor속성조회의객체생성·중복전수pass를좁게개선한다. 같은powershell.exe/Remove-Item·권한·token·intent전후fresh·실제재귀범위·ROHidden/System/reparse보호는유지한다. GetAttributes속성읽기는먼저정상/긴경로/링크/보호속성/부재동등성을실험하며삭제API나실패우회로바꾸지않는다. 진행중binary와고정입력은변경하지않고새 immutable 소규모 crate/target에서전체회귀와같은shape benchmark를수행한다. cachedancestor/metadata를callback·intent경계넘어재사용하거나안전검증을생략하지않는다.

성능 변경 최종 Windows 검증: 08:17:35~08:18:25UTC 전체51test(기존50+approved descendant누락 시 속성 변경 전 실패1), example build08:18:25.607~25.904UTC 모두exit0. Source SHA a3d81013afaf35f8cdc29d9dd3ad198bdf865af0aff195f15f6884fc8442d327, standalone SHA f663d889eeab873350d986fb3cc556dfb7b9515c04010ca837a0abc7983293f4, recipe SHA16c97d668db3d6a77b580a19401a38fca3171e8cf04530588fc57ee215840040, binary SHA7cb5cdc55dc3e6e02fb55c274edaf1da1c9bc11e0816b6f3f49680955bc05c4d. 같은1000파일 shape에서 register5.640→2.820초, review2.471→1.950초, apply54.925→20.925초; 모두exit0/실제부재. 순차1쌍이라cache/경합미통제, 실대용량전체효과는미확인이다. 일반/ROHidden/System/360자long/junction의동일powershell.exe 속성관측값일치, absent throw확인. 초기실패probe2곳은각3작은파일이남아있고설정전실패여서속성변경없음이며전체cohort삭제로회수한다. 최종probe전부부재이다. 새 API/공유계약 변경없이private중복관측만제거하여native8/Node23의기존통합결과를재사용한다. 진행중구binary와입력은유지했고새binary를보호control로복사후SHA일치확인했다. 모든perf producer 종료/consumer해제보고를받았고필요근거승격후cohort를검토/삭제한다. 상세원시로그는performance-review/runs/optimized-validation/logs 및comparison.json에서이기록으로승격했으며원시입력/target은사용목적종료대상이다.

08:31:22UTC 예정점검: work_completion은미종료. 기존nativePID58156 및실제PowerShell삭제child27788을관측했다. 첫snapshot부재,나머지5경로존재; CPU1751초/Read7.54GB관측은진행률이나회수공간이아니다. 첫대용량작업cohort의일반삭제단계가진행중이므로후속projectmanifest사용작업을직렬유지한다. 다음점검은약20분후또는실제종료신호다.

08:43UTC 수동 재개 시 work_completion 미종료. 대용량 등록/재해시가 debug 실행이라는 점을 확인해 source/API 변경 없이 같은 immutable crate를 release 구성에서도51test+example 검증하고, 작은 파일 기존 비교와64MiB 단일 payload의 debug/release 실측을 추가한다. 공유 manifest/apply에는 접근하지 않고 기존 performance-review 전용 target을 사용하며 전체 engine/app 빌드는 하지 않는다. 추측과 측정 결과를 구분하고19.6GB 후속 실행 전에 검증된 binary를 선택한다.

Release 검증 실측: Windows51tests 전부pass/0fail, test126.755초(첫 dependency compile79초 포함), example build0.337초/08:46:41UTC, 모두exit0. 같은sourceSHAa3d81013afaf35f8cdc29d9dd3ad198bdf865af0aff195f15f6884fc8442d327/standalonef663d889eeab873350d986fb3cc556dfb7b9515c04010ca837a0abc7983293f4 불변. releasebinarySHAaf91e1272ec03e1a9e8bad635b6d234153b7a9f53cc845405713cde1651a7c1e를 보호control에 복사하고 다시 확인했다. 같은 시간대64MiB+log의 debug→release는 register8.673→0.408초, review6.071→0.377초, apply19.467→2.134초. 생성payload/log 실제부재 확인, 모두exit0. small release는6.708/4.052/61.712초로 이전debug보다 느려 cache·경합을 통제하지 않은 비교를 일반화하지 않는다. 운영19.6GB 전체 성능은 미검증이다. 원시근거 release-validation/release-baseline/final-evidence.json과 관리receipt/target 및 이전probe잔여물은cohort로 회수한다. 모든producer종료/consumer해제를 확인했다.

기존 자체6경로 정리 실제완료(09:09:53UTC 결과수집): native apply exit0, 6,146.938초/102분26.938초, aborted=false, 6항목전부deleted/remaining=false. 허용된생성물 ROHidden 변경161+48건만관측, force/System/ACL변경없음. Node3개cohort finalize모두성공/remaining[]/refs[]/blockers[]. logical1,583,786,747bytes는검토시payload합계이며physical회수량이아니다. longdebug실행은그대로완료했고새release로9구버전40연계경로fresh검토를시작했다.

### 외부 테스트 프로필 정리 — 승인, 반영·검증 진행

사용자 요청: 외부 프로필로 테스트하면 작업 종료 후 관련 외부 프로필 파일을 전부 정리하도록 지침을 추가하는 계획을 제시한다. 기존 docs/playbooks/build.md의 검증용 확장·프로필·fixture 정리 규칙을 모든 테스트의 생성/소유/종료 검증과 연결한다.

- 기본 경로는 artifacts/tasks/<work>/runs/<run>/temporary/profiles/<app>. 앱 프로필 경로 옵션을 사용해 작업 전용으로 격리한다.
- 프로필과 확장 복사본·캐시·로그·백업의 실제 경로, work/run 소유, 생성 전 존재 여부, 활성 프로세스, 종료시 삭제 범위를 생성 전에 기록하고 같은 묶음으로 관리한다.
- 재실행·진단·인계 종료 후 모델이 프로세스 종료→묶음 삭제→실제 부재 확인을 수행한다. 미해결 실패로 보류하면 이유/해제 조건/미정리 상태를 기록하고 완료라고 보고하지 않는다. 일회성 테스트의 delete/defer 판단 및 상주 기능 없음은 유지한다.
- 기존 사용자 프로필이 필요한 검증은 테스트 추가분 삭제와 변경분 복원을 추적한다. 전체 삭제는 작업 전용 생성 프로필에 한정한다. 실제 설치본/직전 복구본은 사용·복구 소유로 유지한다.
- 공통 implementation 생성물 관리 reference를 규칙 소유자로 두고 프로젝트 lifecycle/build playbook과 bootstrap 기본 템플릿에 연결한다. 테스트 스크립트 추가 기준과 테스트/빌드 분리는 유지한다.
- 현재 native 엔진은 프로젝트 밖 삭제를 거부한다. 가능한 프로필은 프로젝트 내부 run에 두며, 실제 외부 경로가 필요한 경우는 생성 전 소유권/한정 범위 등록과 정리 연동 설계를 추가 검토한다. 성공/실패/취소/재실행 보류/프로세스 잔존/삭제 실패/실제 부재를 검증한다. 임의 외부 경로의 삭제 허용으로 확대하지 않는다.

사용자는 권장안대로 지침을 수정하고 확인된 외부 프로필 파일 중 보존 조건이 없는 생성물을 삭제하도록 승인했다. 현재 등록된 .7, 직전 복구 .6과 공유 제어·사용자 파일은 보호한다. .4/.5는 배포 manifest와 활성·복구·소비 참조를 확인한 뒤 일반 삭제를 판단한다. 프로젝트 밖 삭제를 거절하는 native 계약을 바꾸지 않고 기존 외부 설치 owner의 정리 절차를 적용한다.

후속 세션은 `azrael://threads/01a13abe-1c9a-77c0-9663-5bb413752cb6`의 사용자 결정·검증·분리된 index를 재사용한다. 중단된 지침 담당의 새 문안은 working/활성 파일에 존재하나 최종 receipt·검증 보고가 없으므로 그 차이만 확인한다. 기존 외부 metadata 조사에서 .4는 20,670파일/1,078,953,662논리 bytes, .5는 20,671파일/1,079,106,172논리 bytes, .6은 20,873파일/1,291,236,081논리 bytes, .7은 20,882파일/1,292,038,831논리 bytes였다(각 errors=0/reparse=0). 테스트 이름의 대부분은 vendored node-pty 등 의존성 내부 파일로, 별도 일회성 테스트 누적이라고 단정하지 않는다. 같은 전수 tree 조사는 반복하지 않고 현재 등록·실행·보존 참조와 선택한 삭제 경계만 재확인한다.

외부 프로필 후속 완료: 공통 implementation routing/reference와 bootstrap lifecycle playbook의 승인 문안을 유지 원본·활성 3사본에 동기화하고, working/staged receipt 24항목 모두 hash/size 일치를 확인했다. 기존 번역 등 타 작업 변경은 별도 working 상태로 보존했다. `python -B scripts/import-instructions.py --check` exit0(24files/10components/58links), 기존 instruction fixtures34pass/0fail exit0. 현재 프로젝트 lifecycle playbook과 운영 문서에도 같은 종료 절차를 반영했다. 실제 모델 준수·새 앱 배포 수용을 이 문서 검사로 대체하지 않는다.

외부 설치 owner 검사와 실제 삭제: 현재 .7 등록 및 receipt의 직전 .6, 각 runtime 참조, Desktop/Start Menu shortcut과 현재 process를 확인했다. .4/.5의 extension manifest·Azrael marker·installer receipt/provenance가 일치하고 읽기 오류·링크·보호 속성 및 활성 참조가 없었다. `external-profile-cleanup.ps1 -Apply` 실제 exit0, 2026-10-15T09:56:54.3875393Z~2026-10-15T09:57:27.1624674Z; 외부 확장 두 폴더와 대응 `%LOCALAPPDATA%/azrael-ex/releases/2026.0.4`, `2026.0.5` 네 경로 전부 deleted/remaining=false. 합계4,959,791,279논리 bytes이며 물리 회수량을 뜻하지 않는다. 현재 .7/복구 .6, 공유 extensions.json/.obsolete와 로그인·대화·설정은 보존했다. 외부 작업 전용 프로필 전체의 존재를 조사·삭제했다고 확대하지 않는다. 임시 cleanup script/report/log와 지침 baseline은 `work:BI-01-profile-guidance` 소유로, 필요한 결과를 이 기록에 승격한 뒤 전체 정리한다.

후속 입력 동일성: release 검증에 사용한 source_identity의 12파일을 현재 소스와 다시 대조하여 모두 SHA-256 일치(`a3d81013afaf35f8cdc29d9dd3ad198bdf865af0aff195f15f6884fc8442d327`)를 확인했다. 따라서 기존 Windows Rust51/debug·release 및 변하지 않은 native/Node/PS 검증을 재사용하며 중복 대형 컴파일은 실행하지 않는다. 유지 지침·활성 사본 전체24파일도 바이트 일치다. staged 구현과 working 구현은 feature inventory의 타 작업 차이 외에는 일치하고 staged whitespace 검사 exit0이다.

후속 대기 경계: 외부 정리·지침 반영·입력/활성24파일 및 분리 index 검증은 완료했다. 09:10:07 UTC에 시작된 기존 구버전9묶음 review producer의 실제 종료와 `BI-01-version-review.json`이 다음 삭제 결정을 막고 있다. mutating register/apply끼리는 같은 manifest의 배타 잠금을 존중한다. 읽기 전용 review는 독립된 비중첩 소유 범위와 병행할 수 있다. 기존 producer를 재시작하거나 중복 검토하지 않고 종료 이벤트로 재개하며, 30분 뒤를 첫 추가 점검 시점으로 둔다(종료 보장 시간 아님). 결과 확인 후 blockers0과 보호 참조를 검토하여 승인된 delete를 적용하고, 잔여 임시물 정리와 최종 작업 커밋을 수행한다.

10:30 UTC 재개 점검: 기존9개 register는 종료했고 전체 review native PID29340이10:09:00 UTC부터 실행 중이었다(당시 read-transfer7,433,290,909bytes는 누적 I/O이고 진행률/고유내용크기가 아님). `Store::open(mutate=false)`가 읽은 manifest snapshot만 사용하고 review는 잠금/저장을 하지 않으며 그룹 token은 해당 소유/소비 의미에 묶이는 것을 확인했다. 서로 비중첩인 잔여6묶음의 register/review를 병행하되 mutating apply끼리는 겹치지 않는다. 원래 검토를 재실행하지 않는다.

잔여6묶음 fresh 검토 exit0: native review12.527초, 6항목/402,363,889논리 bytes/blockers0. 구 BL/AO 로그는9파일의 새 경로/SHA와 reader 전환을 확인했고, 이번 AO run·layout 조사·performance/standalone target·profile 지침 baseline은 실제 종료/인계 완료와 결과 승격을 확인했다. 모델은6항목 전체 delete를 선택한다. 새4개 보존 run과 관리control의 release dispatch는 삭제 범위에 포함하지 않는다. 실제 apply/부재/finalize와 판단을 구별해 후속 결과를 기록한다.

잔여6묶음 정리 완료: native apply67.570초/exit0, aborted=false,6항목 전부deleted/remaining=false, 속성변경0. 각 producer record도 모두 finalized/remaining[]/references[]/blockers[]로 종료했다. 실제 프로세스 참조가 없음을 apply 직전 확인했고, 새 BL/AO4개 보존 run과 현재 설치/복구·공유 cache는 정리 범위 밖에 유지했다. 원시 검증 로그와 입력을 남기지 않고 필요한 결과·identity·명령/한계만 본 기록과03-layout-migration.md에 승격했다. 현재 남은 삭제 의존성은 기존 구버전9개 review와 그 결과를 이용한 apply 및 임시control 제거다.

사용자 후속 범위 확인: 기존9개 후보에 한정하지 않고 현재 프로젝트의 종료된 생성물도 정리하면서 추가 삭제 후보를 찾는다. 기존 AT 조사/크기/정리 결과와 lifecycle 목록을 재사용하여 전체 재스캔을 피한다. 패키징 rtp4곳과 대형 로그내부 복사본3곳의 독립 소유/reader 조사를 각각 읽기전용 담당에 배정했고, root는 등록된 실행·임시 scratch 후보와 실제 보호·native등록/정리 및 통합을 소유한다. 새 조사물은 work:BI-01-additional-cleanup-audit에 실행 전 등록한다. Windows x64 로컬 생성물 정리 범위이며 current/previous·source·사용자·공유활성입력은 보호한다.

현재 프로젝트 추가정리1: asset-transform test가 남긴 동적 fixture5개를 생성 코드/구조·현재실행·링크로 확인했다. 4개 root(74files/11,535,409논리bytes)를 기존 fixture owner의 ordinary PowerShell 경계에서 삭제/부재 확인했고 lifecycle record4개 finalize, exit0. V9zgLP는 생성코드와 동일한 내부 fixture junction/내용을 확인한 뒤 link자체만 비재귀일반삭제하고 대상이 보존됨을 검증하여 나머지도 기존 lifecycle adapter로 삭제/부재/finalize했다(exit0). 다섯fixture 총109files/29,790,676논리bytes 정리 완료다. native managed_roots/config는 변경하지 않아 진행 중인9개 검토 입력을 유지한다. 추가후보와 보류조건은02 문서에 반영했다.

현재 프로젝트 추가 대형5묶음: 두 readonly 담당의 소유/reader 근거를 root가 수용하고 원래40경로와의 비중첩·현재/직전설치/shortcut/process·전 하위links/속성을 확인했다. 기존 artifact-lifecycle PowerShell adapter의 preview5모두selected/exit0, 6경로 합계9,174,531,437논리bytes/125,577files. rtp의 한 실패deployment receipt도 같은묶음에 포함했다. 필요한 identity·검증 결과와 한계는02 문서에 승격했다. 모델의 삭제결정 후 같은 owner adapter로 ordinary삭제를 실행 중이며 실제 결과/부재/finalize를 후속 확인한다. nativeconfig/managed_roots는 변경하지 않는다. 남은 stable UI root-review와 c160 TLS진단 혼합자료는 각각 retained/incomplete membership으로 등록하여 무분별한 부모삭제를 차단했다.

사용 종료된 protected-control 임시물도 별도로 정리했다: BI-01-dispatch.exe/BI-01-dispatch-perf.exe 및 완료된 최초 apply/layout controller와 그 raw console log를 실제 process참조가 없음을 확인한 뒤 단일파일 일반삭제했다. 원래9개 review가 사용하는 release binary/controller/request와 현재후보snapshot 및 최종커밋 allowlist만 필요한동안 유지한다. 관리manifest/다른작업 lifecycle/잠금은 삭제하지 않는다.

추가5묶음 실제삭제 완료: 2026-10-15T10:49:31.3478889Z~2026-10-15T10:51:23.6524641Z, adapter 실행 exit0,5groups모두deleted/6paths실제부재/producer5records finalized, errors없음. 새측정9,174,531,437논리bytes/125,577files이며 실제디스크회수량이 아니다. rt6원본·pristine UI·current/previous·인증/대화/설정은 보존했다. 실패deployment record와 namespace/validation raw근거도 출력본과 함께 삭제해 고립 로그를 남기지 않았다. 다섯 cache fixture29,790,676bytes를 포함한 이번 프로젝트 추가정리는9,204,322,113논리bytes다. 판정·실제결과·실행범위를 구분하며 source UI integration/TLS 혼합자료2곳은 retained/incomplete로 남긴다.

추가 감사 자체 생성물 종료: 2026-10-15T10:54 UTC, native fresh review 1항목/85,940논리bytes/blockers없음 뒤 모델 delete를 선택했다. native apply 실제exit0/aborted=false/deleted/remaining=false와 경로 부재를 확인했고 work:BI-01-additional-cleanup-audit를 finalized로 조정했다. 생산자는 모두 종료했고 핵심 근거는 이 기록과02에 보존했다. 임시 감사 스크립트·원시 로그·보고서는 함께 제거했다.

기존9그룹의 10:56 UTC 의존성 점검: 원래 Node PID30824와 읽기 전용 native PID29340이 살아 있고 최종 review/signal은 아직 없다. native CPU누적484.09초는 진행률이나 완료 보장이 아니다. 중복 실행·입력 변경 없이 기존 producer를 유지한다. 다음 확인은 종료 이벤트 또는 11:26 UTC로 정하며, 이 결과만 남은9그룹 delete 판단을 막는다. 현재 프로젝트 추가 삭제나 지침 검증에는 더 이상 대기할 선행 조건이 없다.

기존 세션의 독립 미완결 보완: 사용자 지시에 따라 검토 대기 중 미래 writer의 구조 이전을 계속한다. 공통 test-project runner와 관리 adapter가 아직 기본 결과를 logs/project-*에 생성하는 gap을 확인했다. 기존 라이브러리/prepare/test/build 분리·test selector·fail-fast/collect·결과checkpoint/실제exit·명시 출력override·list 무부작용 계약을 보존하고 기본 결과만 작업/run 등록·logs/reports 배치로 이전한다. 등록 실패 시 실행을 시작하지 않고, 실패·중단은 보호 상태를 남긴다. 성공해도 자동 삭제하지 않는다. 원래9그룹의 config/library/binary는 고정하며 새검증 자료는 work:BI-01-runner-migration에 실행 전 등록했다. 분리된 단계는 runner 조사/변경, adapter·문서·preservation 통합, 기존 선택/실패·adapter focused검사, 모델의 자체 생성물 정리다.

공통 테스트 writer 보완 완료: 기본 work-id=project-tests 및 안전한 --work-id, timestamp+UUID, producer/경로 충돌 검사와 pending 등록 후 독점 run 생성, logs/stdout·stderr 및 reports/results.json 분리를 구현했다. adapter가 소유ID·실제경로를 전달한다. 명시 logDirectory/directory의 legacy 배치, selector·prepare분리·실패/중단·checkpoint는 유지했다. 정상 성공만 complete/true, 실패·예외 failed/incomplete, abrupt termination pending을 남기고 자동 삭제하지 않는다. producer record에서 native등록은 기존 registerRequest 절차로 분리했다. 공통 JS 의미 대상은 지원 플랫폼 공통이며 실제 수용은 Windows x64/Node에 한정한다.

이번 통합 검사: node --test --test-concurrency=2 [test-project-maintenance, test-common-agent-instructions, test-artifact-lifecycle, test-project-fail-fast, test-project-selection].cjs, 2026-10-15T11:05:52.846Z~2026-10-15T11:06:53.931Z, 실제exit1/69pass·1fail/0skip, 실행 중8입력불변. 유일한 실패는 기존 runner dependency-closure 예상 목록에 새 관리 adapter 소비자가 없던 것이다. selector 코드는 바꾸지 않고 예상에 실제 consumer를 추가했다. 해당 이름의 focused 재검사 2026-10-15T11:07:59.521Z~2026-10-15T11:08:07.242Z, exit0/1pass·0fail. 변화 없는69결과는 재사용하며 모든70범위의 실패를 해소했다. 최종8입력 canonical path→SHA JSON 지문 25f409626afca369ce8e74d13d71223449c8fdaefefd6dd27a3c3ebaad35a225; source3파일과 adapter/test의 구문 검사도 각각exit0. working·분리 staged feature manifest 모두 validator exit0(63features), maintenance48owners 및 동일 항목을 확인했다.

실제 child 명령2회: 새 기본 경로와 adapter에서 Node stdout=managed-output/stderr=managed-error를 파일로 확인했다. 실제exit0→complete/true, 의도한exit7→failed/incomplete 및 각 reports/results.json을 확인했고 harness exit0다. 전체 앱/설치 수용이나 다른 OS 실기기 검증은 하지 않았다. raw suite/실패/재검사·실제 child 결과 및 staging baseline은 work:BI-01-runner-migration으로 모았고, 필요한 결과를 본 기록에 승격했으므로 종료와 부재를 확인하며 정리한다. 두 legacy log hold는 추가 제한 조사에서도 명시 root-review/TLS 종료·대체본 연결 근거를 찾지 못해 기존 보류 조건을 유지한다.

runner 보완 자체정리 완료: fresh native review 1항목/30,854논리bytes/blockers없음, 모델 delete 후 apply actualexit0/aborted=false/deleted/remaining=false를 확인했다. apply와 finalized 수집6.531초, producer record도 finalized다. 실패·의도한exit7·중단 synthetic fixture의 진단은 모두 종료했고 원시 suite/재검사와 실제 child 출력·baseline은 같은 묶음으로 제거했다. 이 소스 보완으로 원래9그룹의 config/library/releasebinary 입력을 바꾸지 않았다.

추가 구조화 보존: 로컬 운영 문서와 manifest가 일치하는 공개 Windows.5/Mac.5/Linux.5/.6 네 자산 폴더는 native 삭제대상이 아니라 retained/incomplete version record로 등록했다. 전체auxiliary 소속/공개본 대체와 복구 종료를 확인하기 전 보호한다. 설치.7/복구.6 또는 구성의 다음버전.8 숫자만으로 공개 플랫폼 보관본을 구버전 폐기 대상으로 혼동하지 않는다. 정확한 경로/한계/재검토 조건은02가 소유한다.

추가 네 로그 감사와 후속 writer: 두 제한 read-only 결과에서 session-completion-20261005의 -ChangedOnly 고정 출력이 현재 script에 남아 있음을 확인했다. test-deploy-azrael.ps1 기본·ChangedOnly의 Case/실제 child/단언을 보존하며 ArtifactProjectRoot/artifacts/tasks/deploy-checks/runs/GUIDN/{temporary,logs,reports} 및 producer 전후 상태·실제결과 경로를 추가했다. 생성전 충돌 검사·일반 독점mkdir, 성공complete/true·예외failed/false·중단pending 보호를 사용하고 자동삭제하지 않는다. Windows PowerShell 범위의 writer이며 Parser exit0, 기존3mock+ChangedOnly1+invalidCase 예외상태 검증을 work:BI-01-deploy-writer에 등록해 실행 중이다. 11:26 UTC에는 원래9그룹 review 종료/실제 상태도 확인한다.

배포 mock writer 실검증 완료: 2026-10-15T11:21:36.451Z~2026-10-15T11:22:31.370Z, source SHA dc09180baf91c411ba4a26c5b0665a6706fd2fa241ee309393f26c2ca5a6076f 및 입력불변 확인. verify only/account-success/build-fail와 ChangedOnly full regression verify only 네 harness는 실제exit0/producer complete·membershiptrue, invalid Case는 예상 실제exit1/producer failed·membershipfalse 및 reports/failure.json을 확인했다. 모든 요약이 reports에 있고 logs/results.json 및 구 session-completion 고정 root는 생성하지 않았다. 실제 앱 빌드/배포/설치가 아니라 기존 stub 회귀다. 로그0~4와 결과는 work:BI-01-deploy-writer에 모았고 필요한 근거를 본 기록에 승격했다.

기존9버전 review 종료 확인: original work_completion succeeded/actualexit0와 결과 파일을 확인했다. 40개 live경로가 candidate snapshot과 정확히 같고9groups/blockers없음, fresh logical합계19,612,284,780bytes다(이전 비원자적 집계와27,433bytes 차이; 실제fresh값을 사용). 11:27:10.0902629UTC preapply는 현재.7/직전복구.6,479process,40targets/blockers없음을 재확인했다. native 제어소 mutating operation이 비어 있음을 확인하고 11:27 UTC apply를 시작했다. work_completion5c9e3dd6-a1fd-499d-8bc8-abdde5b6d536, 원래 controller가 실제결과/경로부재/9producer finalize 후 signal을 원자적으로 기록한다. 실행log는 보호control BI-01-version-apply.log이며 완료 후 핵심 결과를 승격하고 제거한다. 첫 상태 확인은 종료 이벤트 또는11:58UTC(20:58KST)이며 종료시간 보장은 아니다.

독립 old mock9run fresh register64.848초/review31.072초 actualexit0,9항목/blockers없음/11,692,799논리bytes. 모델은9개 독립 synthetic run 전체delete를 선택했다. 실패·부분run2/공유진단6파일과 backups는 별도 retained 범위로 유지한다. 현재40경로 apply가 동일native store의 배타 변경을 사용하므로 이 작은apply 및 자체 deploy-writer cohort register/review/delete만 뒤에 직렬대기한다. 각각 request/승격근거/종료상태는 준비했고 다른 구현·검증은 완료했다. 작은 작업의 삭제를 native실패 우회 API로 병행하지 않는다.

사용자 후속 지시: 삭제를 과도하게 보류하지 않고 보존 조건이 없는 파일 묶음은 바로 정리한다. 과거 final exit 부재나 구형 fixture의 최신버전 대응 증명만을 추가 보류 사유로 삼지 않는다. Root는 stable UI handoff를 검토했고 source port/delegated acceptance complete, 19,347원본의 provenance 일치, 통합244변환/249반복검사 exit0와 원본 upstream-ui/26.928.31416의 현재 보존을 확인했다. 코드·문서·work reader에 fixture 직접 참조가 없어 ui-full-source-v1의 임시 root-review 보류를 해제한다. 작은 handoff/provenance/검증 로그는 부모에 유지한다. durable-active-account도 사용 reader가 없는 과거 host-test 합성 복사본과 종료 로그다. host passed=true(17commands/8config/6views/1editor/12auth literals), engine은 실패·12선택통과·마지막 dev build 완료가 혼합되어 전체 통과 근거로 재사용하지 않는다. 결과를 이 기록에 승격하고 묶음 정리를 선택한다. 현재40경로와 비중첩인 두 Node lifecycle 소유의 기존 PowerShell adapter를 사용하며, 실제 process/보호경계/link/System 확인과 ordinary 삭제·부재·finalize를 수행한다. Native 실패를 우회하거나 진행 중 store/config를 변경하지 않는다.

공개 archive 추가감사: .0–.3 Windows ZIP은 AT-01 선행 정리에서 이미 부재이고 small manifest/checksum/receipt만 남았다. read-only gh auth 및 exact tag4조회는 모두exit0이고 원격 공개 asset의 기록size/digest가 local metadata와 같았다. payload download/재검증은 하지 않았으며 이미 끝난 삭제를 반복·용량에 가산하지 않는다. 남은 소형 provenance는 기존 보존 결정을 유지한다.

기준 완화 후 실제 정리 완료: UI fixture 1,416,326,240bytes/19,382files와 durable-account477,012,653bytes/8,429files가 모두 부재이고 Node producer2개 finalized다. 첫 일반삭제는 ReadOnly로 부분 실패하여 보호재검사 후 확인된 생성물26개만 ReadOnly/Hidden 정상화했다. 같은 adapter 재개는 payload삭제/finalize까지 완료한 뒤 임시 결과collector의 singleton-array 오류로exit1이었다. 실제부재/registry부재를 확인하고 collector를 수정했다. 후속 durable삭제12:06:05.019~12:06:12.270UTC와 최종collector는exit0다. 속성별 path/before/after의 작은 receipt는 maintenance에 보존한다. 추가로 reader가 없는 artifacts/fixtures 아래 opencodex-helper-bundle-final2/helper-smoke/home-reject와 provider-release-check-probe-20260916 네 테스트프로필 잔여물도12:07:18.843~12:07:29.577UTC ordinary삭제/finalize/실제부재를 확인했다(exit0). owner metadata의 root는 같은 fixture 내부이고 auth파일 내용을 노출하지 않았다. 두 폴더는 빈 tree, 나머지4files/3,333논리bytes다. 공유 소스·현재프로필·원본 upstream UI·명확한 백업은 유지한다. Native40경로와 비중첩이며 frozenconfig/native store 변경은 없다.

12:24:43UTC 수동 재개 점검: work_completion 미종료, 원래 Node31464/native26672 생존, apply 최종log0bytes였다. 누적ReadTransfer19,521,596,210bytes는 반복 읽기를 포함하므로 진행률/고유내용크기로 해석하지 않는다. source의 grouped apply는 전체 preflight와 intent 전후 검토를 수행하므로 원래실행을 유지한다. 독립 readonly 로그담당에 legacy-build-test-optimization-{baseline,plan,validation},build-test-reduction,test-reduction 다섯 곳의 종료 fixture/cache 정확경계만 추가 조사하도록 배정했다. 입력은 기존 AT metadata·소형결과·직접reader이고 root가 실제삭제/통합을 소유한다. source/현재복구/실제진행입력은 보호하되 과거 실패 또는 최종exit 부재만을 보류사유로 삼지 않는다.

12:29UTC 독립 로그담당 결과수용: legacy-build-test-optimization-{baseline,plan,validation},build-test-reduction 네 전체와 test-reduction의 native 제외6항목은 직접reader/명시보존사유가 없는 종료 로그·일회runner다. root가 delete를 선택한다. 현재 docs/ops/development.md와 test-native-verification-cache.cjs가 사용하는 native는 보호한다. 승격근거: 과거 final-summary는 implemented-and-verified/commit84c8abe6, native18/storage14/source-cache5/selector26/preservation13/integration6/deployfixture8, targetedExitCodes0이었다. 당시 전체빌드·설치는 수행하지 않았고 성능절감은 미측정, 외부Drive plan갱신은 Incorrect function으로 blocked였다. legacy-cleanup은12dirs/381namespacefiles/1,983,384,671recordedbytes 삭제·실제부재를 기록했고 live Rust cache 및 selected companion/provider key를 보존했다. 이는 과거결과의 승격이며 지금의검증/삭제용량으로 가산하지 않는다. 현재대상 기존관측568,317bytes는 fresh ordinary삭제 시 결과/부재로 확인한다.

종료 최적화 로그 실제정리: 12:30:39.1649336~12:30:53.1939374UTC, ordinary PowerShell adapter actualexit0,10paths/126files/568,317논리bytes전부부재, work:legacy-completed-test-logs finalized. 보호한 native 하위는 실제존재하며 위 과거요약을 현기록에 승격했으므로 raw로그/일회runner/임시정리control도 제거한다. 등록된 source/config/nativebinary는 고정이고 다른 작업의 staged/working 변경은 보존한다. 다음 native apply 확인은 실제종료 이벤트 또는12:55UTC로 둔다.

12:55:11.375UTC 예정점검: completion은running, originalNode31464/native26672 생존. 후보40경로 중 independent-20261007-152601-220,independent-20261007-180228-802,manual-deferred_timer_hotfix_20261007_r5 deployment parent3곳은 실제부재,나머지37경로는존재했다. native 최종결과/9group finalize는 아직없어 전체성공을보고하지 않는다. 누적read42,829,356,984bytes는 재검증반복을 포함하며 회수량/진행률이 아니다. 삭제단계가 진행되고 있으므로 실행을중복/중단하지 않는다. 다른 독립 정리와검증은 끝났고 다음확인은 종료이벤트 또는13:25UTC다.

13:22:58.017UTC 수동 재개 점검: work_completion running, 원래Node/native생존.40경로중12곳실제부재(배포parent7곳,window_approval build/deploy logs2곳,window_overlay build/deploy logs2곳 및 check-result를 포함한 snapshot 기준12항목),나머지28존재. 최종result/finalize/log는아직없다. 누적읽기54,005,591,533bytes는진행률이아니다. 삭제단계가전진중이므로 원래실행을유지하고 다음확인은 실제종료 또는13:55UTC로둔다.

13:55:13.507UTC 예정점검: originalNode31464/native26672 생존, completion running.40경로중23실제부재/17존재로 전진했고 최종result/finalize는미반환이다. 누적read72,340,370,256bytes는반복읽기이므로회수량/진행률로해석하지않는다. 실행중삭제는유지하고 다음확인은종료이벤트또는14:25UTC다.

사용자가 삭제시간 최적화를 명시적으로 요청했다. 기존 구현이 Batch::current에서 남은 묶음 전체를 intent 전후마다 다시 내용 해시하는 것이 반복I/O 원인임을 source로 확인했다. API·묶음 전체 변경검사·권한·경로/링크·intent/부분실패 계약은 유지하고 dispatch 한 번 안의 파일 SHA만 authoritative file-version key로 재사용한다. 전체 review/tree를 캐시하거나 영구/mtime-only 캐시를 두지 않는다. Unix dev/inode/ctime 및 Windows fileID/ChangeTime/mtime/길이/속성을 사용하며 신뢰할 version을 얻지 못하면 기존 fullhash로 간다. 루트는 설계/통합/공통회귀/실제성능/삭제재개를 소유하고 bounded executor는 paths/lib/private tests/crate dep만 소유한다. 원본12파일과 staged가 byte같은 baseline을 실행 전 등록한 work:BI-01-delete-optimization에 동결했고 별도 small standalone target으로 baseline release를 준비한다. 기존 live binary/config/store 입력을 변경하지 않으며 native apply는 현재 실행을 유지한다. 새binary 실측·mutation회귀 후 남은 실제정리의 적용방식을 결정한다. Windows x64 실검증이며 공통 Unix 구현의 다른OS 수용은 별도다.

최적화 전환 실측:14:02:55UTC 기존native26672의 실제삭제PowerShell child가 없음을 확인하고 사용자의 최적화 요청에 따라 중지했다. controller31464도실제exit1로종료하여 기존work_completion은failed다(의도한전환중단이며전체정리실패/성공으로확대하지않음).14:03:23 상태는revision165/40개중24실제부재·deleted+remainingfalse/16존재/pending없음이다. manifest.pending도없고 중지PID가쓴own maintenance.lock만pid종료/내용일치후일반삭제했다. 정상manifest·기존24삭제결과는그대로유지했다. 별도최적화run으로남은16개만재개한다. v1release56tests모두pass/0fail 및exampleexit0. privateAPI변경으로기존공개dispatch/Fn와경로/권한/intent그룹계약은유지한다. v1순차비교201,336,832bytes/13files의apply9.068→4.316초,737,280bytes/720files23.569→26.565초였다. 첫비교는old mock native정리와일부중첩되고cache/경합미통제이므로전체개선율로일반화하지않는다. smallfile회귀를확인해64KiB미만원래fullhash경로를유지하는v2를동결·재검증했다. 관련공식API근거는Microsoft FILE_BASIC_INFO의ChangeTime/LastWriteTime정의(https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_basic_info)이며실제보호는새동일크기/mtime복원·열린writer·sibling변경회귀로확인한다.

자체deploy-writer검증묶음은native에등록되지않았고검증·소비가끝난Nodeowner이므로추가전체해시없이기존PowerShell owner절차로정리했다. 첫보호검사는합성.git의Hidden에서멈췄으며실제테스트생성root임을재확인한뒤같은adapter에서확인된생성물의ReadOnly/Hidden만정상화했다.14:12:28.662~14:12:33.441UTC/899,796논리bytes/453files,actualexit0/deleted/실제부재/work:BI-01-deploy-writer finalized. 속성별path/before/after는BI-01-attribute-receipt.json에추가했고unusednative등록request도제거했다. source/currentuser.git/System/ACL은변경하지않았다.

완결old mock9run 실제정리: nativeapply actualexit0/abortedfalse/9results전부deleted·remainingfalse,9경로실제부재와work:legacy-completed-deploy-mocks finalized를확인했다.14:05:31UTC 시작후640.487초이며논리11,692,799bytes다. 이작은입력에서도kernel시간이대부분이고 source의각ancestor fullmetadata조회가반복되는병목을추가확인했다. v3는Windows상위경로를매번동일한auth호출후GetFileAttributesW로새로검사하며leaf만fullmetadata를얻는다. ancestor/권한결과는캐시하지않고NUL을거부하며API실패/UNC/longpath는기존std관측으로fallback하여원래오류/부재/링크의미를유지한다. 다른OS경로는그대로다. v2 57pass/0fail 및exampleexit0의입력은보존했고v3를새입력으로동결해영향검사와최종비교를수행한다.

v3 실측·채택 판단:58tests/0fail,exampleexit0. 기존native mock 종료후14:18:59.921~14:20:07.070UTC 역순비교는201,336,832bytes/13files의apply baseline8.111→optimized3.873초,737,280bytes/720files21.100→21.408초,전부exit0/실제부재였다. Windows ancestor 속성API 교체의독립적개선은확인하지못해최종채택에서제외하고이미57검사를마친v2 paths.rs로정확히되돌렸다. 공개계약·metadata/권한/링크검사는기존std를유지하고dispatch안의64KiB이상내용SHA재사용만채택한다. v2동일12입력/기존binary의일치확인과최종역순비교를수행하며재컴파일은중복하지않는다.

최종 채택 v2 검증과 재개: Windows x64 rust/cargo1.98.0 release/offline/locked, library6·contracts31·groups14·registry6 합계57pass/0fail, doc0와 dispatch example 빌드 모두 actualexit0(14:11:38.768UTC 종료). 같은12입력 source SHA256 53541ea779f1e203ba82ca791e972507c47da41446ac9d97d3cf3944604b4c72, dispatch SHA256 d8fe13fc90aacf2c959efa93756298e385d67806882f563598535cf5e0dc24e4를 확인했다. 14:21:01.484~14:22:07.349UTC 역순 단일 비교에서201,336,832bytes/13files apply8.111718→3.695527초(약54%감소),737,280bytes/720files19.982470→20.777145초(약4%증가)였다. 두 비교 모두exit0/실제부재이며 반복 통계·전체 프로젝트/물리디스크 성능을 주장하지 않는다. 큰 파일의 반복 내용 읽기만 줄이고 작은 파일의 기존 경로와 매회 권한·경로/링크·전체묶음 변경검사는 유지한다. 14:24UTC 새 work_completion6b8212b5-9b4c-4f1c-9aec-79c08a12a168로 기존24결과를 보존하고 남은16만 시작했다. 완결된 묶음은 원래 token을 재사용하되 apply에서 재검사하고 부분완료 묶음만 다시 review한다. 현재/복구/프로세스 guard 뒤 실제삭제·부재·9producer finalize가 성공 조건이다. Linux/macOS 실행, 전체 앱/VSIX 빌드·설치는 수행하지 않았다.

최적화 자체 생성물도 종료했다: 2026-10-15T14:25:26.9878605Z~2026-10-15T14:25:29.6266688Z, 122169210논리bytes/485files, 일반 PowerShell owner adapter actualexit0/deleted/실제부재/work:BI-01-delete-optimization finalized. 비교 source snapshots·standalone target·baseline/v1/v2/v3 실행파일·임시 결과/로그를 한 묶음으로 제거했다. 필요한 최종 입력·실제57검사·단일 비교 결과는 위 기록에 승격했고, 실제남은삭제가 소비하는 검증된 v2 실행파일은 보호 control에 둔다.

14:36:47UTC 최적화 재개 첫 점검: 새 controller32936/native25640 생존, partial review63.193초 exit0와 current.7/recovery.6/protection guard blockers0(14:25:29UTC)를 확인했다. manifest revision192, pending파일없음, 기존24부재/16존재이며 apply최종결과는아직없다. 누적읽기3,879,479,491bytes는반복관측을포함하므로진행률/회수량으로해석하지않는다. 실행중인입력과binary를유지하고 종료이벤트또는15분뒤에확인한다.

14:52:27UTC 예정점검: controller32936/native25640 생존,manifest revision192·pending파일없음,24부재/16존재로아직전체묶음사전관측중이다. 누적read7,876,593,580bytes는진행률이아니다. 이번최적화가큰파일내용재읽기를줄여도파일수가많은실제묶음의경로검사비용은남아있음을확인하며,단일비교54%감소를실제전체삭제시간개선으로확대하지않는다. 진행중사전관측을중복/재시작하지않고종료또는20분뒤확인한다.

15:13:04UTC 수동재개점검: controller32936/native25640생존,40경로중29실제부재/11존재로삭제가전진했다. manifest revision208·pending파일없음,최종apply/finalize결과는미반환이다. 누적read8,216,789,371bytes는전체삭제개선율/회수량이아니다. 진행입력/binary를유지하며종료또는20분뒤확인한다.

최종 실제삭제 수용: 2026-10-15T15:28:51.625Z(KST10월16일00:28:51) 새 controller/native actualexit0, apply3,798.669초(약63분19초), abortedfalse/16results전부deleted·remainingfalse였다. 기존24결과와합쳐원래9버전40경로전부실제부재,9producer record finalized/remaining[]/references[]/blockers[]를15:29:08UTC 별도로확인했다. fresh원래검토합계19,612,284,780논리bytes(물리회수량아님)이며40전체정리완료로집계한다. 중간중지/57검사/실험/재개에쓴시간을실제삭제apply시간과합쳐성능개선율로주장하지않는다. 원래binary와동일한16입력전체비교를하지않았으므로실제전체삭제의단축률은미측정이다. Windows/현재.7·복구.6·소스/사용자/활성공유입력보호는유지했다. 기존지침·통합·Windows검증과최종내용SHA최적화57검사의범위/한계는위기록을따른다.

최종 control 정리: 새controller32936/native25640의실제종료및work_completion succeeded/exit0를확인한뒤검증dispatch실행파일·guard·재개controller·request/review/apply/console raw제어파일을일반삭제하고부재를확인했다. 중앙manifest·다른작업record·작은후보판단snapshot및속성별receipt는유지한다. 현재/복구본·보류원본과승격한검증결과는보존했다. task분리index·allowlist는커밋후제거한다.

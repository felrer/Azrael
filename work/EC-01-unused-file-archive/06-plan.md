상태: 공유 캐시 소유권 수명 구현과 대상 회귀·새 검증 산출물 정리는 완료했다. 전체 기본 캐시 회귀는 설치된 native owner의 stopped/unknown 복구 예약 거절로 실패해 전체 통과로 수용하지 않았다. 실제 제품 빌드·설치 및 이전 보호 캐시·테스트 정리의 미해결 상태는 별도다.

# 작업 사본 교체 시 공유 모듈 캐시의 소유권 수명 정리

## 목표와 범위

- 작업 사본 A에서 생성한 완료 캐시를 동일한 입력의 사본 B에서도 같은 장기 소유자 아래 재사용한다. A를 정상 퇴역한 뒤에도 B와 설치된 릴리스의 보호가 유지되어야 한다.
- 대상은 companion/providers/WindowControl 등 기존 module cache owner와 작업 사본·릴리스 소비 참조의 연결이다. Cargo target 선택과 stable compilation workspace, fingerprint 배치 처리, script-delta 입력은 이미 구현된 기능을 재사용한다.
- 공통 계약: 소유자는 캐시를 생성·관리하고 소비자는 사용 참조만 갖는다. 실행 종료, 참조 해제, 작업 사본 삭제, 캐시 삭제는 각각 별도 전이다.
- 이번 구현 제안은 코드·기존 회귀·소규모 실제 진입점 검증과 task-owned fixture 정리까지다. 전체 앱 빌드·프로필 설치, 실제 과거 캐시 일괄 삭제·이관, 재부팅 내구성 개선, CPU 병렬화와 성능 A/B는 포함하지 않는다. 실제 과거 등록 정리는 정확 대상과 근거를 먼저 제시한다.
- 플랫폼은 공통 수명 의미를 유지하되 현재 module-cache PowerShell 구현과 로컬 Windows x64를 우선 수용한다. Linux x64/glibc·macOS ARM64의 기존 경로를 보존하고 이식 가능한 로직과 플랫폼 경계를 검사한다. native 수용을 실행하지 않은 OS를 통과로 표시하지 않는다. Remote SSH·컨테이너·네트워크 공유 파일시스템으로 범위를 확장하지 않는다.

## 구현 전 확인한 구조

| 소유 코드 | 현재 동작과 문제 |
| --- | --- |
| `scripts/build-module-cache.ps1::Open-BuildModuleCache` | explicit CacheProjectRoot 또는 실행 프로젝트가 owner다. 실행 프로젝트는 owner 경계 내부여야 하며 `.projects.json`에 경로로 추가된다. sibling 작업 사본을 owner로 삼으면 다음 sibling이 경계 밖이 된다. |
| `Get-BuildModuleEntry` / `Save-BuildModuleEntry` | 등록된 모든 프로젝트의 존재를 먼저 요구한다. 사라진 과거 사본이 정상 완료 캐시의 조회·저장도 막는다. |
| `Assert-BuildModuleConsumers` / `Get-ProtectedBuildCachePaths` | 각 프로젝트 catalog와 설치 receipt를 순회한다. 사본 경로만 삭제하면 소비·설치 보호의 근거도 사라진다. |
| `scripts/build-azrael.ps1` / `scripts/deploy-azrael.ps1` | explicit module owner 전달과 companion dependency 참조가 이미 있다. 새 소유권 체계를 따로 만들기보다 이 경로의 소비자 등록·해제 및 release handoff를 완성한다. |
| `scripts/manage-module-cache-projects.ps1` | inspect/retire와 legacy inspect/retire, revision·근거·소비 해제 검사가 이미 있다. 수동 registry 편집이나 사본 부재에 의한 자동 퇴역을 추가하지 않는다. |

근거는 현재 코드와 기존 `05-plan.md`의 u/w15/w17 사례다. 당시 등록·캐시의 현재 보호 상태를 이번 계획에서 다시 실측한 것은 아니다. checkout에는 관련 파일을 포함한 다수의 선행·동시 변경이 있으므로 구현 직전 변경 범위와 진행 중 소비자를 다시 확인한다. 후속 테스트 검토에서 TypeScript 경로는 `prepare-independent-vscode.ps1`, namespace 변환, preservation 및 namespace 검사에 사용되고, 정리기는 설치 이력의 build-info에 기록된 경로를 보호함을 확인했다. 이를 설치 앱의 실제 runtime 직접 읽기로 설명한 앞선 주장은 과도했다. 실행 중 직접 사용 여부는 별도 증거가 필요하며, 도구 참조를 runtime 의존성으로 일괄 간주하지 않는다.

## 실행 승인된 결정

1. **고정 owner + 일시 consumer:** 이 checkout의 새 고정 작업 사본들은 primary project를 명시적 장기 module owner로 사용한다. 실행 중인 사본·이미 선택한 owner를 바꾸지 않는다. 다른 프로젝트의 독립 실행은 기존 로컬 기본값을 유지하며 시스템 전역 단일 캐시를 도입하지 않는다. 장점은 경계 안의 새 사본이 같은 저장소를 선택한다는 것이고, 비용은 owner 측에 작은 소비·handoff 제어 기록을 유지해야 한다는 것이다.
2. **완료 캐시 재사용과 삭제 심사 분리:** owner·정확 key·완료 lifecycle·출력 전체 무결성이 검증되고 새 consumer 보호를 먼저 영속화할 수 있는 항목만 재사용한다. 관련 없는 legacy catalog 부재는 삭제·교체를 계속 차단하지만 그 자체만으로 검증된 완료 항목의 소비를 막지 않도록 한다. 무결성 불명, pending/unknown 생성 결과, owner/새 참조 기록 실패는 재사용도 차단한다. 이는 현재 전역 존재 guard의 적용 범위를 바꾸는 제안이므로 구현 전에 승인할 계약이다. 기존처럼 모든 소비를 차단하는 대안은 단순하지만 과거 미확정 경로가 새 빌드까지 계속 막는다.
3. **사용자 선택: 재생성 가능한 과거 캐시는 삭제 우선:** 사라진 과거 사본에 연결된 미사용 캐시는 재생성 비용을 감수하고 삭제하는 방향이다. 단, 캐시 여부만으로 현재 소비가 없다고 판단하지 않는다. 현재 정리기의 설치 이력 보호는 실제 runtime 직접 소비와 구분해 검토한다. 준비·검사에만 쓰는 도구는 다음 검사에서 현재 도구를 재준비하도록 연결하고, 실제 runtime·rollback 소비가 있으면 필요한 대체 검증과 정식 handoff를 수행한 뒤 기존 참조를 해제·삭제한다. 미사용과 producer 종료가 증명된 항목은 교체 생성 없이 삭제 가능하다. 과거 참조가 끝내 불명확한 항목은 그대로 삭제하지 않고 정확한 차단 근거를 보고한다. 빈 catalog 생성, 임의 registry 수정, unknown의 성공 전환으로 해제하지 않는다. 실제 설치 경로 전환·전체 재빌드가 필요하면 기존 계획 범위를 넘으므로 해당 단계의 권한을 별도로 확인한다.

## 구현 순서와 산출물

실행 분담: root는 module cache 선택·publication·소비 검사·퇴역과 A→B 회귀 및 문서를 소유한다. workspace 담당은 manifest의 장기 owner 고정과 hash-bound 배포 진입점을, consumer 담당은 정식 owner 측 lifecycle 참조와 검증 완료 후 CAS 해제를 소유한다. 기존 native owner의 공유 catalog 등록·정리는 직렬화하고, source/manifest 회귀는 독립 fixture에서 수행한다. 전체 제품 빌드와 실제 설치 변경은 하지 않는다.

기존 `.projects.json` schema 1을 유지한다. 사라진 등록을 자동으로 무시하는 별도 schema는 설치·복구 참조 누락 위험이 있어 도입하지 않는다. 완료 entry 재사용 검사만 전역 존재 검사에서 분리하고, 삭제·교체와 정상 퇴역에는 기존 보호를 유지한다. 새 proxy는 owner 측 공식 lifecycle로만 관리하며 활성 상태의 자체 정리도 차단한다. 해제 영수증의 정리까지 마쳐야 사본을 퇴역할 수 있다.

### 1. 소유자 선택과 소비 계약 고정

- 기존 architecture의 기능 의존 캐시 절과 operational owner에 위 승인 계약을 반영하고 기존 feature inventory의 구현 owner·필수 검사 연결을 갱신한다.
- `deployment-workspace.cjs`, build/deploy 호출부에서 원래 프로젝트 identity를 캐시 소유자로 명시 전달한다. frozen project source path와 cache owner path는 분리하며 추정 경로나 cwd로 sibling owner를 선택하지 않는다.
- 산출물: A/B 사본이 같은 owner/root를 선택하는 호출 계약. 이것이 다음 소비자 연결의 선행 조건이다.

### 2. owner 측에서 소비 참조를 지속 관리

- 기존 artifact-lifecycle의 reference 종류·CAS/revision·잠금·producer 종료 계약을 사용한다. 별도의 권한 없는 JSON 소비 목록을 만들지 않는다. cross-project 참조를 현 API가 표현하지 못하는 경계만 기존 lifecycle owner에 최소 확장한다.
- 새 소비는 exact module/key와 소비자 project/run/version identity에 연결하고 실제 경로를 반환하기 전에 보호를 확정한다. metadata 기록과 정리가 같은 cache lease·일관된 catalog 잠금 순서를 따른다.
- 실행 전용 참조, release dependency, installation, rollback/evidence를 구분한다. build finally는 실제 종료가 확인된 실행 참조만 닫는다. 실패·강제 종료·관측 유실은 기존 상태와 보호를 유지한다.
- 릴리스가 cache의 TypeScript 등 외부 파일을 계속 읽으면 장기 owner 안의 정식 소비 기록으로 handoff한다. 새 참조를 확정·검증한 뒤 이전 참조를 해제한다. 사본 삭제가 설치 보호 근거를 없애지 않아야 한다.
- 산출물: 작업 사본 없이도 읽을 수 있는 정확 소비·보호 기록과 기존 catalog 사이의 정합성. 새 index가 있다면 native cleanup의 기존 inbound reference 검사에도 연결하고 수동 편집은 금지한다.

### 3. 작업 사본의 정상 퇴역에 연결

- cache handle 닫기와 프로젝트 퇴역을 동일시하지 않는다. 한 사본은 여러 run/릴리스가 사용할 수 있다.
- producer tree 종료 확인 → 실행 참조 해제 → dependency/installation/rollback/evidence의 종료 또는 검증된 handoff → 남은 소비·보호 재검사 → 기존 프로젝트 등록 퇴역 → 사본 삭제/부재 확인 순서로 연결한다.
- 중간 중단 후 같은 요청으로 재개해 중복 해제·다른 consumer 제거를 거절한다. 퇴역 완료 전 사본 삭제를 막는다. handoff되지 않은 설치 참조가 있으면 이유와 다음 조건을 반환한다.
- 산출물: 새 disposable workspace 정리 owner에서 호출하는 명시적 retire 절차. 캐시 payload 삭제 결정은 여기에 합치지 않는다.

### 4. 재사용 경로와 legacy 정리 경로 분리

- 위 보호 기록과 handoff 검증이 갖춰진 뒤에만 조회·publication의 전역 RequireExisting 의존성을 좁힌다. 소유 경계·출력 hash·key/recipe·lease 검증은 그대로 둔다.
- cleanup은 전체 legacy 등록, 설치/실행/rollback과 실제 소비 보호를 계속 확인한다. legacy 불확실성이 있으면 삭제·선택 key 교체를 차단하고, 검증된 hit의 사용 가능 여부와 별개로 명시한다.
- inspect에 owner, consumer, legacy blocker, reuse 가능 여부, deletion blocker 및 다음 조치를 구분해 제공한다.
- 실제 과거 등록 적용은 inspection만으로 승인된 것으로 간주하지 않는다. 후속 적용이 필요하면 정확 대상·기존 근거·남는 보호를 같은 계획에 제시한다.
- 사용자의 삭제 우선 선택을 반영해 실제 정리 후보는 미사용 입증→삭제, 현재 소비 확인→대체 생성·검증·소비 전환→삭제, 참조 불명확→보호 유지로 처리한다. 불명확한 항목을 단순 보관으로 종결하지 않고 삭제를 막는 구체적인 미확인 소비·종료 근거를 제시한다. 이번 계획 수정 자체는 실제 payload 삭제나 설치 변경의 실행이 아니다.

## 검증과 성공 기준

`testing`의 최소 충분 증거 원칙을 적용해 기존 `test-build-module-cache.ps1`, `test-deployment-workspace.cjs`, lifecycle 및 mock build/deploy 회귀를 확장한다. 새 테스트 파일·전체 제품 컴파일은 기본 요구가 아니다. 구현 범위에 따라 기존 필수 보존 검사도 선택한다.

| 실제 관찰할 계약 | 성공 기준 |
| --- | --- |
| A에서 생성 → B에서 동일 입력 선택 | 같은 물리 owner와 key, cache hit, 생성 명령 재호출 없음 |
| A 정상 퇴역 후 B 사용 | A 등록·task-owned 사본은 사라지고 B의 참조와 완료 캐시는 유지 |
| 설치/rollback 소비자가 있는 A 퇴역 | 보호의 검증된 handoff 또는 퇴역 차단. 설치 보호가 빠지는 창 없음 |
| 소스·도구·recipe·플랫폼 변경 | 관련 key 미스, 무관한 정상 캐시 보존 |
| 과거 catalog 부재 | 해당 불확실성의 삭제 차단 유지. 새 계약의 검증된 hit만 사용 가능 |
| consumer 기록 실패/중단·pending/unknown·손상 receipt | 재사용/삭제의 해당 보호 경계를 차단하고 성공으로 승격하지 않음 |
| 동시 소비 등록과 정리/퇴역, 다른 consumer의 변화 | lease/CAS 충돌을 안전하게 거절하고 활성 consumer가 있는 항목은 삭제하지 않음 |
| 반복 퇴역·오래된 근거·경로 재사용/교체·경계 밖/링크 | 기존 identity·revision·containment 보호 유지 |

Windows x64 실제 PowerShell 진입점의 작은 fixture로 위 생성/재사용/퇴역/정리를 확인한다. 실제 Linux/macOS native 실행은 환경과 권한이 확인될 때 기존 플랫폼 경로로 수행하고, 불가한 범위는 미검증으로 보고한다. 제품 전체 빌드 시간 절감은 이번 기능 검증으로 주장하지 않는다.

## 실행·정리·완료 조건

- root가 공유 계약·구현 통합·최종 수용을 맡는다. 현재 계획에는 별도 agent 실행을 요구하지 않는다. 진행 중 빌드의 입력·cache owner·설치 참조를 바꾸지 않는다.
- 승인 후 `implementation` 지침으로 필요한 호출부와 기존 lifecycle owner만 변경한다. 필수 선행 조건이 미확정이면 영향을 받는 변경만 보류한다.
- 검증 산출물은 생성 전에 task/run 소유를 기록하고 실제 종료 코드·선택 범위·실패 원인을 보존한다. 해당 검증 종료 후 기존 owner의 register/review/apply/finalize로 task-owned 임시 자료를 지우고 부재를 확인한다. 설치·현재 빌드·과거 미확정 자료는 fixture cleanup에 포함하지 않는다.
- 완료는 A→B 재사용, 정상/실패/중단 수명, 설치 보호, legacy 차단 보존 및 임시 자료 정리를 모두 확인한 뒤 선언한다. 기존 운영 캐시 정리가 끝났거나 전체 앱 설치가 검증됐다는 의미로 보고하지 않는다.

## 소유권 수명 구현과 대상 수용 결과

- 새 normal/derived workspace manifest와 읽기 전용 입력 재사용은 장기 module owner와 물리 identity를 전달·검증한다. 실제 workingRoot의 배포에는 manifest 경로와 SHA를 함께 전달하며, 실행 root·소스·불변 입력 검증을 통과한 owner만 선택한다. 다른 explicit owner와 부분 인수·손상 hash·readOnly 실행은 거절한다. 임의 ancestor/cwd 탐색은 없다.
- companion 소비는 사본의 version 참조와 장기 owner의 공식 lifecycle proxy를 함께 기록한다. 활성 proxy 자체와 캐시는 native 정리 검사에서도 보호된다. 완료 준비의 정확한 source 참조와 owner 참조만 CAS 해제하고 재시도를 지원한다. source가 사라져도 owner 참조는 남는다. 해제 영수증까지 canonical cleanup으로 정리한 뒤에만 정상 사본 퇴역이 가능하다.
- provider/companion 완료 hit는 소유 표식·완료 lifecycle·전체 출력 hash와 physical lease를 검증한다. 관련 없는 legacy 부재는 hit를 막지 않으며, 기존 key 교체·삭제는 계속 차단한다. `.projects.json` schema 1과 정상 retire의 설치·복구·종료 증거를 유지했다.
- WindowControl 기본 target은 장기 module owner의 `artifacts/cache/window-control-native/target`이다. 별도 lease와 정식 lifecycle을 native compile, C# helper 생성, runtime staging까지 유지한다. 명시적 target은 기존 경로를 유지한다. 이전 failed/pending 결과는 rebuild를 요구하며 unregistered target을 자동 소유하지 않는다.
- 폐기한 기존 mock의 전역 missing-project 사전 거절 기대는 cache의 실제 hit/교체 분리 회귀로 대체했다. 새 helper·build 호출 변경이 기존 lifecycle 회귀를 선택하도록 source-test owner 연결을 추가했다. 새 테스트 파일은 만들지 않았다.

Windows x64 검증:

| 범위 | 실제 결과 |
| --- | --- |
| 최종 `test-build-module-cache.ps1 -OwnershipOnly` | exit 0, 23.521초. 실제 배포 binding 함수, A→B 단일 생성·재사용, A 퇴역·부재 후 B hit, legacy hit/교체 분리, WindowControl 물리 lease·canonical cleanup 보호·실패 retry·표식/legacy 거절 |
| `-CleanupOnly` | exit 0, 26.141초. payload/log/receipt 순서, 잠금·ReadOnly와 재시도·부재 |
| `-RegistryOnly` | exit 0, 40.059초. 원본 catalog·consumer·종료·compiler·증거/revision/race·정상 퇴역 |
| `-MissingRegistryOnly` | exit 0, 34.066초. 미확정 등록의 삭제 차단, 원래 소비 목록·권한·부재·변경 증거와 CLI 퇴역 |
| 준비 소비 참조 회귀 | 8/8, exit 0, 2.40초. source 부재 시 실제 native 참조 보호와 proxy 자체 보호, 완료 후 정확 해제·중단 재시도·실패/unknown 보존 |
| workspace 회귀 | 14 contract group, exit 0, 73.466초. normal/derived/reuse/legacy 및 기존 source/root/engine 무결성 |
| 실제 manifest resolver 후속 검사 | exit 0, 1.077초. retained r3의 변경 없는 normal/derived 입력으로 CLI/API, 잘못된 hash/root·readOnly 거절 |
| source-test owner 선택 | 1/1, exit 0, 12.011초. 새 PS helper·producer와 consumer helper가 기존 보존 회귀를 선택 |
| 최종 구문·diff | PS 7개, JS 7개, feature JSON parse 및 diff check exit 0 |

검증 제한: 기본 전체 캐시 회귀는 31.679초에 marker-recovery native `reserve`에서 exit 1이었다. 설치된 SHA `9bc66314681460df3d6da3a9dc923eac52411e22d1fb595b08371477ac492a26`를 실제 resolver·실행파일 hash로 확인했으며 override는 없었다. 이 실행기는 검증된 `stopped/unknown` 복구 기록에 `producer reservation requires complete stopped ownership`를 반환했다. 현재 `reservations.rs`는 `producer_records`의 전체 recovery 검증 뒤 `cleanup_recovery`를 허용하지만 설치 실행기의 실제 거절은 남아 있다. 이번 작업은 Rust 코드나 설치 실행기를 교체하지 않았고, 이 실패를 통과로 바꾸거나 예약 guard를 우회하지 않았다. 전체 regression acceptance와 이 도구의 정렬은 미해결이다. 제품 전체/native 실제 컴파일·설치, Linux/macOS 실행 및 시간 절감률은 검증하지 않았다.

새 산출물 정리: workspace r1/r2/r3를 설치된 optimized owner로 register/review/apply하고 실제 3개 root 부재 및 `finalized`를 확인했다. apply exit 0, 293.598초였다. root의 cache fixture는 각 기존 test owner가 finally에서 삭제·부재·finalize를 수행했고, 마지막 실제 catalog 조회에서 `module-cache-tests` 잔존 기록은 0개였다. source 선택 검사는 선택한 무출력 테스트만 실행했다. 필요한 compact evidence는 `08-owner-verification.json`, `08-workspace-owner-verification.json`, `08-workspace-owner-cleanup.json`에 남겼다. 이전 작업의 잔존 그룹은 이번 fixture 정리 성공으로 처리하지 않았다.

기존 변경과 같은 파일에 선행·동시 변경이 겹쳐 작업 단위 commit을 분리하지 않았다. 설치 변경과 과거 보호 캐시의 실제 제거도 수행하지 않았다.

### 관련 소유 문서

- [기능 의존 캐시](../../docs/architecture/project-maintenance.md#기능-의존-캐시와-연결-정리)
- [개발 운영](../../docs/ops/development.md), [프로젝트 관리 운영](../../docs/ops/project-maintenance.md)
- [Build playbook](../../docs/playbooks/build.md), [Artifact lifecycle](../../docs/playbooks/artifact-lifecycle.md)
- [기존 빌드 및 입력 개선 기록](05-plan.md)

## 후속 요청: 패키징·설치·호스트 회귀 검증 축소 제안

상태: 사용자 승인으로 아래 중복 축소·도구 보호 교정을 구현한다. 테스트 파일 수나 삭제 비율을 목표로 하지 않고 비중복 실패 경계만 유지하며 feature inventory·runner·설계 소유자를 함께 정합한다.

실행 소유: root는 module cache 정책·기존 cache 회귀·최종 checker 호출과 배포/mock gate·문서/수용을 맡고, test_consolidation 담당은 Python release 회귀와 namespace/host 정적 중복만 맡는다. 두 소스 범위는 분리했다. Windows x64, 기존 PowerShell7.6.9/Python3.13.15를 사용한다. 검증 r1/r2/r3은 `artifacts/tasks/ec01-test-policy/runs/` 아래 각 로그·요약, deploy checker가 별도 claim한 `artifacts/tasks/deploy-checks/runs/`의 고유 fixture, 기존 cache/cleanup test가 스스로 소유·정리하는 isolated fixture만 생성한다. 제품 runtime/설치 상태나 기존 실제 캐시는 변경하지 않는다. 산출물 정리 전 최소 결과를 이 문서에 옮기고 원시 로그·fixture는 기존 owner 경로로 제거한다.

선택 변경: 설치 이력 기반 도구 pin을 제거하는 것만으로는 `version → dependency/companion-tool`이 남는다. 이 참조는 준비 checkpoint 성공 후 exact version/release/tool key 및 VSIX/receipt를 확인해 기존 CAS release API로 해제한다. installation/runtime/다른 key 참조와 실패·미완료 준비는 보존한다. 실제 공유 도구의 물리 root에 준비 read lease를 연결한다. 최종 host는 과거 TypeScript 없이 기동하며 단독 mode는 변경 범위 또는 명시 요청에 따라 선택한다. cleaner는 신규 선택 mode와 기존 6단계 영수증을 구분해 읽고 실제 단계·정수 exit·boolean mode 증거를 확인한다.

중간 검증: r1 syntax0/cache CleanupOnly0(32.226초)/entry behavior0, Python synthetic21건0(94.983초), JS syntax2개0. r3의 preparation 도구 해제 회귀0(1.351초), cache CleanupOnly0(34.905초), 기존 및 선택형 cleaner 회귀0(466.078초). 모의 배포 r2/r3는 성공 fixture 정리 assertion에서 실패1(31.910/27.206초)했다. 최초 6단계 진단은 불완전했다. 실제 stderr는 릴리스가 이미 소유한 cleanup 보고서의 중복 claim이었다. 부모 보고서 소유를 검증해 재사용하도록 교정한 뒤 r4에서 compact evidence 등록에 빈 별도 cleanup ID를 쓰던 경계를 발견했고, r5에서는 evidence 출력도 부모 범위에 있어야 한다는 guard가 정당하게 거절했다. 보고서 옆의 부모 소유 cleanup-evidence 경로로 연결해 r6에서 영향받는 모의 사례만 재검증한다. 실패 결과를 성공으로 바꾸지 않는다. 읽기 전용 통합 검토에서 발견한 shared/ordinary runtime·계정 src 변경의 standalone 선택 누락도 보완했다. 실제 패키지/VSCode 기동 성공으로 해석하지 않는다.

### 최종 구현·검증 결과 (2026-10-30)

- 승인된 테스트 중복 축소와 재생성 가능한 검사 도구 캐시 보호 교정을 반영했다. 공유 캐시 owner/consumer 전체 재설계와 실제 과거 캐시 일괄 삭제는 이번 구현에 포함하지 않았다.
- 준비 완료 checkpoint의 VSIX/receipt를 다시 검증한 뒤 exact version의 동일 tool key `dependency/companion-tool` 참조만 CAS로 해제한다. 실제 설치 payload·다른 consumer·진행 중 lease·불명확한 소유권 보호는 유지한다.
- 최종 checker의 TypeScript/namespace 중복 실행과 UI 소스 의존을 제거했다. 단독 host는 명시 요청·전체 회귀·변경 범위 미상·host/runtime/계정 변경에 선택하며 기본 공존 host 검증은 유지한다.
- Windows x64: Python 패키지·설치 합성 회귀 21개(94.983초), 준비 상태 1.351초, 캐시 CleanupOnly 34.905초, cleaner 전체 466.078초, integrated-entry 및 구문 검사 통과(exit 0). 최종 모의 배포 r9는 선택 정책·수용 거부·부모 소유 정리를 포함한 7개 모두 통과(157.615초, exit 0).
- r6은 null ChangedPath 판정, r7은 테스트 실행기의 owner override 누락, r8은 제거한 UI 소스 전달을 기대하던 기존 assertion 때문에 실패했다. 실제 실패 결과를 보존하고 수정 후 r9에서 재검증했다. 초기 실패와 수정 원인은 `06-verification.json`에 남겼다.
- 실제 VSCode activation·제품 전체 빌드·사용자 프로필 설치·Linux/macOS 실행은 수행하지 않았다. 시간 절감률은 측정하지 않았다. 여러 작업의 기존 변경이 섞여 있으므로 작업 단위 commit은 만들지 않는다.
- 임시 산출물 정리 진행 중: 이 작업의 r1–r9와 exact 모의 배포 8개를 기존 owner로 닫고 등록·심사·삭제한다. r1의 중단된 registration 예약은 exact owner/fence와 종료 근거를 검증한 지원 recovery로 해제했다(실행 결과 변경 없음). 다른 EQ-01 관리 작업의 catalog 점유가 재발해 현재 해당 명령 종료를 기다린다. 잠금이나 보호를 우회하지 않는다.

### 정리 심사 결과와 남은 결정

17개 exact group 등록과 `registered` 심사를 완료했다. 일반 실행 9개는 삭제 가능이며 삭제·부재 확인·finalize를 진행한다. 모의 배포 8개는 아래 `artifacts/t-*` member가 `project-maintenance.json`의 관리 루트 밖이어서 그룹 전체가 보호됐다. 동일 그룹의 run/fixture/log도 함께 보존한다. 총 등록 측정값은 7,358,259 bytes(약 7.02MiB)다. 설치물이나 사용자 자료가 아닌 이번 합성 테스트 자료이며, 검증·실패 원인 진단 용도는 끝났다.

| `artifacts/tasks/deploy-checks/runs/` 아래 exact run | 동일 그룹의 관리 루트 밖 member | 그룹 bytes |
| --- | --- | ---: |
| `d336daff067f41a7a7d2d86c158bb90c` | `artifacts/t-d336` | 531343 |
| `63860c036cb547bca70b36267ae1f51e` | `artifacts/t-6386` | 532117 |
| `5f13399635f546f5a3ac1f1a7d3f72de` | `artifacts/t-5f13` | 535029 |
| `bf460df08a2b485d877168fead01696b` | `artifacts/t-bf46` | 535629 |
| `23df0e1691ee470abd9391735b3daeb8` | `artifacts/t-23df` | 542380 |
| `d0c2bf309a4647188efac2d9fdd9ee6e` | `artifacts/t-d0c2` | 453791 |
| `366ea780dc494462b10c7840695c518c` | `artifacts/t-366e` | 542434 |
| `32f99df50c3a472883a31a31921414fb` | `artifacts/t-32f9` | 3685536 |

기준 root는 `C:/Users/felre/Desktop/pi-harness-init`이다. 사용자 보존 승인은 없으며 defer만으로 완료 처리하지 않는다. 남은 결정은 테스트의 향후 short temporary 경로를 기존 관리 루트 안으로 바꾸고 현재 exact 8개 임시 경로의 관리 범위를 명시적으로 보완할지, 또는 이 exact 8개 그룹을 별도 기간/재검토 조건으로 보존 승인할지다. 루트 전체 확장·force 삭제·다른 API 우회는 하지 않는다. 지침과 도구 경계를 유지한 지원 범위가 확정되면 fresh review 후 정리한다.

### 최신 정리 상태: 미완료

- native `apply`의 실제 exit는 1이며 `os error 33` 파일 잠금 오류로 종료했다. `manifest.pending`은 없다. durable 결정은 r4/r7 삭제, r2 `stale review token after authorization` 차단, 일부 모의 그룹 defer를 기록했다. tool dispatch 성공이나 물리 삭제 일부를 전체 성공으로 바꾸지 않는다.
- 실제 부재는 `artifacts/tasks/ec01-test-policy/runs/r4`, `r7` 두 곳만 확인했다. 나머지 r1/r2/r3/r5/r6/r8/r9 7개는 남아 있다(등록 측정 합계 16,222 bytes). 위 모의 그룹 8개도 그대로 남아 있다. 남은 물리 자료 총 등록 측정값은 7,374,481 bytes다.
- 종료한 native PID31600의 durable reservation 17개가 남았다. PID/직계 자식 부재와 실제 동기 명령 종료를 관찰했지만, 예약 복구와 재심사·삭제·finalize는 아직 수행하지 않았다. r4/r7도 reservation 때문에 metadata finalize가 거절됐다. 현재 보호를 우회하지 않으며 `06-cleanup-result.json`에 항목별 durable 결과·실제 부재·예약 owner/token을 보존했다.
- 완료를 선언하지 않는다. 남은 정리를 위한 관리 도구 잠금·등록 경계 문제의 조사·수정을 추가 범위로 진행할지 사용자 결정을 요청한다. 이 미해결 자료에 대한 보존 승인은 아직 없다.

### 남길 최소 검증

- module cache의 작은 생성→hit→입력 변경 miss 검증, 활성 소비·미종료 producer·불명확 참조의 삭제 차단, 마지막 consumer 해제 후 정상 퇴역 검증. 기존 `test-build-module-cache.ps1`에서 유지·통합한다.
- `test_app_release.py`의 재배치 설치 정상 흐름 1개: 실제 ZIP→새 root의 PrepareOnly→최종 runtime config/경로 확인. `test_package_portable_closure_and_checksum_contract`와 `test_relocated_prepare_only_and_same_version_refusal`의 정상 구성 확인은 이 흐름에 모으고, checksum/포함 파일 확인은 별도 값싼 단위로 유지한다.
- 외부 runtime 누락·변조, 경로 탈출/충돌, 기존 설치·사용자 상태 덮어쓰기 방지와 실패 rollback. 각각 다른 보호 경계라 정상 경로 통과로 대체하지 않는다. 임의 필드 조합의 반복 전체 패키징 대신 validator 단위의 대표 경계 검증과 packaging/installer 각 경계의 최소 통합 검증으로 나눈다.
- 최종 배포 패키지에 대한 짧은 호스트 activation smoke: 검증한 engine/bridge와 상태 홈, 공유 endpoint를 실제로 선택하는지 확인한다. 기본 공존 smoke 하나를 유지하고 독립 activation/extension 의존성 변경 때 standalone도 선택한다. 기존 양쪽 모드를 항상 실행하는 정책의 축소는 승인 대상이다. 보통의 캐시/빌드 도구 수정은 이 전체 호스트 수용을 매번 실행하지 않는다.

### 제거·통합·조건부 선택 후보

| 현재 검사 | 제안과 남는 검출 경계 |
| --- | --- |
| host checker 340–344행의 통합 표식·extensionDependencies/Pack·proposal 선언 재검사 | `test-independent-namespace.cjs`의 생성된 manifest 검사로 통합하고 실제 호스트에서는 활성화·등록의 관찰만 유지. 현재 동일 assertion이 양쪽에 있어 정적 값 확인을 중복한다. |
| `test_app_release.py`의 여러 정상 흐름에서 sharedEngine/protocol/hash 재확인 | 최종 재배치 정상 흐름에 최종 값 확인을 모은다. package/installer의 독립 입력 거부는 각 경계에서 남기며, 후속 정상 흐름을 매 필드마다 재실행하지 않도록 분리한다. |
| `test-independent-namespace.cjs`의 정확 recoveryEdits=7, injection 개수, wrapper 내부 문자열·정규식 | 세부 갯수가 실제 제품 계약인 경우만 남기고, 기존 transform 동작·중복 적용 거부·실제 활성화 검사로 보호가 대체되는 assertion부터 퇴역. 변환 누락·중복을 잡는 유일한 검사까지 일괄 제거하지 않는다. |
| `verify-app-release.ps1`→`check-independent-vscode.ps1`의 전체 namespace 회귀 재실행 | 변경 시 source/생성 산출물 검사에서 실행하고, 최종 exact package에서는 내용 identity/필수 파일 및 실제 activation만 확인하는 방안. 대체 산출물 검출 범위와 최종 ZIP binding을 확인한 후 중복분을 제거한다. |
| 두 host 모드에서 manifest·공유 설정·상태 조건을 동일하게 반복 | 공통 정상 runtime 확인은 기본 smoke로 모으고 standalone에서는 원본 확장 비활성 상태의 독립 기동이라는 차이만 검증한다. 공존 모드의 namespace 충돌과 상태 격리는 남긴다. |
| 설치 build-info의 TypeScript 경로를 무기한 보호 | 테스트 삭제만으로 해결되지 않는다. 준비/검사 도구 참조는 작업 종료 시 release하고 필요시 현 tool owner로 재준비하도록 production cleanup/reference 정책도 별도 교정한다. 실제 runtime/evidence/rollback 소비는 유지한다. |

### 근거와 한계

- `engine.shared-engine.package-default`는 현재 `test_app_release.py` 전체를 실행한다. 이 파일에는 package-default 외 경로·설치·publisher 검사도 있어 관련 변경별 선택 범위를 나누는 후보지만, 서로 다른 계약의 테스트를 공유엔진과 무관하다는 이유로 삭제하지 않는다.
- 현재 checker의 exitCodes 6개는 initialInventory/hostInstall/finalInventory/namespace/standaloneHost/host이다. 실제 host 실행은 2회이며 6회 host 실행을 줄인다는 절감 주장은 잘못이다.
- `runtime && require(runtimePath).runtime === runtime`의 module cache는 Node의 require 메모리 캐시다. 디스크 build cache 보존 근거와 구분한다. 이 동일 객체 assertion은 내부 구현 고정 후보이고, 관찰 가능한 endpoint/runtime 선택 계약은 유지한다.
- 이번에는 실행시간·테스트 통과·최종 패키지의 캐시 독립 실행을 실측하지 않았다. 따라서 예상 절감률, 전체 테스트의 대부분이 불필요하다는 결론, 현재 설치본의 runtime 비의존 확증은 제시하지 않는다.

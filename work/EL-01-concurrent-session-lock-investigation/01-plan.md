상태: 기존 경합 개선의 소스·Windows 검증·정리 완료. 후속 다중 플랫폼 통합의 설계 보강도 완료했으며 제품 코드 구현·native 검증·실제 전환은 미실행이다. 기존 미커밋 변경과 분리되지 않아 커밋하지 않았지만 다른 세션에 통합이 배정됐다는 근거는 없다. 실제 관리 기록 이관·실행기 교체·전체 앱 빌드는 별도이며 기존 동시 변경을 보존한다.

# 동시 세션 잠금 경합 조사

## 목표·범위·권한

여러 세션의 관리 잠금 경합을 해결한다. 사용자가 권장 순서의 구현·검증을 승인했다. 생성 시각 등 우선순위가 낮은 세션이 모든 보호를 반환하는 방식 대신 임시 관리 잠금 반환과 보호 예약 유지 원칙을 따른다. 기존 동시 변경·다른 작업 산출물을 보존한다.

플랫폼 공통 관리 의미는 Windows x64·Linux x64/glibc·macOS ARM64이며 실제 실행은 Windows x64 로컬 체크아웃이다. 원격 실행·앱 빌드·설치는 포함하지 않는다. 다른 OS 수용은 Windows 결과와 구분한다.

## 후속 다중 플랫폼 설계

요청 범위는 기존 묶음 관리·보호·삭제·잠금이 macOS/Linux에서 실제로 성립하는지 근거를 대조하고 `azrael maintenance`의 공통 코어·플랫폼 모듈·검증·순차 전환을 설계하는 것이다. 설계 문서는 갱신하며 제품 코드·설치·실제 저장소는 바꾸지 않는다. 기존 library와 CLI/worker 진입을 조사하고 새 OS별 독립 관리 제품을 복제하지 않는 방향을 따른다. 현재 유지 설계는 [관리 모듈 경계](../../docs/architecture/project-maintenance.md#maintenance-platform-modules)가 소유한다.

확정 범위: Windows x64, Linux x64/glibc, macOS ARM64의 로컬 파일시스템을 먼저 검증한다. 공통 소스를 구현하고 OS별 native/설치 경로 수용 후 해당 OS만 순차 전환한다. NAS/SMB/NFS·여러 OS가 동시에 접근하는 공유 관리 기록은 후속이다. 기존 저장 형식으로 명령 통합을 먼저 검증하고 분할 저장 이관은 별도다. WSL의 Linux 프로세스 검증을 일반 Linux desktop 또는 Windows 공유 마운트 수용으로 확대하지 않는다.

### 현재 근거와 구체적인 보강 지점

| 영역 | 확인한 코드·근거 | 판단과 설계 반영 |
| --- | --- | --- |
| 공통 묶음·보호·예약 | `project-maintenance/src/lib.rs`, `groups.rs`, `registry.rs`, `reservations.rs`와 engine `ProjectMaintenanceHandler` | OS마다 복제하지 않는다. 내장 handler의 경로별 권한·취소를 유지하고 CLI가 같은 코어를 사용한다. |
| Unix 삭제 | `paths.rs:1095`의 `delete`는 `_entries`를 사용하지 않고 `remove_dir_all/remove_file` 호출; `apply.rs`는 사전 검사한 목록을 전달 | Unix backend의 정확한 승인 구성·최종 identity/변경 검증이 구현 경계에 없다. 공격·실제 오삭제를 재현한 것은 아니며 정상 실행·안전성을 source만으로 확정할 수 없다. descriptor-relative no-follow backend를 설계한다. |
| 링크·마운트 | `paths.rs`의 ancestor symlink 검사와 entries 재귀; Unix junction 지원 없음; 별도 mount boundary 검사 없음 | symlink 거부를 유지하고 마운트/별도 root 경계를 검증한다. 마운트가 symlink가 아니라는 점과 Linux bind mount에서 dev 값만으로 충분하지 않음을 반영한다. |
| macOS 경로 | `within`은 모든 macOS 경로를 lossy 문자열 소문자로 비교; 기존 macOS 검사는 ASCII 변형만 다룸; relative는 UTF-8 요구 | 볼륨 대소문자·Unicode 별칭·객체 identity를 함께 검증한다. 확인 불가·표현 불가 경로는 다른 경로로 변환하지 않고 거절한다. |
| 잠금·종료 | std File OS lock, Unix dev/ino/nlink, `owner_absent`의 kill(pid,0); lease는 stdin loop이며 parent_pid는 진단 응답에 포함 | Unix 구현 분기는 있으나 macOS/Linux 수용은 별도다. EOF/취소·자식 연결 상속·부모/worker 사망·부분 획득 반환을 실제 프로세스로 검사한다. PID 부재만으로 전체 트리 종료를 확정하지 않는다. |
| Windows 삭제 | `windows_delete.rs`의 PowerShell worker, Job Object, exact-tree/속성·hardlink 검사 | 기존 검증 경계를 Windows 어댑터에 보존한다. Unix에 PowerShell 또는 Windows API를 이식하지 않는다. |
| 재사용 기반 | workspace rustix/libc와 `exec-server/src/no_follow/unix.rs`의 openat/unlinkat | 경로/handle primitive의 재사용 후보다. 기존 remove API는 recursive 요청을 명시 Unsupported로 거절하므로 완성된 재귀 삭제기로 간주하지 않는다. |
| 검증 근거 | 이전 경합 개선의 Windows 200 native tests; 현재 platform-contracts CI는 플랫폼/패키징/provenance 및 uds/bridge 검사 | 이번 명령 통합의 세 OS 검증 근거가 아니다. CI에 관리 native 회귀·실제 CLI/adapter 수용을 연결해야 한다. |

로컬에서 `docs/ops/multi-platform.md`의 과거 Mac/Linux 앱 수용 설명을 확인했다. 그 설명은 일반 host/package 범위이며 최신 관리 기능의 수용을 입증하지 않는다. 문서가 가리킨 두 `artifacts/app-releases/2026.0.5-*/verification.json`은 현재 체크아웃에 없었다. 이 부재는 과거 성공의 부정이나 OS 지원 불가능의 증거가 아니다. 이번에는 macOS/Linux 빌드·테스트·원격 접속을 실행하지 않았다.

### 구현 인계와 수용 조건

root는 공통 CLI/권한/호환성/모듈 계약을 확정한다. 구현 시 파일시스템 backend는 기존 호출자가 전달하는 승인된 구성과 실제 identity를 소비하며, review/예약/intent/CAS 정책을 재구현하지 않는다. 프로세스 backend는 기존 Windows worker를 보존하고 Unix에서 필요하지 않은 worker를 새로 만들지 않는다. 내부 lease/worker 진입과 활성 릴리스 선택, capability 조회는 사용자 계정·UI 초기화와 분리한다.

선행 순서는 현재 OS별 primitive/계약 gap 보강 → 공통 CLI/adapter 연결과 Windows 회귀 → Linux/macOS native 관리·명령 수용 → OS별 패키지의 실제 실행 경로 검증 → 별도 승인된 OS별 전환이다. 저장 형식 이관은 그 뒤 독립 경계다. 파일 교체/새 entry·권한 거부·외부 hardlink·symlink·마운트 경계, APFS 두 case 구성, 부모/worker crash·unknown 보존·동시 등록/삭제 보호를 필수 경계로 선정하며 기존 tests를 확장해 재사용한다.

설계 판단은 정적 코드 조사와 기존 수용 근거 대조에 한정한다. 검증한 source의 Windows 개선과 새 CLI/Unix backend의 target을 구분하며 제품 실행 성공·성능 개선으로 보고하지 않는다.

이번 설계 변경은 관리 architecture, multi-platform의 연결 및 이 작업 기록 3개 문서에 한정했다. 변경 범위의 `git diff --check` actual0, 새 로컬 링크3개와 명시 anchor 확인 actual0이다. 넓은 기존 링크 검사에서 발견한 외부 Drive 역사 링크는 이번 변경 범위 밖으로 유지했으며 검증했다고 주장하지 않는다. 제품 코드·CI·설치·관리 상태는 변경하지 않았고 새 실행 산출물이나 임시 파일은 생성하지 않았다. 다음 실행 단계에는 CLI와 OS backend 보강, Windows 회귀 및 Linux/macOS의 native 관리·정확한 패키지 수용이 남아 있다.

## 구현 순서와 소유

root가 재획득·실패마감 및 관리 임계구간 축소, 상태 분할 선택·통합·검증·문서·정리를 소유한다. read-only explorer는 storage/cross-group 보호 근거와 통합 검토를 담당하고, executor는 opt-in timing 및 독립 partitioned_storage 모듈, 다른 executor는 실제 CLI 경합·성능 probe를 담당한다. root가 공통 계약을 확정하고 기존 동시 변경을 보존한다. 전체 세션 직렬화·보호 완화는 하지 않는다.

기존 기록을 확장하며 `implementation`·`testing`을 적용한다. 생성물 owner는 `run:EL-01:lock-improvement-r1`, 루트 `artifacts/tasks/EL-01/runs/lock-improvement-r1/`이다. 실제 실행 전 입력·로그·결과를 이 범위로 귀속한다. 기존 소스 변경을 별도 기준으로 보존하고 이번 변경만 검토한다.

## 접근과 성공 기준

기존 실패와 권한·보호·복구 계약을 보존하면서 transient 경합 후 등록이 완료되고 자기 fence가 정상 해제되는지 실제 native 프로세스로 검증한다. 그룹 삭제 전 재귀 사전 검사 중 관계없는 등록이 완료되는지 확인한다. wait/hold/state.read/state.commit 관측을 분리하고, 사용자 데이터를 복사하지 않은 같은 크기의 합성 상태로 분할 전후를 비교한다. 새 형식은 명시 전환만 허용하고 읽기 전용 접근·원자적 index commit·immutable bucket 무결성·미참조 상태 회수를 검증한다. 사용자는 “소스 구현·검증 후 별도 전환”을 선택했다. 실제 프로젝트 이관·실행기 교체는 이번 범위에서 실행하지 않는다.

## 구현·측정 현황

- native-r1: 고정한 엔진 개발 스냅샷 9,346파일/101,229,408bytes. 기존 동시 변경 위에 재획득/복구 retry·그룹 사전 검사 이동·timing을 통합. 전체 package181tests actual0, typecheck0/selection181/실행0. 실행 단계 약457.8초. adapter10tests actual0.
- native-r2: r1에서 state read/commit phase 관측과 그룹 preflight 회귀만 갱신한 고정 입력. 새 contention3tests actual0(typecheck0/selection3/execution0). payload 탐색 중 unrelated commit과 보존을 검증.
- 기존 installed standalone baseline: 일시 maintenance/catalog 경합 actual1, 동시 등록1/6성공. r1 후보의 동일 작은 fixture에서는 일시 경합 둘 다actual0, 동시 등록6/6성공. 병렬 시도 실패와 성공을 같은 처리량으로 비교하지 않는다. 두 후보 측정의 동시 완료는 각각약3.9초/2.3초이며 변동성을 포함한다.
- 실제 manifest를 읽기 전용 통계로 관찰:20,397,020bytes/items1312/groups581/runs77/decisions1457. 합성20MB/단일 seed/r2에서 두 동시 등록2/2성공, 합계약2.74초. state.commit median790,825us/max821,361us; maintenance hold max1,088,378us. 이는 데이터 분할의 근거이며 실물 프로젝트 지연 비중 측정은 아니다.
- 분할 설계: section별16 hash bucket(최대64 live blob), 작은 공용 index원자반영. 3천개 이상 per-record 파일을 매번 여는 대안은 배제. `partition_storage`는 exactSHA/stopproof/config·reservation·pending guard를 요구하며 구형decoder는revision형식으로 거절한다. 정상갱신은 이전index의 참조차이만 회수하고, 실패한prepare의 orphan은 동일 guard를 갖는 명시 `compact_storage`로 회수한다. 저장·GC실패를 성공으로 바꾸지 않는다.
- read-only review에서 발견한 unknown-format fallback 및 callback뒤index변경 위험을 fail-closed guard로 막았다. source-only 구현·Windows x64 검증을 마쳤으며 실제형식전환·설치는 하지 않았다.
- 최종 native-r4는 고정 입력 SHA `451a3444b363eda55e967ac339023e8707129d31542f481340e3e22ddd597c3f`에서 전체 200 tests 통과(typecheck/selection/execution 모두 actual0). 최초 준비부터 종료까지 약467초, 실제 실행 약441초. 분할 형식의 보호 revision 전용 pending 복구도 기존 제한을 보존하며 marker·blob 전체 입력을 최종 폐기 경계에 고정한다.
- 최종 20MB/1,312레코드 합성 비교는 같은 개발 실행기 SHA `34bac93948956dd151aaa7370e6943f19a7db10afb009b47c363c4faedd978fd`로 순차 실행했다. legacy→분할 state.commit median863,558→220,442us, 인덱스20,828,114→103,164bytes. 병렬2건 합계3,219→3,120ms로 차이가 작고, state.read median149,834→428,675us로 증가했다. 전체 처리량의 큰 개선이나 실물 지연 감소는 주장하지 않는다. 분할 전후 각각2/2성공, 최종 작은 경합6/6성공, 모든 fixture 제거 확인.
- 어댑터 최초9파일287검사에서285통과. 실패는 `pwsh` PATH 누락과 source-fixture 명시 root 누락에 따른 실제 공용 run-claim 경합이었다. 기존 설치 PowerShell7 경로와 격리 fixture root를 지정한 두 실패파일 재검증208검사 actual0. 소스 변경 없이 환경만 바로잡았다.
- 기존 미커밋 관리 모듈(복구·catalog·예약 계약) 위에 이번 변경이 의존한다. `lock_recovery.rs` 등의 초기 동시 변경과 안전하게 커밋을 분리해야 하며 임의로 전체 파일을 stage하지 않는다. 다른 세션이 통합을 맡았다고 가정하지 않는다. 엔진 배포 provenance 갱신·설치 수용은 별도 승인된 통합·전환 단계에서 수행해야 한다.

최소 독립 수용 근거는 [검증 결과](02-verification.json), [종료 근거](03-producer-stop.json), [주 묶음 정리](04-cleanup.json), [보조 묶음 정리](05-account-cleanup.json)에 남겼다. 지정된 최적화 standalone의 identity를 확인하고 두 그룹을 등록·fresh review·명시 delete·실제 부재 확인·finalize했다. logical 합계1,251,234,342bytes이며 실제 디스크 회수량은 측정하지 않았다. 기존 catalog 경합으로 막힌 검토는 보호를 유지한 채 실제 transaction 종료 후 새로 검토했다. 주 삭제가 첫10분 checkpoint를 넘겼으나 프로세스 I/O와 pending intent를 확인하고 같은 실행의 실제 종료를 기다렸으며 중복 실행하지 않았다. 모든 raw 로그·개발 스냅샷·검증 실행기·4개 임시 요청 파일은 삭제됐다. 정리 후에도 최종 native 소스·테스트12개 hash는 검증 입력과 일치한다. 기존 동시 변경을 포함시키지 않기 위해 stage/commit은 하지 않았다.

## 조사 당시 확인한 근거

- 실제 세션에서 catalog·maintenance·run-claim 잠금 경합 실패가 반복된다. 일반 프로젝트 파일별 잠금의 순환 대기는 아직 확인하지 못했다.
- 현행 lib.rs는 maintenance → 정렬된 catalog 순서로 try_lock한다. refresh_group만 최초 획득을 최대 5초 재시도하며 부분 획득은 재시도 전에 해제한다.
- registration.rs는 범위 예약 후 전역 잠금을 반환하고 측정한다. 이후 store.resume 및 catalog 재획득은 즉시 실패할 수 있다. 이때 durable 예약이 남아 명시적 복구가 필요할 수 있다.
- scripts/artifact-run.cjs는 run-claim을 얻은 상태에서 lifecycle 등록의 catalog 획득을 기다릴 수 있어 경합이 뒤 요청으로 전파된다. 해당 범위에서 역방향 순환 의존은 확인하지 못했다.

## 실제 경합과 판단 한계

가장 직접적인 근거는 [EI 정리 결과](../EI-01-engine-connection-investigation/10-followup-cleanup.json), [복구 근거](../EI-01-engine-connection-investigation/12-registration-recovery.json), [동일 작업 기록](../EI-01-engine-connection-investigation/01-plan.md)이다. 이 자료는 다른 세션이 계속 갱신하므로 이 조사는 읽은 시점의 내용만 근거로 삼는다.

- 2026-10-29 12:03 KST 부근 native register가 catalog 경합으로 실제 exit 1.
- 12:10 KST 부근 다음 등록이 maintenance 경합으로 실제 exit 1. 이미 만든 자기 등록 예약이 남아 복구가 필요했다.
- 12:12 KST 부근 예약 복구도 maintenance 경합으로 실패했다. 동일 작업 기록에는 다른 EK cleanup producer 경로와 PID를 확인한 근거가 있다.
- 세션 rollout에는 run-claim/catalog의 `lock wait exhausted after 5000 ms`, 테스트 준비 전 실패와 종료 reconcile 실패도 있다. UI의 모든 빨간 표시나 전체 지연이 같은 원인이라는 증거는 없다.

지정 standalone의 실제 SHA-256은 `9bc66314681460df3d6da3a9dc923eac52411e22d1fb595b08371477ac492a26`로 owner-installation.json과 일치했다. 설치 identity와 현행 소스 관측을 구분하며 전체 체크아웃을 그 실행파일의 고정 소스와 동일하다고 단정하지 않는다.

현재 소스에서 직접 확인한 owner:

- `project-maintenance/src/lib.rs:236`: refresh_group 외 최초 획득 대기 0; 부분 잠금 반환 후 재시도 구조는 이미 존재.
- `project-maintenance/src/registry.rs:37`: catalog 경로를 BTreeSet으로 정렬해 try_lock.
- `project-maintenance/src/registration.rs:104`: catalog와 maintenance 해제 후 측정. `:122`부터 maintenance 재획득 후 catalog 획득. 이 경로는 최초 획득 retry wrapper 밖이다.
- `project-maintenance/src/storage.rs:79`: resume의 즉시 획득 실패 가능성. `save`의 suspended transaction도 별도 try_lock이다.
- `project-maintenance/src/reservations.rs:1168`: 등록 예약 해제는 정확한 자기 예약과 maintenance/catalog 경계가 필요. 단순 OS handle 반환과 durable 예약 제거는 다르다.
- `scripts/artifact-run.cjs:71`: run-claim을 가진 채 recordLifecycle을 호출; `scripts/artifact-lifecycle.cjs:76`은 catalog를 최대 5초 기다린다. claim 경합으로 후속 시작에도 영향이 전파될 수 있다.

결론: 반복되는 관리 잠금 경합 및 실패→남은 예약→복구 경합은 확인했다. 조사한 경로에서 일반 프로젝트 파일 a/b 잠금의 상호 대기나 무한 OS 교착은 입증되지 않았다. try_lock의 실패 반환·bounded wait·획득 순서 때문에 이 증거만으로 교착이라고 부르면 부정확하다. 전체 시스템의 교착 부재를 증명한 것은 아니다. 실제 락 보유 시간, 전체 wait-for graph, 세션별 지연 비중은 미측정이다. 프로세스 목록의 한 시점에 관련 실행이 없었으나 이를 잠금 해제 또는 종료 트리 검증으로 사용하지 않았다.

## 해결 제안과 선택

권장 범위는 관리 잠금과 그 호출자다. 일반 파일 편집 잠금 시스템 신설은 현재 증거로 권장하지 않는다.

1. **일관된 순서·부분 획득 반환**: 기존 native 순서를 유지하고 Node/PowerShell 및 run-claim 호출자까지 획득 관계를 점검한다. 다음 잠금이 막히면 임시 관리 잠금을 반환하고 전체 세트를 다시 획득한다. 이미 적용된 refresh 경로를 재사용하되 새 대기는 실제 변경 전 획득 경계에 한정한다.
2. **측정 후 재획득 개선**: 등록의 resume/catalog 재획득을 하나의 안전한 획득 단위로 만든다. 실패 시 부분 handle을 반환하고 새 manifest·권한·source fence·revision을 재검증한다. 성공한 측정 재사용은 보호 범위와 입력 identity가 계속 유효할 때만 허용한다. 저장 시도 뒤 결과 불명확 상태에서 전체 등록·삭제를 자동 재실행하지 않는다.
3. **프로젝트별 공정한 진입 조정**: 여러 세션이 공유하는 ticket 대기열로 짧은 관리 transaction의 획득을 조정한다. 안정적인 요청 순서 ticket을 재시도에도 유지한다. 긴 측정·물리 삭제 동안에는 전역 transaction을 반환하고 기존 범위 예약으로 보호한다. 전체 세션이나 장시간 작업 전체를 직렬화하는 제안이 아니다. 기존 standalone lease owner를 확장하는 안을 우선 검토하고 새 서비스 필요성을 별도로 평가한다. 모든 Node/native/PowerShell 진입이 협조해야 공정성을 주장할 수 있다.
4. **안전한 취소·마감과 관측**: 실행 종료 기록·자기 예약 정리의 경합이 원래 실제 결과를 잃게 하지 않도록 상태별 완료/abort를 제공한다. 불명확 저장·실행 결과는 보호한다. 작업/세션 ID, 요청 ticket, 잠금 경로, holder, 보유 목록, 대기 대상·시각, commit 단계와 outcome을 기존 로그에 연결해 실제 순환 대기와 단순 혼잡을 구별한다. 로그 파일의 존재를 점유 근거로 사용하지 않는다.

사용자의 우선순위 양보안은 **안전하게 중단 가능한 관리 transaction**에는 타당한 방향이다. 다만 세션 전체의 모든 잠금을 반환하면 진행 중 빌드 캐시·삭제 범위와 별도 작업까지 보호를 잃는다. 오래된 세션을 영구 우대하면 새 요청의 기아가 생길 수 있으므로 기본값은 세션 생성 시각보다 관리 요청 순서가 적절하다. 우선순위 방식만으로 순환 대기를 방지하려면 모든 의존 관계에 일관된 순서를 적용하고 낮은 순위 transaction이 확실하게 abort 가능한 계약이 있어야 한다. 임의의 보호 예약 삭제는 그 계약을 대신하지 못한다.

단기 운영 대안은 같은 프로젝트의 등록·정리·복구 관리 작업을 명시적으로 인계해 순차 실행하는 것이다. 읽기 전용 조사와 독립 구현은 계속 진행할 수 있다. 다른 세션 중단·잠금 파일 삭제·보호 예약 임의 해제는 제안하지 않는다. 이번 작업에서는 실행하지 않았다.

## 조사에서 도출한 검증 경계

`testing` 지침에 따라 조사에서 도출한 경계다. 이후 승인된 실제 검증 결과는 위 구현 현황과 최종 검증 기록에 구분한다.

- 두 실제 프로세스의 A/B 경합과 부분 획득 실패에서 보호를 유지하며 최종 진행하는지 확인.
- 긴 등록 측정 중 관계없는 작업이 commit한 뒤 원래 등록이 재획득하고 새 revision을 보존하는지 확인.
- 등록 재획득·abort 마감 경합에서 불필요한 예약이 남지 않고, 불명확 저장 상태는 보호하는지 확인.
- run-claim/catalog 혼잡에서 테스트 준비 및 실제 종료 결과가 유실되지 않는지 확인.
- 동일 ticket 재시도·취소·소유자 비정상 종료·신규 요청의 진행을 검증. 공정성은 진입 순서와 보유 시간 조건을 명시한다.
- 공통 변경의 Windows 회귀와 Linux/macOS의 실제 OS 잠금 검증을 구분한다. 기존 보호/권한/unknown 결과 계약을 약화시키지 않는다.

초기 조사는 소스·관련 실패/복구 기록 대조와 설치 실행파일 hash 확인으로 진행했다. 이후 승인된 소스 변경·합성 재현·개발 실행기 검증은 위 구현 현황에 기록했다. 전체 잠금 graph나 실물 프로젝트의 지연 비중은 여전히 측정하지 않았다. 계획 입력용 임시 파일은 일반 삭제 후 Test-Path=False를 확인했고 검증 run 산출물도 소유자 경계로 정리했다.

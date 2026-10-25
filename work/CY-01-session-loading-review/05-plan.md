상태: 빌드·12회 비교·무결성/종료 검증 및 승인된 정리 완료. 정확히 `artifacts/c3`만 관리 경로에 추가했고 두 실험 root와 정리용 control run의 실제 부재·producer finalize를 확인했다. 설치본 변경 없음.

# 최적화 빌드 세션 복원 비교

## 목표·권한·검증 범위

현재 설치된 Azrael 2026.0.12와 동일한 frozen source·Cargo package·feature·Windows x64 MSVC target에서 `--release` 빌드의 복원 시간을 비교한다. 사용자는 이번 빌드와 격리 프로필 시험을 명시적으로 요청했다. 설치·배포·코드/권한 변경·원본 세션 실행·model turn/tool 실행은 하지 않는다. Windows에서만 실측하며 Linux/macOS와 UI 첫 paint 수용으로 확대하지 않는다.

현재 설치본 `w13r-99afefb1` hash와 frozen source identity를 재검증하고 전체 source를 새 소유 경계에 복사·고정한다. 기존 source/설치본을 변경하지 않는다. 프로젝트의 기존 release profile(thin LTO, codegen-units 4)을 사용하고 dev 대비 임의 feature 축소는 하지 않는다. 기존 code-mode host를 hash 고정해 같은 번들로 사용한다. build와 복원 측정 시간은 분리한다.

## 실행·자원·소유

소유자 `CY-01-session-loading-review`, group `CY-01-release-comparison-r3`의 예정 member는 `artifacts/tasks/CY-01-session-loading-review/runs/20261025-release-comparison-r3`(프로필·보고·로그)와 `artifacts/c3`(짧은 source·Cargo cache·임시 engine bundle)이다. producer/native 상하위 claim 충돌은 확인되지 않았다. 최초 lifecycle 등록은 occupied catalog.lock에 의해 EEXIST로 거절됐으며 payload를 아직 생성하지 않았다. 잠금을 우회하거나 다른 작업을 종료하지 않는다.

기존 `engine/codex-rs/target`은 다른 작업의 lease가 있어 사용하지 않는다. release artifact도 없으므로 별도 release cache의 중복 release compilation 비용은 없다. 초기 가용 RAM 약 2.1GB, C: 여유 약 27.7GB로 확인돼 jobs 1을 우선 선택하고 실제 자원을 재확인한다. source/cache/temp를 짧은 프로젝트 내부 `artifacts/c3`에 둔다. 공유 cache·원본 source·기타 작업을 정리하지 않는다. 정확한 lease owner와 stable tool inputs를 고정하고 실제 Cargo terminal 결과를 관찰한다.

## 비교 방법과 성공 기준

1. 최신 source/installed binary provenance와 toolchain·offline dependency·native Windows 준비를 작은 실행으로 확인한다. 공통 helper의 Cargo target owner를 적용해 engine 및 bridge를 build한다. installed bundle과 동일 package/target/no-default-features를 유지한다.
2. 이전 사본은 이미 삭제됐으므로 원본을 다시 읽기 전용으로 target-only SQLite/rollout seed로 고정한다. global 완료 marker를 보존하고 queue/accepted input/goal/root resume 자동 작업·credentials는 사본에 넣지 않는다. source 안정성과 각 DB quick_check를 확인한다. 이전 441MB 입력과 같은 hash인지 기록하되 직접 비교는 이번 고정 seed에서 다시 측정한 dev와 release 사이에 한다.
3. 로그인·외부 연결·turn/tool 시작을 차단한 격리 프로젝트에서 설치 dev/release 각각 새 엔진 3회 이상을 번갈아 측정한다. compile 종료 후 성능 측정을 시작한다. OS cache는 warmed 조건으로 통일한다. initialize, metadata, cold/warm resume, 전체 로더 trace, recent turns/items를 비교하고 중첩 span은 합산하지 않는다. 동일 페이지·질문·승인 상태의 요약 hash를 비교한다.
4. 엔진 실제 exit, 예상 밖 turn/server request, 프로세스 잔여를 확인한다. phase 중앙값·범위·개선율·CPU/메모리와 입력/build identity를 작은 독립 증거로 보존한다. source와 runtime before/after hash로 변경이 없음을 확인한다. 실패·시간 제한·모호한 결과는 성공으로 바꾸지 않는다.
5. 프로필·source·build cache·일회성 script·raw logs는 진단 뒤 native review/apply로 정리하고 실제 결과·finalize를 확인한다. 최적화 엔진은 설치용으로 보존하지 않는다. 필요한 비교 증거만 work에 남기고 task commit에 이번 문서/증거만 포함한다.

성능 개선 폭은 실제 실행 후 보고한다. 빌드 실패 또는 자원 부족이면 정확한 원인과 남은 검증을 기록하며 임의 profile/기능 변경으로 성공을 만들지 않는다.

### 실험용 빌드 보정 범위

attempt2는 09:57:13–10:17:36 UTC, Cargo exit101·driver1로 실패했다. 원인은 메모리나 디스크가 아니라 thin `azrael` crate의 최적화 layout query가 기본 재귀 한도128을 넘은 것이다. 컴파일러가 권고한 `#![recursion_limit = "256"]`는 인접 lib.rs와 main.rs에서 이미 사용한다. 이 attribute 한 줄만 실험용 `artifacts/c3/engine/codex-rs/app-server/src/bin/azrael.rs`에 적용한다. 기존 설치본·작업 source와 기능·권한·feature는 바꾸지 않는다. 이는 요청된 최적화 빌드를 위한 컴파일 설정 보정이며, 원본과 byte-identical source라고 보고하지 않는다.

고정한 설치 source의 이전 snapshot은 유지하고, 기존 `record-engine-local-changes.py`로 정확히 한 경로의 추가 delta를 기록한다. 원본 import는 Git에 보존된 일치 receipt의 commit `ccbcbf93906a72cc7654aa9c57c670d5e2e3831d`에서 소유 경계 안에 재구성한다. 별도 내부 Git repository에 설치 source를 capture하여 기존 `engine` prefix와 mode를 유지하고, 신규 receipt/snapshot을 빌드 입력으로 고정한다. 실패한 두 시도는 원래 결과 그대로 보존하며 정상 해제된 동일 cache에서 의존성 산출물을 재사용한다.

보정 준비는 실제 실패를 포함했다. archive의 긴 경로 구분자 오류 후 수동 materialization으로 전환했고, 첫 archive 추출이 만든 LICENSE symlink 때문에 이어진 placeholder 쓰기가 자기 소유 COPYING을 덮어쓴 사실을 검출했다. 원본 archive commit에는 receipt 밖 timing 파일 및 아직 기록되지 않은 source 차이도 있었다. 자기 소유 기록용 사본에 한해 여분 경로를 제거하고, receipt에 일치하는 installed bytes 또는 과거 Git bytes를 SHA256으로 찾아 8개 descriptor를 복구했다. 원본/설치/작업 source를 수정한 것이 아니다. 전체 baseline 검증과 supported receipt writer 및 신규 snapshot은 최종 exit0으로 통과했다. 실제 빌드 입력은 정확히 진입점 attribute만 다른 9,310개이며 SHA `98ed14f71849de4651439fb32e18d6d152ba1395a6549802608440a4756ed1d7`, buildEnvironment는 기존 snapshot과 동일하다. reports/limit-fix.json이 delta 증거다.

attempt3는 새 report build-r3.json, logs *-r3.*, runtime completion `3f16b004-ba2f-409a-8998-4068cdd2c4c5`, session98779로 시작했다. jobs3·release·package/target/features와 별도 target은 유지한다. 수정된 source identity를 source-release-before.json으로 고정하고 record/verify까지 실제 통과해야 비교 실행을 허용한다. 첫 확인 시점은 약15분이며 완료 event가 먼저 오면 측정을 시작한다.

10:50 UTC checkpoint에서 attempt3는 실제 running이다. 재귀 한도 오류 없이 `azrael` 최종 opt-level3/thin-LTO 컴파일에 진입했으며 해당 rustc는 CPU 누적 약2,547초, working set 약6.18GB다. free RAM 약6.5GiB·virtual 약12GiB·disk 약24.5GB로 관찰됐다. 다른 작업의 cargo check도 있어 그 실행은 건드리지 않는다. 아직 성공이나 성능 결과로 해석하지 않으며 다음 확인은 약20분 후다. 비교에는 host compiler 관측도 기록한다.

attempt3는 11:08:41 UTC 실제 성공으로 종료했다. engine/bridge Cargo exit0(약1,999.7초), provenance record0(94.9초), verify0(14.3초), driver0이며 자기 target lease가 해제됐다. release engine SHA `2c76d6d7badabe9decd69aac6a57dd3cad6ce84d35b7d37fc196a844fcc59597`다. build wall time은 복원 비교에 합산하지 않는다.

11:09 UTC에 completion `cc3f9618-3274-4322-8564-cd99c0d24565`, session83246으로 release readiness → dev1/release1/release2/dev2/dev3/release3 비교를 시작했다. host에는 다른 cargo/rustc가 관찰되며 해당 작업을 중지하지 않는다. 각 run 전후 compiler CPU/RSS를 기록하여 결과의 잡음과 한계를 판단한다. 시작 시 디스크 약8.69GB로, 예정된 6개 사본 약2.65GB와 여유를 확보했다. 예상 실행은 수 분이며 실제 engine exit와 읽기 결과 동일성을 확인한 뒤 해석한다.

1차 cohort는 11:12:14 UTC 모두 exit0으로 끝났다. cold resume 중앙값 dev17.61초/release4.49초, full read/decode16.07초/3.10초이고 readback hash가 모두 일치했다. 다만 dev1 initialize28.8초와 release1 initialize13.6초 등 큰 변동 및 다른 rustc의 CPU·메모리 사용이 확인돼 무부하 결과로 해석하지 않는다. 원본 결과는 first-comparison-evidence.json으로 보존하고, 부하가 낮아진 조건에서 추가 3회씩 같은 순서로 재측정한다.

추가 실행 시 free disk가 약3.55GB로 줄어 새 rollout 6개 복사를 피한다. engine exit0이 확인된 자기 소유 프로필의 rollout 하나를 새 프로필로 순차 이동하며 각 실행 전후 SHA256이 원래 seed와 같은지 검증한다. DB·프로필·engine process는 매번 새로 준비하며 원본/seed에는 쓰지 않는다. 모든 경로는 기존 group 안이다. 입력 변경이나 미종료가 있으면 재사용을 거부한다. 기존 warm-cache 조건을 유지하며 RPC 시간 밖에서 해시를 검사한다. 신규 completion `9d77706e-fc9e-4d1b-ae01-5d3e3d639ace`로 별도 cohort 결과를 남긴다.

추가 cohort 첫 준비는 SHA 불일치로 engine 시작 전 exit1이었다. 이미 복원한 사본에는 엔진이 메타데이터를 append하므로 전체 해시가 바뀐다는 사실을 검출했다. 이전 계획의 “복원 후에도 전체 해시 동일” 가정을 철회한다. 실패는 comparison-run-q.json/runner stderr에 남긴다. 새 시도는 먼저 기존 사본의 원본 길이 구간 SHA가 seed와 같은지 확인하고, 동일 seed로 사본 전체를 덮어써 입력을 초기화한 뒤 새 프로필로 이동한다. 실행 후 append 크기·전체 SHA와 원본 구간 SHA를 각각 기록하며 원본 구간 변경이면 실패한다. 원본/seed는 여전히 읽기 전용이며 RPC 밖에서 복사·해시한다. 새 completion `da4c9d75-93bd-4d59-b42b-acf8b2a82662`로 u cohort를 구분한다.

## 실측 결과와 판단

추가 cohort는 11:15:29–11:17:29 UTC에 모두 exit0으로 종료했다. 각 run 전후 cargo/rustc 관측은 0이었지만 호스트의 모든 부하를 측정한 것은 아니다. 아래 값은 같은 441,373,260-byte seed, 매번 새 engine·프로필, OS file cache warmed 조건의 각 3회 중앙값이다. RPC 밖의 사본 준비·해시·빌드 시간은 포함하지 않는다.

| 단계 | 설치 dev | 실험 release | 감소 |
| --- | ---: | ---: | ---: |
| 최초 복원 RPC | 15.256초 | 3.932초 | 74.23% (3.88배) |
| 전체 rollout 읽기·역직렬화 | 14.592초 | 2.997초 | 79.46% (4.87배) |
| warm resume | 12.530ms | 6.264ms | 50.01% |
| 최근20턴 | 7.284ms | 4.110ms | 43.58% |
| 최근 항목 | 4.094ms | 1.795ms | 56.15% |

최초 복원 범위는 dev15.156–15.657초, release3.408–8.910초다. release 한 번에 full loader 뒤 약5.77초가 소요되는 outlier가 있어 모든 복원이 4초 안에 끝난다고 일반화하지 않는다. full loader 자체는 release2.979–3.498초로 비교적 안정적이다. cold CPU 중앙값은 dev15.141초/release3.438초, peak working set 중앙값은 약720.8MB/607.4MB다. 1차 cohort에서도 cold resume17.613→4.485초(74.53% 감소)로 방향과 개선율이 일치했다. 서로 다른 시점의 이전22.7초 baseline과 직접 배율을 만들지 않는다.

총12회 모두 full load는1회·164,704행·parse error0이며, 최근20턴/최신 턴 항목의 canonical hash, model/provider/approval mode, pending 질문·승인 수 및 빈 queue readback이 일치했다. 추가6회 모두 시작 입력 hash와 종료 뒤 원본 길이 구간 hash가 같고 엔진이 append한 메타데이터는2,322/2,330 bytes로 별도 기록했다. 14개 engine(readiness2+측정12)이 모두 실제 exit0·강제 shutdown0·turn 시작0·server request0이었다. 마지막 검증에서 소유 경계/기록 engine identity의 현재 실행 일치0, Cargo lease 없음, 설치/실험 binary hash unchanged를 확인했다. 처음 종료 검증은 이전 JSON의 BOM을 읽지 못해 증거 생성 전 실패했고 BOM-aware read로 보정 후 실제 exit0으로 통과했다.

결론: 기존 release profile은 이번 복원 CPU 비용을 크게 줄인다. 배포 빌드의 release 기본화를 검토할 근거는 확보됐으나 설치·서명·업데이트·UI·로그인 환경 수용을 완료한 것은 아니다. 추가 성능 개선의 남은 주요 대상은 약3초의 전체 JSONL 읽기/역직렬화다. 다음 설계 후보는 복원 snapshot과 tail replay이며, 별도 승인·보존 계약·오류 복구 검증을 거쳐야 한다. 이번에는 구현하지 않았다.

## 종료 근거와 정리

최종 결과: 사용자 승인 후 기존 owner retirement 절차로 실험 두 root의 논리 크기 **14,345,477,879 bytes(14.35GB)**를 삭제했다. owner apply는 12:27:34–12:40:32 UTC 실제 exit0(778.118초), 두 member 모두 `deleted / remaining=false / aborted=false`였다. 별도 실제 경로 부재 확인과 `CY-01-release-comparison-r3` finalize도 exit0으로 통과했다. 정리용 실행기·요청·raw logs 1,298,031 bytes도 fresh native register/review/apply로 삭제(`deleted / remaining=false`)하고 실제 경로 부재 및 `CY-01-release-cleanup-r4` finalize를 exit0으로 확인했다. 물리 회수 바이트는 측정하지 않았다. 현재 완료 근거는 `10-release-cleanup-evidence.json`, 불변 종료 증거는 `11-release-cleanup-stop.json`이다. 아래 차단·대기 기록은 해결 전 이력이며 현재 미완료 항목이 아니다.

최종 검증 exit0: configuration은 기존 HEAD 대비 `artifacts/c3` 한 항목 외 의미 변경이 없고 JSON이 유효하다. 설치 binary SHA, 불변08/11 및 protected retirement evidence SHA가 일치하며 실험/정리 세 root 모두 부재다. 비교 보고서07의 cleanup 외 성능·실패·한계 필드는 이전 commit과 동일하다. 기존 staged4개 source-test blob과 scoped `git diff --check`도 통과했다. raw-byte 증거11은08과 같이 `.gitattributes`의 `-text`로 보존한다. 제품 코드 변경이 없어 성능 실험·빌드는 재실행하지 않았다.

사용자가 후속으로 “네 추가해 정리해도 됩니다”라고 승인했다. 승인 범위는 `project-maintenance.json`의 managed_roots에 정확히 `artifacts/c3` 한 경로를 추가하고 기존 두 member를 fresh review/apply로 정리하는 것이다. 공통 configuration의 경로 경계만 좁게 확장하며 실제 검증·삭제 환경은 Windows x64다. 기존 producer 종료·출처·비교 근거는 유지하고, 이후 새 consumer나 membership 변경은 native 검토로 확인한다. source·binary·profile을 다시 생성하지 않고 payload 내용 재해시 없이 registered 검증을 사용한다. 실제 삭제와 잔여0 및 producer finalize까지 통과해야 정리 완료로 기록한다.

경로 추가 후 일반 native review는 루트 자체 보호(`managed root itself is protected; select owned descendants`)를 확인했다. 앞서 추가만으로 충분하다고 안내한 판단을 수정한다. 그룹의 live member를 임의로 나누거나 정책을 더 넓히지 않는다. [프로젝트 관리 운영](../../docs/ops/project-maintenance.md#관리-경계-자체의-수명-종료)의 기존 `maintenance_owner`/`retire_managed_roots` 절차를 적용한다. 이는 승인된 관리 경계 폐기만 명시하는 지원 경로이며 나머지 권한·소유·참조·토큰 검사를 유지한다.

실행기는 기존 DM-01 검증 run의 `outputs/maintenance_owner-fast.exe`를 고정 복사해 재사용한다. pin SHA `b68096420d3acb1a3890761da612c63f4fd632fe5145978162407d1e2cb31db3`, 같은 고정 cache의 native103 검증 exit0(87.049초) 및 owner build exit0(21.030초)와 일치하는 receipt를 확인했다. 공용 target의 현재 다른 binary를 사용하거나 재빌드하지 않는다. 새 control run `artifacts/tasks/CY-01-session-loading-review/runs/20261025-cleanup-r4`는 `CY-01-release-cleanup-r4` owner group에 생성 전에 등록했다. 바이너리 사본·요청·결과·로그는 이 run 안에 두고 완료 후 별도로 정리한다. 폐기 토큰용 작은 control 증거는 문서가 요구하는 `artifacts/maintenance/evidence/CY-01-release-retirement.json`에 이 작업 owner와 보존 근거를 명시해 보존한다. 삭제 대상 밖의 protected control evidence이며 추가 실험 자료를 보관하는 용도로 쓰지 않는다.

owner review는 12:26:36–12:26:53 UTC 실제 exit0(17.646초)으로 끝났다. 전체2개 member의 blocker가 비었고 identity·registered 검증·membership 일치가 유지됐다. 같은 retirement descriptor와 새로운 per-item token으로 모두 delete 결정했다. apply는 completion `841cd870-57d4-45b4-bbaa-b02540a9dbf2`로 실제 성공을 관찰했으며 정확한 두 경계 외에는 선택하지 않았다. 실제 apply exit와 각 status/remaining 확인 뒤 producer finalize 및 작은 control run 정리도 완료했다.

apply 시작은12:27:34 UTC다. 12:36 checkpoint에서 owner PID70040와 그 삭제 PowerShell child26240(12:29:20 시작)이 살아 있고 CPU 누적은 각각101.5초/405.7초였다. 당시 stdout/stderr는0 bytes이고 완료 신호는running이어서 중복 삭제/scan 없이 기다렸다. 이후 12:40:32 UTC 실제 exit0과 삭제 결과를 확인했다.

비교·실패·재시도·입력 delta·한계를 `07-release-comparison-evidence.json`에 보존했고, 불변 종료/바이너리 근거는 `08-release-producer-stop.json`이다. 일회성 테스트·프로필·빌드 cache·source·raw logs는 이 근거 보존 뒤 두 소유 root 전체를 같은 delete fate로 정리한다. lifecycle close가 occupied catalog.lock의 EEXIST로 거절돼 잠금을 건드리지 않고 deletion event를 기다리는 단일 watcher(session79122, completion `4b6ace62-43ce-4895-a979-1b0e5d5b10dc`)를 실행했다. close/register-request 준비가 실제 종료하면 native register→review→apply→remaining 확인→producer finalize를 순서대로 진행한다.

종료 근거는 raw-byte SHA256으로 연결되므로 이 작업 폴더의 `.gitattributes`에 새 `08-release-producer-stop.json`만 `-text`로 지정했다. Windows autocrlf가 향후 checkout에서 불변 근거 바이트를 바꾸지 않게 하며, Git blob과 기록 hash가 일치함을 확인했다. 기존 문서나 전역 Git 설정은 변경하지 않았다. 다른 작업의 기존 staged4개 source-test blob을 독립 비교 증거에 기록해 task commit 전후 보존을 확인한다.

catalog 반납 후 첫 close watcher는 필수 evidence_sha256 누락으로 exit1이었다. 증거 바이트를 변경하지 않고 독립 기록 hash를 명시해 재실행했으며 실제 exit0·revision2·state complete·membership complete·references0으로 close했다. 첫 native register는 별도 `artifacts/maintenance/maintenance.lock` 점유로 dispatch 단계에서 거절됐다. lock에 기록된 PID73132는 현재 shared app-server로 관찰돼 이를 stale로 간주하거나 제거하지 않는다. 단일 event waiter(completion `323dc242-cf90-4a5c-9d48-cc4ad34a246b`)가 실제 삭제 event를 기다리며 lock을 변경하지 않는다. native 등록·측정 자체가 완료됐다고 보고하지 않는다.

native lock은 11:27:33 UTC 실제 반납됐고 waiter는 exit0으로 끝났다. 후속 native 등록은 성공했으며 두 member의 논리 크기는 run4,923,078,463 bytes, c3 9,422,399,416 bytes, 합계 **14,345,477,879 bytes(14.35GB)**다. registered review는 membership 일치·observation error null을 확인했지만 `artifacts/c3`가 `outside configured managed roots`라 전체 group을 보호했다. 경로 선택 시 managed_roots를 놓친 준비상의 오류다. native 삭제를 실행하거나 수동 삭제로 전환하지 않았다.

기존 relocateCustody는 legacy `artifacts/logs/` 전용이라 이번 경계에 적용할 수 없다. 승인된 실험은 관리 정책 변경을 포함하지 않으므로 allowlist를 임의 확장하지 않았다. 최신 두 review token에 같은 defer fate·구체적 재검토 조건을 적용했으며 tool은 group/member 모두 deferred·remaining true·aborted false로 반환했다. 원본/설치본과 다른 작업 자료는 그대로다. 근거는 `09-release-cleanup-decision.json`에 보존했다. 모든 payload가 남아 있어 finalize하지 않았다. 후속 결정은 `project-maintenance.json`에 정확히 `artifacts/c3`만 관리 경로로 추가하도록 승인한 뒤 fresh group review/apply·실제 부재·finalize를 확인하는 것이다. 필요 없는 일회성 자료도 현재 정책 차단으로 보존 중이며 자동 완료로 보고하지 않는다.

## 준비 확인과 대기

Rust/Cargo 1.95.0과 MSVC 14.51.36231, Visual Studio CMake·Git Perl의 설치를 확인했다. 기본 PATH에는 Cargo가 없어 설치 경로를 build process PATH에 고정했고 MSVC는 기존 platform discovery를 사용한다. 도구를 새로 설치하지 않는다. native PTY preflight는 같은 release profile·target·cache에서 기존 `runWindowsNativeTests`를 통해 실행한 뒤 engine build로 진행한다. 그 결과는 아직 없다.

현재 공용 catalog.lock은 08:28:26 UTC 생성됐다. 단일 등록 producer(session 28283, runtime work `9c99ea87-a2e4-4529-b62c-5e88d08ae01e`)가 실제 잠금 삭제 event를 기다려 등록을 재시도하며, 성공·실패를 completion signal에 기록한다. 6시간 제한 동안 잠금을 변경하지 않는다. payload·빌드는 아직 시작하지 않았다. 등록 성공 후 source 복사·provenance 확인과 native preflight를 시작한다.

등록 producer는 exit 0으로 종료해 revision 1을 생성했다. 준비 script의 첫 시도는 project 부모 경로 계산 오류로 생성 전 실패했고 다음 시도는 Windows 긴 경로 복사 제약으로 일부 source 복사 후 실패했다. 자기 소유의 미완성 사본을 긴 경로 지원으로 완성했으며, 설치 receipt와 **전체 source 9,310개·SHA e92cb876386681e02c9eb106279f19c93974c0838ec44fc699d725e28e8ce397 및 build environment가 일치**함을 확인했다. 제품 코드는 수정하지 않았다.

fixture 준비도 exit 0으로 완료됐다. 현재 rollout은 이전 실험과 동일한 441,373,260 bytes·164,704행·SHA160570334ef7b724ae4408413b7d8c7c20a4d6d5d896fe494abf4a915c5f7409이며 모든 DB quick_check가 ok다. global 완료 marker를 처음부터 보존했다.

고정 입력으로 `build-driver.cjs`를 시작했다. runtime completion은 `c08b7f2e-172e-4a30-990c-531c70583869`이며 native release PTY preflight → engine/bridge release build → before/after provenance record/verify를 순서대로 실행한다. 각 실제 command·exit·duration·PID는 run reports/build.json, raw output은 logs에 남긴다. jobs1, 별도 target, temp와 pending 모두 artifacts/c3 안이다. 실제 terminal 결과 전에는 빌드 성공으로 해석하지 않는다. 초기 확인 시점은 시작 후 약 15분이며 완료 시간의 상한은 확정하지 않는다.

빌드 시작은 08:43:58 UTC다. 격리 실행기의 installed dev initialize readiness는 약 452ms, engine exit 0·unexpected turn 0으로 통과했다. 비교 순서는 dev1 → release1 → release2 → dev2 → dev3 → release3으로 준비했다. recent turns/items의 canonical hash와 모델/provider/approval mode 및 pending 질문·승인 수·빈 queue를 비교한다. 모든 내부 reducer 상태의 exhaustive 동등성 검증으로 확대하지 않는다. analyzer/cohort script syntax 확인도 exit 0이다. 원본 프로필·설치본과 모델 turn/tool은 실행하지 않았다.

첫 15분 checkpoint에서 native wrapper는 typeCheck·compile·9-test selection·runtime 모두 exit0으로 끝났지만 Python을 찾지 못해 7개 case가 실제 검증을 생략한 사실을 확인했다. 이 결과는 충분한 native 검증으로 수용하지 않았다. 이미 08:46:57에 시작된 release engine compilation은 유지했고, 새 artifact를 만들지 않고 동일한 고정 libtest를 Python PATH 보정 후 Cargo job 밖에서 재실행했다. 테스트 exe SHA256은 전후 모두 `9aac1a586d0d90f575ff606b8ac4400663cd9e05e30752b23dd4243aa1e51ede`, 09:01:02–09:01:24 UTC에 9개를 선택·실행해 9 passed·skip message0·exit0으로 통과했다. reports/pty-corrected.json이 실제 증거이며 cohort는 이 결과도 필수 전제로 검사한다. 전체 helper나 제품 코드는 변경하지 않았다. 다음 build checkpoint는 약20분 뒤이며 terminal event가 먼저 오면 즉시 후속 측정을 시작한다.

09:23 UTC checkpoint: release dependencies compile 로그가 진행 중이고 terminal signal은 아직 running이다. 최신 free disk는 약39.3GB, free physical memory는 약10.1GB로 관찰됐다. 입력·profile·feature·jobs는 실행 중 변경하지 않았으며 build 재시작은 없다. 다음 checkpoint는 약30분 후로 잡되 실제 완료 event를 우선한다.

09:54 UTC checkpoint에도 dependencies compilation이 진행됐고 free RAM 약9.9GB·virtual 약16.2GB·disk 약38.6GB였다. 초기 약2GB RAM 때문에 선택한 jobs1이 현재 자원에 비해 직렬 대기를 만들고 있어 재개 병렬도를3으로 조정했다. 정확한 기존 driver command/work ID·프로세스 생성 시각·자식 관계와 `artifacts/c3/target` 출력 경로를 확인해 자기 소유의 leaf rustc 하나만 중단했다. Cargo의 실제101, wrapper/driver의 실제1, lease 정상 해제·해당 cache compiler 잔여0을 확인했다. 첫 시도를 성공으로 바꾸지 않았으며 reports/build.json과 retry-stop-request.json에 보존했다.

동일 frozen source·target·release profile·package/features·cache를 유지한 별도 attempt2를 시작했다. 변경은 resource scheduling jobs3이며 완료된 Cargo artifact는 그대로 재사용한다. 새 script·logs·reports/build-r2.json과 runtime completion `be78a309-c1cf-4d58-a0e0-67a294350d43`로 이전 시도와 구분한다. 검증된 동일 release PTY artifact의9/9 실제 결과는 재사용하고 engine/provenance 단계만 재개한다. 이 resource 조정은 비교할 제품 동작이나 설치를 변경하지 않는다. 다음 checkpoint는 약20분 후다.

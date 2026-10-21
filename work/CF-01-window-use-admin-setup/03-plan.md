# Windows 자식 세션 자동 소유 연결 복구

상태: 자동 소유 연결 복구의 소스 검증과 Windows x64 제품 빌드 u23h를 완료했다. 사용자 요청으로 후속 검증을 중지했으며, 격리 프로필 설치·실사용 시험은 미완료다. 현재 후속 범위는 실행 기록의 시간 분석과 최적화 제안이며 검사·빌드를 재개하지 않는다.

## 검사 시간 분석과 최적화 제안

분석 범위는 기존 실행 기록의 읽기와 개선안 제시다. 중지한 검사·빌드·설치를 재개하거나 최적화 코드를 구현하지 않는다. 시간은 Windows x64 실행 로그의 wall time이며 한국 시각으로 표시한다. 최초 준비 producer의 기록이 시작되는 2026-10-19 14:26:11.874부터 취소 정리 완료 20:39:10.806까지 6시간 12분 59초다. 그 이전 대화·초기 조사 시간은 이 합계에 포함하지 않았다.

| 중복 없는 실행 구간 | 소요 | 상태 |
| --- | ---: | --- |
| 14:26:12–17:00:41 입력 준비·오류 수정·사전/소스 회귀 | 2시간 34분 29초 | 여러 실패와 수정 후 통과 |
| 17:00:41–17:23:24 u23h 제품 빌드 | 22분 44초 | actual exit 0 |
| 17:23:24–20:39:11 빌드 후 검증·병행 패키지 준비·취소 정리 | 3시간 15분 46초 | 최종 검증·패키지 준비 중단 |

빌드 전 구간의 세부 집계는 입력 고정 c–h 6회 59분 24초, engine source 사전 검사와 PTY 누계 19분 7초, 전체 소스/확장 회귀 외부 명령 3회 38분 17초, 나머지 진단·수정·환경 준비·전환 간격 약 37분 41초다. 마지막 값은 다른 측정 구간을 제외한 잔여이며 코딩·순수 대기·CPU 시간으로 분리할 증거는 없다. 전체 회귀 3회의 외부 명령 시간은 e2 15분, g 11분 20초, h 11분 57초다. g에서 통과한 스크립트 검사 1,525개를 h의 확장 테스트 경로 한 파일 보정 후 다시 실행한 명령은 10분 38초였다.

입력 고정 6회의 내부 capture 계측 합계는 약 33분이며 파일 복사 21분 47초, Git metadata 5분 20초, inventory 4분 43초, final hash 1분 10초다. 전체 고정 시간과의 차이 약 26분 24초에는 외부 입력 복사·추가 검증·정식 receipt 기록 등이 섞여 있어 세부 분리하지 않았다. 매번 약 24,564개 파일/475 MB와 별도 외부 입력을 준비했다.

제품 빌드의 engine-build 상위 단계 15분 30초에는 Rust engine/bridge Cargo 실행 12분 35초, source snapshot 1분 35초, provenance 기록 약 1분 20초가 포함된다. companion staging/build 4분 32초, release packaging/copy 28초, computer-use/native staging 1분 20초, 기타 확인 약 54초로 전체 약 22분 44초다. 상위 단계와 그 하위 명령을 다시 합산하지 않는다. 근거는 run의 각 `producer*.json`, `freeze*.json`, `capture*.json`, `attempt-*/execution.json`과 `artifacts/build/u23h/artifacts/logs/u23h/build-metrics.json`이다.

빌드 후 engine preservation 외부 명령은 최초 1시간 29분 7초, SDK 환경 변경 후 guard 거부 26초, 최종 재개 1시간 40분 43초 후 중단이었다. 가장 긴 개별 완료 항목은 question-withdrawal.native 54분 54초, shared-engine.appserver 37분 25초, api-context.core 22분 49초다. 마지막 재개 영수증에는 58개 대상 중 31개 행이 통과로 기록됐으며 다음 parent-requests 항목은 sidecar만 있고 결과 행·종료 코드가 없어 미확정이다. 영수증을 합쳐 같은 항목을 두 번 통과로 세지 않는다. 재개에서 반복된 앞선 8항목의 실제 소요는 7분 51초이며, 재개 전체 1시간 40분을 전부 중복 낭비라고 볼 수는 없다.

Cargo 물리 캐시와 검사 결과 캐시는 다른 상태였다. shared-engine.appserver에서는 compiler-artifact 이벤트 1,378개가 모두 fresh:true여서 일부 물리 컴파일 결과가 재사용됐지만, 두 보존 실행의 native 결과 행은 전부 reused:false였다. Cargo 결과 캐시 집계는 최초 executed4/reused0, 재개 executed7/reused0이며 active/abandoned lease 보류 기록이 있다. SDK 환경 변경 외에 이 점유 기록과 정확한 key 불일치도 별도로 분석해야 한다.

병행 package owner 명령은 최초 27분 8초 후 실패, 재개 5분 51초 후 중단으로 합계 약 32분 59초이며 최종 엔진 검사와 전부 겹친다. 첫 UI 검사는 96개 결과 행 중 95 통과·1 실패였고, 별도 skipped 26개가 있다. 실패 render의 화면·클릭 19항목은 통과했지만 Chrome 종료 확인이 실패했다. 나중 관찰에서 잔여0은 확인했으나 종료 지연의 원인은 미확정이다. 재개의 완료된 UI 결과 73개는 모두 reused:false였다. 공식 Resume 사용만으로 실패한 한 항목만 재시험하거나 기존 95개를 재사용했다고 해석하면 안 된다.

레거시 정리도 미완료 사례가 확인됐다. `module-cache-cleanup.json`의 실제 삭제는 0이며 companion 4개/provider 2개가 보존돼 있다. 이 중 provider `13d55a…`는 등록된 `artifacts/build/u19b`의 lifecycle catalog 누락 때문에 소비 참조 확인이 막혔다. `engine-cache-cleanup.json`의 completed는 정리 명령 완료이며 실제 후보는 window-control-native unmanaged 1개, 삭제 증거는 없다. 공유 Cargo 결과 캐시 `.leases`에는 12개 점유 디렉터리가 있고 11개는 PID52716, 1개는 이번 중지 트리에서 종료를 관찰한 PID50608을 기록한다. 점유 파일은 token/PID만 보유하며 생성 시각·정확한 producer/run 연결이 없어 PID 부재만으로 안전하게 해제할 수 없다. 현재 `cargo/v1`의 storage schema는 코드상 현행 1이므로 이름만으로 레거시로 판단하지 않았다. 크기·전체 과거 캐시의 삭제 가능 여부는 미측정·미확정이며 삭제는 수행하지 않았다.

개선 우선순위는 다음과 같다. 모두 제안이며 구현 승인이나 성능 보장을 의미하지 않는다.

1. 입력 고정 전에 provenance delta, root/nested Git object store, Python 3.13과 SDK 전용 interpreter, npm lock 의존성, pinned UI, 짧은 socket/SQLite fixture 경로, approval fixture의 engine RPC 응답을 한 번에 검사한다. 수정할 사항을 모아 고정 반복을 줄인다.
2. 우선 중단 시 소유 점유를 반환하고, 비정상 종료 뒤 정확한 producer/process 생성 신원·run 종료 근거로 점유를 복구하는 owner를 만든다. 기록이 부족한 과거 점유와 u19b consumer는 실제 소유·설치·실행·증거 관계를 복원해 이관하거나 명시적으로 보류한다. 등록 경로나 lock 파일을 임의 삭제하는 우회는 하지 않는다. 정리 결과는 삭제 수·바이트·보류 원인과 해제 조건을 반드시 보고한다. 검증 결과는 실행 경로·전체 부모 환경보다 해당 검사의 완전한 입력·도구·필요 환경을 기준으로 재사용하도록 owner를 보강한다. SDK interpreter 설정 변경이 Rust 검증 전체를 무효화하지 않도록 입력 계약을 분리하되, 알 수 없는 외부 의존성은 재사용하지 않는다. 실제 코드에서는 `checkEnvironment()`가 전체 `process.env`를 묶고 Cargo key가 engineSourceRoot의 절대 경로도 보유한다.
3. Cargo 준비는 toolchain/target/profile/feature/RUSTFLAGS/lock/source가 같은 조합별로 typecheck·테스트 바이너리 준비·선택 목록을 공유한다. 선택 테스트 수 0 거부와 실제 실행, 서로 다른 feature 조합은 유지한다. 기존 Cargo 물리 target과 검증 결과 캐시는 이미 사용 중이므로 단순히 캐시를 켠다는 대책으로 충분하지 않다.
4. 변경된 fixture만 집중 검증하고 의존성이 같은 통과 결과를 재사용한다. g→h에서 제품·스크립트 입력이 같은데 전체 스크립트 검사까지 다시 수행한 약 10분 38초가 구체적인 재사용 후보다. 최종 exact VSIX의 fresh host 6단계는 유지한다.
5. 기존 배포 runner의 build/source 및 package/engine 병행 흐름을 격리 프로필·짧은 fixture에도 사용할 수 있게 확장해 별도 task wrapper의 직렬화를 제거한다. 이번 package owner는 빌드 완료 약 2시간 42분 뒤에야 시작했다. CPU·메모리·디스크와 Cargo lock을 기준으로 병행하고, ready artifact를 만드는 작업만 겹친다.
6. 입력은 검증된 immutable content store를 통해 재사용하고 변경 파일만 새 build identity에 반영하는 방식을 검토한다. 수정 가능한 hardlink로 원본과 연결하거나 고정된 입력을 덮어쓰지 않는다. Chrome 종료 검사는 정확한 소유 process tree의 실제 종료 이벤트를 제한 시간 내 기다리고, 통과한 95개 UI 검사의 재사용을 유지한다.

제품 컴파일 자체는 기록된 전체 시간의 약 6.1%다. 이 부분만 절반으로 줄이는 가정에서도 총 절감은 약 11분이므로 우선순위는 검증 재사용·준비 오류 조기 발견·동일 Cargo 조합 재컴파일 감소다. 새 파이프라인의 전체 시간 목표는 동일 입력/환경의 실제 전후 실행으로 정해야 하며 이번 기록만으로 보장하지 않는다.

## 목표와 범위

다른 Azrael 프로필의 빈 자식 세션 또는 이전 호스트 종료로 소유 연결을 잃은 자식 세션을 자동으로 인수하고, 연결 오류 뒤 복구를 시도하여 작업을 이어간다. Windows same-user child session이 대상이다. Windows 사용자 SID·profile·부모/자식 세션 식별, native helper 검증, 3단계 승인과 앱 승인을 유지한다. Linux/macOS의 지원 범위는 바꾸지 않는다. 제품 빌드·설치와 실제 세션 조작은 별도 요청 전까지 수행하지 않으며, 필요한 검증용 컴파일·fixture는 허용 범위다.

## 현재 구조와 조사

호스트별 manager와 controller는 메모리에 세션 identity를 보유하고, resource manifest는 각 codexHome에 분리되어 있다. controller의 warm 재점유는 같은 호스트의 현재 세션에 한정된다. native parent 단위 mutex와 관리자 recovery 경로가 이미 있다. 복구는 기존 primitive를 확장하고, 살아 있는 다른 작업의 입력 점유와 미확정 실행 결과를 자동 재생하지 않는 조건으로 진행한다.

## 구현·검증 기준

- 사용 중인 호스트/입력 lease와 빈 세션을 구분하고, 경쟁하는 프로필 두 개 중 하나만 점유한다.
- PID 재사용·세션 번호 재사용·다른 사용자·변조된 기록·현재 owner 생존·권한 취소는 인수를 거부한다.
- 호스트 종료와 연결 끊김 후 현재 신원·입력 해제·admission을 확인하고 복구한다. 과거 클릭·타이핑·앱 실행의 결과가 미확정이면 원래 mutation을 재전송하지 않는다.
- 복구 성공 후 이전 target/observation을 폐기하고 새 관찰·앱 승인 검사를 거친다. 재시도는 유한하며 실패 이유와 사용자 조치가 구조화되어 전달된다.
- 기존 child 생성·수동 recovery·warm 재사용·최소화 감지·정상 종료 보호에 회귀가 없어야 한다.

root가 공유 계약·호스트/controller 통합·문서와 인수를 소유한다. native 경로의 기존 소유권 검사는 제한된 읽기 전용 조사로 먼저 확인한다. 이전 비동기 승인 구현의 완료된 검증과 증거 보존은 이 변경과 분리하여 유지한다.

## 구현 결과

native 부모 세션 mutex와 같은 빌드의 인증된 named pipe를 재사용하여 빈 호스트만 협조적으로 연결을 반환한다. peer는 pipe가 보고한 PID와 보유한 process handle, 생성 시각·SID·부모 Windows 세션·실행 파일 hash로 확인한다. 입력 lease와 키/마우스 해제를 분리했다. 인수 시 기존 worker와 helper의 정확한 종료를 확인하며, 이전 호스트 종료 후 복구에는 같은 session anchor를 확인한 뒤 이전 worker 종료를 최대 10초 기다린다. 살아 있거나 다른 신원의 worker를 종료하거나 덮어쓰지 않는다.

manager는 기존 자식 세션을 자동 recovery 대상으로 선택하고 권한을 전후 재검증한다. transport producer 종료를 확인한 뒤 한 번 복구하며 과거 동작은 재전송하지 않는다. controller는 현재 연결을 확인하고 같은 anchor의 worker identity 교체만 기존 resource lease 아래 반영한다. 새 연결은 이전 앱 target과 observation을 폐기하며 호스트가 `connectionRecovered`와 새 관찰 필요를 전달한다. 미확정 mutation과 실행 전 거부를 구분한다.

기존 수동 recovery ticket 경로, 최소화 감지, 앱 승인, stage 3 승인, recovered session의 로그오프 금지와 정상 종료 보호를 유지했다. 변경된 가이드는 source에서 관리하고 기존 설치 f/u22c의 runtime과 지침은 덮어쓰지 않았다.

## 검증과 한계

- manager 단독 최종 검사: 50개 중 49 통과, 선택 native fixture 1개 미설정 생략, exit 0. 이후 root 통합에서는 실제 pinned helper를 지정해 해당 검사를 포함했다.
- 최종 통합 `integration/combined-r3.log`: 117/117, 생략 0, exit 0. 최초 관리 도구 실행 `run-45928-1058-1792386509991534900`은 114 통과·1 실패·1 생략, exit 1이었다. 실패 원인은 기존 revalidation mock이 새 `releaseLease`를 모델링하지 않은 것이며 보정 후 통과했다. root 입력 전 geometry 실패 검증 1개를 추가해 미전송 입력의 `not_executed`도 확인했다.
- 호스트·승인·stage 회귀 `integration/host-regression-r1.log`: 104/104, exit 0. 실제 feature manifest 검사 `integration/manifest-r1.log`: 1/1, exit 0.
- native 최종 `native/attempt-a5`: immutable Windows x64 C# compile/self-test exit 0, reconnect 25개와 기존 self-check 통과. source SHA-256 `2D177018A48165DAEBF35E9CB40EEC67ADFC505E65A29FC4897B0923333C8DFE`, helper `BE0A04177621629D02B061C04BC7824E4BE6660488E3FEE40A04D7E9D44B17DC`. 실제 process handle의 생존 timeout과 종료를 검증했다. viewer fixture `native/viewer-a3/test.log`는 1/1 exit 0이며 이후 수정이 viewer에 영향을 주지 않아 재사용했다. a5 helper로 headless journal 검사도 `integration/headless-final.log`에서 exit 0이다.
- 최종 controller에서 비동기 resource 갱신 이후 권한을 한 번 더 확인하도록 보강했고, 해당 controller·복구 통합 범위 28/28을 `integration/controller-final.log`에서 exit 0으로 확인했다. 나머지 변경 없는 범위의 결과는 재사용했다.
- 소스 범위 whitespace 검사 exit 0. 제품 빌드·설치·실제 프로필 인수·UAC와 Linux/macOS 실행은 하지 않았다. 기존 native 호스트가 다른 빌드이거나 사용 중이면 인수를 거부한다. 과거 resource admission lock의 소유자 종료를 입증할 수 없으면 해당 잠금을 자동 해제하지 않는다. 연결 복구가 모든 종류의 미확정 상태나 파일 잠금을 해소한다는 의미는 아니다.

검증 자료는 `artifacts/tasks/CF-01-window-use-admin-setup/runs/20261019-reconnect-r1/`에 담당별로 귀속한다. 실제 자식 세션 10과 부모 세션 2는 변경하지 않았다. 기존 공유 수정과 분리되지 않는 파일은 임의 stage/커밋하지 않으며, 이전 비동기 승인 engine의 검증 입력과 기록은 보존한다.

수명 검토 결과 manager의 `cf01-reconnect-r1-manager`, native의 `run:CF-01-window-use-admin-setup:20261019-reconnect-r1:native`, root의 `run:CF-01-window-use-admin-setup:20261019-reconnect-r1:integration`은 전체 구성 확인 후 보류했다. 설치 인수와 독립 증거 보존을 마친 다음 소비 참조를 해제하고 재검토한다. 일회성 테스트 payload는 테스트 종료 시 일반 삭제했고, 남은 경로는 약 2.3 MB의 검증·진단 자료다. 이전 비동기 승인 engine 및 root integration의 보존 결정도 실제 관리 도구에서 `deferred`로 완료했다. 등록 대기는 기존 engine 증거의 약 951 MB/9개 소스 snapshot 재측정과 관리 잠금 때문이었으며, 새 복구 시험을 재실행한 대기가 아니다.
## 빌드·격리 프로필 설치와 실제 시험

사용자 승인으로 `2026.0.10` 버전을 유지한 새 빌드 `u23a`를 준비한다. 현재 미커밋 변경을 포함한 입력을 `artifacts/build/u23a`에 고정하고 Windows x64 MSVC 엔진·bridge와 선택한 공식 code-mode host, 승인 30초 비동기 흐름, 자동 자식 연결 복구, RunOnce 길이 보강을 함께 패키징한다. 실행 기록은 `20261019-approval-reconnect-deploy-r1` run에 둔다. 공통 엔진 변경은 등록 보존 검사를 적용하고 Windows native PTY 사전 검사, exact package와 fresh host 6단계는 반드시 수행한다. 현재 f/u22c, rollback u21a, 설정·인증과 부모 2/자식 10은 보존한다. 설치 대상은 기존 f 전용 extensions·agent-user-data·s이며 `NoLaunch`, 바탕화면 바로가기 변경 없음으로 설치한다. 설치 후 활성화와 실제 Window Use 시험은 root가 별도로 수행하며 소스·패키지 검증과 구분한다. macOS/Linux 네이티브 실행은 이 Windows 설치 작업의 검증 범위가 아니다.

준비 진단: `u23a`는 Git reset 출력 버퍼, `u23b`는 별도 `upstream/codex` object store 초기화 누락 때문에 입력 준비가 actual exit 1이었다. 두 원인은 task wrapper에 한정하며 제품 코드를 바꾸지 않고 `u23c`에서 별도 Git metadata와 object-store 참조를 준비했다. 긴 Cargo 실행 전 실제 engine provenance snapshot은 actual exit 1로 stale `engine/SOURCE.json`을 발견했다. 읽기 전용 비교는 inventory 변경 73개·추가 27개를 확인했으며, 이 중 nested generated JSON/TS 추가 14개가 현 recorder 허용 범위를 벗어난다. 정식 source inventory owner를 통해 이 경계를 해결하기 전에는 긴 엔진 컴파일·패키징·설치를 진행하지 않는다. 원본 SOURCE/index, 설치 f/u22c와 세션은 변경하지 않았다. 후보 목록과 실패 producer는 위 run의 `receipt-delta-readonly.json`, `producer*.json`에 보존한다.



Provenance follow-up (2026-10-19): the reviewed generated-source allowance is limited to direct `schema/typescript/v2/*.ts` and `schema/json/v2/*.json`, with exact paths, tracked regular files, content and baseline guards retained. Recorder 32 tests and importer 37 tests passed. `u23d` officially records the full reviewed 73 changed / 27 added engine paths in its independent snapshot index; the primary index and source receipt are preserved. Windows native PTY preflight passed 9/9. The subsequent source gate failed because the wrapper selected Python 3.10 and one cache fixture expected 17 groups after approval added group 18. Python 3.13 now takes precedence, and the exact group-count correction passed its focused test (actual exit 0). New immutable input `u23e` contains only that fixture correction relative to `u23d`; all full build, source gates and six fresh host checks remain mandatory.


Build checkpoint: `u23e` frozen SHA `f03fcd4824e1f07b1c2415335bcdfd0e80376aa6a77b875384ee158c6a435ff3` (24,564 selected files). In `attempt-e2`, all 17 engine source preflight checks passed (actual exit 0), and native Windows PTY passed 9/9. Full current/standalone regression then ended with actual exit 1: 1,524 tests, 1,490 passed, 24 failed, 10 skipped; runner elapsed 882,547ms. Mandatory source failure blocks product build, package generation and installation; all remain unexecuted and f/u22c remains installed. The failures include queue presentation prelude integration, feature registry ownership, stale host approval fixtures and missing fixture inputs. `failure-summary.json` and `failures-extract.log` under `attempt-e2/source-tests/2026-10-19T06-28-49-404Z-30380/` preserve first causal errors. Companion dependencies were prepared with frozen-lock npm ci (exit0), preserving exact TypeScript hash. Legacy UI and instruction/catalog fixture inputs were explicitly pinned; legacy/catalog focused cases now pass, while instructionService still has six native-validation/application assertions with explicit u22c engine. No failure was skipped to allow deployment. Source snapshots and task artifacts remain pending, retained for parent integration and inherited Git object-store consumers. Revisit cleanup after corrected immutable input and accepted package/live evidence release these references.


Integration repair checkpoint: owned fixture expectations now match recovery injector seven edits, mandatory selected-tests-v1 Cargo declaration, and Sky v2 package-contained policy ownership. The staging forgery check still rejects a manifest-rehashed duplicate owner, and Cargo pass/reuse/force checks retain the unrelated native failure assertion. Instruction service diagnostics revealed Windows SQLite failure under the long task path; the registered short fixture `artifacts/build/i23` with explicit retained native validator passed all seven service scenarios. Combined focused regression: 32 tests, 31 passed, one filesystem-dependent skip, actual exit0 (81,854ms). UI, registry and host fixture owners supplied stable integration corrections; u23f will contain their explicit eleven overlays relative to u23e before full regression and build.


Build checkpoint (u23h, 2026-10-19): immutable input SHA `29b2e851bdd3a266f7cd7ffd0f9aeae045505b22ac74005d47d771f0d407d5d5`, 24,564 files / 475,451,703 bytes. All 17 engine source preflight checks and Windows native PTY 9/9 passed (actual exit 0). Full script regression: 1,525 tests, 1,515 passed / 10 skipped / 0 failed; extension regression: 229/229 passed, actual exit 0. Product build completed with actual exit 0 (08:00:40.548Z?08:23:24.321Z), including engine/bridge, companion, staged computer-use runtime, native window-control and freshly compiled child-session helper. Post-build immutable identity, new engine --help and helper --self-test passed. Final engine preservation is still running mandatory native checks; package preparation, six fresh-state host acceptance and installation are not yet complete. Evidence: `artifacts/tasks/CF-01-window-use-admin-setup/runs/20261019-approval-reconnect-deploy-r1/attempt-h/execution.json` and stage logs. Existing f/u22c remains installed until those gates pass.


Final engine verification environment correction: original `attempt-h` terminated with actual exit1 after the native withdrawal gate passed; `ui.question-withdrawal.sdk` alone failed immediately because the immutable snapshot excludes ignored Python .venv and the wrapper omitted `AZRAEL_PYTHON_SDK`. The explicit existing root SDK interpreter passed the four SDK assertions against h generated models (Python3.10.21, actual0). `attempt-h-resume1` preserves the failed evidence, binds the existing SDK interpreter, verifies unchanged h identity and all prior source/build success plus exact built-binary hashes, and resumes final preservation/package acceptance without a new snapshot or product rebuild. Passing native evidence is reused only by its existing owner guards; remaining checks stay mandatory.


Scheduling correction: after exact h product/source success, `attempt-h-package1` starts the existing `prepare-independent-vscode.ps1` owner against the same release/compiler/UI/f-state/package path concurrently with final engine preservation in `attempt-h-resume2`. Both producers record actual start/end/exits independently. Final six fresh host checks and f installation remain blocked until final engine preservation and parallel preparation both pass. The already-loaded serial continuation will encounter the ordinary existing-output guard before a second package generation; a later exact-input continuation will consume the independently prepared package. No frozen source or owner guards are changed.


User stop (`?? ??`): the exact owned engine/package coordinator process trees were cancelled. Native sessions60716/7684 both returned observed terminal exit1; unfinished stage exits remain null and wrapper state is interrupted. Cancellation observed roots31972/45036 and stopped residual46544/47140; all captured descendants are absent after cancellation, with no stop errors. Completed u23h build and all original evidence/checkpoints remain retained. Final engine gate/package preparation were incomplete; six fresh host acceptance, f installation and live Window Use tests did not start. Last known f remains u22c. Main lifecycle remains pending/incomplete for later deliberate reconciliation; no artifact deletion, new checks or hash remeasure was performed. Evidence: `20261019-approval-reconnect-deploy-r1/cancellation-summary.json` and `cancellation.json`.

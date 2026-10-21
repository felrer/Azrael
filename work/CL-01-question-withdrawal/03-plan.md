# 테스트 타깃과 브리지 컴파일 범위 축소

상태: 세 개선 구현 및 고정본 범위 검증 완료. 병행 작업의 최종 통합·출처 갱신은 미완료.

## 목표·보존·범위
통합 테스트 타깃을 분리하고 사전 타입 검사의 불필요한 타깃 선택을 줄이며, 브리지를 원격 연결 전용으로 빌드한다. 기존 전체 회귀 검사와 기본 embedded client API, 브리지 IPC·인증·이벤트 동작은 보존한다. 질문 테스트 본문과 기존 변경을 유지한다. Windows x64/Linux x64/macOS ARM64 공통 의미이며 실제 실행 검증은 Windows에서 한다. 제품 전체 빌드·설치·배포와 AWS·오디오 기능 제거는 제외한다.

## 구현 계약·소유·의존
- 테스트 담당은 core의 질문 통합 모듈을 독립 target으로 분리한다. core/app-server에 기본값이 꺼진 `integration-tests=[]` feature를 두고 통합 target에 `required-features`를 지정해 기본 타입 검사에서 제외한다. app-server의 명시된 네 바이너리는 `test=false`를 유지한다. 전체 nextest 검증은 `--tests --bins`로 기존 library opt-out과 환경 전용 voice installed-client 제외를 보존하며, 선택된 core/app-server 패키지에만 해당 integration feature를 활성화한다. 명시적인 타깃 선택도 유지한다. feature는 테스트 타깃 선택에만 쓰며 제품 Rust 동작을 바꾸지 않는다. 통합 준비에는 별도 feature fingerprint가 생기는 비용을 수용한다.
- 브리지 담당은 app-server-client의 기본 embedded API를 유지하고 no-default-features에서 remote client만 사용할 수 있게 분리한다. 먼저 안정된 소스·manifest를 넘기고 네이티브 검증은 루트가 단일 Cargo owner로 조정한다.
- 루트는 검증 도우미·묶음·모든 기존 core 통합 호출·just 전체 검사·Windows/공통 빌드 명령·문서·provenance·최종 검증을 맡는다. app-server 기본 test target 축소는 작은 실제 fixture로 명시 선택 시 기존 검사가 보존됨을 확인한 뒤 적용한다.

## 검증·산출물
보존 정리 완료: `compile-scope-1/2/3` 세 group의 총 10개 항목을 각각 최신 review token으로 모두 defer 처리했고, 실제 결과의 `aborted=false`, 전체 항목 `status=deferred`, `remaining=true`를 확인했다. 마지막 group ID는 `run:CL-01-question-withdrawal:compile-scope-3`이다. 재검토 조건은 병행 호스트 승인 작업의 통합, `SOURCE.json` 조정, 독립적으로 읽을 수 있는 최종 검증 근거의 확보이다. 마지막 고정본은 등록 이후 추가로 수정하지 않았다. Windows PID 검사는 18 passed/1 ignored이며 기존 제외를 유지한다. 마지막 입력 점검에서 이번 작업의 Cargo/Rust 17개와 정책·Bazel 5개 파일이 검증한 내용과 같음을 확인했고, 관련 경로 whitespace 검사도 exit 0이다.

고정본의 기본 데몬 테스트 6개도 exit 0(02:00:43–02:10:26Z)이다. 다만 실행 중 공유 `cargo-verification.cjs`에 `check-window-approval-native` 등록 한 줄이 추가되어 원래 드라이버는 마지막 무결성 검사에서 exit 1로 중단했다. 원본 실행 실패는 유지한다. 해당 한 줄을 뺀 파일의 SHA256이 시작 시 해시와 정확히 일치하고 target owner 파일도 동일함을 확인했으므로 명령 생성·실행 코드는 바뀌지 않았다. 새 도우미·wrapper 해시를 실행 전후 고정해 남은 Windows PID 검사만 별도 실행했고 02:12:11–02:12:30Z에 exit 0, 실행 중 해시 변경 0개로 끝났다. 결과는 `compile-scope-3/verification-summary.json`, `native-pid-result.json`에 있다.

작업에 필요한 기본 client·질문·기본 daemon·PID 실행 검증을 모두 확보했다. 이는 고정본 및 명시한 도우미 범위의 증거이며, 병행 호스트 승인 기능을 포함한 최신 작업 폴더 전체의 통합 완료 증거는 아니다. 공유 출처·설정에 다른 작업 변경이 섞였고 최종 출처 갱신도 보류 중이므로 작업 단위 커밋은 만들지 않았다. 정책·Bazel 5개 변경의 독립 패치와 전후 해시는 `compile-scope-3/logs/build-policy-delta.patch`, `build-policy-delta.json`에 보존한다.

02:00:43Z 기준 고정본의 기본 client 28개와 최종 `integration-tests` 구성의 질문 29개가 모두 exit 0이다. client 검증 01:35:15–01:49:21Z(타입 4분 20초, 목록 준비 8분 48초), 질문 검증 01:49:21–02:00:43Z(타입 약 3분 30초, 목록 준비 약 6분 28초)로 기록한다. 나머지 데몬 검증은 같은 캐시에서 이어서 진행한다.

최종 출처 갱신은 병행 변경으로 미완료다. 정책·Bazel 5개 파일만 명시한 recorder가 01:43 이후 추가된 `HostApprovalLedgerUpdated` 관련 Rust 8개 파일의 변경도 감지해 exit 1로 중단했다. 이 변경은 이번 세 개선의 소유 범위 밖이며 수정하거나 출처 기록에 임의로 포함하지 않았다. 상세 경로·해시는 `compile-scope-3/logs/concurrent-source-delta.json`, 실패 원문은 `build-policy-source-recorder.log`에 있다. 현재 작업 폴더 전체를 고정본과 동일하게 검증했다고 주장하지 않는다. 병행 작업 통합 후 해당 소유자가 이 기록의 정책·Bazel 5개 경로도 함께 반영해 `engine/SOURCE.json`을 갱신하고 영향받은 통합 검증을 수행해야 한다.

산출물 `compile-scope-1`(진단·범위 검증)과 `compile-scope-2`(미사용 중간 고정본)의 두 lifecycle group, 총 9개 항목은 최신 review token으로 모두 defer 처리했다. 로그·출처를 대체하는 독립적인 최종 통합 검증 receipt가 확보될 때 재검토한다. 실제 결과는 `compile-scope-3/logs/retention-apply-12.json`에 보존한다. 임시 계획 본문 `work/compile-scope-plan-body.md`는 일반 삭제 후 부재를 확인했다.

최종 feature/Bazel 소유 경로까지 반영한 소스 묶음 재검증은 `run-45928-978-1792374204266091800`, 89 passed/1 skipped, exit 0이며 `compile-scope-3/logs/source-bundle-final.json`에 보존한다. 새 manifest/Bazel 회귀 검사 8개도 Python 3.13에서 exit 0이다. 전역 manifest verifier는 이전 고정본과 같은 기존 오류 6개(5개 소유 경로)로 exit 1이며 이번 변경에 따른 추가 오류는 0개이다. 상세 비교는 `compile-scope-1/logs/manifest-policy-comparison.json`에 남긴다. 기존 불일치의 정리는 범위 밖이다.

Bazel의 client `embedded`, daemon `lifecycle` 기본 동작을 명시했고 공유 초기화 파일을 독립 통합 타깃 발견에서 제외했다. `MODULE.bazel` → rules_rs workspace resolver → 기본 feature와 `dep:*` 활성화 → `all_crate_deps` 정적 추적으로 선택적 의존성 유지 경로를 확인했다. 실제 Bazel 평가·빌드는 실행하지 않았다. 이 정책·BUILD 파일은 네이티브 고정 입력 이후 별도 출처 갱신하며 Rust/Cargo 파일은 바뀌지 않는다.

최종 feature gate의 실제 Cargo/nextest 작은 fixture는 단위 선택 1개(exit 0), 전체 선택 3개와 실행 3개 통과(exit 0)로 확인했다. 기존 비활성 library 및 설치 환경 의존 통합 타깃은 제외됐다. 증거는 `compile-scope-1/logs/feature-unit-selection.json`, `feature-full-coverage-run.json`이다.

최종 소스 묶음 `compile-scope-source`는 90개 중 89개 통과, Linux 전용 1개 제외, exit 0이다. 묶음 run `run-45928-974-1792373618293486300`, 상세 결과는 `artifacts/tasks/CL-01-question-withdrawal/runs/compile-scope-3/logs/source-bundle-result.json`에 보존했다. 통합 기능 플래그가 추가된 호출의 기존 예상 인자 및 등록 테스트 개수 검사도 함께 갱신했다. 이전 실패 실행은 그대로 남는다.

최종 Rust 입력은 `compile-scope-3/inputs/engine`, SHA256 `f3308920c3b70471d534beb353442d962b973a982f56d5bc651649bf74838359`이다. 01:31:06–01:35:08Z 출처 갱신·고정 후 01:35Z에 기본 client, 질문 feature, 기본 daemon 및 Windows PID 검증을 단일 Cargo 캐시에서 순차 시작했다. 첫 client import 누락 실패를 고친 후의 실행이며, 앞선 실패를 통과로 바꾸지 않는다. `compile-scope-2`는 네이티브 실행에 쓰지 않은 중간 고정본이다.

원격 전용 bridge 검사에는 원격 client 테스트 1개와 bridge 바이너리 컴파일·목록 확인이 포함되어 exit 0이었다. dependency tree의 로컬 `codex-*` 패키지는 기본 구성 120개, 원격 전용 38개이며 core/app-server/config/exec-server/app-server-transport가 제외된다. 이는 의존성 범위 측정이며 전체 제품 빌드 시간의 감소율로 해석하지 않는다.

선택된 테스트 목록과 이전 목록의 보존, core unit 사전 검사에서 통합 바이너리 제외, default embedded API와 remote-only 의존 경계를 각각 확인한다. 작은 Cargo fixture와 source 검사로 구성을 먼저 검증하고 필요한 실제 네이티브 검증만 수행한다. 기존 Cargo 캐시와 호환 근거를 재사용하고 동일 캐시의 병렬 컴파일을 피한다. 실행 전에 task/run 소유를 기록하고 로그와 준비용 컴파일을 테스트 결과와 구분한다. 실제 종료 코드·입력·시간·보관/삭제·커밋 제한을 이 기록에 남긴다.

브리지의 간접 서버 의존성을 없애기 위해 daemon의 등록·peer 인증을 수명 관리 코드에서 분리한다. 기본 `embedded`/`lifecycle` 기능은 기존 API를 유지하고 원격 전용 빌드에서만 기본 기능을 끈다. 준비된 소스는 고정 복사본에서 검증한다. 실행 산출물: `artifacts/tasks/CL-01-question-withdrawal/runs/compile-scope-1`.

## 실행 증거·시간
- 초기 `test=false` 방식의 작은 실제 Cargo fixture에서 기본 `--lib --tests`에는 library만 포함되고, 명시적 통합/바이너리 및 전체 선택에는 해당 테스트가 포함됨을 확인했다(실제 exit 0). 설치된 nextest도 전체 선택 옵션을 지원한다. 이후 실험에서는 전역 `--lib --bins --test '*'`가 기존 `test=false` library 25개와 환경 전용 installed-client까지 선택하거나 `--tests`가 명시 선택을 덮는 문제가 드러났다. 따라서 이 초기 fixture 결과는 최종 선택 정책의 증거로 쓰지 않는다. 최종 계약은 비기본 integration feature gate와 `--tests --bins`, 선택 패키지별 feature 활성화다. 초기 실험 로그 `compile-scope-1/logs/no-feature-*.json`은 시행 결과로 보존한다.
- 실제 Windows 원격 브리지 의존성 해석 exit 0. core/app-server/config/exec-server/app-server-transport가 의존 경로에서 제외됐다. 기본 제품 전체 빌드 시간 단축률을 측정한 결과는 아니다.
- 초기 `test=false` 구성의 Cargo metadata exit 0: core 통합 4개와 app-server 통합 1개/바이너리 4개가 기본 test 선택에서 제외된다. 당시 소스 검사 86 passed/1 skipped와 범위·공용 실행기 검사 22 passed, 실제 종료 코드 0. feature inventory 71개 검증 통과. 최종 feature gate 구성은 별도 `cargo metadata --no-deps --locked --offline` exit 0으로 core 4개와 app-server 1개 통합 target의 `required-features=["integration-tests"]`, 기본 feature 없음, app-server 네 bin의 `test=false` 보존을 확인했다. 이 metadata 확인은 최종 구성의 네이티브 컴파일 결과를 뜻하지 않는다.
- 출처 기록 첫 시도는 이전 작업의 신규 파일이 임시 인덱스에 없어 중단됐다. 실제 인덱스 변경 없이 임시 인덱스에 기존 파일을 보완해 재실행했다. 컴파일 재실행은 발생하지 않았다. 소스 출처 기록·고정 복사 완료 2026-10-19T00:50:18Z, 고정 SHA256 `a7c86bf85d542385ceb9fc901e96efedf0c06bcee1e997a7d4293bedcf9011be`.
- 원래 질문 모듈 본문 SHA256 동일, 기존 aggregate 187개 중 질문 모듈만 추출해 186개 유지, 이전 실행 파일의 29개 질문 목록 확보. 분리된 등록 테스트는 기존 shared-engine 회귀 호출에 추가했다.
- 네이티브 검증은 고정 복사 직후 시작했다. 단일 Cargo 캐시에서 원격 타입 검사부터 순차 실행하며, 초기 확인 시점은 시작 후 약 2분이다. 컴파일 시간은 환경과 캐시 상태에 따라 달라진다.
- 원격 브리지 타입 검사 exit 0(00:50:23–00:53:36Z), 등록 검증 2개 exit 0, 초기 `test=false` 구성의 core/app-server 단위 타입 검사 exit 0(00:54:25–01:02:01Z). 실제 단위 타입 검사에는 두 library의 일반·테스트 타입과 자동 발견된 작은 `test_notify_capture` 보조 타깃이 포함된다. 대형 통합 타깃과 명시된 네 바이너리는 제외됐다. 기본 test 대상이 library만이라는 fixture 결과를 실제 프로젝트 전체에 확대하지 않으며, 이 컴파일을 최종 feature gate 구성의 검증으로 재분류하지 않는다.
- 실제 nextest fixture에서 중복 `--lib`가 exit 2로 거부됨을 확인해 `just-shell.py`의 타깃 선택 확장을 추가했다. 기본 실행은 전체 범위를 선택하고, 명시적 타깃 옵션이 있으면 사용자의 선택을 유지한다. 초기 두 셸의 전달·선택 검증 7개 exit 0(Python 3.13 및 기존 SDK Python 3.10), 실제 just dry-run exit 0. 실제 Windows 셸 경유 nextest 시도는 기존 필수 도구 `pwsh` 부재로 exit 1이며, 해당 경로가 실행됐다고 주장하지 않는다. 별도 nextest fixture는 실제 3개 테스트 타깃 목록을 확인했다. 최종 `--tests --bins` 및 선택 패키지별 feature 전달은 변경된 just 도구의 별도 출처 기록과 검사로 검증한다. 초기 고정 소스·컴파일의 증거는 당시 입력에만 적용하며 최종 manifest의 출처·검증을 대신하지 않는다.

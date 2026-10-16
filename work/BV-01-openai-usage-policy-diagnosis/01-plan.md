상태: 소스 수정·Windows 회귀 검증·출처 기록·생성물 정리 완료. 제품 전체 빌드·설치는 수행하지 않음.

## 목표와 권한
OpenAI 사용량 조회의 `application network policy is unavailable` 오류를 창의 새 정책을 사용하도록 수정한다. 사용자가 원인 조사 후 이 방향의 수정을 지시했다. 코드 수정·필요한 테스트 컴파일·검증·정리·작업 커밋을 수행한다. 제품 전체 빌드, 패키징, 설치, 실행 중인 사용자 창 재시작과 실제 계정 요청은 포함하지 않는다.

공통 Rust 초기화 경로이므로 Windows/macOS/Linux에 적용된다. 실제 검증은 Windows x64/MSVC에서 수행했다. 다른 OS 실행과 실제 OpenAI 계정 사용량 조회, 설치된 창의 수용은 미검증이다. 인증 데이터·사용자 설정과 실행 프로세스는 보존한다.

## 원인과 구현
실행 중인 w31b의 `build-info.json`은 `artifacts/w31b/engine`을 소스로 기록한다. 이 소스와 primary 모두 창의 AuthManager를 기존 template 정책으로 만든 뒤 ConfigManager만 새 정책으로 분리했다. 계정 복원·전환이 기존 정책을 무효화해도 갱신은 창의 새 정책에 적용되어, 프로필 사용량 클라이언트가 무효화된 정책을 계속 참조할 수 있었다. 스크린샷 창의 정확한 PID 및 실제 요청 직접 재현은 확인하지 않았다.

`ConfigManager::fork_for_window`는 독립 정책·설정·빈 cloud loader만 만든다. `load_azrael_window_config`가 로컬 설정을 준비하고 template 인증 설정을 복제한 뒤, 인증 bootstrap과 application policy를 새 창의 정책으로 연결한다. 이 config로 AuthManager를 만들고 같은 정책의 cloud loader와 최종 config를 로드한다. shared server의 `create_context`가 이 경로를 사용한다.

template의 로그인 워크스페이스 제한, 인증 연결 경로와 창별 모델·설정 분리를 보존한다. 정책 무효화·제한을 우회하지 않는다. 계정 변경 전에 만든 클라이언트는 계속 차단하고, 갱신 뒤 새 계정용 클라이언트가 새 정책을 읽는다. 프로필 manager가 template의 정책을 상속하는 기존 구현은 그대로 재사용한다. 새 의존성은 추가하지 않았다.

이는 기존 [창별 인증 격리 계약](../../docs/architecture/azrael-runtime.md#공용-실행기와-창-수명)을 보존하는 내부 수정이다. 계약 변경은 없으며 architecture 문서 변경은 불필요하다. 기존 `engine.shared-engine` 보존 항목이 두 Rust owner와 native checker를 이미 포함한다. checker가 `config_manager::window_context_tests::` 전체를 선택하도록 확장했다.

## 수용 기준과 결과
Windows native 23개, source runner 34개 모두 실제 exit 0이다. 최종 결과는 `artifacts/tasks/BV-01/control/verification-summary.json`을 따른다.

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 새 창 정책 동일성, 부모·다른 창 격리, template 로그인 제한, 이전 client 차단과 새 client 복구, 제한 정책 반영 | 2/2, exit 0 | `policy-final/logs/codex-app-server-config_manager-window_context_tests--attempt3.log` |
| 공유 엔진 등록·소유권·재연결 | 12/12, exit 0 | `policy-final/logs/codex-app-server-azrael_shared_server-tests--attempt3.log` |
| 기존 application network policy | 4/4, exit 0 | `policy-final/logs/codex-app-server-config_manager-application_network_tests--attempt3.log` |
| 사용량 오류 분류·비밀 노출 방지 | 4/4, exit 0 | `policy-final/logs/codex-app-server-usage_errors_-attempt3.log` |
| 프로필 reload가 공유 정책을 무효화하지 않음 | 1/1, exit 0 | `policy-v2/logs/profile-policy-corrected.log`, 정확한 테스트 바이너리 SHA는 `profile-binary.json` |
| Cargo runner/package/filter/Windows native 실행 규칙 | 34/34, exit 0 | `policy-v2/logs/source-cargo.log` |

native 명령은 `cargo test -p codex-app-server --lib <filter> --locked --offline --target x86_64-pc-windows-msvc -- --test-threads=1`이다. profile 검사는 Cargo가 생성한 `codex_login` libtest 실행 파일에서 `profile_reload_does_not_revoke_the_shared_application_policy --test-threads=1`로 실행했다. `codex-login`의 82개 입력 파일이 primary와 동일함을 확인해 그 증거를 재사용한다. 최종 native scope별 명령·시작/종료·실제 exit는 `policy-final/logs/results-attempt3.json`에 있다. 상대 로그 경로는 모두 `artifacts/tasks/BV-01/runs/` 기준이다.

최종 소스 9,266개를 `policy-final/inputs/engine`에 고정하고 primary 컴파일 입력이 시작·종료 모두 동일한 바이트임을 확인했다. 기존 `engine/codex-rs/target` 캐시를 사용했으며 별도 캐시는 만들지 않았다. 최종 검사는 변경된 `codex-app-server`의 실제 재컴파일 로그와 이전 테스트 바이너리와 다른 SHA도 확인했다. 최종 test executable SHA256은 `456275c801b8f2636645cf87427fde5e0f2dfba80c225d16dbc336797f49ca93`이다.

## 검증에서 제외한 시도와 시간
관리 도구 `run-32256-0-1792168935673573800`은 10초 제한으로 exit 124였고 입력 동일·producer_completed=true로 종료했다. 종료와 잔여 producer 부재를 확인한 뒤 세션 유지 exec로 새 시도를 실행했다. 성공으로 계산하지 않는다.

v2의 `profiles_tests::` 필터는 실제 모듈 이름과 달라 0개를 선택했다. 이 결과는 제외하고 위의 실제 테스트 이름으로 1개를 실행했다. 최종 attempt2는 이전 바이너리 재사용을 확인해 제외했다. producer 종료 후 수정 모듈 및 crate root의 mtime만 갱신하고 동일한 바이트로 attempt3를 재컴파일했다. 새로운 바이너리 SHA 및 실제 테스트 수를 확인했다.

첫 v2 app-server 준비·검사는 10분17초, login libtest 준비는 11분15초였다. 최종 app-server 재컴파일과 해당 2개 검사는 1분49초, 나머지 세 scope는 약 18초였다. 최종 producer는 2026-10-17 02:09:23~02:11:30 KST에 실행됐다. snapshot 준비와 출처·cleanup의 파일 검증은 별도 시간이다. 서로 겹친 작업 시간을 합산하지 않는다. 공유 Cargo 캐시가 사용 중일 때 최종 컴파일은 대기했다.

## 출처·정리·커밋
공식 baseline은 `artifacts/shared/engine-original-ccbcbf93/engine`이며 original receipt 객체가 primary SOURCE의 originalReceipt와 같음을 확인했다. baseline receipt SHA256은 `12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6`이다. 공식 recorder에 변경된 두 Rust 경로만 명시해 최종 SOURCE 기록을 갱신했고 exit 0이다(`policy-final/logs/source-receipt-final.log`). 최종 SOURCE receipt SHA256은 `d7a18b7b6873125f36aa14597c1c16e0b941c971c4355c149cf16650c14cdce9`이다. test snapshot 자체는 제품 배포를 위한 새 source receipt나 완제품 빌드가 아니다.

생성물 owner는 BV-01이며 `artifacts/tasks/BV-01/control/`에 producer·입력·검증 명세를 둔다. control과 프로젝트 관리 설정은 삭제 대상 밖이다. 사용하지 않은 두 중간 run v1/v3은 `bv01-obsolete-inputs`로 등록·review 후 일반 삭제했다. 두 항목 모두 `status=deleted`, `remaining=false`, 그룹 `deleted`, `aborted=false`이며 실제 경로 부재도 확인했다. 물리 회수 용량은 측정하지 않았다.

최종 immutable input은 `bv01-final-input`으로 등록하고 실제 `deferred` 결정을 기록했다. v2 입력/수정·제외 시도 로그 및 최종 로그는 `bv01-policy-evidence`로 등록해 검증 summary와 이 계획의 참조를 보존했다. 진단·재현 근거이므로 수정이 포함된 제품 빌드·설치 수용이 완료되거나 독립 보존한 검증 근거로 대체되면 삭제를 재검토한다. 사용자 상태와 기존 shared Cargo cache는 정리 대상이 아니다.

최종 diff와 source receipt 변경 범위를 검토했다. 작업 커밋은 두 Rust 파일, `engine/SOURCE.json`, native checker와 이 계획만 포함한다. 다른 진행 중인 변경은 포함하지 않는다. 설치된 앱에는 아직 반영하지 않았으며 실제 사용량 조회 수용에는 새 제품 빌드·설치가 필요하다.

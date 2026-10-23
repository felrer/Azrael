상태: 승인된 결함 수정 및 로컬 검증 진행 중. Timer Unfreeze로 이름을 변경하며 실계정 정상 동작은 사용자 확인으로 남긴다.

# 자동 실행 및 계정 시간 표시 조사

- 요청 산출물: 미사용 OpenAI 계정의 자동 타이머 시작 실패와 리셋 시간 깜박임 원인, 해결 제안.
- 허용 범위: 원인 조사, 확인된 결함의 소스·테스트·소유 문서 수정, 테스트 준비 컴파일 및 로컬 회귀 검증. 실계정 요청·계정 선택·예약 삭제·제품 패키징·설치는 수행하지 않는다.
- 소유자: root는 엔진·통합·문서·검증을 소유한다. UI 담당 usage_ui_fix는 UI 4개 소스와 관련 4개 테스트를 수정한다. 기존 다른 작업의 수정은 보존한다.
- 플랫폼: 계정 및 UI 공통 의미는 Windows x64/Linux x64/macOS ARM64 대상. 실제 이번 조사 환경은 Windows x64 로컬 VS Code이며 다른 OS 동작은 검증하지 않는다.
- 접근: 실행 release와 source 연결 → 계정별 조회/자동 요청 admission 추적 → 표시 데이터/갱신 경로 확인 → 근거와 불확실성을 구분해 제안.
- 성공 기준: 요청 차단의 코드 경로 제시, 시간 표시의 확인된 문제와 미확정 원인 구분, 중복 요청 방지와 계정 격리를 유지하는 수정 및 회귀 검사 제안.
- 설계 소유자: [계정 계약](../../docs/architecture/accounts.md#automatic-openai-window-start), [플랫폼 계약](../../docs/architecture/multi-platform.md). 승인된 동작과 명칭은 해당 소유 문서에 반영한다.


## 실행본과 근거

실행 중 엔진은 `artifacts/build/b13/artifacts/releases/w11aa/engine/azrael.exe`다. 같은 release의 `build-info.json`은 engineVersion `0.162.0`, packageVersion `0.4.0`, source `artifacts/build/b13/engine`, 생성 시각 `2026-10-22T14:12:48+09:00`을 기록한다. extension log는 설치된 `azrael-ex-local.azrael-2026.0.11` asset을 가리킨다. 조사한 `account_processor.rs`, `usage_window.rs`, `usageWindowService.ts`, `usageView.ts`, `usagePresentation.ts`는 checkout과 b13 고정 소스의 SHA-256이 같다. 엔진 binary 재해시와 패키지 재수용은 하지 않았다.

### 자동 요청 차단: 코드 결함 확인

- `engine/codex-rs/app-server/src/request_processors/account_processor.rs:1675`의 변환 함수는 전달받은 `_auth` 대신 `self.auth_manager.auth()`의 현재 선택 계정으로 응답 account/user를 비교한다(`:1718`). 이 조건으로 `ordinary_usage_allowed`도 제거한다(`:1733`).
- `account_processor/azrael.rs:551`은 대상 프로필 auth로 조회하고 응답 identity를 검사한 뒤 같은 변환 함수를 부른다. 따라서 유효한 비활성 계정의 `allowed=true`도 선택 계정과 다르면 `None`이 된다.
- `account_processor/usage_window.rs:234`는 `Some(true)`가 아니면 요청을 차단하므로 `start_window`에 도달하지 않는다. 비활성 계정 자동 시작 계약과 충돌한다. 다른 창에서 해당 계정이 선택되어 있으면 결과는 달라질 수 있다.
- 실제 활성 예약 3개는 조사 시점에 `scheduled`, 최근 관측은 주간 primary 하나이고 used는 49/59/84다. 요청 이력 없는 활성 예약도 있다. 이 snapshot은 사용자가 가리킨 미사용 계정이나 과거 차단 시점을 특정하지 않는다. 예약이 갱신되므로 드라이버가 전혀 작동하지 않는다고 단정할 수 없다. 이 수치만으로 다른 계정 데이터 혼입을 입증할 수 없다.

### 표시 순서와 화면 재생성: 경로 확인, 실제 혼입은 미확정

- `account_processor.rs:1687`의 한도 map은 `HashMap`이다. `usagePresentation.ts:42`는 `Object.entries` 순서를 그대로 표시한다. 여러 한도의 응답 map 순서가 바뀌면 시간과 잔여량의 화면 위치가 달라진다. 설치된 실제 presentation module에 같은 두 한도와 역순 map을 넣어 순서와 HTML이 달라지는 것을 확인했다. 사용자의 해당 카드에 여러 한도가 있었는지는 확인하지 않았다.
- `usageWindowService.ts`는 15초 poll의 성공 응답마다 내용 비교 없이 change를 낸다. `usageView.ts:64`가 render를 호출하고 standalone은 webview HTML 전체(`:565`), embedded는 `scripts/inject-account-settings.cjs:27`의 shadow-root `innerHTML` 전체를 교체한다. 값이 같아도 DOM을 다시 만들어 깜박임을 유발할 수 있다. 실제 화면의 주기·모양은 계측하지 않았다.
- UI cache는 profile/workspace key와 generation을 쓰며 요청 profile 및 응답 workspace를 검사한다. 설치된 coordinator의 두 계정 요청을 역순 완료한 합성 검사에서는 값이 섞이지 않았다. 전체 서버/auth/UI 경로에 혼입이 없다는 보장은 아니다.
- `resetText`는 입력 절대 reset을 남은 시간으로 표현한다. 재렌더만으로 같은 값이 7일에서 며칠로 바뀌지는 않는다. 실제 값 교대는 한도 순서 변경, 서버 reset 변경, identity 또는 응답 순서 중 무엇인지 추가 근거가 필요하다.

## 권장 수정

1. 프로필별 일반 사용 허가는 요청 auth와 응답 account/user의 일치를 기준으로 보존한다. 선택 계정에만 허용하는 upsell/CTA 조건은 별도로 유지한다. 허가 false/누락 및 identity 불일치는 계속 차단한다. 저장 프로필 metadata와 auth 일치도 확인한다. 전역 계정 전환을 우회 해결책으로 사용하지 않는다.
2. `codex` 우선과 나머지 고정 limit ID 순서로 한도를 정렬한다. profile/workspace/user/limit/duration을 안정적인 렌더 key로 삼는다. 동일한 자동 상태 응답의 change를 생략하고 변경된 카드/문구만 갱신한다. 설정 ON/OFF와 실제 예약·확인·차단 상태를 구분하는 간결한 UI를 권장한다. 추가 상태 표시는 현재 단순 버튼 계약의 변경이므로 구현 전에 사용자 선택을 반영한다.
3. 기존 진단 경로에 계정 해시 참조, 조회 시작/완료 시각, generation, limit ID/기간/resetAt, 상태 전이와 허가 제거 사유를 남겨 같은 계정·같은 한도의 값 교대인지 확인한다. 토큰·이메일·응답 body는 기록하지 않는다.
4. 수정 적용 뒤 기존 차단 예약은 잠금 아래 fresh check로 재평가하되 수동 ON/OFF, 요청 이력, attempt guard와 미확정 요청 보호를 유지한다. 예약 삭제나 guard 초기화로 해결하지 않는다. 실제 최신 기록에는 주간 guard도 있으므로 이를 지우면 중복 요청 위험이 있다.

## 후속 검증과 보존

- 선택 계정 A와 비활성 대상 B의 합성 서버로 `azrael_usage → 허가 변환 → autoWindowTick → inference` 전체를 검증한다. B의 bearer/account/user, 요청 1회, A 선택 유지가 기준이다. 허가 false/누락·identity 불일치·단순 429·조회 실패는 요청 0회다.
- 고정/이동 reset, 0% 반올림, 5시간·주간 단독/동시, alias/멀티창 잠금, 재시작, timeout/미확정 요청을 확인한다. 티켓 비소비와 중복 요청 방지는 유지한다.
- 두 계정·여러 한도의 map과 응답 순서를 섞어 카드 값과 행 순서가 유지되는지 검사한다. unchanged tick은 DOM/focus를 유지하고 changed reset만 갱신한다. standalone/embedded 및 밝은/어두운 테마의 Windows 렌더·회귀를 확인한다. Linux/macOS 수용은 구분한다.
- 설치 및 reload 후 실제 비활성 계정 요청과 서버 timer 시작의 최종 확인은 후속 실행 권한 안에서 진행한다. mock 성공을 서버 timer 시작의 증거로 쓰지 않는다. 소유 설계는 구현 승인 후 필요한 부분만 갱신한다.

## 최초 조사에서 수행한 확인

- `node` stdin 검사 1: 설치된 presentation module에서 map 역순에 따른 HTML 변경, 고정 engine 소스의 선택 계정 filter 존재, 동일/비활성 계정 허가 predicate를 확인했다. 실제 exit 0, assertions passed. Rust native 또는 실서버 검사는 아니다.
- `node` stdin 검사 2: 설치된 UsageRefreshCoordinator에서 두 계정 요청의 역순 완료 후 A=700/B=200 reset을 유지했다. 실제 exit 0. 전체 UI나 실인증 검사는 아니다.
- 최초 조사에서는 제품 코드 및 실계정 상태를 수정하지 않았다. 후속 승인에 따른 소스 수정과 검증은 아래 실행 기록을 따른다.
- 작업 문서 생성에서 `python`이 PATH에 없어 첫 실행은 시작되지 않았다. 설치된 Python313 절대 경로로 할당 도구가 DI-01을 정상 생성했다. 임시 입력은 일반 삭제 후 부재를 확인한다.


## 승인된 실행 범위와 검증 계획

사용자는 결함 수정 후 실계정 정상 동작을 직접 확인하기로 했다. 버튼 이름은 `Timer Unfreeze: 켜짐/꺼짐`으로 확정했다. 추가 상태 UI나 새로운 keyed DOM 렌더 계층은 추가하지 않는다. 동일 데이터/markup 갱신 억제와 한도 정렬을 적용하며 실제 변경 markup의 기존 전체 교체 경로는 유지한다.

엔진에서는 일반 선택 계정 read와 profile-scoped read를 구분하고, upsell은 활성 계정 기준을 보존한다. 프로필 auth와 metadata도 검사한다. 예약 정책·주기별 attempt guard·전송 실패 재시도 정책·reset ticket 비소비는 변경하지 않는다. 기존 예약의 새 정책 migration은 이번 수정에서 필요하지 않으며 로컬 사용자 예약을 변경하지 않는다.

선행 조건: 엔진 수정과 unit test 입력 확정 → 독립 Git metadata의 고정 엔진 소스 준비 → 기존 Cargo preflight/실제 library 테스트. UI 입력 확정 → 현재 extension 준비 컴파일 및 테스트 → standalone/embedded 밝은/어두운 렌더. 두 검증은 동일 Cargo cache를 경쟁하지 않는다. 출력과 로그는 DI-01 실행 그룹에 귀속한다. source 수정 뒤 제품 패키징/설치가 없으므로 현재 실행 중인 설치본에는 아직 반영되지 않는다.


## 수정과 검증 진행

엔진은 profile-scoped 허가를 해당 프로필 auth 기준으로 판정하고, selected-account read 및 upsell의 active-account 확인을 보존한다. 저장 profile metadata도 검사한다. UI는 Codex 우선 고정 정렬, 동일 schedule/error 알림 억제, 패널·client별 동일 markup 전달 억제, shadow DOM 중복 교체 억제를 적용했다. 실제 변경 markup은 기존 전체 교체 경로를 유지한다. 버튼은 `Timer Unfreeze: 켜짐/꺼짐`이다.

- 읽기 전용 TypeScript 형식 검사: `node extensions/azrael-ex/node_modules/typescript/bin/tsc -p extensions/azrael-ex/tsconfig.json --noEmit --incremental false`, 실제 exit 0.
- `node --check`로 변경 JS/CJS/MJS 및 검증 driver 문법 확인, 실제 exit 0. feature manifest 검증도 통과했다.
- `node --test scripts/test-usage-window-ui.cjs scripts/test-account-settings.cjs`: 41/41 passed, 실제 exit 0, 10.8초. 추가한 source test loader의 최초 실행은 compiled-layout media 경로를 source에서 찾지 못해 1개 suite 실패(exit 1)했다. 소스 경로와 compiled media 경로를 연결하는 test-only adapter를 수정한 뒤 전체 재실행이 통과했다. 제품 분기나 기존 검사를 약화하지 않았다.
- native project_tests 실행은 project `maintenance.lock` 때문에 시작되지 않았다. 소유 엔진 PID 61016이 실행 중이며 잠금 파일을 제거하지 않았다. native verification producer 등록도 별도 lifecycle `catalog.lock`이 있어 출력 생성 전에 실패했다. failed producer나 Rust 테스트를 시작한 것으로 간주하지 않는다.
- 두 잠금은 2026-10-23 01:06:25 KST 생성된 상태였다. 파일 이벤트 기반 대기로 해제를 기다리며 10분 checkpoint를 둔다. source-only 검사는 파일 출력·dist 갱신·catalog 쓰기를 하지 않아 독립 실행했다. 실제 생성물/브라우저/Cargo 실행은 등록과 자원 조건이 충족된 뒤 진행한다.
- UI 담당자의 소스 handoff와 CRLF-aware diff 검사 exit 0을 재사용했다. 루트가 변경을 통합 검토했으며 다른 작업의 수정은 stage하지 않는다.

## ?? ??? ?? ??

- ?? ??? ?? 10? ??? exit 1(timeout)? ???? ? ??? ?? ???. ?? ????? ????? registry ??? ?? ???. ???? ??? producer? ???? ?? ??? ???? ???? ???.
- ?? ??? ?? extension-current ? ?? ?? ??? ?? ??? ???? ???. ?? read-only UI source ???? 41/41 ?? exit 0?? ????. ?? dist? ???? ? ??? ????? ???? ???.
- native source ??? ??? ??? driver? lifecycle ?? ???? ???? clone?snapshot?Cargo ?? ?? ???. ??? ??? ?? driver ??? ????. ??? artifacts/build/di1? DI-01 native-01 run ??? ???? ???? ????. ??? test profile/browser/source snapshot? ??. ?? ?????????? ?? ??? ?? ???? ?? ???.
- JS ??, TypeScript noEmit ??, feature manifest, CRLF-aware ?? ??? ????. ?? Rust compile/library tests, compiled extension tests, standalone/embedded browser light/dark/narrow ??? ?????. docs/ops/development.md? account ??? ?? ??? ????, ?? feature inventory? source/native ??? ????.
- ?? ??? ???? ?????? task-level commit? ????. ?? ?? ??? stage??? commit?? ???. ?? ?? ??? ?? ? ?? ???? ??? ???? ?? ? ?? ??? commit??. ?? ??????? ?? ??? ??? ???? ??? timer ??? ???? ????.

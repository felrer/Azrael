상태: 승인된 RouteScope 연결 수정과 소스 검증 완료. 빌드·설치 및 실제 앱 검증은 미수행이며 실제 앱 검증은 사용자가 담당.

# /btw 오류 원인 조사

- 요청: `/btw`의 `Missing scope instance` 원인 조사 및 현재 화면의 RouteScope 전달 수정. 사용자가 실제 앱 검증을 맡음. 소스 수정·관련 자동 검증·작업 커밋 범위이며 빌드·설치는 이번 요청에 포함되지 않음.
- 범위: 공통 UI 상태 범위 연결 문제. Windows 설치 2026.0.7 자산을 확인했으며 다른 플랫폼 실행은 검증하지 않음.
- 조사 순서: 오류 선언 → `/btw` 명령 등록 → 네이티브 Side chat 생성기 → 설치 자산 및 기존 검증 범위 비교.
- 근거: `scripts/inject-btw.cjs`의 `__azraelRegisterBtw`가 전달받은 scope를 `__azraelTryBtw`에 전달하고, `__azraelOpenBtwPanel`이 그대로 `gJi`에 전달한다. 네이티브 `rDa`는 `Ou($)`로 AppScope를 읽는다. `gJi`의 첫 상태 조회 `e.get(tj)`에서 `tj`는 RouteScope인 `Ev`에 속한다. RouteScope의 부모는 ThreadScope, 그 부모는 AppScope다. 부모 범위에서 자식 범위를 조회할 수 없어 해당 오류가 발생하는 경로가 있다.
- 설치 확인: `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.7/webview/assets/`의 명령 등록과 패널 생성 코드에도 같은 연결이 존재한다.
- 검증 공백: `scripts/test-btw.cjs`는 패널 생성 `gJi`와 scope를 가짜 객체로 대체한다. `docs/architecture/side-questions.md`는 설치 호스트와 전체 slash popup 검증을 별도 미완료 범위로 명시한다. 사용자 화면 오류의 런타임 스택은 확보하지 않았으므로 특정 이벤트의 정확한 스택은 미확인이다.
- 구현: 명령을 등록하는 native `rDa`에서 기존 `Ou(Uf)` hook으로 RouteScope를 읽어 `/btw` 등록에 전달. 직접 입력은 기존 composer scope와 route ancestry를 유지. 공통 UI 변경이며 Windows에서 소스 검증, 다른 OS 실행은 미검증.
- 소유권: `scripts/inject-btw.cjs`, `scripts/test-btw.cjs`, 관련 architecture와 이 계획. 기존 checkout의 다른 변경은 작업에 포함하지 않음.
- 검증: 실제 native `rDa`를 실행해 상태 resolver의 AppScope 실패 및 RouteScope 성공, 실행 중/중지 상태와 rerender에서 명령 경로를 확인. 기존 `/btw` 테스트로 격리·직접 입력·전달 동작 보존 확인. UI 표현은 변경하지 않으며 실제 설치 화면은 사용자가 검증.
- 완료 기준: 소스 수정과 관련 검증 통과·작업 커밋, 미설치 및 사용자 검증 범위 명시.
- 제한된 재현: pinned 자산의 실제 `DK`/`OK` scope resolver를 추출해 Node VM에서 실행. AppScope와 해당 인스턴스 맵에서 RouteScope 조회는 `Missing scope instance`, RouteScope 자체에서 조회는 성공. 종료 코드 0. 이는 resolver 동작 검증이며 전체 설치 UI 재현은 아니다.
- 결과: `node --test scripts/test-btw.cjs` 16/16 통과, 종료 코드 0, 실행 140.676초. 로그: `artifacts/logs/btw-scope-diagnosis/tests.log`. 실제 `rDa` 등록 및 AppScope/RouteScope resolver 경계의 회귀 검증 포함. `git -c core.whitespace=cr-at-eol diff --check` 종료 코드 0. 기존 tracked CRLF 파일의 줄바꿈 정책 유지.
- 수용 한계: UI 외형은 그대로이며 별도 렌더 검사는 실행하지 않음. 실제 설치본 및 light/dark 화면 상호작용 수용은 사용자 검증에 남음. 설치된 2026.0.7 파일은 수정하지 않았으므로 소스 반영만으로 실행 앱에 적용되지 않음.

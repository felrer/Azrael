상태: 승인된 ComposerScope 수정과 소스·렌더 검증 완료. 설치 앱 반영과 실제 구 세션 수용은 별도 빌드·설치 후 확인 필요. 검증 자료의 관리 등록·검토·보류 결정과 임시 프로필 정리 완료.

# /btw ComposerScope 연결 수정

## 요청과 범위

- 사용자는 수정된 버전에서도 `/btw` 사용 시 `Missing scope instance`가 발생한다고 확인했고, 조사 후 권장 수정의 구현을 승인했다.
- 허용 범위는 코드 수정·관련 검증·문서 갱신·작업 커밋이다. 제품 전체 빌드·재설치·사용자 창 reload·실제 모델 요청은 포함하지 않는다.
- 공통 UI 변경으로 Windows x64·Linux x64·macOS ARM64에 같은 의미가 적용된다. 이번 실행 검증은 Windows x64의 Node/pinned UI fixture에 한정하며 다른 플랫폼 실행을 수용한 것은 아니다.

## 원인과 변경

- 이전 `e15a4964` 수정은 메뉴가 AppScope 대신 RouteScope를 전달하도록 했다. 그러나 이어지는 `__azraelTryBtw`의 `scope.get(QG)`는 ComposerScope를 요구해 동일 오류가 발생할 수 있었다. 이전 설치본 잔류를 주된 설명으로 제시한 초기 권고는 사용자 확인과 추가 조사로 정정했다.
- pinned composer의 실제 `QG=ou(Dh,...)`에서 Dh는 side 모듈의 e2t/Iv이며 `ComposerScope`의 부모는 RouteScope인 Ev다. DK/OK는 조상 탐색과 instance map 조회 모두 실패하면 해당 오류를 던진다.
- `scripts/inject-btw.cjs`: native `rDa`에서 기존 `Ou(Dh)` hook으로 현재 ComposerScope를 확보해 메뉴 등록에 전달한다. 첨부 확인은 ComposerScope, native 패널 생성은 그 RouteScope 조상으로 해결한다. native 상위 `mka`도 이미 같은 ComposerScope hook을 사용하므로 새 상태 체계를 만들지 않았다.
- `scripts/test-btw.cjs`: 실제 QG 초기화·scope import/owner 계약·DK/OK resolver와 실제 메뉴/helper/controller를 연결한다. route-only 첨부 조회 실패, 실행 중 본 작업, 합성 세션 복원·전환·재방문, 첨부 거부 및 직접 입력을 검증한다. parent transcript와 자동 inference 금지를 보존한다.
- `docs/architecture/side-questions.md`: 현재 scope 전달 계약과 fixture 수용 경계를 갱신했다. 기존 feature `ui.btw`의 소유 코드와 behavior/transform-fixture/namespace-cache-owner 검사 연결은 유지했다.
- `project-maintenance.json`: 해당 세 파일의 검사 명령을 재사용하는 retained `source-btw` 묶음을 등록했다. 불필요한 전체 UI 디렉터리 대신 실제 고정 JS 5개와 TS 파일을 입력으로 지정한다. 새 UI transform shared cache는 비활성화한다.
- 구 세션 날짜나 구 버전을 차단하는 조건은 없으며 scope는 현재 UI의 메모리 상태다. 저장 데이터 마이그레이션은 필요 없다. 실제 사진의 throw 위치와 저장된 구 세션 복원은 런타임 스택·설치 검증으로 별도 확인해야 한다.

## 검증 결과

- `node --test --test-concurrency=1 scripts/test-btw.cjs scripts/test-ui-test-transform-fixture.cjs scripts/test-namespace-cache-owner.cjs`: 26/26 통과, 실패·취소·생략 0, 종료 코드 0. 약 215.6초. 시작 2026-10-16T18:04:25Z, 종료 18:08:01Z. 로그 `artifacts/logs/BB-01-composer-scope/source-tests.log`, 실제 종료 기록 `source-tests-exit.json`.
- 새 회귀 검증은 route-only scope의 실제 QG 조회가 동일 오류를 내는 것을 확인하고 ComposerScope 경로의 성공을 검증한다. 직접 입력·격리·후속 질문·명시적 전달·첨부 제한 및 rerender 동작의 기존 검증도 통과했다. 새 합성 복원 fixture를 실제 저장 세션의 재현으로 확대 해석하지 않는다.
- `node scripts/verify-btw-render.mjs`: light/dark·좁은 폭·메뉴 클릭과 키보드·답변/선택 전달·실행 중 제한·실패 표시 등 20개 통과, 종료 코드 0. `summary.json`, `render.log`, `light.png`, `dark.png`를 위 로그 루트에 보관한다. 두 테마 화면도 확인했다. native React/CSS와 합성 host/chat을 사용하며 전체 slash popup 및 설치 앱 scope 복원 수용과 구분한다.
- `node --check`로 수정한 두 JS 파일 파싱 확인, 종료 코드 0. `git -c core.whitespace=cr-at-eol diff --check` 통과. 기존 tracked 파일의 줄바꿈 정책을 유지했다.
- 관리 도구의 최초 전체 assets plan은 19,367개 파일의 입력 해싱으로 지연되어 실제 검사 파일로 좁힌 plan으로 대체했다. 광범위 read-only 요청의 functions cell 24는 종료했으며 내부 요청의 최종 완료는 확인되지 않았다. 해당 plan은 테스트 producer를 시작하지 않았다.
- 좁힌 plan의 내장 실행 `run-32256-364-1792173835386860100`은 입력 무결성 valid였지만 10초 경계에서 종료 코드 124로 실패했다. producer_completed=true, session_id=null을 확인한 뒤 동일 명령을 새 exec 세션에서 실행해 위 26/26 결과를 얻었다. 중단된 실행을 통과로 취급하거나 중복 producer를 시작하지 않았다.

## 생성물과 수용 한계

- root가 `artifacts/logs/BB-01-composer-scope`의 전체 실행·렌더 자료를 단일 작업 그룹으로 소유한다. 생성 전에 이 기록에 writer와 경로를 지정했다. 생성한 Chrome 종료와 `artifacts/verification/BB-01-composer-scope` 프로필 디렉터리 부재를 확인했다. 제품 설치 파일과 사용자 상태는 수정하지 않았다.
- 검토 결정: 로그·요약·스크린샷은 설치판에서의 구 세션 검증과 인계를 위해 보류한다. 재검토 조건은 이 수정을 포함한 패키지 설치·실제 구 세션 검증이 완료되고 독립적으로 읽을 수 있는 최소 검증 증거를 보존한 때다.
- 기존 maintenance lock(pid=32256)으로 첫 등록이 거부됐으나 이후 잠금 파일의 정상 해제를 확인했다. live engine이나 잠금을 강제 종료·삭제하지 않았다. 내장 inventory에 `BB-01-composer-scope-20261017` 그룹과 `BB-01-composer-scope-evidence`(46,388바이트)를 등록하고 review 후 위 재검토 조건으로 defer를 적용했다. 작업 기록의 검증 참조를 보존하며 임시 프로필은 남지 않는다.
- 소스 수정과 관련 검사 수용은 완료했다. 제품 빌드·재설치, 실제 구 세션의 메뉴/직접 입력 재현, 다른 플랫폼 및 실제 provider 수용은 미수행이다.

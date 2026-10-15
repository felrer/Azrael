상태: 소스 수정·검증 완료 — 별도 앱 빌드/설치 요청 없음.

# 슬래시 메뉴 항목 정리

요청 및 권한: `/` 목록의 초고속과 상태 항목 제거. 소스 수정과 필요한 검증 및 작업 커밋. 전체 앱 빌드/설치/배포는 요청되지 않음.

범위: Windows x64, Linux x64, macOS ARM64 공통 webview 표시 정책. 실제 검증은 Windows에서 pinned UI 소스/실행 fixture로 수행하며 다른 OS 및 설치 앱 수용은 별도.

설계와 구현: `ui.ui-cleanup`의 기존 guarded transform을 재사용한다. `tka` 상태 등록/마운트를 제거하고 `vOa`의 옵션 등록에서 ultrafast만 제외한다. Fast 등록, 모델 선택기의 속도 설정, 상태 서비스와 기타 명령을 보존한다. 기존 라이브러리로 충분하며 새 의존성 불필요. 설계 소유자는 `docs/architecture/ui-presentation.md`.

순서와 검증: root 단독으로 문서와 transform 수정 → 기존 UI cleanup/provider 모델 테스트 확장·실행 → light/dark 실제 렌더/상호작용 검증 → 변경 검토/정리/해당 작업만 커밋. 기존의 다수 staged/unstaged 변경은 별도 작업으로 보존한다.

성공 기준: 상태 등록 및 마운트 부재, ultrafast 옵션의 slash 등록 부재, Fast 등록/동작 및 모델 설정 경로 유지, pinned parsing/idempotence/anchor 검사 통과. 검증 로그는 새 세션의 artifacts/logs 아래 작업 소유로 보관하고 fixture는 실행 종료 확인 뒤 정리한다.


## 실행 결과

- 구현: 기존 `ui.ui-cleanup`에 상태 등록/마운트 제거 및 ultrafast 옵션의 slash 등록 제외를 반영했다. `docs/architecture/ui-presentation.md` 소유 계약과 기존 inventory의 `ui.ui-cleanup.behavior` 검사에 연결했다.
- Windows 검증: `node --test scripts/test-ui-cleanup.cjs scripts/test-provider-model-picker.cjs` 46개 통과, exit 0. `node --test scripts/test-namespace-cache-owner.cjs` 7개 통과, exit 0. 로그: `artifacts/logs/BR-01-slash-menu-cleanup/source-tests.log`, `cache-owner-tests.log`.
- 실제 렌더: `node artifacts/logs/BR-01-slash-menu-cleanup/render-fixture.mjs` exit 0, 9개 검사 통과. Pinned native speed registrar와 slash row/React/CSS를 사용하고 모델 설정·명령 registry와 기타 명령은 fixture 경계로 대체했다. light/dark에서 두 항목 부재, Fast 및 Btw 보존, 각 선택 콜백을 확인하고 PNG를 검토했다. `render/summary.json`, `render/light.png`, `render/dark.png`, `render-run.log`에 근거를 보관한다. 전체 composer 및 설치 앱 검증으로 일반화하지 않는다.
- fixture 초기 시도는 순환 모듈의 초기화 전에 hook factory를 호출해 실패했다. 초기화를 React fixture 실행 시점으로 옮긴 뒤 통과했다. 제품 코드 추가 변경은 없었다.
- 정리: task 전용 Chrome 종료 확인 후 `artifacts/verification/BR-01-slash-menu-ui`의 profile/fixture를 일반 삭제하고 부재를 확인했다. 로그·PNG·작은 재현 runner는 검증 증거로 보관하며 다음 설치 수용 검증 후 재검토한다. 앱 패키지나 설치 상태는 변경하지 않았다. Linux/macOS native 실행은 수행하지 않았다.
- 종료: 아래 네 파일만 작업 단위 커밋에 포함한다. 기존 다른 작업의 staged/unstaged 변경은 보존한다.

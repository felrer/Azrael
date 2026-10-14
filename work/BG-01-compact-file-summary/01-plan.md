상태: 소스 구현·화면 검증 완료. 전체 앱 빌드·설치는 별도 실행 범위.

파일 편집 요약에서 실행 취소·변경 사항 보기 버튼을 제거하고, 작은 아이콘과 편집 문구·증감 수치를 한 행에 배치한다. 헤더 상하 여백 및 파일 목록 행 높이를 줄인다. 기존 목록 클릭, 보조키 파일 열기, 더 보기와 단일 파일 열기를 보존한다.

공통 UI 변경: Windows x64, Linux x64, macOS ARM64의 공유 webview 변환이 대상이다. 검증은 Windows의 pinned React/CSS 실제 렌더링(밝음/어두움, 좁은 폭)과 기존 UI 변환 검사로 수행한다. 패키징·설치와 다른 OS 네이티브 실행은 이번 범위에 포함되지 않는다.

소유자: scripts/inject-ui-cleanup.cjs, docs/architecture/ui-presentation.md의 파일 편집 요약 계약. 기존 네이티브 카드·아이콘·통계·목록 컴포넌트를 재사용한다. 생산 변환 → 실제 컴포넌트 화면 검증 → 관련 검사 → 산출물 정리 및 작업별 커밋 순서로 진행한다.

성공 기준: 버튼 제거, 한 행 정렬, 아이콘 축소, 높이 감소, 양 테마 가독성 및 목록 클릭 보존. 결과와 근거는 이 문서에 갱신한다.

검증 결과:
- `node --test scripts/test-ui-cleanup.cjs scripts/test-asset-transform-cache.cjs`: 19개 통과, 종료 코드 0. 약 254초. 로그: `artifacts/logs/compact-file-summary/source-tests.log`.
- `node scripts/verify-file-summary-render.mjs`: 19개 화면·동작 조건 통과, 종료 코드 0. Windows Chrome, 실제 pinned React·카드·파일 행·CSS를 사용하고 host·번역 값·파일 메뉴/inline diff wrapper 경계는 synthetic fixture로 제공했다. 밝음/어두움·360px 폭을 확인했다. 파일 목록 callback과 보조키 전달, 단일 파일 키보드 열기가 검증 범위이며 실제 host의 diff 열기/파일 메뉴 전체 실행은 별도다.
- 테두리 포함 2개 파일 카드: 139px → 103px(약 26% 감소), 헤더 36px, 목록 행 32px, 아이콘 영역 24px/도형 16px. 실제 이미지를 확인했다.
- [밝은 테마](../../artifacts/logs/compact-file-summary/render/light.png), [어두운 테마](../../artifacts/logs/compact-file-summary/render/dark.png), [좁은 화면](../../artifacts/logs/compact-file-summary/render/narrow.png), [측정 및 결과](../../artifacts/logs/compact-file-summary/render/summary.json).
- 기능 보존 목록 검증 및 변경 diff 공백 검사 통과. 기존 dirty 변경은 보존하며 이번 기능 목록 변경만 별도로 stage한다.

검증 중 발견한 단일 파일 onClick 연결 누락을 수정했다. fixture의 모듈 초기화·번역 컨텍스트·ref·선택자 문제를 정리한 뒤 최종 검증을 통과했다. 각 실행 종료 후 브라우저 종료 및 소유 fixture/profile 제거를 확인했으며 이미지와 소형 로그만 보존한다. 전체 앱 빌드·패키징·설치, Linux/macOS 네이티브 수용은 수행하지 않았다.

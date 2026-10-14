상태: 소스 수정 및 Windows 검증 완료. 사용자 추가 조치 없음. 설치본 반영은 별도 빌드·설치 필요.

자동 압축 안내의 한국어 문구를 사용자 지정 문구 `이 대화에만 적용`으로 교체한다. 허용 범위는 해당 안내 한 곳의 소스 수정과 검증·작업별 커밋이다. 미결 사항 없음.

플랫폼 공통 표시 문구 변경이며 Windows에서 기존 provider-context 검사와 light/dark 렌더 검증을 수행한다. 설정 동작과 영문·레이아웃 계약은 유지하므로 architecture 및 feature inventory 변경은 불필요하다. 전체 빌드·설치는 요청 범위에 포함되지 않는다. 구현 소유자는 scripts/inject-provider-context.cjs이며 기존 컴포넌트를 재사용한다.

성공 기준: 한국어 정상 상태 안내가 정확히 지정 문구이며 기존 저장·오류 동작 검사를 통과한다. 실제 설치본 반영은 별도 빌드·설치가 필요하다.

검증 완료: Windows에서 `node --test scripts/test-provider-context.cjs` 19/19 통과(종료 코드 0), `node scripts/verify-context-compaction-render.mjs` light/dark 네이티브 UI 렌더·상호작용 통과(종료 코드 0). 로그: `artifacts/logs/compaction-copy/provider-context.log`, `artifacts/logs/compaction-copy/render.log`, `artifacts/logs/compaction-copy/render/summary.json`. 렌더 fixture/profile은 기존 guarded cleanup으로 제거했다. `git diff --check` 통과. 앱 패키징·설치 및 Linux/macOS 실행은 수행하지 않았다.

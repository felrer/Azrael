상태: 완료 — 승인된 폰트 선택 규칙을 소스에 반영하고 Windows 렌더링·플랫폼 정책 시뮬레이션 검증 및 정리를 완료했습니다. 다음 전체 빌드·재설치에 포함됩니다.

# 플랫폼별 동봉 폰트

사용자 승인: 앱에 Cascadia Mono를 포함하고 Windows는 Consolas 우선/미설치 시 Cascadia Mono, 다른 플랫폼은 Cascadia Mono 기본. 한글은 기존 경기천년제목 Light 유지. 소스·폰트 자산·검증·문서·작업 커밋 범위이며 전체 빌드/설치/게시 지시는 없음.

- 분류: 혼합. 공통 폰트 동봉·로컬 로딩·한글 유지, 데스크톱 Windows는 시스템 Consolas 우선, macOS/Linux는 설치된 Consolas 유무와 무관하게 Cascadia Mono 우선. Windows x64, Linux x64/glibc, macOS ARM64 제품 대상이며 CPU와 독립적인 웹뷰 표현 변경. Remote SSH/컨테이너의 지원 확장은 없음. 웹뷰의 OS를 기준으로 선택.
- 보존: OpenAI 기본 폰트 모드, 고정 UI 서체, 기존 크기·행간, 한국어 Light 및 합성 굵기 억제, 코드의 자연스러운 공백, Windows Consolas의 U+0020 반폭 공백. Cascadia Mono의 공백은 자연 폭.
- 구현 소유: root — `scripts/content-fonts.cjs`, 주입기/캐시 의존, `usagePresentation.ts`/`usageView.ts`, 폰트 설정 문구·테스트, UI 계약·보존 목록. font_assets — 공식 Cascadia Mono upright/italic WOFF2·라이선스·출처와 공지.
- 재사용: 기존 로컬 폰트 복사/해시 검증/asset transform과 브라우저 렌더 테스트를 확장. 시스템 폰트 탐지 라이브러리 대신 CSS fallback 재사용. frontend OS 속성으로 공통 CSS 변수를 선택하며 shadow DOM은 해당 변수를 상속.
- 실행 순서: 공식 자산 확보와 코드 구현 병행 → 자산/선택 정책 통합 → targeted TypeScript·주입/캐시 검사와 밝은/어두운 Chromium 실제 glyph 검사 → 문서/변경 검토 → 작업만 커밋.
- 성공 기준: 공식 bytes/hash와 라이선스 동봉 및 패키징 자산 복사 검사, Windows Consolas/미설치 fallback 및 nonWindows Cascadia glyph 검사, 한글 Title Light·기존 공백·OpenAI 설정/고정 UI 보존. 실제 Windows Chromium 검사와 다른 플랫폼 정책 시뮬레이션을 구분. Linux/macOS 네이티브 화면은 이번 실행에서 미검증.
- 실제 기록: 2026-10-13 구현 시작. 전체 앱 빌드는 build playbook의 명시 지시 조건에 따라 수행하지 않음. 검증 결과·정리·커밋은 아래에 갱신.

## 실행 및 검증

- 공식 `v2407.24` Cascadia Mono WOFF2 upright 210,484바이트, italic 153,708바이트와 OFL 원문 확보. archive/file hash 및 원본 동일성·가변 weight 200–700 확인, 종료 코드 0. 임시 다운로드는 삭제·부재 확인.
- `npm run build:incremental --prefix extensions/azrael-ex` 종료 코드 0. 계정 표현/standalone 테스트 19개 종료 코드 0; `scripts/test-student-design.cjs` 24개 종료 코드 0. `vsce ls --no-dependencies` 종료 코드 0, 정책 CJS·WOFF2·라이선스·provenance 수록 확인. 로그: `artifacts/logs/bundled-content-fonts/`.
- 최초 전체 폰트 검사의 미설치 assertion 실패(종료 코드 1)는 Chromium의 가변 폰트 실제 PostScript 이름과 검사 기대값의 차이였습니다. 실제 이름은 `CascadiaMonoRoman`, `CascadiaMonoRoman-Bold`, `Cascadia-Mono-Italic`입니다. CDP의 custom glyph/실제 family를 확인한 뒤 기대값을 수정했고, 미설치 fixture의 OpenAI 왕복 비교에 같은 미설치 baseline을 적용했습니다. 제품 fallback 구현은 변경할 필요가 없었습니다.
- 최종 `scripts/test-content-fonts.cjs --browser-only` 종료 코드 0: Windows Consolas 및 미설치 Cascadia, Linux/macOS navigator 정책, 실제 upright/bold/italic glyph, 한국어 Light, 자연 공백과 Windows 반폭 공백, shadow DOM·밝은/어두운 테마·OpenAI 왕복 통과. `--source-only` 종료 코드 0: 5개 production 주입 경로/파싱·재주입·anchor 검사 및 9개 자산 복사/해시 통과. 로그와 JSON: `artifacts/logs/bundled-content-fonts-final/`. 8개 screenshot 시각 검사 완료.
- 캐시 전체 검사 TAP 12개 통과(`asset-cache.log`, 약 429초). 대기 중 harness 수동 재개로 기존 PTY 종료 코드 조회가 사라져, 폰트 정책 관련 캐시 검사를 별도 실행해 종료 코드 0 확인(`asset-cache-targeted.log`). 신규 공통 정책과 초기화 JS/CSS의 캐시 무효화, 폰트 자산의 CSS 한정 의존 확인. 전체 검사를 중복 실행하지 않았습니다.
- 최종 확장 컴파일/계정 테스트 19개 종료 코드 0. 소스 검증 재실행은 검사 기대값 및 줄 끝 보존을 최종 입력으로 확인하기 위한 것이며 제품 폰트 정책은 동결했습니다. 임시 진단 브라우저는 정상 종료 및 소유 프로세스 부재 확인.
- `.gitattributes`에서 공식 OFL 원문의 CRLF 바이트를 `-text`로 보존합니다. Git index에서도 upstream SHA256 일치를 확인했습니다(종료 코드 0). 라이선스 원문은 수정하지 않았으므로 그 파일의 원문 공백을 제외한 staged diff whitespace 검사 통과.
- 정리: 프로젝트 정리 도구의 선택 결과 확인 후 `bundled-font-diagnosis`, `bundled-content-fonts`, `bundled-content-fonts-final`, `bundled-content-fonts-source` 임시 fixture를 삭제하고 부재 확인(종료 코드 0). 정리 영수증은 `artifacts/logs/bundled-content-fonts-final/*-cleanup.json`, 결과 JSON·로그·렌더링 증거는 로그 폴더에 보존했습니다. 임시 계획/수정/스테이징 Python 파일도 삭제했습니다. worktree는 사용하지 않았습니다.
- 최종 변경은 기존 다른 작업의 model-harness/idle 변경과 분리했습니다. 공유 feature inventory와 namespace transform 파일은 폰트 소유/캐시 절만 스테이징했습니다. 원격 게시, 버전 변경, 전체 앱 빌드·설치는 수행하지 않았습니다.
- Linux/macOS는 navigator override 정책 검증 대상이며 네이티브 화면·설치 검증은 수행하지 않음. 이번 작업 전체 앱 빌드·설치·원격 게시 없음.

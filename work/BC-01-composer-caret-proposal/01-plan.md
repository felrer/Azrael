상태: 소스 수정·검증·정리 완료. 실행 앱 반영은 별도 빌드·설치 대상.

# 공백 폭 보존과 입력 커서·모델명 정렬

목표·권한: 공백 폭 50% 축소를 유지하면서 커서 높이를 복원하고 좌측 모델명 정렬을 수정. 화살표·Medium 위치와 크기, 기존 글꼴 정책 보존. 소스 수정·관련 문서·검증·작업별 커밋만 수행. 전체 앱 빌드·설치는 요청 범위에 포함되지 않음.

환경·영향: 수정 동작은 Windows/로컬 Consolas에 한정. 공통 shared policy 소비자는 chat/composer와 standalone·embedded account/usage. Windows 회귀, Consolas 부재 폴백, OpenAI 모드, 계정 shadow DOM 및 Linux/macOS policy 모의 분기를 확인. 실제 설치 앱, OS IME, 다른 OS native 실행은 미검증.

원인·해결: size-adjust:50% 공백 face가 첫 번째 글꼴의 세로 메트릭까지 축소해 커서 영역과 모델명 기준선을 바꿈. 기존 CSS ascent/descent/line-gap overrides로 원래 Consolas Windows 메트릭 복원. OS/2 usWinAscent=1884, usWinDescent=514, unitsPerEm=2048 및 50% 역보정을 사용. 공백 advance는 50%, 보이는 글자·기존 line-height는 유지. 새 폰트·의존성·위치 이동 스타일은 불필요.

소유권·계약: content-font-policy.cjs → content-fonts 생성 CSS 및 usagePresentation 공유 소비자. 기존 ui.content-fonts 기능·필수 검사 유지, UI architecture owning section 갱신. 다른 작업의 namespace·feature inventory 및 기존 작업 변경은 보존. 작업 worktree는 생성하지 않음.

검증 결과:
- node scripts/test-content-fonts.cjs --source-only: exit 0. pinned UI 26.1007.21434의 자산 5개 production transform/parse/repeat/anchor, B8 동적 leaf와 resource 9개 SHA/copy/cache dependencies 통과. 2026-10-14 KST 15:22:07~15:22:59. 로그 artifacts/logs/composer-caret/source/tests.log.
- node scripts/test-content-fonts.cjs --browser-only: exit 0. Windows Chromium 밝은/어두운 테마, 한글·영문·연속 공백 뒤 collapsed Range 높이 19px(정상 Consolas와 동일), 공백 비율 약 0.5009 유지. production B8 leaf의 기본 기준선 23px로 복원(legacy20px), Medium23px 및 화살표 geometry 불변. 모델명 3종 × CSS zoom 100/125/150% × 테마2의 18건 비교 통과. 계정 shadow DOM, native OpenAI 전환과 폴백·모의 Linux/macOS glyph 회귀 통과. 로그 artifacts/logs/composer-caret/final/browser.log 및 render-evidence-*.json/png.
- node --test scripts/test-content-fonts.cjs scripts/test-asset-transform-cache.cjs: cache 검사12건 통과. 전체 실행은 fractional zoom의 브라우저 비교 기준 오류로 exit1, 실제 경과255.5초. 다른 글꼴의 기본 rounding 차이를 정상-font 대조군과 비교하도록 정정하고 source/browser 분리 실행으로 모두 통과. 제품·cache 입력 변경 없음, 통과 cache 결과 재사용. 로그 artifacts/logs/composer-caret/final/tests.log.
- Windows 폰트 probe: legacy 9px → 복원19px, 공백폭 약8.8px →4.4px. artifacts/logs/composer-caret/probe/typography-probe.json. 125%에서는 정상 Consolas와 기본 UI face도 1px 차이가 있어 자연스러운 기존 글꼴 메트릭과의 정확한 일치로 검증.

입력 해시·실행 범위·한계는 artifacts/logs/composer-caret/verification-summary.json에 보존. 최종 source/browser 입력은 실행 중 유지. 제품 소스 변경의 재시작 없음; 실패 fixture 비교와 fractional-zoom comparator를 정정한 브라우저 재실행만 수행.

정리: 공식 clean-verification-artifacts.ps1로 task-owned immediate child fixture만 preview/apply. 최초 외부 pwsh 호출이 자신의 FixtureRoot 인자를 active command로 판정했으며 해당 producer 종료를 확인한 후 동일 PowerShell 내 직접 script invocation으로 재검사. probe/final/source 모두 deleted 및 실제 부재 확인. 소형 결과·로그·PNG만 artifacts/logs/composer-caret/에 보존. 각 실행의 cleanup-result.json과 browser-exit.json에 종료·정리 근거 보존.

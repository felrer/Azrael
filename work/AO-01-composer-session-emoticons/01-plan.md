상태: 소스 구현·Windows fixture 검증·정리 완료. 패키지 생성과 설치는 별도 요청 범위.

# 입력란 세션별 얼굴문자

사용자가 선택한 7개 얼굴문자 중 하나를 무작위로 선택하고 대화 세션별로 유지한다. `[•ᴗ•]`의 사용자 메시지 내 백틱은 앞선 후보의 Markdown 표기로 해석한다. 기존 입력 스타일·접근성·입력 동작을 보존한다.

공통 요구: Windows x64, Linux x64, macOS ARM64 공통 webview 변환. 실제 검증은 Windows의 Node와 Chromium이며 다른 OS 및 설치본 수용은 포함하지 않는다. 소스 구현·문서·필수 검증·작업 커밋 권한은 주어졌으며 전체 빌드·설치는 요청되지 않았다.

기존 `inject-ui-cleanup.cjs`의 `mPi`와 native composer scope key를 재사용한다. 세션 키에 연결된 선택을 webview localStorage에 저장하고 읽어 재렌더·모드 변경·대화 재방문·새로고침에서 유지한다. 저장 불가 시 현재 webview 메모리에서 유지한다. 아직 대화 ID가 없는 새 입력란은 native 초안 키를 사용한다. 신규 세션에 같은 후보가 다시 뽑힐 수 있다.

root가 UI 변환과 해당 기존 검사, `ui-presentation.md` 소유 절을 수정한다. 기존 기능 ID `ui.ui-cleanup`의 검사 파일을 확장하므로 별도 inventory 항목은 불필요하다. 다른 작업의 변경은 보존한다.

검증: pinned JavaScript 파싱·멱등성·변조 차단, 7개 선택 가능성, 세션별 저장/재방문/새 컨텍스트/저장 불가 시 안정성, 모든 composer 모드 유지. Windows Chromium에서 밝은/어두운 테마의 렌더링과 입력·지우기 확인. 결과·종료 코드는 이 기록에 남긴다. 패키지 생성·설치본 검증은 별도 범위다.

## 검증 근거

- `node --test scripts/test-ui-cleanup.cjs`: 7/7 통과, 실제 종료 코드 0, 실행 147.924초. 로그: `artifacts/tasks/AO-01-composer-session-emoticons/runs/source-tests-20261015/logs/source-tests.log`.
- 첫 검사 실행의 두 실패는 검사 fixture의 `get` 참조 및 `Math.floor` 누락이었다. fixture 수정 후 재실행해 통과했다. 제품 동작 변경을 통한 검사 우회는 없다.
- Chromium 검사: production `mPi`, pinned React/CSS, synthetic textarea. 밝은/어두운 테마, 입력/지우기, 세션 재방문, 새로고침 통과. 전체 native composer 및 설치본 검증과 구분한다. 브라우저 종료 확인 지연으로 정리 확인을 보완했다.
- 이번 소유 파일의 `git diff --check`: 종료 코드 0. 기존 타 작업 엔진 파일의 whitespace는 수정하지 않았다.
- 새 입력란의 native 초안 키와 첫 전송 후 생성된 대화 키는 다르므로 최초 세션 생성 시 한 번 다른 후보가 표시될 수 있다. 대화 ID가 있는 세션은 유지한다.
- 패키지 생성·설치 및 Linux/macOS 실행 검증은 수행하지 않았다. 별도 실행 요청 없이 전체 빌드하지 않는 build playbook을 따른다.

Chromium 최종 검사와 fixture 정리 실제 종료 코드: 0. 로그: `artifacts/tasks/AO-01-composer-session-emoticons/runs/chromium-render-20261015/logs/render.log`, `artifacts/tasks/AO-01-composer-session-emoticons/runs/chromium-render-20261015/reports/summary.json`, `artifacts/tasks/AO-01-composer-session-emoticons/runs/chromium-render-20261015/outputs/render/light.png`, `artifacts/tasks/AO-01-composer-session-emoticons/runs/chromium-render-20261015/outputs/render/dark.png`. fixture 경로 부재를 확인했다. 화면은 synthetic textarea이며 7개 후보 목록의 전체 가시성은 스크린샷 범위에 포함되지 않는다.

2026-10-15 산출물 구조 이전: 완료된 검증의 로그·보고서·이미지를 위 task/run 경로로 복사하고 원본과 SHA-256 일치를 확인하여 참조를 전환했다. 원시 파일에 내장된 옛 경로는 당시 실행 이력이며 내용을 고치지 않았다. 구 경로의 정리는 BI-01 작업에서 실제 부재 확인 후 기록한다. 이 이전으로 새로운 UI·설치본 검증이나 과거 소스 identity를 만들지 않는다.

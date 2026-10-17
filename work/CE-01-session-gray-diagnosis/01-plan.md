상태: 원인 재현·소스 수정·검증·생성물 정리 완료. 사용자 선택에 따라 빌드·설치는 제외한다.

## 목표·권한·범위
대상 `01a145a4-6052-7631-af69-4267e1fd0c15` 세션의 회색 화면 원인을 초기 읽기 조사를 수행했다. 후속 사용자 요청으로 심층 분석·격리 재현·원인 수정·검증이 승인됐다. 사용자 원본 대화와 실행 중인 창은 보존하며 현재 창 재시작은 수행하지 않는다. Windows x64 로컬 VS Code 1.142.0 / Azrael 2026.0.10 조사이며 다른 OS 재현은 주장하지 않는다.

사용자는 최근 10분 안에 대화 본문을 포함한 Azrael 화면 전체가 회색 빈 화면으로 변했고 Reload Window로 복구했다고 확인했다.

## 핵심 결과
23:20:29 KST Crashpad 덤프가 렌더러 충돌을 기록하며, 23:20:55 KST 창 재로드와 맞는다. 일반 로그에서 충돌을 못 찾았다는 초기 결과를 수정한다. 별도 Crashpad 저장소에서 충돌 증거를 확보했다.

- 원본 덤프: `C:/Users/felre/AppData/Roaming/Code/Crashpad/reports/c389b260-0f35-4535-a928-17a75a749d41.dmp` (1,482,256 bytes). SHA256 `7973a94c559b36b31bf2669d73fae9d50d4fe76a2e2e856e800522b74e5418ce`.
- Minidump header 시각: UTC 2026-10-17T14:20:29Z = KST 23:20:29. MiscInfo process ID 15616. Crashpad module annotation `process_type=renderer`, `ptype=renderer`, `renderer_foreground=true`.
- exception code `0x80000003`, exception thread 41284, Code.exe 상대 위치 `0x2a81a49`. 이 숫자만으로 OOM, GPU, Chromium 검사 실패 등 세부 원인을 단정하지 않는다. OOM/fatal 사유 annotation은 없었다.
- 덤프 명령행의 renderer-client-id는 22, 창 구성 식별자는 `vscode:923c474e-d0ea-43ce-aea4-9de63d8d4b51`이다. 동일 구성의 현재 renderer 18(PID 26008)은 23:11:50에 생성됐고 renderer 26(PID 25584)은 23:20:55.972에 생성돼 해당 창 초기화/재로드 기록과 맞는다. 덤프에 Azrael URL이나 대상 thread ID 자체는 없어 직접 문자열 매칭까지 확보한 것은 아니다.
- `%APPDATA%/Code/logs/20261017T230155/window4/exthost/exthost.log` 34~36행: 23:20:55.277 renderer의 terminate 요청, 기존 확장 host PID 46024 exit 0, 새 PID 13116 시작. 사용자 재로드 설명과 일치한다.
- 해당 창 계열의 렌더러 충돌, 이후 재로드, 사용자 관측이 일치하므로 Webview 렌더러 충돌이 가장 강한 직접 원인이다. 정확한 충돌 함수와 트리거에는 해당 VS Code/Electron 심볼을 적용한 스택 해석이 남는다.

## 실행과 화면의 구분
세션 rollout은 `C:/Users/felre/.azrael-ex/sessions/2026/10/17/rollout-2026-10-17T01-56-05-01a145a4-6052-7631-af69-4267e1fd0c15.jsonl`이다. 최초 검사 175,770,674 bytes이며 저장 이력 크기를 렌더링 메모리나 OOM 증거로 사용하지 않는다. 대상 작업은 23:21:56 및 23:23:18 정상 완료됐고 후속 요청을 처리했다.

현재 창은 `%APPDATA%/Code/logs/20261017T230155/window4`다. `Azrael Recovery.log`의 `recovery.runtime`은 확장 2026.0.10, 엔진 `artifacts/n10a/artifacts/releases/w10e/engine/azrael.exe`를 기록한다. release build-info의 source root는 `artifacts/n10a/engine`이다. Window Use stage 1 관찰에서는 GrowKick 창의 대상 대화가 정상 표시됐다. 입력·활성화는 수행하지 않았다.

## 다른 후보의 평가
- `Azrael.log`에는 23:19:39.961~23:25:02.941 검사 구간에서 ResizeObserver 오류가 36회 있었다. 설치 자산의 오류 필터에도 알려진 오류 메시지로 포함돼 있다. 이 오류가 renderer 충돌을 유발했다는 인과는 미확인이다.
- 23:21:10~18 확장 host 응답 지연은 재로드 이후다. 재로드 직전 회색 화면의 원인 증거로 사용하지 않는다.
- `thread belongs to another window`는 재로드 뒤 발생했으나 이어 resume 및 hydration/navigation이 성공했다.
- 실제 설치 host의 드래그 monitor에는 drop/blur/hidden/dispose 복구가 없다. read-only 검사 `node scripts/patch-vscode-webview-drag.cjs --workbench <실제 workbench 경로>`는 exit 0, mode=check, needsPatch=true였다. 이는 pointerEvents 입력 차단 잔류 결함이며 화면 전체 소실의 원인으로 연결하지 않는다. 설치 composer에는 drag cancellation과 portal cleanup이 이미 있다. 패치는 적용하지 않았다.
- 설치 `out/extension.js`의 Webview html 대입은 초기 콘텐츠, ready timeout 안내, idle 빈 HTML, idle 복원 4곳이다. timeout은 안내문 및 로그를 남기며 해당 로그는 없었다. idle manager는 1시간 숨김 후 idle 확인을 요구하므로 이번 약 9분 renderer 수명과 맞지 않는다. 일반 React ErrorBoundary 기록도 확인되지 않았다.

## 초기 읽기 조사 시점의 검증과 한계 (아래 실행 결과로 갱신)
기존 로그 및 rollout 구조 파싱, SQLite 읽기 전용 조회, 설치 자산 대조, 실제 host read-only 검사, Crashpad header·exception·module·annotation·제한된 명령행 필드 파싱을 수행했다. 원본 로그와 덤프는 복사·삭제·업로드하지 않았다. 추가 파일은 이 조사 기록뿐이며 임시 본문 파일은 일반 삭제했다.

덤프 파서 초기 구조 오프셋 오류는 형식 및 크기 검증을 추가해 바로잡았으며 최종 결과는 크기가 검증된 12-byte annotation entry와 허용한 필드에서 얻었다. 전체 메모리 내용을 진단 근거로 인용하지 않는다. 디버거/심볼 스택 해석, 제품 재현, 수정·빌드·설치는 수행하지 않았다. 제품 동작 변경이 없어 architecture 수정은 필요하지 않다.

다음 분석 대상은 Code.exe+0x2a81a49의 심볼 스택과 renderer 종료 시 Azrael 복구 동작이다. 단순 드래그 패치나 ResizeObserver 오류 무시를 이번 버그 해결책으로 제시하지 않는다.

## 승인된 실행과 성공 기준
- root: 일치 심볼 확보 가능성, crash dump 주소/스택 및 격리 재현을 조사하고 최소 수정과 최종 수용을 담당한다.
- webview_crash_paths: 기존 Webview health 경로와 격리 native host 검증 도구 재사용을 읽기 전용으로 조사한다. 기존 project AGENTS와 delegation 지침에 따른 분리 조사다.
- 이번 혼합 범위는 Windows 렌더러 충돌과 공통 Webview 복구/원인 코드다. 실제 변경 경계에 따라 공통 회귀 및 Windows native checks를 선택한다. Linux/macOS 실행 수용은 별도다.
- 원래 발생 조건 재현과 합성 crash 주입은 구분한다. renderer 종료 후 화면 복구만 검증했다고 원래 내부 충돌 원인이 해결됐다고 보고하지 않는다.
- 사용자 대화/계정/설정을 fixture에 복사하지 않는다. 필요한 경우 구조를 보존한 합성 이력과 로컬 전용 통신을 사용한다.
- 생성물은 lifecycle `ce01-gray-repro-r1`, payload `artifacts/tasks/ce01-gray-repro-r1`, logs `artifacts/logs/ce01-gray-repro-r1`에 소속된다. 시작 KST 23:40. 원본 crash dump는 복사하지 않는다.
- 완료 기준: 원인 근거, 재현 전후 결과, 보존 계약 회귀, 필요한 문서/feature inventory, 산출물 정리 및 task commit. 실행 중 사용자 창이나 엔진을 중단하지 않는다.

## 최종 원인과 수정 범위

사용자는 후속 질문에서 **소스 수정·검증까지만 진행**을 선택했다. 패키지 빌드·설치·현재 창 재로드는 수행하지 않는다.

공개 [동일 증상 보고](https://github.com/openai/codex/issues/44322)의 최소 조건을 현재 Code.exe의 별도 프로필 Webview에서 재현했다. 텍스트 선택 상태에서 `animation-timeline:scroll(self y)`가 적용된 스크롤 컨테이너의 표시를 클릭으로 전환하면 렌더러가 충돌한다. 합성 텍스트와 CSS만 사용했다. CDP `Input.dispatchMouseEvent` 신뢰 입력과 `Inspector.targetCrashed`로 결과를 판별했다. 사용자 대화/계정 데이터는 fixture에 복사하지 않았다.

원본 및 세 재현 덤프 모두 exception `0x80000003`, Code.exe module offset `0x2a81a49`, RAX `8`이었다. 같은 바이너리의 같은 검사 실패를 재현했다는 강한 근거다. Chromium 150.0.7871.250의 style/layout lifecycle 검사와 주변 기계어의 상태 허용 비트 검사, 상태 8(compositing inputs update)이 맞는다. 정확한 private symbol 및 사용자의 원래 포인터 순서는 확보하지 못했고, 심볼 없는 stack-scan 프레임을 확정 호출 스택으로 사용하지 않는다.

| 실행 ID | 조건과 결과 | 실제 exit / cleanup |
| --- | --- | --- |
| baseline-1792248855284-1 | 최소 native timeline + 선택 + 첫 클릭: renderer crash | 0 / 0 |
| baseline-1792248937126-1 | 실제 pinned Azrael CSS의 vertical mask: renderer crash | 0 / 0 |
| baseline-1792249140303-1 | 실제 CSS의 light/dark 24개 측정 뒤 같은 crash | 1 / 1, 종료 지연; 후속 전체 정리로 회수 |
| patched-1792248948039-1 | 실제 변환 CSS + runtime, 클릭 6회, responsive | 0 / 0 |
| patched-1792249263889-1 | 수정 + light/dark 24개 측정, 클릭 6회, responsive | 1 / 1, 종료 지연; 후속 전체 정리로 회수 |
| control-1792249992190-1 | native timeline만 auto로 변경, 클릭 6회, responsive | 1 / 1, 종료 지연; 후속 전체 정리로 회수 |
| patched-1792250097709-1 | 최종 도구·CSS·runtime, light/dark 24개 측정, 클릭 6회, responsive | 0 / 0 |

원본 덤프 SHA256은 위에 보존했다. 최소 HTML SHA256은 `e74f1b20c075bfb5d306a43769ce8b48ebffaa954820daa9656f7246175ccaa3`이었다. 재현 덤프는 외부에 업로드하지 않았다. 최종 재사용 HTML은 공백을 정리해 `scripts/fixtures/scroll-timeline-selection.html`에 보존한다.

`scripts/inject-scroll-fade.cjs`는 네 fade animation의 native scroll timeline을 제거하며 gradient 및 fade 거리 계약을 유지한다. `scripts/scroll-fade.cjs`는 한 프레임에 geometry를 모아 읽고 기존 custom property를 갱신한다. scroll/class/내용/크기 변화와 새 요소를 반영하고, 제거/해제 때 아직 자신이 소유한 inline 값만 복구한다. 다른 view timeline은 유지한다. namespace producer의 필수 변환 수(CSS 4, JS 1) 및 cache dependency를 연결했다. 계약과 보존 inventory는 `ui.scroll-fade`에 연결했다. 공통 renderer 정책이며 실제 native 검증은 Windows x64 한정이다.

## 최종 수용 증거

Light/dark 각각 네 mask의 0%, 50%, 100%에서 computed fade 두 값과 mask image를 비교했다. 총 24개가 전후 동일했다. 거리 16px 기준 vertical top/bottom은 `(0,16)`, `(8,8)`, `(16,0)`; top 전용은 `(16,16)`, `(16,8)`, `(16,0)`; bottom 전용은 `(0,16)`, `(0,8)`, `(0,0)`; horizontal은 `(0,16)`, `(16,16)`, `(16,0)`이다. light vertical 및 dark horizontal 실제 화면을 포함해 스크린샷을 확인했다. 테마는 합성 Webview의 배경·글자·vscode class로 지정했다. host 전체 theme나 설치본 수용을 주장하지 않는다.

최종 source bundle `source-scroll-fade`: **5/5 pass, exit 0**, native maintenance run `run-51008-648-1792250077096717000`, input identity `0d8397209ac90cf1badb2937c26b1856b198322a67e900f57d69d51a8500fc94`, before/after integrity valid. 실제 CSS 전체 namespace 합성, bootstrap typography/직렬화 합성, strict anchor drift/손상 거절, cache key 범위, vertical/horizontal/동적 제거와 frame 합침을 검사했다. 최종 직접 실행도 exit 0, 5/5였다. 중간 maintenance timeout(exit 124)은 성공으로 취급하지 않고 재실행했다.

거대 JavaScript의 반복 AST 실험이 약 1.5GB 메모리와 긴 대기를 보여 해당 test worker만 확인 후 종료하고 CSS 전체 경로 및 실제 bootstrap injector의 작은 합성 경로로 retained 검사를 줄였다. 중간 결과는 최종 수용으로 사용하지 않았다. 폰트 CSS suffix 검증을 깨던 marker 위치와 bootstrap prepend 합성 문제도 수정했다. 마지막 passing input 이후 제품 코드는 바꾸지 않았다.

시작 KST 2026-10-17 23:40, 원인 재현 23:54, 최종 source 통과 2026-10-18 00:14, 최종 native 검증 00:14:57~00:15:37. 격리 도구 보완 및 메모리 압박으로 재실행했다. 원본 Crashpad/세션/로그, 사용자 창·엔진 및 설치본은 보존했다.

정리: 생성물 group `ce01-gray-repro-r1`의 payload/logs 둘을 complete membership으로 등록하고 소유 프로세스 종료와 참조 부재를 확인했다. compact 결과를 `02-verification.json`에 보존한 뒤 native review/apply로 둘 다 삭제했다. 결과 `remaining:false` 두 건 및 `finalize remaining:[], references:[], blockers:[]`를 확인했다. 두 실제 경로의 Test-Path도 false다. 약 205MB의 논리적 생성물이며 실제 디스크 회수 바이트를 측정했다고 주장하지 않는다. 본 기록, 재현 HTML/도구 및 소스 검사는 유지한다.

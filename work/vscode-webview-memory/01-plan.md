# 웹뷰 RAM 격리 측정

상태: 격리 RAM 측정 완료. 숨겨진 웹뷰 해제 정책은 소스 구현·검증 완료이며, 실제 VS Code 수용·빌드·설치는 별도다.

## 격리 측정 조건

- 목표: 사용자 프로필 밖에 현재 프로젝트의 세션 사본과 별도 VS Code/Azrael 상태를 마련하고, 대화 웹뷰를 열기·숨기기·닫기에 따른 메모리 차이를 측정한다. 사용자가 실험 실행을 요청했다. 최적화 구현은 범위 밖이다.
- 환경: 현재 Windows x64 데스크톱, VS Code 1.140.0, 설치된 Azrael 2026.0.6의 고정 사본. 다른 OS와 장시간 모델 실행은 검증하지 않는다.
- 격리: `C:/azrael-webview-memory-20261013` 아래 별도 확장·VS Code 사용자 데이터·native 상태·빈 작업 폴더. 원본 세션은 읽어서 복사하고 인증·계정 저장소는 복사하지 않는다. 사본의 runtime manifest에서 `codexHome`만 변경한다. 원본 프로젝트에서 모델 작업을 실행하지 않는다.
- 방법: 기존 host runtime, `vscode.openWith`의 `azrael.conversationEditor`, VS Code 진단 연결과 Electron CDP를 재사용한다. 실제 세션 로딩과 탭 숨김 상태를 확인한 후 프로세스 RAM과 private commit, 가능하면 웹뷰 JS heap을 측정한다. 초기화·캐시와 추가 웹뷰 비용을 구분한다.
- 담당·순서: root가 사본 준비 → 격리 실행 → 순차 측정 → 결과 분석 → 정상 종료·사본 삭제를 수행한다. 로그와 숫자 결과는 `artifacts/logs/webview-memory-20261013/`에 보존한다.
- 완료 기준: 원본 프로필을 수정하지 않고 실험 결과와 측정 한계를 보고한다. 격리 프로세스를 정상 종료하고 큰 사본·프로필·세션 fixture를 삭제한다.
- 제품 동작을 변경하지 않으므로 architecture 및 feature inventory 변경은 없다.

## 진행

- 설치 파일의 runtime manifest는 현재 `w13e`를 참조한다. 이전에 메모리를 조사한 오래 실행 중인 창은 `w06-all-20261011-r5`를 참조했다. 이번 결과를 기존 창의 절감량으로 직접 환산하지 않는다.
- 세션 1,092개 / 고유 ID 1,016개 / 약 3.2GiB를 외부 fixture에 복사했다. 하위 에이전트 세션은 부모 복원 조건으로 제외하고, 사용자·assistant 응답이 있는 루트 세션 236개 중 6개를 선정했다(68.82, 62.11, 35.21, 1.63, 0.55, 0.04MiB).
- 초기 인증·설정 준비 단계는 대화 표시 검증에 실패해 측정에서 제외했다. 최종 fixture는 `account/read`, `getAuthStatus` 응답만 가짜 API 키 계정으로 대체하고, 읽기 위한 `thread/resume`의 모델 선택을 `gpt-6.1-sol` / `openai`로 고정한다. 실제 인증 정보·계정은 복사하지 않았고 대화의 내용·제품 렌더링 코드는 바꾸지 않는다. 대화 제출은 하지 않는다.
- 전용 RAM은 `WorkingSetPrivate`, 공유 페이지를 포함하는 RAM은 `WorkingSet`, 예약 메모리는 private commit으로 구분한다. 여러 웹뷰가 렌더러를 공유하므로 iframe별 `Runtime.getHeapUsage`를 합산하지 않는다.
- 순차 비교: 웹뷰 0개 → 1~6개(하나 표시, 나머지 숨김) → 6개 모두 숨김 → 하나 표시하고 숨겨진 5개만 닫음 → 모두 닫음. 모든 웹뷰의 실제 대화 편집기와 오류 없는 표시를 확인한 후 단계별 3회 측정한다.

## 결과

- 최종 순차 측정과 별도 GC 진단은 모두 종료 코드 0이다. 수치·샘플·실행 조건은 [measurement-result.json](../../artifacts/logs/webview-memory-20261013/measurement-result.json), [provenance.json](../../artifacts/logs/webview-memory-20261013/provenance.json)에 보존한다. 준비 단계의 로그인 화면·하위 에이전트 복원 실패 측정은 최종 비교에서 제외했다.
- 전용 웹뷰 렌더러 RAM 평균: 1개 645.6MiB, 2개 704.7MiB, 3개 901.2MiB, 4개 959.2MiB, 5개 1128.5MiB, 6개 1287.9MiB. 6개 모두 숨긴 뒤 1283.3MiB로 거의 유지됐다. iframe CSS `visibility:hidden` 6개와 실제 대화 편집기 6개를 확인했다.
- 하나를 표시하고 나머지 5개를 닫아도 첫 실험에서는 즉시 회수되지 않았다(1293.3MiB). 전부 닫으면 웹뷰 렌더러가 종료되어 해당 RAM은 0으로 내려갔다. 엔진과 기본 workbench RAM은 이 수치에 포함하지 않는다.
- 별도 3개 웹뷰 진단에서는 숨겨진 2개를 닫고 1354.1→687.0MiB로 감소했고, 강제 GC 후 381.6MiB로 더 감소했다. 자연 회수 667.1MiB와 진단용 강제 회수 305.4MiB를 구분한다. 강제 GC를 실사용의 자동 절감량으로 취급하지 않는다.
- 판단: 숨겨진 대화 웹뷰의 상태 해제는 조사·개발 가치가 있다. 다만 여러 웹뷰의 프로세스·캐시 공유, GC 회수 시점과 최신 상태 복원 계약을 함께 다뤄야 한다. 플래그 변경만으로 특정 절감량을 보장하지 않는다. 최적화 구현, 실제 모델 작업 중 업데이트와 입력 초안 복원 검증은 수행하지 않았다.
- 원본 VS Code 사용자 설정과 설치된 runtime manifest의 전후 SHA-256은 같았다. 격리 프로세스를 정상 종료했고, 마지막 진단에 기록된 프로세스 ID가 모두 사라진 것을 확인했다. 외부 fixture 삭제 결과는 [cleanup-receipt.json](../../artifacts/logs/webview-memory-20261013/cleanup-receipt.json)에 기록한다.
- 외부 fixture 삭제를 확인했다(종료 코드 0). 자동 생성된 테스트 플러그인 Git 캐시의 숨김 디렉터리 1개·읽기 전용 pack 파일 3개가 일반 삭제를 막았다. 테스트 경로·소유자·활성 프로세스 부재를 확인하고 해당 4개 항목의 속성을 정리한 뒤 같은 PowerShell의 일반 삭제로 제거했다. 원본 캐시·프로필과 기존 사용자 창은 건드리지 않았다.

## 숨겨진 웹뷰 해제 구현

상태: 소스 구현·검증 완료. 사용자가 추천 조건의 구현을 승인했다. 전체 앱 빌드·설치는 이번 지시에 포함하지 않는다.

- 공통 요구: Windows x64, Linux x64, macOS ARM64의 로컬 VS Code 대화 웹뷰에 같은 정책을 적용한다. 현재 실행 검증 환경은 Windows이며 다른 OS의 네이티브 수용은 별도다.
- 조건: 숨겨진 상태가 연속 1시간 이상이고 현재 대화에 플래그가 없으며 실행·큐·재개·승인 대기가 없는 것으로 확인된 경우 화면 메모리를 해제한다. 표시 상태로 돌아오면 시간을 초기화한다. 작업 중이거나 상태가 불명확한 웹뷰는 유지한다.
- 경계: 기존 host/global preference·native composer draft를 재사용하며, composer 첨부·선택과 스크롤만 작은 복원 상태로 보관한다. 저장 확인에 실패하거나 제출·일시 첨부가 진행 중이면 해제를 연기한다. 대화 기록은 저장 상태에서 다시 읽는다.
- 소유: `scripts/inject-webview-idle.cjs`, `scripts/webview-idle.cjs`와 기존 namespace 변환·cache 규칙. 문서는 UI 계약과 기능 보존 목록에 연결한다. 다른 작업의 기존 변경은 보존한다.
- 검증: 고정 upstream host/UI 변환과 구문 검사, 실제 생산 manager의 가상 시계·표시/플래그 경쟁·실패/복원 테스트, native 초안·플래그 회귀와 DOM 스크롤 복원 검사. 전체 빌드·설치 상태와 소스 검증을 구분한다.
- 구현: 편집기·사이드바의 숨김 시각을 추적한다. 플래그·표시 상태를 해제 직전에 확인하고, 원래 탭을 닫지 않고 inert 문서로 교체한다. 초안은 native 저장소가 우선이며 첨부·선택·스크롤만 보관한다. 복원 전에 peer/worker 연결을 다시 등록하고, 최신 대화는 native route에서 읽는다. 해제 중 내비게이션·새 대화·맥락 추가·승인 요청은 재표시 handshake 이후 전달하며 기록 알림을 쌓지 않는다.
- 결과: `node --test --test-concurrency=1 scripts/test-webview-idle.cjs scripts/test-session-flags.cjs scripts/test-project-drafts.cjs scripts/test-composer-draft.cjs` 61개 통과(종료 코드 0, `artifacts/logs/webview-idle/final-regression.log`). 마지막 정책·canonical conversation key 변경 후 `node --test scripts/test-webview-idle.cjs` 10개 재검증 통과(종료 코드 0, `final-idle.log`).
- 브라우저: `node scripts/verify-webview-idle-render.mjs` 밝은·어두운 테마에서 실제 DOM의 스크롤, 생산 snapshot 메시지와 첨부·초안 및 transcript 제외 6개 검사 통과(종료 코드 0, `render-summary.json`, `final-render.log`). Composer scope와 host 데이터는 합성 fixture로, 실제 native composer 전체 화면을 검증한 것은 아니다.
- 실제 VS Code 검사: `node scripts/verify-webview-idle-host.cjs` 두 번 모두 updater의 `vscode-updating` mutex 때문에 앱 실행이 실패했다(종료 코드 1, `host-launch.log`, `host-summary.json`). 잠금을 우회하지 않았다. 실제 대화 탭의 해제·복원, 진행 중인 모델 작업·승인 요청의 연속성, 설치 후 RAM 절감량은 수용 전 필수로 남긴다.
- 정리: 테스트 프로세스 종료 뒤 native PowerShell 일반 삭제로 host/browser fixture·프로필 제거를 확인했다. `host-cleanup.log`, `render-cleanup.log`의 종료 코드는 0이고 두 fixture 경로는 존재하지 않는다. 원본 설정·설치 런타임 변경과 모델 호출은 하지 않았다.

## 작업·큐·대기 상태 보호 보완

상태: 소스 구현·검증 완료. 사용자가 실행 중 / 큐가 있음 / 재개·승인 대기 및 상태 확인 실패 시 해제 제외를 승인했다. 공통 정책·Windows 소스 검증 범위와 빌드·설치 제외 범위는 위와 같다.

- 확인된 문제: 기존 해제 조건의 제출 busy 검사는 실제 응답 실행·큐·재개 예약·승인 상태를 보장하지 않았다. 웹뷰의 client ownership 해제는 큐 자동 전송을 멈출 수 있으므로 이전 작업 유지 설명을 수정했다.
- 재사용: native 종료 전 작업 검사와 동일한 manager 경계의 queue/readState·readMessages, resume/start admission, cached conversation 상태를 확인한다. 기존 관리 API `azrael/rootResume`와 검증된 engine transport를 재사용하며 새 의존성이나 엔진 변경은 없다.
- 구현 순서·소유: root가 idle manager/composer → account service의 최신 예약 확인 command → 동일 생산 코드를 사용하는 상태·경쟁 테스트 → owning UI 문서와 feature inventory → 검증·작업별 커밋을 담당한다. 기존 다른 작업의 engine/provider 문서·코드·스테이징은 보존한다.
- 정책: 확인 실패·누락·loading·연결 변경은 유지한다. 같은 renderer의 다른 대화 작업도 보호하며 창의 preparing/waiting/claimed/blocked 예약은 보수적으로 모든 대화 웹뷰를 유지한다. 해제 거부 후에는 새 숨김 1시간을 기다린다. 해제 뒤 새 내비게이션·승인 요청은 탭을 표시하지 않고 renderer를 복원해 handshake 뒤 전달한다.
- 검증 계획: 생산 상태 검사·host callback·account service method의 가상 상태·가상 시계 테스트, pinned 전체 변환·cache dependency, TypeScript noEmit 및 변경한 DOM fixture. 실제 엔진 turn/queue/resume/approval 연속성·설치 후 RAM 수용은 별도이며 기존 native 앱 시작은 updater mutex에 막혔다.
- 결과: `node --test scripts/test-webview-idle.cjs` 최종 16개 통과, 종료 코드 0 (`artifacts/logs/webview-idle/work-safety-final.log`, 실제 검사 86.1초). 배경 복원 중 플래그 변경 경쟁을 보완해 전체 변환 검사를 재실행했다. 초기 단위 테스트의 VM class 재선언 fixture 오류도 수정했다.
- 타입·브라우저: `node extensions/azrael-ex/node_modules/typescript/bin/tsc -p extensions/azrael-ex/tsconfig.json --noEmit` 종료 코드 0 (`work-safety-types.log`); `node scripts/verify-webview-idle-render.mjs` 실제 Chromium DOM 6개 통과, 종료 코드 0 (`work-safety-render.log`, `render-summary.json`). 브라우저 종료와 일반 삭제 정리도 종료 코드 0이며 fixture 부재를 확인했다.
- 한계: 타입·생산 변환·상태 fixture와 실제 DOM을 Windows에서 검증했다. 이번 요청에서 전체 앱 빌드·설치와 실제 모델 실행·큐 소비·자동 재개를 다시 실행하지 않았다. 설치 전 실제 엔진을 연결한 native 수용은 계속 남아 있다.

상태: 명령 실행 영역 드래그 차단 소스 구현·검증 완료. 설치 반영은 사용자 선택에 따라 제외.

## 목표와 권한
사용자가 명령창 텍스트를 드래그한 뒤 회색 화면과 'Codex could not start'를 관찰했다. 요청한 응급 완화는 모델 실행 명령 내역의 텍스트 선택 드래그 및 HTML drag 시작을 차단하는 것이다. 앞서 선택한 소스 수정·검증 범위를 유지하며 빌드·설치·사용자 창 재로드는 수행하지 않는다. 스크린샷만으로 시작 실패의 정확한 원인이 이전 crash와 같다고 단정하지 않는다.

## 변경과 보존 범위
공통 Windows x64/Linux x64/macOS ARM64 Webview 정책이다. 실제 검증은 Windows x64의 설치된 Code.exe 격리 프로필에서 수행했다. native command 실행 카드의 summary와 펼친 command/output, 공유 shell output 및 dynamic functions.exec/exec_command/write_stdin 결과에 선택 방지 CSS와 capture dragstart/selectstart 차단을 적용했다. native zS → lMi → tMi 경로에서 scope class가 실제 root div까지 전달됨을 확인했다. 기존 header 클릭·접기/펼치기·복사 버튼·스크롤·키보드 focus의 이벤트 경로를 보존한다. 일반 대화의 텍스트 선택, 다른 도구 결과와 composer file drop에는 적용하지 않는다.

## 조사와 구현 순서
1. root가 pinned native exec renderer sites-end-resource의 zS/exec-shell-body 및 공유 output renderer를 확인하고 차단 경계를 결정한다.
2. 기존 bootstrap 직렬화·strict asset transform·cache dependency 경로를 재사용한다. 새 라이브러리 없이 CSS user-select 및 native event cancellation으로 구현한다.
3. owning UI architecture와 feature inventory, source checks를 연결한다.
4. 실제 production helper/CSS의 Windows native Webview light/dark 드래그·selection·click·copy·scroll 보존 검증, source 검사 후 생성물 정리와 task commit을 수행한다. 이전 crash 수정은 유지한다.

## 수용 기준과 결과
명령 summary/output 드래그로 selection이나 dragstart 기본 동작이 시작되지 않는다. 일반 대화 선택, 명령 disclosure/copy 및 스크롤과 외부 drop의 이벤트 경로를 보존한다. Source 변환은 drift를 거절하고 반복 적용에 안전하다.

2026-10-18 00:14:43 UTC에 검증 생성물 수명주기를 기록했고, 00:16:49–00:17:00 UTC에 native 검증을 실행했다. Windows Code 1.142.0 / Electron 43.7.7 / Chromium 150.0.7871.250 격리 Webview에서 실제 production policy/CSS를 적용한 synthetic DOM의 light/dark command/output 드래그 차단, 일반 텍스트 선택, 접기 버튼 6회, copy callback/focus, wheel scroll 및 외부 drop 이벤트를 확인했다. Renderer는 응답을 유지했으며 실행·종료·정리 exit code는 모두 0이다. 두 테마 스크린샷을 확인했다.

project_tests run-45928-673-1792282651950398600의 source-command-drag-block 4개와 source-scroll-fade 5개가 모두 통과했다. 두 단계 actual exit code 0, 전후 입력 무결성 valid다. 재실행이 필요한 제품 코드 수정이나 실패는 없었다. UI architecture, feature inventory, strict transform 및 cache dependency를 연결했다.

실제 전체 앱 mount, OS clipboard, 실제 파일 첨부, 패키지 및 설치 검증은 수행하지 않았다. Linux/macOS는 미검증이다. 이번 차단은 사용자가 요청한 완화이며 스크린샷의 시작 실패 원인을 확정하거나 모든 회색 화면을 해결했다는 증거는 아니다.

독립적으로 읽을 수 있는 해시·검증 결과·exit code는 03-command-drag-verification.json에 보존했다. 검증 producer 종료와 해당 경로의 Code/node process 부재를 확인하고 ce02-command-drag-r1 payload/logs를 같은 그룹으로 등록·review·삭제했다. 실제 두 경로 remaining=false, finalize 완료와 Test-Path false를 확인했다. 관련 없는 작업 파일과 사용자 창은 유지했다.

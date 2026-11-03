상태: 소스 구현·자동 검증 완료. 실제 OS 배너/클릭 및 설치 앱 적용은 미검증이며, 빌드·설치는 이번 요청에서 실행하지 않았다.

# Agent 질문 OS 알림

- 요청: Azrael 앱에서 Agent 질문도 기존 승인 요청처럼 OS 알림으로 알린다. 소스 변경과 관련 검증을 수행한다. 배포·설치는 별도 명시 요청 범위다.
- 범위: standalone 앱의 일반 `item/tool/requestUserInput` 및 비동기 `agentMessage.questions`. 초기 대상 Windows x64. Electron 공통 API를 사용하되 Linux/macOS 실제 알림 수신은 미검증이다. 기존 VS Code 확장 및 Window Use 승인 정책은 유지한다.
- 재사용: 앱에 설치된 Electron `Notification`을 사용한다. 기존 Window Use 전용 native 알림은 승인 제목과 UUID 활성화 규약이 결합되어 있어 일반 질문용으로 복제하지 않는다.
- 동작: 활성 창에서도 새 질문당 한 번 알림. 클릭 시 원래 앱 창과 대화로 이동하며 답변/승인은 실행하지 않는다. 답변·철회·대화 종료·패널 폐기·앱 종료 시 제거한다. 일반 turn 완료는 비동기 질문을 제거하지 않는다. OS 알림 설정이 실제 표시·소리를 제어한다.
- 구조: main process가 전달한 native 질문 이벤트만 관찰하는 알림 소유자를 추가하고 기존 webview 전달 경로에 연결한다. UI/엔진 프로토콜 변경과 신규 의존성은 없다.
- 순서/소유: root가 프로토콜 및 전달 경로 조사 → owning architecture/feature inventory 갱신 → 알림 소유자와 앱 연결 → 최소 행동 검사와 기존 standalone source 검사 → diff 검토·task commit. 독립 위임 없음.
- 검증: 질문 종류별 생성, 중복 방지, 클릭 이동, 답변/철회 후 stale 클릭 차단, turn 완료 보존, 패널/앱 종료 정리와 알림 실패 격리. Windows Node 행동 검사 및 기존 standalone source 검사. 실제 OS 배너/클릭 및 설치 앱은 별도 미검증으로 보고한다.
- 정리: 테스트는 메모리 fixture를 사용한다. 생성할 빌드·프로필·백업 없음. 작업 계획은 유지 deliverable이며 임시 계획 body는 할당 직후 삭제한다.
- 영구 검사 이유: webview 전달/패널 수명 경로 수정 시 알림 훅이나 답변 이후 활성화 차단을 빠뜨리는 재발을 막는 작은 행동 검사를 기존 source check에 연결한다.

## 구현·검증 결과

- `apps/azrael-desktop/question-notifications.cjs`가 알림 수명을 소유한다. `main.cjs`는 기존 host 메시지 전달 후 주 채팅 패널에서만 관찰하고, 최소화 창 복원과 기존 `navigate-to-route` 메시지를 사용한다. 여러 패널의 broadcast로 알림이 중복되는 것을 막는다. 패널 폐기·renderer 종료·native fatal 오류·앱 종료 시 오래된 활성화를 차단한다.
- Windows source 실행에는 Electron이 문서화한 실행파일 AppUserModelID를 사용한다. 패키징 실행의 `Azrael.Desktop`은 향후 installer shortcut identity와 일치해야 하며, 패키지 검증을 완료했다는 의미는 아니다. [공식 알림 문서](https://www.electronjs.org/docs/latest/tutorial/notifications).
- Windows x64/Node v26.7.0: `node --test apps/azrael-desktop/question-notifications.test.cjs` 실제 5개 실행/5개 통과, exit 0. 메모리 Notification fixture이므로 실제 Windows 배너·소리·물리 클릭을 입증하지 않는다.
- 등록 bundle `standalone-app-ui-source`: 최종 run `run-42784-5596-1793684548618229700`, `node apps/azrael-desktop/check.cjs`, exit 0, 입력 무결성 valid. 질문 행동 검사와 기존 15개 파일 syntax, 메모리 renderer bundle 및 pinned image adapter 검사가 통과했다. 실행 근거: `tool-call:exec-e7e30fa2-546a-4763-a02e-85c4e47ba416:step-d2d3f2f62a8a9b2af295ad865671a4a5d92da88d8562514fbd255f76a0ae51a4`.
- 최초 run dispatch는 다른 작업의 catalog lock으로 거부되어 producer가 시작되지 않았다. 이후 성공 실행 뒤 main의 주 패널 필터·renderer 종료 정리를 보완하여 위 최종 run을 다시 실행했다. 엔진·승인 정책·렌더러 표시 UI·의존성 변경 없음.
- `git diff --check` 통과. 임시 계획 body 삭제 및 실제 부재 확인. 빌드·프로필·백업·별도 raw log는 생성하지 않았다. 관리 도구의 검증 receipt와 이 계획은 최소 수용 근거로 유지한다. 다른 작업의 기존 파일·staging은 보존한다.

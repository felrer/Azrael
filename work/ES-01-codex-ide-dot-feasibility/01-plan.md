상태: 검토 완료 — 구현·설정 변경 없이 가능성과 한계를 확인했다.

# OpenAI Dot의 Codex VS Code 연동 검토

## 요청과 범위
- OpenAI의 상시 에이전트 Dot을 Codex VS Code 확장에서 사용할 수 있는지 검토한다.
- 공식 문서·설치 파일 조사 및 검토 기록만 허용된다. 연결 변경, 실제 작업 생성, 제품 구현은 수행하지 않는다.
- 제품 차원의 가능성을 검토하되 직접 확인한 환경은 Windows x64, openai.chatgpt 26.1021.22027이다. macOS·Linux·WSL·SSH와 실제 계정 접근은 미검증이다.

## 근거와 판단
- Dot 공식 문서는 연결된 컴퓨터에서 새 Codex 작업을 만들고 기존 로컬 Codex 작업을 이어갈 수 있다고 명시한다. 연결은 ChatGPT 앱의 Dot 프로필 > Computers > Your computer > Allow access 경로이며 컴퓨터가 온라인이고 앱이 열려 있어야 한다. Codex 원격 연결·Work Sync와 별도 권한이다.
- 공식 IDE 명령·설정 목록과 설치 확장 package.json에서 공개 Dot 활성화 명령·설정을 확인하지 못했다.
- 설치 확장 out/extension.js의 공유 명령 정의에는 openOrbit / codex.command.openOrbit.dot이 있으나 availableIn은 electron으로 제한된다. 이는 데스크톱 앱 대상 정의이며 VS Code 동작의 증거가 아니다.
- 검토한 공식 문서에서 개인 Dot 대화·기억·활동에 직접 접근하는 공개 API/MCP 계약은 확인하지 못했다. 부재나 구현 불가능을 단정하지 않는다.

## 권고와 대안
- 권고: ChatGPT 앱의 공식 Dot 컴퓨터 연결을 통해 Codex 작업과 병행한다. VS Code 확장 내부 UI와 특정 확장 대화 제어는 별도 검증이 필요하다.
- 제한적 보조 확장: 프로젝트·작업 요약 및 Dot 화면 이동은 후속 검토 대상이다. 딥링크·인증·전달 계약 확인 전 구현 가능성을 확정하지 않는다.
- 완전 통합: electron 제한 변경만으로 충분하다는 근거가 없다. 지원 인터페이스와 세션·권한 경계 확인이 선행되어야 한다.

## 검증과 후속 조건
- 공식 문서와 설치 번들을 대조했다. 테스트·빌드·실제 Dot 작업 전송은 하지 않았다.
- 후속 실행에서는 계정 접근, 컴퓨터 연결, 새 Codex 작업 생성, VS Code 가시성, 기존 확장 대화 후속 지시를 각각 확인한다. 실행은 별도 승인이 필요하다.
- 제품 동작 변경이 없어 아키텍처와 feature inventory 변경은 필요 없다. 임시 조사 산출물·빌드·백업은 없다.

## 출처
- https://learn.chatgpt.com/docs/dots
- https://learn.chatgpt.com/docs/dots/computers-and-apps
- https://learn.chatgpt.com/docs/dots/tasks-and-memory
- https://learn.chatgpt.com/docs/ide/settings
- https://learn.chatgpt.com/docs/ide/commands
- C:/Users/felre/.vscode/extensions/openai.chatgpt-26.1021.22027-win32-x64/package.json
- C:/Users/felre/.vscode/extensions/openai.chatgpt-26.1021.22027-win32-x64/out/extension.js
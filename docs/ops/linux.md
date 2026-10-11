# Linux 로컬 통합 호스트

이 로컬 포트는 공식 Azrael `2026.0.5` Linux 배포본의 Codex `26.1007.21434` UI와
`0.162.0` 엔진에 기존 로컬 기록·공백 표시·창 제어·감시 기능을 통합한다.
원본 `openai.chatgpt`와 별도 확장 ID `azrael-ex-local.azrael`을
사용하며 상태는 `~/.azrael-ex`에 저장한다. 기존 Codex와 VS Code 설정은 보존한다.

로컬 대화는 기존 엔진의 목록·검색·본문 페이지 API와 기존 Recent/Local 메뉴를
사용한다. 확장 시작 전에 `~/.codex`의 SQLite 온라인 스냅샷과 rollout 사본을
가져온다. 인증·설정·큐·메모리는 가져오지 않으며 원본 데이터에 쓰지 않는다.
원본과 다른 엔진 migration checksum을 공유하지 않고 네이티브 엔진으로 생성한
빈 DB에 공통 컬럼만 병합한다. 되돌린 rollout의 UUID를 본문 색인 키로 보존한다.

처음 가져온 대화와 색인에 없는 rollout을 복사하고 이후 시작에서는 새 기록을
추가한다. Azrael 엔진이 없는 때만 수정하지 않은 가져온 대화를 갱신한다.
Azrael에서 이어 쓴 rollout과 바꾼 메타데이터는 덮어쓰지 않는다. 새 기록을 보려면
**Developer: Reload Window**로 다시 시작한다. 현재 작업 폴더의 로컬 대화와
cli/vscode/exec/appServer/unknown 소스를 표시하며 subagent는 기존 규칙대로 제외한다.
작업 폴더가 다른 대화는 기존 전체 기록 메뉴에서 찾는다. 원본 rollout이 없어
재개할 수 없는 메타데이터는 제외하고 `local-history-import.json`에 수량을 남긴다.

가져오기 자식은 확장 호스트가 감시해 종료 시 대기 후 다시 실행한다. 파일 교체
전에 저장한 복구 journal로 중단된 갱신을 이어 간다. 진행과 오류는 **Azrael Local
History** 출력 채널에 수량만 기록한다. `test-local-history.py`는 원본 보존·중복 실행·
갱신·이어 쓴 기록 보호·중단 복구를, `test-local-history-host.cjs`는 실제 SIGKILL 후
재시작을 검사한다. 격리 VS Code 검증도 합성 원본의 가져오기와 실제 본문 pagination을
검사하며 개인 기록을 fixture에 복사하지 않는다.

## 실행 조건과 사용

현재 PC의 Linux Xorg, VS Code, `/usr/bin/python3`, 시스템 GI의 Gtk 3/Atspi 2,
Pillow와 X11/XComposite 라이브러리를 사용한다. 엔진·브리지·Node·Bun은 공식
Linux 릴리스의 해시·출처를 검증해 재사용한다. 커스텀 API 도구 검색을 변경할 때는
고정한 로컬 소스로 엔진과 브리지를 함께 빌드하며 외부 code-mode host와 제공자
런타임의 원본 경로·해시를 기록한다. 계정 모듈은 병합된 소스로 컴파일한다.

설치 뒤 **Developer: Reload Window**로 적용한다. Azrael의 채팅·설정·프로필 메뉴는
통합 Codex UI를 사용한다. **Azrael: Computer Use: 선택 창 모드**를 열어 대상 창을
선택한다. 기존 앱 승인, 대화별 권한 증명, 점유 확인과 중지 UI를 유지한다.

창 캡처는 선택한 XComposite pixmap만 읽는다. AT-SPI 요소의 입력·버튼·토글·선택·
펼침·접힘과 scrollbar 값 변경을 사용하며 실제 노출된 패턴만 제공한다. 키 전달은
선택한 창의 이미 포커스된 정확한 요소에 한정한다. Return의 `activate` 패턴은
AT-SPI로 실행한다. 다른 고정 이름 키는 창 메시지로 전달하며 앱이 무시할 수 있어
실험적·미확인 결과를 반환한다. 전역 입력, 클립보드, 전경 전환으로 대체하지 않는다.
Wayland와 전체 데스크톱 Computer Use는 이 포트의 검증 대상에 포함되지 않는다.

## 복구와 검증

확장 호스트가 자신의 엔진과 창 제어 helper를 감시한다. 비정상 종료 시 대기 후
새 프로세스를 시작하고 계정 브리지를 다시 검증한다. 불확실한 RPC와 창 동작은
재전송하지 않는다. 정상 종료 시 감시를 해제한다. 설치·빌드 작업은 부모
`../azrael-linux/supervise.py`에서 실행하며 실패와 다운로드 재시도에 대기 시간을 둔다.

Linux 준비·검증·설치 도구와 실행별 영수증은 저장소 옆 `../azrael-linux/`에 있다.
`prepare-update.py`는 공식 릴리스 설치기의 파일 검증·경로 재배치를 거친 호스트에
Linux 통합을 추가하고 변경된 파일의 원본·결과 해시를 기록한다. `package-update.py`는
릴리스의 Linux VSIX 메타데이터를 유지하며 최종 자산 해시와 패키지 해시를 기록한다.
선택 창 MCP는 독립적인 검증된 Node 경로를 사용해 전체 데스크톱 번들 없이 작동한다.
Node 경로는 공식 `devin-native-build.json`의 실행파일 항목에서 해시를 검증해
정한다. 호스트는 명시된 Node 경로가 디렉터리이거나 실행할 수 없는 파일이면
시작 전에 거부한다. Linux 배포본의 `runtime/node`는 디렉터리이고 실행파일은
`runtime/node/node`이다.
`verify-integrated.py`는 정확한 VSIX를 격리된 VS Code 프로필에 설치하여 원본 Codex와
동시 활성화, 엔진 SIGKILL 및 계정 재연결을 검사한다. 선택 창 MCP의 `ready` 알림과
등록된 Heretic2 모델의 실제 HTTPS 채팅 응답 완료도 확인한다. API 키는 기존 파일
경로만 참조하며 검증 결과에 인증값이나 요청 본문을 기록하지 않는다.
도구 호출을 지원하는 커스텀 API 모델은 Codex 호스트의 도구 검색을 사용한다.
전체 도구 정의를 처음부터 전송하는 대신 검색한 도구가 다음 모델 요청에 추가된다.
`verify-heretic2-discovery.py`는 큰 합성 MCP 카탈로그를 연결하고 실제 Heretic2에서
검색·추가 로딩·호출을 검증하며 요청 크기·상태·사용량만 기록한다. 격리 VS Code
검증도 같은 검색·호출 왕복을 확인한다. 맥락 한도를 늘리거나 대화를 잘라내지 않는다.
`verify-window-linux.py`는
Xvfb와 별도 D-Bus의 두 GTK 창에서 실제 동작·가려진 창 캡처·중지·강제 종료 복구를
검사한다. `install.py --integrated`는 성공 영수증과 패키지 해시가 일치할 때만 설치한다.

실행 중인 사용자 창은 설치 도구가 종료하거나 다시 로드하지 않는다. 검증 fixture는
성공한 뒤 정리하고, 현재 패키지와 직전 공백 수정 통합 패키지는 롤백을 위해 보존한다.
2026-10-12 업그레이드 검증은 분리한 기존 DB 복사본에서 state migration 60→63,
history 9→10, queue 3→4와 대화·본문 수량·기존 migration checksum 보존을 확인했다.
원래 Codex DB를 새 엔진으로 실행하지 않았으며 검증 사본은 완료 후 삭제했다.

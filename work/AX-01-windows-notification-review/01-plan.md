상태: 조사 완료 — 완료 알림의 설정·소스·설치본을 확인했다. 실제 배너 재현과 발생 시점의 원인 확정은 남아 있다.

## 목적과 권한
다른 OS 지원 이후 답변·작업 완료 Windows 알림이 사라졌다는 증상을 확인한다. 사용자 확인으로 Window Use 앱 승인 알림은 대상에서 제외했다. 권한은 조사·보고이며 코드 수정·설치·배포는 수행하지 않았다.

## 범위와 방법
Windows 로컬 데스크톱 표시 기능과 공통 완료 이벤트를 구분했다. 설정, 실행 파일 존재, 활성 엔진 경로, 배포본의 소스 호출, 설치된 확장의 진입점과 관련 변경 이력, 최근 한정 로그를 대조했다. Windows 배너와 물리 클릭을 재현하지 않았으며 다른 OS 동작은 검증하지 않았다.

## 확인된 사실
- `~/.azrael-ex/config.toml:6`의 notify는 `all_changes_20261007_r6`의 Computer Use 실행 파일과 `turn-ended`를 지정한다. 파일은 존재한다. `~/.codex/config.toml`과 2026-08-20 백업도 동일한 도우미 명령 형식이다.
- 활성 codex 프로세스에는 w13e와 이전 r6가 공존한다. w13e의 build-info.json은 `artifacts/w13a/engine`을 소스로 기록한다. 모든 창이 동일 배포본이라는 근거는 없다.
- w13e 원본 소스의 `session/turn.rs:713`에 `run_legacy_after_agent_hook`, `session/mod.rs:5347`에 `config.notify` 등록이 남아 있다. hooks의 legacy_notify는 프로세스를 생성한 뒤 stdout/stderr를 버린다.
- `turn-ended` 바이너리 문자열에는 `signal computer-use turn-ended event`, `Local\\CodexComputerUseTurnEnded-`, `--previous-notify`와 이전 명령 누락 시 건너뛰는 진단이 있다. 현재 notify 인수에는 `--previous-notify`가 없다. 이 설정의 존재는 Windows 배너 전달 근거가 아니다. `turn-ended --help` 호출은 출력 없이 종료 코드 0이었다. 배너 표시 테스트는 아니다.
- 최근 30,000개 로그 행에서 after_agent/legacy_notify 실패 검색 결과는 없다. 자식 출력이 버려지므로 도우미 내부 성공은 입증하지 못한다.
- 설치된 2026.0.6 확장의 main은 `integrated-azrael-entry.cjs`이며 `out/extension.js`와 account UI를 사용한다. 별도 standalone ChatSession의 `turn/completed`에는 배너 호출이 없지만 이를 실제 통합 UI 원인으로 볼 수 없다.
- 설치된 통합 host bundle에는 notifications-turn-mode 설정 정의가 있으며 기본값은 unfocused다. 2026.0.4와 2026.0.6에서 정의와 주요 알림 검색 결과는 동일했다. 정의만으로 Windows 표시 구현과 실제 설정값을 확정할 수 없다.

## 판단과 남은 확인
완료 알림 설정이나 공통 완료 훅이 삭제됐다는 근거는 없다. 현재 notify는 Computer Use 종료 도우미를 지정하므로 Windows 완료 배너의 전달 경로는 별도로 확인해야 한다. 다른 OS 지원 변경과 증상 사이의 인과관계, 원래 Windows 배너를 담당하던 코드·설정, 실제 활성 창과 표시 조건은 확정하지 못했다. 기능 복구를 진행한다면 기존 배너 제공 경로·시점을 특정하고, 창 활성/비활성 상태에서 실제 표시를 재현한 뒤 변경 범위를 정해야 한다. 이번 조사에서는 제품 동작과 설계 문서를 변경하지 않았다.

# kt cloud 서버 운영 문서

이 폴더는 kt cloud AI Nexus 계정 로그인, 세션 생성·접속과 영속 데이터 운영 지침입니다. 로드한 Azrael 스킬이 코드·지침의 진입점이며, 세션 기록은 `scripts/resolve_state_root.ps1`로 구한 private state root의 `sessions/`에서만 관리합니다.

## 작업별 문서

| 작업 | 기준 문서 |
|---|---|
| 두 계정 등록·전환·삭제 | [다중 계정 자동 로그인 지침](ktcloud_CLI_자동로그인_지침.md) |
| 세션 선택·생성·검증·SSH·종료 | [세션 생성·접속·기록 지침](세션_생성_지침.md) |
| 데이터 폴더 구조와 저장 위치 | [데이터 폴더 이용 지침](data_folder_usage_guide.md) |
| 로컬 디스크와 NFS 성능 판단 | [데이터 폴더 속도 참고](data_folder_speed_reference.md) |
| 활성·종료 세션 찾기 | private state root의 `sessions/active/`와 `sessions/archive/`를 직접 탐색 |

자동 로그인 구현 파일은 `../scripts/ktcloud_login.ps1`, 계정 격리 CLI wrapper는 `../scripts/ktcloud_cli.ps1`, 내부 구현은 같은 `scripts/`의 Python 파일입니다. 일반 작업에서는 Python helper·runner나 `backend.ai.exe`를 직접 호출하지 않습니다.

## 계정

| 별칭 | GPU 한도 | 기본 세션 |
|---|---:|---|
| `trinity` | 최대 4개 | 사용자가 명시적으로 `trinity`를 요청한 경우만 |
| `abydos` | 최대 1개 | 계정 언급이 없는 모든 새 세션 |

새 세션 요청에 계정 언급이 없으면 항상 `abydos`를 사용합니다. `trinity`는 사용자가 명시적으로 요청한 경우에만 사용하며, GPU가 2개 이상 필요해도 Agent가 자동 전환하지 않습니다. 기존 세션은 세션 문서의 소유 계정을 사용합니다.

## Agent 작업 순서

1. 기존 세션이면 문서의 소유 계정을 사용하고, 새 세션이면 명시가 없는 한 `abydos`를 선택합니다.
2. canonical skill root의 `scripts/ktcloud_login.ps1 -Account <별칭>`으로 계정별 격리 상태에 로그인합니다.
3. 같은 별칭의 `-Status`에서 `Authenticated=True`를 확인합니다.
4. canonical skill root의 `scripts/ktcloud_cli.ps1 -Account <별칭> -- ...`으로 해당 계정의 자원과 전체 세션 이력을 조회합니다. `--`는 뒤쪽 CLI 옵션을 PowerShell wrapper 옵션과 분리합니다.
5. 세션 지침에 따라 생성·접속·검증합니다.
6. private state root `sessions/active/<계정>/`의 기록을 갱신합니다.
7. 종료 확인 후 private state root `sessions/archive/<계정>/`로 이동합니다.

계정이 불명확하거나 접속 정보가 최신인지 확인할 수 없으면 추측하지 않습니다. 비밀번호, OTP, 쿠키와 개인키는 문서나 저장소에 기록하지 않습니다.

일시적인 SSH host·port·key path·proxy PID·직접 접속 명령도 기록하지 않습니다. legacy `admin keypair info`는 민감한 결과를 낼 수 있으므로 금지하며 안전한 v2 사용자 자원 조회만 사용합니다.

세션 목록을 별도 인덱스로 복제하지 않습니다. 필요할 때 `<state-root>/sessions/active`와 `<state-root>/sessions/archive`를 직접 탐색하며, CLI에서 종료를 확인한 시점에만 해당 문서를 `archive`로 이동합니다. 기록은 Git-ignored private root에만 저장하고 공개 스킬 디렉터리와 portable copy에는 포함하지 않습니다. 세션별 SSH 매크로는 저장하지 않습니다.

# kt cloud AI Nexus CLI 다중 계정 자동 로그인 지침

이 지침은 kt cloud 계정을 명시적인 별칭으로 구분해 사용합니다.

| 계정 별칭 | 사용 가능한 GPU | 기본 용도 |
|---|---:|---|
| `trinity` | 최대 4개 | 사용자가 명시적으로 요청한 경우만 |
| `abydos` | 최대 1개 | 계정 언급이 없는 모든 새 세션 |
| `arius1`, `arius2`, … | 등록 후 실시간 조회 | 사용자가 해당 별칭을 명시한 경우만 |

별칭은 저장소와 세션 문서에 사용하는 식별자이며 실제 사용자 ID나 비밀번호를 뜻하지 않습니다. 비밀번호는 Windows DPAPI로 암호화하고 명령줄 인수, 환경변수, 문서 또는 로그에 기록하지 않습니다.

아래 명령을 실행하기 전에 활성 스킬의 resolver로 loaded Azrael code root를 확인합니다.

```powershell
$SkillRoot = & "<loaded-skill-root>\scripts\resolve_canonical_root.ps1"
$StateRoot = & (Join-Path $SkillRoot "scripts\resolve_state_root.ps1")
```

## 최초 등록

사용자가 직접 PowerShell의 보안 프롬프트에서 두 계정을 각각 등록합니다. 비밀번호를 Agent와 채팅으로 주고받지 않습니다.

```powershell
& (Join-Path $SkillRoot 'scripts\ktcloud_login.ps1') -SetupAll
```

한 계정만 등록하거나 갱신할 때는 다음 형식을 사용합니다.

```powershell
& (Join-Path $SkillRoot 'scripts\ktcloud_login.ps1') -Setup -Account trinity
& (Join-Path $SkillRoot 'scripts\ktcloud_login.ps1') -Setup -Account abydos
& (Join-Path $SkillRoot 'scripts\ktcloud_login.ps1') -Setup -Account arius1
```

자격 증명은 다음 위치에 계정별로 저장됩니다.

```text
%LOCALAPPDATA%\ktcloud-ai-nexus\accounts\trinity\credential.clixml
%LOCALAPPDATA%\ktcloud-ai-nexus\accounts\abydos\credential.clixml
```

암호문은 등록한 Windows 사용자와 PC에 묶입니다. 비밀번호가 바뀌면 해당 계정의 `-Setup` 명령을 다시 실행합니다.

이전 단일 계정 자격 증명을 재입력하지 않고 이관할 때만 다음 명령을 사용합니다. 어떤 계정인지 확인하지 않은 상태에서 실행하지 않습니다.

```powershell
& (Join-Path $SkillRoot 'scripts\ktcloud_login.ps1') -MigrateLegacy -Account <trinity|abydos>
```

## 등록 상태 확인

```powershell
& (Join-Path $SkillRoot 'scripts\ktcloud_login.ps1') -List
```

특정 계정만 확인할 수도 있습니다.

```powershell
& (Join-Path $SkillRoot 'scripts\ktcloud_login.ps1') -Status -Account trinity
```

`Registered`는 자격 증명 등록 여부, `Authenticated`는 해당 계정의 격리된 Backend.AI 쿠키 존재 여부를 나타냅니다. 두 계정 모두 동시에 `Authenticated=True`일 수 있습니다. 비밀번호는 표시되지 않습니다.

## 로그인과 계정 전환

로그인할 계정은 항상 명시합니다.

```powershell
& (Join-Path $SkillRoot 'scripts\ktcloud_login.ps1') -Account trinity
& (Join-Path $SkillRoot 'scripts\ktcloud_login.ps1') -Account abydos
```

각 로그인은 다음 계정별 상태 루트에 독립된 `cookie.dat`을 저장합니다.

```text
%LOCALAPPDATA%\ktcloud-ai-nexus\backend-state\trinity\Lablup\backend.ai\cookie.dat
%LOCALAPPDATA%\ktcloud-ai-nexus\backend-state\abydos\Lablup\backend.ai\cookie.dat
```

CLI는 반드시 계정 격리 wrapper로 호출합니다.

```powershell
& (Join-Path $SkillRoot 'scripts\ktcloud_cli.ps1') -Account trinity -- session list
& (Join-Path $SkillRoot 'scripts\ktcloud_cli.ps1') -Account abydos -- session list
```

wrapper는 해당 계정의 상태 루트와 endpoint를 자식 CLI 프로세스에만 적용하고 호출 후 환경을 복원합니다. 따라서 `trinity`와 `abydos` API 조회를 동시에 실행해도 쿠키를 덮어쓰지 않습니다. Backend.AI SSH/SCP가 고정 이름 `id_container`를 사용하는 구간은 wrapper 내부 runner가 호출별 임시 디렉터리로 격리합니다. 서로 다른 로컬 포트를 지정하면 여러 터미널의 SSH/SCP를 동시에 유지할 수 있고, SCP의 로컬 상대경로는 호출한 디렉터리를 기준으로 유지됩니다. 기존 전역 `%LOCALAPPDATA%\Lablup\backend.ai\cookie.dat`은 더 이상 사용하지 않습니다.

### Windows 로그인 런타임

로그인과 legacy session/SSH/SCP wrapper는 프로젝트 checkout이 아니라 다음 관리형 Python 환경을 사용합니다.

```text
%LOCALAPPDATA%\ktcloud-ai-nexus\client-tools\25.5.2\windows-login
```

최초 설치 또는 손상 복구는 canonical installer로 수행합니다. Python 3.12가 이미 있으면 기본 명령을, 없으면 사용자 범위 Python 설치까지 허용하는 옵션을 사용합니다.

```powershell
& (Join-Path $SkillRoot 'scripts\install_backendai_windows_runtime.ps1')
& (Join-Path $SkillRoot 'scripts\install_backendai_windows_runtime.ps1') -InstallPython
```

installer는 검증된 고정 requirements로 Backend.AI client 25.5.2를 구성하고 로그인에 필요한 imports를 확인한 뒤 manifest를 기록합니다. Windows에서 설치할 수 없고 로그인·session CLI 경로에서 사용하지 않는 서버 etcd client와 profiling integration은 의도적으로 포함하지 않습니다. wrapper는 관리형 런타임과 명시적인 `KTCLOUD_BACKEND_PYTHON` override만 허용하며, 임의의 PATH Python이나 repository의 `.tmp-*` 환경을 자동 선택하지 않습니다. override도 client 25.5.2와 로그인 imports를 통과해야 합니다.

설치 검증은 다음과 같이 수행합니다.

```powershell
& (Join-Path $SkillRoot 'scripts\test_ktcloud_login_runtime.ps1')
& (Join-Path $SkillRoot 'scripts\test_ktcloud_login_runtime.ps1') -Live -Account arius1,arius2,arius3
```

### Windows/Ubuntu runtime 분기

Windows에서 `valkey-glide`가 지원되지 않는 26.7 client를 shim하지 않는다. 다음 canonical helper가
사용자 범위 Ubuntu WSL2 배포판, 공식 Linux fat client, release hash와 계정별 state link를 검증·준비한다.

```powershell
& (Join-Path $SkillRoot 'scripts\install_backendai_v2_runtime.ps1')
```

정상 설치의 고정 계약은 다음과 같다. 이 Linux runtime은 v2 조회용이며 위 Windows 로그인 runtime과 역할이 다르다.

- 배포판: `ktcloud-ubuntu-24.04` (WSL2, `docker-desktop`과 분리)
- client: 공식 `backendai-client-fat-linux-x86_64` 26.7.0
- SHA-256: `dbdc8938a7d7174bb8551ef5499a84a63b24f5d786bc7173a96acafe6a6f5429`
- binary와 manifest: `%LOCALAPPDATA%\ktcloud-ai-nexus\client-tools\26.7.0`
- `v2 ...`: Ubuntu WSL2 Linux client
- legacy session list/create 및 SSH/SCP: 기존 Windows 25.5.2 runner
- login/status: 기존 Windows DPAPI helper

26.7 v2 CLI는 session cookie를 `~/.backend.ai/session/cookie.dat`에서 읽으므로 WSL 내부의 계정별
HOME에 Windows 원본 state directory를 가리키는 symlink만 둔다. cookie 자체는 복사하지 않는다.
wrapper는 symlink의 최종 대상이 선택 계정의 `%LOCALAPPDATA%` state와 정확히 일치할 때만 실행하며,
`XDG_STATE_HOME`과 `KTCLOUD_BACKEND_STATE_PATH`도 같은 원본 state에 제한한다.

기본 `-Runtime Auto`는 선두 명령이 `v2`이면 Linux, 그 외에는 Windows를 선택한다. 진단 또는
즉시 복구에는 `-Runtime Windows`나 프로세스 범위 `KTCLOUD_BACKEND_RUNTIME=Windows`를 쓸 수
있다. `-Runtime Linux`는 legacy 명령을 거부한다. 25.5.2 환경, DPAPI credential과 cookie는
Linux runtime 설치·복구 과정에서 삭제하거나 이동하지 않는다.

```powershell
& (Join-Path $SkillRoot 'scripts\ktcloud_cli.ps1') -Account abydos -Runtime Windows -- session list
& (Join-Path $SkillRoot 'scripts\test_ktcloud_cli_runtime.ps1') -Live
```

인증 만료 오류가 발생하면 같은 계정으로 한 번 다시 로그인합니다. 반복해서 실패하면 비밀번호를 요청하거나 출력하지 말고 사용자가 해당 계정을 `-Setup`으로 갱신하게 합니다.

## 계정 선택 규칙

- 새 세션 요청에서 사용자가 계정을 언급하지 않으면 `abydos`를 사용합니다.
- `trinity`는 사용자가 명시적으로 `trinity`를 요청한 경우에만 사용합니다.
- `ariusN` 계정은 사용자가 해당 별칭을 명시한 경우에만 사용하고, GPU 한도는 정적으로 추정하지 않으며 로그인 후 실시간 자원 할당량을 조회합니다.
- GPU 2개 이상이 필요해도 Agent가 `trinity`로 자동 전환하지 않습니다. `abydos` 한도로 불가능하다고 보고하고 명시적 선택을 요청합니다.
- 기존 세션 작업은 GPU 수와 관계없이 해당 세션 문서의 `소유 계정`으로 로그인합니다.
- 세션 소유 계정이 확인되지 않으면 양쪽 계정의 세션 목록에서 UUID를 조회하며 추측하지 않습니다.
- 세션 문서에는 실제 사용자 ID 대신 `trinity`, `abydos` 또는 명시적으로 선택된 `ariusN` 별칭만 기록합니다.

## 자격 증명 삭제

```powershell
& (Join-Path $SkillRoot 'scripts\ktcloud_login.ps1') -Remove -Account trinity
& (Join-Path $SkillRoot 'scripts\ktcloud_login.ps1') -Remove -Account abydos
```

이 명령은 선택한 계정의 DPAPI 자격 증명만 삭제합니다. 서버 세션이나 다른 계정의 자격 증명은 건드리지 않습니다.

## 보안 경계와 제한

- 일반 실행 과정에서 Agent는 비밀번호 문자열을 입력·출력하거나 명령 인수로 다루지 않습니다.
- 동일 Windows 사용자 권한이 침해되면 DPAPI 자격 증명도 악용될 수 있으므로 완전한 권한 분리는 아닙니다.
- OTP 계정은 무인 로그인하지 않습니다. OTP를 저장하지 않고 사용자가 대화형 로그인합니다.
- 자격 증명, 계정별 `cookie.dat`, `login-state.json`, OTP와 SSH 개인키를 저장소에 복사하지 않습니다.
- `%LOCALAPPDATA%\ktcloud-ai-nexus`의 자격 증명·쿠키·로그인 상태는 장치 로컬 인증 재료일 뿐 세션 기록이 아닙니다. Git 저장소나 portable skill copy로 복사하지 않습니다.
- legacy `admin keypair info`는 민감한 keypair 재료를 반환할 수 있어 wrapper와 runner 양쪽에서 차단합니다. 자원 확인에는 `v2 my resource-allocation keypair-usage`를 사용합니다.
- Windows `aiodns needs a SelectorEventLoop` 문제를 피하도록 helper가 Selector 이벤트 루프를 설정합니다.

## 문제 해결

### 제한된 조회와 호환 명령

`scripts/ktcloud_query.ps1`은 확인된 조회 계약을 명시적으로 선택한다. 인증된 같은 계정에서
다음처럼 사용한다. `SessionState`와 `SessionDetails`는 이름이 아니라 UUID를 요구한다.

```powershell
& (Join-Path $SkillRoot 'scripts/ktcloud_query.ps1') -Account abydos -Query UserResources
& (Join-Path $SkillRoot 'scripts/ktcloud_query.ps1') -Account abydos -Query SessionSearch -Limit 20
& (Join-Path $SkillRoot 'scripts/ktcloud_query.ps1') -Account abydos -Query SessionState -SessionId <UUID>
& (Join-Path $SkillRoot 'scripts/ktcloud_query.ps1') -Account abydos -Query SessionDetails -SessionId <UUID>
& (Join-Path $SkillRoot 'scripts/ktcloud_query.ps1') -Account abydos -Query Vfolders -FolderName <persistent-folder>
& (Join-Path $SkillRoot 'scripts/ktcloud_query.ps1') -Account abydos -Query Images
```

- `SessionSearch`는 제한된 한 페이지이다. 전체 이력 확인에는 기존 pagination 계약을 사용한다.
- `Images`는 legacy image 목록이다. runtime preset의 필드나 동일한 출력 형식을 보장하지 않는다.
- `Vfolders`는 legacy 목록과 이름 필터를 사용해 알려진 v2 `quota` 검증 오류를 피한다.
- 이력이 `None`인 세션에서는 `status-history` 대신 현재 상태와 상세 조회를 사용한다.
- raw CLI에서 `--format 'name,status,status_info,status_data'`처럼 쉼표 인자를 하나로 인용한다.
  지원되지 않는 `containers` 출력 필드를 추가하지 말고 `session info UUID`를 사용한다.

읽기 전용 allowlist의 조회는 CLI 실행 기준 작은 조회 30초, 목록/search 60초 제한을 적용한다.
`-TimeoutSeconds`로 조절하고 `-MaxRetries 0`으로 재시도를 끌 수 있다. 일시적인 시간 초과,
네트워크 오류, HTTP 5xx만 최대 두 번 재시도한다. 인증/4xx, DTO 형식 오류, 인자 오류,
비어 있는 상태 이력, 원인 불명 오류는 자동 재시도하지 않는다. 원래 출력과 종료 코드는
성공한 마지막 시도 또는 최종 실패에서 반환하며, 재시도마다 JSON 응답을 이어 붙이지 않는다.
시간 초과는 wrapper 종료 코드 124, 사용자 중단은 130이다. 진단 메타데이터의 `exit_code`는
정리 과정까지 반영된 실제 자식 프로세스 종료 코드이며 wrapper의 시간 초과 코드와 다를 수 있다.
세션 생성/종료, SSH/SCP, 앱 프록시와 allowlist 밖 명령은 이 정책을 적용하지 않는다.
이 명령들에 조회 옵션을 명시하면 실행 전에 거부한다. 인증 만료를 DTO 오류로 오해해
쿠키를 삭제하거나 자동 재로그인하지 않는다.

진단 JSONL은 `%LOCALAPPDATA%\ktcloud-ai-nexus\diagnostics`에 둔다. 계정 별칭,
명령 종류, 런타임/클라이언트 버전, 시도 번호, 소요 시간, 종료 코드, 오류 분류만 기록한다.
인자 값, 세션 UUID, URL, 원래 응답/오류, 자격 증명, SSH/SCP 연결 정보는 저장하지 않는다.
운영 분석에는 이 메타데이터를 사용하고, 민감 정보가 섞일 수 있는 원래 출력을 별도 파일로
무차별 redirect하지 않는다. WSL 초기 기동·hash·state-link 검증 시간은 CLI 실행 제한과
구분한다. 지연을 재현할 때 cold/warm 실행을 나누어 측정한다.

세션이 `CREATING`에 오래 머물면서 기본 서비스 기동 로그와 SSH/app 404가 함께 나타나면,
CLI 성공 여부와 세션 준비 완료를 구분한다. 재생성이나 DB 상태 변경을 자동 수행하지 않는다.
소유 계정의 canonical 세션 기록에 UUID, 상태 확인 시각, 비밀값 없는 오류 요약과 운영자에게
확인할 manager–agent 상태 전환·앱 프록시 경로를 기록한다. 운영자 연락은 사용자 지시가
있을 때만 수행하며, 로그만으로 서버 측 원인을 확정하지 않는다.

- `자격 증명이 없습니다`: 표시된 계정을 `-Setup`으로 등록합니다.
- `authentication failed`: 사용자가 해당 계정의 자격 증명을 다시 등록합니다.
- `this account requires OTP`: 자동화를 중단하고 사용자가 직접 로그인합니다.
- wrapper 결과의 계정이 예상과 다름: 직접 `backend.ai.exe`를 호출하지 않았는지 확인하고 해당 계정으로 다시 로그인합니다.
- Windows 로그인 runtime을 찾지 못함: `install_backendai_windows_runtime.ps1`을 실행합니다. Python 3.12도 없으면 `-InstallPython`을 추가합니다. repository의 임시 venv를 fallback으로 만들지 않습니다.
- 명시적인 SDK Python을 시험할 때만 프로세스 범위 `KTCLOUD_BACKEND_PYTHON`에 해당 `python.exe`를 지정합니다. resolver가 client 25.5.2와 로그인 imports를 검증하며, 실패한 override를 다른 Python으로 조용히 대체하지 않습니다.
- `missing module: ...`: 관리형 runtime이 불완전하거나 승인되지 않은 override입니다. 같은 installer를 다시 실행한 뒤 runtime test를 수행합니다. 비밀번호나 cookie를 삭제·재등록하지 않습니다.
- v2 Linux client hash, 배포판 또는 account state link 오류: `install_backendai_v2_runtime.ps1`을 다시 실행해 검증한다. 자동 삭제나 cookie 재등록은 하지 않는다.
- API `v9.20250722`에서 `runtime-variant-preset search`의 `required`, `vfolder my-search`의 `quota` 필드가 빠져 26.7 DTO validation이 실패할 수 있다. 인증·runtime dependency 실패로 오해하거나 client DTO를 patch하지 말고 legacy 조회 계약을 사용하며 서버 호환성 기록에 남긴다.

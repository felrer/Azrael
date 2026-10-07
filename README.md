# Azrael

Azrael은 VS Code에서 AI 에이전트와 함께 코드와 프로젝트 작업을 수행하기 위한 독립 호스트입니다. Codex 기반 엔진과 UI를 바탕으로 채팅, 계정·사용량 관리, 여러 제공자의 모델 사용, 에이전트 협업과 대화 복구 기능을 통합합니다.

하나의 통합 확장으로 실행하며, 계정·대화·설정은 `~/.azrael-ex`에 보관합니다. 기존 Codex와 별도의 상태를 사용하며, 설치 절차는 기존 Codex 확장과 다른 확장, VS Code 설정을 보존하도록 구성되어 있습니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 통합 채팅과 작업 실행 | VS Code 안에서 대화를 이어가며 파일 편집, 명령 실행, 도구 호출을 수행합니다. |
| 계정·사용량 관리 | **계정 및 사용량** 화면에서 계정 로그인·전환·삭제와 제공자별 사용량을 관리합니다. |
| 여러 제공자와 모델 | OpenAI, Devin 및 관리형 제공자 연동을 통해 모델을 선택합니다. 사용 가능한 모델과 인증 방식은 제공자와 계정에 따라 다릅니다. |
| 에이전트 협업 | 하위 에이전트에 작업을 맡기고 진행·완료 결과를 받아 작업을 이어갑니다. 지원되는 경로에서는 서로 다른 제공자의 모델을 함께 사용할 수 있습니다. |
| 대화 복구와 입력 큐 | 실행 상태를 확인하고 중단된 대화를 복구하며, 대기 입력과 컨텍스트 압축 요청을 관리합니다. |
| 작업 환경 설정 | 제공자별 컨텍스트 압축 기준, 작업 지침 문서, Computer Use와 Window Use 관련 설정을 제공합니다. |

기능의 구현·설치·실제 서비스 검증 범위는 서로 다를 수 있습니다. 현재 상태는 [개발 상태와 제한사항](#개발-상태와-제한사항), 상세 동작은 [아키텍처 문서](docs/architecture/README.md)에서 확인할 수 있습니다.

## 시작하기

현재 문서화된 빌드·설치 환경은 **Windows와 VS Code**입니다. 로컬 개발 환경에서 통합 호스트를 빌드하고 검증한 뒤 설치하는 절차를 제공합니다.

### 필요한 환경

- PowerShell 7, Git, Node.js/npm, Python 3.11 이상
- 프로젝트에서 지정한 Rust 도구 체인과 MSVC Build Tools
- VS Code와 `code.cmd`
- 지정된 버전의 원본 Codex UI 스냅샷과 호환되는 `codex-code-mode-host.exe`
- 설치 절차에서 참조할 공식 Codex 확장 및 같은 버전의 오디오 확장 경로

Devin 연동에는 외부 Node.js 22.18 이상이 필요하고, 관리형 제공자 연동에는 프로젝트에서 지정한 Bun 런타임을 사용합니다. 정확한 버전과 준비 조건은 [개발 환경 요구사항](docs/ops/development.md#prerequisites)을 따릅니다. 원본 UI와 실행 파일은 별도 준비가 필요하므로 저장소 복제만으로 설치 준비가 완료되지는 않습니다.

### 빌드·검증·설치

프로젝트 루트에서 PowerShell 7로 실행합니다. 아래 `<...>` 값은 실행 전에 실제 경로와 새로운 릴리스 이름으로 바꿉니다.

```powershell
./scripts/deploy-azrael.ps1 -ReleaseName '<새 릴리스 이름>' `
  -SourceRoot "$PWD/engine" `
  -EngineTargetDirectory '<Rust 빌드 캐시의 절대 경로>' `
  -CodeModeHostPath '<호환되는 codex-code-mode-host.exe의 절대 경로>' `
  -OriginalExtensionPath '<설치된 공식 Codex 확장 경로>' `
  -OriginalAudioPath '<같은 버전의 공식 오디오 확장 경로>' `
  -VerifyOnly
```

`-VerifyOnly`는 빌드, 소스 검사, 패키지 준비와 격리된 호스트 검증까지 수행합니다. 실제 사용자 프로필에 설치하려면 새로운 릴리스 이름으로 같은 절차를 실행하면서 `-VerifyOnly`를 제외합니다. 전체 배포 절차가 빌드를 포함하므로 별도의 전체 빌드를 먼저 실행할 필요는 없습니다.

설치가 끝나면 기존 VS Code 창에서 **Developer: Reload Window**를 실행해 새 호스트를 활성화합니다. 설치 도구는 사용 중인 창을 자동으로 종료하거나 다시 로드하지 않습니다.

계정 모듈의 `azrael-ex.vsix`는 통합 호스트를 만드는 중간 패키지입니다. 설치 대상은 검증된 통합 호스트 패키지이며, 계정 모듈을 별도로 설치하지 않습니다.

세부 옵션, 기존 빌드 재사용, 설치와 롤백은 [개발·설치 안내](docs/ops/development.md)에서 확인할 수 있습니다.

### 처음 사용하기

1. 통합 호스트 설치 후 VS Code 창을 다시 로드합니다.
2. 프로필 메뉴의 **계정 및 사용량**에서 사용할 제공자의 계정을 연결합니다.
3. 채팅에서 사용 가능한 모델을 선택하고 작업을 요청합니다.
4. **Azrael 설정**에서 작업 환경을 조정합니다.

계정별 연결 조건과 제공자 검증 범위는 [계정 및 제공자 운영 안내](docs/ops/provider-accounts.md), Devin 연결 조건은 [Devin 운영 안내](docs/ops/devin-native.md)를 참고합니다.

## 프로젝트 구조

| 경로 | 역할 |
| --- | --- |
| [`engine/`](engine/) | Codex 기반 Azrael 엔진 소스와 출처 정보 |
| [`extensions/azrael-ex/`](extensions/azrael-ex/) | 통합 호스트에 포함되는 계정·사용량 및 설정 모듈 |
| [`providers/`](providers/) | 제공자 인증·추론 연동 모듈 |
| [`native/`](native/) | Windows 네이티브 기능 |
| [`plugins/`](plugins/) | 플러그인과 관련 스킬·도구 구성 |
| [`instructions/`](instructions/) | 공통 작업 지침, 스킬과 사용 예시 |
| [`scripts/`](scripts/) | 빌드·패키징·검증·설치 도구 |
| [`docs/`](docs/) | 아키텍처, 코드 지도, 운영 절차와 작업 지침 |
| `artifacts/` | Git에서 제외되는 빌드 결과, 릴리스, 패키지와 로그 |

## 문서 안내

[프로젝트 문서 안내](docs/README.md)를 시작점으로 목적에 맞는 문서를 찾아볼 수 있습니다.

- [아키텍처](docs/architecture/README.md): 시스템 구조, 기능별 동작과 설계 상태
- [코드 지도](docs/maps/README.md): 구현 위치와 주요 진입점
- [운영 안내](docs/ops/README.md): 개발, 설치, 계정 연결과 오류 진단
- [프로젝트 플레이북](docs/playbooks/README.md): 작업 원칙과 검증·정리 기준
- [공통 작업 지침과 스킬](instructions/README.md): 유지·배포하는 지침 라이브러리
- [기여·작업 안내](AGENTS.md): 저장소에서 작업할 때 적용하는 규칙

## 개발 상태와 제한사항

Azrael은 개발 중인 프로젝트입니다. 통합 호스트의 설치, 계정·사용량 화면, 제공자 연동과 일부 네이티브 기능에 대한 검증이 진행되어 있으며, 기능별로 확인된 범위가 다릅니다.

- 현재 문서화된 빌드·설치 대상은 Windows입니다. 다른 운영체제의 지원 여부는 별도 검증이 필요합니다.
- 소스 검사나 격리된 테스트 통과가 실제 계정 인증, 모든 모델의 추론·도구 호출, 설치된 화면의 전체 동작을 보장하지는 않습니다.
- 전체 upstream `codex-core` 및 워크스페이스 테스트의 완전한 통과는 확인되지 않았습니다.
- Computer Use와 Window Use는 설정 제공, 네이티브 동작, 실제 모델 요청의 검증 범위를 구분합니다. 특히 선택한 창을 대상으로 하는 제어 모드는 별도 설치 검증 조건이 남아 있습니다.
- 공개 릴리스 배포와 GitHub에서의 실제 릴리스 다운로드 검증은 별도 단계입니다. 통합 UI의 재배포 조건도 확인이 필요합니다.

설치된 버전과 남은 검증 항목은 [현재 개발 상태](docs/ops/development.md#current-state), 제공자별 확인 범위는 [제공자 운영 안내](docs/ops/provider-accounts.md), 공개 배포 조건은 [지침·소스 배포 안내](docs/ops/instruction-distribution.md)에 유지합니다.

## 라이선스와 출처

Azrael 자체 코드와 작업 지침에는 [MIT 라이선스](LICENSE)가 적용됩니다. 가져온 소스, 의존성과 에셋에는 각 구성요소의 라이선스와 이용 조건이 적용됩니다.

Codex 기반 엔진은 [Apache-2.0 라이선스](engine/LICENSE)와 [NOTICE](engine/NOTICE)를 유지하며, 정확한 소스 정보는 [`engine/SOURCE.json`](engine/SOURCE.json)에 기록합니다. 제공자 연동 코드, 런타임, 글꼴과 공식 UI 관련 조건은 [제3자 고지](THIRD_PARTY_NOTICES.md)를 참고합니다.

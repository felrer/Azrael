# Codex Efficient Subagents

Codex에서 **요구사항 정리 → 설계 → 구현·검증**을 이어 가고, 독립적인 작업을 subagent에 맡기는 개인 작업 체계를 공유합니다. 공통 지침, 역할 설정, 세 가지 스킬, 프로젝트 문서 템플릿과 공용 작업 Playbook을 함께 제공합니다.

개인 Obsidian Vault나 Google Drive 없이 설치하고 프로젝트 작업을 시작할 수 있습니다. Git 소스 트리에는 애플리케이션 코드가 없으며, Azrael 앱 빌드는 별도 Release 자산으로 배포합니다.

[Azrael 설치](#azrael-설치-windows-x64) · [전체 흐름](#전체-흐름) · [구성 요소](#구성-요소와-책임) · [Codex 지침 설치](#빠른-설치) · [스킬 description](#스킬-description) · [프로젝트 시작](#프로젝트-시작하기) · [작업 예시](#첫-작업부터-완료까지) · [사용자별 조정](#사용자별-조정) · [문제 해결](#업데이트와-문제-해결)

## Azrael 설치 (Windows x64)

[최신 Azrael Release](https://github.com/felrer/codex-efficient-subagents/releases/tag/azrael-2026-09-30)는 독립 VS Code 호스트, 엔진, OpenAI/Devin provider 실행 파일을 포함합니다. Windows x64 로컬 환경에서 VS Code 1.96.2 이상, PowerShell 7, Node.js 22.18 이상, Git을 준비하고 `code`, `node`, `pwsh` 명령을 실행할 수 있게 합니다. 설치에는 약 2 GB의 여유 공간과 GitHub 다운로드 연결이 필요합니다.

```powershell
git clone https://github.com/felrer/codex-efficient-subagents.git
cd codex-efficient-subagents
pwsh -NoProfile -File ./azrael/install.ps1
```

설치기는 Release ZIP을 다운로드하고 SHA-256을 확인한 뒤 `%LOCALAPPDATA%/Azrael/releases/`에 풉니다. 현재 PC의 Node 실행 파일과 경로를 검증해 VSIX 설정을 만든 다음 `code --install-extension`으로 `azrael-ex-local.azrael`을 설치합니다. VS Code에서 **Developer: Reload Window**를 실행하고 사이드바의 **azrael**을 엽니다. 첫 사용 시 Azrael 계정으로 로그인합니다. Azrael 상태는 `~/.azrael-ex`에 저장되며 일반 Codex의 `~/.codex`와 분리됩니다.

이미 Release ZIP을 받은 경우 `pwsh -NoProfile -File ./azrael/install.ps1 -ArchivePath 'C:\path\azrael-windows-x64.zip'`으로 설치할 수 있습니다. `code`가 PATH에 없으면 `-CodePath 'C:\path\to\code.cmd'`를 지정합니다. 설치 전 파일만 준비하려면 `-PrepareOnly`를 추가합니다. 설치된 빌드 버전과 해시는 [release.json](https://github.com/felrer/codex-efficient-subagents/blob/main/azrael/release.json)에 고정되어 있습니다.

이 절차는 Azrael 앱 설치입니다. 아래의 공통 지침·역할·스킬은 별도로 설치합니다. Release 호스트는 공식 Codex UI `26.917.62051`을 기준으로 빌드되었으며 Windows 로컬 실행용입니다.

## 전체 흐름

```mermaid
flowchart TD
    A[project-bootstrap: 프로젝트 문서 기반 준비] --> B[planning: 요구사항·결정 사항 정리]
    B --> B2{방향을 바꿀 수 있는 질문이 있는가?}
    B2 -->|예| B3[답변 확인 후 조사 계속]
    B2 -->|아니오| B4[구현 가능성 조사와 구현 계획]
    B3 --> B4
    B4 --> C[사용자의 계획 승인]
    C --> D{관련 설계 변경이 필요한가?}
    D -->|예| E[designing: 설계 문서 갱신]
    D -->|아니오| F[구현과 검증]
    E --> F
    F --> G[메인 에이전트가 결과 통합·완료 판단]
```

bootstrap은 프로젝트를 처음 준비하거나 문서 체계를 정돈할 때 사용합니다. 매 작업마다 반복하지 않습니다. 탐색은 방향을 정하는 중에도 위임할 수 있고, 구현 위임은 요구사항과 파일 소유 범위를 정한 뒤 진행합니다.

**작업을 시작할 때 `planning 스킬을 사용해 먼저 방향을 정리해주세요`라고 명시하는 것을 권장합니다.** 자동 선택에만 맡기지 않고 원하는 작업 절차를 분명히 전달할 수 있습니다.

```text
planning 스킬을 사용해주세요.
검색 결과에 필터 기능을 추가하려고 합니다.
기존 구현을 확인하고 목표, 범위, 성공 조건, 미확정 사항을 먼저 정리해주세요.
```

Codex CLI·IDE에서는 `$planning`으로 직접 지정할 수도 있습니다. 스킬은 이름과 description을 바탕으로 자동 선택되기도 합니다. 이 저장소의 planning 스킬과 제품의 Plan mode는 별개입니다. [공식 스킬 안내](https://learn.chatgpt.com/docs/build-skills)

## 구성 요소와 책임

| 구성 | 책임 | 파일 |
|---|---|---|
| 메인 에이전트 | 사용자 소통, 요구사항·설계 판단, 범위와 소유권 결정, 결과 통합 | [공통 지침](instructions/AGENTS.snippet.md) |
| `luna_explorer` | 지정 범위의 읽기 전용 탐색과 근거 수집 | [역할 설정](agents/luna_explorer.toml) |
| `sol_executor` | 합의된 범위의 구현과 검증 | [역할 설정](agents/sol_executor.toml) |
| `planning` | 요구사항 확인부터 구현·평가까지 작업 진행 | [SKILL.md](skills/planning/SKILL.md) |
| `designing` | 승인된 요구사항을 지속적으로 관리할 설계로 구체화 | [SKILL.md](skills/designing/SKILL.md) |
| `project-bootstrap` | 문서 진입점, 작업 저장 위치, playbook 안내 준비 | [SKILL.md](skills/project-bootstrap/SKILL.md) |
| 작업 Playbook | 재사용, 레거시 호환·마이그레이션, 파일 구조, 검증과 정리의 공통 실행 기준 | [work.md](skills/project-bootstrap/assets/playbooks/work.md) |
| 앱 로그 Playbook | 신규 앱의 로그, 로깅 변경, 로그 부족으로 원인 추적이 어려운 진단의 실행 기준 | [app-logging.md](skills/project-bootstrap/assets/playbooks/app-logging.md) |

짧은 조회나 작은 수정은 메인 에이전트가 직접 처리합니다. 독립적인 작업을 나누는 이점이 있을 때 위임하며, 동시 실행 한도를 채우기 위해 작업을 나누지 않습니다. 전달 형식은 [위임 예시](examples/delegation.md)를 참고하세요.

## 빠른 설치

### 1. 준비와 다운로드

로컬 파일을 읽고 실행할 수 있는 Codex 환경, Git, Python 3.10 이상을 준비합니다. Python은 planning의 작업 문서 유틸리티에 필요하며 표준 라이브러리만 사용합니다. 역할 파일에 지정한 모델을 계정에서 사용할 수 있는지도 확인하세요.

```sh
git clone https://github.com/felrer/codex-efficient-subagents.git
cd codex-efficient-subagents
```

### 2. 설치 범위 선택

여러 프로젝트에서 같은 체계를 사용하려면 전역 설치, 한 프로젝트에서만 사용하거나 팀과 함께 관리하려면 프로젝트 설치를 선택합니다.

| 저장소 내용 | 전역 설치 위치 | 프로젝트 설치 위치 |
|---|---|---|
| `instructions/AGENTS.snippet.md` 내용 | `~/.codex/AGENTS.md`에 병합 | 프로젝트 `AGENTS.md`에 병합 |
| `agents/*.toml` 두 파일 | `~/.codex/agents/` | `.codex/agents/` |
| `config.example.toml` 내용 | `~/.codex/config.toml`에 병합 | `.codex/config.toml`에 병합 |
| `skills/` 안의 세 폴더 전체 | `~/.agents/skills/` | `.agents/skills/` |

`~`는 사용자 홈 폴더입니다. `CODEX_HOME`을 따로 설정했다면 위 표의 `~/.codex`를 해당 경로로 바꿉니다. 스킬 설치 위치인 `~/.agents/skills`와는 구분하세요. 스킬 폴더의 scripts, references, assets도 함께 복사해야 합니다. [공식 스킬 경로 안내](https://learn.chatgpt.com/docs/build-skills)

기존 파일은 먼저 백업하고 비교해 병합하세요. 기존 `[agents]` 섹션이 있다면 중복 생성하지 않고 [설정 예시](config.example.toml)의 항목을 합칩니다. 같은 이름의 스킬이 이미 있다면 사용자 수정과 비교한 뒤 교체합니다. 세 스킬은 같은 `skills` 디렉터리 아래에 형제 폴더로 유지하세요.

Codex에 설치를 맡길 때는 다운로드한 저장소의 실제 경로와 적용 범위를 지정합니다.

```text
이 저장소의 README와 실제 파일을 확인하고 현재 프로젝트에 설치해주세요.
공통 지침과 Codex 설정은 기존 내용에 병합하고,
두 역할 파일과 세 스킬의 전체 폴더를 프로젝트 설치 위치에 배치해주세요.
기존에 같은 이름의 설정이나 스킬이 있으면 차이를 확인하고 사용자 변경을 보존해주세요.
```

### 3. 설치 확인

Codex를 다시 열고 다음을 확인합니다.

- 스킬 목록에서 `planning`, `designing`, `project-bootstrap`의 이름과 description이 보이는지 확인합니다.
- `planning 스킬로 작은 개선 작업의 방향만 정리해주세요`라고 요청해 구현 전에 요구사항과 확인할 내용을 정리하는지 확인합니다.
- 실제 프로젝트 경로를 지정해 `luna_explorer`에 읽기 전용 탐색을 한 번 맡기고 역할·모델·근거 반환을 확인합니다. [확인 예시](examples/delegation.md#설치-후-작은-확인-작업)

## 스킬 description

아래는 배포한 각 `SKILL.md`의 `description` 원문입니다. 에이전트가 스킬의 용도와 사용 시점을 판단하는 메타데이터이므로 본문과 함께 공유합니다.

### planning

> 모든 코드 수정 작업의 진입점입니다. 목표, 해결 방향, 동작 또는 범위에 미확정 사항이 있는 문제 해결·개선 요청에서 요구사항 정리, 사용자 승인, 설계 문서 수정, 구현과 평가까지 진행합니다.

요청과 기존 설계·코드를 확인해 목표·제약·성공 조건과 검증 방법을 작업 계획 문서 하나(`nn-plan.md`)에 정리합니다. 문서 첫 줄에 현재 단계와 사용자가 할 일을 표시합니다. 사용자에게 보이는 동작, 범위, 호환성, 한도, 자원, 권한에 영향을 주는 선택은 권장안과 함께 결정 사항으로 제시합니다. 답에 따라 방향이 바뀔 질문이 있으면 깊은 조사 전에 먼저 확인받고, 코드 조사 후 구현 방식을 더해 계획 승인을 받습니다. 승인 후 designing으로 설계 문서를 갱신하고 구현·검증·정리까지 진행합니다. 구현 중 계획과 달라지면 계획을 먼저 고치고, 결정에 영향이 있으면 다시 묻습니다. 작업 위치가 없으면 대화에서 정리합니다.

파일: [스킬](skills/planning/SKILL.md) · [작업 문서 규칙](skills/planning/references/task-artifacts.md) · [실행 준비](skills/planning/references/implementation-plans.md) · [생성 유틸리티](skills/planning/scripts/work_artifacts.py)

### designing

> 승인된 요구사항을 제품·시스템의 동작과 구조로 구체화하고, 구현과 검토의 기준이 되는 설계 문서를 작성하거나 갱신합니다.

합의된 요구사항을 바탕으로 동작, 데이터 의미, 구성요소의 책임, 실패·충돌 처리와 결정 이유를 담당 설계 문서에 반영합니다. 설계 문서에는 변경 이력 없이 최신 설계만 남기고, 상태는 문서·절 단위로 표시하며, 검증 근거는 작업 계획이나 운영 문서에 두고 링크합니다. 파일별 수정 목록을 나열하는 실행 계획과 구분합니다.

파일: [스킬](skills/designing/SKILL.md)

### project-bootstrap

> Create or align project documentation entry points, configurable work locations with scripted work-plan creation, and project playbook routing with common Work and app logging playbooks included by default. Use when explicitly bootstrapping or normalizing a project. Do not generate application scaffolding, detailed designs, or task plans.

새 프로젝트에는 최소 문서 구조와 공용 작업 Playbook을 준비하고, 기존 프로젝트에는 내용을 보존하면서 필요한 진입점과 연결을 보완합니다. 동등한 작업 지침이 있으면 그 문서에 필요한 내용을 통합합니다. 작업 문서는 planning과 같은 세션별 번호 plan 체계를 사용합니다.

파일: [스킬](skills/project-bootstrap/SKILL.md) · [프로젝트 템플릿](skills/project-bootstrap/assets/project-template/)

## 프로젝트 시작하기

작업할 프로젝트를 Codex에서 연 뒤 요청합니다.

**새 프로젝트**

```text
project-bootstrap 스킬로 이 프로젝트의 문서 기반을 준비해주세요.
작업 문서는 docs/work에 저장하고, 애플리케이션 코드는 아직 만들지 마세요.
```

**기존 프로젝트**

```text
project-bootstrap 스킬로 기존 문서와 지침을 확인해주세요.
기존 구조와 내용을 보존하며 필요한 문서 진입점과 작업 저장 위치를 정돈해주세요.
```

새 프로젝트의 기본 구조입니다. 기존 프로젝트는 같은 역할을 맡는 문서가 있으면 재사용합니다.

```text
AGENTS.md
docs/
  README.md               # 문서 탐색과 Work directory 설정
  architecture/README.md  # 동작·구조·계약을 담을 설계 문서 안내
  maps/README.md          # 구현 위치와 관계 안내
  ops/README.md           # 실행·검증·운영 절차 안내
  playbooks/README.md     # 작업 유형별 지침 선택
  playbooks/work.md       # 공용 작업 지침을 프로젝트에 맞게 적용
  playbooks/app-logging.md # 앱 로그와 오류 진단 지침
  work/README.md          # 작업 기록 사용 규칙
```

bootstrap은 문서 진입점과 함께 [공용 작업 Playbook](skills/project-bootstrap/assets/playbooks/work.md)과 연결된 [앱 로그 Playbook](skills/project-bootstrap/assets/playbooks/app-logging.md)을 기본으로 포함합니다. 사용자가 playbook 본문을 제외한 경우에는 그 범위를 따릅니다. 기존 작업 지침이 있으면 중복 파일을 만들지 않고 해당 소유 문서에 필요한 내용만 통합하며, 프로젝트 router에 연결하고 출처·적용 시점·프로젝트별 조정을 기록합니다. 설치한 bootstrap의 assets에 본문이 포함되어 있어 별도 다운로드나 개인 Vault가 필요하지 않습니다.

작업 Playbook은 승인된 계획에 명시한 레거시 호환만 허용하고, 미명시 시 해당 변경의 목표 스키마로 마이그레이션하도록 합니다. 재사용, 파일 구조 관리, 검증, 대체된 코드·테스트·스크립트의 정리와 완료 기준도 포함합니다. 프로젝트별 데이터 보호·배포 절차와 실행 권한은 계속 해당 프로젝트의 지침을 따릅니다.

앱 로그 Playbook은 새 앱의 초기 구현, 로깅 추가·변경, 로그 부족으로 원인 추적이 어려운 진단에 적용합니다. 일반 작업은 변경한 경로의 기존 로그로 실패를 추적할 수 있는지 확인하고, 로깅 보완은 승인된 계획 범위에서 수행합니다. 앱 진단 로그의 운영 정책과 작업 중 테스트·빌드 로그의 보존 정책은 각 소유 문서에서 관리합니다.

상세 설계와 작업 계획은 실제 작업이 생길 때 작성합니다. 다른 공통 playbook은 사용자가 제공하거나 선택한 자료에서 필요한 것만 가져옵니다. 다시 bootstrap을 실행할 때 기존 규칙과 비교해 반영하며 프로젝트별 수정을 자동으로 덮어쓰지 않습니다.

## 첫 작업부터 완료까지

검색 필터를 추가한다면 다음과 같이 진행합니다.

1. **요구사항과 결정 사항:** `planning 스킬로 검색 필터 추가 방향을 먼저 정리해주세요.` 기존 검색 설계와 구조를 확인해 요구사항을 현재 설계 대비 변경점으로 쓰고, 결정 사항과 성공 조건을 정리합니다. 필터 종류처럼 답에 따라 방향이 바뀌는 질문이 있으면 여기서 먼저 답을 받습니다.
2. **계획 승인:** 코드 조사 후 구현 방식과 검증 방법이 더해진 계획을 검토하고 `이 계획으로 진행해주세요`처럼 승인합니다. 질문에 답한 것만으로는 구현 승인으로 보지 않습니다. 수정 의견은 같은 plan에 반영합니다.
3. **설계 반영:** 기존 설계의 변경이 필요하면 designing으로 담당 문서를 갱신하고, 필요 없으면 그 이유를 plan에 적습니다. 절차를 채우기 위한 설계 문서를 새로 만들지는 않습니다.
4. **구현과 검증:** 메인 에이전트가 직접 수행하거나, 독립적인 범위와 파일 소유권을 정해 subagent에 맡깁니다. 계획과 달라져야 하면 plan을 먼저 고치고, 결정에 영향이 있으면 다시 확인합니다.
5. **결과 확인:** 변경 내용, 검증 범위·결과, 남은 제한을 확인합니다. plan의 상태 줄과 최종 결과가 갱신되어 있어야 완료입니다.

작업 위치가 설정되어 있는 경우의 예시입니다. 폴더 이름은 유틸리티가 할당하므로 직접 번호를 계산하지 않습니다.

```text
docs/work/AA-01-search-filter/
  01-plan.md  # 첫 작업의 요구사항, 결정 사항, 구현 계획, 검증 결과
  02-plan.md  # 같은 세션에서 별개 후속 작업이 생겼을 때
```

같은 작업의 피드백과 조사 결과는 기존 plan을 갱신하며, 응답 이력을 따로 쌓지 않습니다. 별도 작업 세션은 새 폴더를 사용합니다. 이전 방식의 `nn-brief.md`는 그대로 두며 다음 plan 번호 계산에 포함됩니다. 설계 문서는 작업 기록과 분리해 관련 기능의 설계를 계속 관리합니다.

## 사용자별 조정

| 항목 | 기본값과 변경 위치 |
|---|---|
| 탐색 역할 | `luna_explorer`: `gpt-6.1-sol`, `low` |
| 구현 역할 | `sol_executor`: `gpt-6.1-sol`, `medium` |
| 동시 실행 한도 | `config.example.toml`의 8. 실제 작업량과 비용에 맞게 조정 |
| 작업 문서 위치 | 프로젝트 `docs/README.md`의 `## Work Artifacts` 아래 `Work directory` |
| 프로젝트 작업 지침 | 프로젝트의 `docs/playbooks/README.md`를 통해 필요한 문서만 연결 |

모델과 추론 수준은 각 역할 TOML의 `model`, `model_reasoning_effort`에서 변경합니다. 위 값은 이 저장소의 프리셋이며 모든 계정의 모델 접근을 보장하지 않습니다. 메인 에이전트의 모델은 사용하는 Codex 환경에서 선택합니다.

작업 위치는 planning 유틸리티의 `configure`로 변경할 수 있습니다. 이 명령은 설정과 안내 링크를 바꾸며 기존 작업 기록을 이동하지 않습니다. 구체적인 명령은 [작업 문서 규칙](skills/planning/references/task-artifacts.md)을 따릅니다.

## 업데이트와 문제 해결

업데이트할 때는 `git pull`로 배포본을 받은 뒤 설치한 파일과 비교해 병합합니다. 복사 설치한 파일은 자동으로 동기화되지 않습니다. 변경 기록은 [CHANGELOG](SOURCE-CHANGELOG.md)에 있습니다.

| 증상 | 확인할 내용 |
|---|---|
| 스킬이 보이지 않음 | 설치 범위, 폴더 안의 SKILL.md, name/description, Codex 재시작 |
| 동일 스킬이 두 개 보임 | 전역·프로젝트에 같은 이름으로 중복 설치했는지 |
| subagent 실행 실패 | 역할 파일 인식, 설정 병합, 지정 모델 접근, 실행 환경의 위임 지원 |
| 작업 계획 생성 실패 | Python 실행 가능 여부, 작업 위치 설정, 해당 경로의 쓰기 권한 |
| bootstrap 참조 파일이 없음 | 세 스킬이 형제 폴더인지, scripts/references/assets를 함께 복사했는지 |

이 저장소는 프롬프트와 작업 규칙을 공유합니다. 토큰 절감률이나 모든 환경에서 동일한 실행 결과를 보장하는 벤치마크는 아닙니다. 설정 형식과 실행 환경 차이는 [공식 subagent 안내](https://learn.chatgpt.com/docs/agent-configuration/subagents)를 함께 확인하세요.

# AI Nexus 데이터 폴더 이용 지침

이 문서는 AI Nexus 데이터 폴더를 여러 workspace에서 일관되고 안전하게 사용하기 위한 운영 지침입니다. `<persistent-folder>`와 원격 경로는 private state root의 `profile.json`에서 확인한 값으로 치환합니다. 해당 사용자 설정이 없으면 경로를 추측하지 않습니다.

## 1. 기본 구조

모든 세션은 `<persistent-folder>`를 `/home/work/<persistent-folder>`에 마운트하고, 다음 두 영역만 최상위 표준 디렉터리로 사용합니다.

```text
/home/work/<persistent-folder>/
├── shared/
└── workspaces/
    ├── ai-research/
    ├── <example-workspace>/
    ├── <another-workspace>/
    └── <workspace-name>/
```

- `shared`: 둘 이상의 workspace에서 공동으로 사용하는 리소스를 보관합니다.
- `workspaces`: workspace별로 독립된 작업 파일을 보관합니다.
- `workspaces/<workspace-name>`: 해당 workspace의 코드, 설정, `data`, 결과물, 로그와 임시 작업 파일을 보관합니다.

각 독립 workspace는 `workspaces` 바로 아래에 둡니다. 로컬 저장소 안의 `workspaces/<workspace-name>`와 원격 데이터 폴더를 다음처럼 일대일로 매핑합니다.

```text
local:  <repository-root>/workspaces/<workspace-name>
remote: /home/work/<persistent-folder>/workspaces/<workspace-name>
```

다음은 독립 workspace의 경로 예시입니다. 기존 사용자 workspace의 실제 경로는 private `profile.json`의 `knownWorkspacePaths`와 해당 세션 기록에서 확인합니다.

```text
/home/work/<persistent-folder>/workspaces/<example-workspace>
```

다음과 같이 repository workspace를 다시 끼워 넣는 중첩 경로에는 새 파일을 저장하지 않습니다.

```text
# 금지
/home/work/<persistent-folder>/workspaces/ai-research/workspaces/<workspace-name>
```

기존 중첩 경로에 호환용 심볼릭 링크가 있더라도 새 명령, 문서, 설정에는 canonical 짧은 경로만 사용합니다.

### 1.1 Workspace 내부 표준 구조

```text
/home/work/<persistent-folder>/workspaces/<workspace-name>/
├── data/
│   ├── datasets/
│   ├── manifests/
│   ├── models/
│   └── tokenizers/
├── external/
├── logs/
├── results/
└── scripts/
```

- 다운로드 데이터셋과 생성한 calibration input은 `data/datasets`에 저장합니다.
- 모델 weight와 checkpoint는 `data/models`에 저장합니다.
- tokenizer는 `data/tokenizers`에 저장합니다.
- SHA-256, source revision, byte size 등 검증 정보는 `data/manifests`에 저장합니다.
- 실행 로그는 `logs`, 최종·중간 실험 결과는 `results`에 저장합니다.
- 스크립트에서는 가능한 한 workspace root 기준 상대 경로(`data/...`)를 사용합니다.
- 절대 경로가 필요하면 `/home/work/<persistent-folder>/workspaces/<workspace-name>`를 한 번만 base 변수로 정의하며, repository 이름을 중간에 삽입하지 않습니다.

## 2. 영어 폴더명 규칙

- 모든 새 폴더명은 영어 소문자, 숫자와 하이픈(`-`)만 사용합니다.
- workspace 폴더명은 가능하면 로컬 workspace 루트 이름과 동일하게 사용합니다.
- 이름은 영문 소문자로 시작하며 권장 형식은 `^[a-z][a-z0-9-]*$`입니다.
- `shared`와 `workspaces`는 최상위 예약 이름으로 사용합니다.

예시:

```text
ai-research
model-evaluation
data-pipeline
```

## 3. 저장 위치 선택

다음 기준으로 저장 위치를 결정합니다.

- 여러 workspace에서 재사용할 리소스: `/home/work/<persistent-folder>/shared`
- 현재 workspace에만 속한 파일: `/home/work/<persistent-folder>/workspaces/<workspace-name>`
- 분류가 불확실한 파일: 임의로 옮기지 않고 사용자에게 용도를 확인합니다.

새 세션이나 자동화 작업은 저장 전에 대상 경로를 `readlink -f`로 확인합니다. resolved path가 `/home/work/<persistent-folder>/workspaces/<workspace-name>` 또는 `/home/work/<persistent-folder>/shared` 아래가 아니면 쓰기를 시작하지 않습니다.

중복 복사를 피합니다. 공용 리소스를 workspace 폴더마다 복제하지 않고 `shared`의 원본을 참조합니다. 반대로 특정 workspace 전용 파일은 `shared`에 두지 않습니다.

세션 로컬 디스크와 영속 데이터 폴더의 성능 차이 및 작업 위치 선택 기준은 [세션 로컬 디스크와 데이터 폴더 속도 참고](data_folder_speed_reference.md)를 따릅니다.

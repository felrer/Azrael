# Workspace 관리와 Pi session 경로 설계

- 설계 상태: `accepted`
- 구현 상태: `implemented` (Windows packaged native-picker acceptance pending)
- 작성일: 2026-09-02
- 기준 설계: [초기 전체 설계](initial-system-design.md)
- 대체하는 UI 계약: 사용자가 Workspace path와 Pi session directory를 직접 입력하는 흐름

## 1. 확정 방향

사용자는 운영체제의 폴더 선택 창으로 Workspace를 등록하고, 저장된 목록에서 하나를 선택해 앱의 현재 Workspace로 사용한다. 앱은 선택을 재시작 후에도 복구한다.

Pi session directory는 사용자 설정이 아니다. 신규 session 생성과 Workspace 스캔은 `@earendil-works/pi-coding-agent`의 `SessionManager`에 `sessionDir` 인수를 전달하지 않고, Pi가 `cwd`로 계산하는 기본 경로(`~/.pi/agent/sessions/<encoded-cwd>/`)를 사용한다. Workspace path 입력과 Pi session directory 입력 UI는 모두 제거한다.

## 2. 사용자 관점 완료 조건

- `폴더 추가`를 누르면 native directory picker가 열리고 파일은 선택할 수 없다.
- 선택한 폴더는 session이 없어도 Workspace 목록에 남는다.
- 목록에서 Workspace를 고르면 그 선택이 즉시 현재 Workspace가 되고, 다음 실행에도 복구된다.
- 현재 Workspace의 catalog를 먼저 표시하고 Pi 기본 session 경로를 비동기로 재스캔한다.
- 새 session은 별도 경로 입력 없이 현재 Workspace의 Pi 기본 경로에 생성된다.
- 다른 Workspace의 session은 현재 catalog 검색 결과에 섞이지 않는다.
- 존재하지 않거나 접근할 수 없는 Workspace는 등록을 잃지 않고 오류 상태로 표시된다.
- Workspace를 목록에서 제거해도 프로젝트 파일, Pi JSONL, session metadata는 삭제되지 않는다.

## 3. Workspace 모델과 소유권

Core의 SQLite `workspaces` row가 등록된 Workspace의 영속 identity와 설정을 소유한다.

| 값 | 의미 | 규칙 |
| --- | --- | --- |
| `id` | 앱 내부 identity | renderer 동작의 기준 key |
| `canonical_path` | 중복 판정·권한 범위용 real/canonical path | Windows 비교에서는 case-insensitive |
| `display_path` | 사용자에게 보여줄 선택 당시 경로 | identity 비교에 사용하지 않음 |
| `display_name` | 기본 표시명 | 폴더 basename |
| `trusted` | Workspace permission 기본값 | 신규 등록은 항상 `false`; 사용자 변경만 허용 |
| `registered` | Workspace 목록 포함 여부 | 제거는 `false`, 재등록은 `true` |
| `last_opened_at` | 최근 선택 시각 | 목록 정렬과 fallback 선택에 사용 |

단일 `workspace_state` row가 `active_workspace_id`를 보유한다. 활성 Workspace는 없거나 정확히 하나다. filesystem 접근 가능 여부는 매 조회 시 파생하며 DB에 진실값으로 저장하지 않는다.

기존 DB migration에서는 모든 기존 Workspace를 `registered = true`, `trusted = false`로 보존한다. 기존에는 trust가 영속 값이 아니었으므로 migration이 권한을 올리지 않는다. legacy `canonical_path`는 최초 표시 경로 fallback으로 사용한다.

`logical_sessions.workspace_id` 관계는 유지한다. 목록 제거 시 Workspace row를 삭제하지 않는 이유는 `ON DELETE CASCADE`로 session/draft/queue metadata가 손실되는 것을 막기 위해서다.

## 4. UI 계약

Session Catalog 상단은 다음 순서를 사용한다.

1. 저장된 Workspace 선택 목록
2. `폴더 추가`와 비파괴 `목록에서 제거` 동작
3. 선택된 Workspace의 read-only 전체 경로와 접근 상태
4. Workspace별 `trusted workspace` 설정
5. `새 session`과 `새로고침`
6. 기존 session 검색, archived filter, session 목록

수동 Workspace path 입력, `Pi session directory`, 별도 `scan` 버튼은 제거한다. `새로고침`이 현재 Workspace의 Pi 기본 경로 재스캔과 catalog reload를 함께 수행한다.

빈 상태를 구분한다.

- 등록된 Workspace 없음: 폴더를 추가하라는 안내만 표시한다.
- Workspace는 있으나 session 없음: 새 session 생성 안내를 표시한다.
- Workspace 접근 불가: 저장된 경로와 진단을 표시하고 생성·스캔·session 열기를 비활성화한다.

## 5. 주요 흐름

### 5.1 시작

Core에서 등록된 Workspace와 활성 identity를 읽는다. 활성값이 유효하면 복구하고, 없으면 최근 사용한 등록 Workspace를 선택한다. catalog의 저장된 projection을 먼저 `workspaceId`로 조회한 뒤 Pi 기본 경로 스캔을 시작한다. 스캔 실패 시 기존 catalog를 지우지 않고 경고를 표시한다.

### 5.2 추가와 중복 처리

Main만 Electron directory dialog를 열 수 있다. 취소는 상태를 바꾸지 않는다. 선택 결과는 Core가 존재하는 directory인지 확인하고 canonicalize한다.

같은 canonical path가 이미 있으면 새 row를 만들지 않고 기존 row를 다시 등록·선택하며 `display_path`와 최근 사용 시각을 갱신한다. 기존 trust와 session metadata는 유지한다. 성공한 신규 등록은 즉시 활성 Workspace가 된다.

### 5.3 전환

Workspace 전환은 다음 불변조건을 지킨다.

- 활성 session이 실행 중이면 전환을 `conflict`로 거부하고 먼저 실행을 중지하도록 안내한다.
- idle session이 다른 Workspace에 열려 있으면 draft를 보존하고 Pi Host runtime을 detach한 후 Workspace를 바꾼다.
- 전환 완료 후 활성 session/tree/chat 선택은 비어 있으며, 사용자가 새 session을 만들거나 catalog row를 연다.
- 선택된 Workspace와 활성 session의 `workspaceId`는 항상 같아야 한다.

### 5.4 trust 변경

신규 Workspace는 untrusted다. 사용자의 명시적 toggle만 Core의 값을 변경한다. 현재 Workspace에 활성 runtime이 있으면 Main이 Pi Host permission policy도 같은 값으로 갱신한다. 갱신 중 대기 중인 permission request는 fail-closed로 취소한다. Pi Host가 unavailable이면 영속값은 다음 session open/create부터 적용되고 UI에 현재 runtime 반영 실패를 알린다.

### 5.5 제거와 경로 유실

제거는 `registered = false`만 기록한다. 활성 Workspace를 제거하면 활성값과 renderer 작업 표면을 비우며, 실행 중 session이 있으면 제거를 거부한다. 재등록하면 같은 canonical identity와 metadata를 복구한다.

경로가 사라지거나 접근 거부되어도 자동 제거하거나 다른 Workspace로 자동 전환하지 않는다. cached catalog는 진단 목적으로 남지만 실행 작업은 비활성화한다.

## 6. Process와 권한 경계

- Renderer는 native dialog, filesystem, SQLite에 직접 접근하지 않는다.
- Preload는 `chooseWorkspaceDirectory`, Workspace CRUD/선택, Workspace ID 기반 create/refresh만 command별 wrapper로 노출한다.
- Main은 dialog parent window 확인, trusted renderer 확인, Workspace 전환과 Pi Host orchestration을 소유한다.
- Core는 canonical identity, 등록 목록, 활성 선택, trust, catalog filter를 소유한다.
- Pi Host는 Main이 Core에서 해석한 canonical path와 trust만 받으며 Workspace 설정을 영속화하지 않는다.
- Renderer에서 전달한 path나 trust를 session 생성 권한의 진실값으로 사용하지 않는다.

Renderer-facing create/refresh는 `workspaceId`를 입력으로 사용한다. Main은 Core에서 현재 record를 다시 읽어 filesystem availability와 활성 identity를 검증한 후 Pi Host에 전달한다. directory picker 결과만 path 기반 등록 입력으로 허용한다.

## 7. Pi session directory 불변조건

- 신규 session: `SessionManager.create(canonicalWorkspace)` 호출
- catalog discovery: `SessionManager.list(canonicalWorkspace)` 호출
- `sessionDirectory`는 renderer API, preload wrapper, shared command schema와 Pi Host create/list 경로에서 제거
- 앱은 Pi 기본 경로 계산식을 복제하거나 DB에 저장하지 않음
- 앱은 Pi JSONL을 이동·삭제·직접 수정하지 않음

기존 catalog에 이미 등록된 custom-directory replica는 migration하지 않는다. 해당 파일이 존재하면 기존 replica path로 열 수 있지만, Workspace 새로고침이나 projection 재구축의 discovery 대상은 Pi 기본 경로뿐이다. 사용자가 명시적으로 요청하지 않는 한 legacy JSONL에 대한 이동이나 정리는 수행하지 않는다.

## 8. 실패와 복구

| 실패 | 동작 |
| --- | --- |
| picker 취소 | 무변경 |
| 파일 또는 접근 불가 폴더 선택 | validation 오류, 등록하지 않음 |
| canonical duplicate | 기존 Workspace 재사용 |
| Workspace scan 실패 | cached catalog 유지, retry 가능한 진단 표시 |
| DB migration 실패 | 기존 migration recovery에 따라 backup 복원 또는 read-only mode |
| Pi Host detach 실패 | Workspace 전환을 commit하지 않음 |
| 선택 저장 후 renderer reload 실패 | DB의 활성 Workspace를 다음 load에서 복구 |
| trust runtime 반영 실패 | 영속 설정 유지, active runtime 진단 표시, 다음 open/create에서 적용 |

## 9. 선택한 tradeoff

- Pi 기본 경로를 사용해 Pi CLI와 상호운용성을 유지한다. 앱 전용 root와 Workspace 내부 `.pi` 저장은 제외한다.
- active Workspace를 renderer local state가 아닌 Core DB에 저장해 재시작 복구와 다중 process 일관성을 얻는다.
- path 대신 Workspace ID를 동작 계약으로 사용해 stale path와 renderer 변조 가능성을 줄인다.
- 제거를 tombstone 방식으로 처리해 session metadata의 파괴적 cascade를 피한다.
- 선택 시 자동으로 최근 session을 열지 않는다. 예상하지 않은 model 실행·permission scope 활성화를 방지하고 사용자가 session을 명시적으로 고르게 한다.

## 10. 계획 인계

이 설계에는 구현자가 새로 결정해야 할 제품 동작, 저장 소유권 또는 권한 경계가 남아 있지 않다. 세부 구현 순서는 저장소 외부 계획에서 관리한다.

상태: 목록 갱신·소스 비교 완료. 이번 20개 중 selected 8개, excluded 7개, deferred 4개이며 #56224는 구현 차이 비교 후 선택 미정이다. 검토 항목 선택과 실제 묶음 이식이 남았다.

# 선별 PR 반영 목록

## 현재 선택

| PR | 내용 | 원장 판단 | 적용 상태 | 이식 준비 시 확인 |
| --- | --- | --- | --- | --- |
| [#56233](https://github.com/openai/codex/pull/56233) | Opus encoder 테스트 sample time timestamp | selected | none — 미적용 | 기존 테스트의 연속 sample 시간 유지 |
| [#56234](https://github.com/openai/codex/pull/56234) | hook 수락 후 prompt telemetry 기록 | selected | none — 미적용 | 차단 입력 미기록, queued/steered 입력·Guardian 기록 중복 방지 |
| [#56236](https://github.com/openai/codex/pull/56236) | Code Mode 테스트 명시적 yield | selected | none — 미적용 | 실제 phase 분리와 wait 시간, 기존 출력 계약 보존 |
| [#56250](https://github.com/openai/codex/pull/56250) | 재개 시 중복 설정 checkpoint 방지 | selected | none — 미적용 | 같은 설정 미기록, 변경 설정은 턴 없이 저장, 권한·초기 checkpoint 보존 |
| [#56263](https://github.com/openai/codex/pull/56263) | marketplace URL userinfo backslash 거절 | selected | none — 미적용 | 허용 host 검사와 Git URL 해석 일치, 정상 URL 및 설치 부작용 보존 |
| [#56274](https://github.com/openai/codex/pull/56274) | 클라우드 설정 refresh 취소 완료 대기 | selected | none — 미적용 | loader 마지막 clone 수명과 새 loader task 유지, JoinHandle/AbortHandle 연결 |
| [#56278](https://github.com/openai/codex/pull/56278) | MCP 호출에 협상된 네트워크 정책 metadata 지원 | selected | none — 미적용 | 정책 provider 연결, 신뢰된 서버와 capability 협상, 기존 MCP·연결 복구·권한 경로 보존 |
| [#56280](https://github.com/openai/codex/pull/56280) | 연속 transcript prompt 배경 묶음 | selected | none — 미적용 | Rust TUI 대상. 숨김·검색·상세 보기·선택 offset·줄바꿈 보존; VS Code UI 변경은 별도 범위 |

## 세 번째 20개 검토

선택 확정과 코드 적용을 구분한다. 1·6·8·10·12·16번을 추가로 excluded 처리한다. 13·14·19·20번은 검토 결과를 제시하고 최종 반영 선택을 기다리는 deferred이며, 최신 요청에 따라 19번은 selected에서 deferred로 바꾼다. 7번 제외와 4·15·17·18번 선택은 유지한다.

| 번호 / PR | 현재 판단과 다음 확인 |
| --- | --- |
| 1 / #56222 | excluded. 사용자가 Bazel CI 관련을 이번 반영에서 보류하며 제외를 명시했다. |
| 2 / #56224 | 구현 비교는 아래 참조. 공통 목적은 이미 구현되어 있으나 재사용 범위·API·통합 테스트가 다르다. 현 구현 유지와 필요한 통합 검증 보완 권고; equivalent 원장 확정은 하지 않는다. |
| 3 / #56233 | selected. Opus encoder 테스트 synthetic audio 시간을 sample offset/rate로 계산해 scheduling 지연 불연속을 방지한다. |
| 4 / #56234 | selected. 사용자 입력을 hook이 거부했는데도 full prompt telemetry가 남는 문제를 수정한다. |
| 5 / #56236 | selected. yield/resume 테스트 phase 2 뒤 yield_control() 추가, 두 wait의 yield_time_ms를 1000에서 10000으로 변경한다. |
| 6 / #56246 | excluded. 1번과 함께 Bazelisk 갱신 제외. |
| 7 / #56247 | excluded. 사용자 명시 결정. |
| 8 / #56248 | excluded. 사용자가 uv CI·릴리스 갱신도 함께 제외했다. Bazel 전용 PR로 재분류하지 않는다. |
| 9 / #56250 | selected. 같은 thread의 최신 저장 설정과 현재 설정 비교로 checkpoint를 줄이며 Azrael 복원·권한·초기 checkpoint를 보존한다. |
| 10 / #56261 | excluded. 사용자 명시 결정. |
| 11 / #56263 | selected. URL parser와 Git/libcurl의 backslash 해석 차이에 의한 허용 host 검사 우회 방지. |
| 12 / #56265 | excluded. 사용자 명시 결정. |
| 13 / #56266 | deferred. 반영 권고. 현 catalog는 requirements 거부도 disabled_server_names에 합치고 materialization 시 차단 집합을 복사하지 않는다. 원인 분리·복사 보존을 이식하되 Azrael environment authority, SelectedPlugin name-veto 예외, EMA, standalone login 차단을 함께 보존해야 한다. |
| 14 / #56272 | deferred. Python SDK 유지 시 조건부 반영 권고. generator 0.31.2→0.64.0만이 아니라 title→x-title, inline union/literal RootModel 억제, optional project/section ID, Python 3.10 target, 기존 nullable 후처리를 함께 조정하고 현 schema로 재생성해야 한다. |
| 15 / #56274 | selected. abort는 비동기이므로 JoinHandle을 await한 뒤 cancellation을 확인한다. loader 소유 AbortHandle과 반환 JoinHandle도 함께 조정한다. |
| 16 / #56277 | excluded. 사용자 명시 결정. |
| 17 / #56278 | 기존 selected 유지. provider None인 호출자에는 정책 전달이 자동 활성화되지 않는다. |
| 18 / #56280 | selected. Rust TUI transcript 대상이며 Azrael VS Code 대화 화면이 바로 바뀌는 PR은 아니다. 호환 이식은 해당 TUI 범위에서 준비한다. |
| 19 / #56284 | deferred. 호환 이식 조건부 권고. upstream 지원 originator와 기존 fallback을 유지한다. Azrael ManagedModelsManager·DevinModelsManager는 현재 for_originator 메서드가 없고 thread 초기화에는 manager override도 있으므로 해당 선택·래퍼 위임·provider catalog 합성을 보존해야 한다. |
| 20 / #56286 | deferred. 조건부 반영 권고. registry에서 1.32.0, Node >=18, zod ^3.25 또는 ^4.0 확인. 현 TS SDK Node >=18·zod ^3.24.2 선언과 lock 3.25.76은 모순되지 않는다. root resolution·lock 동기화 후 TS build/test 및 conformance 검증 필요. GitHub SDK release/compare tag 조회는 404였으며 전체 release diff는 미확인이다. |

## #56224 구현 차이

| 항목 | upstream PR | 현 Azrael |
| --- | --- | --- |
| 보관 위치 | PreparedResumeConfig 안의 Option&lt;ResumedHistory&gt; | config와 분리된 PreparedResumeHistory |
| 재사용 대상 | Paginated만 | Legacy 및 Paginated |
| 사전 조건 | conversation ID·rollout 경로·revision | StoredThread ID·rollout 경로·history mode·revision |
| store API | is_model_context_current(thread_id, include_archived, revision) | validate_history_revision(path, revision) |
| 경로 확인 | store가 ID로 현재 경로를 재해석 | 호출자가 최신 StoredThread를 재조회하고 경로 일치 확인, store는 그 exact path 검사 |
| 검증 불가 | false/error면 fresh read | false/error·revision/경로 누락·mode 변경이면 fresh read |
| 테스트 | paginated lifecycle/config 동시 변경 및 모델 요청의 saved message 보존 통합 검사 추가 | 재사용/fallback/ID·경로·mode 단위 검사, local 파일 revision 변경 검사 존재; mcp_resource 통합 검사는 기존 Legacy cases 중심 |

- 근거: engine/codex-rs/app-server/src/request_processors/thread_processor.rs:115, :138, :4090, :4400, :5111; thread-store/src/store.rs:113, local/mod.rs:506; resume_history_reuse_tests.rs:56; app-server/tests/suite/v2/mcp_resource.rs:773 및 upstream #56224 patch.
- 권고: 기존 재사용 구현을 유지하고 필요한 paginated 재개 통합 검사만 검토한다. 이 PR을 통째로 덮어쓰면 Azrael의 Legacy 최적화·history mode 검사·별도 요청 상태 보관 구조를 불필요하게 바꾼다. 소스상 공통 기능이 있다는 것과 실행 검증 완료는 구분한다.

## 범위와 운영

- 사용자는 여러 PR을 함께 반영할 목록을 요청했다. 확정 선택은 3·4·5·9·11·15·17·18번, 제외는 1·6·7·8·10·12·16번, 검토 대기는 13·14·19·20번이다. 아직 코드 이식·빌드·설치·push를 실행하지 않는다.
- 추가로 반영할 PR을 선택하면 이 목록에 합친다. 전체 반영 범위와 순서·의존성·검증을 정한 뒤 이식한다. 확인되지 않은 의존 PR을 임의로 selected 처리하지 않는다.
- 이 목록은 이번 묶음의 selected/none 대상이다. 이전에 적용한 #56081·#56163과 과거 증빙 연결이 남은 #55991을 새 이식 대상으로 다시 추가하지 않는다.
- #56278은 optional provider와 metadata 전달 기반을 추가한다. 기존 upstream caller는 provider를 None으로 두므로 단독 이식만으로 일반 MCP 호출의 정책 전달·서버 측 강제가 활성화된다고 간주하지 않는다.
- [다음 20개 metadata](review-decisions-07.json)를 재사용한다. #56278 선택 이유는 [고정 판단 근거](review-selection-08.json), 추가 선택·제외는 [후속 판단 근거](review-selection-08-followup.json)가 소유한다. PR 본문·변경 파일 및 필요한 patch를 GitHub API로 읽고 현 engine 관련 함수와 비교했다.
- 최신 선택·제외·검토 대기 및 #56224 비교는 [두 번째 판단 근거](review-selection-08-decisions-2.json)가 소유한다. 과거 고정 evidence는 수정하지 않는다.
- 플랫폼: 선택 상태의 의미는 Windows x64/Linux x64/macOS ARM64 공통이다. 이번 기록 검증은 Windows x64의 Node·Git에 한정한다. 제품 동작·플랫폼 지원을 변경하지 않으므로 architecture/feature inventory 변경은 필요하지 않다.
- root가 이 목록·선택 근거·원장만 소유한다. 기존 newEntry/setDecision/writeLedger owner의 revision·lock·atomic publication을 재사용하고 다른 작업의 변경을 보존한다.

## 완료 기준과 검증

- 기존 49개 entry 중 최신 요청으로 바뀐 #56284만 deferred로 전환하고 나머지 48개·baseline·range를 보존한다. 새 selected 4개·excluded 6개·deferred 3개를 추가한다. CLI 원장 check 및 독립 데이터 검사 exit 0, 정확한 작업 파일만 커밋한다.
- testing 스킬에 따라 데이터 정합 검사만 수행한다. 제품 코드·실행기 무변경이므로 테스트 스위트나 제품 빌드는 실행하지 않는다.
- 원장 owner의 protocol lock/tmp 부재를 확인한다. 별도 disposable 생성물·백업·raw log는 만들지 않는다.

## 기록 결과

- Windows x64 owner 쓰기·CLI check·독립 데이터 검사 exit 0. 원장 entries 62, 기존 49개 중 #56284만 재분류하고 48개·baseline·range를 보존했다. 이번 20개 selected 8개/excluded 7개/deferred 4개와 #56224 미확정 상태를 확인했다. 기존 #55991 증빙 미완료는 그대로 유지한다.
- 원장 revision: 2ff1359bc3314ec081196f5d0e1297b2028b23162395b96b1414c605601925a8. owner protocol lock/tmp 0개, diff 공백 검사 exit 0. 제품 동작·Rust 테스트·SDK 생성·실행 호환성을 검증했다고 주장하지 않는다.
- 제품 코드 이식·실행·빌드·설치 및 다른 OS 실행은 수행하지 않았다. 정리 대기 생성물은 없다.

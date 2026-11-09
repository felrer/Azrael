상태: 세 번째 20개 PR 검토·선택 목록 갱신. 확정된 5개 PR은 selected/none이며 #56247은 excluded/none이다. 나머지 선택과 묶음 이식 범위 확정이 남았다.

# 선별 PR 반영 목록

## 현재 선택

| PR | 내용 | 원장 판단 | 적용 상태 | 이식 준비 시 확인 |
| --- | --- | --- | --- | --- |
| [#56234](https://github.com/openai/codex/pull/56234) | hook 수락 후 prompt telemetry 기록 | selected | none — 미적용 | 차단 입력 미기록, queued/steered 입력·Guardian 기록 중복 방지 |
| [#56274](https://github.com/openai/codex/pull/56274) | 클라우드 설정 refresh 취소 완료 대기 | selected | none — 미적용 | loader 마지막 clone 수명과 새 loader task 유지, JoinHandle/AbortHandle 연결 |
| [#56278](https://github.com/openai/codex/pull/56278) | MCP 호출에 협상된 네트워크 정책 metadata 지원 | selected | none — 미적용 | 정책 provider 연결, 신뢰된 서버와 capability 협상, 기존 MCP·연결 복구·권한 경로 보존 |
| [#56280](https://github.com/openai/codex/pull/56280) | 연속 transcript prompt 배경 묶음 | selected | none — 미적용 | Rust TUI 대상. 숨김·검색·상세 보기·선택 offset·줄바꿈 보존; VS Code UI 변경은 별도 범위 |
| [#56284](https://github.com/openai/codex/pull/56284) | thread originator별 모델 목록·캐시 분리 | selected | none — 미적용 | 기존 originator 결정·상속 보존, 지원 originator별 header·메모리·디스크 분리, 미지원 값 fallback |

## 세 번째 20개 검토

선택 확정과 코드 적용을 구분한다. 질문만 있는 항목은 원장 선택을 변경하지 않는다. #56247만 명시적으로 제외한다. #56246은 #56222의 최종 선택에 따른다.

| 번호 / PR | 현재 판단과 다음 확인 |
| --- | --- |
| 1 / #56222 | Bazel은 빌드·테스트 도구, CI는 변경 시 자동 검증. prepare action에 설치·저장소 캐시·Windows MSVC 준비를 통합한다. 로컬 Cargo 빌드와는 별도이며 upstream Bazel CI 유지 시 유용하다. 선택 미정. |
| 2 / #56224 | 현 Azrael에 PreparedResumeHistory와 validate_history_revision 기반 재사용이 이미 있다. ID·경로·모드·revision 검사와 실패 시 fresh load를 보존한다. 중복 이식보다 동등성 확인 권고. 기존 테스트 소스는 확인했으나 실행하지 않았으므로 equivalent 원장 확정은 보류. |
| 3 / #56233 | voice-host의 실제 Opus 음성 encoder가 20ms packet을 생성하는 테스트. synthetic audio 시간을 스레드 실행 시각 대신 sample offset/rate로 계산해 scheduling 지연에 따른 불연속을 방지한다. Claude Opus 모델과 무관하며 제품 encoder 변경이 아니다. 선택 미정. |
| 4 / #56234 | selected. 사용자 입력을 hook이 거부했는데도 full prompt telemetry가 남는 문제를 수정한다. |
| 5 / #56236 | yield/resume 테스트 phase 2 뒤 yield_control() 추가, 두 wait의 yield_time_ms를 1000에서 10000으로 변경한다. 실제 기능 추가가 아니라 테스트 출력 전달·타이밍 안정화. 선택 미정. |
| 6 / #56246 | Bazel 실행 launcher Bazelisk 1.30.0 갱신. #56222와 같은 최종 선택 예정이며 아직 미정. |
| 7 / #56247 | excluded. 사용자 명시 결정. |
| 8 / #56248 | CI·릴리스 도구 계열은 같지만 Bazel 전용은 아니다. uv Python 도구와 setup-uv action, DotSlash checksum, wheel test hash pin을 함께 변경한다. 선택 미정. |
| 9 / #56250 | 재개 시 같은 thread의 최신 settings snapshot과 현재 effective settings가 다를 때만 기록한다. 현 session/mod.rs는 항상 checkpoint를 기록하므로 유효한 후보. Azrael 설정 복원·권한·초기 checkpoint를 보존하며 수동 이식 및 검증 필요. 무충돌 확정은 불가. |
| 10 / #56261 | Bazel V8 source build에서 Abseil namespace·C++ runtime 충돌 방지. 소스 의존성·overlay 변경이 넓고 Cargo/prebuilt V8 경로의 직접 이익은 확정하지 않았다. Bazel source build 사용 여부에 따라 조건부 권고. |
| 11 / #56263 | 현 marketplace git_hostname은 Url::parse를 사용한다. URL parser와 Git/libcurl의 backslash 해석 차이에 의한 허용 host 검사 우회 방지이므로 반영 권고. 실제 악용 가능성은 재현하지 않았다. |
| 12 / #56265 | Vertex AI provider 추가는 선택적 신규 기능이다. gcp config/auth·protocol/account·model catalog 변경이 넓다. 사용 계획이 없다면 보류 권고, 임의 excluded 처리는 하지 않는다. |
| 13 / #56266 | 반영 가능 후보. 명시적 disable과 requirements 거부를 분리하며 신뢰된 hosted Apps 교체에만 이전 registration 거부의 예외를 허용한다. Azrael catalog/plugin policy와 standalone login 경로의 명시 차단을 보존해야 한다. |
| 14 / #56272 | 반영 가능 후보. 현 generator 0.31.2에서 0.64.0으로 갱신하므로 generated 파일만 복사하지 않고 현 Azrael schema로 재생성해야 한다. Python 3.10 target, nullable/RootModel/discriminator 호환성 확인 필요. |
| 15 / #56274 | selected. abort는 비동기이므로 JoinHandle을 await한 뒤 cancellation을 확인한다. loader 소유 AbortHandle과 반환 JoinHandle도 함께 조정한다. |
| 16 / #56277 | 일괄 반영 권고 아님. AWS SigV4의 nonempty body buffering/hash/forward를 추가하며 기본 8MiB·최대 16MiB, read timeout 30초, 동시 8개·대기 5초 등 자원·오류 동작이 변한다. AWS proxy signing 사용 여부에 따라 선택한다. |
| 17 / #56278 | 기존 selected 유지. provider None인 호출자에는 정책 전달이 자동 활성화되지 않는다. |
| 18 / #56280 | selected. Rust TUI transcript 대상이며 Azrael VS Code 대화 화면이 바로 바뀌는 PR은 아니다. 호환 이식은 해당 TUI 범위에서 준비한다. |
| 19 / #56284 | selected. upstream은 codex_work_cca/work_web/work_desktop/work_mobile 및 chatgpt_cca만 지원하고 다른 originator는 기본 manager를 사용한다. 현 Azrael의 service name·저장값·상속·환경값 우선순위를 보존하며 실제 effective originator를 확인한다. 서버에 보내는 originator를 임의 변경하지 않는다. |
| 20 / #56286 | 후보. 현 engine root resolution 1.26.0을 1.32.0으로 갱신하는 JS SDK 변경이다. Rust MCP runtime 전체 갱신과 다르다. TS SDK content type import와 conformance 의존성이 영향받으며 lock·Node·peer dependency·MCP 검증 전에는 무충돌 확정 불가. |

## 범위와 운영

- 사용자는 여러 PR을 함께 반영할 목록을 요청했고 이번에 4·15·17·18·19번 선택과 7번 제외를 확정했다. 현재 목록 검토를 이어가며 선택·제외를 기록한다. 아직 코드 이식·빌드·설치·push를 실행하지 않는다.
- 추가로 반영할 PR을 선택하면 이 목록에 합친다. 전체 반영 범위와 순서·의존성·검증을 정한 뒤 이식한다. 확인되지 않은 의존 PR을 임의로 selected 처리하지 않는다.
- 이 목록은 이번 묶음의 selected/none 대상이다. 이전에 적용한 #56081·#56163과 과거 증빙 연결이 남은 #55991을 새 이식 대상으로 다시 추가하지 않는다.
- #56278은 optional provider와 metadata 전달 기반을 추가한다. 기존 upstream caller는 provider를 None으로 두므로 단독 이식만으로 일반 MCP 호출의 정책 전달·서버 측 강제가 활성화된다고 간주하지 않는다.
- [다음 20개 metadata](review-decisions-07.json)를 재사용한다. #56278 선택 이유는 [고정 판단 근거](review-selection-08.json), 추가 선택·제외는 [후속 판단 근거](review-selection-08-followup.json)가 소유한다. PR 본문·변경 파일 및 필요한 patch를 GitHub API로 읽고 현 engine 관련 함수와 비교했다.
- 플랫폼: 선택 상태의 의미는 Windows x64/Linux x64/macOS ARM64 공통이다. 이번 기록 검증은 Windows x64의 Node·Git에 한정한다. 제품 동작·플랫폼 지원을 변경하지 않으므로 architecture/feature inventory 변경은 필요하지 않다.
- root가 이 목록·선택 근거·원장만 소유한다. 기존 newEntry/setDecision/writeLedger owner의 revision·lock·atomic publication을 재사용하고 다른 작업의 변경을 보존한다.

## 완료 기준과 검증

- 기존 44개 entry·baseline·range와 #56278 선택을 보존하고, 새 selected 4개와 excluded 1개만 추가한다. CLI 원장 check 및 독립 데이터 검사 exit 0, 정확한 작업 파일만 커밋한다.
- testing 스킬에 따라 데이터 정합 검사만 수행한다. 제품 코드·실행기 무변경이므로 테스트 스위트나 제품 빌드는 실행하지 않는다.
- 원장 owner의 protocol lock/tmp 부재를 확인한다. 별도 disposable 생성물·백업·raw log는 만들지 않는다.

## 기록 결과

- Windows x64 owner 쓰기·CLI check·독립 데이터 검사 모두 exit 0. entries 49, 기존 44개 entry·baseline·range 보존, 신규 selected 4개·excluded 1개와 모든 신규 implementation none을 확인했다. 기존 #55991 증빙 미완료는 그대로 유지한다.
- 원장 revision: 8df5aefa6e067003f94a3de4bab189530487ab291ecd6ef09a08d4fb463ff15d. owner protocol lock/tmp 0개, diff 공백 검사 exit 0. 제품 테스트를 통과했다고 주장하지 않는다.
- 제품 코드 이식·실행·빌드·설치 및 다른 OS 실행은 수행하지 않았다. 정리 대기 생성물은 없다.

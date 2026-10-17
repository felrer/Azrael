상태: 검사 실행 범위 축소 후보 조사 완료. 구현·검사 삭제·테스트·빌드·설치는 실행하지 않았다. 권장 우선순위 1~3을 제시하며 실제 변경은 후속 실행 지시 대상이다.

# 검사 실행 범위 축소 후보

## 목표·권한·판단 기준

이전 레거시 정리(`6eb1f2c4`) 이후 남은 검사 중 평상시 선택 범위나 반복 실행을 줄일 대상을 추린다. 이번 허용 범위는 코드·manifest·계약 조회, 부작용 없는 selector 실행 및 조사 기록 작성이다. 제품 코드, 검사 등록·선택 정책, 검사 본문과 설치 상태는 변경하지 않는다. 소요 시간 분석은 요청에서 제외된 상태를 유지한다.

현재 checkout의 engine 영역은 22기능·51검사(source 17/native 34), UI는 45기능·103검사다. 이는 논리 check ID 수이며 실제 프로세스·테스트 케이스 수와 다르다. 현재 HEAD는 `6eb1f2c4`이고 daemon 공존·model harness 등의 미커밋 변경은 다른 작업 소유다. 조사는 그 현재 working tree를 읽었으며 실행 중 설치본이나 변경 없는 최종 릴리스의 수용 근거로 일반화하지 않는다.

Windows x64에서 소스와 선택 결과를 확인했다. 배포 경로 분류는 Windows PowerShell 경로이고, UI 명령 통합·파일 책임 분리·Rust 검사 분류는 지원 대상 Windows/Linux x64 및 macOS ARM64에 공통 영향을 준다. 다른 OS의 실제 실행과 native 바이너리 검사 결과는 없다. engine 소스는 docs/ops/development.md의 Source and state가 지정하는 `engine/`이며 upstream/codex는 조사 대상이 아니다.

완료 기준은 후보별 현재 실행 근거, 줄일 대상, 보호 범위와 전제, 추천 우선순위를 제시하는 것이다. 이미 끝난 Python/common-agent 통합·레거시 fixture 폐기는 다시 개선 후보로 계산하지 않는다. 실제 변경이 없으므로 현행 architecture/inventory 계약은 수정하지 않는다.

## 추천 후보

| 우선순위 | 대상·현재 근거 | 축소 방향 | 보존 조건·영향 |
| --- | --- | --- | --- |
| 1 | `scripts/test-feature-preservation.cjs:7,48`에 최근 대화 UI 전용 CLI와 gate/receipt 회귀 suite가 같은 파일에 있다. ui.recent-chat-filter.behavior는 `--recent-chat-check`로 호출하지만 일반 changed-only selector는 파일만 선택한다. `inject-recent-chat-filter.cjs` 하나의 순수 선택 결과가 source 3파일이고 `test-feature-preservation.cjs`의 일반 suite 및 `test-recent-chat-filter.cjs`를 모두 포함한다. | 최근 대화 UI 전용 checker를 분리하여 해당 UI 변경에서 gate/receipt 회귀 suite 전체가 따라오지 않게 한다. 전용 checker 내부의 최근 대화 테스트 재실행도 별도 직접 실행과 겹치므로 assertion 소유자를 한 곳으로 연결한다. | 최근 대화의 실제 pinned header/AST 실행, idempotence, scope filtering을 유지한다. gate·receipt·source reuse 변경은 기존 도구 회귀를 계속 선택하고, 공통 입력 변경과 exhaustive 경로도 유지한다. 파일 책임 분리라 비교적 낮은 위험이다. |
| 2 | `scripts/deploy-azrael.ps1:190–203`의 integration 제외 경로가 `extension/`이며 실제 저장소는 `extensions/azrael-ex/`다. 함수 자체만 읽어 실행한 결과 `extensions/azrael-ex/src/usagePresentation.ts`는 compaction integration을 포함한 4기능을 선택하고, `scripts/inject-content-fonts.cjs`는 기본 3기능만 선택한다. | 실제 표시 전용 확장 파일·변경의 의존성을 확인하여 compaction integration의 관련 변경 판정을 좁힌다. | `extensions/` 전체를 무조건 제외하지 않는다. 요청·context·queue·recovery를 바꾸는 host 경로, 공통 helper, 미확인 변경·별도 engine source는 계속 포함한다. 이 후보의 직접 효과는 조건에 맞는 표시 변경에서 integration check 1개를 신선 실행 범위에서 제외하는 것이다. |
| 3 | source runner는 `feature-preservation.cjs:344`에서 executable+전체 args가 같을 때만 공유한다. UI 묶음 안에 project-drafts 3회, composer-draft 2회, team-runtime/team-integration 각각 2회, recovery-bridge/recovery-presentation 각각 2회가 서로 다른 argv로 남는다. 해당 선언에는 cacheInputs가 없다. | 겹치는 파일을 동일 단일 파일 명령의 공유 check로 추출해 feature별 결과를 유지한다. | UI 내부 6파일에서 최대 7회의 파일 실행 중복을 줄일 정적 후보다. 모든 관련 feature가 함께 선택될 때의 값이며 실제 배포 절감 보장이 아니다. engine.shared-engine.host와 UI recovery 사이 recovery-state까지 포함하면 7파일·8회지만 기본 focused 엔진 범위에는 shared-engine이 없으므로 이 추가 1회를 기본 배포 효과로 계산하지 않는다. 명령·filter·env·runtime·입력 동일성과 로그 연결을 유지한다. |
| 4 | `deploy-azrael.ps1:192`는 provider-context/recovery/accepted-input을 항상 선택한다. 문서와 content-fonts 변경도 3기능·7논리 검사(source 2/native 5)를 선택한다. 실제 native 5개에는 lib compaction·task recovery·provider context fixture·recovery fixture·accepted input fixture가 포함된다. | 같은 엔진의 검증 근거가 있는 변경 없는 영역은 재사용하고, 기능 의존성에 따라 새로 실행할 영역을 선택하도록 기본 3기능의 고정을 정밀화한다. | 가장 큰 축소 여지가 있지만 정책·coverage 설계가 먼저다. 선정되지 않은 기능이 검증된 것으로 자동 처리하면 안 된다. 정확한 source/binary/환경·기준 receipt·동적 의존성과 변경 전체를 연결하고, 누락·변경 불명·전체 회귀 요구 시 기존 범위로 복귀해야 한다. exact-package host 6단계와 최종 identity 검사는 유지한다. |
| 5 | `scripts/check-api-context.cjs:9`와 `scripts/check-model-harness-profiles.cjs:18`이 동일한 `codex-core --lib instruction_state_projection` 명령을 같은 locked/offline/serial 옵션과 기본 host 환경 정책으로 실행한다. 바깥 Node wrapper argv가 달라 whole-command dedup 대상이 아니다. Cargo evidence key는 group의 feature/check 선언과 wrapper 파일을 포함하므로 두 wrapper의 부분 호출을 공유한다고 볼 근거가 없다. | 공통 projection 경계를 별도 동일 명령 check로 추출하고 두 feature가 같은 결과를 참조하게 한다. | 양쪽 기능이 모두 선택되고 실제 실행할 때 중복 Cargo 검사 1회를 줄일 후보이다. 나머지 multi_agent_mode, model context, provider handoff, tools 및 integration은 각각 유지한다. 기존 Cargo 캐시가 적중하는 실행에서는 추가 효과가 작을 수 있다. |

1~3은 실행 책임/분류/중복의 문제를 먼저 해결하는 권장 범위다. 4는 영향별 acceptance와 기준 증거의 계약을 먼저 정한 뒤 추진하고, 5는 전체 엔진 회귀에서 양쪽 기능이 함께 선택되는지 확인한 다음 공통 check를 연결하는 순서가 적절하다.

## 추가 분리 후보와 제외 대상

`check-model-harness-profiles.cjs:31`은 `suite::model_switching` 모듈 전체를 실행한다. 현재 그 파일은 test attribute가 있는 함수 16개 중 7개가 service-tier 요청·기본값·경고 동작이다. profile/prompt/history 검증과 service-tier 검증을 별도 하위 검사로 분류할 후보지만, 서비스 등급이 공통 모델 설정과 상호작용하므로 7개를 곧바로 불필요하다고 볼 수 없다. 관련 설정 변경 시 양쪽을 선택하고, 서비스 등급 검사의 지속 소유자와 전체 회귀 경로를 확보한 뒤 부분 실행을 검토한다. 다른 작업에서 해당 wrapper/context 검사를 수정 중인 점도 선행 조건이다.

`test-asset-transform-cache.cjs:282`는 관련 injector 변경 시 전체 pinned 대상의 uncached/cold/warm 매트릭스를 순회한다. 변경 injector의 실제 target 자산으로 일상 매트릭스를 좁히고 공통 transformer/cache/pin 변경과 exhaustive에 전체 매트릭스를 남기는 추가 후보이다. 같은 asset을 여러 injector가 조합하는 관계를 먼저 계산해야 하므로 이번 우선순위 1~5보다 뒤에 둔다. 이미 source-test-policy가 무관한 변경에서 이 case를 생략하므로 항상 실행되는 낭비로 표현하지 않는다.

이번 근거로 폐기를 권할 수 있는 native 기능 검사는 찾지 못했다. ACP 기존 대화, root resume protocol, compaction lib/integration, 실제 transport·installed host·provenance·package 검사는 각 경계를 보호하므로 이름 유사성만으로 축소하지 않는다.

## 확인 방법과 한계

- feature manifest를 순수 JSON으로 집계해 source command의 파일 중복을 확인했다. check ID를 삭제하거나 프로세스를 실행하지 않았다.
- `Get-FocusedEngineFeatureIds` 함수만 메모리에서 정의하여 docs/content-fonts/usagePresentation/compact_input 네 입력을 평가했다. 전체 deploy 스크립트는 실행하지 않았다.
- `test-project.cjs`의 `select(parseArgs(...))`를 recent-chat injector와 source-preflight-reuse 두 입력에만 호출했다. 전자는 3 source 파일에 gate suite와 최근 대화 테스트가 함께 포함되고, 후자는 gate suite/project fail-fast/project maintenance의 3파일을 선택했다. 목록 계산이며 테스트 실행이 아니다.
- 각 후보의 실제 도입 전에는 선택 감소와 유지 범위를 별도로 검증한다. 무관 변경·공통 변경·삭제/신규/미확인 입력·실패/변조 receipt·전체 회귀를 포함한 선택기 검사와, 공유 명령의 feature별 결과 연결이 필요하다. 실제 속도·컴파일 감소는 측정하지 않았으며 추정 시간도 제시하지 않는다.

산출물은 이 조사 기록뿐이다. 임시 문서 본문은 번호 할당 후 일반 삭제한다. 작업별 커밋에는 조사 기록만 포함하고 다른 미커밋 소스는 유지한다.

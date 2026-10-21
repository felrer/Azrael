상태: 설치본 API·엔진 검증 완료, 실제 VS Code UI와 실모델 역할 준수는 미검증. UI 확인을 이어가려면 사용자가 이 대화의 Window Use를 활성화해야 한다.

# u21a Team 검증

## 요청과 검증 범위

격리 프로필 `C:/Users/felre/av18/artifacts/f`에 설치된 u21a의 Lead 지침, 하위 세션 생성, 전용 변경 원장, 충돌 관리 책임, UI 그룹, 하위 root의 subagent 실행 여부를 확인한다. 제품 수정·재설치·배포는 포함하지 않는다. Windows x64 local만 검증했다.

기존 프로필의 설치된 `out/extension.js`와 `webview/assets/header-57b689833777.js`에서 실제 helper·host 메서드를 추출하여 fixture 객체와 실행했다. 기존 VS Code 프로필 창을 조작하거나 실제 persisted atom 저장소에 Team을 만든 검증은 아니다. 엔진은 설치 manifest가 가리키는 u21a 바이너리를 새 CODEX_HOME으로 실행했다. 모델 응답은 로컬 합성 Responses 서버로 제어했다. 실제 계정 추론과 모델의 Lead/root 역할 준수는 검증하지 않았다. 기존 f/s 인증·설정·대화에 쓰지 않았다.

실행과 통합·정리는 root가 담당했다. 제품 행동 변경이 없어 architecture 수정은 필요 없다. 작업 worktree는 만들지 않았다.

## 설치 identity

- 설치 extension: `C:/Users/felre/av18/artifacts/f/extensions/azrael-ex-local.azrael-2026.0.10`.
- `out/azrael-runtime.json`의 엔진은 현재 checkout `artifacts/build/u21a/artifacts/releases/u21a/engine/azrael.exe`다.
- 실제 바이너리 SHA-256 `c10960a5383a6df3cebc61ca41914cb61f550f376f8c7e0c3b6d814cceab62a3`가 manifest와 일치했다.
- build-info.json이 기록한 source는 `artifacts/n10a/engine`. 현재 작업 트리의 최신 engine 코드로 대체하지 않았다.
- 설치 host SHA-256과 UI SHA-256은 아래 reports가 소유한다.

## 판정

| 요청 | 확인 결과 | 한계 |
| --- | --- | --- |
| Lead 프로필 | 실제 설치 host의 생성·재개 메서드가 Design Collaboration/Team Lead 지침과 Team 동적 도구를 추가하고 registry를 기록한다. 일반 child resume에는 Lead 지정 문구를 새로 추가하지 않는다. | 별도 harness/model 프로필 선택이 아니라 developerInstructions 주입이다. 실제 최초 전송 UI 및 영속 저장소 복원은 미검증. |
| 변경 집계 | 실제 Git scratch 저장소에서 root 배정·요구 적용·결과 커밋 submit 후 같은 Team state와 전용 verified ref로 집계·승인됐다. 파일 수정·커밋만으로는 state.changes에 들어오지 않았다. | submit 호출이 필요하다. 모델이 정상 작업 중 매번 이 절차를 지키는지는 미검증. |
| 충돌 담당 | root가 begin_integration으로 통합 예약을 보유한 동안 추가 예약은 INTEGRATION_BUSY. root의 승인 시도는 COORDINATOR_REQUIRED이며 Lead가 최종 승인했다. | 실제 Git merge 충돌을 재현하지 않았다. 현재 서비스는 후보 생성·병합·충돌 해결·checkout 쓰기 차단·담당 세션 자동 배정을 수행하지 않는다. 설계상 배정된 통합 세션이 처리한다. |
| UI 소속 | u21a native가 생성한 Lead/root/subagent 실제 ID와 parentThreadId로 설치 UI grouping 함수를 실행해 세 세션이 하나의 Team에 묶이는 결과를 확인했다. Lead badge·접기 상태 코드도 존재한다. | 실제 화면·클릭·확장 검증은 Window Use enabled:false로 미실행. |
| 하위 root의 subagent | 기본 설정에서 Lead→execution_root→verification_worker 생성, 각 세션 모델 요청, depth 1/2 부모 관계를 확인했다. root는 상속된 team.manage_changes status를 실제 native 도구 요청으로 호출해 성공했다. | 응답 서버는 합성 모델이다. native 루트 자체가 별도 coordinator로 지정되는 기능은 현재 없다. |
| 역할 격리 | Lead 전용 지침 내용이 fork_turns:none인 root·subagent 요청에도 상속되는 것을 확인했다. | 명시적인 Lead registry 지정은 유지되지만 지침 수준 역할 격리는 완전하지 않다. 실제 모델이 혼동하는지는 별도 확인이 필요하다. |

처음 읽은 v1 DEFAULT_AGENT_MAX_DEPTH=1은 v2 실행 제한의 증거가 아니었다. 실제 v2 바이너리에서 중첩 생성이 성공하여 깊이 제한 우려를 철회했다.

## 실행과 근거

산출물 owner는 CK-01, run은 installed다. 위치는 `artifacts/tasks/CK-01/runs/installed/`.

- `inputs/installed-team.cjs`: 설치된 host helper·메서드와 실제 Git 실행. 최종 exit 0, `logs/host-attempt10.log`, `reports/host-summary.json`.
- `inputs/native-team.cjs`: 실제 u21a app-server와 설치된 Team tool adapter, 합성 모델로 Lead/root/subagent 도구 상속 및 실행. script exit 0, engine 종료 code 0. `logs/native-team.log`, `logs/native-team-default-rpc.jsonl`, `logs/requests-team-default.jsonl`, `reports/native-team-summary.json`.
- Lead `01a14eba-3822-7960-bc33-2b3107a8ba51`; root `01a14eba-565b-75e0-b94d-9ace1e793f93`; subagent `01a14eba-70de-7de3-aaca-f0e5518d4698`.
- `reports/ui-helper-summary.json`, `reports/ui-native-data-summary.json`: 설치 UI grouping 함수 결과. 두 실행 exit 0. 실제 화면 증거로 사용하지 않는다.
- 초기 host harness는 메서드 추출 경계, VM globals/realm, native draft cwd, validation scope 계약을 바로잡으며 재실행했다. 초기 native harness는 agent_message의 encrypted_content를 user role 텍스트로 찾지 못해 분류가 실패했다. 해당 실패는 제품 실패로 판정하지 않았다. 수정한 최종 native-team run이 최종 근거다.
- 실행 시각과 종료 시각은 각 report의 startedAt/finishedAt에 UTC로 보존한다. 초기 시도 포함 총 경과와 개별 실행 시간을 합산하지 않는다. 실제 UI를 기다리는 것 외에 실행 의존 대기는 없었다.

## 정리와 잔여 항목

모든 소유 app-server의 실제 종료를 관측했고 최종 u21a 엔진과 CK-01 Node producer가 남지 않았음을 확인했다. 임시 Git 저장소와 새 engine state 약 29 MB는 `ck01-installed-temporary`로 등록·review 후 삭제했다. cleanup 결과 status=deleted, remaining=false이며 파일시스템 Test-Path도 false였다. 도구가 생성 Git 객체의 ReadOnly/Hidden 속성을 기록하고 정규화했으며 force 삭제는 사용하지 않았다.

inputs/logs/reports는 `ck01-installed-evidence` 그룹으로 보존한다. 재검토 조건은 실제 UI·실모델 검증이 완료되어 이 기록의 진단·재현 필요가 없어지는 시점이다. 기존 f 프로필 전체, 설치 u21a, 복구 버전은 정리 대상이 아니다. 제품 수정이 없는 검증 작업이며 기존 다른 작업의 변경은 유지했다.

실제 VS Code UI 검증이 남아 있으므로 전체 정상 판정은 보류한다. Window Use skill과 host context의 disabled-stage 우회 금지 규칙에 따라 다른 입력 도구로 우회하지 않았다.

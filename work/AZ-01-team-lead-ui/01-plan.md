상태: 소스 구현과 허용된 검증·fixture 정리 완료. 실제 앱 빌드·설치 및 전체 비동기 스케줄러 구현은 범위 밖이다.

# Team 최근 채팅과 Lead 생성

## 목표와 권한
기존 설계 논의를 이어 Team UI와 Lead 생성 기능을 구현한다. 최근 채팅 목록에 Team 소속 세션을 접고 펼칠 수 있게 묶고 Lead를 표시한다. 새 채팅 우클릭·길게 누르기로 Lead 생성에 진입한다. Design Collaboration을 바탕으로 Lead 역할 지침을 제공한다. 소스 수정·필요한 테스트·로컬 렌더 검증은 허용 범위다. 패키지 설치·실사용 세션 변경·배포는 포함하지 않는다.

## 확정 범위와 보존
Team/Lead 이름과 대화·실행 역할 분리, 요구 누적과 비동기 이관을 이어받는다. 일반 새 채팅 클릭, 작업공간/프로바이더/보관/페이지 필터, 깃발, 기존 세션과 초안은 보존한다. 전체 worktree 운영·통합 잠금·자동 스케줄러 구현까지 이 요청에 포함하지 않는다. 미구현 실행을 UI로 구현 완료처럼 표시하지 않는다.

## 환경과 검증
UI·Team 소속 의미·Lead 지침은 지원 플랫폼 공통이다. 저장소 경로와 host 저장은 환경 경계에서 처리한다. Lead 생성 transport의 이번 구현 대상은 확인된 native local host이며 다른 host는 명시적인 오류로 처리한다. Team identity는 host별로 분리한다. 이번 실제 검증 환경은 Windows x64이며 Linux/macOS 실행 수용은 별도다. 소속 저장·복구/생성 오류/첫 턴 지침, UI 그룹·Lead 표시·메뉴 클릭 억제·기존 동작 회귀와 light/dark 실제 렌더를 검증한다.

## 조사와 실행
최근 목록·새 채팅 UI, host 세션 생성과 지침 admission을 독립 조사한다. root가 데이터·메뉴·지침 계약을 정한 뒤 소유 범위를 나눠 구현하고 통합한다. 기존 UI와 저장·요청 계층을 재사용한다. [설계](../../docs/architecture/work-orchestration.md)와 [UI 계약](../../docs/architecture/ui-presentation.md)을 갱신하고 기능 보존 항목을 등록한다.

## 현재 구현 계약
- 첫 유효 전송 전에는 thread를 생성하지 않는다. 새 Lead 선택은 현재 webview 새 채팅 초안에만 생성 의도를 저장하고 기존 세션 전송·다른 view/프로젝트에 적용하지 않는다. 일반 새 채팅 클릭은 해당 의도를 해제한다.
- 역할 startup은 기존 developerInstructions를 보존하면서 유지되는 Design Collaboration와 Lead 참조를 제공한다. host가 저장된 역할을 기준으로 cold resume에서도 제공한다. client 제공 지침이며 권한 제한이나 native 불변 역할을 주장하지 않는다.
- 기존 native 부모·자식 정보로 Lead와 하위 세션을 한 Team으로 묶는다. 임의의 기존 대화 채택·reparent는 이번 범위에 없다. 일반 최근 목록의 source/workspace/provider/archive 필터를 유지하고 Team 하위 세션의 명시적 관계 조회는 별도로 구분한다.
- native persisted preference `azrael-team-registry-v1`은 `{version:1,teams:[{id,hostId,leadId,memberIds}]}`다. 제목으로 역할을 추론하지 않는다. 펼침 상태는 host/Team별로 저장한다. 표시 순서는 기존 필터 결과에서 첫 member의 위치, 그룹명은 Lead 제목 또는 Team이다.
- 일반 새 채팅 클릭은 보존한다. 우클릭·키보드 context-menu·550ms stationary long press로 메뉴를 연다. timer 취소와 뒤따르는 일반 클릭 억제를 검증한다. Lead 선택 실패는 보이며 일반 채팅으로 조용히 대체하지 않는다.
- 전체 프로젝트 테스트나 실제 앱 설치는 포함하지 않는다. role 지침의 byte/연결 검증과 실제 모델 행동·비동기 이관 검증은 구분한다.

## 소유권과 현재 의존성
UI 담당은 `inject-team-ui.cjs`, UI 동작 검사·render fixture를 소유한다. runtime 담당은 `inject-team-runtime.cjs`와 runtime 검사를 소유한다. 지침 담당은 maintained/installed Design Collaboration 참조와 패키지 mapping/receipt를 갱신했다. root는 pipeline·cache fingerprints·feature inventory·설계·통합·최종 검증을 소유한다. 기존 engine/provider 등 타 작업 변경은 보존한다.

native 새 패널 생성의 command args→custom editor URI→해당 view 연결을 구현했다. 최초 same-view fixture 뒤 새 패널 경로의 누락을 확인해 동일 담당자에게 차이를 인계했다. 전용 opaque token은 새 view 하나에만 전달하고 shared composer prefill이나 전체 view broadcast에 역할 의도를 저장하지 않는다. native 선택 프로젝트와 최초 생성의 projectAssignment/cwd를 확인한다. 생성 실패 후 재전송은 Lead 재선택 오류를 유지해 일반 역할로 바뀌지 않는다. 최종 인계 산출물은 보완한 runtime transform, native 경계 동작 증거와 실제 owning 최근 메뉴 경로의 light/dark 검증 결과다.

## 확인한 근거와 검증 제한
최근 메뉴의 `vn`과 header의 `Fn`/native 새 채팅 `lir`를 재사용한다. 기존 submit-only-thread fixture는 최초 전송 시 생성과 설정 보존을 검증한다. native thread/start의 developerInstructions는 최초 요청에 반영되지만 그 필드만으로 cold resume 영속성을 주장할 수 없다. native thread/list의 ancestorThreadId는 하위 세션을 조회할 수 있고 sourceKinds를 생략해야 기본 interactive-only 제한을 피한다. UI preference atom은 host와 conversation identity를 키로 유지한다.

Lead 지침 배포·원본/설치 equality 검사 통과. 원래 cp949 decoding으로 실패한 skill validator는 UTF-8 모드로 성공했다. 실제 모델 행동과 이관은 검사하지 않았다.

## 최종 검증과 정리

- `node --test scripts/test-team-runtime.cjs scripts/test-team-integration.cjs scripts/test-computer-use-injection.cjs`: 최종 고정 입력에서 9개 통과, exit 0. native 기본 새 패널 명령·URI·resolver·해당 view bootstrap·첫 생성 응답, 잘못된 scope/재전송 차단, 역할 저장·cold resume, multi-root·ancestor pagination, Team 조회 실패 시 일반 목록 보존, 기존 컴퓨터 승인 경로와 namespace 조합을 확인했다. [로그](../../artifacts/logs/team-lead-ui/final-host-integration.log), [입력 해시](../../artifacts/logs/team-lead-ui/final-inputs.json).
- `node --test scripts/test-team-ui.cjs scripts/test-team-runtime.cjs scripts/test-team-integration.cjs scripts/test-session-flags.cjs`: 8개 통과, exit 0. 이후 runtime 요청 삽입 위치 변경에 영향받은 검사는 위 고정 입력 검사로 다시 확인했다. [로그](../../artifacts/logs/team-lead-ui/integration-tests-final.log).
- 최종 diff에서 runtime을 마지막으로 이동한 뒤 보고서 해시가 이전 단계의 bytes를 가리키던 것을 확인해 최종 출력 해시로 수정했다. `node --test scripts/test-team-integration.cjs`를 재실행해 2개 통과, exit 0. 각 asset 보고서 해시가 반환된 최종 bytes와 일치하는 검사도 추가했다. 코드 동작에 영향이 없는 보고서 수정이며 위 native·화면 검증은 재사용한다. [최종 pipeline 로그](../../artifacts/logs/team-lead-ui/final-pipeline-hashes.log).
- 마지막 기본 프로젝트 경로는 pinned c014의 실제 `fQn`→`$mn` 반환 함수로 확인했다. local projectId가 없으면 일반 workspace·projectless 둘 다 projectAssignment를 생략하며 현재 Lead normalize는 이를 null과 동일하게 처리한다. 작은 native 함수 fixture를 추가하고 `node --test --test-name-pattern='Default local native selection' scripts/test-team-integration.cjs`에서 1개 통과, exit 0. 함수 내부는 그대로 사용하고 workspace 분류·host API만 adapter로 제공했다. URI query는 native route classifier에서 pathname/search로 분리되며 새 패널 경로를 보존하는 정적 근거도 확인했다. [기본 프로젝트 로그](../../artifacts/logs/team-lead-ui/default-project-integration.log).
- 첫 통합 검사의 namespace·submit-only·project-drafts 검사는 통과했다. 같은 run은 Computer Use와 Team의 full 요청 anchor 충돌 및 Team 추가 전의 전체 Flag helper 문자열 가정 때문에 exit 1이었다. runtime을 최종 단계로 이동하고 승인 코드를 보존하는 삽입 지점으로 수정했다. Flag 검사는 최종 구성의 원래 제어·predicate를 보존하도록 갱신했다. 최종 검사 통과를 위에서 구분한다. [최초 로그](../../artifacts/logs/team-lead-ui/integration-tests.log).
- `node scripts/verify-team-ui-render.mjs`: Windows Chrome에서 36개 light/dark 상호작용 통과, exit 0. production helper와 실제 transformed native `vn`/`fn`/`pn`, row와 New chat 컴포넌트를 사용했다. All/Local/Cloud, 제목·깃발 filter, 선언 Team 자식 포함, 독립 세션 보존, 접기 상태 저장, 직접 열기, 우클릭·long press·키보드 메뉴와 오류를 확인했다. host/query/transport/localization은 fixture adapter다. [결과](../../artifacts/logs/team-ui/summary.json), [light](../../artifacts/logs/team-ui/light-native-recent-team.png), [dark](../../artifacts/logs/team-ui/dark-native-recent-team.png).
- `python -B scripts/import-instructions.py --check`, Team Lead instruction-package 검사, UTF-8 skill validator 각각 exit 0. maintained/installed 두 파일 byte equality 통과. [import](../../artifacts/logs/team-lead-ui/lead-instructions-check.log), [package](../../artifacts/logs/team-lead-ui/lead-instructions-test.log), [validator](../../artifacts/logs/team-lead-ui/lead-skill-validation-utf8.log).
- 기능 보존 manifest의 참조·injector 등록과 `git diff --check` 통과. 렌더 브라우저 exit 0와 정리 exit 0, `artifacts/verification/team-ui`의 실제 부재를 확인했다. [정리](../../artifacts/logs/team-ui/cleanup.txt). 이번 작업은 task worktree를 생성하지 않았다.

긴 통합 검사 시각은 새 로그 redirection의 생성/마지막 출력 시각(UTC)을 기준으로 기록한다. 최초 검사는 2026-10-14 01:20:58부터 01:21:29까지, 최종 고정 입력 검사는 01:26:30부터 01:28:03까지다. native panel 인계와 UI owning-route 결과를 기다릴 때 root를 완료 이벤트로 대기시켰다. 입력 변경·실패를 반영한 재검사만 수행했으며 속도·토큰 절감의 실측 결과를 주장하지 않는다.

## 남은 범위

실제 설치된 Azrael, native preference의 앱 재시작, 실제 모델의 역할 준수·이관, Linux/macOS·다른 host 생성은 검증하지 않았다. 현재 local 생성 밖의 host는 명시적으로 실패한다. native 자식 설정의 부모 developerInstructions 상속은 보존되며 registry와 지침의 명시 지정 조건만으로 엔진의 불변 역할 격리를 구현했다고 보지 않는다. 큰 Team 목록의 지연·자원 비용은 별도 실측이 필요하다. 전체 Team worktree 수명주기·단일 통합 잠금·root scheduler는 이전 목표 설계로 유지한다.

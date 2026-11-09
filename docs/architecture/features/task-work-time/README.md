# 연속 작업 시간
<!-- architecture: {"id":"arch.task-work-time.contract","feature":"task-work-time","layers":["ui","host","engine"]} -->

Status: `partial` — 턴 관계·재개 횟수·시간 기록의 Windows native 계약과 사용자 메시지 아래 시간·턴 한 줄의 소스 및 Windows 격리 React/CSS 렌더링은 검증됐다. 실제 VS Code 호스트·현재 패키지 설치와 Linux/macOS 수용은 별도 검증한다. 근거는 [작업 기록](../../../../work/AL-01-resume-task-group-reliability/01-plan.md)에 둔다.

## 작업과 사용자 흐름

한 대화에서 자동 재개로 이어진 작업을 묶어 총 시간과 턴 수를 표시한다. 같은 연속 작업에서 모델이 `azrael_agents.defer_root`로 대기를 성공적으로 등록한 횟수가 3회 이상이면 묶음을 표시한다. 세 번째 등록 시점부터 첫 턴의 작업 시간과 대화 범위를 포함한다. 0·1·2회에는 이 기능의 요약·선·조회 오류 배너를 표시하지 않는다.

성공 등록은 고유 reservation ID와 대기 시작 시각이 있는 durable `rootResumeWait`로 확인하며 중복은 한 번만 센다. 이후 취소·교체·차단되어도 이미 성공한 등록 횟수는 유지한다. 준비 중이거나 실패한 호출, 하위 에이전트의 별도 대화와 다른 세션 링크 읽기는 횟수에 포함하지 않는다. 현재 활성 예약 목록 대신 전체 턴 기록을 사용하므로 종료된 예약도 새로고침 후 동일하게 판정한다.

자동 재개는 `turnTrigger=root_resume`, 부모 턴과 root 계보를 함께 확인한다. 새 사용자 입력으로 시작한 턴은 같은 root ID를 이어받았더라도 별도 자동 작업의 시작이다. 기존 기록에 관계 정보가 없으면 자동 연결을 추정하지 않는다.

표시·집계·승인 카드의 상세는 [UI와 Host](ui.md), 기록·projection의 상세는 [엔진](engine.md)이 소유한다.

## 시간 의미

전체 작업 시간은 실행 구간과 기록된 자동 재개 대기 구간의 합집합이다. 사용자의 다음 메시지를 기다리는 턴 사이 공백은 제외한다. 모델 실행, 도구 실행, 빌드와 검사에 소요된 시간은 실행 구간에 포함한다. 병렬 구간과 중복 기록은 한 번만 계산한다. 하위 에이전트의 실행 시간을 root 시간에 따로 더하지 않는다.

진행 중인 실행과 자동 재개 대기는 현재 시각까지 갱신한다. 종료된 실행은 엔진의 `durationMs`를 사용하며, 종료된 대기는 기록된 시작·종료 경계를 사용한다. deferred 턴의 실행 시간은 defer 경계에서 고정되며 대기 시간만 증가한다. 완료·중단·실패 뒤 시간은 증가하지 않는다.

사용자 응답 대기의 기본 경계는 앞 턴의 실행·자동 대기 종료부터 다음 사용자 턴 시작까지이다.

### 사용자 응답 대기 제외

Status: `target` — [작업 기록](../../../../work/EK-01-user-wait-time/01-plan.md)이 구현·검증 범위를 소유한다.

사용자 승인이나 동기 입력 때문에 실행이 멈춘 구간은 표시용 작업 시간에서 제외한다. 요청이 여러 개 겹치면 중복 차감하지 않는다. 비동기 질문이 열려 있는 동안의 실행, 다른 모델·도구·빌드·검사의 병렬 실행과 자동 재개 예약 대기는 기존 시간 의미를 유지한다. 원래 경과 시간과 사용자 대기는 구분해 보존한다. 요청별 대기 시작·종료는 엔진이 소유하며 새로고침으로 초기화하지 않는다. 응답·거절·취소·중단으로 닫힌 구간은 고정한다. 경계가 없는 과거 기록의 대기 시간을 추정하거나 0으로 확정하지 않는다. 단일 턴과 연속 작업 총계는 같은 제외 의미를 사용한다.

요청별 snapshot과 경과 시간의 보존 형식은 [엔진의 사용자 대기 기록](engine.md#사용자-대기-snapshot)이 소유한다.

관측된 하위 에이전트의 사용자 대기는 부모의 차단 상태에도 반영한다. 부모가 `wait_agent`로 대기하며 다른 모델·도구·프로세스·하위 에이전트가 실행되지 않으면 그 구간을 제외한다. 승인 요청의 원시 기록은 원래 하위 턴에만 남긴다. 사용자 대기가 없는 일반 관측 대기는 기존 시간 의미를 유지하며, 자동 재개 예약 대기는 별도 계약대로 포함한다.

실행 여부는 모델·도구·하위 에이전트의 수명과 대기 상태로 판단하며 CPU 사용 시간을 뜻하지 않는다. 살아 있는 native 프로세스는 종료가 관측될 때까지 실행으로 취급하므로 대화형 셸 내부의 유휴 상태는 별도로 차감하지 않는다. 외부 MCP 요청을 발행한 실행 문맥을 확인할 수 없으면 해당 대기를 임의의 현재 턴에 귀속하지 않는다. 이전 턴에서 시작된 code-mode 셀은 원래 요청 귀속을 유지하면서 이후 턴의 실행 여부에 반영한다. 완료된 턴의 작업 구간과 기존 요청 종료 경계는 고정한다. 그 뒤 유지된 셀이 새로 발행한 요청은 원래 턴에 원시 대기시간만 추가하며 완료된 작업 구간을 다시 열지 않는다.

과거 기록의 시작 시각은 초 단위일 수 있지만 실행 시간은 밀리초 측정값이다. 같은 초에 시작된 순차 턴은 시작 시각의 정밀도와 기록 순서를 고려해 각 측정 시간을 보존한다. 기록 순서·시각 정밀도·대기 경계를 함께 만족시킬 수 없으면 부분 집계로 표시한다. 원본 시각은 변경하지 않는다.

시작 시각·측정 시간·대기 종료 경계가 없는 기록은 추정치로 채우지 않는다. 확인된 시간은 `확인된 시간 · 턴 수`로 표시하고 보조 설명에 일부 기록의 부재를 알린다. 전체 메타데이터를 불러오지 못한 경우에도 확인되지 않은 시간을 전체 총계처럼 표현하지 않는다. native 진단과 다음 live 상태 갱신에서 조회 복구를 처리한다.

## 소유권과 적용 범위

엔진은 기록 경계를, UI/Host는 기록의 조회·집계·표시를 소유한다. 예약의 durable defer 경계는 [자동 재개 계약](../../root-resume.md#deferred-turn-timing)에 둔다. 사용자 승인 자체의 권한은 해당 승인 계약이 소유하며 시간 표시는 권한을 부여하지 않는다.

Windows x64, Linux x64와 macOS ARM64의 로컬 VS Code 대화에 공통으로 적용한다. 원격·컨테이너 환경의 수용은 이번 범위에 포함하지 않는다. native OpenAI 스타일의 기존 보조 텍스트·색상 토큰과 사용자 메시지 레이아웃을 재사용하며 밝은·어두운 테마에서 검증한다.

## Preservation mapping

Registered features: `ui.task-work-time`, `engine.task-work-time`. The task-work-time UI scope retains its three timing tests and the separate `ui.task-work-time.deferred-contract` check. When deferred-turn is also selected, the existing exact-command grouping runs its shared test once and retains both mandatory check records. The [contract index](../../upstream-preservation.md#contract-index) links to the executable inventory. Each section's stated source, native, package, installed and platform limits determine what that registered scope establishes; broader behavior is reviewed separately. The UI test transform fixture reuses complete transformed output through the guarded asset cache; the original behavioral assertions remain mandatory. Its registered guard checks tool, environment, exact path context and cache-owner changes, and runs once when shared by selected features.

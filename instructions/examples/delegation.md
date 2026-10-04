# 위임 예시

아래 경로와 심볼은 설명을 위한 가상 예시입니다. 실제 프로젝트의 경로로 바꿔 사용하세요.

## 직접 처리할 때

설정값 한 개 조회, 알려진 파일의 짧은 수정, 이미 확보한 근거의 요약은 부모가 직접 처리합니다. 위임 전달문을 작성하고 결과를 통합하는 비용이 더 크기 때문입니다.

문서 수정도 현재 유효한 내용을 해당 위치에서 고칩니다. 사용자의 답이 확정되면 질문을 지우고 요구사항이나 계획에 반영하며, 날짜별 응답 기록이나 조사 로그를 덧붙이지 않습니다. 변경 내역 자체가 목적일 때만 이력을 남깁니다.

## 탐색을 맡길 때

다음은 부모가 구현 범위를 판단하는 동안 자식에게 독립적인 근거 조사를 맡기는 예시입니다. 한 줄 조회가 아닌 여러 호출·조건을 추적하는 질문을 사용합니다.

```text
Role: luna_explorer
Objective: 재시도 횟수 설정이 요청 처리까지 전달되는 경로와 기본값 적용 조건을 확인한다.
Scope: src/config/와 src/client/를 읽기 전용으로 조사한다.
Constraints: 코드 변경·테스트 실행·설계 결정은 하지 않는다. 범위 밖 의존성이 필요하면 위치와 이유를 보고한다.
References: src/config/retry.ts의 loadRetryConfig, src/client/request.ts의 sendRequest
Done when: 설정 로딩부터 재시도 분기까지의 경로, 기본값 조건, 미확인 부분이 근거와 함께 정리된다.
Return format: STATUS / ANSWER / EVIDENCE / SEARCHED / UNRESOLVED
```

`spawn_agent`에는 `agent_type="luna_explorer"`를 명시하고 역할의 모델·추론 기본값을 유지합니다. 지원되는 override는 구체적인 필요가 있을 때만 사용하며, `devin_swe2_medium`은 사용자가 명시적으로 요청한 경우에만 선택합니다.

반환 예시 역시 가상 결과입니다.

```text
STATUS: ANSWERED
ANSWER: loadRetryConfig가 읽은 값을 sendRequest에 전달한다. 설정 미지정일 때만 기본값을 사용한다.
EVIDENCE: src/config/retry.ts:loadRetryConfig; src/client/request.ts:sendRequest
SEARCHED: src/config/와 src/client/의 설정 전달 경로
UNRESOLVED: None
```

## 구현을 맡길 때

탐색 결과를 바탕으로 부모가 요구사항과 수정 범위를 결정한 뒤 전달합니다. Codex와 Azrael 모두 `sol_executor`(GPT-6.1 Sol, medium)를 사용합니다. 아래 0 처리 규칙은 예시의 합의된 조건입니다.

```text
Role: sol_executor
Objective: 재시도 횟수 0을 유효한 설정으로 처리한다.
Scope: src/config/retry.ts와 tests/retry.test.ts만 수정한다.
Constraints: undefined일 때만 기본값을 사용한다. 0은 재시도하지 않음을 뜻한다. 공개 함수 시그니처는 유지한다. 다른 작업자와 기존 변경을 보존한다.
References: src/config/retry.ts의 loadRetryConfig; tests/retry.test.ts
Done when: 미지정·0·양수 각각의 동작을 해당 테스트로 확인하고 결과를 보고한다.
Return format: STATUS / CHANGED / VALIDATION / UNRESOLVED / ARTIFACTS
```

요구사항 전달에 도움이 되면 짧은 코드 조각, 평가 알고리즘, 입출력 예시, 기존 테스트 참조 등을 선택적으로 덧붙입니다. 예를 들어 위 작업은 `undefined → 기본값`, `0 → 0`, `양수 → 입력값 유지`라는 입출력 예시로 판정 기준을 설명할 수 있습니다.

위임 후 완료 또는 blocker 보고 전까지 root의 모든 상태 확인을 금지합니다. 메시지, 상태 조회, 파일·로그·프로세스 직접 확인을 통한 우회 확인도 포함합니다. 부모는 독립 작업을 수행하거나 완료 이벤트를 기다립니다. 개입은 사용자 요구 변경, 확정된 요구사항·계약 오류, 데이터 손실 위험, 사전에 정한 제한시간 초과에만 허용합니다.

완료 후 부모는 결과와 통합 영향을 확인하고 필요한 수정 요청을 묶어서 전달합니다. 충분한 조사와 검증을 그대로 반복하지 않고, 다른 변경과 결합되어 새로 생긴 위험이 있을 때 추가 검증합니다.

실질적으로 다른 독립 목표를 위임할 때는 새 자식에 `fork_turns="none"`을 지정합니다. 지원되지 않으면 지원되는 최소 이력 범위를 사용하고 제한을 알립니다. 같은 목표의 수정·검증은 기존 담당자에게 변경분만 전달하며, 완료했다는 이유나 문맥 갱신만을 위해 결합된 작업을 나누지 않습니다.

상세 실행 로그는 작업별 파일에 보존합니다. 성공한 테스트·빌드는 실행 범위, 결과, 실제 종료 코드와 로그·산출물 경로를 반환합니다. 실패하면 실패 대상, 첫 원인 오류와 진단에 필요한 스택·문맥을 보고하고 추가 로그는 필요한 부분만 읽습니다.

## 설치 후 작은 확인 작업

자신의 프로젝트에서 위 탐색 예시의 경로를 실제 경로로 바꿔 `luna_explorer` 하나만 실행합니다. 자식 화면에서 선택된 역할·모델을 확인하고, 파일 변경 없이 정해진 필드와 근거를 반환했는지 확인하세요. 실패하면 역할 발견, 모델 접근, 지침 병합 문제를 구분해 수정합니다. 이 확인은 토큰 절감 실험이 아닙니다.

# 작업 시간 엔진
<!-- architecture: {"id":"arch.task-work-time.engine","layers":["engine"]} -->

Status: `partial` — 턴 관계·재개 횟수·시간 기록의 Windows native 계약과 사용자 메시지 아래 시간·턴 한 줄의 소스 및 Windows 격리 React/CSS 렌더링은 검증됐다. 실제 VS Code 호스트·현재 패키지 설치와 Linux/macOS 수용은 별도 검증한다. 근거는 [작업 기록](../../../../work/AL-01-resume-task-group-reliability/01-plan.md)에 둔다.

집계 의미와 복구 시 적용할 제약은 [전체 계약](README.md)이 소유한다.

## 시간 기록과 projection

엔진은 턴 시간과 root resume 대기 경계를 소유한다. 저장된 TurnStartedEvent attribution을 history builder·저장 projection·metadata-only/full wire Turn·live 알림에 전달한다. `parentTurnId`·`turnTrigger`는 정보가 없는 기록에서 null이며 root ID만으로 자동 재개를 만들어내지 않는다. projected history의 추가 열과 projection 버전 변경은 원본 rollout을 보존한 transactional lazy 재구성을 사용한다.

## 사용자 대기 snapshot

Status: `target` — [작업 기록](../../../../work/EK-01-user-wait-time/01-plan.md)이 구현·검증 범위를 소유한다.

별도 `userWaitTiming` snapshot은 밀리초 단위의 정확한 턴 기준점, revision, 요청별 시작·종료와 원시 대기 시간, 실제 차감할 구간을 보존한다. 초 단위의 과거 턴 시작 시각으로 밀리초 대기를 잘라 계산하지 않는다. 새 snapshot은 기존 완료 요청을 다시 열거나 기준점을 바꾸지 않는다. metadata-only 기록과 실시간 표시가 같은 값을 사용하며, 원래 `durationMs`는 경과 시간으로 유지한다.

차감할 구간의 의미는 [사용자 응답 대기 제외](README.md#사용자-응답-대기-제외)를 따른다. 표시 구현의 partial 상태가 이 절의 target을 승격하지 않는다.

## 예약 경계와 검증 연결

durable defer·취소·재시작의 시간 경계는 [자동 재개 계약](../root-resume/README.md#deferred-turn-timing)에 남긴다. 기존 `engine.task-work-time` 보존 ID와 검사는 [전체 계약](README.md#preservation-mapping)에 연결한다.

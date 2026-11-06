# 작업 메모리 사용과 검증

설계·역할·권한과 수명은 [작업 메모리 계약](../architecture/task-memory.md)이 소유한다. 이 기능은 소스 변경이며 실제 설치본의 도구 제공 여부를 먼저 확인한다. 제품 빌드·설치는 별도 실행 범위다.

## 활성화와 사용

기존 프로필 편집에서 root에는 `Task memory: root`, 작업자에는 `Task memory: subagent` 구성요소를 선택하고 적용 검토를 거친다. 새 대화는 선택한 프로필 스냅샷을 사용한다. 역할별 하나의 구성요소를 선택하면 공통 규칙을 한 번 포함한다. 미선택 프로필과 기존 대화에는 자동 적용하지 않는다.

root가 현재 작업 폴더에 초기화한다. 아래 경로는 사용자가 실제 사용하는 절대 작업 경로로 바꾼다.

```json
{"action":"init","work_dir":"C:/project/work/AA-01-example"}
```

root 또는 작업자가 결과를 게시한다. `scope`에는 적용 코드·환경·입력의 범위를 쓰고 `evidence`에는 관련 경로·심볼·검증 결과를 참조한다.

```json
{"action":"write","work_dir":"C:/project/work/AA-01-example","kind":"finding","expected_revision":0,"title":"재시도 대상은 연결 오류","body":"인증 거절은 재시도하지 않는다.","evidence":["src/client.ts::request"],"scope":"작업 기준 커밋의 request 경로","uncertainty":"상위 호출자의 재시도는 미확인"}
```

도구가 반환한 ID와 버전을 인계한다. 목록은 본문을 반환하지 않는다.

```json
{"action":"list","work_dir":"C:/project/work/AA-01-example","limit":20}
```

필수 기록은 지정된 ID와 버전으로 읽는다. 갱신할 때에는 `write`에 같은 ID와 읽은 `expected_revision` 및 새 전체 내용을 보낸다. 다른 세션의 항목은 root도 덮어쓸 수 없다. 실패·차단·완료는 기존 협업 도구로 별도 통지한다.

## 반복 검증

- `node --test --test-name-pattern="task-memory role resources" scripts/tests/instruction-package.test.cjs`: 두 역할 리소스의 실제 설치 경로와 충돌 검사.
- `node --test scripts/tests/task-memory-profiles.test.cjs`: 기존 프로필 저장·선택·핀·materialization의 역할별 주입과 비선택 보존.
- `node scripts/check-task-memory.cjs`: 고정 소스로 저장 라이브러리와 실제 core handler·도구 정책 검증. `storage` 또는 `core`로 명시적 부분 선택도 가능하다. 실제 통과 테스트 수가 0인 실행은 성공이 아니다.
- 유지보수 번들 `task-memory-profiles`, `task-memory-install`, `task-memory-native`는 같은 명령을 등록한다. 짧은 실행 제한이 있는 도구 환경에서는 native 명령을 장시간 실행 세션으로 실행하고 실제 terminal 결과를 확인한다.

native 검증은 기존 Cargo 캐시·잠금·생성 이력 소유자를 사용한다. 원본 엔진의 고정 복사본과 로그·보고서는 실행 그룹으로 귀속한다. 종료 후 필요한 결과를 작업 계획에 보존하고 임시 소스·검증 자료는 기존 owner 기반 정리 절차로 제거한다. 실패하거나 중단된 실행을 성공으로 바꾸지 않는다.

Windows x64에서 수행한 확인은 Linux x64·macOS ARM64의 실제 실행 수용이나 설치본의 에이전트 토큰 절감을 증명하지 않는다. 실제 작업에서 필수 읽기 성공, 불필요한 맥락 조회, 재질문·재작업과 총 입력·출력 토큰을 확인한다.

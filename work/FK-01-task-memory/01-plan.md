상태: 소스 구현·범위별 검증·임시 자료 정리 완료. 기존 미커밋 변경과 분리 문제로 커밋은 보류했다. 제품 빌드·설치·실사용 토큰 측정은 이번 범위 밖이다.

# 작업 메모리와 프로필 연계

## 목표와 권한

사용자가 구현을 요청했다. 작업 폴더의 mem에 root와 subagent가 기록하고 root가 필수 읽기 항목과 버전을 지정한다. 계획/설계는 요구사항·승인·완료 기준의 원본이며 mem은 조사·차단·작업 결과의 원본이다. 클라우드, Observer, 벡터 검색, 자동 장기 기억, 제품 빌드·설치·배포는 범위 밖이다. 새 역할 지침은 선택형 프로필 구성요소로 제공하며 기존 프로필과 대화를 자동 변경하지 않는다.

## 범위와 구조

- 공통 의미는 Windows x64, Linux x64, macOS ARM64에 적용한다. 실제 검증 환경은 Windows이며 다른 OS의 실행 수용을 주장하지 않는다. 로컬 파일만 지원하며 원격 실행 환경에서는 호스트 파일을 대신 열지 않는다.
- 원본은 기존 작업 폴더의 mem 아래에 둔다. native task_memory 도구는 init/list/read/write를 제공한다. read는 특정 항목/버전, list는 본문 없는 제한된 목록, write는 예상 버전에 대한 충돌 검사와 불변 이전 버전을 제공한다.
- 실행 환경의 기존 파일 권한과 읽기 거부를 적용한다. root는 공통 context, 각 세션은 자기 findings/tasks 기록을 작성한다. 생성 root ID는 출처 정보이며 새 root가 명시한 작업 경로의 기록을 읽고 자기 context를 만드는 것을 막지 않는다. 기록은 승인·지시·완료 이벤트가 아니다.
- ID·작성 세션·버전은 도구가 관리한다. 작성 내용은 제목·본문·근거·적용 범위·불확실성으로 축소한다.
- 기존 ext/memories는 전역/장기 기억과 다른 backend/schema를 사용하므로 자동 활성화하거나 저장소를 공유하지 않는다. 프로필은 기존 instruction 구성요소 선택·핀·주입을 재사용한다.

## 소유와 실행 순서

root는 요구·저장 계약·native handler 통합·문서·최종 검증을 소유한다. 독립적인 저장 라이브러리와 프로필 리소스 연결은 계약 확정 후 제한된 담당자에 배정할 수 있다. 기존 동시 변경은 보존한다. 저장 라이브러리의 동작 검증 후 native 도구 경계를 검증하며 컴파일 입력은 실행 전에 고정한다.

## 지침 변경 전후

원본은 claude-mem plugin/modes/code.json의 작성 지침이다. 기존 파일을 복사하여 수정하지 않고 선택형 새 역할 구성요소를 작성한다. 의미상 바꾼 규칙을 삭제+추가로 숨기지 않고 아래에 전후 원문과 직역을 제시한다. 유지 원칙은 결과 중심·독립적 사실·단순 반복 생략이다. Observer 전용 역할·XML·concept 태그 강제·중복 요약 필드는 제거한다. 새 권한·근거·버전·알림 규칙은 신규 추가로 분리한다.

### 수정 1: 결과 없는 조사

전 원문: File related research that comes back empty or not found

전 직역: 결과가 비어 있거나 찾지 못한 것으로 돌아오는 파일 관련 조사를 생략한다.

후 원문: Skip empty research results only when they do not affect another worker's next action. Otherwise record the searched scope, result and limits of the conclusion.

후 직역: 다른 작업자의 다음 행동에 영향을 주지 않을 때만 빈 조사 결과를 생략한다. 그렇지 않으면 검색한 범위, 결과와 결론의 한계를 기록한다.

### 수정 2: 반복

전 원문: A fact, decision, or fix status you have already recorded earlier in this session, even if phrased differently.

전 직역: 표현이 달라도 이 세션 앞부분에서 이미 기록한 사실, 결정 또는 수정 상태를 생략한다.

후 원문: Skip unchanged confirmations already recorded in this work. Update the existing entry when the conclusion, evidence, scope or task state changes; preserve its previous revision.

후 직역: 이 작업에 이미 기록된 변하지 않은 재확인을 생략한다. 결론, 근거, 범위 또는 작업 상태가 바뀌면 기존 항목을 갱신하고 이전 버전을 보존한다.

### 수정 3: 기록 대상

전 원문: Focus on durable technical signal:

전 직역: 오래 지속되는 기술적 신호에 집중한다.

후 원문: Record findings, changed outcomes, blockers and unresolved questions needed for another worker's next action or verification, including temporary work context.

후 직역: 일시적인 작업 맥락을 포함하여 다른 작업자의 다음 행동이나 검증에 필요한 발견, 바뀐 결과, 차단 원인과 미해결 질문을 기록한다.

### 수정 4: 관련 파일

전 원문: **files**: All files touched (full paths from project root)

전 직역: 파일: 다룬 모든 파일(프로젝트 루트에서 시작하는 전체 경로).

후 원문: Reference only files, symbols and execution evidence relevant to the entry's conclusion; do not repeat complete file inventories or logs.

후 직역: 항목의 결론과 관련된 파일, 심볼과 실행 근거만 참조한다. 전체 파일 목록이나 로그를 반복하지 않는다.

### 수정 5: 요약 주기

전 원문: Always write at least a minimal summary explaining current progress, even if work is still in early stages, so that users see a summary output tied to each request.

전 직역: 작업이 아직 초기 단계여도 사용자가 각 요청에 연결된 요약 출력을 볼 수 있도록 현재 진행을 설명하는 최소한의 요약을 항상 작성한다.

후 원문: Write on meaningful findings, blockers, changed results and handoff boundaries rather than on every request or tool call.

후 직역: 모든 요청이나 도구 호출마다가 아니라 의미 있는 발견, 차단 원인, 바뀐 결과와 인계 경계에서 작성한다.

## 검증과 완료 기준

- 저장·조회·버전 고정·동시 쓰기 충돌·작성 소유자·공통 context root 제한·경로 링크 거부·내용/목록 크기 제한·재개 시 보존을 실제 임시 파일로 확인한다.
- native handler의 local environment와 파일 권한 적용 및 도구 노출을 확인한다. compile/실행 불가나 기존 오류는 성공으로 처리하지 않는다.
- 실제 프로필 저장·선택·materialization에서 root/subagent 조각의 핀과 기존 지침의 보존을 확인한다.
- 영구 테스트는 버전 유실·권한 우회·역할 혼합을 재발시킬 수 있는 최소 경계만 유지한다. 결과와 실제 exit code를 이 문서에 남기고 disposable 검증 자료는 기존 소유 절차로 정리한다.
- architecture/기능 보존 목록/반복 검증 명령을 연결한다. 변경 범위만 task commit하며 기존 staged 변경을 포함하지 않는다.

## 실행 근거

- 프로필 실제 조립 단독 검사: `task-memory-profiles` 번들, exit 0, 1/1 통과. 기존 저장·선택·핀·materialization 경로에서 역할 분리·미선택 상태·스냅샷 보존·임시 fixture 제거를 확인했다.
- 프로필/기존 지침 설치·패키징 검사: `node --test scripts/tests/task-memory-profiles.test.cjs scripts/test-instruction-settings.cjs scripts/tests/instruction-module-packaging.test.cjs`, exit 0, 12/12 통과. 소유 실행 `run:FK-01-task-memory:20261103T010931276Z-fca68965-d85d-4db3-98c4-3477679d44d7`. 이 결과를 보존하고 원시 로그는 사용 종료 후 정리한다.
- 지침 라이브러리 검증: Python313의 `scripts/import-instructions.py --check`, exit 0. 63 skill files·15 components·92 local links 검사와 기존 historical provenance 유지 확인. 생성기에도 새 선택형 구성요소를 반영했다.
- 첫 native 번들은 프로젝트 도구의 10초 실행 제한으로 source freeze 중 exit 124로 종료됐다. `run-42784-5498-1793667819127696200`은 `producer_completed:true`의 terminal 실행 결과이며 제품 테스트는 시작하지 않았다. 정확한 명령의 추가 프로세스 부재를 보조 확인하고 생성 소유자로 failed/stopped를 보존했다. 소유 종료 helper의 in-memory listener 제거는 재구성 객체에서 오류가 났으나 catalog의 실제 종료·exit124·complete membership 저장을 별도로 확인했다. 성공으로 바꾸지 않았다.
- 첫 장시간 재시도는 executor 소유 workId `dc097255-eca4-43c0-b76b-4a87c4cdb3e4`, session 79144다. 고정 입력의 저장소 6개 검사는 exit 0으로 통과했고 core 컴파일은 아래의 기존 소유권 오류로 실패했다. 작업 소속 기록이 root 교체에도 이어진다는 합의에 맞춰 이후 소스에서 creating-root 접근 제한을 제거했다. 생성 root ID는 출처만 보존한다. 기존 고정 입력은 수정하지 않았다.

- 첫 장시간 native 실행은 저장소 6개 통과 후 기존 untracked role_profile.rs의 이동 후 참조 오류(E0382)로 core compile exit 101, 전체 exit 1로 종료됐다. reasoning_effort를 clone하는 최소 수정을 적용하고 새 입력에서 재검증한다. 기존 프로필 파일 전체는 이 작업 소유가 아니다.
- 설치 대상의 중복과 허용 경로를 실제 installer로 검증했다. root/subagent 리소스를 각각 skills/task-memory-root, skills/task-memory-subagent 하위에 배치한다. SKILL.md를 만들지 않으며 선택된 프로필만 내용을 조립한다. focused installer 1/1, profile 1/1, import --check 모두 exit 0.

- 후속 native 입력 고정 중 formatter가 handler 파일을 변경해 guard가 실행을 차단했다(exit 1, Cargo 시작 전). 포맷 완료 후 새 실행으로 재시도한다.
- 추가로 전체 instruction-package 파일을 실행한 결과 33 passed / 2 failed / 1 skipped(exit 1): 기존 release ownership의 Artifact destination already claimed 및 generated-release fixture parent 소유 경계 오류. 새 설치 검사와 프로필 검사는 통과했다. 기존 release 경계는 변경하지 않으며 task-memory 설치 검사는 명시적 이름 필터로 별도 등록했다.
- 최종 소스 번들 run-42784-5509-1793668927937666100: installer 1/1 및 profile 1/1, 각각 exit 0, 입력 무결성 검사 통과. 전체 feature manifest 검증도 exit 0이다.

- 최종 실행은 `run:FK-01-task-memory:20261103T012012495Z-1c09d692-69f7-45f8-9bfd-9f20a2f731e5`, 고정 소스 경로는 `artifacts/verification/fk-1c10f477/engine`이었다. 실제 결과와 정리는 아래에 보존한다.
- 커밋 경계: 기존 role-profile 파일은 다른 작업의 untracked 코드이고 공유 엔진 파일에도 관련 없는 변경이 있다. 파일 전체를 stage하지 않는다. 전체 instruction-package 회귀 검사의 기존 소유 fixture 오류 2건과 별개로 이 작업의 설치·프로필 검사는 통과했다.
- core 컴파일 시작 약 11분 후 첫 상태 점검: 실행 소유자 node 27184의 정확한 자식 rustup 37904 → cargo 44364 → rustc 42852를 확인했다. rustc 누적 CPU 약 338초, working set 약 6.25 GB로 컴파일 프로세스가 존재한다. 종료나 성공 근거로 사용하지 않으며 중복 실행하지 않는다.
- 최종 native 실행: 저장소 7/7, core task_memory 2/2 통과, 각각 실제 exit 0, preflight accepted true, 실행 전체 exit 0. core 컴파일·실행은 01:21:48–01:34:39 UTC 약 12분 52초였다. Windows x64에서 실제 handler의 읽기 전용 허용/쓰기 거절·native 작성자·root 교체 재사용과 local/tool-policy 등록을 확인했다. Linux/macOS 실행, 설치본 동작, 실제 토큰 절감은 미검증이다.
- 최종 diff 리뷰에서 삽입한 helper로 이동했던 기존 add_core_utility_tools의 trace 속성 위치를 원래 함수로 복원했다. 검증 대상인 권한·등록 함수 본문과 테스트 조건은 변경하지 않아 통과한 실행 근거를 재사용한다. 그 외 최종 소스와 고정 입력의 차이는 기존 파일 줄바꿈 복원 및 README 범위 표기 교정이다. trace 출력 자체는 이 테스트의 검증 대상이 아니다.
- 기능 manifest 전체 검증, 지침 생성기 --check, 새 파일 diff --check는 모두 exit 0이다. 기존 프로필의 미커밋 코드와 공유 파일의 다른 작업 변경을 안전하게 하나의 독립 커밋으로 분리할 수 없어 이번 작업 커밋은 보류한다. 기존 index는 변경하지 않았다.
- 이전 검증 4개 실행 그룹은 검증된 standalone maintenance_owner로 최신 review 후 삭제했다. 7개 항목 모두 deleted/remaining:false이며 lifecycle finalize가 모두 남은 경로·참조·차단 없음으로 끝났다. 02-cleanup-review.json은 상세 원시 응답 대신 경로별 부재를 확인한 간결한 결과를 보존한다. 마지막 통과 실행의 정리는 진행 중이다.
- 마지막 통과 실행도 최신 review 후 두 항목 모두 deleted/remaining:false, finalize의 남은 경로·참조·차단 없음으로 종료했다. 03-final-cleanup.json에 간결한 결과를 보존한다. 이번 작업의 임시 실행 그룹 5개·항목 9개는 모두 제거됐다. 공유 Cargo 캐시는 기존 소유자의 재사용·보호 규칙을 유지했다. 정리 완료 후 FK 실행 lifecycle이 남지 않음을 확인했다.

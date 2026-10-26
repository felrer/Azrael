상태: 구현·관련 회귀 검증 및 승인된 경로 보완 완료. 검증 자료 삭제·producer 종료와 부재 확인 완료.

# DW-09 소스 테스트 추가 축소

## 범위와 승인

사용자 요청: 이전 129개 소스 테스트의 소스 문자열·고정 개수 검사를 전부 삭제하고, 전체 pinned 캐시 행렬의 변경 영향별 선택, UI 변환 결과 공유, 단계 간 source receipt 재사용을 권장대로 개선한다. 실제 실행 출력·프로토콜 문자열과 호출/상태의 동작 개수는 보존한다. 제품 항목 총수와 정적 AST 형상 검사는 삭제한다. 제품 기능과 지원 플랫폼은 유지한다. 공통 Windows x64/Linux glibc x64/macOS ARM64 코드이며 실검증은 Windows x64다. 제품 빌드·설치는 수행하지 않는다.

## 구현과 의존성

- matrix_scope: 정책/asset 행렬/행동 테스트. 선언된 target만 축소, 공통·불명확 변경과 exhaustive 전체 유지.
- ui_result_share: 기존 fixture 캐시의 immutable 결과와 deferred/pets 파싱 공유.
- reuse_handoff: 현재 입력·환경·로그를 재검증하는 명시적 source receipt 전달.
- retire_static_ui/window/build: 이전 129개 파일의 정적 검사와 전용 준비 코드 삭제.
- root: 범위 판단, 통합, 문서/feature 연결, 검증과 정리/커밋. 담당자별 배타 소유.

## 성공 기준과 검증

기존 실제 동작 검사 유지, 정적 검사·전용 준비 코드 제거, 영향 없는 asset 생략 이유 기록, 공통 owner·불확실한 의존성 full 검증, 같은 프로세스 immutable 결과 공유, receipt 불일치·오염 실패 유지를 확인한다. 변경된 행동 테스트와 영향 대상 Windows 회귀를 실행한다. 129파일 전체 실행과 제품 빌드는 별도다. 속도는 실측 범위만 보고하며 과거 병렬 소요를 합산하지 않는다.

## 산출물과 정리

run:DW-09:source-optimization에 artifacts/tasks/dw09-checks와 artifacts/tasks/tw09를 출력 생성 전 계획 등록했다. 임시 제어 파일 .git/dw09-*는 사용 후 보통 삭제·부재 확인한다. 테스트 종료·결과 검토 뒤 최적화 maintenance_owner로 disposable roots를 삭제한다. 최종 검증 요약은 본 문서에 남긴다.

## 구현 결과

- 정적 소스 문자열·AST 형상·고정 patch/inventory 수 검사와 전용 준비 코드를 제거했다. 정적 전용 사례 16개에는 HEAD에 없던 기존 미커밋 maintenance launcher 사례 1개가 포함된다. 실제 실행·UI 출력·프로토콜·오류·권한·호출 횟수·캐시 무결성 검증은 유지했다. 파일 전체 삭제는 없으며 동작 검증이 남은 테스트 파일을 유지했다.
- pinned 행렬을 asset별 사례로 나누고 선언된 주입기 target 합집합만 선택한다. 공통 owner·핀·직접 테스트 변경·exhaustive·미분류 변경은 전체다. 기존 deferred 주입기의 선언에 header target이 빠져 있어 해당 변경은 안전하게 전체로 처리한다. 이 작업은 제품의 cache gate를 변경하지 않는다.
- UI fixture는 context/source를 재확인한 후 같은 immutable 결과와 digest를 공유한다. deferred 원문·AST도 재사용한다. 별도 중복 디스크 캐시는 추가하지 않았다.
- deployment의 `-SourcePreflightReceipt` 및 수동 runner의 `--source-preflight-receipt`로 명시적 전달을 지원한다. 현재 config로 입력·프로젝트·환경·로그를 검증하고, 기존 config 파일은 수정하지 않는다. 원본 receipt/log owner는 downstream 사용 종료까지 참조를 유지해야 한다.
- source policy owner와 실제 행동 검사를 기존 `tool.project-maintenance`에 연결했다. 기존 feature manifest 변경 214줄과 provider-context의 TPS 렌더링 변경(+8/-5)은 별도 사용자 변경으로 보존한다.

## 실제 검증과 재실행

Windows x64, Node 26.7.0, Python 3.12, PowerShell 7.6.7에서 실행했다. 제품 빌드·설치는 하지 않았다. 원시 로그는 사용 종료 후 삭제하며 다음 기록이 독립적인 검증 요약이다.

| 실행 범위 | 실제 결과 | 시간 |
| --- | --- | --- |
| source policy / immutable fixture / feature-preservation / project-selection 4파일, 첫 실행 | exit 1, 70 통과·1 실패. 새 runner 의존 테스트가 선택 목록에 포함된 데 맞춰 기대 목록 수정 | 86.473초 |
| 같은 4파일, 최종 manifest 반영 후 재실행 | exit 0, 71 통과·실패/skip 0 | 80.842초 |
| deployment 명시 receipt 성공·거부 2사례 | exit 0, 2 통과 | 21.874초 |
| 확대 회귀 68개 실행 항목 | exit 1, 782 통과·3 실패·1 skip | 358.292초 |
| 캐시 생성·소비 복구 2사례 + 마지막 정적 검사 제거 구간 1사례 | exit 0, 3 통과 | 14.742초 |

확대 실행 항목 중 실제 테스트 파일은 65개다. 실수로 일반 source policy/fixture 모듈 2개와 CLI runner를 포함했다. CLI는 instruction catalog/migration fixture root 사전조건에서 종료됐으며 제품 빌드·추가 lifecycle 생성은 없었다. 모듈 2개의 빈 실행은 제품 검증으로 집계하지 않는다. 실제 실패 2개는 정적 assertion/미사용 변수 제거 시 함께 빠진 캐시 생성·조회 호출이었다. 고정 수 검사 없이 호출을 복구하고 두 사례를 재실행해 통과했다. 나머지 통과 결과는 영향을 받지 않아 재사용했다. 따라서 최초 확대 명령의 실패 상태는 그대로 보존하고 최종 수정의 근거는 해당 재검증과 연결한다.

확대 실행의 유일한 skip은 `pinned native headless reconciliation of absent fixture journal never creates bootstrap state`다. 해당 native 환경 검증은 성립하지 않았다. 실제 테스트 파일 69개의 결과를 조합한 소스 검증은 853 통과·1 skip이며, deployment 2사례는 별도다. 다른 OS와 전체 129파일 source 단계는 실행하지 않았다. 병렬 실행 시간이 겹치므로 위 시간을 합산하지 않으며, 이 결과는 최적화 전후 속도 비교가 아니다.

모든 담당 파일의 Node/PowerShell 구문 검사와 CRLF를 고려한 scoped diff 검사를 통과했다. 최종 통합 점검에서 잔존 source regex 3개와 patch-count 1개를 추가 제거하고 해당 사례를 재검증했다. 추가 유지한 receipt 전달·immutable 결과 변조 방지 검사는 현재 기능의 지속적인 회귀 계약이다.

## 승인된 경로 보완과 정리

최적화 실행기 SHA-256 `6ffd3d7e5787439381740a8bb3a32a7f4d4ab0d91beba4ee145c954287a06a96`와 유지된 `version:maintenance-owner:dx05`를 확인했다. 기존 native group 422개를 페이지별 조회한 뒤 새 deployment 그룹을 등록·검토했다. 등록 exit 0(6.244초), 검토 exit 0(4.768초)이나 삭제 가능 상태가 아니다. `artifacts/t-b7c4`는 테스트가 만든 빈 보통 디렉터리(직접 확인: 링크 아님, entries 0)이며, 기존 `test-deploy-azrael.ps1`이 `artifacts/t-<id>`를 기본 생성한다. 이 위치가 `project-maintenance.json`의 managed roots 밖이라 `outside configured managed roots`로 묶음 전체가 보호된다. 삭제 apply는 실행하지 않았고 다른 API/셸 삭제로 우회하지 않았다.

사용자가 해당 경로의 관리 설정 보완과 향후 관리 범위 안의 임시 폴더 생성을 승인했다. 정확한 `artifacts/t-b7c4`만 임시 managed root에 추가하고, 검증된 실행기의 `retire_managed_roots`에 정확한 항목 ID·소유자·독립 증거를 전달했다. fresh review의 blocker는 0이었다. apply exit 0, 30.797초, 두 항목 모두 deleted/remaining false/error null을 확인했다. 실제 경로 부재와 producer registry finalize도 확인했다. 사용자 파일의 속성·ACL·소유권 변경이나 force 삭제는 하지 않았다. 소유된 테스트 fixture 안의 Git 파일에만 도구가 ReadOnly/Hidden을 정상화했다. 관리 설정은 보존해 둔 원본 바이트와 동일하게 복구했고, 넓은 관리 루트를 추가하지 않았다.

이후 `test-deploy-azrael.ps1`은 `artifacts/tasks/t-<id>`에 임시 폴더를 생성하고 Generated/ProtectionKnown을 선언한다. 새 경로에서 명시 receipt 성공·거부 및 `short fixture install` 3사례를 재실행했다. controller exit 0, 42.982초, 모두 의도한 결과를 확인했다. 거부 사례의 내부 exit 1은 기대된 결과이며 controller 실패로 바꾸지 않는다. 이 fixture 변경은 Windows 배포 검증 경로에 해당한다.

동일 체크아웃의 별도 DW-11 측정이 소스 입력을 고정하고 있어, 최종 문서·대량 정리·커밋을 해당 producer의 실제 terminal 신호까지 보류했다. DW-11은 실제 테스트 exit 0 이후 다른 작업의 세 입력 변경으로 controller exit 1을 기록했다. 그 결과나 자료를 이번 작업의 성공 영수증으로 사용하거나 정리하지 않는다. DW-10의 후속 변경도 task index에 섞지 않고 작업 사본에 보존한다.

정리 승인 근거와 실제 exit를 보존하는 작은 관리 증거는 `artifacts/maintenance/evidence/DW-09-retire-t-b7c4.json` 및 `DW-09-source-optimization-results.json`이 소유한다. 원시 로그·캐시·fixture와 `.git/dw09-*` 제어 파일은 현재 용도가 끝나면 제거하고 실제 부재를 확인한다. 별도 보존 예외는 없다.

최종 재검증의 deployment 자식 묶음은 fresh review의 두 항목 모두 blocker 0이었고, apply exit 0(34.521초), deleted/remaining false/error null로 끝났다. 루트 묶음도 fresh review blocker 0, apply exit 0(26.853초), 두 항목 모두 deleted/remaining false/error null이었다. 두 producer 모두 finalize의 remaining/references/blockers가 비어 있음을 확인했다. 기존 `artifacts/t-b7c4`, 새 `artifacts/tasks/t-292c`, `artifacts/tasks/dw09-checks`, `artifacts/tasks/tw09`의 실제 부재와 세 producer 레코드 제거를 확인했다. 최초 실패한 검증 실행의 outcome은 failure/exit 1로 종료했으며 후속 성공으로 덮어쓰지 않았다.

다른 정리 실행과 겹친 등록 시도 두 번은 점유된 maintenance 잠금으로 exit 1이었다. 잠금을 해제하거나 우회하지 않았고, 점유 종료 후 등록·검토·삭제를 순서대로 수행했다. 복원 후 별도 작업이 `question-queue-source` bundle을 추가했으므로 현재 설정 전체의 해시는 원본과 달라졌으나, managed roots는 원본과 동일하며 이 작업의 임시 확장은 남아 있지 않다. 별도 bundle과 DW-10/DW-11 변경은 보존한다. 커밋용 분리 index만 사용하며, `.git/dw09-*` 제어 파일은 커밋 확인 직후 일반 삭제와 부재 확인으로 마감한다.

상태: 구현 중. 삭제만 사용자 승인 대상으로 연결하는 범위를 승인받았다.

# 전체 액세스의 삭제 승인

## 목표와 권한
전체 액세스에서 삭제를 실제 사용자 승인으로 전달한다. 일반 명령, Git 작업, 시스템 설정 변경의 정책은 바꾸지 않는다. 구현·관련 검증·정리까지 수행하며 제품 빌드·설치·배포는 포함하지 않는다. 기존 강제 삭제 금지 지침도 유지한다.

## 범위와 설계
- Windows x64 PowerShell/CMD 및 Linux x64·macOS ARM64 POSIX에 공통 의미를 적용한다. 실제 실행 환경은 Windows이며 다른 OS의 설치 수용과 구분한다.
- 전체 액세스의 never 설정은 유지하고 엔진이 식별한 삭제 호출에만 사용자 승인을 요구한다. 기존 셸 파서와 명령·패치 승인 UI를 재사용한다.
- rm, unlink, rmdir, PowerShell Remove-Item 및 삭제 별칭, CMD del/erase/rd/rmdir를 다룬다. apply_patch 파일 삭제도 포함한다. 기존 파서의 옵션·래퍼·복합 명령 해석을 재사용한다.
- 명시적 forbidden 규칙과 파일 접근 제한을 우선한다. 다른 위험 명령의 차단을 삭제 승인으로 풀지 않는다.
- 사용자 승인을 hook Allow나 Guardian으로 대체하지 않는다. 삭제에는 영구 prefix 허용이나 세션 전체 승인을 저장하지 않는다. 이번 구현은 호출별 승인이고, 이전 검토의 요청 범위 재사용 프로토콜은 도입하지 않는다.
- 외부 스크립트·MCP·임의 언어 내부의 모든 삭제를 감지하는 범용 장치로 주장하지 않는다. 관리 도구의 정리 계약은 유지한다.

## 구현과 검증
root가 분류, exec-policy, 승인 라우팅, 파일 패치, 호스트 자동 승인 예외와 문서를 소유한다. 분류·정책 연결 후 기존 사용자 승인 왕복을 재사용한다. 소스는 docs/ops/development.md의 engine/이고 실행 중 설치본은 수정하지 않는다. 병행 변경을 보존한다.
삭제/비삭제 분류, 일반 명령 무승인, 승인 전 미실행, 승인·거절·중단, forbidden 우선, 캐시·prefix 비재사용, 패치 삭제/일반 편집 분리 및 호스트 전달을 검증한다. 실제 종료 코드와 미검증 범위를 기록한다. 유지하는 새 테스트는 권한 계약의 지속 회귀 보호용이다.

## 근거와 결과
기존 exec_policy.rs는 위험 명령의 Never를 Forbidden으로 처리한다. 기존 전체 액세스 매핑을 바꾸는 대신 삭제에 한정한 엔진 예외를 추가한다. 소스 검증과 빌드·설치 상태를 분리한다.

## 실행 결과와 남은 작업

상태: 소스 구현 및 호스트 검증 완료, native 검증·정리 차단. 필수 엔진 검증이 끝나지 않아 완료 또는 설치 수용을 선언하지 않으며 task commit도 하지 않는다.

- 실제 소스 변경: 알려진 삭제 명령 분류(일반·재귀·강제 삭제, POSIX find -delete/-exec 포함), full-access 삭제 호출만 NeedsApproval, explicit forbidden 우선, hook Deny 유지 및 hook Allow/Guardian/세션 캐시 우회 금지, apply_patch 파일 삭제 승인, standalone 호스트의 삭제 자동 승인 예외.
- 검증: node --test --test-reporter=dot scripts/check-deletion-approval-host.cjs — 종료 코드 0, 기존 26개 테스트 통과. TypeScript 의미 검사와 실제 chatSession 테스트를 메모리에서 실행했으며 새 삭제 명령/패치 전달·거절을 포함한다. 제품 dist는 생성하지 않았다.
- feature-preservation의 loadManifest/validateManifest — 종료 코드 0. native 검증 스크립트 JavaScript 구문 검사 및 변경 범위 diff whitespace 검사도 종료 코드 0이다. Rust 구문은 rustfmt로 읽었지만 컴파일·테스트 통과를 뜻하지 않는다.
- 초기 호스트 fixture 검증 run-73132-2629-1792942888998531900은 Node 타입 경로 설정 누락으로 종료 코드 1. 진단 로그: artifacts/tasks/bt-deletion-host/runs/20261025T154130822Z-ad906b80-f263-4665-8480-64215097f222/logs/typescript.log. 최종 검증기는 명시적인 typeRoots와 메모리 실행으로 이 준비 문제를 수정했다.
- 후속 관리 도구 실행 run-73132-2633-1792942942320065400은 시작 단계에서 종료 코드 124. 이 실행의 .run-claim.lock 소유 PID 47328/token 1e51922f-9f5b-4663-9cc7-1351dbd6349e가 남았다. native 복구기는 live or queryable owner PID vetoes recovery로 거절했다. 잠금을 삭제하거나 guard를 우회하지 않았다.
- 복구 근거·요청은 artifacts/maintenance/evidence/bt-delete-host-2633-*.json에 남겼다. 사용한 기존 maintenance_owner의 SHA-256은 179479f6bf835198184668945148b4cfcf711d8a116e767ba1eb02cfeaecb4bf이다. 이 거절을 잠금 해제 성공으로 기록하지 않는다.
- 실패 fixture 그룹의 등록/정리도 exclusive maintenance lock unavailable로 차단되었다. 해당 fixture와 진단 근거는 보류한다. 재검토 조건: 실행기가 이전 프로세스 참조를 해제하고 공식 잠금 복구/그룹 등록 및 fresh review가 통과하면 필요한 요약을 보존한 뒤 테스트 생성물을 삭제한다.
- native 검증용 새 소스 스냅샷이나 Cargo producer는 시작하지 않았다. 공유 Cargo 캐시에 있었던 다른 빌드의 성공·실패나 이번 변경 반영 여부는 인증하지 않는다. 제품 빌드·설치·배포는 수행하지 않았다.
- 다음 단계: 실행기 참조가 해제된 뒤 기존 복구 경로를 재검토하고 deletion-approval-native(분류·exec-policy·승인 라우팅·patch) 실행, 실패 수정/재검증, fixture 정리 및 task commit. Windows 실행 증거와 다른 OS 설치 수용은 구분한다. 새 회귀 테스트는 삭제 승인 권한 계약의 지속 보호용으로 유지한다.

상태: 문서 반영·검증·임시 자료 정리 완료 — 승인된 1·2번만 반영했으며 사용자 추가 응답은 필요 없다.

# 빌드 준비 지침 보강

- 목표/권한: 승인된 고정 실행 사본의 검사 도구 준비와 실제 자식 환경의 캐시·임시 경로 확인을 기존 빌드 지침에 반영한다. 공간 기준(3번), 자동화 코드, 공유 instruction library 및 설치 상태는 변경하지 않는다.
- 범위/플랫폼: docs/playbooks/build.md의 원칙과 docs/ops/development.md의 실행 절차. Windows/Linux/macOS 공통 준비 원칙이며 명령 예시는 npm/Bun 소비자에 한정한다. 이번 변경은 Windows에서 문서·코드 대조로 검증하고 다른 OS의 실행 결과를 주장하지 않는다.
- 구현: 원본 checkout의 의존성 유무를 실행 사본의 준비 증거로 사용하지 않으며, 최초 fixture discovery 전에 lockfile 기반 도구 준비·실제 모듈 load를 요구한다. 기존 readiness/fixture 소유자를 재사용한다. cache/temp 설정은 실제 child environment의 tool query 또는 작은 owned write probe로 확인한다.
- 근거: deploy-azrael.ps1에서 source-fixtures가 verification-dependencies보다 먼저 실행된다. test-project.cjs의 fixture 선택 경로가 TypeScript를 import하며, pipeline-preflight.cjs의 뒤쪽 dependency 준비는 provider Bun 의존성을 담당한다.
- 검증/완료 기준: 승인된 두 내용의 누락·중복·3번 범위 혼입 없음, 기존 자동화의 한계를 사실대로 기술, 링크 대상 존재, git diff --check actual0, task 문서만 분리 commit. 제품 코드 변경이 없어 제품 재빌드·테스트는 선택하지 않는다. 임시 plan body는 생성 후 즉시 삭제한다.
- 기존 최신 빌드·설치는 디스크 공간 확보 대기 상태를 유지한다.

- 검증 결과: 실제 deploy/test-project/pipeline-preflight 호출 대조, 승인 범위 diff 수동 검토, 링크 대상·heading 확인 actual0, git diff --check actual0. 제품 자동화는 수정하지 않아 동작 개선을 검증했다고 주장하지 않는다. 임시 plan body ordinary 삭제·부재확인 완료. 기존 빌드 입력 및 다른 작업 변경은 보존한다.

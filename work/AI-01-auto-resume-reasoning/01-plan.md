상태: 완료 — 소스 수정과 필수 검증·임시 입력 정리 완료. 설치 반영은 별도 작업이다.

# 자동 재개 추론 설정 보존

## 요청과 범위
자동 재개가 대기 전 추론 설정을 유지하도록 소스·테스트·문서를 수정한다. 수동 재개는 현재 세션 설정을 사용하는 기존 동작을 유지한다. 이 작업은 전체 앱 빌드·설치·게시를 수행하지 않는다.

플랫폼 공통 native OpenAI root 정책이며 OS·CPU·데스크톱 기능에 의존하지 않는다. Windows x64에서 검증했고 macOS/Linux 및 실제 설치본 수용은 별도이다. 기존 다른 작업의 변경과 스테이징을 보존한다.

## 동작과 구현
예약을 요청한 실제 StepContext의 effective reasoning effort를 캡처한다. 새 예약과 SQLite의 추가 0064 마이그레이션으로 저장하며 기존 SQL 바이트는 유지한다. Deadline/AgentsCompleted/WorkCompleted는 재개 턴의 설정 사본에 저장값을 적용한다. 세션 기본값은 덮어쓰지 않는다. 수동 재개는 현재 세션 값, 스냅샷 없는 기존 예약은 기존 설정 경로를 유지한다. 엔진 재시작 후에도 예약 저장값을 사용한다.

기존 StepSettings/serde/SQLx를 재사용하고 새 의존성은 없다. root가 예약 저장→재개 컨텍스트→검증과 문서 통합을 담당했다. 소유 설계는 `docs/architecture/root-resume.md#reasoning-effort-on-automatic-resume`, 보존 ID는 `engine.root-resume-reasoning`이다.

## 검증과 근거
로그 소유 폴더: `artifacts/logs/auto-resume-reasoning-20261013/`.

- 통합 첫 입력: 다른 작업의 중복 필드·반환 타입·borrow·PartialEq·registry getter 오류 7건으로 컴파일 종료 101. `root-resume-tests.log`, `integration-errors.txt`. 이 결과는 당시 고정 입력에 한정한다.
- 통합 입력의 protocol/state 독립 검사: 종료 0, 11개 통과. `reservation-tests.log`.
- 기본 리비전 `f38bf730b7136ee6f4bb2e286557edb4abcbbca8` + 이번 엔진 변경만의 최초 검사: 추가 테스트의 SessionSettingsUpdate 참조 누락으로 종료 101. 명시적 crate 경로로 수정했으며 실행 중 입력은 변경하지 않았다.
- 별도 R2 입력에서 `node scripts/check-root-resume-reasoning.cjs <frozen engine root>`: 종료 0, core 26 + protocol 4 + state 7 = 37개 통과. `baseline-root-resume-tests-r2.log`, `baseline-inputs-r2.json`. 자동 wake 3종은 대기 전 high, 수동 wake는 현재 low, 세션 기본 low 유지와 재시작 복구 요청의 high를 확인했다. 취소·완료 신호·예약 lifecycle 회귀도 통과했다.
- 다른 작업의 오류 수정 입력 `artifacts/n14a/engine`에서 `cargo check -p codex-core --lib --locked --offline` 종료 0을 재사용했다. 예약·도구 호출부·protocol/state/migration·turn context·step settings/context의 현재 8개 소유 파일이 해당 성공 입력과 바이트 일치함을 확인했다. `peer-compile-evidence.json`에 결과와 해시를 보존했다. 관련 라이브러리 통합 컴파일 제약은 해소됐으며 전체 최신 프로젝트의 실행·패키지 수용을 주장하지 않는다.
- Node 실행기 문법과 새 보존 항목 단독 manifest 검증, 변경 diff 공백 검사 종료 0. 다른 작업의 보존 항목은 이 작업에서 변경하지 않는다.

Windows fixture의 RUST_MIN_STACK=33554432, INSTA_UPDATE=no, 공유 CARGO_TARGET_DIR=engine/codex-rs/target, locked/offline 의존성을 사용했다. 초기 통합 검사 시작 2026-10-13 13:03:33 KST, R2 시작 13:41:01 KST. R2는 다른 cargo check의 package/artifact 잠금을 기다렸으며 완료 로그의 cargo profile 준비 시간은 캐시 대기를 포함해 22m07s이며 fixture 실행은 별도 약 224초이다. 겹치는 실행 시간을 합산해 전체 작업 소요로 보고하지 않는다. 입력 복사 중 Windows 긴 경로 처리를 보완하고 변경하지 않은 파일의 mtime을 보존했다.

## 정리와 인계
실패 R1 입력은 삭제했다. 최종 검증 입력과 이전 통합 입력도 삭제했으며 로그·입력 식별·검사 결과만 보존한다. 기존 공용 Cargo 캐시는 유지한다. 신규 0064 migration의 source provenance와 LF 규칙은 AF-01 설치 작업에서 명시적으로 통합 중이다. 이 작업은 source receipt 전체를 재작성하지 않는다. 변경만 분리해 작업 커밋하며 전체 Windows 빌드·설치 수용은 해당 작업과 구분한다.

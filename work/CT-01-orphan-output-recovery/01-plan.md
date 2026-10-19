상태: 완료 — 비치명적 복구 수정, Windows 검증과 생성물 보존 결정을 완료했다. 설치 앱 반영은 별도 빌드·설치 범위다.

# 짝 없는 도구 결과의 비치명적 복구

## 목표와 권한
- 세션 `01a1540c-4ee8-76e2-9fba-ff6014763213`의 `Orphan custom tool call output` panic 재발 시 세션 전체 중단을 방지한다.
- 사용자는 예방 제안 2번만 승인했다. 호출/알림 연결 수명 자체 수정, 원본 세션 재작성, 도구 재실행, 제품 전체 빌드·설치·배포는 범위에 없다.
- 공통 의미: 호출 연결을 확인할 수 없는 결과는 성공/실패 확정이 아닌 확인 필요 자료이며, 실제 동작은 이미 수행됐을 수 있다.
- 공통 코드 대상: Windows x64 MSVC, Linux x64 glibc, macOS ARM64의 로컬 엔진. 이번 실제 검증은 Windows x64로 한정하며 다른 OS·설치된 앱 수용은 별도다.

## 조사와 구현 결정
- `context_manager/normalize.rs::remove_orphan_outputs`가 호출 없는 function/custom/client tool-search 결과에 `error_or_panic`을 호출한다. debug에서는 panic, 일반 설정에서는 prompt에서 제거한다.
- `ContextManager::for_prompt_annotated`는 복제한 prompt 문맥만 정규화하므로 원본 rollout/메타데이터를 보존할 수 있다.
- 기존 ResponseItem/ContentItem과 출력 payload를 재사용해 짝 없는 결과를 일반 user 역할의 참고 메시지로 투영한다. 도구 결과에서 온 자료임과 연결·완료 상태의 확인 필요, 자동 재실행 금지를 명시한다. 원본 결과와 텍스트·미디어는 보존하고 provider에 잘못된 tool-result 쌍을 보내지 않는다.
- 도구 호출을 합성하거나 tool-search 결과를 실행 가능한 도구 선언으로 승격하지 않는다. 정상 호출/결과, 외부 이름 있는 결과 및 server 검색 결과는 유지한다.
- 기록은 기존 tracing으로 오류 종류와 개수만 남기며 원문 결과/호출 인자를 로그에 추가하지 않는다.
- 책임은 root가 코드·문서·검증·통합을 소유한다. 기존 작업 변경은 보존하며 이번 파일만 커밋한다.

## 순서와 수용 기준
1. owning 계약 `docs/architecture/reload-recovery.md`의 Interrupted tool history와 feature `engine.recovery`에 비치명적 복구를 연결한다.
2. 정규화 경계만 수정하고 기존 panic/제거 테스트를 새 계약으로 교체한다.
3. 보존·순서·미디어·반복 투영·정상 쌍 유지 테스트와 기존 중단 작업/태스크 복구 검사를 Windows에서 실행한다. debug에서도 panic이 없어야 하며 raw history는 동일해야 한다.
4. 보호된 소스와 기존 Cargo 캐시를 확인한 후 테스트에 필요한 컴파일만 수행한다. verbose 출력과 실제 exit code는 task run에 보관한다.
5. diff, 필수 검사, 생성물의 보존/정리를 검토하고 작업 변경만 커밋한다.

## 검증 결과와 실제 범위
- Windows x64 MSVC, Rust/Cargo 1.95.0, MSVC 14.51.36231, Windows SDK 10.0.26100.0, default debug test profile, jobs=4, RUST_MIN_STACK=33554432. 기존 `engine/codex-rs/target`과 독점 Cargo owner를 재사용했고 INSTA_PENDING_DIR은 run 안의 전용 경로다. 새 공유 캐시·실제 앱 프로필은 생성하지 않았다.
- `node --test scripts/test-engine-check-selection.cjs`: 25개 통과, exit 0. 로그 `artifacts/tasks/orphan-output-recovery/runs/20261019-r1/logs/check-selection.log`.
- 변경한 normalize/history_tests의 `rustfmt --check --edition 2024 --config skip_children=true`: exit 0. 로그 `artifacts/tasks/orphan-output-recovery/runs/20261019-r3/logs/format-final.log`. 안정 버전의 기존 imports_granularity 경고는 형식 실패가 아니다.
- 최종 명령 `node artifacts/tasks/orphan-output-recovery/runs/20261019-r3/run-native.cjs`: 실제 native exit 0. 실행 2026-10-19 14:40:06.269Z~14:44:18.303Z (약 4분 12초). 정규화 9개, 중단 도구의 안정적 ID·원본 보존 1개, panic 경계 2개, task 생명주기 11개로 합계 23개 통과. 각 필터의 selected-tests-v1 typeCheck·nonzero selection도 통과했다. 이 준비 컴파일은 제품 전체 빌드가 아니다.
- 원문 로그 `artifacts/tasks/orphan-output-recovery/runs/20261019-r3/logs/native.log`, 결과 `artifacts/tasks/orphan-output-recovery/runs/20261019-r3/reports/native-result.json`.
- 최종 불변 입력 `artifacts/build/ct01-r3`: 9,301개 파일, 입력 SHA-256 `3f3def0a1f30d1fb00e7fb86d649f63f755eed0e4eb5a2224023c8c5e8dda9bf`. 테스트 실행 경로 `artifacts/build/ct01`의 작업 사본도 같은 byte·mode를 사용한다. 종료 후 두 경로 각각의 9,301개 파일에서 변경·추가가 없음을 검사했고, 이번 변경 소스 3개와 주 checkout의 일치도 확인했다. `r3/reports/input-integrity.json`은 valid=true다.
- 동시 작업으로 주 checkout의 `codex-rs/prompts/templates/project-maintenance-guidance.md`가 고정 이후 바뀌었다. 이 지침 변경은 이번 검증 입력에 추가하지 않았으며 다음 빌드의 입력이다. 이번 수정 소스와 공통 Rust 실행 코드에는 고정 이후 차이가 없다.
- 다른 OS, 실제 provider, 설치된 host, 전체 codex-core/workspace와 제품 빌드·설치는 이번에 검증하지 않았다. 원본 세션·계정·설치본은 변경하지 않았다.

## 재실행 근거와 생성물 처리
- r1 관리 실행 `run-45928-1285-1792418990842693200`은 one-shot 기본 10초 제한으로 exit 124. native 검사는 끝나지 않았다. producer_completed와 실제 producer/compiler tree 종료를 확인한 뒤 정확한 token의 Cargo lease만 정상 제거했다. 원문 owner와 종료 확인은 r1/reports에 보존한다. 현재 관리 도구는 실행 시간을 전달하지 않으므로 이후 실행은 완료를 관측할 수 있는 exec_command 세션으로 같은 기존 검사 wrapper를 실행했다.
- r2는 14:12:39.922Z~14:33:57.136Z, 실제 native exit 101. typeCheck는 exit 0(512,830ms), 정규화 9개 중 8개 통과·1개 실패. 참고 메시지의 정상적인 unknown 분류를 테스트 예상값에 넣어 다른 metadata 보존과 낮은 신뢰 분류를 함께 검사하도록 고쳤다. 실패 결과는 그대로 보존한다.
- r2 종료 후 기존 9,301개 입력의 동일성을 확인하고 실패 입력을 `artifacts/build/ct01-r2`로 이동·보존했다. r3는 별도 입력 신원과 실행 산출물을 사용한다. 종료된 컴파일 경로에는 r3 입력과 동일한 사본을 준비했고, 내용이 같은 9,299개 파일의 timestamp를 보존해 Cargo 준비 캐시를 재사용했다. 형식 준비를 완료한 뒤 r3 입력을 고정했으며, 실행 중인 입력은 수정하지 않았다. 이동·입력·준비 근거는 r3/reports에 있다.
- 작업용 임시 관리 bundle은 제거했고 기존 40개 bundle의 의미를 유지했다. project-maintenance.json은 다른 작업의 변경이 있어 이번 커밋에서 제외한다. recovery wrapper의 기존 runCargoTest 변경도 다른 작업 소유이며 이번 normalize 필터 변경만 포함한다.
- 생성물 owner는 `CT-01-orphan-output-recovery`, lifecycle은 `CT-01-orphan-output-r1`이다. 구성은 `artifacts/build/ct01`, `ct01-r2`, `ct01-r3`와 `artifacts/tasks/orphan-output-recovery/runs/20261019-r1`, `r2`, `r3`다. 검증 로그·이전 실패·정확한 혼합 작업 입력의 provenance를 보존하도록 전체 묶음에 defer를 적용한다. 재검토 조건은 해당 입력을 정확히 재구성할 수 있고 동일 수정의 배포 검증 자료로 인계가 끝난 뒤다. 자동 삭제하지 않는다.
- 관리 도구 등록·review 후 전체 6개 항목의 defer를 적용했다. group_status=deferred, aborted=false, 모든 항목의 remaining=true를 확인했다. 보존 자료와 commit.index는 작업 전용 묶음에 남긴다. 커밋 제어 자료가 갱신되므로 향후 삭제 전에는 현재 신원으로 전체 묶음을 재등록·재검토한다.
- 이번 작업의 6개 파일만 별도 Git index에서 커밋하며 다른 작업의 staged/unstaged 변경을 보존한다. 커밋 식별자는 Git 기록과 대화의 최종 응답에서 확인한다.

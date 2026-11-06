상태: 소스 반영·목표 native 27개·도구 등록 native 66개·제공자 변환 3개 통과. 사용 종료 임시 산출물 정리와 실제 부재 확인 완료.

# Legacy Codex 도구의 검색 전용 노출

## 목표와 권한

`create_goal`, `get_goal`, `update_goal`, `request_user_input`, 기존 `clock.sleep`을 `legacy_codex_tools` namespace로 묶고 초기 상세 도구 목록에서 제외한다. `reate_goal`은 `create_goal`의 오기로 해석했다. 검색 이후 필요한 입력 스키마와 실행 의미는 보존한다. 제품 빌드·설치·배포는 범위 밖이다.

## 범위와 구현

공통 의미는 로컬 Windows x64·glibc Linux x64·macOS ARM64에 적용한다. 실제 검증 환경은 Windows x64이며 다른 OS 실행은 검증하지 않는다. 기존 `ToolSpec::Namespace`와 `ToolExposure::DeferredModelOnly`를 재사용한다. namespace 설명은 짧게 유지한다. 기존 실행 권한, 목표 상태, 질문 모드 제한, sleep 취소 의미를 보존한다. `clock.curr_time`, 비동기 질문과 `update_plan`은 변경하지 않는다.

코드 담당 `legacy_tools`: 관련 executor·spec·등록 및 좁은 기존 검사. root: owning 문서·보존 inventory 연결, 최종 검증·정리·작업 커밋 검토. 공유 작업 폴더의 기존 변경을 보존한다. 설계 owner는 `docs/architecture/model-harness-profiles.md`다.

## 검증과 완료 조건

초기 모델·Code Mode 목록에 다섯 도구의 상세 정의가 없고, 검색 결과에는 새 namespace와 올바른 스키마가 나타나며 실행 라우팅이 같은 이름을 사용해야 한다. 관련 기존 검사를 우선 재사용한다. 단순 소스 문자열 확인과 실제 native 실행을 구분한다. 생성물이 필요한 검사 전에 소유 경로·수명을 등록하고 종료·검토 후 기존 owner로 정리한다. 전체 엔진 빌드와 설치본 수용은 주장하지 않는다. 기존 변경과 분리 가능한 작업만 commit하며 불가능하면 이유를 기록한다.

## 실행 결과

`codex-tools`의 짧은 namespace spec helper와 `DeferredModelOnly`를 사용한다. 목표·질문·sleep의 runtime identity와 spec을 함께 변경했다. 목표 상태 처리와 기존 질문 모드 제한을 유지하고, 기존 serialized `clock.sleep` item 종류는 보존했다. 검색은 기존의 namespace child 단위 동작이며 전체 namespace를 강제 로딩하는 새 시스템은 추가하지 않았다.

기존 검사에서 이전 tool identity를 직접 호출하던 부분을 새 namespace로 이관했다. 구현·단위 검사 Rust 14개와 관련 통합 fixture 25개의 artifact-free `rustfmt --emit stdout` 구문 분석 exit 0. 관련 범위의 이전 runtime/direct invocation constructor 검색은 0건이다. 이는 Rust 타입 검사나 native 실행 통과를 의미하지 않는다.

`node --test --test-reporter=spec providers/opencodex/tests/harness-mapping.test.mjs`: 3개 통과, 실제 exit 0. 기존 제공자 변환에서 namespace-aware 이름·스키마·호출 복원과 현재 catalog 권한 경계를 검증한다. 변경한 Rust registration 자체의 native 검증과는 구분한다. CRLF-aware 작업 관련 `git diff --check` exit 0. 보존 inventory에 관련 구현과 기존 검사 owner 경로를 연결했다.

native 검사: 기존 `cargo-verification.cjs::runCargoTest`로 `codex-goal-extension --test goal_extension_backend --locked --offline -- --test-threads=1`을 실행했다. 27개 모두 통과, 실제 Cargo exit 0, nonzero actual execution gate accepted다. Windows MSVC Rust/Cargo 1.95.0에서 변경한 목표 확장과 의존하는 엔진 본체를 실제 컴파일했다. 2026-11-03 20:09:47~20:20:22 KST, 컴파일·실행 총 639.756초, libtest 실행 52.15초였다. 재시도는 없었다. owner token `6cdfe29c-6472-45b6-92b5-36a531cbbda4`의 terminal success를 확인했다.

같은 물리 Cargo cache를 재사용하여 `codex-core --lib tools::spec_plan::tests --locked --offline -- --test-threads=1`을 순차 실행했다. 질문·sleep의 초기 노출과 등록을 포함하는 기존 검사다. 아래에 첫 실패와 수정 후 결과를 구분했다. 전체 엔진 테스트·설치본 수용이나 타 플랫폼 실행으로 확대 해석하지 않는다.

소스·문서가 deliverable이다. 계획 할당에 사용한 임시 본문 파일은 일반 삭제 후 실제 부재를 확인했다. 코드 담당자의 구문 검사는 산출물을 만들지 않았다. 제품 빌드·설치·배포는 하지 않았다. 기존 대규모 미커밋 변경과 겹치는 소스·보존 inventory·owning 문서를 통째로 stage하지 않는다. native 검증 결과와 변경 분리를 확인하기 전 작업 커밋을 완료했다고 보고하지 않는다.

## 등록 검사 수정과 재시도

첫 core 등록 검사: 71개 중 59 통과·12 실패, Cargo 실제 exit 101. 직접 관련된 7개 실패는 ToolName 표시 방식, CodeModeOnly 시간 도구 노출, 새 deferred builtin을 포함하게 된 검색 fixture 격리 문제였다. 기존 assertion 의미와 제품 동작을 보존하며 기대값·fixture만 수정했다. 나머지 5개는 기존 협업 namespace 변경과 관련되어 수정하지 않았다.

첫 검사 종료 기록의 catalog 관측 충돌은 실제 synchronous terminal 실패(101)를 보존한 채 `cargo-target-owner.finishTargetOwner`로 재처리했다. 정확한 token `d49753cf-0da5-494b-abf2-b998b36f5040`·phase·exit를 확인했고 supported 종료 처리 exit 0, 대상 lease 실제 부재를 확인했다. 실패 결과를 성공으로 바꾸거나 raw registry를 수정하지 않았다.

동일 core 등록 검사에서 관련 없는 기존 실패 5개를 명시적으로 --skip하여 재실행했다. 66개 모두 통과, Cargo exit 0, selected-tests-v2 actual execution gate accepted. 2026-11-03 20:43:49~20:50:25 KST, 컴파일·실행 397.820초, libtest 실행 199.27초. owner token `ca8c27e6-1c98-4f5f-8f4a-f1ce501dc447` terminal success와 lease 부재를 확인했다. 원래 전체 검사 실패 기록은 유지한다.

기존 다른 작업의 협업 namespace 변경과 맞물린 테스트·등록 파일 및 문서·inventory에 사전 변경이 있어 현재 작업만의 task commit은 만들지 않았다. 통합 fixture 25개는 구문 검사까지이며 별도 통합 실행·설치본 수용·다른 OS 실행은 확인하지 않았다. 전체 등록 검사가 통과했다고 주장하지 않는다.

## 정리

검사 owner 종료 후 shared cargo-pending 출력은 0바이트의 빈 디렉터리이며 참조·보호·활성 producer가 없음을 확인했다. 현재 설치된 고정 maintenance owner identity를 검증하고 producer register→fresh review→명시적 delete apply를 실행했다. apply exit 0, remaining false, 실제 경로 부재, producer finalize 상태 finalized·remaining/reference/blocker 없음까지 확인했다. 원본 전송 파일은 stdin을 사용해 만들지 않았다. 기존 공유 Cargo cache는 이번 작업에서 새로 만든 일회용 산출물이 아니며 기존 소유·소비 절차를 유지했다. 최소 terminal evidence와 native 정리 영수증은 기존 관리 소유자가 참조하는 보호 근거로 유지한다.


상태: 구현 및 재현 검증 중. 기존 승인 범위 안에서 두 API 컨텍스트 문제를 해결한다.

목표: API 모델 요청에서 동일 스킬의 중복 목록과 없는 functions.exec 안내를 제거하고, 실서버 요청/도구 왕복으로 재현과 해결을 확인한다.
권한: 코드·관련 설계/검사 수정, 테스트용 컴파일과 Windows 격리 시험. 전체 앱 배포·일반 프로필 설치·버전 증가·다른 화면 오류 수정은 제외한다.
계약: API 모델에만 적용한다. 스킬은 동일 이름·메타데이터·전체 본문인 복사본만 표시를 합치고 기존 순서와 명시적 로드/다른 본문을 보존한다. 도구 지침은 harness 소유 텍스트만 실제 direct tool 방식으로 투영하며 사용자/프로젝트 지침과 비API 요청·원본 기록을 보존한다.
책임/순서: root가 요구사항, API 지침 수정, 테스트 환경/고정 입력, 통합·실서버 재현을 소유. api_skill_dedup은 ext/skills의 API host catalog 표시와 관련 검사를 소유. api_instruction_route는 기존 native 지침 경계의 읽기 조사만 수행. 각 worker는 재위임/커밋/무거운 Cargo 실행 권한 없음.
검증: 수정 전 로그(01-plan)와 현재 소스 최소 재현 → 집중 검사에서 실패 확인 → 수정/같은 검사 반복 → Windows 설치 확장 격리에서 API outbound 시스템 지침/스킬과 도구 결과 확인. 공통 도구·user text·서로 다른 스킬 버전 보존 검사 포함. 실제 배포/다른 OS 수용과 구분한다.
현재 자원: 다른 작업 Cargo 검사(39328)가 실행 중이므로 같은 cache 무거운 빌드를 중복 실행하지 않는다. helper/fixture/문서 준비는 독립 진행한다. 입력 고정 후 영향을 받는 crate/test용 실행파일만 컴파일한다.
산출물: 코드·회귀 검사·API context owning architecture·기존 feature inventory 연결, 키 없는 로그와 최신 계획, task commit. 임시 프로필/스크립트는 종료 후 일반 삭제하며 사용자 updater와 잠긴 기존 소형 로그는 보존한다.

진행 결과(2026-10-13): baseline 보존 로그로 중복 스킬 8종과 functions.exec 안내 4곳을 재현했다. prompts API 집중 5개와 동일 컴파일 binary의 전체 54개 검사가 종료 0이다. configured role provenance를 별도 타입으로 구분해 원문을 보존한다. skills/core와 test-only app-server는 동일 고정 입력에서 직렬 실행 중이다.

고정 입력: artifacts/verification/AK-02-api-context-fix/input/engine, 10,749파일, SHA-256 3af3805db89ae71e81801c1740822bf2d88fce3261828d9437d9ffa9badb5e51. 원본 CRLF 규칙을 checkout에 복원한 6개 파일은 frozen input과 줄바꿈 정규화 후 내용이 같음을 line-ending-provenance.json으로 확인했다. 로그 owner는 artifacts/logs/AK-02-api-context-fix다. 첫 prompts 컴파일 4분 1초 및 두 번째 focused 실행 14.35초. skills 시작 때 다른 Cargo 검사 때문에 cache lock 대기가 발생했다.

통합 기록: session의 API base 지침과 harness fingerprint를 같은 투영으로 맞추고, 요청 복사본의 typed role/usage hint를 투영한다. catalog는 전체 메타데이터/본문이 같은 host 복사본만 prompt_visible=false로 변경한다. 일반 provider/명시적 읽기/다른 본문/사용자 suffix를 보존한다. architecture와 feature inventory에 native 검사 owner를 연결했다. 공유 템플릿 자체는 변경하지 않았다.

커밋 경계: session/mod.rs, step_context.rs와 prompts 파일에는 앞선 harness-profile 작업의 미커밋 변경이 겹친다. 그 작업의 지침 구성 함수가 이번 API 연결부의 선행 조건이다. unrelated staged 파일과 변경을 포함한 커밋을 만들지 않으며, 분리 가능성은 최종 diff에서 다시 판단한다.

재현 반복 1: skills 검사 종료 101(05:22:49Z→05:53:41Z). analytics/src/client.rs:926 Turn 생성에 parent_turn_id/turn_trigger 누락(E0063)으로 새 검사 코드 이전에 실패했다. 최신 작업 파일에는 해당 보완이 이미 존재하므로 제품 파일을 중복 수정하지 않았다. 기존 입력을 input-01/engine으로 보존하고 같은 논리 입력에 analytics 변환 파일만 교체한 generation 2를 만든다. 새 경로 복제로 모든 Rust 의존성을 다시 컴파일하지 않도록 실행 경로를 유지하고, 동일 파일의 원래 수정 시각을 복원한다. 최초 완료 모니터는 외부 process의 ExitCode가 null이어서 실패 신호를 냈다. 실제 tool session 종료 101을 확인했고, generation 2 producer가 직접 실제 native 종료 코드와 signal을 기록하도록 개선했다.

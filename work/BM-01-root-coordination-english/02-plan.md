상태: 완료 — 발견된 한국어 지침의 영어 번역, 설치본 동기화와 Windows 문서·라이브러리 검증을 마쳤다. 기존 staged 변경과 겹쳐 커밋은 보류했다.

## 범위와 권한

사용자는 앞서 발견한 한국어 지침 전체의 영어 재작성을 승인했다. 스킬 3개, 관련 참조 4개, 프로젝트 AGENTS와 문서 진입점 및 한국어 playbook을 다룬다. 공통 지침으로 Windows/Linux/macOS에 적용되며 제품 동작·권한·지원 범위를 바꾸지 않는다. 한국어 사용자 입력 트리거와 실제 경로, 호환 링크 식별자는 기능 보존을 위해 유지할 수 있다. 오류 안내·테스트 데이터·과거 작업 기록 번역은 범위 밖이다.

## 실행과 소유권

스킬 본문과 team-lead 참조는 translate_skills, 프로젝트 playbook과 bootstrap app-logging 사본은 translate_playbooks, build-inputs/delegation 참조와 관련 위임 예시는 translate_references가 맡았다. root는 artifact 참조, AGENTS·문서 진입점, 설치본 동기화·receipt·통합 검증을 담당했다. 세 담당자는 모두 완료했으며 추가 위임은 하지 않았다.

저장소에는 이번 작업 전부터 동일 파일의 staged 변경이 있다. 이를 보존하고 관련 없는 변경을 커밋하지 않는다. 번역과 기존 변경을 안전하게 분리할 수 없으면 커밋 보류 사유를 명시한다.

## 검증과 정리

항목·의미 보존, 한국어 잔존 사유, 기존 링크 anchor 호환, 원본·설치본 일치와 receipt hash를 확인한다. `python -B scripts/import-instructions.py --check` 및 관련 기존 지침 검사를 Windows에서 실행한다. 빌드·배포·모델 행동 평가는 수행하지 않는다. 작업 입력 임시 파일은 삭제하고 실행 로그는 이번 계획의 근거로 보존한다. 아키텍처 계약은 번역으로 변경되지 않는다.

## 결과

- 문서 15개와 `SKILLS-SOURCE.json`을 갱신했다. 스킬 원본·설치본 8개 파일의 바이트를 맞추고 original/copied 크기·SHA-256을 갱신했다. 설치본은 변경 직전 기존 receipt와 일치함을 먼저 확인했다. 파일 경로 목록이 유지되어 component mapping 변경은 필요하지 않았다.
- 각 담당자의 Windows 텍스트 검증 종료 코드 0: 절·항목·fence 수, 코드 식별자·링크 목적지·요구사항 의미 보존을 확인했다. 호환용 한국어 앵커를 유지했고 root는 대상 문서의 로컬 fragment 링크 26개 연결을 확인했다. 예시 경로 자리표시자는 `<name>`, `<absolute-path>`, `<32-lowercase-hex-digits>`로 번역했다. 한국어 사용자 입력 트리거·실제 경로·호환 링크 ID만 유지한다.
- `python -B scripts/import-instructions.py --check`: 종료 코드 0, 24개 skill 파일·10개 component·57개 로컬 문서 링크와 과거 provenance 일치. [로그](library-verification.log).
- 스킬 4개에 `python -X utf8 -B .../skill-creator/scripts/quick_validate.py`: 모두 종료 코드 0. 첫 실행은 Windows cp949 디코딩으로 실패해 UTF-8 모드로 재실행했다. [로그](skill-validation.log).
- 공통 지침·instruction-library·instruction-package·instruction-module-packaging 기존 Node 검사: 53개 중 52개 통과, 실패 0, 실제 릴리스 생성물 의존 검사 1개 건너뜀, 종료 코드 0, 검사 실행 시간 35.77초. [로그](english-instructions-tests.log). 릴리스 생성·앱 빌드 없이 수행했다.
- 한국어 본문 잔존·원본/설치본 동일성·fragment 링크 검사 종료 코드 0. [로그](prose-and-links.log). `git diff --check`도 통과했다. receipt 저장 시 생긴 CRLF는 LF로 정리 후 재확인했다.
- 임시 계획 입력 파일은 일반 삭제했다. 검증 로그는 이번 작업 근거로 보존한다. 빌드·설치·실제 모델 행동 평가는 수행하지 않았고, 현재 대화에 이미 주입된 설명은 소급 교체되지 않는다.
- 이번 번역 파일 중 여러 개에 작업 이전 staged 변경이 있으며 전체 파일을 커밋하면 다른 작업까지 섞인다. 기존 index를 보존하고 이번 변경은 작업 트리에 남겼다. 커밋은 기존 작업의 소유자가 변경을 통합한 뒤 수행해야 한다.

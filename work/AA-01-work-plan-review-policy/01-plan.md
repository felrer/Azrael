상태: 완료 — 지침·활성 설치본 수정과 Windows 문서 검증 완료.

# 요구사항·현재 설계와의 관계

작업을 요청받으면 관련 architecture 설계와 현재 구현을 사전 조사하고 계획 필요성을 판단한다. 명시된 설계와 다른 동작·구조·계약을 구현해야 한다면 사용자 검토 대상으로 삼아 관련 구현 전에 검토받는다. 이미 사용자가 승인한 변경은 재확인하지 않는다. 설계에 맞는 작고 명확한 작업은 직접 implementation으로 처리한다.

이해 통일에 필요한 문제·목표·요구사항·범위·현재 설계 대비 차이·추천안과 영향·미결 사항·성공 기준·검증을 작업 계획 하나에 포함한다. 별도 요구사항/이해 통일 문서와 사전 계획을 필수 단계로 만들지 않는다. architecture는 지속적인 설계의 소유자로 유지하고 승인된 내용을 기존 담당 절에 반영한다.

계획 검토 전에 변경 경로와 재사용 가능성을 조사하여 합리적으로 발견 가능한 결정을 묶는다. 실행 중 새 정보로 생긴 검토는 변경분에 한정한다. 모든 미결 사항을 사전에 발견했다고 보장하지 않는다.

# 범위·담당·검증

root가 instructions/의 development-workflow, design-collaboration, design-documentation, implementation 스킬과 연관 참조·공통 진입 지침·예시, 프로젝트 Work 안내를 수정한다. 활성 설치본도 동기화하고 SKILLS-SOURCE.json의 바이트 증거를 갱신한다. 파일 매핑은 경로 변동이 없으면 유지하고 실제 manifest 검사로 확인한다. 프로젝트의 기존 architecture·engine·UI·feature inventory 변경은 보존한다. 앱 코드·빌드·설치는 이번 작업에 포함하지 않는다.

문서 정책은 공통이며 실제 파일·설치 확인 환경은 Windows다. 배포본 또는 다른 호스트의 적용을 주장하지 않는다. 검증은 각 스킬 frontmatter 검사, 유지 라이브러리·링크·manifest 검사, 활성 설치본 일치 확인과 세 사례의 정책 검토(설계 준수 작은 수정/설계 변경/실행 중 새 차이)다. 모델 행동의 실제 실행 검증과 구분한다.

# 결과

development-workflow에 계획 필요성 판단과 architecture 차이의 사전 검토 조건을 추가했다. 작업 계획이 이해 통일·요구사항·설계 차이·실행·수용을 함께 담도록 했고, design-collaboration·design-documentation·implementation의 역할을 맞췄다. 지속적인 설계 문서는 기존 소유 위치를 유지한다. 사전 조사로 발견 가능한 관련 선택은 계획 검토 때 함께 다루고 실행 중 새 차이는 영향받는 구현을 멈춰 변경분만 검토한다.

유지 라이브러리의 공통 진입 지침·예시·프로젝트 Work 안내·작업 문서 안내도 반영했다. 스킬 리소스 5개는 활성 설치본과 바이트가 같다. 설치된 전역 AGENTS.md의 별도 기존 내용은 보존하고 새 검토 진입 규칙 한 줄만 추가했다. SKILLS-SOURCE.json의 변경 파일 크기·해시를 갱신했으며 기존 파일 매핑은 검사로 확인했다.

Windows 검증 결과:

- `python -X utf8 .../skill-creator/scripts/quick_validate.py <skill>`: 수정된 스킬 4개 모두 통과, exit 0. [로그](../../artifacts/logs/work-plan-review-policy/skill-validation-final.log). 기본 cp949로 실행한 검사 실패는 UTF-8 실행 옵션으로 해결했으며 시스템 validator는 수정하지 않았다.
- `python -B scripts/import-instructions.py --check`: 스킬 파일 21개·컴포넌트 10개·문서 링크 47개 통과, exit 0. [로그](../../artifacts/logs/work-plan-review-policy/library-check-final.log).
- 활성 설치본 일치 검사: 스킬 리소스 5개 일치 및 전역 검토 규칙 1회 반영 확인, exit 0. [로그](../../artifacts/logs/work-plan-review-policy/installed-check.log).
- 이번 작업 파일의 `git diff --check` 통과. 임시 plan-body.md 삭제 확인.

정책 사례 검토: 설계에 부합하는 작고 명확한 수정은 직접 implementation, 명시된 설계와 다른 짧은 수정은 계획 및 관련 구현 전 사용자 검토, 실행 중 발견한 승인되지 않은 차이는 같은 계획의 변경분 검토로 연결된다. 이미 승인한 차이는 재확인하지 않는다. 이는 문서 정책의 일관성 검토이며 실제 모델 행동을 실행해 검증했다는 의미가 아니다. 앱·다른 호스트의 적용은 이번 검증 범위에 포함하지 않았다.

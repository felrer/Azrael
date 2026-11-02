상태: 완료 — 두 언어에 Profile·Team 기능 설명을 추가하고 본문 보존·링크 검증을 마쳤다.

# README 기타: Profile과 Team

- 요청·권한: 기존 구성을 유지하면서 `3. 기타`와 `a. Profile과 Team`을 추가한다. 한국어를 기준으로 영어도 함께 수정하고, 목차에는 새 항목만 연결한다. 전체 목차 재편은 후속 작업이다.
- 설계 근거: docs/architecture/instructions.md의 Package development workbench·Profile composer·Role profiles와 docs/architecture/work-orchestration.md의 Team과 Direct. 작업 환경용 Profile과 Team 역할 프로필을 구분하고 저장·복제·활성화·Team 복사본의 독립성을 설명한다. 문서의 partial 상태와 실제 엔진·설치 수용 경계를 짧게 남긴다.
- 범위: README 두 파일과 이 기록. 제품 동작·지침·아키텍처는 변경하지 않는다. 플랫폼 공통 기능 소개이며 실제 검증은 Windows에서의 문서 확인뿐이다.
- 검증: 기존 본문 보존, 두 언어 의미 대응, 새 목차 앵커와 문서 링크, git diff --check. 제품 빌드·실행 테스트와 새 영구 테스트는 필요하지 않다.
- 정리: 계획 할당용 입력은 즉시 일반 삭제하고 부재 확인. 추가 임시 산출물 없이 승인된 변경만 작업별 커밋한다.

## 결과

- 두 언어에 `3. 기타`와 `a. Profile과 Team`을 추가했다. Profile 구성·저장·프로젝트 활성화와 Team 역할 구성·독립 복사본·변경 적용 시점·재개를 설명했다. 소스 구현과 엔진·전체 스케줄러·설치본 수용 경계를 구분했다.
- Python 메모리 검사 exit 0: 새 절과 목차 두 항목을 제외한 기존 본문이 HEAD와 일치한다. 각 언어의 목차 링크 20개와 새 설계 문서 링크가 유효하다. `git diff --check` exit 0.
- 제품 동작을 바꾸지 않아 빌드·실행 테스트는 수행하지 않았다. 새 임시 산출물은 만들지 않았으며, 기존 작업 기록을 이어 사용했다. 다른 작업의 변경은 포함하지 않는다.

상태: 수정 및 검증 완료 — 사용자 추가 조치 없음. 빌드·설치 및 실제 모델 응답 검증은 수행하지 않음.

# 공통 프롬프트의 직접 조사와 수정 권한 명확화

## 승인된 범위와 계획
- Objectivity의 짧은 조사 문장을 삭제하고 다음 문단에 승인된 조사·확인 지침을 추가한다. 사실 확인 질문과 사용자 결정·권한 요청을 구분한다.
- 런타임 문구는 질문·검토·조사 요청과 명시적 수정 요청/요구사항 승인을 구분한다.
- 유지관리 원본/엔진 내장본과 기존 아키텍처 설명을 함께 맞춘다. 빌드·설치·배포는 범위 밖이다.
- 기존 common-instructions 검사 및 변경 범위 검토 후 작업 단위 커밋한다. 기존 다른 변경과 staged 내용을 보존한다.

## 검증과 정리
- 플랫폼 공통: Windows x64, Linux x64, macOS ARM64. 실제 확인은 Windows 호스트에서 원본/내장본 일치 및 provider 전달 검사로 한정한다.
- feature ID: engine.model-harness-profiles.guidance. scripts/test-common-agent-instructions.cjs를 재사용한다. 기존 preservation 연결은 변경하지 않는다.
- 실제 모델 응답 변화나 설치된 바이너리 반영은 이 검사로 입증하지 않는다.
- 임시 테스트는 만들지 않았다. 임시 계획 입력 work/.investigation-prompt-plan-body.md는 할당 직후 삭제하고 부재를 확인했다. 정리 대상 잔여물 없음.

## 결과
- common-instructions: 5개 통과, 실패/건너뜀 0, 실제 종료 코드 0. 실행 전후 입력 무결성 valid.
- run_id: run-54328-3450-1793079445832938300.
- 로그: tool-call:exec-0250ba68-f71b-4f6b-8582-d0eec1b8da25:step-d186df7e75cda97e88a577f57f2918855aa2a6341ec0e8ddf49c3443b9f8915d.
- git diff --check: 종료 코드 0.
- 최초 python 명령은 PATH에 없어 실행 전 실패했다. 설치된 Python313 경로로 계획 할당을 완료했다. 파이프 인코딩으로 손상된 계획 본문은 UTF-8 패치로 복구했다.

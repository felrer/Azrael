상태: 지침 원본·설치 사본 반영 및 라이브러리 검증 완료. 사용자 추가 조치 불필요.

# 삭제 실패 시 archive 이동 지침

요청과 권한: 사용자가 삭제되지 않는 파일을 archive로 옮기는 지침 추가를 요청했다. 유지 지침·관련 예제·현재 설치 사본을 수정하고 검증한다.
범위: 모든 지원 플랫폼의 공통 정리 정책. 실제 파일·설치 검증은 Windows x64이며 제품 동작·빌드·설치는 변경하지 않는다.
설계: 일반 삭제 실패 시 소유권·참조·보호 상태가 확인된 작업 임시 자료를 프로젝트 archive/<작업별 고유 경로>/로 이동한다. 기존 목적지를 덮어쓰지 않고 이동 전후 무결성·원본 부재를 확인하며 실패 이유·정확한 경로·재검토 조건을 기록한다. 이 지침을 해당 보관에 대한 상시 승인으로 사용한다. 잠금·활성 참조·소유권 불명·보호/이동 금지는 우회하지 않으며 이동도 불가하면 기존 보존 승인 절차를 따른다.
순서: 기존 정리 계약 수정 → 원본/설치 및 bootstrap 예제 정합성 유지 → provenance 해시 갱신 → 라이브러리 검증 → 변경만 커밋.
검증: 기존 library --check, 변경 사본 일치 및 diff 검사. 새 동작 코드는 없으므로 제품 빌드·회귀 실행은 불필요하다.
정리: 계획 할당용 work/.archive-policy-body.md는 할당 직후 일반 삭제하고 부재를 확인했다. 검증은 bytecode 생성 없이 실행했으며 임시 테스트·빌드 결과나 새 archive 항목은 만들지 않았다.

결과: 공통 AGENTS 원본·현재 설치 AGENTS·프로젝트 AGENTS, implementation 본문과 artifact/build 참조, bootstrap playbook 원본·설치 사본·현재 프로젝트 playbook, 위임 예제를 일치시켰다. 기존 보호 규칙을 유지하고 archive 이동을 상시 승인으로 명시했다. 기존 파일 경로와 component mappings는 바꾸지 않았고 SKILLS-SOURCE.json의 변경 파일 해시·크기를 갱신했다. 역사적 원본 provenance는 보존했다.
검증: Windows x64에서 `python -B scripts/import-instructions.py --check` exit 0. 62개 skill 파일, 12개 component, 82개 로컬 링크와 historical provenance 검사 통과. 변경된 skill 파일 4개와 설치 사본의 바이트 일치, 공통 archive 지침의 원본·설치 일치, scoped diff 검사 통과. 문서 정책 변경이므로 제품 빌드·설치는 하지 않았으며 새 대화에서의 모델 판단 자동 적용까지 검증했다고 주장하지 않는다.

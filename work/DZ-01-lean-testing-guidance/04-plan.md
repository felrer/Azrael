상태: 완료 — 승인된 testing 스킬을 정식화하고 중복 기준을 참조로 전환했다. 검증·정리 결과는 아래에 기록하며 추가 사용자 결정은 없다.

# testing 소유권 통합

## 요구·범위·결정

- 사용자가 03-plan의 testing 초안을 그대로 승인하고 다른 지침의 중복 내용을 제거한 뒤 testing을 참조하도록 요청했다. 추가 검토 대기 없이 실행한다.
- 영문 초안을 유지된 `instructions/skills/testing/SKILL.md`로 옮기고 활성 설치에 연결한다. 한국어 직역본은 검토 산출물로 유지하고 원문 위치를 갱신한다.
- 공통 테스트 선택·추가·작성·실행·유지·폐기는 testing이 소유한다. implementation은 전체 검증과 완료·정리를, Build는 고정 입력·캐시·실행 선행조건·Azrael 전용 검사 선택과 패키지 검증을 계속 소유한다. 테스트 정리 playbook은 Azrael의 보존 매핑과 소스·산출물 변경 절차만 남긴다.
- 위임 예시와 공통 에이전트 지침의 중복 본문도 참조로 바꾸고 유지·임베드 사본을 일치시킨다. 스킬 목록·기본 구성·설치·출처 메타데이터와 문서 경로를 함께 갱신한다. 실제 제품 테스트 소스·runner·검사 선택 동작은 바꾸지 않는다.
- 공통 정책은 Windows·Linux·macOS에 적용한다. 이번 실제 검증 환경은 Windows x64이며 제품 빌드·설치·다른 OS의 수락 검증은 포함하지 않는다.

## 실행과 소유권

- 루트가 직접 처리한다. 이미 승인된 원문을 옮긴 뒤 참조를 연결하고 설치·배포 메타데이터를 갱신한다. 원문 변경이 필요하면 기존 계약을 보존하는 최소 경로 수정만 한다.
- `docs/playbooks/build.md`에는 다른 작업의 pinned asset 선택 변경이 이미 있다. 그 내용을 보존하고 이 작업의 독립된 변경만 stage·commit한다. 나머지 기존 변경과 staged 소스도 보존한다.
- 새로운 testing 기본 구성요소는 해당 지침을 참조하는 implementation과 함께 설치한다. 기존 implementation 설치는 유지 소스의 junction이므로 별도 덮어쓰기하지 않는다. 새 testing 대상이 존재하면 실제 정체성과 내용을 확인한 후 안전하게 통합한다.

## 검증과 정리

- skill-creator quick_validate, 유지 라이브러리의 기존 `import-instructions.py --check`, 공통 지침 전달·동일성 검사와 변경된 배포 경로에 해당하는 기존 검사를 사용한다. 링크·앵커·원문 이동 후 바이트와 활성 경로를 확인한다.
- 문서의 존재나 문구만 확인하는 새 테스트는 만들지 않는다. 검증 기록은 이 계획에 모으고 문구·형식 통과가 모델 행동 개선의 증거라고 주장하지 않는다.
- 임시 계획 입력은 배정 직후 일반 삭제하고 실제 부재를 확인한다. 기존 검사에서 생기는 일회용 자료는 해당 owner의 절차로 정리하고 남은 항목이 있으면 해결 전 완료를 주장하지 않는다.
- 최종 diff와 staged 범위를 확인하여 이 작업만 커밋한다. 원격 push·제품 빌드·설치는 하지 않는다. 활성 스킬 등록은 요청된 지침 설치에 한한다.

## 결과와 검증

- [testing](../../instructions/skills/testing/SKILL.md)을 기본 구성요소로 등록했다. 승인된 초안과 바이트가 같으며 SHA-256은 `3371f09183ce7abb3c14583a1b76c0805006798d23ed12c05965e783bb57314a`다. 기존 work의 영어 사본은 이동해 중복 활성 원문을 남기지 않았고 한국어 직역본의 링크를 갱신했다.
- implementation §7은 testing 참조와 전체 검증·비테스트 증거·실험 평가 책임만 유지한다. 테스트 정리 playbook은 공통 판단표·추가·실행 기준을 제거하고 Azrael의 보존 매핑·검사 선택 owner·소스와 산출물 변경 절차를 유지한다. Work·Build·playbooks router·위임 예시·공통 에이전트 지침과 엔진 임베드 사본도 같은 소유권을 참조한다.
- 새 프로젝트에 공통 테스트 본문이 다시 복제되지 않도록 project-bootstrap과 두 템플릿에도 testing 경로를 연결했다. 해당 세 파일과 implementation의 현재 출처 측정치를 갱신하고 원래 측정치는 보존했다. 기본 스킬은 여섯 개, 공개 스킬은 여덟 개이며 배포 구성요소는 13개다.
- 활성 `C:/Users/felre/.azrael-ex/skills/testing` junction을 정식 유지 소스로 연결하고 전역 `AGENTS.md`의 testing 라우팅과 기본 스킬 수를 갱신했다. testing·implementation 설치의 동일 파일 정체성을 확인했으며 project-bootstrap도 유지 소스를 가리키는 기존 junction을 사용한다. 기존 설치 설정은 보존했다.
- Windows x64에서 기존 `quick_validate.py`로 testing·implementation·project-bootstrap을 검사했다. 모두 exit 0이었다. `python -B -X utf8 scripts/import-instructions.py --check`도 exit 0: 스킬 파일 63개·구성요소 13개·라이브러리 내부 링크 87개, 역사 출처 digest 보존.
- `node --test scripts/test-common-agent-instructions.cjs`는 exit 0, 5건 통과·실패/skip 0건이었다. 유지·임베드 동일성과 실제 provider mapping을 통한 공통 지침 전달을 확인했다. 제품 빌드·설치·다른 OS 검증 또는 실제 모델의 테스트 생성 행동 개선을 검증한 것은 아니다.
- 변경된 owner 문서와 검토 문서의 로컬 링크·앵커 120개를 읽기 전용으로 확인했다(exit 0). 이후 bootstrap의 추가 링크는 라이브러리 검사로 확인했다. 승인된 영어 원문과 이동 후 바이트 동일성, 활성 설치 연결, 기존 draft 디렉터리 부재도 확인했다.
- 새 제품 테스트나 검증 스크립트·실행 로그·패키지를 만들지 않았다. 임시 계획 입력은 일반 삭제한 뒤 부재를 확인했다. Git의 독립 임시 index `.git/index-testing-guidance-20261027`로 Build의 두 해당 변경만 선택하고, 기존 pinned asset 변경과 네 개의 staged 소스 파일을 보존한다. index는 커밋·실제 index 재조정 후 일반 삭제하고 부재와 기존 staged blob을 확인한다. 작업 커밋 식별자는 최종 보고에 제시한다.

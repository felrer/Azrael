상태: 완료. Windows 설치에서 역할 삭제 및 지침·배포 목록 검증 완료.

목표: 현재 Azrael 설치에서 devin_swe2_medium을 제거하고 유지되는 위임 지침·예시를 정리한다.
범위: 역할 제거는 플랫폼 공통 정책이며 실제 설치 적용과 검증은 Windows에서 수행한다. Devin provider와 격리된 검증 fixture는 유지한다.
근거: 현재 instructions/azrael-environment.json은 Luna/Sol 역할만 배포하며 scripts/azrael-codex-environment.json의 역할 목록은 비어 있다. 삭제할 역할은 현재 .azrael-ex/agents에 남은 설치 파일이다.
실행: 역할 파일 일반 삭제 → 유지 지침과 설치 지침 동기화 및 출처 해시 갱신 → 지침 배포 검사와 설치 파일 부재 확인 → 작업 변경만 커밋.
성공 기준: 설치 역할 파일 부재, 활성 위임 지침의 해당 역할 참조 부재, maintained library 검사 통과. 현재 대화가 이미 받은 도구 스키마는 다음 세션에서 갱신된다.

검증: python -B scripts/import-instructions.py --check 종료 코드 0 (21 skill files, 10 components, 49 links). Python 설치·참조·배포 assertion 종료 코드 0. 작업 파일 git diff --check 종료 코드 0. 전체 작업 트리 검사에서는 기존 다른 작업의 whitespace가 발견되어 이번 작업 파일에 한정해 재검사했다.
제한: 이미 시작된 대화의 역할 스키마는 재주입하지 않았다. 격리된 Devin provider 검증 fixture와 과거 기록은 변경하지 않았다. ui.instruction-settings의 설치 목록·설정 UI 구현 계약은 변경되지 않아 기능 보존 목록 변경은 불필요하다.

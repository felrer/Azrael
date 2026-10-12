# Build Inputs (All Agents)

- At build start, freeze the selected source, scripts, lockfiles and other inputs, including selected uncommitted changes. Use that immutable snapshot through packaging, verification and installation. Exclude changes added afterward until the next build; do not refresh or restart a running build to follow concurrent checkout edits. A correction to a frozen input requires a new build identity.

- 사용자가 명시적으로 앱 버전 변경을 지시하지 않으면 현재 앱 버전을 유지하고, 검증한 같은 버전의 새 빌드로 기존 설치를 대체한다. 빌드·수정·재설치 요청 자체는 버전 증가 권한이 아니다. 빌드 입력과 산출물 식별값은 새로 부여하되 앱 버전과 구분한다. 실행 중인 런타임과 직전 롤백본을 보존하고 사용자 데이터는 유지한다. 원격 게시에는 해당 서비스의 별도 권한과 불변성 규칙을 적용한다.

## 후속 소비자와 산출물 재사용

- 비용이 큰 실행 전에 후속 작업이 요구하는 입력·설정·환경·경로·검증 조건을 확인한다.
  소스가 같아도 OS·CPU·ABI, debug/release 설정, 도구·의존성, 실행 환경과 검증 범위가 다르면
  그대로 사용할 수 있다고 판단하지 않는다. 공유 캐시·경로 변경의 잠금과 재컴파일 영향도 확인한다.
- 사전 실행은 가능한 경우 최종 작업에서 재사용할 수 있게 구성하되 재사용을 의무화하지 않는다.
  재사용 준비 때문에 작은 검사를 무겁게 만들지 않으며, 추가 실행 비용과 조기 오류 발견의 이익을 비교한다.
- 입력 수정 시 의존 관계에 따라 영향받은 산출물과 후속 검사만 다시 실행한다. 영향받지 않은 결과도
  입력·환경·출처·검증 범위의 일치와 해당 프로젝트의 재사용 조건을 확인한 뒤 사용한다.
  최종 산출물 검증과 패키지 동일성 확인은 유지하며, 준비·진단 결과를 최종 제품 통과 근거로 확대하지 않는다.
- 후속 작업에 전달하는 산출물은 사용 중 변경되지 않는 상태와 고정된 식별 정보를 갖춰야 한다.
  파일 출력 중인 디렉터리를 완료 산출물로 넘기지 않는다. 후속 작업의 필수 조건과 남은 검사를 명시한다.

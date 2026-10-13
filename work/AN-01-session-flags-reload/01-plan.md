상태: 격리 프로필 재현 시도 종료 — VS Code 렌더러 초기화 실패로 결과 미확정. 사용자 추가 입력은 필요 없음.

목표: 플래그 설정 후 Reload Window와 재시작에서 값 손실을 실제 호스트로 재현한다.
범위: Windows x64, VS Code 1.140.0, 설치 Azrael 2026.0.6 사본, 합성 인증과 빈 개인 분리 상태. 공통 동작 조사이며 Linux/macOS 수용은 미검증. 개인 상태 복사와 제품 코드 수정 없음.

실행: ELECTRON_RUN_AS_NODE=1을 확인해 검증 프로세스에서 제외했다. 이후 일반 실행과 GPU 비활성 실행의 명령 종료 코드는 각각 0이지만 실제 CDP 페이지/runner ready가 생성되지 않아 환경 준비는 실패했다. 2초 CDP 조회 시간 제한에 도달했으며 플래그 클릭, Reload, 버전 변경, 세션 가져오기 실행 검증은 수행하지 못했다. 플래그 문제가 없다는 결론을 내리지 않는다.

증거: [result.json](C:/Users/felre/Desktop/pi-harness-init/artifacts/logs/flags-reload-1791869401496/result.json), [검증 runner](C:/Users/felre/Desktop/pi-harness-init/artifacts/logs/flags-reload-1791869401496/runner.cjs). 시작 로그는 동일 폴더에 보존.

다음 독립 검증: 동작하는 격리 VS Code 렌더러 확보 후 생산 플래그 버튼 클릭 → 호스트 저장 → Reload 복원 값을 비교한다. 현재 Windows 패키지의 localHistory 비활성 조건과 Linux importer 검증은 별개로 유지한다.

정리: 이번 fixture를 참조한 테스트 프로세스 3개를 종료하고 해당 fixture를 일반 삭제했다. 정리 종료 코드 0, 경로 부재를 확인했다. 개인 프로필과 설치본은 변경하지 않았다.

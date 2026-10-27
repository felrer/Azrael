상태: 실행 세션 및 종료 증거 유실로 이번 orchestration 시도 실패. source 명령의 실제 exit/signal은 미확인(null)이며 통과로 인정하지 않는다. 사용자 후속 요청에 따라 DW-13 전체 빌드·설치로 이어간다.

# source-tests 입력 검증 재시도

- 요청과 순서: 입력 변경으로 차단된 source-tests를 새 현재 입력으로 재개한다. 10초 초과 성공 단계는 같은 입력·환경·선택으로 총 2회 측정하고 보고한다. 실패나 입력 변경은 2회차/후속 extension-build를 차단한다. 이전 실행의 Node exit 0을 현재 입력 통과로 승격하지 않는다.
- 범위: Windows x64, Node 26.7.0, concurrency 4. 기존 changed-only selector/args-file+SHA/runSelection API의 source 명령만 실행한다. 다른 OS, PowerShell/build 그룹, 제품 빌드·설치와 native acceptance는 미실행이다. 전체 selection·연기 command·coverageStatus를 보존한다.
- 재사용: 이전 controller·receipt·로그는 정리돼 새 실행을 준비한다. 기존 원본 engine/computer-use와 Python 3.12·PowerShell 7.6.7을 자식 환경에서 사용한다. instruction fixture는 현재 library helper를 사용하며 실제 adapter 사전 중복 실행은 하지 않는다. 폐기된 1.0.0 fixture를 만들지 않는다.
- 입력 경계: 이전과 같은 주 프로젝트 검증 단계다. 시작 직전과 각 실행 후 complete project snapshot SHA 및 전체 inventory 동등성을 검사한다. 실행 중 root의 소스/문서 수정·정리·다른 producer 실행은 하지 않는다. 다른 작업에서 변경되면 실제 command exit와 입력 실패를 각각 기록하고 중단한다. 실제 product build의 immutable deployment 준비·검증과 구분한다. 완전한 frozen execution workspace는 기존 테스트의 상대 artifact/dependency 경로 및 Git control 보존을 추가 준비해야 하므로 이번 단계의 실행 모델을 임의 교체하지 않는다.
- 출력: root 소유 `run:DW-12:source-tests`, `artifacts/tasks/dw12-tests`(선택·snapshot·로그·결과), `artifacts/tasks/tw12`(TEMP·instruction catalog/migration/packaging·UI cache). 출력 전에 lifecycle을 등록한다. `.git/dw12-*`는 root 제어 파일이다. 전후 catalog에서 테스트가 추가한 그룹을 확인한다.
- 검증/완료: 실제 child close, exit·signal·test count·소요 시간 및 입력 audit를 확인한다. 2회 표본이 모두 유효할 때만 평균/차이를 계산한다. 원시 자료 검토 후 독립 증거를 이 문서에 남기고 최적화 maintenance_owner로 register/review/apply·실제 부재·finalize한다. fixture junction은 소유 코드와 실제 경로/target을 확인한 지원 선언만 사용한다. 강제 삭제/guard 우회는 하지 않는다. 이전 생성물은 사용자 직접 정리 범위로 보존하며 이번 그룹과 섞지 않는다.
- 예상과 대기: 직전 source 실제 실행은 약 14분이었다. 최대 2회 순차 실행하고 20분을 첫 상태 확인점으로 삼는다. 경과 시간은 완료 근거가 아니며 completion 신호와 실제 결과를 확인한다. 동시 작업의 수정은 보존하고 이번 제품/테스트 코드 변경은 하지 않는다. 결과 기록만 분리 task commit한다.

## 종료 관측 및 후속 작업

정리 결과: 최적화 실행기 inventory/register/review/apply 모두 exit 0. 두 출력 50,827,487바이트를 일반 삭제하고 lstat ENOENT 확인 후 lifecycle finalize 완료(잔여·참조·blocker 없음). apply 31.031초. archive 이동 없음. 제어파일 12개 삭제. source 결과는 여전히 unknown/null이다.

- 실행 시작 UTC 2026-10-26T16:19:53Z. 첫 실행만 시작했으며 마지막 stdout 기록은 16:23:04Z다. 최종 Node totals, command close, 입력 사후 audit 및 2회차 결과가 없다. 실제 명령 exit/signal은 null로 남긴다. 정상 소요 시간 통계는 산출하지 않는다.
- execution session 62483은 Unknown process id를 반환했다. 16:44:30Z의 `.git/dw12-stop-observation.json`에는 DW-12 coordinator/선택된 test 실행/fixture PowerShell/Cargo/Rust process 후보가 없다. 생성 시각·부모·명령 및 실행 출처를 대조한 남은 Node 3개는 기존 설치 Computer Use 서버 2개와 DW-13 capacity watcher 1개로 이번 producer가 아니다. 단일 PID 부재가 아니라 이 범위의 프로세스 조사로 producer 정지를 확인했다. 세션 소실의 원인은 확인하지 못했다.
- 이 시도의 orchestration은 실패이고 관측하지 못한 하위 source 명령 결과를 실패 코드로 꾸미지 않는다. 루트 소유 출력 경계는 `artifacts/tasks/dw12-tests`, `artifacts/tasks/tw12` 두 개이며 새 DW-12 하위 lifecycle 추가는 없다. 안전한 정리 owner로 검토하고 폐기한다. 현재 입력으로 새 frozen 배포가 전체 source 검증을 다시 소유한다.

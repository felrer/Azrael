상태: 원인 분석 완료. 수정·재설치·프로세스 종료는 수행하지 않았으며 추가 실행은 사용자 요청 대기.

# 2026.0.14 계정 브릿지 로그인 장애 분석

## 요청과 범위
- 요청: 스크린샷의 `Account bridge is disconnected` / `Bridge connection timed out` 원인 분석.
- 허용: 기존 코드, 설치 구성, 실행 프로세스, 로그 읽기 및 조사 기록 작성. 제품 코드·설정·인증·DB·프로세스 상태 변경 없음.
- 플랫폼: 관찰 환경 Windows x64, 일반 VS Code 사용자 프로필. 저장소 호환성 계약은 공통이나 다른 OS에서 재현하지 않음.
- 조사 순서/소유자: root가 실제 버전 식별 → 실패 로그 상관관계 → 해당 릴리스 소스와 저장소 계약 대조. 별도 위임 없음.

## 확인한 원인
2026-10-31 13:14:31~13:15:40 KST, window4에서 2026.0.14가 시작되었으나 엔진이 저장소 호환성 진입 검사에서 종료되었다. 실행 중인 2026.0.13과 동일한 `C:/Users/felre/.azrael-ex`를 사용하며, 저장소 호환성 manifest가 다르면 동시 접근을 거부하는 보호 장치가 작동했다.

오류 연결:
1. 엔진 stderr: `Error: another Azrael engine is using incompatible storage; stop it before retrying`.
2. Azrael.log: `Azrael engine exited before becoming ready`, app-server exit code 1.
3. Azrael Bridge.log: 13:14:32~13:15:40 동안 connect / endpoint_unavailable / retryable=true, 19회.
4. AccountService는 약 70초 시작 예산이 소진되면 `Bridge connection timed out.`를 표시한다. 연결되지 않은 서비스에 계정 작업을 요청하면 `Account bridge is disconnected.`가 발생한다.

인증 서버의 자격증명 거절·토큰 만료·계정 손상 증거는 이번 장애 경로에서 확인되지 않았다.

## 버전 및 소스 근거
- 2026.0.13 실행 엔진: `C:/Users/felre/AppData/Local/azrael-ex/releases/2026.0.13/runtime/engine/azrael.exe`; 구성 SHA-256 `af05729487ad2fa94d97eb0abedb795f843130297135546464becb522fb8c40a`.
- 2026.0.14 runtime 구성: `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.14/out/azrael-runtime.json`.
- 신규 릴리스: `artifacts/e/artifacts/q/artifacts/releases/et1-cold-20261030q`; 엔진 SHA-256 구성/receipt 값 `444ea298b4d8025400abf9100f3e13464bb00ff72b49a70f3f1022b6e925622f`.
- build-info.json이 지정한 소스: `artifacts/e/artifacts/i2/project/engine`.
- 신규 엔진 namespace: `d21b659ea31e5392c6ac6df6b991f3f1ef7857bb5553a059da83670f661f63bc`; descriptor의 engineIdentity가 신규 구성과 일치.
- 해당 소스 `codex-rs/app-server-daemon/src/azrael_storage.rs:245`는 다른 manifest의 lease가 실제 잠겨 있을 때 오류를 반환한다. 단순 stale 파일 존재로 거부하지 않는다.
- `codex-rs/state/src/migrations.rs:178`은 모든 SQL migration의 version/description/checksum과 non-SQL ABI를 manifest로 만든다.
- 활성 lease manifest와 신규 receipt 소스 SQL을 SHA-384로 읽기 전용 비교: state 66, logs 2, goals 2, memories 2, queue 4개는 동일. thread_history만 11→12개, `0012_user_wait_timing.sql` 추가. 기존 migration checksum 차이는 없음. 이는 기록된 소스 기준 차이이며 신규 엔진을 다시 실행해 manifest를 추출하지 않았다.

## 원본 로그
- `C:/Users/felre/.azrael-ex/app-server-daemon/engines/d21b659ea31e5392c6ac6df6b991f3f1ef7857bb5553a059da83670f661f63bc/azrael.stderr.log` (84 bytes)
- `C:/Users/felre/AppData/Roaming/Code/logs/20261031T094952/window4/exthost/azrael-ex-local.azrael/Azrael.log`
- 같은 디렉터리의 `Azrael Bridge.log`, `Azrael Recovery.log` (hostVersion 2026.0.14, hostPid 23652로 상관관계 확인)
- `C:/Users/felre/.azrael-ex/azrael-storage-admission-v1/eb645444e2b355648660fdea548d106abc2a3bfc2f4770448b77135d78e95d69.lease`

## 판단과 권고
- 직접 원인: 저장소 manifest가 다른 2026.0.13과 2026.0.14의 동시 실행 시도.
- 사용자에게 보이는 오류 전달 문제: 엔진의 구체적인 저장소 충돌 오류가 계정 UI에서는 브릿지 endpoint 재시도 후 일반 타임아웃으로 표시됨.
- 복구 권고: 기존 작업 종료/보존 후 2026.0.13을 사용하는 모든 VS Code 창을 정상 종료하고 기존 엔진 종료를 확인한 다음 2026.0.14로 새 창 시작. 실제 복구 실행·DB migration 성공은 미검증이며 본 조사에서 실행하지 않음.
- 코드 개선 제안: 저장소 호환성 거부를 브릿지/계정 UI까지 즉시 전달하고, 버전 간 동시 사용 불가와 정상 종료 필요를 구체적으로 안내. 보호 검사 우회나 lock/DB 삭제는 해결책으로 제안하지 않음.

## 검증 및 보존
- 프로세스·runtime 구성·release receipt·엔진 descriptor·실패 로그의 버전/시각을 대조했다.
- 읽기 전용 migration 비교 명령 exit code 0. 신규 제품 실행, 빌드, 테스트, 로그인 시도 없음.
- 본 계획은 분석 결과를 보존하는 작업 문서이다. 임시 본문 파일은 생성 도구 성공 후 일반 삭제하고 부재를 확인한다. 별도 생성 payload·로그·백업 없음.
상태: 2026.0.8 재설치·파일 대조 완료. pi-harness-init 창에서 사용자 Developer: Reload Window 필요; 활성화는 아직 미검증.

# Azrael 이전 버전 복원

사용자가 pi-harness-init 창의 Azrael 이전 버전 복원을 요청했다. root가 기존 검증된 prepared package와 frozen installer를 재사용한다. Windows x64의 일반 VS Code 프로필 설치 범위이며 같은 프로필의 창은 다음 reload 때 동일 버전을 사용한다. 계정·대화·설정을 보존하고 SkipCodexEnvironmentSnapshot으로 환경 재적용을 생략한다. 제품 소스, 설계 계약 및 다른 OS는 변경하지 않는다.

현재 등록 2026.0.9, 직전 installed-reload-required receipt는 artifacts/w31b/artifacts/deployments/independent-20261016-211909-339/deployment.json. prepared package는 artifacts/w31b/artifacts/deployments/deploy-w31b/package, runtime은 artifacts/w31b/artifacts/releases/w31b, VSIX SHA256 4C426A5BFF028ED72CDA04E2A1766BAC044A309CAB03E7548D25B653B298794B. 기존 검증과 runtime을 보존한다.

실행 전 패키지 hash와 등록 상태를 확인하고 동일 frozen installer로 NoLaunch 설치한다. 실행 로그는 artifacts/logs/rollback-20261017 소유, 설치 출력은 frozen installer의 고유 deployment 경로 소유다. 완료 조건: 실제 exit0, installed-reload-required receipt, 등록 2026.0.8 및 VSIX 일치, 설정 hash 보존. 프로젝트 설치 절차에 따라 창은 자동 reload하지 않고 사용자에게 Developer: Reload Window를 안내한다. 새 빌드·fixture를 만들지 않으며 양쪽 runtime은 현재/복구/실행 참조 때문에 보존한다.

## 결과

설치 actual exit 0, receipt `artifacts/w31b/artifacts/deployments/independent-20261017-124811-051/deployment.json`: installed-reload-required, hostVersion2026.0.8, Launched=false. prepared VSIX 및 엔진 provenance 검증 통과. VS Code 등록2026.0.8 확인. 기존 payload 검증기를 재사용해20887파일과 manifest·membership을 exact VSIX와 대조, actual exit0. VS Code 소유 package.json __metadata만 제외했다. 검증 로그/목록은 `artifacts/logs/rollback-20261017/installed-payload.json`, 설치 로그는 같은 디렉터리 `install.log`, actual exit는 `exit-code.txt`다. config.toml 설치 전후 SHA 동일, receipt의 editor settings 및 original Codex unchanged=true. 환경 snapshot은 재적용하지 않았다.

기존 BS-01/02의 exact-package6단계 exit0 수용 증거를 재사용했고 새 빌드나 테스트 프로필은 만들지 않았다. 설치 도구가 생성한 작은 registry/shortcut 복원 자료와 receipt는 이번 복원 근거로 유지한다. 작업의 새 창·worktree·빌드캐시 없음. w31b/2026.0.9 및 실행 중 runtime/source는 현재·복구·실행 소비가 있어 보존하고, 해당 참조 종료 및 별도 정리 검토 때 재평가한다. 운영 current state를 실제 등록에 맞춰 갱신했다. 사용자가 해당 창을 reload하기 전 실제 창 활성화·live provider 성공은 주장하지 않는다.

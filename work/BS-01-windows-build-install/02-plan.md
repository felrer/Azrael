# Windows 최신 빌드 검증과 프로필 설치

상태: Azrael 2026.0.8 프로필 설치·검증·disposable 정리 완료.

사용자 요청에 따라 지금까지의 제품 변경을 포함한 Windows x64/MSVC 로컬 앱을 빌드·검증하고 일반 VS Code 사용자 프로필에 설치했다. 버전 증가는 하지 않았다. 원격 게시, 사용자 창 종료·강제 reload와 실제 계정 로그인·모델 요청은 수행하지 않았다. Linux/macOS의 수용 결과로 확장하지 않는다. root가 입력·출처·통합·설치·최종 판단을, 담당자가 한정된 경로 조사·사전 검사·생성 프로필 정리를 소유했다.

## 입력과 결과

- 고정 입력: `artifacts/w31b`, release: `artifacts/w31b/artifacts/releases/w31b`, 준비된 패키지: `artifacts/w31b/artifacts/deployments/deploy-w31b/package`.
- Azrael 2026.0.8 / engine 0.162.0 / pinned UI 26.1007.21434 / Windows x64 / VS Code 1.142.0. 최종 호스트 VSIX SHA256: `4c426a5bff028ed72cda04e2a1766bac044a309cab03e7548d25b653b298794b`.
- 고정 project fingerprint: `d18e8e1bbd0d513bd60113110fbb61377ed64984b9d6fbea2ad3d5f1d7057dc1`. w31b post-build와 w31c 재사용 전 snapshot 일치, build-info의 배포 파일 25개 실제 SHA 일치. 수정한 engine 4개 입력도 현재 작업 파일과 검증한 사본이 일치한다.
- 설치 경로: `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.8`. runtime은 위 w31b release의 engine·bridge·부속 payload를 사용한다. `C:/Users/felre/.azrael-ex` 사용자 상태는 그대로다.
- 설치 receipt: `artifacts/w31b/artifacts/deployments/independent-20261016-211909-339/deployment.json`. Installed=true, ReloadRequired=true, Launched=false, status=installed-reload-required. 실행 중인 창에 적용하려면 사용자가 Developer: Reload Window를 실행한다.

## 오류와 수정 범위

Windows ConPTY가 부모의 Ctrl+C 무시 속성을 상속해 전경 자식 중단 회귀가 실패했다. `win/psuedocon.rs`는 ConPTY 자식 생성 전에 `SetConsoleCtrlHandler(None, 0)`으로 호출 프로세스 전체의 해당 상속 속성을 정상 상태로 복원하고 유지한다. 등록된 애플리케이션 제어 핸들러를 제거하지 않는다. 분리 호스트의 ERROR_INVALID_HANDLE은 콘솔 부재로 처리하고 다른 오류는 생성 실패로 보고한다. 기존 Job·소유권·승인·권한 정책은 유지한다. 기존 winapi에 consoleapi feature를 추가하고 ignored-parent·detached-parent·ignored→detached 격리 회귀를 보강했다. Linux/macOS 경로는 수정하지 않았다. 기존 패치를 제거하지 않았다.

최종 호스트의 첫 w31b 검증은 긴 격리 상태 경로에 엔진의 `app-server-control/app-server-control.sock` 접미사가 붙어 137 UTF8bytes가 되어 실패했다. Windows AF_UNIX는 최대 107bytes다. 새 w31c 실행은 제품·VSIX·engine을 수정하지 않고 primary `artifacts/v32/state`의 101bytes 경로를 사용했다. 실제 사용자 `.azrael-ex` 경로는 68bytes다. 이 변경은 격리 검증 환경만 바꾸며 사용자 상태 이동이나 제품 fallback을 추가하지 않는다.

현재 검증 도구는 `verification-state.ps1`에서 Windows UTF8 길이를 계산하고, host checker의 source hashing/copy 및 deploy의 lifecycle/build 전에 설치 상태와 acceptance 상태를 검사한다. 별도 socket을 명시하는 account-controls 경로에는 적용하지 않는다. 긴 경로는 짧은 fresh fixture/checkout을 선택하라는 오류를 낸다. 원본 helper의 작은 경계 검사는 build/changed 선택기에 연결했다. 새 도구 변경은 w31b frozen input에 소급하지 않았으며 제품 바이너리 재생성 사유가 아니다.

## 검증과 실제 시간

| 범위 | 결과·근거 |
| --- | --- |
| focused Windows PTY | 9개 exit 0, 최종 pty-fixed-v4. 부모 상속/분리 조건 포함 |
| 원본 import baseline | 9,199파일 / 93,116,286bytes exact SHA 및 validator exit 0. receipt `12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6` 유지 |
| w31b full source + extension | exit 0. source 121파일·1,583사례(1,578 pass/5 skip), extension 218 pass |
| w31b 앱 build | exit 0, 06:42경 시작→07:04:47 UTC. 엔진·bridge 동시 생성, code-mode host는 출처가 기록된 외부 import |
| w31b engine preservation | exit 0, 07:05:03→09:15:45 UTC, 약 2시간10분41초. 전체 upstream workspace 통과를 뜻하지 않음 |
| w31b UI/package preparation | exit 0, 07:27:33 UTC 완료. UI preservation 99 logical checks→52 실행 명령은 기존 gate 내부 중복 제거 결과 |
| w31c exact package acceptance | 12:13:26→12:18:38 UTC, 약 5분12초, exit 0. initialInventory/hostInstall/finalInventory/namespace/standaloneHost/host 전부 0 |
| 설치와 보존 | 실제 installer exit 0/result Installed=true. 원본 Codex/다른 확장/편집기 설정 보존 receipt 및 별도 postcheck exit 0 |
| 설치 파일 동일성 | 20,886파일 exit 0. package.json은 VS Code 소유 __metadata만 제외한 JSON 동일성, 나머지는 VSIX 원본 SHA256 동일성 |
| 도구 사전 검사 | ASCII·한글 107/108bytes 및 상태 미생성/선행 거부 5개 exit 0, mock full install 1개 exit 0, selector 회귀 30개 exit 0 |

겹치는 build·source·prepare·engine 시간을 합산해 총 시간으로 보고하지 않는다. w31c는 동일한 소스·배포 파일·검증 범위가 확인된 결과를 재사용했으며 엔진을 다시 컴파일하지 않았다. 검사 축소 후 전체 빌드 시간 절감은 측정하지 않았다.

사용자 config.toml의 설치 전후 SHA256은 `362DEFD6F3E6816AFF56733B8B76D0F02C68474ED1C324923C89ECCF974D4C11`로 같다. 계정 시작 연결의 fulfilled/changesEnabled 및 독립·동시 호스트 활성화는 실제 최종 호스트 검사에서 통과했다. live provider 요청·새 대화·로그인 및 전체 화면 비교를 수행했다고 주장하지 않는다.

## 진단 실행과 증거 보존

w31b의 실패한 deployment-metrics는 역사적 실패로 유지한다. 새 성공은 w31c acceptance와 실제 설치 receipt로 구분하며 실패 기록을 성공으로 덮어쓰지 않는다. 초기 단독 probe의 unsupported CLI daemon 명령 exit 2, 직접 생성한 일반 socket parent의 private-directory 거부, Windows Node socket/stat 진단의 한계도 성공으로 처리하지 않았다. 최종 네이티브 bridge가 `register a window before initialize`라는 서버 응답에 도달한 결과는 socket bind/connect 확인에만 사용했다. 계정·제품 통과는 별도 6단계 결과가 근거다.

초기 설치 wrapper는 실제 installer 성공 후 install-mode receipt에 없는 hostSha256 필드를 요구해 exit 1이었다. 제품 설치를 반복하지 않고, 원본 receipt의 hostVsix 경로·실제 파일 SHA·버전·보존 필드·설치 runtime을 검사하는 별도 postcheck exit 0 및 전체 설치 payload 대조로 수용했다. 이 차이를 포함한 진단 로그를 보존한다.

영구 증거 소유 위치는 `artifacts/w31b/artifacts/logs/verification-evidence/deploy-w31b/w31c-closeout`이다. final host/standalone/check-result, acceptance 결과, installation receipt/postcheck, 입력/배포 SHA 비교, 도구 회귀와 실패 진단·정리 receipt를 보존한다. 설치 파일 전체 SHA 목록은 `installed-payload-identity.json.gz`와 raw/compressed hash를 가진 summary로 보존한다. engine receipt는 `artifacts/w31b/artifacts/logs/deploy-w31b/engine-preservation/preservation-t2icVp/receipt.json`, UI receipt는 package의 `feature-preservation/preservation-Vl3Pbl/receipt.json`이다.

## 정리와 유지 조건

진단이 끝난 이전 w31a source/run 사본과 실패 w31b host fixture는 일반 삭제·실제 부재·lifecycle 반영을 확인했다. 새 w31c disposable 프로필/진단 상태/작업 로그 묶음도 필수 증거 70개를 위 버전 소유 위치에 해시 검증해 보존한 뒤 함께 삭제했다. primary의 runw31c, artifacts/v32, p32, p33 네 경로 실제 부재 및 lifecycle finalized를 확인했다. 확인된 generated private 파일의 ReadOnly/Hidden만 필요한 경우 정규화하며 force 삭제·ACL·owner 변경은 하지 않는다. native AF_UNIX 소켓 reparse leaf는 실제 tag와 무대상·정지된 소유 프로세스를 확인해 링크/정션과 구분한다.

현재 설치 w31b의 source/release/package/필수 출처와 실제 실행 중인 이전 w14w/w14y rollback, 현재 소비되는 모듈/Cargo 캐시 및 engine original-import baseline은 보호한다. 이름만으로 이전 버전·캐시를 삭제하지 않는다. baseline은 strict provenance 갱신과 재검증의 필수 원본이며 불필요한 캐시가 아니다. 유지 항목은 설치·실행·rollback/출처 소비가 끝날 때 기존 owner 규칙으로 재검토한다.

최종 정리는 preview/archive exit 0, 최초 일반 삭제 exit 1(ReadOnly/Hidden 사본으로 partial), 확인된 private 생성 항목 38개의 속성 정규화 후 일반 삭제 재시도 exit 0이다. 프로세스를 종료하지 않았으며 source·설치본을 변경하지 않았다. 보존된 70개 파일 hash와 압축 해제한 설치 inventory 원본 SHA를 재검증했다. preservation-receipt SHA256은 `D1DA68D4ECC84C8E6E0A6FA8D519D16475F7A5541FEDEFF300188CD6112B56CC`이다. 최종 근거는 archive의 `closeout-completion.json` 및 `cleanup-53323acf1e1d4e70ab72b279b3199987.json.outcome.json`이다. 제품 설치·필수 검증·계획된 정리의 미완료 항목은 없다. 현재 사용자 창의 새 바이너리 적용만 사용자 reload를 기다린다.

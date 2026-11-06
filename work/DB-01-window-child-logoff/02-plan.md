상태: 사전조사 완료·지원 조건과 구현 범위 검토 대기. 제품 코드·설치본·Windows 설정은 변경하지 않았다。

# Windows 자식 세션 자율 운용 사전조사

## 목표·권한·범위

사용자는 승인만 하고 모델이 세션을 조회·생성·연결하여 요청 작업을 수행한 뒤 정리하는 것이 목표다. 인증 지연 개선의 기존 작업을 전체 수명주기 조사로 확장한다. 이번 권한은 사전조사이며 구현·빌드·설치·정책 변경·새 세션 실험은 수행하지 않았다.

대상은 Windows 로컬 x64 same-user child session이다. 현재 관찰 환경은 Windows 11 Core, build 26200 revision 9711이다. Pro/Enterprise와 Home의 지원 판정은 분리한다. Linux/macOS·Remote SSH·컨테이너·부모 로그오프 후 무인 운용은 별도 범위다.

기존 결정은 유지한다. 정상 세션은 owner가 없을 때 명시 종료, 상태·연결 검증 실패 세션은 owner 무관하게 사용자 승인 후 종료한다. busy는 비정상이 아니다. 사용자 파일·프로필·앱 로그인 데이터는 정리 대상으로 삼지 않는다. 앞서 제안한 인증 대기 5분은 미확정 값이다.

## 결론과 정정

준비된 지원 환경에서는 승인 후 자동 생성·작업·정리를 구현할 근거가 있다. 모든 에디션·로그인 방식·보안 정책에서 승인 한 번만으로 완료를 보장할 근거는 없다.

이전의 “로그인 화면에서 비밀번호를 입력하면 된다”는 안내는 불충분했다. Windows child session은 원칙적으로 자동 로그인을 제공하지만 예외가 있고, 로그인 UI나 viewer가 존재한다는 사실도 별도로 확인해야 한다. 이번 최초 오류가 입력 지연 때문이었다고 확정할 수 없다.

세션 존재, RDP 연결, Windows 로그인, worker 인증, 화면·입력 admission, 대화의 제어권, 종료 권한은 각각 다른 상태다.

## 외부 사례

조사 기준일은 2026-11-01이다. 공식 API·제품 운영 문서·개발자 저장소·사용자 직접 보고를 조사했다. 게시물은 해당 환경의 관찰이며 Azrael을 검증한 증거가 아니다.

| 출처 | 확인한 내용 | 적용할 교훈 |
| --- | --- | --- |
| [Microsoft Child Sessions](https://learn.microsoft.com/en-us/windows/win32/termserv/child-sessions) | ActiveX와 ConnectToChildSession으로 생성, 자동 로그인 예외, 시스템당 active/connected child 하나 | 비밀번호 보관을 기본 해법으로 삼지 않고 여러 대화의 입력을 직렬화 |
| [UiPath PiP 운영 문서](https://docs.uipath.com/assistant/standalone/latest/user-guide/pip-child-session) | 활성화에 관리자 권한, PIN/정책별 반복 인증, 시작 기본 마감 180초, 연속 작업 재사용과 앱 충돌 | 인증·시작·worker 대기를 분리하고 매 작업 재생성 비용 고려 |
| [Power Automate PiP](https://learn.microsoft.com/en-us/power-automate/desktop-flows/run-desktop-flows-pip) | Home 미지원, 시작 기본 마감 120초, 인증 조건, 시작 프로그램·Office·브라우저 프로필 제약 | API 가용성과 제품 지원 범위를 구별하고 앱별 호환성 검증 |
| [UiPath 사용자 보고, 2020](https://forum.uipath.com/t/picture-in-picture-experimental/220110?page=5) | 창이 늦게 열려 timeout된 직접 보고, 작업 완료 후 로그아웃 요구 | 현재와 유사한 실패 유형. 당시 기본 마감값은 현 제품 기준으로 사용하지 않음 |
| [UiPath 사용자 보고, 2026-02](https://forum.uipath.com/t/picture-in-picture-interrupted-when-user-locks-screen/5722323) | 부모 화면 잠금·연결 단절 뒤 작업 중단 보고 | 장시간 무인 운용은 별도 검증. 답변의 MFA 비활성화 제안은 채택하지 않음 |
| [Ray Desktop](https://github.com/raydoomed/Ray-Desktop) | 같은 API의 프로토타입. 활성화 후 재로그인, RDP 이벤트·마감, 로그오프 요청·호환성 한계를 설명 | 이벤트/진단 구현 참고. 광범위한 앱 호환성이나 종료 요청 성공을 종료 완료로 보지 않음 |
| [Trope CUA](https://github.com/nkoshy/trope-cua-new/blob/main/docs/child-session.md) | parent broker → RDP host → child agent 구조. action agent와 도구 라우팅은 미완성이라고 명시 | 세션 생성과 모델의 실제 작업 경로 완성은 별개 |

UiPath와 Power Automate의 마감값은 Windows API 제한이 아니라 각 제품 기본값이다. Ray의 공유 클립보드·자동 종료를 그대로 복사하지 않는다. 외부 프로그램을 설치·실행하지 않았고 전체 저장소를 감사하지 않았다. 일부 raw source 조회는 실패했다.

## 실현 가능 범위

| 단계 | 조건 | 성공 판정 |
| --- | --- | --- |
| 환경 준비 | 호환 edition/계정/정책, 초기 enablement와 서비스 준비 | ordinary-user token으로 실제 생성·작업·종료 |
| 조회 | 실제 parent-child, SID/profile, host/worker/lease 관찰 | 조회 실패를 세션 없음이나 owner 없음으로 바꾸지 않음 |
| 생성 | 자동 로그인 가능한 준비된 환경 | child ID 외에 worker 인증과 admission 통과 |
| 인증 | OS 요구 시 사용자 직접 처리 | 로그인 완료와 worker ready 분리 |
| 기존 세션 연결 | 정상 idle host handoff 또는 별도 복구 | 현재 anchor/신원/lease 검증 |
| 앱 작업 | child-local agent와 앱 호환성 | 실제 child 안의 프로세스·fresh capture·입력 검증 |
| 정리 | 정상 앱 종료, 입력 반납, 재사용 또는 로그오프 | 세션·프로세스 종료·파일 제거 각각 확인 |

“승인만으로 어느 세션이든 인수”는 보장하지 않는다. 일반 확장 프로세스가 WTSQueryUserToken을 호출하는 것만으로 복구되는 것도 아니다. 이 API는 LocalSystem과 SE_TCB_NAME을 요구한다. [공식 API](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsqueryusertoken).

[Disconnect](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsdisconnectsession)는 세션을 남긴다. [Logoff](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtslogoffsession)는 세션을 끝내며 비동기 요청이면 별도 완료 확인이 필요하다. 일반 입력 owner 획득과 관리자 권한은 다르다.

## 권장 구조 — 제안

현재 ordinary-user host/resource manager를 확장한다. 별도 SYSTEM 상주 서비스를 기본 전제로 두지 않는다. 호스트 재시작 후 privileged recovery의 필요성과 범위는 작은 실증으로 판단한다.

흐름은 사용자 작업 범위 승인 → 환경/기존 세션 조회 → 생성 또는 정상 idle 세션 획득/복구 → worker/admission → 앱 작업 → 결과 확인 → 앱 정상 종료/입력 반납 → bounded warm 재사용 또는 로그오프 → 잔여 프로세스/임시 파일 확인이다.

- 세션 연결 owner와 대화의 input lease를 구분한다. 여러 host가 독립적으로 복구·종료를 경쟁하지 않게 한다. native mutex, peer 인증, process lifetime, release 증거를 재사용한다.
- 작업이 없는 대화는 입력 제어권을 놓되 세션 자체는 제한된 시간 유지한다. queued continuation은 예약과 만료로 표현하되 무기한 배타 점유가 되지 않게 한다. 큐 범위/기한은 미확정이다.
- 세션 종료는 프로세스 메모리 회수와 관련되지만 앱 프로필·공유 캐시·파일이 원복되는 것은 아니다. OS 캐시 때문에 종료 직후 시스템 메모리가 정확히 원래 값으로 돌아온다고 약속하지 않는다.
- Windows 인증, UAC, 앱 승인, 작업 수명주기 승인과 외부 전송 승인은 서로 다르다. 처음 승인에 포함할 자동 정상 종료 범위는 정해야 한다. 기존 앱이 있는 복구 세션을 자동 강제 종료하는 것은 별도 결정이다.
- viewer의 존재와 연결을 세션 생존 증거로 사용하지 않는다. 무창 운용에는 실제 렌더·입력이 가능한지 확인이 필요하며 단순 창 숨기기로 해결됐다고 주장하지 않는다.

## 인증·결과 상태 — 제안

상태를 preparing, connecting, authentication_required, logged_on, worker_starting, verifying, ready, busy, reconnecting, closing, closed, failed, unknown으로 나누되 실제 Windows 인증 UI를 감지하지 못한 경우 authentication_required를 추정 확정하지 않는다. 연결·작업 권한·정리 상태는 독립 필드로 제공한다.

- [OnLoginComplete](https://learn.microsoft.com/en-us/windows/win32/termserv/imstscaxevents-onlogincomplete): 로그인 완료 신호이며 worker ready는 아니다. 자동 로그인 시 실제 event 순서도 live 검증한다.
- [OnLogonError](https://learn.microsoft.com/en-us/windows/win32/termserv/imstscaxevents-onlogonerror): 오류 외 로그인 계속 같은 이벤트도 있다. 모든 이벤트를 실패로 분류하지 않는다.
- [OnDisconnected](https://learn.microsoft.com/en-us/windows/win32/termserv/imstscaxevents-ondisconnected): reason 및 ExtendedDisconnectReason을 보존한다. local disconnect가 항상 오류나 사용자 취소는 아니다.
- [OnAuthenticationWarningDisplayed](https://learn.microsoft.com/en-us/windows/win32/termserv/imstscaxevents-onauthenticationwarningdisplayed): 인증서 경고 등도 포함하므로 비밀번호 입력창의 확정적 감지가 아니다.
- 취소는 명시 증거로만 분류한다. 인증 대기·연결 실패·시간 초과·결과 불명은 구분한다.
- 권장안은 장시간 동기 호출 하나보다 operation ID와 진행 상태/terminal 이벤트다. 도구 timeout이 producer 종료를 뜻하지 않게 하고, 채팅에 최종 결과가 실제 전달되는 host/MCP/engine 경로를 검증한다.
- 인증·worker·admission 마감은 구별한다. 5분 일괄 연장만으로 해결하지 않는다. stop/권한 철회/시간 초과 뒤 늦은 응답으로 작업을 자동 재개하거나 app launch를 재생하지 않는다.

## 현재 Azrael과 차이

설계 owner: [Window Use](../../docs/architecture/window-use.md), preservation item: ui.window-control.

| 구현 owner | 직접 확인한 현재 동작 | 개선할 부분 |
| --- | --- | --- |
| native/windows-child-session/ChildSession.cs Host.Start | worker pipe 40초 대기, 현재 RDP 경로에 로그인/취소 이벤트 분류 없음, finally에서 정확한 bootstrap 정리 | 인증과 worker 시작 분리, 늦은 인증과 bootstrap 수명 연결 |
| scripts/window-child-session.cjs | 일반 start 55초, recovery 240초. 설치 2026.0.14의 55초도 확인. 자동 복구·lease/release 존재 | producer 상태와 외부 마감 정합성 |
| Recovery.ValidateTarget | 일부 내부 예외를 inventory/identity could not be verified로 축약 | 비밀 없는 정확한 검증 단계·Win32 코드 보존. 검증 삭제로 해결하지 않음 |
| Host.Stop | recovered 세션 자동 로그오프를 거부하고 보존 | 복구 뒤 자동 정리 목표와 기존 보호 계약 차이 결정 |
| scripts/window-use-isolation.cjs | release 시 입력/lease를 반납하고 warm 유지 | 전체 재작성보다 예외 상태·host restart 정합성 보강 |
| viewer preflight | 최소화 시 launch/capture/input 거부 | 사용자 개입 없는 실행 목표와 차이. 렌더·입력 실증 필요 |
| 명시 종료 wrapper | 이번 설치본에서 PowerShell 실행 정책 UnauthorizedAccess. 이후 child 2 존재 확인 | 정책 변경/우회 없는 native orchestration 검토, nonce/hash/UAC/identity/closure receipt 보존 |

이번 최초 HRESULT 0x80131509만으로 원인을 특정할 수 없다. 마지막 관찰의 child 2와 explorer는 세션 존재의 증거이지 정상 제어 증거나 현재도 살아 있다는 무기한 보장은 아니다. 입력 지연 → bootstrap 정리 → worker 부재는 가능한 경로이며 확정 원인이 아니다.

## 최소 실증과 다음 순서 — 미실행

1. Windows 11 Pro/Enterprise와 현재 Core를 분리해 ordinary-user 생성·작업·종료를 검증한다. 최초 enable 직후/부모 재로그인 후, password/PIN 조건을 구분한다. 정책은 읽고 승인 없이 바꾸지 않는다.
2. 실제 RDP 이벤트 타임라인, 지연 인증·명시 취소·인증 실패·마감 후 성공을 기록한다. 비밀번호와 원문 계정 정보는 기록하지 않는다.
3. worker 미시작, host 종료/reload, idle handoff, busy owner, orphan의 복구를 검증한다. 기존 child/app을 보존하고 정확한 실패 단계/권한 요구를 기록한다.
4. 단순 앱으로 admission/캡처/입력을 먼저 확인하고 카카오톡을 별도로 검증한다. 비패키지 앱 발견·실행, single-instance/프로필 충돌·로그인 유지·보호 콘텐츠는 미확정이다.
5. 앱 정상 종료·입력 반납·로그오프·worker/viewer 종료·bootstrap 제거를 각각 확인한다. 시작 전/ready/작업 후/종료 후 private/committed memory, 잔여 프로세스와 task-owned bytes를 비교한다. 사용자 프로필은 보존한다.
6. 부모 잠금·해제, 연속 작업, 앱 충돌 후 복구를 확인한다. 반복 횟수/성공률은 비용과 함께 결정한다. 기존 testing/implementation/build/artifact owner 절차를 적용한다.

권장 순서는 작은 Windows 실증으로 지원 조건 확정 → 진단·native 종료 경로·진행/결과 전달 → 기존 lease/warm 구조에 생성·인증·복구 통합 → 카카오톡 및 반복 수명주기 검증이다.

권장 제품 목표는 준비된 지원 환경에서 승인 뒤 자동 진행하고, OS 인증/권한/정책 예외는 정확하게 사용자에게 인계하며, 실패해도 상태를 추적해 중복 생성 없이 복구·정리하는 것이다. 모든 환경의 무인 운용이 필수라면 전용 VM/별도 계정/credential broker의 비용·인증 수명주기를 별도 설계해야 한다. 그 도입이나 비밀 저장은 승인된 것이 아니다.

이번에는 문서·소스·웹 자료만 조사했으며 제품 빌드·테스트·설정 변경·세션 조작은 수행하지 않았다.

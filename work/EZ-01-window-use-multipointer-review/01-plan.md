상태: 요청별 창 지정과 30초 유휴 자동 점유의 소스 구현·최종 회귀 검증·이번 임시 산출물 정리를 완료했다. 이전 자동 승인 작업은 완료 상태를 유지한다. 설치본 변경과 전체 제품 빌드, 실제 사용자 앱 입력 시험은 범위 밖이다. 상세 증거와 이전 작업의 범위는 아래 소유 기록을 따른다.

# Azrael Windows 가상 마우스·키보드

## 요청별 창 지정과 30초 자동 점유

상태: 소스 구현·최종 회귀 검증·이번 임시 run 정리 완료. 설치본 변경은 범위 밖이다.

- 승인된 계약: 공개 `select_window`를 제거하고 `list_windows`의 수명에 묶인 `windowId`를 요청마다 명시한다. 한 대화는 여러 창의 관찰을 따로 유지한다. 첫 제어에서 점유하고, 소유자의 해당 창 요청 완료 후 30초 유휴만으로 정상 해제한다. 처리 중 만료하지 않고 다른 요청자는 시간을 갱신하지 않는다. 턴 종료나 최종 답변을 작업 종료로 추측하지 않는다.
- 충돌은 실제 배타 점유로 관리한다. 대기는 입력 직렬 큐 밖에서 최대 30초이며, 추가 창을 서로 기다리는 경우에는 `window_busy`로 교착을 피한다. 만료·소유권 이전 후 오래된 관찰은 입력에 쓰지 않는다. Stop·권한 취소·불확실 입력 무재전송을 보존한다.
- 범위: 정책·MCP 계약은 공통 JS 소스이고 제품 가용성은 기존 Windows 한정이다. Windows x64에서 회귀 검증하며 Linux/macOS 활성화나 원격 실행, 네이티브 입력 백엔드 교체를 하지 않는다.
- 소유·순서: 정책/다중 바인딩/점유 실행기와 MCP 스키마, 기존 회귀 호출부를 독립 작업으로 진행하고 root가 호스트·desktop 진입·지침·통합을 담당한다. 입력을 고정한 뒤 기존 승인·Stop·캡처·매크로 검사와 새 만료·경합 검사를 실행한다. 상세 로그·fixtures는 새 EZ01 소유 run으로 기록하고 종료 후 기존 owner 정리 절차로 삭제한다.
- 재사용 판단: 기존 observation/세대/승인/native identity/FIFO를 확장한다. 기존 advisory 파일은 배타 점유가 아니므로 원자적 arbitration을 추가한다. 새 외부 의존성은 필요하지 않다.
- 초기 검증: 첫 고정 입력 68건 중 65통과·3실패(exit 1)에서 Stop/재개 ID 보존과 Stop 오류 메타데이터를 수정하고 명시적 조회 fixture를 보완했다. 두 번째 244건 중 221통과·22실패·1플랫폼 skip(exit 1)은 누락된 fixture 상위 폴더·외부 고정 UI 경로, 변경 계약을 반영하지 못한 기대값·mock·ID, 읽기 Stop 메타데이터로 분류했다. 원래 실패는 [1차](window-targets-verification-01.json)·[2차](window-targets-verification-02.json)에 보존하고 수정된 입력으로 재검증한다. 정상 유휴와 별개로, 입력 정리 중의 점유는 실제 정리가 끝날 때까지 보호하며 불확실한 실행 중 claim은 시간이나 PID 부재로 회수하지 않는다.
- 후속 검증: 3차는 245건 중 242통과·2기대값 실패·1플랫폼 skip, 4차에서는 수정한 호스트·오버레이·통합 진입 검사를 통과했다. 4차 UI 연결 검사에 빠진 공통 글꼴 의존성을 보완한 5차는 14/14 통과(exit 0)했다. 마지막 검토에서 내부 턴/정리 이벤트가 타이머를 갱신하지 않도록 cleanup pin과 실제 요청의 갱신을 구분했고, 6차 고정 입력으로 전체 영향 범위를 재검증한다.
- 보존할 검사는 도구를 추가하며 명시적 창 인자를 누락하거나, 직렬 큐를 옮기며 실행 중 만료·다른 창 관찰 파괴·내부 이벤트의 유휴 갱신을 재도입하는 구체적 실수를 막는 최소 경계를 기존 suite와 새 `test-window-request-targets.cjs`에 연결한다. 네이티브 HWND destroy 감시와 프로세스 identity 검증은 재사용하며 재컴파일이나 실제 사용자 앱 입력은 수행하지 않는다.
- 최종 검증: 6차의 23개 파일에서 246건 중 245통과·실패 0·플랫폼 skip 1(exit 0). 별도 프로세스의 같은 창 경합·전역 입력 배제, 30초 경계·장시간 처리 보호·정리 이벤트 비갱신, 여러 창 관찰 보존·만료 후 재관찰, 승인·Stop·캡처·매크로 경계를 포함한다. 5차 UI 연결 14/14(exit 0), 4차 호스트·오버레이·통합 진입 성공을 함께 사용한다. 현재 제품 5파일과 새 핵심 테스트의 hash가 6차 고정 입력과 일치한다. [최종 수용 근거](window-targets-acceptance.json), [6차 결과](window-targets-verification-06.json).
- 현재 공개 모델 도구는 24개이며 앱 전용 `ui_operation` 1개가 별도다. `select_window`는 공개 스키마·호출에서 제거했다. 수동 UI의 기본 창 선택은 내부 API로 유지한다. 기존·동시 변경이 같은 소유 파일에 섞여 이번 변경만 안전하게 stage할 기준이 없어 task commit을 만들지 않는다. 설치·제품 빌드·실제 사용자 앱 입력·다른 플랫폼 수용은 주장하지 않는다.
- 정리: 이번 6개 그룹은 모두 register/review/apply/finalize 실제 exit 0, payload 삭제·빈 참조·잔여 경로 0을 확인했다. 논리 크기 66,263,972바이트이며 물리 회수량은 측정하지 않았다. 원래 실패 4건·성공 2건, 실제 child 종료·소스 identity와 최초 집계 JSON 형식 검증 wrapper exit 1을 독립 보존했다. 마지막 집계 형식 보정 검증은 exit 0이며 새 scan/삭제 producer를 중복 실행하지 않았다. [정리 근거](window-targets-cleanup.json). 이전 작업의 보존 승인 범위와 설치물·사용자 파일·동시 작업은 변경하지 않았다.

## 도구 호출에 통합한 승인과 설정 진입점

상태: 소스 구현·필요 검증·이번 시험 산출물 정리 완료. implementation·testing 절차로 기존 승인 대기·취소·대상 검증을 재사용한다. 설치·배포는 범위 밖이다. [수락 근거](automatic-approval-acceptance.json).

- 실제 도구가 필요한 승인을 자동 요청하고 대기한다. 수락 후 권한·대상·관찰을 다시 검증해 실행하며, 오래된 화면은 재관찰을 요구한다. 명시 거절은 approval_denied, 무응답 timeout은 approval_timeout으로 구분한다. 부분·불확실 입력은 재전송하지 않는다.
- 시큐리티 앱은 개별·전체 제어 모두 security_app_blocked로 차단한다. 기존 승인·화이트리스트·전체 제어로 우회하지 못하며 추가 제어 승인 경로를 제거한다. 관찰 승인과 전체 캡처 마스킹은 유지한다.
- 승인 카드에 화이트리스트·시큐리티 앱 설정 진입점을 제공한다. 신뢰된 카드의 앱·요청에 바인딩하고 설정 열기만으로 승인하지 않는다. 목록 저장 후 현재 정책을 다시 검증한다.
- 모델용 request_permission·prepare_permissions를 제거하고 수동 UI에 필요한 내부 승인 API만 유지한다. 다른 Window Use 도구 통합은 이번 범위에 포함하지 않는다.
- 공통 권한·도구 계약 변경이며 Windows 로컬 x64에서 회귀·native React 설정/승인 화면을 검증한다. 기존 Windows 외 플랫폼 활성화는 하지 않는다. root는 policy/MCP·통합·수락, host/store/error와 승인 UI는 독립 소유자가 담당한다.
- 검증: 자동 수락·거절·timeout·취소·중지·늦은 수락, 시큐리티 앱과 화이트리스트 충돌, 승인 대기 중 화면/정책 변경, 설정 진입·저장·키보드·light/dark/narrow, 공개 도구 목록을 검사하고 소유 산출물을 정리한다.
- 전체 제어를 새로 승인한 경우 이전 캡처를 무효화하고 state_changed/observationRequired를 반환한다. 승인은 유지하므로 새 캡처 뒤 재호출은 다시 승인받지 않는다. 화면 좌표 입력은 승인 전 화면이 여전히 유효하다고 추정하지 않는다.
- 승인 카드의 간단 설정은 현재 앱을 미리 선택하며 저장·제거를 명시적으로 확인한다. 실행 중이지 않은 등록 앱과 기존 영구 승인도 제거할 수 있다. 화이트리스트 제거는 최초 설정 revision을 끝까지 CAS 검증하며, 중간에 기존 승인이 해제된 뒤 충돌해도 그 승인을 복원하지 않는다.
- 검증: [핵심 회귀](automatic-approval-verification-04.json)의 소스 206건 중 204건 통과·1건 플랫폼 제외, cache fixture 경로 실패 1건은 [cache 7/7 재검증](automatic-approval-verification-06.json)으로 해소했다. 이후 제품 변경은 승인 카드의 키보드·배치에 한정되며 [최종 관련 주입 검사와 승인 UI 198건](automatic-approval-verification-08.json), [설정 UI 30건](automatic-approval-verification-05.json)이 exit 0이다. 실제 pinned React/CSS의 light/dark·좁은/넓은 화면·Enter/Space·반복 클릭·Team 요청 원본 라우팅·카드 여백을 확인했고 소유 브라우저의 실제 exit 0과 프로세스 부재를 확인했다. 실패·준비 오류를 성공으로 덮어쓰지 않았다.
- 실행 중 재시험 원인: 성공 fixture의 resize 후 관찰 필드, 옛 시큐리티 앱 기대값, 격리 환경 실행기·폰트·UI 경로를 보완했다. 승인 카드 시작 문제는 짧은 소유 profile 경로와 기존 통과 검사 flags를 재사용해 해소했으나 각 원인의 기여를 분리 측정하지 않았다. 키보드 활성화를 설정 버튼 안에 한정했고 360px에서 native 본문 여백을 보완했다. 원래 결과와 실제 시간은 각 검증 기록에 보존한다.
- 최종 소스 9개의 현재 hash가 수락한 고정 입력과 일치하고 node --check·범위 diff --check·feature inventory 검증을 통과했다. 모델 도구는 25개, 앱 전용 ui_operation 1개다. 공유 라우팅 helper의 승인 카드 cache 의존성을 보존 inventory·기존 검사에 연결했다. 설치·실사용 앱 입력과 다른 OS 수락은 주장하지 않는다. 기존·동시 변경을 안전하게 분리하지 못해 task commit은 만들지 않았다.
- 정리: 이번 준비·검증 8개 그룹의 register/review/apply/finalize가 모두 exit 0이며 실제 payload 부재와 빈 참조를 확인했다. 논리 크기 1,013,310,592바이트를 삭제했고 물리 회수량은 측정하지 않았다. 원래 실패 6건·성공 2건과 자식·브라우저 종료 근거는 [독립 최소 정리 기록](automatic-approval-cleanup.json)에 보존했다. 다른 작업·설치본·기존 보존 승인 범위는 변경하지 않았다.
- 테스트 보존: 기존 자동 승인·중지·late reply·Team 라우팅 검사를 실제 작업 호출로 이전했다. 향후 승인 처리를 별도 도구로 분리하거나 재검증을 생략하는 편집, 설정 링크가 카드를 종료하는 편집, 공유 라우팅 helper를 바꾸면서 승인 카드 cache 무효화를 빠뜨리는 작업을 막는 최소 검사를 기존 suite에 유지한다.

## 개별 제어와 전체 화면 제어

상태: 소스 구현·관련 자동 검증과 소유 창 질의·커서 표시 실기 검증, 이번 시험의 정리 완료. 설치·배포는 범위 밖이다. [최종 수락 근거](desktop-acceptance-01.json).

- 기존 개별 창 UI Automation 요소 기반 제어를 유지하고, 선택 창 바인딩 없이 화면 좌표로 조작하는 전체 제어를 별도 MCP 도구로 제공한다.
- 전체 제어 승인은 현재 대화에만 유지한다. 사용자 중지·권한 취소·대화 종료 시 해제하며 일반 턴 종료와 구별한다. 전체 권한을 상속한 개별 제어는 같은 제한을 따르며, 진행 중 권한을 다른 승인으로 자동 우회하지 않는다.
- Security App의 한국어 표기는 시큐리티 앱, 화이트리스트는 그대로 사용한다. 저장 필드 observationBlockedApps/controlAllowedApps는 보존한다. 시큐리티 앱은 관찰 승인과 전체 화면 마스킹을 유지하며 전체 제어 중에도 대화별 추가 승인이 필요하다. 충돌 시 화이트리스트보다 우선한다. 화이트리스트는 전체 제어 승인 자체를 생성하지 않는다.
- 사용자·모델 커서, gesture FIFO, Stop, 준비 복구와 부분·불확실 입력의 무재전송을 재사용한다. 개별 UIA 조작은 실제 요소 위치에 모델 커서를 표시하되 물리 클릭을 중복하지 않는다.
- 플랫폼: 권한 의미와 도구 계약은 공통, 실제 입력·커서 수락은 로컬 Windows x64다. Linux/macOS 활성화, 보호 데스크톱·다른 사용자·권한 경계 우회는 제외한다. 각 gesture는 검증된 대상에 고정하며 앱 간 드래그 지원을 주장하지 않는다.
- 실행: 저장소·설정 이름, host 승인 수명, native 대상 검증을 독립 소유로 진행하고 root가 policy/MCP/adapter 계약과 통합을 담당한다. 고정 입력 뒤 네이티브 컴파일을 직렬 실행한다.
- 수락: 독립·상속 권한, 목록 충돌, 대화 격리·중지·취소·늦은 승인, 새 화면 관찰과 실제 대상 신원, 개별 UIA 보존·표시 전용 커서, 관련 소스·네이티브·렌더링 검사를 확인한다. 실제 사용자 창 입력 시험은 사용자 준비 확인 뒤 수행한다.
- 검증: 초기 22개 파일 검사에서 213건 중 5건이 실패했다. fixture 두 건·새 관찰 토큰 기대값·정형 오류 분류를 수정하고 격리 환경 동기화 timeout을 재시험했다. 최종 영향 범위 8개 파일은 66/66 통과(exit 0), 실제 격리 환경 동기화 거래도 재시험에서 통과했다. 초기 실패를 성공으로 덮어쓰지 않고 [소스 결과](desktop-source-results.json)와 각 run 보고서에 보존했다.
- 네이티브: 최신 C++ 렌더 전용 검사와 Rust test/build는 모두 exit 0이다. Rust 요청 dispatcher 누락을 발견해 수정 후 별도 고정 입력으로 다시 컴파일했다. [Rust 결과](desktop-native-r2.json). 승인 카드는 실제 pinned UI 함수로 light/dark·넓은/좁은 폭 134개 검사, 설정은 28개 검사를 통과했고 브라우저 종료도 확인했다. [승인 UI](desktop-approval-render.json), [설정 UI](desktop-settings-render.json).
- 실기: 관리 claim release의 종료 미확인 오류를 보존한 뒤 지원된 acquire/release의 실제 exit/close 0으로 현재 가용성을 확인했다. 새 소유 창 시험은 11개 검사와 controller exit 0을 확인했다. 두 창 retarget 시 broker PID 유지, titlebar·client 밖 표시 전용 위치, UIA 요소 위치와 image 관찰 보존·stale 거부를 검증했다. 두 broker·Rust·fixture는 모두 exit/close 0이며 두 HWND 부재를 확인했다. [진단과 종료 근거](desktop-runtime-smoke.json), [관리 가용성 근거](desktop-claim-recovery.json). 전달·활성화 입력은 0, 전경은 유지됐다. 물리 입력·사용자 앱 조작·설치본 반영은 수행하지 않았다.
- 테스트 보존: 기존 host/policy/provider 테스트에 전체 권한 상속·중지 epoch·시큐리티 앱 충돌과 표시 전용 입력 경계를 추가했다. 향후 개별 제어로 경로를 단순화하면서 전체 권한을 영구 앱 승인으로 우회하거나 표시 커서가 물리 입력을 중복시키는 편집을 방지한다. 새 native method 추가 시 dispatcher 갱신 누락을 막는 기존 dispatch 검사를 확장했다. 생성 fixture와 raw 로그는 별도 정리 대상이다.
- 정리: 이번 시험 13개 그룹, 논리 크기 1,923,302,031바이트를 지원된 owner apply(exit 0)로 삭제하고 모든 payload·lifecycle record 부재를 확인했다. 최초 finalize 응답의 unknown은 현재 record 부재로 조정하되 성공 exit로 바꾸지 않았고, 나머지 12개는 실제 helper exit/close 0을 확인했다. [그룹별 결과](desktop-cleanup-01.json). 최소 검증·종료 근거만 이 작업 기록 아래 보존했다. 실제 디스크 회수량은 측정하지 않았다.
- 완료 제한: Windows 로컬 x64에서만 네이티브 실행을 검증했다. 제품 설치·배포와 실제 사용자 앱의 새 전체 화면 물리 입력 시험은 별도 작업이다. 기존·동시 변경이 넓게 섞인 checkout에서 이 작업만 안전하게 분리할 수 없어 task commit은 만들지 않았다.

## Window Use 단순화와 폐기 범위

상태: 앱 기반 권한 모델과 폐기 경로를 소스에 구현하고 통합 검증 중이다. 설치본은 변경하지 않았다.

- 요청 범위: 숫자 단계 구분을 제거한다. Windows 자식 세션 실행과 기존 Computer Use 데스크톱 제어는 전용 구현·도구·지침·패키징·관련 검증을 식별해 아카이빙하고 활성 경로에서 제외한다. 유지할 창 관찰·제어가 공유하는 승인, 취소, 대상 검증 코드는 먼저 분리한다. 단순히 이름에 computer-use가 있는 파일을 일괄 이동하지 않는다.
- Window Use 활성화 중 기본 관찰은 기존 1단계 기능과 전체 화면 캡처를 포함한다. 관찰 블랙리스트 대상은 승인이 필요하다. 화면 조작은 개선된 현재 세션 창 제어를 사용하며 기본 승인이 필요하고 화이트리스트로 생략할 수 있다.
- 제안: 기본 제공 MCP 도구와 기능 활성화에 연동되는 짧은 내장 지침을 사용한다. 권한은 호스트가 매 호출 검증하고, 별도 Computer Use/Window Use 스킬 배포와 단계별 가이드를 대체한다. 스킬 로드 여부를 권한 근거로 삼지 않는다.
- 예외 목록은 앱 단위로 적용한다. 승인된 앱의 여러 창에 적용하되 대상 창과 프로세스 수명은 매번 재검증한다. 관찰 블랙리스트와 제어 화이트리스트는 독립이다.
- 전체 화면 캡처에서는 관찰 블랙리스트 앱 영역을 가린다. 개별 창 관찰은 별도 관찰 승인을 요청한다. 제어 화이트리스트로 관찰 승인을 우회하지 않는다. 캡처 중 창 변화·알 수 없는 신원·잘못된 좌표를 감지하면 이미지를 반환하지 않는다. Windows 비동기 창 이벤트와 합성 화면을 원자적으로 결합하지 못하므로 완전한 개인정보 격리로 주장하지 않는다.
- 범위: 권한 의미와 도구 계약은 공통 설계, 실제 Window Use 기능은 현재 Windows 전용 정책을 유지한다. 이번 변경만으로 Linux/macOS 기능을 활성화하지 않는다. 기존 사용자 중지·OS 보호·불확실 입력 재전송 금지는 유지한다. 기존 포괄 승인과 폐기 단계 승인의 신규 예외 목록 자동 변환 여부는 구현 전에 명시한다.
- 조사 근거: `scripts/use-control-settings.cjs`는 schema 2 단계별 플래그를 저장한다. `scripts/window-use-approvals.cjs`는 `computer-use-approvals.cjs`의 window 모드를 공유한다. `scripts/window-control-host.cjs`에는 단계별 권한, 자식 세션, 데스크톱 권한, Switched 입력 연결이 공존한다. 활성 문서와 설치된 window-use 스킬도 네 단계 지침을 제공한다. 아카이빙과 새 권한 모델의 경계를 정한 뒤 이 소유 경로들을 함께 이전해야 한다.

## 목표와 현재 권한

### 사용자 마우스와 모델의 협업

- 합의한 목표: 평소 사용자 마우스가 동작하고 Window Use 모델과 함께 사용할 때 사용자와 모델의 커서 좌표를 따로 유지한다. 사용자 클릭은 모델 작업을 중단하거나 협업을 종료하는 제어권 반환 요청이 아니다. 화면 관찰·모델 생각 대기 중에는 입력을 점유하지 않는다. 현재 Windows 로컬 x64 범위와 실제 앱 수동 MCP 시험 원칙을 유지한다.
- 초기 구현 범위는 사용자 승인한 일반 마우스 협업이다. 모델 press/text는 유지하며 실제 사용자 keyboard/IME 입력은 정상 통과시키고 모델 입력은 안전 중지한다. 사용자 keyboard·한글 IME까지의 FIFO/포커스 독립성은 이 단계의 수락 대상이 아니다. absolute/touch/pen 및 Raw Input 소비 앱은 지원을 주장하지 않고 감지 가능한 미지원 상태에서 fail-open 처리한다. 일반 relative mouse도 low-level 억제 중 Raw Input 생존을 짧은 명시 수동 probe로 확인하기 전 활성 지원으로 보고하지 않는다.
- 착수 시 차이: 이전 prototype은 외부 입력을 epoch interruption으로 처리했다. 현재 개발 소스는 명시적 협업 활성화·relative-mouse 수집·gesture FIFO·atomic press·제한된 준비 복구를 연결했다. 이 소스 구현과 실제 앱 수락은 구분하며, 현재 own-injected Raw Input 분류를 수정 중이다.
- 구현 후보: Raw Input으로 사용자 이동을 별도 수집하고 모델 소유 중 legacy 물리 mouse event를 최소 hook에서 억제한다. 사용자 overlay와 실제 OS cursor를 구분한다. RIDEV_NOLEGACY는 등록 앱에 관한 동작이므로 전역 분리 근거로 취급하지 않는다. hook timeout/removal, raw-input 앱, 가속/절대 장치, 최신 사용자 좌표 복귀는 미검증이다. 기존 MouseMux 전체 구현과 동등하다고 주장하지 않는다.
- 순차 처리 제안: broker 접수 순서에 따라 사용자·모델의 짧은 동작을 FIFO로 실행한다. click down/up, drag down/path/up, modifier chord를 각각 분리되지 않는 단위로 본다. 모델 drag 중 사용자 click은 drag 뒤, 그 후 접수된 모델 동작보다 먼저 실행한다. 양측 cursor move는 독립 위치 갱신이며 큐에 쌓지 않는다. 모델 작업 전체를 한 묶음으로 점유하지 않는다. 현재 native의 16개 문자열 요청 큐는 모델 요청만 처리하고 key down/up이 별도 요청이므로 이 계약을 구현한 것으로 간주하지 않는다.
- 전경/가림 복구 목표: foreground 변경이나 가림만으로 전체 작업을 즉시 멈추지 않는다. 모델의 차례에 새 관찰 → 승인된 exact target 전경 활성화/허용된 복원 → 새 화면과 hit/focus/intent 확인을 수행한다. 초기 기술 한도는 동일 intended operation에 복구 최대3회·active recovery 총5초이며 먼저 도달한 한도를 적용한다. 사용자의 선행 gesture 실행 대기는 복구 시간에서 제외하고 다음 복구 시도는 선행 사용자 요청을 앞지르지 않는다. 단순 요청/캡처 반복으로 예산을 초기화하지 않는다.
- 복구와 중복 입력 경계: 앱 입력이 아직 전달되지 않은 것이 확인된 경우에만 준비 복구 후 실행한다. 일부/불명확한 click·drag·key/text는 tracked synthetic held를 해제하고 새 화면으로 효과를 확인한 뒤 다음 동작을 판단한다. 원래 mutation 자동 replay·가림창 click-through는 하지 않는다. 명시적 stop·권한 철회·target 교체·해제 실패는 복구 우회 대상이 아니다. 예산 소진 시 해당 모델 동작을 멈추고 사용자 일반 입력은 유지하며 실제 시도/마지막 blocker/부분 효과를 보고한다.
- 확정 경계와 남은 검증: 사용자 mouse gesture는 최대2초/128점, queue16, human intent5초 expiry로 제한한다. keyboard/IME FIFO는 이번 범위 밖이며 물리 keyboard는 그대로 통과하고 모델 입력을 멈춘다. target/focus/geometry/leaf를 고정·재검증한다. 실제 경로 분리·사용자 FIFO·전경 복구·종료 후 정상 입력이 수락 대상이다.
- 다음 소유/인계: root가 전환 정책과 Window Use host/MCP 권한 계약을 소유한다. native routing은 확정된 정책을 입력으로 사용하고 기존 stage/app/stop 경계를 보존한다. 드라이버·DLL 재도입·설치본 교체는 이 조사로 실행하지 않는다. 독립적인 준비 작업은 기존 구현과 공개 Win32 API 확인 및 설계 기록이다.
- 실행 분담/순서: 2026-11-02 12:46 UTC의 계약 검토와 함께 native owner가 native/multi-pointer 내부의 press·3회/5초 복구·물리 mouse 큐·raw capability probe를 구현한다. root는 scripts/multi-pointer-mcp.cjs와 유지 검사에 collaboration/press 및 safe-integer operationId를 연결하고 native 종료 결과를 부모 exit에 반영한다. native contract/source freeze 후 기존 check-multi-pointer-native로 새 immutable run을 만들어 검증 준비한다. 실제 앱은 새 MCP에 직접 연결해 한 동작씩 확인한다. host map은 기존 virtualInput 승인이 DLL 전용임을 확인했으며 협업 runtime을 이 승인으로 위장하지 않는다. 상시 Window Use 연결은 별도 명시 backend 권한·패키지 경계를 보존해야 한다.
- 검증: project_tests multi-pointer-mcp-source, run-42784-5284-1793623716574113100에서 source2개 pass/exit0·input integrity valid. 종료 실패/불명확 exit 및 atomic press/schema 경계를 기존 검사에 포함했다. source 검증은 native/app 수락을 대신하지 않는다. 단조 operationId와64개 outcome ring/high-watermark로 동일 작업 재전송을 막고, 종료 결과는 native_closed 영수증으로 남긴다.
- host 검증: 초기 시도는 Python PATH·공유 catalog 관찰 충돌·중첩 fixture 경로 길이로 실패했다. fixture 경로를 줄이고 beginArtifactRun의 catalog 관찰에 기존 lease를 적용했다. run:EZ01:coop-frozen-mvzb3twu의 고정된 8개 파일·56개 검사는 모두 actual exit0, frozenInputsUnchanged:true (2026-11-02 13:40:49–13:41:07 UTC). reports/source-results.json과 logs/source.stdout.log가 근거다. 실제 마우스 협업 증거를 대체하지 않는다.
- 수락 항목: 사용자 이동 중 모델 drag 경로 보존, 사용자·모델 동작의 접수 순서와 gesture 비혼합, 사용자 click 뒤 모델의 정상 계속 처리, 지연 중 target 변화 처리, 부분/완전 가림과 foreground 변경 후 제한 복구, 복구3회/5초 소진·부분 mutation 무재전송·user stop 보존, 종료 후 일반 사용자 입력 유지, held-state와 연결 오류 회수, 동일 Paint에서 실제 렌더링, 모델 종료 코드 전달, 단계/권한/취소 회귀. 앱 조작은 MCP 연결로 하나씩 수행하고 결과 화면을 확인한다.
- API 근거: [Raw Input registration flags](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-rawinputdevice), [LowLevelMouseProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc), [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput). 지속 설계는 [multi-pointer](../../docs/architecture/multi-pointer.md#user-and-model-collaboration)가 소유한다.

### 현재 실행 방향

사용자는 자체 DLL 방식 포기 후 MouseMux를 Ghidra로 분석하고 다중 마우스 입력을 재현하여 MCP로 직접 사용하는 시험까지 요청했다. 기존 DLL 경로의 성공한 Win32 fixture와 실패한 Paint 결과는 근거로 보존하되 추가 DLL 개발·설치의 기반으로 간주하지 않는다. 이 절의 현재 방향이 아래 종전 DLL 제안의 실행 우선순위를 대체한다.

- 대상: Windows 로컬 x64, 현재 사용자 일반 데스크톱. Linux/macOS, x86, 보호/상승 프로세스, 커널 드라이버 설치는 현재 대상이 아니다. 기존 앱·단계 권한과 user stop을 보존한다.
- 도구: 공식 Ghidra 12.2 Headless(해시 고정)와 작업 로컬 JDK25, 설치된 LLVM PE 검사, 필요한 읽기 전용 실행 상태 관찰. 전역 Java/PATH·MouseMux 설치본·라이선스 상태는 수정하지 않는다.
- 분석 입력: 설치된 MouseMux3.0.19의 main.exe, winhooks64.dll, 필요 시 reloader 모듈과 공개 SDK. 입력 사본 SHA와 원본 provenance를 기록한다. 라이선스/체험 제한 우회와 바이너리 패치·배포는 목표에 포함되지 않는다. 관찰한 시스템 API·상태 전이의 독립 구현이 목표다.
- 순서: PE import/export/입력 관련 문자열 → Ghidra 함수·호출 관계/관련 함수 디컴파일 → 수집/가상 상태/커서 표시/앱 전달 경로 구분 → 최소 재현 backend → MCP 등록/실제 호출 → 화면 효과와 전경·물리 커서·동시 입력/해제 검사. SDK wrapper만으로 자체 재현 완료를 주장하지 않는다.
- 분담: root는 Ghidra/실행 가설·최소 구현·수락을 소유한다. read-only `mousemux_integration_map`은 기존 SDK 및 MCP 연결 owner를 조사한다. 분석 결과와 실제 ABI/상태 계약이 준비된 뒤에만 의존 구현을 시작한다.
- 실제 앱 시험은 사용자 요청으로 MCP 연결 유지 후 root가 도구를 한 번씩 호출하고 화면을 확인하는 방식으로 수행한다. 자동 동작 묶음·루프·한 번에 여러 시나리오를 실행하는 앱 시험은 중단했다. 컴파일/프로토콜 준비 검사는 실제 앱 조작을 대신하지 않는다.
- 수락: 독립 커서 최소2개, 가상 포인터별 위치/held 상태 구분, 실제 앱 click/drag/text 효과, 다른 포인터 상태 보존, 중지·연결 종료 시 release, MCP 실제 요청/응답과 화면/앱 결과의 일치. 호환 앱·동시성·전경 변경은 각각 실제 결과로 보고하며 응답 success를 앱 성공으로 대체하지 않는다.
- 사용자는 Switched부터 구현·시험하도록 선택했다. 여러 논리 커서는 위치를 따로 유지하지만 실제 클릭/drag/key/text는 하나의 OS 입력과 foreground를 사용한다. 두 창 완전 동시 클릭·background-only·물리 입력 독립성은 이 모드의 보장이 아니다. 이 가시적 차이를 MCP 안내와 실제 시험 결과에 유지한다.
- Ghidra `run:EZ01:mmga-mvz390ao`는 winhooks78885ms/main147230ms, 각각 exit0이며 입력 관련 후보3/269개와 최대140개 함수의 제한된 디컴파일을 생성했다. main `FUN_140021bb0`의 virtual desktop 좌표 정규화·태그된 SendInput 경로, 별도 cursor 위치/keyboard thread attach 및 state 경로를 확인했다. 전체 프로그램 복원이나 모든 mode 경로 확인을 뜻하지 않는다. 독립 구현은 공개 Win32 API를 사용하고 코드/상수/offset을 복사하지 않는다. 첫 분석의 필수 JVM class loader 누락 실패(exit1)는 별도 실패 run으로 보존했다.
- 공식 매뉴얼은 Switched의 클릭 차례 전환과 Multiplex의 별도 창 클릭을 구분한다. 그림판에는 hardware dragging이 필요할 수 있고 hardware keyboard는 단일 foreground에 한정된다고 설명한다. 따라서 같은 기법의 독립성과 앱 호환성은 분석·실험 전까지 미확정이다.
- 새 산출물은 `run:EZ01:mmre-<unique>`의 inputs/temporary/outputs/logs/reports에 생성 전에 등록한다. 도구/분석 DB/원본 사본은 진행 중 분석 소비자가 소유하며 사용 종료 시 기존 owner로 정리한다. 이전 DLL 산출물의 종료 참조·정리도 기존 승인/보호에 따라 이어서 처리하며 완료로 간주하지 않는다.
- Switched 소스 `native/multi-pointer`와 `scripts/multi-pointer-mcp.cjs`, 최소 protocol 보존 검사2개를 작성했다. 두 검사는 실제 앱 수락을 대신하지 않는다. Paint50984/57180의 exact PID/생성시각/exe/root를 다시 확인하고 입력 없는 기준 캡처를 남겼다. 네이티브는 Windows/Alt/shell-switch 단축키를 제외하며 스레드별 키보드 state 부착/DLL을 사용하지 않는다.
- `run:EZ01:mp-mvz463w1`의 mcp-source207ms/configure20009ms/compile13541ms는 각각 exit0이었다. 실제 stdio smoke 프로세스 exit0과 달리 request3 상태 조회는 오류였으므로 전체 checker는 exit1이다. read-only native 진단으로 두 Paint 모두 minimized:true/visible:true/enabled:true인 것을 확인했고 target_unavailable/actionExecuted:false로 시작이 거절됐다. 이 시작 오류를 MCP가 응답 ID 오류로 가리던 부분을 고쳐, 실제 MCP의 상태 조회에서 원래 target_unavailable 이유를 확인했다. 앱 입력은 아직 전송하지 않았다.
- 변경 없는 native runtime/manifest는 재사용하며 바뀐 MCP/검사 source는 `temporary/switched-mcp-836cb3c2a5d8272a`에 별도 freeze했다. 해당 고정 소스 검사2개 exit0이다. native runtime 소비 참조는 기존 active root run에 지원된 helper로 추가한다. 사용자에게 두 그림판 복원을 요청했고 해당 준비가 끝날 때까지 실제 입력 시험을 보류한다. 분석의 독립 최소 근거는 root run `reports/mousemux-analysis-summary.json`, 시작 음성 시험은 `reports/multi-pointer-startup-negative.json`이다. 전체 task commit·실앱 수락·필수 정리는 미완료다.
- 등록된 `multi-pointer-native-paint-ez01` plan의 argv/input/guard를 검토했다. 현재 연결된 관리 runtime의 실행 요청은 maintenance/catalog busy에서 거절됐고 runID나 producer를 반환하지 않았다. 대기600000 요청도 구형 runtime의 상한5000 검증에서 거절됐다. 기존 종료/실패 결과는 보존하고, 동일 checker argv를 `exec_command`의 새 work_completion으로 실행한다. checker는 지원된 현재 lifecycle/catalog owner(최대600000ms)로 동일 잠금 취득을 기다린 뒤 소스를 freeze/컴파일하고 실제 MCP handshake/status/stop을 실행한다. 잠금 우회·삭제는 하지 않는다. 이 수동 실행은 등록 tool run이 성공했다는 영수증을 생성하지 않으며 checker 자체 결과와 입력 대조를 독립 근거로 사용한다.

사용자는 MouseMux 시험 후 Azrael에 필요한 가상 마우스·키보드만 자체 구현하도록 요청했다. MouseMux의 관찰 가능한 동작과 제공 SDK/프로토콜을 분석하고, Azrael의 기존 구현과 공개 구현을 조사하여 최소 경로를 만든다. 그래프/노드/범용 자동화 툴·다중 물리 장치 관리·MouseMux 런타임 의존은 요구하지 않는다. 앱 작업 자체는 마우스 클릭·키 입력으로 수행하며 RunProgram/셸/UIA 값 교체로 실제 입력 시험을 대신하지 않는다.

제품 소스 변경과 관련 검증은 이번 요청으로 승인됐다. 설치된 Azrael 교체·공개 배포·보호 프로세스/권한 상승·보안 설정 변경은 현재 실행 범위에 포함하지 않는다. 기존 Window Use 입력 사용 거절과 이후 읽기 전용 캡처 허용은 시험 도구 사용에 대한 결정이며 제품 개발의 앱/단계 권한을 약화하지 않는다.

플랫폼은 현재 Windows 로컬 x64 사용자 세션이다. Windows 11 Home build26200에서 MouseMux 표시만 확인했으며 자체 backend 소스와 host/provider 통합을 구현했으며 소유 Win32 fixture 검증을 통과했다. Linux/macOS 활성화와 child session 대체는 범위 밖이다. 앱/CPU/ABI 지원과 실제 확인 범위를 구분한다.

## 중단한 DLL 경로와 보존할 검증 한계

종전 구현은 승인한 일반 앱 프로세스에 작은 x64 DLL을 로드하고 입력 관련 API를 후킹했다. 소유 Win32 EDIT fixture에서는 성공했지만 실제 Paint에서는 전달된 메시지가 화면 효과로 이어지지 않았다. 사용자가 이 방식을 포기했으므로 추가 DLL 구현·배포는 실행하지 않는다. 새 분석이 MouseMux 내부 DLL 사용을 발견하더라도 이 사실을 숨기거나 동일 실패 경로를 성공한 것으로 재분류하지 않는다.

대상 앱 안에 DLL을 로드해 입력 API를 후킹하는 방식을 사용자가 승인했다. 우선 별도 테스트 프로세스에서 부착/해제와 실제 클릭·키 입력을 검증한다. 이 방식은 앱 프로세스의 실행을 변경하며 충돌 가능성과 앱별 호환성 차이가 있다. 프로세스 변경을 허용하지 않는 대안은 창 메시지 어댑터이며 키 상태/포커스 일관성의 호환성 범위가 더 좁다. 이를 동일한 가상화로 취급하지 않는다.

초기 fixture의 Unicode/shortcut/해제 성공은 현대 Paint, 한글 IME/TSF, x86/WOW64, 사용자 동시 입력의 증거가 아니다. 새 다중 마우스 구현에서도 가상 상태와 실제 앱 입력을 각각 확인한다. 설치된 Azrael2026.0.16은 기존 검증된 설치 owner를 유지하며 이번 조사로 교체하지 않는다.

## 처음 사용하는 사용자의 이용 흐름과 전면 활성화

사용자는 처음 Azrael을 쓰는 사람도 문제없이 활용할 수 있어야 한다는 요구를 추가했다. 일반 사용자가 DLL 파일, PID, 좌표 배율, 가상 키 코드, Input Mapper/Arm/그래프를 직접 구성하지 않도록 제품이 버전/비트수·권한·앱 호환성을 검사하고 승인한 창의 준비/해제를 관리한다. 사용자 동의가 필요한 앱/단계 권한은 기존 경계대로 남긴다. 자동 준비와 앱별 실제 수락 검증은 별개다.

DLL inline hook의 적용 지점은 로드된 프로세스의 API이며 창별 안전 경계를 자동 제공하지 않는다. 사용자는 승인한 한 프로세스의 여러 창 제어를 허용했다. 승인 단위는 정확한 PID/생성시간/실행파일 identity로 식별하는 프로세스로 확장하고, 그 프로세스의 HWND·자식 컨트롤·UI thread와 input context를 검증해야 하며, HWND 인자가 없는 GetCursorPos/GetAsyncKeyState 계열과 동일 프로세스의 여러 창/worker thread에서는 추가 context 설계가 필요하다. 동일 실행파일의 다른 프로세스·자식 프로세스는 자동 승인하지 않는다. 프로세스 내부 여러 창 제어와 외부 프로세스로 넘어가는 popup은 구분한다. 프로세스 DLL 후킹은 사용자 승인 완료다.

권고 동작은 background 창에 논리 cursor/key/focus/capture 상태를 제공하고 실제 foreground/focus와 Z-order를 바꾸는 입력 경로를 사용하지 않는 것이다. 가상 focus를 조회 API에서 제공하는 것과 OS 전체 foreground를 실제 변경하는 것은 다르다. 앱의 자체 activation/모달/다른 프로세스 동작으로 전면화가 생길 수 있어 가림 상태에서 실제 사용자 foreground 및 Z-order 변화와 대상의 입력 결과를 각각 측정한다. 전후 한 번의 snapshot으로 순간 전면화 부재를 보장하지 않는다. 미지원/간섭 시 새 입력을 멈추고 사용자에게 상태를 알려야 하며 실제 시스템 커서로 자동 전환하지 않는다. 이 전면화 완화는 제안이며 현재 구현/검증 결과가 아니다.
## 확인한 현재 구조

- 소유 계약: [Window Use](../../docs/architecture/window-use.md), 보존 feature `ui.window-control`와 [다중 플랫폼](../../docs/architecture/multi-platform.md).
- `native/window-control/src/windows_backend.rs`: 기존 WGC/UIA, DPI 인식, target identity/lifetime watcher와 observation을 소유한다. `uia.rs`의 제한 키 입력은 exact HWND 검증 후 PostMessage다. 가상 커서/키 상태 엔진은 없다.
- `scripts/window-control-policy.cjs`: 대화별 binding 하나와 공용 직렬 실행. 요청 시 앱·단계 권한, 중지, 관찰 freshness, occupancy를 검사한다. 가상 사용자/다중 창의 승인 범위를 자동 확대하지 않는다.
- `native/windows-child-session/ChildSession.cs`: 별도 세션의 SendInput을 이미 사용한다. 부모 세션에 가져오면 공유 입력 문제를 해결하지 못하므로 자체 가상 상태 엔진으로 대체한 것으로 주장하지 않는다.
- `native/window-control/Cargo.toml`: windows 0.58, serde, png 등 기존 라이브러리. 조사한 manifests에서 MinHook/EasyHook/Detours 의존을 찾지 못했다. 기존 승인/관찰/중지/전송을 재사용하고 별도 무제한 입력 endpoint를 만들지 않는다.
- 관련 native/window-control와 window-control host/policy 및 window-use.md는 조사 시 git status 변경이 없었다. 저장소 전체에는 다수의 다른 작업 변경이 있어 보존한다. 엔진 변경이 필요하면 실제 엔진 source owner를 먼저 해석한다.

## 분석 근거와 재사용 선택지

1. MouseMux V3 3.0.19 + Input Mapper2.2.38을 실제 설치·실행했다. 공식 로컬 MCP는 localhost41760, SDK는41001이다. Arm 뒤 가상 사용자 생성과 pointer.motion 요청을 처리한다. 폐쇄된 native 가상화 엔진의 정확한 내부 후킹 구조는 아직 확인하지 못했다. SDK JavaScript와 native 실행 로그가 내부 전체 구현의 증명은 아니다.
2. 제공된 MCP move_cursor는 sdk.send 직후 moved true를 반환한다. click tap은 button1 뒤 button0을 보내고, native 로그에는 button0 invalid mask 및 held-button safety release가 남았다. SDK LEFT_UP 상수는2다. 성공 응답을 앱 처리 완료로 취급하지 않는다. 이 코드를 자체 제품으로 복사하지 않고 독립 상태 계약과 검증을 작성한다.
3. [Microsoft PostMessage 설명](https://devblogs.microsoft.com/oldnewthing/20050530-11/?p=35513/)은 메시지 큐 삽입이 키 상태를 갱신하지 않음을 설명한다. [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)은 공유 input stream과 기존 키 상태/UIPI 제약을 가진다. 이들 API만 감싸서 일반 가상화가 됐다고 주장하지 않는다.
4. [ProtoInput](https://github.com/Ilyaki/ProtoInput)의 공개 구현은 대상 프로세스 내 Windows API 후킹으로 커서·키 상태·포커스/입력을 조정한다. 게임 중심의 사례이며 일반 앱 호환성은 미검증이다. 전체 게임/컨트롤러/GUI/입력 잠금 기능은 필요하지 않다.
5. [MinHook](https://github.com/TsudaKageyu/minhook)은 x86/x64의 작은 API hook 라이브러리 재사용 후보다. 도입 시 버전/라이선스 고정, provenance/고지와 실제 hook 적용·실패·해제를 검증한다. MinHook 1.3.4와 nlohmann/json 3.11.3을 출처·라이선스와 함께 고정했다.

## 중단한 DLL 구현의 조사 범위

1. 허용된 후킹 범위를 확정하고 기존 window-use owning section의 draft/target을 갱신한다. 기존 stage3 child session 및 stage4 desktop의 의미를 유지한다.
2. target identity와 thread/window context에 연결된 native virtual-input 상태를 구현한다. 물리 픽셀 cursor, held button, key down/up 및 modifier 상태, 논리 focus/capture, Unicode text와 실제 키 이벤트를 구분한다. 생성/부착/입력/해제는 명시적 결과와 지원 범위를 반환한다.
3. 프로세스 내 최소 hook adapter를 구현한다. GetCursorPos/SetCursorPos, 키 상태 조회 및 대상 앱이 실제 사용하는 focus/capture 경로를 조사·선정한다. raw input/TSF 등 추가 경로는 실제 앱의 요구가 확인될 때 확장한다. DPI 및 HWND 재생성을 기존 owner와 연결한다.
4. 이미 승인된 정확한 앱/target에만 연결하고, 기존 중지·취소·권한 철회·대상 폐기 시 새 입력 차단 및 held state 정리를 구현한다. backend 실패를 실제 시스템 커서/키 입력으로 자동 전환하지 않는다. 사용자가 승인한 프로세스 단위 범위를 host 권한/target 집합에 반영하고, 다른 프로세스까지 승인됐다고 해석하지 않는다.
5. fixture → 시험 전용 일반 앱에서 실제 클릭/drag/wheel/key/text/modifier 처리와 해제 후 정상 입력을 확인한다. 성공 enqueue와 대상 앱의 실제 내용 변화를 따로 검증한다. 초기 호환성 결과로 앱 범위/IME 등의 수락 범위를 정한다.
6. host 통합, feature inventory/필수 검사, frozen-input build와 필요한 Windows 회귀를 진행한다. 제품 업데이트/설치는 별도 권한과 실행 절차를 적용한다. 빌드 전에 project-maintenance bundle과 산출물 owner를 확정한다.

root가 계약·runtime adapter/staging·검증 runner·문서·통합 수락을 소유한다. native/virtual-input은 전담 worker, host/policy/MCP는 별도 worker가 소유하며 서로 다른 파일만 수정한다. read-only explorer가 기존 권한/ceiling/packaging 연결을 조사했다. 순서 의존은 native source → frozen fixture compilation → 실제 fixture 입력/해제 → host 통합 수락이며, fixture 준비와 host source 검사는 독립 진행한다. 제품 배포 빌드는 선택하지 않았다.

## 수락 및 보존 검증

- 가상 커서 좌표/버튼/키 상태를 실제 앱의 관찰 가능한 클릭·편집 결과로 검증한다. 단위 상태 모사만으로 제품 성공을 주장하지 않는다.
- Unicode 텍스트, modifier, keyup/buttonup 누락, 연결 종료, 권한 철회, process/window 교체에서 결과·정리·중지 경계를 검증한다. IME 실제 조합/동일 프로세스 다중창은 지원 범위를 확정해 따로 시험한다.
- 기존 capture/UIA·관찰 전용 보장·stage별 권한·user stop·selectedWindow ceiling·Linux/macOS 비활성 정책을 유지한다. 기존 `test-window-use-stage-authority.cjs`, `test-window-use-host.cjs`, native 검사와 feature inventory mandatory checks를 변경 범위에 맞게 재사용한다.
- 성능은 idle/process별 메모리·CPU, 입력 지연 및 중지 지연을 fixture와 실제 앱에서 측정해 보고한다. 현재 MouseMux가 무겁다는 사용자 체감은 요구 근거이며 정량 baseline은 없다. 가벼움과 범용 호환성을 아직 보장하지 않는다.

## 앞선 MouseMux 시험에서 남은 유효 근거

- 사용자가 Trial/설치/UAC를 직접 진행했고 MCP/Arm/Multi-cursor를 켰다. 공식 trial 안내는 full30분 최대3회, Free limited45분/session이었다. 현재 trial 상태는 별도 재검증이 필요하다.
- 가상 hwid쌍0x3000/1,0x3002/3,0x3006/7 생성·좌우 이동·삭제를 요청했다. Multi-cursor 활성화 후 사용자가 커서 표시를 확인했다. 표시 성공은 물리 입력 독립성/모든 좌표 도달/문자 입력 성공의 증거가 아니다.
- SDK가 돌려준 이름·색은 native 실제 사용자 Aqua/색과 같다고 확인되지 않았다. list_users는 AppState.users를 읽으며 SDK virtualUsers 전체가 아니다.
- Start/Search는 managed list_windows에 없었으나 사용자가 실제 Start가 열렸음을 확인했다. 목록 부재를 실행 실패로 판단하지 않는다. 직접 Ctrl+Esc/notepad/Enter 요청 뒤 메모장 프로세스는 확인되지 않았고, 사용자가 메뉴 닫은 타이밍 충돌을 알려 재시도했다. 실제 검색 내용/IME 상태는 미관찰이다.
- RunProgram 노드 방식은 사용자 요구와 달랐으므로 중단했다. 이번 소유 노드1/2/3 제거 후 get_graph nodes=[]/connections=[]로 정리를 검증했다. 다시 사용하지 않는다.
- 사용자가 직접 연 메모장은 처음 api_key.txt였으므로 내용 캡처/변경을 하지 않았다. 사용자가 새 빈 탭을 연 뒤 제목 없음 Notepad 후보를 관찰하고 선택만 했다(target16ea92db-91dd-4dff-a960-0cac591345d2). 캡처/입력 전 turn이 중단됐다. 기존 문서는 건드리지 않았다.
- hwid0x3008/0x3009(12296/12297)은 새 구현 요청 시 destroy_virtual_user를 요청해 destroyed 응답을 받았다. 기존 로그로 server removal을 추가 확인 중이다. 자체 backend는 MouseMux 런타임에 의존하지 않는다.

## 산출물·정리

- 설치 exe: `artifacts/tasks/EZ-01-window-use-multipointer-review/runs/20261102-mousemux/temporary/mousemux-v3-setup-3.0.19.exe`, 76,443,272bytes. SHA256 `50C2A5567647C57F17B7E93F8007D3660E12B30B326D3AAE46D4719256EF0ED5`, Authenticode Valid/The MouseMux Company.
- 기존 등록 group `ez01-mousemux-20261102`/item `ez01-mousemux-installer`, active installation/test reference. 실험에서 reverse-engineering 입력으로의 실제 필요와 보호/reference를 재검토하고, 불필요 시 기존 maintenance owner로 삭제한다. 아직 삭제 완료 또는 보존 승인으로 보고하지 않는다.
- 설치된 MouseMux와 사용자 설정/로그는 공식 앱 owner가 소유한다. 광범위 제거·설정 수정은 하지 않았다. 자체 구현의 새 fixture/build 출력은 생성 전에 소유 경로와 lifecycle을 기록한다.
- DLL 후킹 승인 후 제품 native/provider/host 소스 구현을 진행 중이다. 빌드 준비·실제 fixture·host 수락 결과는 아래 실행 근거에 기록한다. 배포/설치본 교체는 수행하지 않는다.




## Native 검증 실행 관리 오류 진단
run-17084-4890-1793593788719169400은 before integrity만 기록됐고 실행 session/producer PID/실행 출력이 없다. 최초 dispatch는 maintenance_busy OS lock 오류로 반환됐다. runner는 컴파일 전에 beginArtifactRun으로 virtual-native-* run directory를 생성해야 하지만 해당 출력은 없으며, 전체 Win32_Process snapshot에서 runner/cmake/MSBuild/selftest/fixture의 해당 명령 실행이 없었다(조회 자신만 반환). 세 근거를 함께 대조해 pre-execution dispatch failure로 판단하며 시험이 실행됐다고 보고하지 않는다. unknown receipt는 보존하고 owner recover로 실행 보호만 해제한 뒤 새 attempt를 시작한다. 소스/결과를 성공으로 바꾸거나 잠금을 삭제하지 않는다.

## 최종 수락 근거

- Windows x64 medium-integrity 로컬 프로세스의 GUI thread에 입력 API를 후킹한다. 일반 대화의 `request_stage(stage:2, virtualInput:true)`로 정확한 process 범위를 명시 동의한다. 기존 semantic stage2 및 selectedWindow ceiling은 유지한다. 창 전환 시 기존 attachment 해제를 확인한 후 새 창에 부착한다.
- 최신 native 입력 SHA는 `d81dee971d5f643c68d02f0002912cbaa0c25259d2534bce9793b0f0bc30a950`다. configure/compile/selftest는 각각 exit0, selftest는 1117ms였다. Win32 v6 single-line EDIT와 multiline EDIT, 동일 프로세스의 동일/별도 GUI thread 창 순차 입력, Unicode/shortcut/held release/unload, 실제 OS foreground/Z-order와 물리 cursor/key 상태 유지를 확인했다.
- 최초 긴 경로의 CMake probe는 MSB6003으로 실패해 짧은 등록 run 경로로 해결했다. legacy multiline EDIT의 Ctrl+A 미선택은 v6 fixture와 실제 Home+Shift+End 선택 시험으로 구분했다. 한 번의 물리 cursor 변화 실패는 원인 확정 없이 보존했으며 최신 진단에서는 모든 detach 전후 cursor와 마지막 입력 시각이 같았다.
- native wrapper의 최종 exit1은 lifecycle reconcile 잠금 충돌이었다. 실제 terminal 근거로 producer를 failure/exit1로 close하여 원래 결과를 보존했다. 등록 예약 충돌도 정확한 종료·SHA/fence 증거로 owner recover했으며 성공으로 바꾸지 않았다.
- source 검증: provider 최초6개와 최신 변경5개, runtime14개, stage-authority26개, host-errors41개 및 host/policy/MCP/virtual-policy 통과. staging4개는 기존 Python313을 child PATH에만 지정한 재실행으로 모두 통과했고 임시 루트 부재를 확인했다. PS parser 및 source diff 검사도 통과했다. 상세 근거는 [검증](02-verification.json), [최소 native 종료 근거](03-cleanup-evidence.json)다.
- 유지 검사 이유: 이후 변경에서 global SendInput 대체, 승인 identity 완화, timeout 재전송, 패키징 dependency 누락, unload 조기 성공을 다시 도입할 수 있어 해당 경계를 검사한다. native fixture는 실제 앱 처리와 hook 제거를 확인한다.
- 실제 사람이 동시에 움직이고 타이핑하는 검증, 일반 앱·IME/RawInput 호환성, 패키지·설치본 수락은 미확인이다. 설치본은 변경하지 않았다.
- 일시 보존은 [정확한 8묶음](07-pending-cleanup.json), 총140,845,600bytes다. 사용자 승인 범위이며 관리 잠금 해제 시 identity·보호·참조를 다시 확인해 기존 standalone owner로 삭제한다. 설치된 MouseMux와 사용자 파일은 제외한다.

## 그림판 실사용 시험과 개발 런타임 반영

- 사용자는 겹친 그림판 두 창의 전경 전환·동시 클릭·텍스트 입력 시험과 개발 런타임 반영을 승인했다. 기존 설치 MCP에는 virtual input 기능이 없어 아직 그림판 입력은 시작하지 않았다. 설치 후 재연결과 실제 앱 수락은 남아 있다.
- 설치된 2026.0.14의 불변 기준 `artifacts/inputs/014ao/project`와 기존 검증 엔진·계정 VSIX를 재사용한다. DLL 입력 commit의 해당 변경만 기준에 적용하고, 배포 옵션 전달 3줄 및 필요한 패키징 연결을 포함한다. 동시 작업의 2026.0.15를 피하기 위해 작업 전용 패키지는 2026.0.16으로 준비하며 공유 버전 파일은 변경하지 않는다.
- 실행 소유자는 `run:EZ01:paint-install-20261102`다. 선택한 native runtime은 `run:EZ01:vi-mvys34ex`에 의존 참조로 보호했다. 기존 8묶음 보존 승인이 이 새 실행 전체의 잔여물 보존을 허용하는 것은 아니다.
- 배포 전달 선택 검사는 실제 mock 수신 경로를 확인하여 1/1, exit0으로 통과했다. 두 초기 fixture 실패는 원래 결과로 보존하고 owner 정리를 진행한다. 최소 검증은 실행 reports/deploy-forwarding.json에 있다. 작업 전용 PowerShell 7.6.9는 공식 SHA256·Microsoft 서명·실행 버전을 확인했으며 시스템 설치는 하지 않았다.
- 입력 고정→공식 배포의 원본/패키지/host 검사→설치→사용자 재연결→새 managed tool을 통한 두 프로세스 별 승인과 그림판 시험 순으로 진행한다. 실행 중 배포 파일 덮어쓰기나 사용자 창 종료·강제 새로고침은 하지 않는다.
- 입력 고정은 05:26:08–05:40:24 UTC, exit0으로 완료했다. manifest SHA256은 `876ad548279b91653d13c4aa8c461048a3647a4c8f08cbbb9028764311f75d3c`다. Git 적용 중 바뀐 native CRLF는 고정 전에 검증 당시 원본 바이트로 맞췄고 native source SHA가 기존 수락과 정확히 일치한다.
- 첫 배포는 source-fixtures의 TypeScript 미준비로 exit1, 빌드·설치 전에 중단됐다. 고정 작업 사본의 lockfile로 npm ci를 실행해 exit0을 확인하고 실제 TypeScript/node-pty 로드를 확인했다. UI 원본 43개 파일(58,142,337bytes)과 기존 CUA/과거 v3 fixture, 짧은 Cargo 경로 및 instruction engine을 준비했다. fixture 준비 61항목이 exit0으로 통과했다. 두 번째 identity는 소켓 경로 109bytes로 시작 전에 exit1이었고 검증 상태 생성·설치는 없었다. `artifacts/v-3/s`의 실제 길이 검사를 통과시켜 `win016-ez01-paint-r3-20261102`로 실행 중이다. 의존성·fixture는 무시되는 작업 출력이며 고정 제품 소스는 변경하지 않는다.
- 배포 전달 테스트의 3개 run과 빈 TEMP 3개, 총1,587,698bytes 정리는 managed-root 경계로 보류했다. 정확한 경로 추가도 root 자체 보호에 걸려 설정을 원복했다. 삭제는 실행하지 않았다. 사용자는 [잔여 목록](08-deploy-cleanup-pending.json)의 정확한 6개 경로를 관리 경계 문제 해결까지 일시 보존하도록 승인했다. 해결 후 기존 owner로 삭제한다. 기존 8묶음과 별개의 명시적 승인이다.
- r3의 source-fixtures/environment/dependency/source-preflight는 exit0이었다. build의 code-mode 호환성 검사는 기본 TEMP 아래 socket 경로가114bytes여서 exit1, 병행 source-tests는 종료 처리되어 exit-1이었다. native fixture owner는 cleanup exit0과 removed:true를 기록했다. 이 결과를 통과로 재분류하지 않는다. 제품 소스를 수정하지 않고 `artifacts/p`(같은 기본 socket106bytes)로 새 불변 실행 사본을 준비 중이며 그 경로를 owning 관리 설정에 명시했다. 기존 실패 작업의 보호는 유지한다.
- 짧은 사본 준비는 05:55:15–06:15:25 UTC(20분10초), exit0이었다. 새 manifest SHA는 `74e77fc7db4141aeec721baef5e7ca9f0ce7539e938bf7a2cd1e17fb46c0920e`, 제품 SHA는 이전과 같은 `aee2b4bef9f1f4d2058eccdd88dcbef032afde4e941638e05843e69aaee74d28`다. 새 사본의 npm ci, TypeScript/node-pty 실제 로드, fixture61항목을 통과했다. `win016-ez01-paint-r4-20261102` 배포를 이 사본에서 시작했다.
- r4는 proxy window 등록 startup deadline으로 exit1이었다. 병행 source-tests는 종료됐으며 통과가 아니다. 이후 공식 build를 단독 실행하고 나머지 source/feature/host/install 검사를 순차 실행하도록 조정했다. 원인이 자원 경합인지 짧은 TEMP 차이인지는 확정하지 않았다.
- 단독 r5에서는 engine/code-mode IPC 26항목이 passed였고 패키징·Computer Use staging을 진행한 뒤 외부 lifecycle catalog 잠금 획득 실패로 exit1이었다. 요청은 acquire에서 거절됐고 native worker의 exit 관찰은 false였음을 그대로 기록했다. 새 catalog lease 획득·해제 실제0 근거는 reports/catalog-readiness-r6.json이다. r6는 native Window Control/child-session/staging까지 통과한 후 고정 Bun 입력 부재로 exit1이었다. 해당 DLL manifest와 provider 포함을 확인했다.
- r7은 기존 Bun1.4.2 실행 파일(86,096,984bytes, SHA256 `15277c59ccd6c6c20f8dc9716c2b59c1776320d606b6a8658f70be8799519ca4`)과 다운로드 기록을 작업 소유 tools 경로로 복사하고 실제 버전·소유 cache 경로를 확인한 뒤 단독 공식 build로 실행 중이다. 새 기능·기존 Provider 기능이나 수락 기준은 줄이지 않았다. 최종 source 검사·정확 VSIX host 수락·설치와 실제 그림판 시험은 여전히 남아 있다.
- r7은 새 경로의 endpoint 10초 제한으로 exit1이었다. 동일 바이너리의 별도 진단에서 원본 1705ms/새 복사본 3835ms가 각각 exit0이었다. 지연의 원인은 확정하지 않았고 제품 제한을 바꾸지 않았다. r8 공식 build는 exit0이며 DLL manifest SHA `ceea82076422bb77a8b10940195e224b6ff4f5fe81e3676d7b98d7c67972b7f0` 포함을 확인했다.
- r8 선택 소스 검사는 06:53:42 UTC에 시작해 실행 중이다. 고정 입력과 성공한 빌드를 사용한 VSIX 준비 및 변경 없는 engine preservation을 병행한다. 소스·정확 패키지·새 프로필의 coexistence/standalone 수락이 모두 통과해야 설치한다. 원래 companion 도구 캐시 경로가 없어 첫 패키지 준비는 exit1이었다. 새 도구는 같은 고정 lockfile로 작업 run의 temporary/package-tools/companion에 설치한다. 첫 실패와 재시도 로그를 분리했으며 설치나 그림판 입력은 아직 하지 않았다.
- 첫 r8 소스 group은 2175개 중 pass2166/fail2/skip7, exit1이었다. 누락된 pristine virtualized-turn-list fixture를 정확한 SHA로 복사하고 음성 fixture-admission 검사의 instruction-root 환경을 제거해 해당 두 파일 26개를 exit0으로 재검사했다. 원래 실패 결과는 바꾸지 않았다. 이후 실행되지 않았던 build-module-cache/deploy-azrael/verification-state 3개 선택 command를 원래 argv로 실행 중이며 이를 포함해야 소스 수락이 끝난다. 첫 targeted 재시도의 maintenance owner pin 누락도 원래 exit1로 남겼다.
- 패키지 2차 시도는 공유 namespace 캐시 소유 모듈이 고정 소스와 달라 guard에서 exit1이었다. 공유 코드를 바꾸지 않고 작업 사본의 별도 namespace owner/cache로 package-r3를 준비한다. engine preservation 첫 시도의 source-preflight 환경 identity 불일치도 exit1로 보존하고, 동일 환경에서 새 preflight와 전체 phase를 연결한 별도 재시도를 시작했다. 모든 수정은 실행 입력/fixture 범위이며 고정 제품 소스를 바꾸지 않았다.
- package-r3 준비는 07:12:19–07:20:05 UTC, exit0이었다. VSIX 709,245,273bytes, 버전2026.0.16, SHA256 `31f709fe57d95083f04395903fb624a6c4fee8f213ad583b3b957c781d52f7da`다. engine preservation도 동일 환경의 새 source preflight와 run/verify-receipt를 exit0으로 마쳤다.
- source 후속 3그룹 중 module-cache는 exit0이었다. deploy regression의 argv 추출 범위가 source-fixture 생성까지 포함해 초기화되지 않은 script 변수를 요구했으므로 테스트 끝 경계를 `$sourceFixtureRoot` 앞으로 좁혔다. 고정 제품 소스는 유지하고 7.9MB scripts 시험 사본에 이 한 줄만 바꿔 원래 ChangedOnly cases를 실행했다. deploy와 verification-state 모두 exit0, 07:27:42 UTC에 끝났다. 처음 scriptblock 실행의 PSScriptRoot 부재 실패는 별도 로그에 남겼다. 원래 source group 실패 및 건너뛴 결과는 변경하지 않고 corrected summaries로 연결한다.
- 전체 고정 입력 대조는 07:26:41 UTC에 exit0, 기존 제품 SHA 일치를 확인했다. 새 프로필의 exact VSIX coexistence/standalone host acceptance를 시작했다. 이 결과 확인 후 즉시 설치 전 입력·패키지·engine receipt를 재확인하고 승인된 NoLaunch 설치를 수행한다. 실제 그림판/사용자 동시 입력 수락은 아직 미검증이다.
- exact package host acceptance는 exit0이었다. fresh state, version/SHA 일치, initialInventory/hostInstall/finalInventory/host/standaloneHost 모두 실제0을 확인했다. 첫 사용자 설치 시도는 엔진 receipt input identity 재검증에서 exit1로 멈췄고 설치본을 교체하지 않았다. 중첩 PowerShell 및 별도 exec 호출의 환경 변수를 값 대신 키별 SHA로 비교했으나 차이가 재현되지 않았다. 구체적인 과거 불일치 원인은 미확정이다. 같은 설치 프로세스 환경에서 source preflight→전체 engine phase→verify-receipt를 새로 연결하고 이전/새 input의 달라진 필드만 기록하는 재시도를 시작했다. 소스/패키지 사전 대조와 등록된 현재2026.0.14 확인 및 NoLaunch 조건은 유지한다.
- 설치 완료를 별도 영수증과 실제 registry로 확인했다. 현재 등록2026.0.16, receipt `artifacts/p/artifacts/deployments/independent-20261102-164339-910/deployment.json`의 status `installed-reload-required`, hostInstalled/reloadRequired true, Launched false다. 설정 SHA는 설치 직전/직후 동일 `8a73a6bac4173dd83101b6040d7a0c1b260bc7b3c3df74ce2e97d22b5464947f`이며 unrelated inventory unchanged를 확인했다. 이 값은 과거 사전 기록과 달라져 있었으므로 설치 직전 기준으로 비교했다. version lifecycle은 complete/membership_complete:true/revision6이다. 바깥 PS5 실행은 Code 경고 stderr와 exit1로 기록됐으므로 이를 exit0으로 바꾸지 않는다. 내부 install acceptance와 최종 lifecycle까지 완료됨을 근거로 설치 상태를 별도 수락했다.
- 새/이전 engine receipt input 중 달라진 필드는 executionEnvironment뿐이고 project SHA는 동일하다. 새로운 동일 프로세스 chain과 verify-receipt, 전체 fixed input audit, UI binding 재검증은 통과했다. 구체적인 과거 환경 변수 원인은 미확정이다. 현재 연결된 MCP 도구 목록에는 virtual-input API가 아직 없으므로 사용자 재연결/창 새로고침 후 context와 실제 도구를 다시 확인해야 한다. 사용자 Paint 입력 시험 및 최종 owner 정리·선택 task commit은 남아 있으며 작업 완료가 아니다.
- 사용자 업데이트 확인 후 새 MCP context에서 virtual_input/release_virtual_input을 확인했다. prepare_permissions는 unclassified 오류였으며 재호출하지 않았다. 각 그림판을 새로 선택해 exact-process virtualInput stage2 승인을 받고 client(500,450)의 좌버튼 down/up을 전송했다. 첫 창에는 T key down/up도 보냈다. 도구는 delivery virtualInput/verified:false였고 매번 fresh capture를 사용했다. 두 창 모두 캔버스 점이 보이지 않았고 첫 창의 텍스트 도구 전환도 관찰되지 않았다. 입력·실제 앱 효과를 구분하며 두 연결 모두 detached:true로 정상 해제했다. 그림판 호환성 수락 실패이며, 현대 입력 경로와 classic HWND 메시지의 관계는 추가 진단 대상이다. 전경/Z-order/물리 커서 직접 측정·사용자 동시 입력·텍스트 제출은 아직 미검증이다. 자동 global input/UIA/clipboard fallback이나 파일 저장은 하지 않았다. 최소 근거 reports/paint-managed-test.json에 기록했다.
- 사용자가 Window Use 대신 독립 DLL 주입 프로그램을 명시적으로 요청했다. 기존 native broker를 직접 구동하며 로컬 Windows x64·동일 사용자 medium Paint PID50984/creation/executable/HWND를 재검증했다. Window Use 호출 없이 move/down/drag/up/T down/up/status/detach/shutdown을 실행해 broker exit0 및 unloaded:true를 얻었다. 직접 PrintWindow 캡처에서도 캔버스 변화가 없었다. read-only 자식 HWND/hit-test 추적상 canvas와 toolbar 좌표 모두 Microsoft.UI.Content.DesktopChildSiteBridge로 귀결된다. 숨겨진 MSPaintView와 0크기 입력/Afx 자식은 임의로 입력 대상으로 바꾸지 않았다. 원본 Paint11.2605.81.0 상태에 관한 관찰이며 타 앱 전체로 일반화하지 않는다.
- native broker 진단 보완은 common.hpp/hook.cpp/broker.cpp/README에 한정한다. private ABI2로 구/신 DLL 혼용을 거절하고 실제 마지막 전송 HWND·class·message·LRESULT·누적 횟수 및 applicationEffectVerified:false를 보고한다. WinUI 입력 처리 자체가 고쳐졌다는 주장은 하지 않는다. 기존 공식 check-window-virtual-input-native가 run:EZ01:vi-mvz26ul3에 새 native 입력을 freeze하고 configure/compile/selftest를 실행 중이다. 설치된 런타임은 바꾸지 않으며 준비된 직접 드라이버로 새 runtime을 재시험한다. Microsoft winappCli 공식 ui-automation 문서의 windowless XAML 메시지 입력 제한은 관찰과 일치하는 보조 근거다. 실제 rendered text와 커서/전경/동시성 수락은 미완료다.
- run:EZ01:vi-mvz26ul3의 configure55727ms/compile67558ms/selftest1486ms 모두 exit0, sourceSHA e3c68631a1b51e084542137252a8a4dcdba952f6b2439f1ebf4606033b081d4e, runtimeManifestSHA63abff1d0a753cd745ab354e4ed9f109568dd0646e0f79d4e6ed3413bc4e76fe다. 새 runtime으로 독립 broker 재시험 exit0/unloaded:true를 확인했다. 실제27개 메시지가 전송됐으며 mouse는 DesktopChildSiteBridge, key/text는 InputSiteWindowClass로 전달됐다. 텍스트 도구가 준비되지 않은 상태에서 'Azrael DLL test 123' WM_CHAR를 보냈으므로 정상 편집기의 문자 처리 실패를 별도로 입증한 것은 아니다. 직접 최종 캡처1111x835에서 선/도구전환/문자가 보이지 않았다. 진단은 개선했지만 입력 기능은 아직 실패다. installed Azrael은 그대로이며 global input을 사용하지 않았다. 최소결과 reports/direct-paint-result.json, transcript/terminal에 보존한다. 다음 기능 보완은 WinUI 내부 입력 경로 조사이며 classic message replay만으로 완료로 처리하지 않는다. 신규 native group/diagnostic 임시물은 현재 원인 조사 소비자에 필요하고 최종 정리·task commit은 미완료다.
- 사용자는 드래그 외에 브러시/색상 변경을 별도로 요청했다. 같은 독립 DLL runtime으로 brush arrow client(328,155), color button(512,117)을 move/down/up했다. 실제 outer/client offset11/45를 반영했다. 각 broker exit0/unloaded:true, 전후 정상1111x835 PrintWindow PNG 4개 SHA가 모두 같았고 메뉴/색상 선택 효과를 관찰하지 못했다. 색상 메뉴가 열리지 않아 특정 색 선택 자체는 실행하지 않았다. 별도 popup 누락 가능성 확인 중 target이237x39 최소화 상태가 되어 status unsupported_target/mutationOutcome:none을 반환했으므로 추가 입력·복원 없이 중단했다. EOF 정리 broker exit0이며 최종 exact process module 점검으로 DLL 잔류를 확인한다. 최소화 원인은 단정하지 않는다. 드래그 방식 부족만으로 toolbar 무반응을 설명할 수는 없으며, transient/separate popup 확인은 최소화로 제한됐다. reports/toolbar-test-result.json에 구분해 기록했다.

### 협업 네이티브 준비 인계 (2026-11-02 13:47 UTC)

- native source freeze 후 root가 run:EZ01:mp-mvzbcyp3에서 source2·CMake configure·Release compile·실제 stdio initialize/status/stop을 실행했다. 모두 actual exit0, status prepared. outputs/runtime과 reports/native-results.json이 인계물이며 applicationEffectVerified:false다. 수동 MCP 소비를 paint-install-20261102 revision20 execution reference로 보호했다.
- 다음 의존성은 명시적 collaboration enable 후 사용자의 실제 relative movement capability probe다. 이를 통과한 뒤 한 동작씩 실제 MCP·화면으로 커서 분리/FIFO를 검증한다. 설치·제품 빌드는 승인됐다고 간주하지 않는다.
- staging owner는 새 deploy-coop-* run 안의 독립 project에서 full engine build target mock 하나만 검증한다. main project artifacts/t-*를 추가 생성하지 않는다. 실제 마우스 시험과 독립적이다.

### 후속 검증 (2026-11-02 14:06 UTC)

- 첫 수동 enable은 rawPackets0/suppressed0에서 unsupported로 즉시 종료됐다. 요청을 끄고 MCP stop/EOF를 실행해 실제 exit0를 확인했다. transcript cooperative-manual-mcp-01.json. native owner는 초기 known-device arrival만 제한적으로 허용하고 off 실패 오염을 수정했다. 새 run:EZ01:mp-mvzbwni0의 컴파일·stdio 시작/종료 모두 actual0, 수동 협업은 재시험 대기다.
- 전체 Window Use source 범위 272개 중 268pass/2fail/2skip. 실패2는 격리 fixture에 빠진 namespace 의존성(글꼴 정책·errorPresentation·team-design 문서) 때문이었다. 각 실패의 actual1을 유지했다. 누락 입력을 완성한 run:EZ01:coop-preserve-close-mvzbz1ci에서 해당 두 파일16개 모두 actual0. 명시적 logoff 소스검사14파일도 직전 run에서 child actual0. 두 native helper/viewer 실기 항목은 fixture 미지정으로 skip됐으며 이 작업이 실기 성공으로 주장하지 않는다.
- 배포 full engine mock1개 actual0(제품 빌드·설치 없음). artifact-run retained16묶음 child actual0; wrapper 후처리 owner-path 오류의 outer actual1은 보존했다. 근거는 root reports/deploy-coop-verification.json과 cooperative-artifact-run-verification.json 및 cooperative-source-verification-01.json.
- 정리 exact5는 현재15,146bytes다. 예약은 없지만 공유 project-maintenance.json의 다른 writer가 실제 config를 변경해 지원 등록/삭제가 보류됐다. root reports/cooperative-source-cleanup-02.json이 정확 identity·종료·크기 근거이며, 무단 설정복원이나 경계확장은 하지 않는다. 새 실행 산출물은 아직 현재 인계/검증 용도이며 최종 정리 대상과 별도 보존조건을 정리해야 한다.

### 직접 MCP 재시도와 현재 수정 (2026-11-02)

- manual transcript03에서 known relative mouse와 억제 중 raw correspondence2쌍을 받아 ready/enabled를 확인했다. 모델 logical pointer의 생성·이동은 OS input0이었다. 최초 모델 클릭은 physical_held/applicationInputs0으로 종료되어 held category 자체는 아직 확정되지 않았다.
- transcript04는 최초10초에 이동이 없어 준비가 만료됐고, 실제 이동이 들어온 뒤 명시 enable을 다시 실행해 ready가 됐다. 모델 brush click의 caption activation에서 own-tagged mouse1회 직후 실패했다. lastRaw는 deviceHandle0/absolute true/mouseFlags3/zero_device_handle였다. applicationInputs0, tracked synthetic release=true, MCP actualexit0를 확인했다. 자체 SendInput Raw Input 상관관계 분류와 실패 상태 조회를 native owner가 수정 중이다. keyboard event count는 해당 동작 구간에서 변하지 않았으므로 이 실패를 사용자 keyboard 원인으로 보지 않는다.
- host는 범주·사유·카운터·flags만 projection하고 handle/실제extraInfo/경로는 제외하도록 기존 privacy 검사를 확장했다. 이후 새 run:EZ01:coop-frozen-mvzdh41z의 8파일56개 검사가 actual0/pass, frozen scripts unchanged다. 향후 진단 필드 확장 때 raw identity를 통째로 노출하는 실수를 막기 위해 기존 privacy case를 확장해 유지한다.
- root reports/cooperative-host-preservation-evidence.json에 종료된 source6개 선택hash·producer상태·결과를 독립 보존했다. cleanup owner에게 이전 exact5와 source6/deploy1/artifact1, 총13그룹만 지원 절차로 fresh 등록·review·삭제·finalize하도록 인계했다. 현재 최신source56/native/rootrun은 제외했다.

### Own RAW 수정본 준비 결과 (2026-11-03 KST)

- Native owner가 raw-origin.hpp의 실제 classifier를 공유하는 인수 없는 순수 selftest target을 추가했다. root는 기존 checker 안에서 동일 고정 입력으로 main/EXCLUDE_FROM_ALL selftest를 명시적으로 build·run하도록 연결했다. Release에서도 assert 제거에 의존하지 않는24개 판정 모두0fail/actualexit0였다.
- run:EZ01:mp-mvzdvfol: source2/configure/main compile/selftest compile/selftest 모두 actual0. 이후 실제 MCP startup은 Target must be visible, enabled and restored로actual1. 읽기전용 IsIconic 확인에서 두 Paint 모두 minimized:true/visible:true/enabled:true였고 native process actualexit1/terminationverified가 전달됐다. 이를 buildpass나 전체preparedpass로 바꾸지 않는다. 근거 root reports/own-raw-native-preparation.json. 사용자가 복원하면 동일runtime을 재사용해 startup/수동수락만 새로 검증한다.
- root parent run revision22에 이 runtime 소비 reference를 기록했다. 수정 MCP parent는 initialize만 완료했고 native target startup/입력은 복원 응답 전 시도하지 않는다. transcript cooperative-manual-mcp-05.json.
- 새 preparationWaitReason projection까지 포함한 최종 host8파일56개는 run:EZ01:coop-frozen-mvzdzgz3에서 actual0/pass. feature owner/checks는 tool.multi-pointer와 ui.window-control에 한정한 validateManifest actual0(전역profile/schedule 검증 제외), checker node --check actual0.

### 대기 전 정리와 종료 (2026-11-03 KST)

- cleanup03은 exact13 deleted/finalized/actualexit0, logical5,982,622,804B, cleanup04는 source exact2 deleted/finalized/actualexit0, logical20,076,665B다. 각 per-item remainingfalse·finalize remaining/refs/blockers[] 및 SHA-bound evidence unchanged를 수락했다. 합계15그룹6,002,699,469B이며 physical reclaimed는 미측정이다. 현재 runtime/native/rootrun은 이 범위에서 제외됐다.
- 복원 응답을 기다리는 동안 initialize만 한 MCP parent PID36904도 disconnect/EOF로 actualexit0/signalnull/terminationverifiedtrue 종료했다. native target startup이나 앱 입력은 없었다. 이후 복원 확인 시 동일 mp-mvzdvfol runtime에서 새 수동 MCP 연결을 만든다.
- 공유 파일 diff를 확인했다. artifact-run.cjs에는 타 작업의 assertEnabled/queue/reconcile 변경도 있어 이 작업은 catalog 관찰의 withCatalogLock 한 줄만 별도로 취급해야 한다. feature inventory/build/config에도 타 작업 변경이 있어 최종 task commit 전 hunk별 소유 확인이 필요하다. 현재 실제 수락과 현재필요 bundle의 정리가 남아 commit을 실행하지 않았다.

### 복원 후 수동 MCP 재연결

- 사용자 복원 응답 후 기존 mp-mvzdvfol 검증 바이너리를 재사용하여 manual MCP06 initialize/status 성공. 새 컴파일 없음. 두 Paint의 프로세스 생성 identity와 창 캡처 확인, B 브러시 좌표(500,170)에 모델 논리 커서 생성(Windows 입력0).
- raw-origin 실제 작동 및 드래그/FIFO 수락은 아직 대기. 협업 requested:false/suppression:false이며 물리 이동 준비 응답 후 활성화한다. transcript: rootrun reports/cooperative-manual-mcp-06.json; captures: temporary/switched-captures/coop-restored-06-*.png.

### MCP06 협업 실기 결과

- 실제 상대 이동으로 suppressed RAW 생존 pairs2, phase ready/enabled 확인. User movement 중 op1 브러시 click 수행: caption activation3, applicationInputs2, own LL6, own RAW 무시5. 마지막 null-device RAW leftUP(flags0/buttonFlags2/marker matches)의 receipt 불일치로 fail-open. 키보드 카운터 변화 없음. 실패 op1 재전송하지 않음. 후속 캡처에서 B 전경과 브러시 선택 highlight 확인: 앱 효과 일부 있었으므로 전체 gesture 성공으로 보고하지 않음.
- stop/off/suppression false, MCP와 native close exit0/signalnull/terminationVerifiedtrue 확인. transcript reports/cooperative-manual-mcp-06.json; capture coop-click-06.
- native 담당에 bounded mismatch category 진단을 요청. 원인 불명 상태로 marker/time/kind guard 완화 금지, freeze 후 root compile/selftest. 실제 드래그/FIFO/복구 수락은 미완료.

### RAW receipt 원인 진단 준비

- native 담당 capacity 오류 후 root 인계. 이미 작성된 raw-origin classifier category와 최근 최대8개 trusted receipt 진단을 검토. 기존 허용 조건은 동일하고, 진단 전용 복사에서 consumed/time/age를 제외해 shapeReason을 추가 관찰한다. marker 단독 허용 없음. native 3파일 입력 변경으로 새 immutable identity mp-mvzu3o6t 생성.
- root checker work11c1a446-e924-410e-b367-ed4efff6d552, session2715 실행중. 새 컴파일과 판별 selftest/실제 MCP startup 필요. 일반 애플리케이션 시나리오 자동 실행 없음. 실제 재시험 전 user 움직임 준비를 다시 요청한다.

- mp-mvzu3o6t native preparation 전체 exit0/prepared. classifier33/0fail, mcp-source/configure/compile/selftestcompile/actualstdio 모두0. independent reports/receipt-diagnostic-native-preparation.json. root parent execution ref revision23 추가, 수동 MCP07 연결/status 및 cursor 생성0 입력 완료. 이동 준비 응답 대기, collaboration off.

### MCP07 결과와 양방향 RAW 상관관계 수정

- 실제 user motion probe ready/pairs2 후 click op1: caption3 + application1(총5)에서 fail-open. RAW leftDOWN에 대응하는 최신 receipt가 없고 기존4개 receipt는 모두 consumed였다. 마지막 own LL count5와 실제 진단 목록4의 관측 시점이 달라 통지 순서 불일치 가능성. 확정 원인을 단정하지 않는다. release 추가 후 총6, stop/native close 실제0. op1 미재전송.
- root native/multi-pointer 세 파일 수정: full-tag LL receipt 공개 후 observation counter 증가; null-device own marker RAW만 최대8개/20ms 격리하여 뒤늦은 exact full-tag receipt와 기존 predicate로만 매칭. marker 단독 승인 불가. 각 mouse SendInput 뒤 hook+RAW 모두 정합될 때까지 다음 입력을 막음. 타임아웃/큐 초과는 fail-open. hook에서 할당/잠금/대기 없음. 실제 입력 문제 해결은 새 manual acceptance 전 미검증.

- 통지 순서 수정 mp-mvzuayjd preparation 전체0/prepared; classifier33/0fail, actualstdio0. source 변경없는 호스트56 검사 재사용(native-only 수정). root parent revision24 execution ref 추가. 수동 MCP08 status/off, pointer 생성 Windows입력0, 이동 준비 응답 대기. independent reports/own-raw-correlation-native-preparation.json. owning architecture의 회복/큐 경계 현황을 실제 소스와 일치시키고 실기 미수락 상태 유지.

### MCP08 클릭 통과와 사용자 복원 수정

- user movement 중 click op1 성공(no error), caption activation3 + app input2, ownRAW7 matched, phase ready/failure0. 모델 좌표500170 고정과 별도 user1214559 관측. 이후 idle restoration이 user logical 좌표를 계속 쫓아200ms 예산을 소진, lastFailure user_position_restore_failed로 fail-open. drag 미실행. stop/native parent 실제0.
- root broker 수정: 최신 user position latch·동일 사용자/세션/desktop target 검증·SendInput 및 capture 해제를 동일 routing UI invoke에서 처리. 실제 own hook/physical point/미처리 physical packet 검사는 유지. hook+RAW 정합 대기는 capture 해제 이후에도 강제. 이 수정의 실기 수락 전 성공을 주장하지 않음.
- 새 immutable checker 실행(work2ccfc73d-eefe-4a24-99a9-f14e6c4be873). 기존 host source56 검사 재사용.

- mp-mvzuho8u compilation/classifier33/actualstdio 全step0/prepared. independent user-handoff-native-preparation.json; current manual MCP09 connected/status off/pointer prepared no Windows input. root parent execution ref revision26. Actual idle handoff/drag awaits manual movement reply. Native previous08 stop verified; exact2 older cleanup proceeds independently, no current runtime deletion.

### MCP09 실제 이동 분리 확인 / RAW 대기 복원 보완

- continuous user mouse 중 클릭op1 성공·capture false/ready 유지. move logical700420, dragop2 1500ms→900450 성공153inputs; own LL/RAW160, failure0, 별도 user814458 관측. coop-drag-09 B 캡처에 새 직선 visible. 따라서 이 동작에서 모델 경로 분리 관측, 일반적인 협업 전체 수락과는 별개.
- 드래그 후200ms idle handoff 실패: own count160 그대로라 복원 SendInput 자체가 없었음. sent Ui::invoke가 queued RAW를 추월하며 firstUnmatched guard를 계속 보류한 경로. stop/native0.
- Ui routing thread에서 handoff 검사 전 controller WM_INPUT만 최대256개 Peek/Dispatch 처리(기존 controlProc+DefWindowProc 정리 유지). 종료/authority/firstUnmatched 검사 유지. source 수정 후 새 identity compile 및 수동수락 필요.

- raw drain 첫 preparation mp-mvzumtnn 전체0 후, 실기 전에 bounded restorationReason 진단 추가가 필요해 새 freeze 재실행. 앞선 실패에서 safe gate대기와 권한/표면검사 예외를 구분할 근거가 부족하므로 관측을 확정원인으로 간주하지 않는다. 첫 중간 runtime은 수동실행하지 않았고 독립 native-results를 reports/raw-drain-preparation-before-diagnostics.json에 보존. 즉시 obsolete cleanup 대상. 새 workef5c955a-0408-483f-9f84-b92ec3780cb4, 상세검사없던 사본을 추가 보존하지 않음.

- raw drain+bounded reason 최종 mp-mvzuo258 checker全step0, manual MCP10 off/pointer700480 준비. older08/09 actual0 proof로 root parent refs supported 해제(revision28). current runtime 보호 유지. 다음 실제 이동 준비 답변 대기.

### MCP10 continuous-motion handoff 原因確定

- 실제 user motion 중 dragop1 성공156inputs(caption3 포함), ownRaw156, failure0. 후속status에서 handoff physical_raw_pending, owncount156 unchanged 후200ms restoration fail. 이전 추정 중 권한/표면예외 가능성을 제거하고 continuous movement를 quiet gate가 막았음을 확인. stop/native0.
- idle handoff에서 zero-unmatched 요구만 제거: bounded RAW drain 후 최신 관측 user sample을 동일 UI turn에서 검증·복원하고 capture 해제. suppression 중40ms RAW watchdog·exact own hook/RAW·same-user/surface/session/desktop 및 partial no replay 유지. sample 이후 아직 queued된 물리 delta의 정확도는 실기에서 별도 관찰(원시 입력 모든 샘플의 완전 보존/acceleration fidelity를 주장하지 않음). 새 native compile workdc7c7b2c-a118-470c-a831-1ef341486880.

### MCP11 이동 분리·연속 작업·복원 실제 통과

- mvzuqvv5 continuous movement probe ready/pairs2. dragop1(700540→900570,1500ms) 성공156inputs(caption3포함), ownRAW157, restorationReason restored/capturefalse/readyfailure0. 후속status 사용자physical1235544==logical1235544, 모델900570 별도 유지. capture coop-drag-11 B에서 직선 확인.
- 같은 세션 재enable 없이 logical700600 이동 후 dragop2→900630,1000ms 성공103inputs. 후속ready/failedfalse/suppressionfalse/restored, ownLL261==matchedRAW261. 실제 일반마우스 이동 중 모델 경로 분리 및 반복 idle handoff를 이 환경에서 관측. 가속/모든장치/RAW소비앱 보장은 아님.
- 다음 수락: user click during model drag FIFO·다중창 재활성화·부분무재전송 및 종료. 설치본 미반영. MCP11 현재 off가 아니라 requested ready, idle physical native input 정상, 모델hold없음.

### 사용자 FIFO 시험 실패와 커서 UX 정정

- MCP11 op3 2000ms drag 도중 human RAW down queued1 확인, 약47ms 후 raw_delivery_lost로 모델부분drag중단; applicationInputs1/observeRequiredtrue, human skipped1/stopped_or_unroutable, native+parent0. op3 재전송금지. 사용자 실제 보고: 모델 드래그 위치로 마우스가 빨려 들어가 클릭됨. 앞선 성공은 모델 경로·idle handoff의 제한 관측이며 사용자 클릭 위치독립/사용성 수락이 아님을 정정.
- 현재 OS cursor는 active shared input을 따라가는데 모델 overlay는 시작점 고정, User와 모델색 유사. root UI지침 읽고 모델표시 active path추적(논리 next move는 종료후표시복원), User흰색/검정테두리 및 역할명, 모델색pill/역할명 추가. 전역cursor테마 변경/숨김은 하지않음.
- 감시근거: lastForeign physical button_down 직후 RAW감시47ms실패. motion RAW watchdog에 button/wheel hook을 섞지않고 motiontime만 별도추적; 물리 RAW motion이 hook보다 먼저 오는 순서도 timestamp상호대조. 기존 human raw down/up·gesture2s/fail-open 유지. userAtModelStart/lastHumanSubmission 좌표를 native 상태에 추가해 실제 사용자논리점 검증. Actual FIFO·UX 재시험 전 성공아님.

- mvzuxtgh native compiler/classifier33/stdio 全step0. reports/cursor-presentation-native-preparation.json preserved. Model pointer label/pill実像 visual-model-ready-desktop.png에서 한국어/색/클릭투과 그림판 표면 확인(현재light canvas). Userpointer 및動作render/FIFO/사용자체감은 다음실기대기. current MCP12 statusoff/readycursor700420. Screen helper 최초CopyFromScreen flag조합은APIenum제약으로exit1, BitBlt SourceCopy|CaptureBlt로고쳐실제exit0. helper는 read-only regioncapture, app input없음.

### MCP12 FIFO·좌표·표시 실기 확인 및 사용자 수락

- probe ready 후 모델dragop1(700420→900450,2000ms) 성공206inputs/caption3, 모델 종료 응답 당시 human queued3/completed0 → 후속status completed4/skipped0/lastHumanFailure none/lastHumanInputs2/queue0/readyfailure0/restored. 사용자 여러 클릭·짧은 이동4건이 모델뒤처리됨. 모델 userAtStart1189446과 lastHumanSubmission1299461, model종점900450 별도. 화면 coop-fifo-12-active-desktop에서 이동중 모델green pill/흰색사용자 실제분리표시 확인.
- 같은 op1 동일params를 status/capture 이후 재요청: duplicateOperationtrue, ownLL227→227로 입력재전송없음. collaboration disabled→off/suppressionfalse 확인. 실제 모델경로 및 queued입력수락은 이 Windows Paint 환경 범위, 모든장치/RAW앱/가속fidelity 보장아님.
- 사용자가 `의도한 곳에 클릭됐고 구분됐음` 명시확인. 이전 사용자빨려들어감UX실패를 수정후이번마우스협업 실기에서해소확인. Installed Azrael 미반영. 다음 두 root전경/정리/통합검토.

### 多창 준비 및 off-mode 간섭 관찰

- 사용자FIFO12 정상확인 후 명시 off모드에서 Abrushclick op2 성공: foreground c03d4, recovery round1/35ms/app2. A짧은dragop3는 실제physical wheel로 applicationdown1 이후중단, observeRequiredtrue/무재전송. 이때협업off이므로 정상적인간섭중단이며 협업FIFO검증과혼동하지않음.
- 자발적인 재enable에서는 physicalmotionprobe1pair뿐이어서 raw_survival_unproven으로fail-open, appinput추가없음. off재설정, 양Paintcapture로partial관찰후 다음의도op는새좌표450400 준비. 20초continuousmotion준비답을받아 enable후다중창시험. 이후 idle기간에는enabled유지/실제capturefalse로일반입력통과, 불필요한disable/reprobe 반복을피함.

### 최종 native MCP12 기본 협업 수락 범위

- continuous user motion 활성화후 A op4 drag성공, Bop5 caption fallback전경→drag성공, Aop6 caption전경→click성공. 모두 recoveryround1(44/49/45ms), ready/restore유지. forced OS refusal3회예산소진은실기미검증.
- atomicpressT op7 후 desktopcapture에서 texttoolbar확인(PrintWindow원창만캡처하면popuptoolbar누락). UIA는읽기 관찰만사용, 모든행동MCP마우스/키입력만. text상자dragop9 +Unicodeop10 `협업 MCP 2026` 23inputs와실제렌더확인. Bscrollop11 -120 실제stroke/scrollbar이동확인, op12 +120 원위치복귀.
- final status ready/humancompleted4/skipped0. stop/off/suppressionfalse 및MCP/native actualclose0/signalnull/terminationVerifiedtrue. 사용자앱저장/종료안함. all root input processes 종료됨. independent reports/cooperative-manual-acceptance-02.json. Source integration56호스트검사/33classifier및frozenprep0 근거재사용. 설치본 미변경, 전체제품빌드/설치명시권한없어다음사용자결정필요.
- cleanup05 exact2/19,802,396logicalB +cleanup06 exact3/29,900,633logicalB actualall0/deleted-finalized/remaining[] 보고수락. physicalreclaimed미측정.

### 사용자 추가 결함 보고: 드래그 종료 순간 사용자 커서 이동

- 사용자가 `드래그가 끝난 시점에 사용자 마우스가 그리로 순간이동` 보고. 앞선 click구분 확인은 이 종료 handoff UX를 수락한 근거가 아님. 일반 정상복원/협업완료 결론을 이 범위에서 철회하고 실제 종료경계 조사·수정 우선. 제품빌드/설치권한은 아직없고 진행보류. MCP12/native actual0 종료상태 유지, 입력없음.

### 종료 순간이동: Windows 커서 선행 가능성 및 경계 진단

- 사용자 `흰색사용자도옮겨감` 후 `Windows기본커서가먼저가서흰색이따랐을가능성` 정정. 순서확정하지않음. 실제기록op4 start2792624→user656420/model650430, op5 start2924842→user890309/model900320으로 기본/논리좌표변화추가조사필요. off-modeop2/3는실제로OS커서복원하지않는경로였으므로이후협업검증에사용금지.
- root native에64개고정UI-thread cursorTrace 도입: modelbegin/end, handoff latch/observed/release, idle GetCursorPos동기화전논리값과OSquery값, 이후physical hook제안좌표를구분기록. hook할당/잠금없음, 태그/PID/텍스트추가수집없음. 모델동작중logical원시누적은기존유지. 실제로Windows선행인지logical선행인지확정할단일제어드래그필요.
- 확인된별도metadata결함수정: dispatch의physicalCursor가handoff이전modelendpoint로남아collaboration상태와시점불일치. 성공응답은handoff후OS좌표재조회. 실제화면이동이해결됐다고주장하지않음. host56/classifier33검사는이하andoff결함실기증거가아님.
- cleanup07 exact2 actualall0/deleted-finalized/19,950,052logicalB 수락. xtghregister-only10,015,269B 보호유지. root temporary는pending/incomplete run-root whole-root투영으로현재조사owner부분폐기API없음, 현재작업/검증필요근거로보존하며나중완료전retention/owner경계해결필요.

- 경계 진단 mp-mvzvlwtd는 준비 단계 모두 exit0, 판별 검사33 통과. 현재 MCP13 off/그림판B 모델 시작점700380 준비. cursor-boundary-native-preparation.json 보존. 최초 시험은 3초 물리 이동 후 멈추고 드래그 중 및 종료 후2초 정지하는 단일 동작으로 진행한다. cursorTrace는64개 고정이며 hook_proposed와 cursor_query를 구분한다. acceptance02 상태를 provisional_reopened로, 소유 아키텍처를 수락 차단 상태로 수정했다. 제품 배포 권한이 없어 배포하지 않는다.

### MCP13 정지 조건 경계 진단

- 3초물리이동probe2pairs후정지상태 단일dragop1(700380→900400,1500ms) 성공. start/user/복원후OS3349250 유지. trace model_end와latch에서OS900400, handoff_move_observed→release에서3349250, 이후idlequery샘플모두같은좌표. 정지조건에서보고된순간이동미재현. 움직임동반종료결함을해결/부정한증거아님. reports/cursor-boundary-static-13.json 독립요약, transcript13 fulltrace.
- 협업ready유지하며다음논리시작700480 준비(Windows입력0), 다음시험은오른쪽빈Paint캔버스에서작게계속이동하는단일drag.

### MCP13 Paint 내부 연속 이동 조건

- op2(700480→900500,1500ms): userStart1228678, modelend에서user1215632/OS900500, handoffquery/release OS1215632, 이후physicalhook제안1216..1227과cursorquery1215..1226로사용자위치근처만관찰. 응답physical1231628/logical1231628, 후속physical1236673/logical1243673. 모델종료점900500쪽으로점프미관찰. 정상작동한이조건을기존결함부정/해결로간주하지않음.
- 기존이상op4/5 userstart2792624/2924842는Paint밖(다른화면)인반면이번start는Paint내부. 위치조건만바꿔다음단일drag로비교. reports/cursor-boundary-moving-inside-13.json 요약/fulltrace13유지.

- 사용자 요청에 따라 runtime13 직접 MCP 단일 2초 드래그 중 실제 사용자 클릭 시험: 모델 완료 직후 human queued1, 이후 completed1/skipped0, 버튼 입력2, lastHumanSubmission(1312,522); handoff 사용자(1324,547) 복원, suppressionfalse. 시각적 클릭 의도/순간이동 체감은 사용자 확인 대기. 근거 reports/cursor-boundary-user-click-13.json 및 manual MCP13 transcript.

- 사용자 실제 확인: runtime13 모델 드래그 중 클릭은 의도한 사용자 위치에 입력됐고 순간이동 없음. 이번 단일 시험은 수락; 이전 간헐적 순간이동의 원인·해결 여부는 미확정이며 전체 기능 수락/설치로 확대하지 않음. 근거 reports/cursor-boundary-user-click-confirmation-13.json.

- 다음 실제 사용자 혼합 입력 시험 준비: Windows x64 runtime13 ready, completedHuman1/skipped0, 대기열0. 사용자 무작위 이동·클릭·짧은 드래그와 모델 단일 MCP 동작들을 교대로 관측; 기존 마우스 지원 범위(드래그2초 이내), 초기 시험 그림판 캔버스. 자동화된 앱 시나리오는 사용하지 않음.

- 실제 무작위 사용자 이동·클릭·짧은 드래그 조건에서 모델 MCP 드래그3회(op5–7) 완료. 사용자 큐 동작 completed1→26(+25), skipped0→0, 종료 queued0/suppressionfalse/failure없음. 실제 사용자 의도 대비 누락·궤적 정확성은 계수만으로 입증하지 않으며 체감 확인 대기. reports/cursor-boundary-random-input-13.json.

- 사용자 확인으로 무작위 이동·클릭·짧은 드래그 실제 혼합 시험 수락: 의도대로 동작했고 문제 체감 없음. 모델3회/큐 사용자25건/skipped0 결과와 함께 해당 조건 통과. 전체 신뢰성 보장이나 이전 간헐적 순간이동 원인 해결로 확대하지 않음. reports/cursor-boundary-random-input-confirmation-13.json.

## 기본 시스템 포인터 숨김 구현
- 사용자 승인: Multiplex 방향 중단, 기존 Switched 협업 유지. 모델 입력 중 기본 포인터 숨김, 사용자 위치 handoff 뒤 표시. 오류·중단·EOF·broker 비정상 종료/응답 정지 복구. Windows x64 local Default desktop 한정; 설치본 미변경. 이전 좌표 순간이동은 별도 미해결.
- ShowCursor는 thread-local이므로 MagShowSystemCursor 사용. 테마/레지스트리/DLL주입 없이 same-EXE guard가 visibility 소유하고 broker 종료/heartbeat timeout에 복구. native worker 구현, root 통합·검증.
- 기존 REPL 상태가 초기화되어 MCP13 종료 결과를 관측하지 못함. 현재 OS native process 조회는 비어 있으나 정상 종료 증거로 보지 않음; 기존 lifecycle/참조 보존. 신규 compile 전 별도 live producer 충돌 여부 확인.

- 공개 호스트 진단에 collaboration.systemCursor(supported/hidden/restorePending/guardReady/lastError)만 추가. private PID/handle 및 malformed/path-like 값 제거 확인. node scripts/test-window-control-mcp.cjs actual0; reports/system-cursor-host-projection.json. native 실기 검증은 별도 대기.

- 新 native run run:EZ01:mp-mvzwe2m5 immutable source 97f85e4a60daa8097eab9ec28102f65485a85adc1856cf98d673d485942f381d: configure/compile/raw-selftest/guard-selftest/real-MCP-stdio all actual0. Guard target-free check covers hide/show/stop, competing lease, heartbeat timeout and exact created watch victim death; no app input. Source public projection actual0. MCP14 connected; system cursor not hidden while idle. Full product build/install not performed. Visual Paint acceptance next.

- MCP14 실제 협업 ready 뒤 op1 그림판 drag(450620→650640,1800ms) actual success. guard supported/ready true, 종료 hiddenfalse/restorePendingfalse/error없음. 시각적 깜박임 확인 대기. handoff에서 OS1757668 복원 확인 직후 같은 tick 후속 model_end에서 OS650646 기록: 이전 간헐적 좌표 점프 관련 새 구체적 근거이며 해결로 간주하지 않음. post OS/logical1744781. reports/system-cursor-manual-14.json.

- MCP14 사용자 실기 수락 실패: 기본 포인터 계속 보임 + 순간이동 발생. Mag API/guard 검사0은 실제 rendered hiding 성공 근거가 아니며 결론 정정. collaboration OFF 및 stop/native EOF 종료 관찰 후 원인 조사. reports/system-cursor-user-feedback-14.json.

- 숨김 실패 조사: 공식 Mag API prerequisites에서 누락 조건을 확정하지 못함. 테마·확대배율·레지스트리 변경이나 undocumented 대체 API는 실행하지 않음. 대상 조작/포인터 이동이 없는5초 visibilityProbe를 same-exe에 추가, API 상태와 실제 시각 판단을 구분하여 확인. handoff 직후 physical hook stale proposal(650642/650645/650646)이 capturefalse에서 통과한 기록을 별도 검토.

- 대상없는5초 숨김 probe actual0 및 사용자 숨겨졌음 확인. Mag API 자체 로컬 시각효과는 성공; runtime14 실제 Paint 조작 시 숨김 유지 실패와 구분. 추가 발견: handoff capturefalse 이후 show ACK(최대750ms nonpumping) 대기에서 오래된 physical hook이통과하는 창 존재. show ACK를 capturetrue 동안 처리하고 RAW/drain 최신위치 재검증·최종복원 후 blocking IPC 없이 capturefalse로 전환하도록 수정 예정. 모든 stale-input barrier를 입증하는 것으로 확대하지 않음.

- Root 수정: 두 단계 handoff에서 첫 복원 후 show ACK를 capturetrue 중에 처리하고, RAW drain·최신 위치 전체 재검증 후 다시 복원하여 blocking IPC 없이 capturefalse. 중간에 대기로 돌아가면 같은 UI 호출 종료 전에 다시 hide. hide()는 과거 ACK 캐시만 믿지 않고 입력 경계에서 API 요청을 재적용. 전경 변화가 원인인지는 미확정이며 실기로 효과·지연을 확인한다.

- MCP15 수정본 협업 ready, op1 drag450580→650600/1800ms actual success, guard API오류없음/hiddenfalse/restorePendingfalse/복원완료. 사용자 시각 확인 대기. reports/system-cursor-handoff-manual-15.json.

- MCP15 사용자 시각 수락 재실패: 기본 포인터 여전히 보임. 이번 응답에서 순간이동 부재까지 확정하지 않음. OFF/stop/EOF 실제 exit0. 숨김 API 재요청만으로 해결되지 않음; Windows 입력 전송·창 활성화·오버레이 단계별 관측을 추가해야 함. reports/system-cursor-handoff-user-feedback-15.json.

- 추가 표시 구분 시험 준비: 동일 frozen runtime MCP16, 실제 nativePID17820/parent20420/creation1793664562915/exe exact확인. one-off helper는 해당PID·생성시각·exe·AzraelSwitchedCursor class만 검증하여 자체 overlay2개 숨김; 사용자 창/포커스/입력 변경없음. overlay 없는 상태의 짧은 MCP드래그로 native포인터와 제품overlay 구분. 생성물은 기존 root temporary 소유이며 사용종료 후 owner 경계에 따라 정리 필요.

- MCP16 커서 표시 구분 시험: exact-owned overlay2개 hidden 확인, 단일 drag450540→650560/1800ms success; 사용자 시각 확인 대기. 시험 후 OFF/stop/EOF parent0, guard 표시복원 오류없음. reports/system-cursor-bare-manual-16.json.

- MCP16 사용자 확인: 선 그리는 동안에만 포인터 안 보임. 자체overlay 제거 조건에서 기본 포인터가 조작 중 숨겨지고 종료 후 다시 보이는 타이밍 수락. 동일 frozen runtime15/16에서 overlay 유무만 달라 앞선 표시가 자체overlay일 가능성은 커졌으나 단정하지 않음. 정상overlay 시각명확성/간헐적순간이동 신뢰성/설치본 반영은 별도. reports/system-cursor-bare-user-confirmation-16.json.

- cleanup08 owner 최종 결과 재사용: superseded mp-mvzwe2m5/mp-mvzx9640 실제 register/review/apply/finalize0, logical20,599,333B 삭제, remaining/refs/blockers없음(물리회수미측정). 최신 mp-mvzxfxhp는 register-only10,343,924B, complete/protection_knowntrue, root실행참조보호. 정상overlay 표시 명확성·사용자 최종확인과 간헐적점프조사를 위한 최소 native확인묶음으로 보존, 확인후 supported owner정리. 설치본미변경, 전체작업/커밋/기존보호잔여정리는 미완료. reports/cooperative-cleanup-08.json.

## 다중 포인터 활성 기간 전체의 기본 포인터 숨김
- 사용자 변경 승인: 모델 조작 여부와 무관하게 협업 ready 기간 기본 포인터 숨김. 준비실패/모드해제/오류/stop/EOF/종료 시 표시복구. Windows x64 기존 Switched/마우스 FIFO 범위 유지, 설치 미반영.
- Root overlay sync의 hide조건에서 capture의존 제거, 실제 @user overlay가 visible일 때만 hide. visible준비 실패는 routingfail+show. 모델 handoff의 show ACK를 제거해 대기에도 숨김 유지; 기존 두단계 restore·RAW drain·전체재검증·capturefalse 뒤 blocking IPC없음 유지. idle 사용자 좌표는 기존GetCursorPos/timer를재사용하므로60Hz표시 지연 실기확인 필요.

- 모드 전체 숨김 수정본 immutable run run:EZ01:mp-mvzy82a3: configure/compile/raw33/guardselftest/stdio 모두 actual0. MCP17 연결, 초기 collaborationOFF에서 hiddenfalse. 모델이 조작하지 않는 idle 숨김 유지·사용자 overlay 추종·disable 복귀는 실기 확인 대기.

- MCP17 모델 무조작 대기 실기: ready와5초후 모두 modelActivefalse/suppressionfalse/systemCursor.hiddentrue/guardreadytrue/error없음, user와physical좌표 각 관측에서 일치. OFF후 hiddenfalse, stop/EOF parent0. 사용자 시각·추종 지연 확인 대기. reports/system-cursor-mode-idle-17.json.

## 사용자 커서 표시 지연 개선
- 사용자 실기 피드백: 모드전체 숨김은 됐지만 지연 체감. 현재 입력 WM_INPUT 후 overlay 갱신은16ms timer까지대기하고 timer도숨김IPCACK후 이동하는구조 확인. 사용자가 개선승인.
- Root 수정: WM_INPUT처리 직후 자체 사용자overlay 즉시갱신; 안전timer는 유지하며 timer에서도overlay를숨김상태확인보다먼저갱신. 같은좌표면SetWindowPos생략. 숨김API는상태전환때만요청, 매번helper생존/오류를nonblocking확인. visibilityCommands 계수로실제중복요청없음을검증. 기존guardselftest에반복hide100회가새IPC를만들지않는검사추가(후속수정에서timer/이벤트마다동기요청을재도입할위험보존). Windows x64범위,입력FIFO/보안검증/복구감시유지. 실기지연량/개선체감은별도확인대기.

- 지연개선run run:EZ01:mp-mvzyjpst immutable source 32cd87b662c5563220d6af0920cb95b1f4873d5499d5ca45e0102c07ed8c7b3d configure/compile/raw33/guard(반복hide100회새IPC없음 포함)/MCPstdio actual0. 호스트공개계수검사0. MCP18연결·초기hiddenfalse/visibilityCommands0, 사용자추종체감과대기5초간명령계수유지확인예정. 설치본미변경.

- MCP18 무조작추종실기: ready/5초후 모두hiddentrue/modelActivefalse; visibilityCommands1→1(대기중동기hide요청추가0). OFF후hiddenfalse/commands2, stop/EOF parent0. 실제표시지연ms측정아님; 사용자체감확인대기. reports/system-cursor-latency-manual-18.json. cleanup09 exact2 logical20,688,269B deleted/finalized0 잔여없음, 최신run등록만10,350,113B 보호유지(물리회수미측정).

- 사용자지연개선수락: 충분히개선됨. runtime18무조작추종조건숨김유지/명령추가0/모드해제복원 수락; 실제지연ms미측정·설치본미반영·전체동시성신뢰성일반화없음. reports/system-cursor-latency-user-confirmation-18.json. 사용자확인종료로최신검증run실행참조해제, 독립결과유지후owner삭제예정.

- cleanup10 결과 인수: 최신 확인용run mp-mvzyjpst protectionrefresh/review/apply/finalize 모두 actual0, logical10,350,113B 삭제·finalized, remaining/refs/blockers없음. 독립근거SHA유지, 물리회수미측정. 사용자커서지연개선 실기 수락과 해당 개발native확인묶음정리완료. 설치반영·전체multi-pointer통합/기존보호잔여정리·taskcommit은 기존미완료범위로남김. reports/cooperative-cleanup-10.json.


## 커서 벡터·모션 시안
- 범위: 제품 입력 코드 변경 없이 [cursor-motion-preview.html](cursor-motion-preview.html)에 독립 HTML/SVG 시안을 작성한다. 사용자 요청 결과물로 보존한다. 사용자·모델 문구는 그대로 유지한다. 외부 의존성, 실제 OS 입력, 빌드·설치 변경은 없다.
- 채택·수정: 사용자는 순백색 #FFFFFF의 A형을 유지한다. 모델은 앞선 B형에서 첨부 사진 스타일의 인터넷 원본 후보 비교로 다시 검토한다. 사용자 전환은 기존 교차 페이드에 끝점의 점에서 커지는 모션을 더한다. 사용자 입력 대기는 색 변경 없이 저장 아이콘만 표시한다. 모델 드래그 진입은 위치 이동 없이 페이드·축소하여 점으로 전환한다. 기존 아래로 내려가는 움직임과 도약 곡선은 제거한다.
- 새 순간이동안: 사용자 요청에 따라 커서는 애니메이션 없이 즉시 새 위치로 이동하며 크기·불투명도를 유지한다. 이전 위치에만 B형 몸체 잔상을 24% 불투명도로 남겨 180ms 동안 제자리에서 페이드아웃한다. 이름표는 새 위치에만 표시한다. 기존 순간이동 축소·확대·소멸/출현 공백·링·중간 이동 궤적은 제거했다. 반투명 대기·종료 모션은 유지한다.
- 전체 12.8초 반복, 상태별 반복, 일시정지·스크럽·속도·배율·배경 선택과 reduced-motion 초기 정지를 제공한다. 사용자 A는 고정하며 모델은 원본 후보 5개를 선택한다. 모션·좌표는 시안용 연출이며 제품 큐 상태와 연결하지 않는다.
- 검증: Node v26.7.0 문법·SVG 참조·간이 DOM 타임라인/컨트롤 검사 actual0. 이전 수정의 순백색 유지·점 성장·드래그 진입 좌표 불변 검사를 재사용하고, 최신 변경은 순간이동 직전/직후 좌표 즉시 교체·라이브 커서 크기/불투명도 불변·잔상의 고정 위치/크기·24%에서 180ms 내 소멸·대기/종료/복귀·모션 줄이기·컨트롤을 확인했다. 최신 HTML은 22,349바이트, diff 공백 검사0이다. 실제 렌더링의 근거로 사용하지 않는다. 첫 시안의 외부 의존성 검사 exit1은 xmlns URI를 요청으로 잘못 분류한 검사 오류로, 리소스 참조 검사로 수정 후0이었다.
- 검토 제한: Chrome Browser가 file: 열기를 URL 보안 정책으로 거절했다. HTTP 우회·다른 브라우저 표면·헤드리스로 같은 접근을 재시도하지 않았다. 브라우저 기반 renderer도 보류하여 실제 화면·브라우저 상호작용은 미검증이다. 검토 이미지/임시 서버/패키지/빌드 생성 없음. 제품 적용은 별도이며 수정 시안의 사용자 시각 검토를 기다린다.
- 자체 작업 기록의 한글이 PowerShell→Node 파이프 기본 인코딩으로 손상된 사실을 확인해 해당 시안 섹션만 UTF-8 patch로 바로잡았다. 원래 작업 기록의 다른 내용은 유지했다.

### 원본 SVG 후보와 색 팔레트 비교
- 인터넷 검색·공식 저장소 확인으로 Fluent Cursor 16/24, Tabler Pointer, Phosphor Cursor, MingCute Cursor 2의 5종을 선정했다. 첨부 사진의 동일 원본은 특정하지 못했으므로 HTML에 유사 원본 후보임을 명시했다. 사진과 픽셀 단위 일치를 주장하지 않는다. 공식 원본 SVG는 그대로 전시하고 색 적용·모션용으로 원본 path를 수정 없이 재사용한다. 균일 확대·기준점 정렬은 검토용이며 실제 제품 hotspot은 미검증이다.
- 원본 pin: microsoft/fluentui-system-icons 9eb184e96268d3293462f9d9d19225b4c7b07774, tabler/tabler-icons ed177a085b652fe04ec4f37ced867c94621e7840, phosphor-icons/core 2b75f3ad12b420c9504ef05df8d2564a28f8500e, mingcute-design/mingcute-icons 4b85ae197f6c10c8740f2b03a0be0f0864fc18ec. SVG 전체 문자열·SHA-256·고정 원본 링크 및 MIT 3개/Apache-2.0 1개 전문을 HTML에 내장했다. 대형 저장소/패키지를 설치하지 않았다.
- 프리셋 9개(민트·제이드·블루·아이리스·라벤더·로즈·샌드·그래파이트·검정), color picker, HEX 입력·오류 안내, 선택적 보조 외곽선을 추가했다. 색은 모델 몸체·드래그 점·잔상·클릭 표시·이름표에 함께 적용한다. 원본 전시는 영향을 받지 않는다. 모델 문구·순백색 사용자·기존 잔상 모션은 유지했다.
- 검증 actual0: 공식 원본 SVG/모션용 path 동일성·SHA-256·라이선스 존재, SVG 참조, 간이 DOM에서 후보 5개·팔레트 9개·유효/잘못된 HEX·color picker·외곽선·기존 모션/제어·reduced-motion. 최종 HTML 58,577바이트. 실제 브라우저 렌더링 검증은 앞선 보안 제한으로 미완료다. 추가 임시 파일·브라우저 프로필·서버·빌드 없음. 결과는 HTML 시안에만 반영했으며 제품 코드는 미변경이다.

### A형 변형과 Life-All-In-One 팔레트
- 사용자 방향: A(Fluent Cursor 16)를 기준으로 모서리 굴곡을 유지한 폭 90%·80%, 각 폭의 흰 윤곽선형 총 4안을 비교한다. A1은 90%, A2는 80%, A3은 90%+흰 선, A4는 80%+흰 선이다. 위 행은 90%, 아래 행은 80%로 기본형·흰 선을 나란히 배치했다. 원형과 나머지 공식 원본 5종·라이선스는 접힌 참고 영역에 보존했다. 각 안을 모션에 선택 적용하며 흰 윤곽선은 별도 체크로도 비교한다.
- 바탕화면 `C:/Users/felre/Desktop/Life-All-In-One`에서 `docs/design/app/color-system.md` 및 `apps/laio_app/lib/services/color_palette_service.dart`의 `appDefaults`·`paletteFamilyNames`·`eventVariantDefaults`를 읽었다. 12계열 × Bright/Pastel/Deep/Clear/Porcelain/Luminous 6특성의 72개 불투명 HEX가 문서와 코드에서 모두 일치했다. 실제 앱 DB/프로필의 사용자 override는 읽지 않았고 LAIO 파일은 수정하지 않았다.
- 해당 72색을 시안에 내장하고 특성 선택기·12계열 버튼을 추가했다. 몸체 색은 원본 HEX 그대로, 이름표는 같은 계열의 등록 Pastel·Clear 조합을 사용한다. 직접 HEX 입력은 기존 기능을 유지한다. 초기 색은 LAIO Sky Blue Bright #38BDF8. 원본 경로·문서 경로·SHA-256을 HTML 데이터에 기록했다. 코드 SHA-256 dbe1fec89c84b49f8014f6b4b35a8a0df87bd60b913f9acbbb422326ceb7cecf.
- 검증 actual0: 원본 SHA 유지, 파생 폭/아래로 내린 좌표, 흰 선 선택, 72색 전체 선택 및 이름표 등록색 일치, 직접 색/오류 처리, 기존 드래그·잔상·대기·복귀·컨트롤·reduced-motion. HTML 72,719바이트. 간이 DOM 로직 검사이며 실제 화면 검증은 기존 보안 제한으로 미완료다. 요청 HTML·기존 기록만 수정했고 추가 임시 산출물/제품 빌드/설치/LAIO 변경은 없다.
- 굴곡 보존 수정: 앞선 비균등 가로 scale은 곡선도 함께 압축하므로 제거했다. Fluent A의 둥근 형태를 반경 1.0 SVG 단위 원호로 재구성하고, 직선 길이·연결 각도를 조정해 몸체 폭 90%/80%와 동일 높이를 맞췄다. 원호와 직선은 접선을 공유한다. 곡선 자체에 비균등 transform을 적용하지 않는다. 흰 선 2안은 대응 기본형과 완전히 같은 path를 사용한다. 우측 끝 아래로/원형 흰 선 독립안은 이번 4안 비교에서 대체했다. 초기 모션 선택은 A1(90%)이다.
- 최신 검증 actual0: SVG 원호 4개 각각 반경 1×1·직선 접선 연속성·폭 비율·동일 높이·비균등 transform 부재·기본/흰 선 path 일치, 원본 해시 유지, 모션 선택/흰 선·LAIO 72색·기존 사용자/드래그/잔상/복귀·reduced-motion. HTML 78,556바이트. 실제 화면 렌더링은 미검증이며 시안 기하와 간이 DOM 검사로 범위를 제한한다. 추가 파일·프로필·서버·빌드 생성 없음.

### 채택안과 Windows 사용자 커서 겹침 확인
- 사용자 채택: 모델 A3(폭 90% + 흰 윤곽선), 기존 LAIO 72색 팔레트. HTML 초기 선택도 A3으로 변경했다. 특정 단일 색의 최종 채택은 없으며 초기 Sky Blue Bright를 유지한다. 이번 범위는 HTML/SVG 디자인이며 제품 입력 코드·설치본은 변경하지 않는다.
- 현재 Windows 커서 설정과 공유 기본 화살표를 읽기 전용으로 확인했다. `C:/WINDOWS/cursors/aero_arrow.cur`, Windows 기본값, 시스템 DPI 96, 실제 로드 크기 32×32, hotspot (0,0). 파일 SHA-256은 06678bbf954f0bece61062633dc63a52a34a6f3c27ac7108f28c0f0d26bb22a7. API가 반환한 복사 GDI 비트맵은 해제했고 공유 커서·OS 설정·포인터 위치는 변경하지 않았다.
- 기존 사용자 SVG는 같은 hotspot에서 크기와 기울기가 맞지 않았다. 파일의 32×32 BGRA 참조에서 바깥 alpha 및 흰 내부 경계를 추적해 SVG를 다시 땄고, 별도 흰 외곽선/그림자를 제거했다. 일반 Windows 포인터의 전환 시작 모습도 실제 참조 PNG로 바꿨다. 수정 전후 Windows 배경/SVG 전경을 포개는 비교, 차이 강조 색상 및 전경 불투명도 조절을 HTML 첫 섹션에 추가했다. 새 사용자 윤곽의 시각 채택은 아직 확인받지 않았다.
- 실제 메모리 이미지로 원본과 재추적 형상 및 겹침을 확인했다. Pillow 16배 초과 샘플링 후 alpha≥128 실루엣 비교: 수정 전 intersection125/union512/불일치387, 수정 후 intersection125/union125/불일치0. 현재 32px 실루엣 기준의 일치이며 RGBA·안티앨리어싱·그림자·다른 DPI/접근성 크기까지 같다는 뜻은 아니다. 추가 단순화는 1~3픽셀 차이가 생겨 적용하지 않았다.
- 집중 검사 actual exit0: Windows 파일 해시·hotspot·크기·추적 path, A3/팔레트 채택 기본값, 비교 색상/불투명도 컨트롤, SVG ID/참조, 72색 선택, 사용자 점 성장·저장 아이콘·순백색 유지, 드래그/180ms 잔상/복귀·reduced-motion. HTML 86,575바이트. 전체 HTML 렌더링은 기존 Browser URL 보안 제한으로 미검증이며 우회하지 않았다. 이미지 처리는 메모리에서 끝냈고 임시 파일·서버·프로필·패키지·빌드 생성은 없다. 지속 디자인은 소유 아키텍처의 target 섹션에 연결했다.

### 사용자 커서의 직선 윤곽과 둥근 모서리 정리
- 사용자 수정 지시: 픽셀 경계를 따라 생긴 쭈글쭈글한 선을 제거하고, 기존 선의 대략적인 실루엣을 유지한 직선 및 둥근 모서리로 정리한다. 기존 HTML 시안에서만 실행하며 Windows x64 참조 외 플랫폼 지원이나 제품 설치 범위는 변경하지 않는다.
- 바깥/안쪽을 각각 7개의 직선과 접선이 이어지는 원호로 재구성했다. 바깥 형상은 기본 화살표의 기울기·왼쪽 변·우측 끝·꼬리를 유지하며, 흰 내부는 같은 지지 직선에서 0.94px 안으로 들인 구조를 사용한다. hotspot (0,0), 순백색, 문구·저장 아이콘·모션, 모델 A3 및 LAIO 팔레트는 유지한다. 픽셀 추적 상태와 정리 상태를 Windows 참조 위에 각각 포개도록 기존 비교 화면을 갱신했다.
- 검사: Node 문법·SVG 참조·양쪽 윤곽의 직선 7개/원호 7개·hotspot·A3 유지·흰 내부 검사 통과. Python/Pillow 16배 실루엣 비교 및 고해상도 벡터 이미지 생성 actual exit0, 메모리 이미지로 잔굴곡 제거와 둥근 접합부를 확인했다. 정리 후 alpha≥128 기준 intersection116/union125/불일치9, 겹침92.8%; 이전100%는 픽셀 추적 버전의 결과이며 이번 직선 디자인의 수락 기준으로 사용하지 않는다. 전체 HTML 렌더링은 기존 보안 제한으로 여전히 미검증이다.
- HTML 98,666바이트. 수정은 기존 시안·소유 디자인 문서·동일 작업 기록에 한정한다. 새 영구 테스트를 추가할 반복 작업 누락 위험은 없어 메모리 일회 검사만 수행했으며 임시 파일·프로필·서버·빌드 생성은 없다. 사용자 시각 검토 대기.

## 채택 커서의 native 표시 구현
- 사용자 `좋습니다. 이대로 구현해주세요`로 위 사용자 윤곽과 모델 A3/LAIO 팔레트·채택 모션의 실제 표시 구현 승인. 기존 Windows x64 local desktop Switched prototype 범위이며 입력 라우팅/FIFO/권한은 유지한다. 전체 제품 빌드·설치/배포는 별도 권한으로 남긴다.
- 현재 GDI Polygon + color-key overlay는 반투명·안티앨리어싱·잔상을 지원하지 않으므로 Windows 내장 GDI+와 per-pixel alpha layered window로 교체한다. 새 외부 패키지 없이 기존 UI 스레드, Raw Input 직후 위치 갱신, 안전 timer 및 system cursor guard를 재사용한다. 모션은 입력 좌표를 보간하지 않고 표시 형상/불투명도만 바꾼다.
- 분담: 자산 담당은 기존 HTML의 확정 vector/72색 및 원본 라이선스만 native data header로 고정한다. root는 native renderer/모션·실제 큐 상태 연결·검증·최종 통합 소유. 자산 준비와 독립적으로 UI/입력 호출 연결을 진행하고, 모두 고정된 뒤 최소 native 컴파일·비입력 렌더 검사를 수행한다. 새 런타임의 검증/정리는 기존 artifact lifecycle owner를 사용한다.
- 검증 목표: 실제 렌더한 밝은/어두운 바탕의 사용자·모델·대기 저장 아이콘·드래그 점·잔상·종료 프레임, 위치/입력 불변, FIFO/host 경계 회귀. OS 커서 설정/사용자 앱은 렌더 검사에서 조작하지 않는다. 실제 협업 시각 체감은 별도 사용자 시험 전까지 미확정이다.

### 구현·검증 결과와 확인 대기
- `cursor-assets.hpp`에 채택 사용자 outer/inner 각47점, 모델25점의 cubic vector와 LAIO 72색을 고정했다. HTML SHA cc60b5b2effdf8719ac4e92e99b17994e73617919370c720cd208593fb87732c 및 원본/팔레트 provenance를 보존한다. `CURSOR-NOTICES.md`의 Fluent MIT 전문을 검증 런타임 notice에 포함했다.
- `cursor-renderer.hpp`는 GDI+로 캐시된 premultiplied-alpha surface를 그린다. 흰 사용자 화살표/둥근 모델/색 계열 label/저장 아이콘을 그리며, 완성된 전체 커서에 불투명도를 한 번 적용해 border/text 중첩이 대기32%보다 진해지는 문제를 막았다. `cursor-presentation.hpp`는 입력/좌표 변경 없이 dot 성장, 드래그 dot 전환, 대기, body-only180ms 잔상,220ms 제거를 담당한다. Raw Input은 surface 위치를 즉시 옮기고, visual tween은16ms timer가 갱신하므로 고주파 마우스 입력마다 다시 그리지 않는다.
- 실제 FIFO에 admit됐지만 시작하지 않은 사람 gesture만 저장 badge 표시 조건에 연결했다. Broker 입력 요청의 active/drag/click, 논리 이동, explicit pointer remove에 표시 상태를 연결했다. 안전 stop/EOF/shutdown은 기존 즉시 해제·overlay 제거를 유지한다. 협업 활성화가 proven ready가 된 뒤에만 native 화살표에서 사용자 화살표로 전환하고 mode disable은 기본 포인터를 즉시 복원한다. 입력·타겟 권한·큐 순서는 유지했다. Native shape/path/palette·non-actuating 렌더 검사와 보존 inventory를 연결했다.
- Native 검증 4회: 첫 run mw07bwij는 UpdateLayeredWindow의 POINT const 인수 변환으로 compile actual1. 타입 수정 뒤 mw07di4u 전 단계0/render64. 전체 group-opacity 보정 뒤 mw07ks01 전 단계0/render80. Raw Input 재페인트를 timer로 분리한 최종 mw07n6du도 source/configure/compile/raw-origin/visibility-guard/render 전 단계 actual0, render80. 각 고정 입력·시각·소요시간은 독립 JSON으로 인계했으며 이전 결과를 최신 source 통과로 재분류하지 않는다. 최종 source SHA6b832a44dd573456fb66d57207f3cf34460a0b97c8e6d9aab5b277e015772c3f.
- 최종 native 프레임의 밝은/어두운 배경을 직접 확인했다. 96/144/192 DPI 숨긴 layered window의 hotspot 배치·click-through/noactivate 속성, frame alpha 상한·premultiplication, dot/대기/종료/reduced-motion을 검사했다. 렌더 시험 appInputs0·visibilityChangedfalse·foregroundUnchangedtrue. 최종 before/after 커서 좌표 차이는 물리 사용자 이동을 금지하지 않은 관측이며, 시험이 커서를 고정/복원했다고 주장하지 않는다. Guard 별도 selftest는 기존대로 잠깐 숨김/복원을 시험했다. 실제 앱 조작/협업의 시각·체감은 미검증이다.
- Mandatory host 경계 4파일의 첫 실행 actual1: `test-window-use-staging`의 Python PATH ENOENT만 실패, 다른3 suite는 보고된 실패 없음. 설치된 Python312 경로와 소유 TMP를 child env에 핀한 staging 재검사 actual0,4/4 pass. Python 설치나 제품 환경 변경 없이 검사 환경을 보정했다. MCP source 검사와 feature owner/check 연결·diff 공백 검사0. 렌더링·alpha·motion 및 업그레이드 누락을 예방할 native 검사만 유지했다.
- 최소 확인 묶음 `run:EZ01:cursor-check-mw07po24`, 경로 `artifacts/tasks/EZ01/runs/cursor-check-mw07po24`,512,326바이트: verified runtime, native PNG, 독립 요약 및 종료 근거. Runtime manifest SHA1393ec4b4381e05f25248137f278b55f07db9400b33a94de01055bb846d8e486 재검증됨. 복사 내용 검증은 성공했지만 producer close가 동시에 정리되던 fixture catalog의 ENOENT로 실패해 wrapper 실제 exit1을 보존했다. 자동 onExit가 stopped/failure/complete-membership로 close한 것을 확인했고 root 지원 API로 recovery 참조 `user-check-adopted-cursors`를 추가했다. 실패를 성공으로 바꾸지 않았다. 이후 writer/cleaner 경계를 직렬화했다.
- 확인용 runtime/이미지는 사용자 시각·정상작동 확인 뒤 recovery 참조를 지원 owner로 해제하고 fresh review/delete/finalize한다. 그 외 컴파일/fixture/재검사 묶음은 즉시 owner 정리한다. 독립 결과는 [cursor-native-implementation.json](cursor-native-implementation.json), 실제 정리 결과는 [cursor-native-cleanup.json](cursor-native-cleanup.json)이 소유한다. 전체 제품 빌드·설치본 교체는 하지 않았다. 실기 수락·기존 전체 작업의 보호 잔여물 처리 및 task-level commit은 아직 미완료다.
- 최종 정리 인수: 승인된 새9묶음은 owner 작업 actual0으로 deleted→finalized 및 run-root/producer-record 실제 부재 확인. 선택 논리 크기34,237,732바이트, 물리 회수량 미측정. 실행 중 writer 없음. 최소 확인 그룹 cursor-check-mw07po24만 register-only 완료/512,326바이트 존재, revision3·실제 failure exit1·recovery 참조를 그대로 유지한다. Native item.references가 비어 있어도 producer recovery 참조는 별개로 확인해야 하며, 사용자 확인 전 삭제하지 않는다. 이번 커서 소스 구현과 검증은 완료했으며 설치/실기 확인 및 확인용 묶음 정리는 대기 상태다.

## 채택 커서의 직접 MCP 실기 시험
- 사용자 선택은 입력 없는 시안 창이 아닌 실제 MCP 마우스 협업 시험. 이미 새 코드가 들어 있는 manifest SHA1393ec4b4381e05f25248137f278b55f07db9400b33a94de01055bb846d8e486의 확인용 runtime을 재검증해 재사용했다. 새 제품 빌드/설치/모션 중복 구현은 하지 않았다. `cursor-live-mw08oz9h` owner run을 시작하고 runtime 그룹에 dependency를 걸었다.
- Managed Window Use observation으로 기존 시험 그림판을 확인하고 stage4 공유 전경 입력 권한을 prepare/request로 승인받았다. 실제 조작은 사용자 요청대로 별도 개발 native MCP에 직접 한 동작씩 보냈다. 창 HWND0xc03d4/PID50984/생성 FILETIME0x1dd6a8310fb732e/실행파일 및144 DPI 화면 크기를 일치시켜 pin했다. 다른 세션이 점유한 앱은 제어하지 않았다. UIA 입력·클립보드·앱 조작 자동 시나리오는 사용하지 않았다.
- 첫 브러시 클릭과 단일1800ms 드래그 성공 및 새 선 화면 확인. 사용자 일반 표시 피드백은 문제 없음이었으나 드래그는 다른 작업 중 놓쳤다. 초기 trial의 사용자 처리1/skip6(intent_changed)는 그대로 기록하며 원인/광범위 신뢰성 해결로 주장하지 않는다. 다음 단일2초 드래그는 새 human intent가 없어 저장 아이콘 수락 근거로 쓰지 않았다.
- 사용자 요청으로 파란/보라 모델 커서2개를 표시해 각각2초 드래그했다. 두 번의 초기 capability 준비는 실제 상대 Raw 이동이 오지 않아 fail-open/no-actuation으로 끝났다. 같은 MCP 호출 안에서 최대8초 기다리는 bounded 준비로 바꾼 후 ready를 얻어 두 동작을 전달했다. 사용자는 두 커서 모두 점 전환과 종료 후 반투명 화살표 복귀가 정상이라고 확인했다.
- 최종 저장 아이콘 trial은 파란 기준선 다음 보라2초 선 중 실제 사용자 클릭을 받았다. 보라 드래그 종료 시 queued5, 이후 queued0·completed1→8(+7)·skipped6→6(추가0)·lastHumanFailure none. 사용자는 저장 아이콘과 의도한 클릭 위치 모두 정상이라고 확인했다. OFF 후 hiddenfalse/suppressionfalse 및 모델 overlay 제거 확인. 이 조건의 시각/클릭 수락이며 기존 간헐적 입력 결함 전체 해결이나 순간이동 잔상 별도 실기 수락으로 확대하지 않는다.
- 종료는 EOF/native close 실제exit0/terminationVerifiedtrue와 독립 Python witness를 함께 사용했다. witness가 broker30768/guard22164의 PID·생성시각·exe를 검증한 프로세스 handle을 미리 열었고, 두 handle이 모두 signaled 및 각 exit0을 직접 관측했다. witness child도 actual0으로 닫혔다. PID 부재만으로 종료를 추정하지 않았다. `requireStopEvidence:true` live run에 이 근거를 바인딩하여 complete/stopped/success/exit0으로 닫았다. log-save 변수 범위 오류는 실제 입력 완료 뒤 발생해 로그에서 결과를 복원했으며 입력은 재전송하지 않았다. 종료 record의 필수 reason 누락도 수정 후 지원 API로 닫았으며 실제 결과를 바꾸지 않았다.
- 독립 수락/종료 근거 [cursor-native-live-acceptance.json](cursor-native-live-acceptance.json), SHA40315d63fb91890e024d2ab0e3cd521cb53b3933a6622f354c28a45e75c01c3b. Window Use resource_status는 temporary resources0/bytes0이며 기존 소유하지 않은 child session은 건드리지 않았다. 사용자 확인 조건이 끝났으므로 live run dependency와 기존 확인용 recovery 참조만 지원 API로 해제하고 exact2 owner 삭제/finalize를 진행한다. 기존 확인 run의 failure exit1은 보존한다. 설치본은 미변경, 다른 앱/그림판 내용은 저장·종료·삭제하지 않는다.
- 실기 확인 후 정리 완료: live1,311,732B와 확인용512,326B의 지정 참조를 지원 API로 해제했고 register/refresh/review/apply actual0, deleted→finalized 및 run-root/producer-record 부재/remainingPaths[] 확인. 이번1,824,058 논리바이트, 커서 구현·검증 전체11묶음36,061,790 논리바이트 정리; 물리 회수량 미측정. 기존 wrapper failure exit1과 live success exit0은 독립 근거에 그대로 남겼다. 커서 실기 시험과 이 범위의 임시 산출물 정리는 완료했으며 설치 반영과 기존 전체 multi-pointer 작업의 별도 보호 잔여물·커밋 범위는 바뀌지 않는다.- ?? ??: schema 3 ??? ?? Window Use ?? ???, host/policy/MCP, ???? ??? ??, ?? ???? ??? ???? ?? ????. ?? ?? ??? ?? ?? ??? [?? ????](../../archive/window-use-stages-v1/README.md)? ????.
- ??: Windows x64 ?? 197? ? 196? ???Linux ?? 1? ???(?? ??? ?? ??), ???? 35? ???4? ignored, ?? ???? ??? ?? ??, ?? ??? 27???? UI 98? ??. [?? ?? ??](window-permissions-acceptance-01.json)? [?? ?? ??](window-permissions-acceptance-02.json)? ?? ????????? ??? ????. ??? ??? ??? ??? ??? ??/? ??? ???? ????, ?? ?? ?? ??? ?? ????? ?? ? ?? ??? ????? ????.
- ??: ?? ?? ?? ?? 13??? ?? ??? ???finalize?? ?? ??? ??? ??. ?? exit1? ? ?? ?? ??? ?? ?? ??? ????. ? ?? ?? ? ??? ????? ????? ??? ?? ???. [?? ??](window-permissions-cleanup.json), [?? ??](window-permissions-cleanup-final.json), [??????? ?? ??](window-permissions-final-audit.json). ?? ??? ?? ?? ?? ??? ???? ???.
- ?? ??: ?? ?? ?????? ????? OS ?? ??? ?? ??? ???? ???. ?? ??? ?? ?? ??? ??? ?? ??? ??? ???? ???. ?????? ?? ?? ???.

# Azrael Windows 가상 마우스·키보드

## Window Use 단순화와 폐기 범위

상태: 앱 기반 권한 모델과 폐기 경로를 소스에 구현하고 통합 검증 중이다. 설치본은 변경하지 않았다.

- 요청 범위: 숫자 단계 구분을 제거한다. Windows 자식 세션 실행과 기존 Computer Use 데스크톱 제어는 전용 구현·도구·지침·패키징·관련 검증을 식별해 아카이빙하고 활성 경로에서 제외한다. 유지할 창 관찰·제어가 공유하는 승인, 취소, 대상 검증 코드는 먼저 분리한다. 단순히 이름에 computer-use가 있는 파일을 일괄 이동하지 않는다.
- Window Use 활성화 중 기본 관찰은 기존 1단계 기능과 전체 화면 캡처를 포함한다. 관찰 블랙리스트 대상은 승인이 필요하다. 화면 조작은 개선된 현재 세션 창 제어를 사용하며 기본 승인이 필요하고 화이트리스트로 생략할 수 있다.
- 제안: 기본 제공 MCP 도구와 기능 활성화에 연동되는 짧은 내장 지침을 사용한다. 권한은 호스트가 매 호출 검증하고, 별도 Computer Use/Window Use 스킬 배포와 단계별 가이드를 대체한다. 스킬 로드 여부를 권한 근거로 삼지 않는다.
- 예외 목록은 앱 단위로 적용한다. 승인된 앱의 여러 창에 적용하되 대상 창과 프로세스 수명은 매번 재검증한다. 관찰 블랙리스트와 제어 화이트리스트는 독립이다.
- 전체 화면 캡처에서는 관찰 블랙리스트 앱 영역을 가린다. 개별 창 관찰은 별도 관찰 승인을 요청한다. 제어 화이트리스트로 관찰 승인을 우회하지 않는다. 캡처 중 창 변화·알 수 없는 신원·잘못된 좌표를 감지하면 이미지를 반환하지 않는다. Windows 비동기 창 이벤트와 합성 화면을 원자적으로 결합하지 못하므로 완전한 개인정보 격리로 주장하지 않는다.
- 범위: 권한 의미와 도구 계약은 공통 설계, 실제 Window Use 기능은 현재 Windows 전용 정책을 유지한다. 이번 변경만으로 Linux/macOS 기능을 활성화하지 않는다. 기존 사용자 중지·OS 보호·불확실 입력 재전송 금지는 유지한다. 기존 포괄 승인과 폐기 단계 승인의 신규 예외 목록 자동 변환 여부는 구현 전에 명시한다.
- 조사 근거: `scripts/use-control-settings.cjs`는 schema 2 단계별 플래그를 저장한다. `scripts/window-use-approvals.cjs`는 `computer-use-approvals.cjs`의 window 모드를 공유한다. `scripts/window-control-host.cjs`에는 단계별 권한, 자식 세션, 데스크톱 권한, Switched 입력 연결이 공존한다. 활성 문서와 설치된 window-use 스킬도 네 단계 지침을 제공한다. 아카이빙과 새 권한 모델의 경계를 정한 뒤 이 소유 경로들을 함께 이전해야 한다.

## 목표와 현재 권한

### 사용자 마우스와 모델의 협업

- 합의한 목표: 평소 사용자 마우스가 동작하고 Window Use 모델과 함께 사용할 때 사용자와 모델의 커서 좌표를 따로 유지한다. 사용자 클릭은 모델 작업을 중단하거나 협업을 종료하는 제어권 반환 요청이 아니다. 화면 관찰·모델 생각 대기 중에는 입력을 점유하지 않는다. 현재 Windows 로컬 x64 범위와 실제 앱 수동 MCP 시험 원칙을 유지한다.
- 초기 구현 범위는 사용자 승인한 일반 마우스 협업이다. 모델 press/text는 유지하며 실제 사용자 keyboard/IME 입력은 정상 통과시키고 모델 입력은 안전 중지한다. 사용자 keyboard·한글 IME까지의 FIFO/포커스 독립성은 이 단계의 수락 대상이 아니다. absolute/touch/pen 및 Raw Input 소비 앱은 지원을 주장하지 않고 감지 가능한 미지원 상태에서 fail-open 처리한다. 일반 relative mouse도 low-level 억제 중 Raw Input 생존을 짧은 명시 수동 probe로 확인하기 전 활성 지원으로 보고하지 않는다.
- 착수 시 차이: 이전 prototype은 외부 입력을 epoch interruption으로 처리했다. 현재 개발 소스는 명시적 협업 활성화·relative-mouse 수집·gesture FIFO·atomic press·제한된 준비 복구를 연결했다. 이 소스 구현과 실제 앱 수락은 구분하며, 현재 own-injected Raw Input 분류를 수정 중이다.
- 구현 후보: Raw Input으로 사용자 이동을 별도 수집하고 모델 소유 중 legacy 물리 mouse event를 최소 hook에서 억제한다. 사용자 overlay와 실제 OS cursor를 구분한다. RIDEV_NOLEGACY는 등록 앱에 관한 동작이므로 전역 분리 근거로 취급하지 않는다. hook timeout/removal, raw-input 앱, 가속/절대 장치, 최신 사용자 좌표 복귀는 미검증이다. 기존 MouseMux 전체 구현과 동등하다고 주장하지 않는다.
- 순차 처리 제안: broker 접수 순서에 따라 사용자·모델의 짧은 동작을 FIFO로 실행한다. click down/up, drag down/path/up, modifier chord를 각각 분리되지 않는 단위로 본다. 모델 drag 중 사용자 click은 drag 뒤, 그 후 접수된 모델 동작보다 먼저 실행한다. 양측 cursor move는 독립 위치 갱신이며 큐에 쌓지 않는다. 모델 작업 전체를 한 묶음으로 점유하지 않는다. 현재 native의 16개 문자열 요청 큐는 모델 요청만 처리하고 key down/up이 별도 요청이므로 이 계약을 구현한 것으로 간주하지 않는다.
- 전경/가림 복구 목표: foreground 변경이나 가림만으로 전체 작업을 즉시 멈추지 않는다. 모델의 차례에 새 관찰 → 승인된 exact target 전경 활성화/허용된 복원 → 새 화면과 hit/focus/intent 확인을 수행한다. 초기 기술 한도는 동일 intended operation에 복구 최대3회·active recovery 총5초이며 먼저 도달한 한도를 적용한다. 사용자의 선행 gesture 실행 대기는 복구 시간에서 제외하고 다음 복구 시도는 선행 사용자 요청을 앞지르지 않는다. 단순 요청/캡처 반복으로 예산을 초기화하지 않는다.
- 복구와 중복 입력 경계: 앱 입력이 아직 전달되지 않은 것이 확인된 경우에만 준비 복구 후 실행한다. 일부/불명확한 click·drag·key/text는 tracked synthetic held를 해제하고 새 화면으로 효과를 확인한 뒤 다음 동작을 판단한다. 원래 mutation 자동 replay·가림창 click-through는 하지 않는다. 명시적 stop·권한 철회·target 교체·해제 실패는 복구 우회 대상이 아니다. 예산 소진 시 해당 모델 동작을 멈추고 사용자 일반 입력은 유지하며 실제 시도/마지막 blocker/부분 효과를 보고한다.
- 확정 경계와 남은 검증: 사용자 mouse gesture는 최대2초/128점, queue16, human intent5초 expiry로 제한한다. keyboard/IME FIFO는 이번 범위 밖이며 물리 keyboard는 그대로 통과하고 모델 입력을 멈춘다. target/focus/geometry/leaf를 고정·재검증한다. 실제 경로 분리·사용자 FIFO·전경 복구·종료 후 정상 입력이 수락 대상이다.
- 다음 소유/인계: root가 전환 정책과 Window Use host/MCP 권한 계약을 소유한다. native routing은 확정된 정책을 입력으로 사용하고 기존 stage/app/stop 경계를 보존한다. 드라이버·DLL 재도입·설치본 교체는 이 조사로 실행하지 않는다. 독립적인 준비 작업은 기존 구현과 공개 Win32 API 확인 및 설계 기록이다.
- 실행 분담/순서: 2026-11-02 12:46 UTC의 계약 검토와 함께 native owner가 native/multi-pointer 내부의 press·3회/5초 복구·물리 mouse 큐·raw capability probe를 구현한다. root는 scripts/multi-pointer-mcp.cjs와 유지 검사에 collaboration/press 및 safe-integer operationId를 연결하고 native 종료 결과를 부모 exit에 반영한다. native contract/source freeze 후 기존 check-multi-pointer-native로 새 immutable run을 만들어 검증 준비한다. 실제 앱은 새 MCP에 직접 연결해 한 동작씩 확인한다. host map은 기존 virtualInput 승인이 DLL 전용임을 확인했으며 협업 runtime을 이 승인으로 위장하지 않는다. 상시 Window Use 연결은 별도 명시 backend 권한·패키지 경계를 보존해야 한다.
- 검증: project_tests multi-pointer-mcp-source, run-42784-5284-1793623716574113100에서 source2개 pass/exit0·input integrity valid. 종료 실패/불명확 exit 및 atomic press/schema 경계를 기존 검사에 포함했다. source 검증은 native/app 수락을 대신하지 않는다. 단조 operationId와64개 outcome ring/high-watermark로 동일 작업 재전송을 막고, 종료 결과는 native_closed 영수증으로 남긴다.
- host 검증: 초기 시도는 Python PATH·공유 catalog 관찰 충돌·중첩 fixture 경로 길이로 실패했다. fixture 경로를 줄이고 beginArtifactRun의 catalog 관찰에 기존 lease를 적용했다. run:EZ01:coop-frozen-mvzb3twu의 고정된 8개 파일·56개 검사는 모두 actual exit0, frozenInputsUnchanged:true (2026-11-02 13:40:49–13:41:07 UTC). reports/source-results.json과 logs/source.stdout.log가 근거다. 실제 마우스 협업 증거를 대체하지 않는다.
- 수락 항목: 사용자 이동 중 모델 drag 경로 보존, 사용자·모델 동작의 접수 순서와 gesture 비혼합, 사용자 click 뒤 모델의 정상 계속 처리, 지연 중 target 변화 처리, 부분/완전 가림과 foreground 변경 후 제한 복구, 복구3회/5초 소진·부분 mutation 무재전송·user stop 보존, 종료 후 일반 사용자 입력 유지, held-state와 연결 오류 회수, 동일 Paint에서 실제 렌더링, 모델 종료 코드 전달, 단계/권한/취소 회귀. 앱 조작은 MCP 연결로 하나씩 수행하고 결과 화면을 확인한다.
- API 근거: [Raw Input registration flags](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-rawinputdevice), [LowLevelMouseProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc), [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput). 지속 설계는 [multi-pointer](../../docs/architecture/multi-pointer.md#user-and-model-collaboration)가 소유한다.

### 현재 실행 방향

사용자는 자체 DLL 방식 포기 후 MouseMux를 Ghidra로 분석하고 다중 마우스 입력을 재현하여 MCP로 직접 사용하는 시험까지 요청했다. 기존 DLL 경로의 성공한 Win32 fixture와 실패한 Paint 결과는 근거로 보존하되 추가 DLL 개발·설치의 기반으로 간주하지 않는다. 이 절의 현재 방향이 아래 종전 DLL 제안의 실행 우선순위를 대체한다.

- 대상: Windows 로컬 x64, 현재 사용자 일반 데스크톱. Linux/macOS, x86, 보호/상승 프로세스, 커널 드라이버 설치는 현재 대상이 아니다. 기존 앱·단계 권한과 user stop을 보존한다.
- 도구: 공식 Ghidra 12.2 Headless(해시 고정)와 작업 로컬 JDK25, 설치된 LLVM PE 검사, 필요한 읽기 전용 실행 상태 관찰. 전역 Java/PATH·MouseMux 설치본·라이선스 상태는 수정하지 않는다.
- 분석 입력: 설치된 MouseMux3.0.19의 main.exe, winhooks64.dll, 필요 시 reloader 모듈과 공개 SDK. 입력 사본 SHA와 원본 provenance를 기록한다. 라이선스/체험 제한 우회와 바이너리 패치·배포는 목표에 포함되지 않는다. 관찰한 시스템 API·상태 전이의 독립 구현이 목표다.
- 순서: PE import/export/입력 관련 문자열 → Ghidra 함수·호출 관계/관련 함수 디컴파일 → 수집/가상 상태/커서 표시/앱 전달 경로 구분 → 최소 재현 backend → MCP 등록/실제 호출 → 화면 효과와 전경·물리 커서·동시 입력/해제 검사. SDK wrapper만으로 자체 재현 완료를 주장하지 않는다.
- 분담: root는 Ghidra/실행 가설·최소 구현·수락을 소유한다. read-only `mousemux_integration_map`은 기존 SDK 및 MCP 연결 owner를 조사한다. 분석 결과와 실제 ABI/상태 계약이 준비된 뒤에만 의존 구현을 시작한다.
- 실제 앱 시험은 사용자 요청으로 MCP 연결 유지 후 root가 도구를 한 번씩 호출하고 화면을 확인하는 방식으로 수행한다. 자동 동작 묶음·루프·한 번에 여러 시나리오를 실행하는 앱 시험은 중단했다. 컴파일/프로토콜 준비 검사는 실제 앱 조작을 대신하지 않는다.
- 수락: 독립 커서 최소2개, 가상 포인터별 위치/held 상태 구분, 실제 앱 click/drag/text 효과, 다른 포인터 상태 보존, 중지·연결 종료 시 release, MCP 실제 요청/응답과 화면/앱 결과의 일치. 호환 앱·동시성·전경 변경은 각각 실제 결과로 보고하며 응답 success를 앱 성공으로 대체하지 않는다.
- 사용자는 Switched부터 구현·시험하도록 선택했다. 여러 논리 커서는 위치를 따로 유지하지만 실제 클릭/drag/key/text는 하나의 OS 입력과 foreground를 사용한다. 두 창 완전 동시 클릭·background-only·물리 입력 독립성은 이 모드의 보장이 아니다. 이 가시적 차이를 MCP 안내와 실제 시험 결과에 유지한다.
- Ghidra `run:EZ01:mmga-mvz390ao`는 winhooks78885ms/main147230ms, 각각 exit0이며 입력 관련 후보3/269개와 최대140개 함수의 제한된 디컴파일을 생성했다. main `FUN_140021bb0`의 virtual desktop 좌표 정규화·태그된 SendInput 경로, 별도 cursor 위치/keyboard thread attach 및 state 경로를 확인했다. 전체 프로그램 복원이나 모든 mode 경로 확인을 뜻하지 않는다. 독립 구현은 공개 Win32 API를 사용하고 코드/상수/offset을 복사하지 않는다. 첫 분석의 필수 JVM class loader 누락 실패(exit1)는 별도 실패 run으로 보존했다.
- 공식 매뉴얼은 Switched의 클릭 차례 전환과 Multiplex의 별도 창 클릭을 구분한다. 그림판에는 hardware dragging이 필요할 수 있고 hardware keyboard는 단일 foreground에 한정된다고 설명한다. 따라서 같은 기법의 독립성과 앱 호환성은 분석·실험 전까지 미확정이다.
- 새 산출물은 `run:EZ01:mmre-<unique>`의 inputs/temporary/outputs/logs/reports에 생성 전에 등록한다. 도구/분석 DB/원본 사본은 진행 중 분석 소비자가 소유하며 사용 종료 시 기존 owner로 정리한다. 이전 DLL 산출물의 종료 참조·정리도 기존 승인/보호에 따라 이어서 처리하며 완료로 간주하지 않는다.
- Switched 소스 `native/multi-pointer`와 `scripts/multi-pointer-mcp.cjs`, 최소 protocol 보존 검사2개를 작성했다. 두 검사는 실제 앱 수락을 대신하지 않는다. Paint50984/57180의 exact PID/생성시각/exe/root를 다시 확인하고 입력 없는 기준 캡처를 남겼다. 네이티브는 Windows/Alt/shell-switch 단축키를 제외하며 스레드별 키보드 state 부착/DLL을 사용하지 않는다.
- `run:EZ01:mp-mvz463w1`의 mcp-source207ms/configure20009ms/compile13541ms는 각각 exit0이었다. 실제 stdio smoke 프로세스 exit0과 달리 request3 상태 조회는 오류였으므로 전체 checker는 exit1이다. read-only native 진단으로 두 Paint 모두 minimized:true/visible:true/enabled:true인 것을 확인했고 target_unavailable/actionExecuted:false로 시작이 거절됐다. 이 시작 오류를 MCP가 응답 ID 오류로 가리던 부분을 고쳐, 실제 MCP의 상태 조회에서 원래 target_unavailable 이유를 확인했다. 앱 입력은 아직 전송하지 않았다.
- 변경 없는 native runtime/manifest는 재사용하며 바뀐 MCP/검사 source는 `temporary/switched-mcp-836cb3c2a5d8272a`에 별도 freeze했다. 해당 고정 소스 검사2개 exit0이다. native runtime 소비 참조는 기존 active root run에 지원된 helper로 추가한다. 사용자에게 두 그림판 복원을 요청했고 해당 준비가 끝날 때까지 실제 입력 시험을 보류한다. 분석의 독립 최소 근거는 root run `reports/mousemux-analysis-summary.json`, 시작 음성 시험은 `reports/multi-pointer-startup-negative.json`이다. 전체 task commit·실앱 수락·필수 정리는 미완료다.
- 등록된 `multi-pointer-native-paint-ez01` plan의 argv/input/guard를 검토했다. 현재 연결된 관리 runtime의 실행 요청은 maintenance/catalog busy에서 거절됐고 runID나 producer를 반환하지 않았다. 대기600000 요청도 구형 runtime의 상한5000 검증에서 거절됐다. 기존 종료/실패 결과는 보존하고, 동일 checker argv를 `exec_command`의 새 work_completion으로 실행한다. checker는 지원된 현재 lifecycle/catalog owner(최대600000ms)로 동일 잠금 취득을 기다린 뒤 소스를 freeze/컴파일하고 실제 MCP handshake/status/stop을 실행한다. 잠금 우회·삭제는 하지 않는다. 이 수동 실행은 등록 tool run이 성공했다는 영수증을 생성하지 않으며 checker 자체 결과와 입력 대조를 독립 근거로 사용한다.

사용자는 MouseMux 시험 후 Azrael에 필요한 가상 마우스·키보드만 자체 구현하도록 요청했다. MouseMux의 관찰 가능한 동작과 제공 SDK/프로토콜을 분석하고, Azrael의 기존 구현과 공개 구현을 조사하여 최소 경로를 만든다. 그래프/노드/범용 자동화 툴·다중 물리 장치 관리·MouseMux 런타임 의존은 요구하지 않는다. 앱 작업 자체는 마우스 클릭·키 입력으로 수행하며 RunProgram/셸/UIA 값 교체로 실제 입력 시험을 대신하지 않는다.

제품 소스 변경과 관련 검증은 이번 요청으로 승인됐다. 설치된 Azrael 교체·공개 배포·보호 프로세스/권한 상승·보안 설정 변경은 현재 실행 범위에 포함하지 않는다. 기존 Window Use 입력 사용 거절과 이후 읽기 전용 캡처 허용은 시험 도구 사용에 대한 결정이며 제품 개발의 앱/단계 권한을 약화하지 않는다.

플랫폼은 현재 Windows 로컬 x64 사용자 세션이다. Windows 11 Home build26200에서 MouseMux 표시만 확인했으며 자체 backend 소스와 host/provider 통합을 구현했으며 소유 Win32 fixture 검증을 통과했다. Linux/macOS 활성화와 child session 대체는 범위 밖이다. 앱/CPU/ABI 지원과 실제 확인 범위를 구분한다.

## 중단한 DLL 경로와 보존할 검증 한계

종전 구현은 승인한 일반 앱 프로세스에 작은 x64 DLL을 로드하고 입력 관련 API를 후킹했다. 소유 Win32 EDIT fixture에서는 성공했지만 실제 Paint에서는 전달된 메시지가 화면 효과로 이어지지 않았다. 사용자가 이 방식을 포기했으므로 추가 DLL 구현·배포는 실행하지 않는다. 새 분석이 MouseMux 내부 DLL 사용을 발견하더라도 이 사실을 숨기거나 동일 실패 경로를 성공한 것으로 재분류하지 않는다.

대상 앱 안에 DLL을 로드해 입력 API를 후킹하는 방식을 사용자가 승인했다. 우선 별도 테스트 프로세스에서 부착/해제와 실제 클릭·키 입력을 검증한다. 이 방식은 앱 프로세스의 실행을 변경하며 충돌 가능성과 앱별 호환성 차이가 있다. 프로세스 변경을 허용하지 않는 대안은 창 메시지 어댑터이며 키 상태/포커스 일관성의 호환성 범위가 더 좁다. 이를 동일한 가상화로 취급하지 않는다.

초기 fixture의 Unicode/shortcut/해제 성공은 현대 Paint, 한글 IME/TSF, x86/WOW64, 사용자 동시 입력의 증거가 아니다. 새 다중 마우스 구현에서도 가상 상태와 실제 앱 입력을 각각 확인한다. 설치된 Azrael2026.0.16은 기존 검증된 설치 owner를 유지하며 이번 조사로 교체하지 않는다.

## 처음 사용하는 사용자의 이용 흐름과 전면 활성화

사용자는 처음 Azrael을 쓰는 사람도 문제없이 활용할 수 있어야 한다는 요구를 추가했다. 일반 사용자가 DLL 파일, PID, 좌표 배율, 가상 키 코드, Input Mapper/Arm/그래프를 직접 구성하지 않도록 제품이 버전/비트수·권한·앱 호환성을 검사하고 승인한 창의 준비/해제를 관리한다. 사용자 동의가 필요한 앱/단계 권한은 기존 경계대로 남긴다. 자동 준비와 앱별 실제 수락 검증은 별개다.

DLL inline hook의 적용 지점은 로드된 프로세스의 API이며 창별 안전 경계를 자동 제공하지 않는다. 사용자는 승인한 한 프로세스의 여러 창 제어를 허용했다. 승인 단위는 정확한 PID/생성시간/실행파일 identity로 식별하는 프로세스로 확장하고, 그 프로세스의 HWND·자식 컨트롤·UI thread와 input context를 검증해야 하며, HWND 인자가 없는 GetCursorPos/GetAsyncKeyState 계열과 동일 프로세스의 여러 창/worker thread에서는 추가 context 설계가 필요하다. 동일 실행파일의 다른 프로세스·자식 프로세스는 자동 승인하지 않는다. 프로세스 내부 여러 창 제어와 외부 프로세스로 넘어가는 popup은 구분한다. 프로세스 DLL 후킹은 사용자 승인 완료다.

권고 동작은 background 창에 논리 cursor/key/focus/capture 상태를 제공하고 실제 foreground/focus와 Z-order를 바꾸는 입력 경로를 사용하지 않는 것이다. 가상 focus를 조회 API에서 제공하는 것과 OS 전체 foreground를 실제 변경하는 것은 다르다. 앱의 자체 activation/모달/다른 프로세스 동작으로 전면화가 생길 수 있어 가림 상태에서 실제 사용자 foreground 및 Z-order 변화와 대상의 입력 결과를 각각 측정한다. 전후 한 번의 snapshot으로 순간 전면화 부재를 보장하지 않는다. 미지원/간섭 시 새 입력을 멈추고 사용자에게 상태를 알려야 하며 실제 시스템 커서로 자동 전환하지 않는다. 이 전면화 완화는 제안이며 현재 구현/검증 결과가 아니다.
## 확인한 현재 구조

- 소유 계약: [Window Use](../../docs/architecture/window-use.md), 보존 feature `ui.window-control`와 [다중 플랫폼](../../docs/architecture/multi-platform.md).
- `native/window-control/src/windows_backend.rs`: 기존 WGC/UIA, DPI 인식, target identity/lifetime watcher와 observation을 소유한다. `uia.rs`의 제한 키 입력은 exact HWND 검증 후 PostMessage다. 가상 커서/키 상태 엔진은 없다.
- `scripts/window-control-policy.cjs`: 대화별 binding 하나와 공용 직렬 실행. 요청 시 앱·단계 권한, 중지, 관찰 freshness, occupancy를 검사한다. 가상 사용자/다중 창의 승인 범위를 자동 확대하지 않는다.
- `native/windows-child-session/ChildSession.cs`: 별도 세션의 SendInput을 이미 사용한다. 부모 세션에 가져오면 공유 입력 문제를 해결하지 못하므로 자체 가상 상태 엔진으로 대체한 것으로 주장하지 않는다.
- `native/window-control/Cargo.toml`: windows 0.58, serde, png 등 기존 라이브러리. 조사한 manifests에서 MinHook/EasyHook/Detours 의존을 찾지 못했다. 기존 승인/관찰/중지/전송을 재사용하고 별도 무제한 입력 endpoint를 만들지 않는다.
- 관련 native/window-control와 window-control host/policy 및 window-use.md는 조사 시 git status 변경이 없었다. 저장소 전체에는 다수의 다른 작업 변경이 있어 보존한다. 엔진 변경이 필요하면 실제 엔진 source owner를 먼저 해석한다.

## 분석 근거와 재사용 선택지

1. MouseMux V3 3.0.19 + Input Mapper2.2.38을 실제 설치·실행했다. 공식 로컬 MCP는 localhost41760, SDK는41001이다. Arm 뒤 가상 사용자 생성과 pointer.motion 요청을 처리한다. 폐쇄된 native 가상화 엔진의 정확한 내부 후킹 구조는 아직 확인하지 못했다. SDK JavaScript와 native 실행 로그가 내부 전체 구현의 증명은 아니다.
2. 제공된 MCP move_cursor는 sdk.send 직후 moved true를 반환한다. click tap은 button1 뒤 button0을 보내고, native 로그에는 button0 invalid mask 및 held-button safety release가 남았다. SDK LEFT_UP 상수는2다. 성공 응답을 앱 처리 완료로 취급하지 않는다. 이 코드를 자체 제품으로 복사하지 않고 독립 상태 계약과 검증을 작성한다.
3. [Microsoft PostMessage 설명](https://devblogs.microsoft.com/oldnewthing/20050530-11/?p=35513/)은 메시지 큐 삽입이 키 상태를 갱신하지 않음을 설명한다. [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)은 공유 input stream과 기존 키 상태/UIPI 제약을 가진다. 이들 API만 감싸서 일반 가상화가 됐다고 주장하지 않는다.
4. [ProtoInput](https://github.com/Ilyaki/ProtoInput)의 공개 구현은 대상 프로세스 내 Windows API 후킹으로 커서·키 상태·포커스/입력을 조정한다. 게임 중심의 사례이며 일반 앱 호환성은 미검증이다. 전체 게임/컨트롤러/GUI/입력 잠금 기능은 필요하지 않다.
5. [MinHook](https://github.com/TsudaKageyu/minhook)은 x86/x64의 작은 API hook 라이브러리 재사용 후보다. 도입 시 버전/라이선스 고정, provenance/고지와 실제 hook 적용·실패·해제를 검증한다. MinHook 1.3.4와 nlohmann/json 3.11.3을 출처·라이선스와 함께 고정했다.

## 중단한 DLL 구현의 조사 범위

1. 허용된 후킹 범위를 확정하고 기존 window-use owning section의 draft/target을 갱신한다. 기존 stage3 child session 및 stage4 desktop의 의미를 유지한다.
2. target identity와 thread/window context에 연결된 native virtual-input 상태를 구현한다. 물리 픽셀 cursor, held button, key down/up 및 modifier 상태, 논리 focus/capture, Unicode text와 실제 키 이벤트를 구분한다. 생성/부착/입력/해제는 명시적 결과와 지원 범위를 반환한다.
3. 프로세스 내 최소 hook adapter를 구현한다. GetCursorPos/SetCursorPos, 키 상태 조회 및 대상 앱이 실제 사용하는 focus/capture 경로를 조사·선정한다. raw input/TSF 등 추가 경로는 실제 앱의 요구가 확인될 때 확장한다. DPI 및 HWND 재생성을 기존 owner와 연결한다.
4. 이미 승인된 정확한 앱/target에만 연결하고, 기존 중지·취소·권한 철회·대상 폐기 시 새 입력 차단 및 held state 정리를 구현한다. backend 실패를 실제 시스템 커서/키 입력으로 자동 전환하지 않는다. 사용자가 승인한 프로세스 단위 범위를 host 권한/target 집합에 반영하고, 다른 프로세스까지 승인됐다고 해석하지 않는다.
5. fixture → 시험 전용 일반 앱에서 실제 클릭/drag/wheel/key/text/modifier 처리와 해제 후 정상 입력을 확인한다. 성공 enqueue와 대상 앱의 실제 내용 변화를 따로 검증한다. 초기 호환성 결과로 앱 범위/IME 등의 수락 범위를 정한다.
6. host 통합, feature inventory/필수 검사, frozen-input build와 필요한 Windows 회귀를 진행한다. 제품 업데이트/설치는 별도 권한과 실행 절차를 적용한다. 빌드 전에 project-maintenance bundle과 산출물 owner를 확정한다.

root가 계약·runtime adapter/staging·검증 runner·문서·통합 수락을 소유한다. native/virtual-input은 전담 worker, host/policy/MCP는 별도 worker가 소유하며 서로 다른 파일만 수정한다. read-only explorer가 기존 권한/ceiling/packaging 연결을 조사했다. 순서 의존은 native source → frozen fixture compilation → 실제 fixture 입력/해제 → host 통합 수락이며, fixture 준비와 host source 검사는 독립 진행한다. 제품 배포 빌드는 선택하지 않았다.

## 수락 및 보존 검증

- 가상 커서 좌표/버튼/키 상태를 실제 앱의 관찰 가능한 클릭·편집 결과로 검증한다. 단위 상태 모사만으로 제품 성공을 주장하지 않는다.
- Unicode 텍스트, modifier, keyup/buttonup 누락, 연결 종료, 권한 철회, process/window 교체에서 결과·정리·중지 경계를 검증한다. IME 실제 조합/동일 프로세스 다중창은 지원 범위를 확정해 따로 시험한다.
- 기존 capture/UIA·관찰 전용 보장·stage별 권한·user stop·selectedWindow ceiling·Linux/macOS 비활성 정책을 유지한다. 기존 `test-window-use-stage-authority.cjs`, `test-window-use-host.cjs`, native 검사와 feature inventory mandatory checks를 변경 범위에 맞게 재사용한다.
- 성능은 idle/process별 메모리·CPU, 입력 지연 및 중지 지연을 fixture와 실제 앱에서 측정해 보고한다. 현재 MouseMux가 무겁다는 사용자 체감은 요구 근거이며 정량 baseline은 없다. 가벼움과 범용 호환성을 아직 보장하지 않는다.

## 앞선 MouseMux 시험에서 남은 유효 근거

- 사용자가 Trial/설치/UAC를 직접 진행했고 MCP/Arm/Multi-cursor를 켰다. 공식 trial 안내는 full30분 최대3회, Free limited45분/session이었다. 현재 trial 상태는 별도 재검증이 필요하다.
- 가상 hwid쌍0x3000/1,0x3002/3,0x3006/7 생성·좌우 이동·삭제를 요청했다. Multi-cursor 활성화 후 사용자가 커서 표시를 확인했다. 표시 성공은 물리 입력 독립성/모든 좌표 도달/문자 입력 성공의 증거가 아니다.
- SDK가 돌려준 이름·색은 native 실제 사용자 Aqua/색과 같다고 확인되지 않았다. list_users는 AppState.users를 읽으며 SDK virtualUsers 전체가 아니다.
- Start/Search는 managed list_windows에 없었으나 사용자가 실제 Start가 열렸음을 확인했다. 목록 부재를 실행 실패로 판단하지 않는다. 직접 Ctrl+Esc/notepad/Enter 요청 뒤 메모장 프로세스는 확인되지 않았고, 사용자가 메뉴 닫은 타이밍 충돌을 알려 재시도했다. 실제 검색 내용/IME 상태는 미관찰이다.
- RunProgram 노드 방식은 사용자 요구와 달랐으므로 중단했다. 이번 소유 노드1/2/3 제거 후 get_graph nodes=[]/connections=[]로 정리를 검증했다. 다시 사용하지 않는다.
- 사용자가 직접 연 메모장은 처음 api_key.txt였으므로 내용 캡처/변경을 하지 않았다. 사용자가 새 빈 탭을 연 뒤 제목 없음 Notepad 후보를 관찰하고 선택만 했다(target16ea92db-91dd-4dff-a960-0cac591345d2). 캡처/입력 전 turn이 중단됐다. 기존 문서는 건드리지 않았다.
- hwid0x3008/0x3009(12296/12297)은 새 구현 요청 시 destroy_virtual_user를 요청해 destroyed 응답을 받았다. 기존 로그로 server removal을 추가 확인 중이다. 자체 backend는 MouseMux 런타임에 의존하지 않는다.

## 산출물·정리

- 설치 exe: `artifacts/tasks/EZ-01-window-use-multipointer-review/runs/20261102-mousemux/temporary/mousemux-v3-setup-3.0.19.exe`, 76,443,272bytes. SHA256 `50C2A5567647C57F17B7E93F8007D3660E12B30B326D3AAE46D4719256EF0ED5`, Authenticode Valid/The MouseMux Company.
- 기존 등록 group `ez01-mousemux-20261102`/item `ez01-mousemux-installer`, active installation/test reference. 실험에서 reverse-engineering 입력으로의 실제 필요와 보호/reference를 재검토하고, 불필요 시 기존 maintenance owner로 삭제한다. 아직 삭제 완료 또는 보존 승인으로 보고하지 않는다.
- 설치된 MouseMux와 사용자 설정/로그는 공식 앱 owner가 소유한다. 광범위 제거·설정 수정은 하지 않았다. 자체 구현의 새 fixture/build 출력은 생성 전에 소유 경로와 lifecycle을 기록한다.
- DLL 후킹 승인 후 제품 native/provider/host 소스 구현을 진행 중이다. 빌드 준비·실제 fixture·host 수락 결과는 아래 실행 근거에 기록한다. 배포/설치본 교체는 수행하지 않는다.




## Native 검증 실행 관리 오류 진단
run-17084-4890-1793593788719169400은 before integrity만 기록됐고 실행 session/producer PID/실행 출력이 없다. 최초 dispatch는 maintenance_busy OS lock 오류로 반환됐다. runner는 컴파일 전에 beginArtifactRun으로 virtual-native-* run directory를 생성해야 하지만 해당 출력은 없으며, 전체 Win32_Process snapshot에서 runner/cmake/MSBuild/selftest/fixture의 해당 명령 실행이 없었다(조회 자신만 반환). 세 근거를 함께 대조해 pre-execution dispatch failure로 판단하며 시험이 실행됐다고 보고하지 않는다. unknown receipt는 보존하고 owner recover로 실행 보호만 해제한 뒤 새 attempt를 시작한다. 소스/결과를 성공으로 바꾸거나 잠금을 삭제하지 않는다.

## 최종 수락 근거

- Windows x64 medium-integrity 로컬 프로세스의 GUI thread에 입력 API를 후킹한다. 일반 대화의 `request_stage(stage:2, virtualInput:true)`로 정확한 process 범위를 명시 동의한다. 기존 semantic stage2 및 selectedWindow ceiling은 유지한다. 창 전환 시 기존 attachment 해제를 확인한 후 새 창에 부착한다.
- 최신 native 입력 SHA는 `d81dee971d5f643c68d02f0002912cbaa0c25259d2534bce9793b0f0bc30a950`다. configure/compile/selftest는 각각 exit0, selftest는 1117ms였다. Win32 v6 single-line EDIT와 multiline EDIT, 동일 프로세스의 동일/별도 GUI thread 창 순차 입력, Unicode/shortcut/held release/unload, 실제 OS foreground/Z-order와 물리 cursor/key 상태 유지를 확인했다.
- 최초 긴 경로의 CMake probe는 MSB6003으로 실패해 짧은 등록 run 경로로 해결했다. legacy multiline EDIT의 Ctrl+A 미선택은 v6 fixture와 실제 Home+Shift+End 선택 시험으로 구분했다. 한 번의 물리 cursor 변화 실패는 원인 확정 없이 보존했으며 최신 진단에서는 모든 detach 전후 cursor와 마지막 입력 시각이 같았다.
- native wrapper의 최종 exit1은 lifecycle reconcile 잠금 충돌이었다. 실제 terminal 근거로 producer를 failure/exit1로 close하여 원래 결과를 보존했다. 등록 예약 충돌도 정확한 종료·SHA/fence 증거로 owner recover했으며 성공으로 바꾸지 않았다.
- source 검증: provider 최초6개와 최신 변경5개, runtime14개, stage-authority26개, host-errors41개 및 host/policy/MCP/virtual-policy 통과. staging4개는 기존 Python313을 child PATH에만 지정한 재실행으로 모두 통과했고 임시 루트 부재를 확인했다. PS parser 및 source diff 검사도 통과했다. 상세 근거는 [검증](02-verification.json), [최소 native 종료 근거](03-cleanup-evidence.json)다.
- 유지 검사 이유: 이후 변경에서 global SendInput 대체, 승인 identity 완화, timeout 재전송, 패키징 dependency 누락, unload 조기 성공을 다시 도입할 수 있어 해당 경계를 검사한다. native fixture는 실제 앱 처리와 hook 제거를 확인한다.
- 실제 사람이 동시에 움직이고 타이핑하는 검증, 일반 앱·IME/RawInput 호환성, 패키지·설치본 수락은 미확인이다. 설치본은 변경하지 않았다.
- 일시 보존은 [정확한 8묶음](07-pending-cleanup.json), 총140,845,600bytes다. 사용자 승인 범위이며 관리 잠금 해제 시 identity·보호·참조를 다시 확인해 기존 standalone owner로 삭제한다. 설치된 MouseMux와 사용자 파일은 제외한다.

## 그림판 실사용 시험과 개발 런타임 반영

- 사용자는 겹친 그림판 두 창의 전경 전환·동시 클릭·텍스트 입력 시험과 개발 런타임 반영을 승인했다. 기존 설치 MCP에는 virtual input 기능이 없어 아직 그림판 입력은 시작하지 않았다. 설치 후 재연결과 실제 앱 수락은 남아 있다.
- 설치된 2026.0.14의 불변 기준 `artifacts/inputs/014ao/project`와 기존 검증 엔진·계정 VSIX를 재사용한다. DLL 입력 commit의 해당 변경만 기준에 적용하고, 배포 옵션 전달 3줄 및 필요한 패키징 연결을 포함한다. 동시 작업의 2026.0.15를 피하기 위해 작업 전용 패키지는 2026.0.16으로 준비하며 공유 버전 파일은 변경하지 않는다.
- 실행 소유자는 `run:EZ01:paint-install-20261102`다. 선택한 native runtime은 `run:EZ01:vi-mvys34ex`에 의존 참조로 보호했다. 기존 8묶음 보존 승인이 이 새 실행 전체의 잔여물 보존을 허용하는 것은 아니다.
- 배포 전달 선택 검사는 실제 mock 수신 경로를 확인하여 1/1, exit0으로 통과했다. 두 초기 fixture 실패는 원래 결과로 보존하고 owner 정리를 진행한다. 최소 검증은 실행 reports/deploy-forwarding.json에 있다. 작업 전용 PowerShell 7.6.9는 공식 SHA256·Microsoft 서명·실행 버전을 확인했으며 시스템 설치는 하지 않았다.
- 입력 고정→공식 배포의 원본/패키지/host 검사→설치→사용자 재연결→새 managed tool을 통한 두 프로세스 별 승인과 그림판 시험 순으로 진행한다. 실행 중 배포 파일 덮어쓰기나 사용자 창 종료·강제 새로고침은 하지 않는다.
- 입력 고정은 05:26:08–05:40:24 UTC, exit0으로 완료했다. manifest SHA256은 `876ad548279b91653d13c4aa8c461048a3647a4c8f08cbbb9028764311f75d3c`다. Git 적용 중 바뀐 native CRLF는 고정 전에 검증 당시 원본 바이트로 맞췄고 native source SHA가 기존 수락과 정확히 일치한다.
- 첫 배포는 source-fixtures의 TypeScript 미준비로 exit1, 빌드·설치 전에 중단됐다. 고정 작업 사본의 lockfile로 npm ci를 실행해 exit0을 확인하고 실제 TypeScript/node-pty 로드를 확인했다. UI 원본 43개 파일(58,142,337bytes)과 기존 CUA/과거 v3 fixture, 짧은 Cargo 경로 및 instruction engine을 준비했다. fixture 준비 61항목이 exit0으로 통과했다. 두 번째 identity는 소켓 경로 109bytes로 시작 전에 exit1이었고 검증 상태 생성·설치는 없었다. `artifacts/v-3/s`의 실제 길이 검사를 통과시켜 `win016-ez01-paint-r3-20261102`로 실행 중이다. 의존성·fixture는 무시되는 작업 출력이며 고정 제품 소스는 변경하지 않는다.
- 배포 전달 테스트의 3개 run과 빈 TEMP 3개, 총1,587,698bytes 정리는 managed-root 경계로 보류했다. 정확한 경로 추가도 root 자체 보호에 걸려 설정을 원복했다. 삭제는 실행하지 않았다. 사용자는 [잔여 목록](08-deploy-cleanup-pending.json)의 정확한 6개 경로를 관리 경계 문제 해결까지 일시 보존하도록 승인했다. 해결 후 기존 owner로 삭제한다. 기존 8묶음과 별개의 명시적 승인이다.
- r3의 source-fixtures/environment/dependency/source-preflight는 exit0이었다. build의 code-mode 호환성 검사는 기본 TEMP 아래 socket 경로가114bytes여서 exit1, 병행 source-tests는 종료 처리되어 exit-1이었다. native fixture owner는 cleanup exit0과 removed:true를 기록했다. 이 결과를 통과로 재분류하지 않는다. 제품 소스를 수정하지 않고 `artifacts/p`(같은 기본 socket106bytes)로 새 불변 실행 사본을 준비 중이며 그 경로를 owning 관리 설정에 명시했다. 기존 실패 작업의 보호는 유지한다.
- 짧은 사본 준비는 05:55:15–06:15:25 UTC(20분10초), exit0이었다. 새 manifest SHA는 `74e77fc7db4141aeec721baef5e7ca9f0ce7539e938bf7a2cd1e17fb46c0920e`, 제품 SHA는 이전과 같은 `aee2b4bef9f1f4d2058eccdd88dcbef032afde4e941638e05843e69aaee74d28`다. 새 사본의 npm ci, TypeScript/node-pty 실제 로드, fixture61항목을 통과했다. `win016-ez01-paint-r4-20261102` 배포를 이 사본에서 시작했다.
- r4는 proxy window 등록 startup deadline으로 exit1이었다. 병행 source-tests는 종료됐으며 통과가 아니다. 이후 공식 build를 단독 실행하고 나머지 source/feature/host/install 검사를 순차 실행하도록 조정했다. 원인이 자원 경합인지 짧은 TEMP 차이인지는 확정하지 않았다.
- 단독 r5에서는 engine/code-mode IPC 26항목이 passed였고 패키징·Computer Use staging을 진행한 뒤 외부 lifecycle catalog 잠금 획득 실패로 exit1이었다. 요청은 acquire에서 거절됐고 native worker의 exit 관찰은 false였음을 그대로 기록했다. 새 catalog lease 획득·해제 실제0 근거는 reports/catalog-readiness-r6.json이다. r6는 native Window Control/child-session/staging까지 통과한 후 고정 Bun 입력 부재로 exit1이었다. 해당 DLL manifest와 provider 포함을 확인했다.
- r7은 기존 Bun1.4.2 실행 파일(86,096,984bytes, SHA256 `15277c59ccd6c6c20f8dc9716c2b59c1776320d606b6a8658f70be8799519ca4`)과 다운로드 기록을 작업 소유 tools 경로로 복사하고 실제 버전·소유 cache 경로를 확인한 뒤 단독 공식 build로 실행 중이다. 새 기능·기존 Provider 기능이나 수락 기준은 줄이지 않았다. 최종 source 검사·정확 VSIX host 수락·설치와 실제 그림판 시험은 여전히 남아 있다.
- r7은 새 경로의 endpoint 10초 제한으로 exit1이었다. 동일 바이너리의 별도 진단에서 원본 1705ms/새 복사본 3835ms가 각각 exit0이었다. 지연의 원인은 확정하지 않았고 제품 제한을 바꾸지 않았다. r8 공식 build는 exit0이며 DLL manifest SHA `ceea82076422bb77a8b10940195e224b6ff4f5fe81e3676d7b98d7c67972b7f0` 포함을 확인했다.
- r8 선택 소스 검사는 06:53:42 UTC에 시작해 실행 중이다. 고정 입력과 성공한 빌드를 사용한 VSIX 준비 및 변경 없는 engine preservation을 병행한다. 소스·정확 패키지·새 프로필의 coexistence/standalone 수락이 모두 통과해야 설치한다. 원래 companion 도구 캐시 경로가 없어 첫 패키지 준비는 exit1이었다. 새 도구는 같은 고정 lockfile로 작업 run의 temporary/package-tools/companion에 설치한다. 첫 실패와 재시도 로그를 분리했으며 설치나 그림판 입력은 아직 하지 않았다.
- 첫 r8 소스 group은 2175개 중 pass2166/fail2/skip7, exit1이었다. 누락된 pristine virtualized-turn-list fixture를 정확한 SHA로 복사하고 음성 fixture-admission 검사의 instruction-root 환경을 제거해 해당 두 파일 26개를 exit0으로 재검사했다. 원래 실패 결과는 바꾸지 않았다. 이후 실행되지 않았던 build-module-cache/deploy-azrael/verification-state 3개 선택 command를 원래 argv로 실행 중이며 이를 포함해야 소스 수락이 끝난다. 첫 targeted 재시도의 maintenance owner pin 누락도 원래 exit1로 남겼다.
- 패키지 2차 시도는 공유 namespace 캐시 소유 모듈이 고정 소스와 달라 guard에서 exit1이었다. 공유 코드를 바꾸지 않고 작업 사본의 별도 namespace owner/cache로 package-r3를 준비한다. engine preservation 첫 시도의 source-preflight 환경 identity 불일치도 exit1로 보존하고, 동일 환경에서 새 preflight와 전체 phase를 연결한 별도 재시도를 시작했다. 모든 수정은 실행 입력/fixture 범위이며 고정 제품 소스를 바꾸지 않았다.
- package-r3 준비는 07:12:19–07:20:05 UTC, exit0이었다. VSIX 709,245,273bytes, 버전2026.0.16, SHA256 `31f709fe57d95083f04395903fb624a6c4fee8f213ad583b3b957c781d52f7da`다. engine preservation도 동일 환경의 새 source preflight와 run/verify-receipt를 exit0으로 마쳤다.
- source 후속 3그룹 중 module-cache는 exit0이었다. deploy regression의 argv 추출 범위가 source-fixture 생성까지 포함해 초기화되지 않은 script 변수를 요구했으므로 테스트 끝 경계를 `$sourceFixtureRoot` 앞으로 좁혔다. 고정 제품 소스는 유지하고 7.9MB scripts 시험 사본에 이 한 줄만 바꿔 원래 ChangedOnly cases를 실행했다. deploy와 verification-state 모두 exit0, 07:27:42 UTC에 끝났다. 처음 scriptblock 실행의 PSScriptRoot 부재 실패는 별도 로그에 남겼다. 원래 source group 실패 및 건너뛴 결과는 변경하지 않고 corrected summaries로 연결한다.
- 전체 고정 입력 대조는 07:26:41 UTC에 exit0, 기존 제품 SHA 일치를 확인했다. 새 프로필의 exact VSIX coexistence/standalone host acceptance를 시작했다. 이 결과 확인 후 즉시 설치 전 입력·패키지·engine receipt를 재확인하고 승인된 NoLaunch 설치를 수행한다. 실제 그림판/사용자 동시 입력 수락은 아직 미검증이다.
- exact package host acceptance는 exit0이었다. fresh state, version/SHA 일치, initialInventory/hostInstall/finalInventory/host/standaloneHost 모두 실제0을 확인했다. 첫 사용자 설치 시도는 엔진 receipt input identity 재검증에서 exit1로 멈췄고 설치본을 교체하지 않았다. 중첩 PowerShell 및 별도 exec 호출의 환경 변수를 값 대신 키별 SHA로 비교했으나 차이가 재현되지 않았다. 구체적인 과거 불일치 원인은 미확정이다. 같은 설치 프로세스 환경에서 source preflight→전체 engine phase→verify-receipt를 새로 연결하고 이전/새 input의 달라진 필드만 기록하는 재시도를 시작했다. 소스/패키지 사전 대조와 등록된 현재2026.0.14 확인 및 NoLaunch 조건은 유지한다.
- 설치 완료를 별도 영수증과 실제 registry로 확인했다. 현재 등록2026.0.16, receipt `artifacts/p/artifacts/deployments/independent-20261102-164339-910/deployment.json`의 status `installed-reload-required`, hostInstalled/reloadRequired true, Launched false다. 설정 SHA는 설치 직전/직후 동일 `8a73a6bac4173dd83101b6040d7a0c1b260bc7b3c3df74ce2e97d22b5464947f`이며 unrelated inventory unchanged를 확인했다. 이 값은 과거 사전 기록과 달라져 있었으므로 설치 직전 기준으로 비교했다. version lifecycle은 complete/membership_complete:true/revision6이다. 바깥 PS5 실행은 Code 경고 stderr와 exit1로 기록됐으므로 이를 exit0으로 바꾸지 않는다. 내부 install acceptance와 최종 lifecycle까지 완료됨을 근거로 설치 상태를 별도 수락했다.
- 새/이전 engine receipt input 중 달라진 필드는 executionEnvironment뿐이고 project SHA는 동일하다. 새로운 동일 프로세스 chain과 verify-receipt, 전체 fixed input audit, UI binding 재검증은 통과했다. 구체적인 과거 환경 변수 원인은 미확정이다. 현재 연결된 MCP 도구 목록에는 virtual-input API가 아직 없으므로 사용자 재연결/창 새로고침 후 context와 실제 도구를 다시 확인해야 한다. 사용자 Paint 입력 시험 및 최종 owner 정리·선택 task commit은 남아 있으며 작업 완료가 아니다.
- 사용자 업데이트 확인 후 새 MCP context에서 virtual_input/release_virtual_input을 확인했다. prepare_permissions는 unclassified 오류였으며 재호출하지 않았다. 각 그림판을 새로 선택해 exact-process virtualInput stage2 승인을 받고 client(500,450)의 좌버튼 down/up을 전송했다. 첫 창에는 T key down/up도 보냈다. 도구는 delivery virtualInput/verified:false였고 매번 fresh capture를 사용했다. 두 창 모두 캔버스 점이 보이지 않았고 첫 창의 텍스트 도구 전환도 관찰되지 않았다. 입력·실제 앱 효과를 구분하며 두 연결 모두 detached:true로 정상 해제했다. 그림판 호환성 수락 실패이며, 현대 입력 경로와 classic HWND 메시지의 관계는 추가 진단 대상이다. 전경/Z-order/물리 커서 직접 측정·사용자 동시 입력·텍스트 제출은 아직 미검증이다. 자동 global input/UIA/clipboard fallback이나 파일 저장은 하지 않았다. 최소 근거 reports/paint-managed-test.json에 기록했다.
- 사용자가 Window Use 대신 독립 DLL 주입 프로그램을 명시적으로 요청했다. 기존 native broker를 직접 구동하며 로컬 Windows x64·동일 사용자 medium Paint PID50984/creation/executable/HWND를 재검증했다. Window Use 호출 없이 move/down/drag/up/T down/up/status/detach/shutdown을 실행해 broker exit0 및 unloaded:true를 얻었다. 직접 PrintWindow 캡처에서도 캔버스 변화가 없었다. read-only 자식 HWND/hit-test 추적상 canvas와 toolbar 좌표 모두 Microsoft.UI.Content.DesktopChildSiteBridge로 귀결된다. 숨겨진 MSPaintView와 0크기 입력/Afx 자식은 임의로 입력 대상으로 바꾸지 않았다. 원본 Paint11.2605.81.0 상태에 관한 관찰이며 타 앱 전체로 일반화하지 않는다.
- native broker 진단 보완은 common.hpp/hook.cpp/broker.cpp/README에 한정한다. private ABI2로 구/신 DLL 혼용을 거절하고 실제 마지막 전송 HWND·class·message·LRESULT·누적 횟수 및 applicationEffectVerified:false를 보고한다. WinUI 입력 처리 자체가 고쳐졌다는 주장은 하지 않는다. 기존 공식 check-window-virtual-input-native가 run:EZ01:vi-mvz26ul3에 새 native 입력을 freeze하고 configure/compile/selftest를 실행 중이다. 설치된 런타임은 바꾸지 않으며 준비된 직접 드라이버로 새 runtime을 재시험한다. Microsoft winappCli 공식 ui-automation 문서의 windowless XAML 메시지 입력 제한은 관찰과 일치하는 보조 근거다. 실제 rendered text와 커서/전경/동시성 수락은 미완료다.
- run:EZ01:vi-mvz26ul3의 configure55727ms/compile67558ms/selftest1486ms 모두 exit0, sourceSHA e3c68631a1b51e084542137252a8a4dcdba952f6b2439f1ebf4606033b081d4e, runtimeManifestSHA63abff1d0a753cd745ab354e4ed9f109568dd0646e0f79d4e6ed3413bc4e76fe다. 새 runtime으로 독립 broker 재시험 exit0/unloaded:true를 확인했다. 실제27개 메시지가 전송됐으며 mouse는 DesktopChildSiteBridge, key/text는 InputSiteWindowClass로 전달됐다. 텍스트 도구가 준비되지 않은 상태에서 'Azrael DLL test 123' WM_CHAR를 보냈으므로 정상 편집기의 문자 처리 실패를 별도로 입증한 것은 아니다. 직접 최종 캡처1111x835에서 선/도구전환/문자가 보이지 않았다. 진단은 개선했지만 입력 기능은 아직 실패다. installed Azrael은 그대로이며 global input을 사용하지 않았다. 최소결과 reports/direct-paint-result.json, transcript/terminal에 보존한다. 다음 기능 보완은 WinUI 내부 입력 경로 조사이며 classic message replay만으로 완료로 처리하지 않는다. 신규 native group/diagnostic 임시물은 현재 원인 조사 소비자에 필요하고 최종 정리·task commit은 미완료다.
- 사용자는 드래그 외에 브러시/색상 변경을 별도로 요청했다. 같은 독립 DLL runtime으로 brush arrow client(328,155), color button(512,117)을 move/down/up했다. 실제 outer/client offset11/45를 반영했다. 각 broker exit0/unloaded:true, 전후 정상1111x835 PrintWindow PNG 4개 SHA가 모두 같았고 메뉴/색상 선택 효과를 관찰하지 못했다. 색상 메뉴가 열리지 않아 특정 색 선택 자체는 실행하지 않았다. 별도 popup 누락 가능성 확인 중 target이237x39 최소화 상태가 되어 status unsupported_target/mutationOutcome:none을 반환했으므로 추가 입력·복원 없이 중단했다. EOF 정리 broker exit0이며 최종 exact process module 점검으로 DLL 잔류를 확인한다. 최소화 원인은 단정하지 않는다. 드래그 방식 부족만으로 toolbar 무반응을 설명할 수는 없으며, transient/separate popup 확인은 최소화로 제한됐다. reports/toolbar-test-result.json에 구분해 기록했다.

### 협업 네이티브 준비 인계 (2026-11-02 13:47 UTC)

- native source freeze 후 root가 run:EZ01:mp-mvzbcyp3에서 source2·CMake configure·Release compile·실제 stdio initialize/status/stop을 실행했다. 모두 actual exit0, status prepared. outputs/runtime과 reports/native-results.json이 인계물이며 applicationEffectVerified:false다. 수동 MCP 소비를 paint-install-20261102 revision20 execution reference로 보호했다.
- 다음 의존성은 명시적 collaboration enable 후 사용자의 실제 relative movement capability probe다. 이를 통과한 뒤 한 동작씩 실제 MCP·화면으로 커서 분리/FIFO를 검증한다. 설치·제품 빌드는 승인됐다고 간주하지 않는다.
- staging owner는 새 deploy-coop-* run 안의 독립 project에서 full engine build target mock 하나만 검증한다. main project artifacts/t-*를 추가 생성하지 않는다. 실제 마우스 시험과 독립적이다.

### 후속 검증 (2026-11-02 14:06 UTC)

- 첫 수동 enable은 rawPackets0/suppressed0에서 unsupported로 즉시 종료됐다. 요청을 끄고 MCP stop/EOF를 실행해 실제 exit0를 확인했다. transcript cooperative-manual-mcp-01.json. native owner는 초기 known-device arrival만 제한적으로 허용하고 off 실패 오염을 수정했다. 새 run:EZ01:mp-mvzbwni0의 컴파일·stdio 시작/종료 모두 actual0, 수동 협업은 재시험 대기다.
- 전체 Window Use source 범위 272개 중 268pass/2fail/2skip. 실패2는 격리 fixture에 빠진 namespace 의존성(글꼴 정책·errorPresentation·team-design 문서) 때문이었다. 각 실패의 actual1을 유지했다. 누락 입력을 완성한 run:EZ01:coop-preserve-close-mvzbz1ci에서 해당 두 파일16개 모두 actual0. 명시적 logoff 소스검사14파일도 직전 run에서 child actual0. 두 native helper/viewer 실기 항목은 fixture 미지정으로 skip됐으며 이 작업이 실기 성공으로 주장하지 않는다.
- 배포 full engine mock1개 actual0(제품 빌드·설치 없음). artifact-run retained16묶음 child actual0; wrapper 후처리 owner-path 오류의 outer actual1은 보존했다. 근거는 root reports/deploy-coop-verification.json과 cooperative-artifact-run-verification.json 및 cooperative-source-verification-01.json.
- 정리 exact5는 현재15,146bytes다. 예약은 없지만 공유 project-maintenance.json의 다른 writer가 실제 config를 변경해 지원 등록/삭제가 보류됐다. root reports/cooperative-source-cleanup-02.json이 정확 identity·종료·크기 근거이며, 무단 설정복원이나 경계확장은 하지 않는다. 새 실행 산출물은 아직 현재 인계/검증 용도이며 최종 정리 대상과 별도 보존조건을 정리해야 한다.

### 직접 MCP 재시도와 현재 수정 (2026-11-02)

- manual transcript03에서 known relative mouse와 억제 중 raw correspondence2쌍을 받아 ready/enabled를 확인했다. 모델 logical pointer의 생성·이동은 OS input0이었다. 최초 모델 클릭은 physical_held/applicationInputs0으로 종료되어 held category 자체는 아직 확정되지 않았다.
- transcript04는 최초10초에 이동이 없어 준비가 만료됐고, 실제 이동이 들어온 뒤 명시 enable을 다시 실행해 ready가 됐다. 모델 brush click의 caption activation에서 own-tagged mouse1회 직후 실패했다. lastRaw는 deviceHandle0/absolute true/mouseFlags3/zero_device_handle였다. applicationInputs0, tracked synthetic release=true, MCP actualexit0를 확인했다. 자체 SendInput Raw Input 상관관계 분류와 실패 상태 조회를 native owner가 수정 중이다. keyboard event count는 해당 동작 구간에서 변하지 않았으므로 이 실패를 사용자 keyboard 원인으로 보지 않는다.
- host는 범주·사유·카운터·flags만 projection하고 handle/실제extraInfo/경로는 제외하도록 기존 privacy 검사를 확장했다. 이후 새 run:EZ01:coop-frozen-mvzdh41z의 8파일56개 검사가 actual0/pass, frozen scripts unchanged다. 향후 진단 필드 확장 때 raw identity를 통째로 노출하는 실수를 막기 위해 기존 privacy case를 확장해 유지한다.
- root reports/cooperative-host-preservation-evidence.json에 종료된 source6개 선택hash·producer상태·결과를 독립 보존했다. cleanup owner에게 이전 exact5와 source6/deploy1/artifact1, 총13그룹만 지원 절차로 fresh 등록·review·삭제·finalize하도록 인계했다. 현재 최신source56/native/rootrun은 제외했다.

### Own RAW 수정본 준비 결과 (2026-11-03 KST)

- Native owner가 raw-origin.hpp의 실제 classifier를 공유하는 인수 없는 순수 selftest target을 추가했다. root는 기존 checker 안에서 동일 고정 입력으로 main/EXCLUDE_FROM_ALL selftest를 명시적으로 build·run하도록 연결했다. Release에서도 assert 제거에 의존하지 않는24개 판정 모두0fail/actualexit0였다.
- run:EZ01:mp-mvzdvfol: source2/configure/main compile/selftest compile/selftest 모두 actual0. 이후 실제 MCP startup은 Target must be visible, enabled and restored로actual1. 읽기전용 IsIconic 확인에서 두 Paint 모두 minimized:true/visible:true/enabled:true였고 native process actualexit1/terminationverified가 전달됐다. 이를 buildpass나 전체preparedpass로 바꾸지 않는다. 근거 root reports/own-raw-native-preparation.json. 사용자가 복원하면 동일runtime을 재사용해 startup/수동수락만 새로 검증한다.
- root parent run revision22에 이 runtime 소비 reference를 기록했다. 수정 MCP parent는 initialize만 완료했고 native target startup/입력은 복원 응답 전 시도하지 않는다. transcript cooperative-manual-mcp-05.json.
- 새 preparationWaitReason projection까지 포함한 최종 host8파일56개는 run:EZ01:coop-frozen-mvzdzgz3에서 actual0/pass. feature owner/checks는 tool.multi-pointer와 ui.window-control에 한정한 validateManifest actual0(전역profile/schedule 검증 제외), checker node --check actual0.

### 대기 전 정리와 종료 (2026-11-03 KST)

- cleanup03은 exact13 deleted/finalized/actualexit0, logical5,982,622,804B, cleanup04는 source exact2 deleted/finalized/actualexit0, logical20,076,665B다. 각 per-item remainingfalse·finalize remaining/refs/blockers[] 및 SHA-bound evidence unchanged를 수락했다. 합계15그룹6,002,699,469B이며 physical reclaimed는 미측정이다. 현재 runtime/native/rootrun은 이 범위에서 제외됐다.
- 복원 응답을 기다리는 동안 initialize만 한 MCP parent PID36904도 disconnect/EOF로 actualexit0/signalnull/terminationverifiedtrue 종료했다. native target startup이나 앱 입력은 없었다. 이후 복원 확인 시 동일 mp-mvzdvfol runtime에서 새 수동 MCP 연결을 만든다.
- 공유 파일 diff를 확인했다. artifact-run.cjs에는 타 작업의 assertEnabled/queue/reconcile 변경도 있어 이 작업은 catalog 관찰의 withCatalogLock 한 줄만 별도로 취급해야 한다. feature inventory/build/config에도 타 작업 변경이 있어 최종 task commit 전 hunk별 소유 확인이 필요하다. 현재 실제 수락과 현재필요 bundle의 정리가 남아 commit을 실행하지 않았다.

### 복원 후 수동 MCP 재연결

- 사용자 복원 응답 후 기존 mp-mvzdvfol 검증 바이너리를 재사용하여 manual MCP06 initialize/status 성공. 새 컴파일 없음. 두 Paint의 프로세스 생성 identity와 창 캡처 확인, B 브러시 좌표(500,170)에 모델 논리 커서 생성(Windows 입력0).
- raw-origin 실제 작동 및 드래그/FIFO 수락은 아직 대기. 협업 requested:false/suppression:false이며 물리 이동 준비 응답 후 활성화한다. transcript: rootrun reports/cooperative-manual-mcp-06.json; captures: temporary/switched-captures/coop-restored-06-*.png.

### MCP06 협업 실기 결과

- 실제 상대 이동으로 suppressed RAW 생존 pairs2, phase ready/enabled 확인. User movement 중 op1 브러시 click 수행: caption activation3, applicationInputs2, own LL6, own RAW 무시5. 마지막 null-device RAW leftUP(flags0/buttonFlags2/marker matches)의 receipt 불일치로 fail-open. 키보드 카운터 변화 없음. 실패 op1 재전송하지 않음. 후속 캡처에서 B 전경과 브러시 선택 highlight 확인: 앱 효과 일부 있었으므로 전체 gesture 성공으로 보고하지 않음.
- stop/off/suppression false, MCP와 native close exit0/signalnull/terminationVerifiedtrue 확인. transcript reports/cooperative-manual-mcp-06.json; capture coop-click-06.
- native 담당에 bounded mismatch category 진단을 요청. 원인 불명 상태로 marker/time/kind guard 완화 금지, freeze 후 root compile/selftest. 실제 드래그/FIFO/복구 수락은 미완료.

### RAW receipt 원인 진단 준비

- native 담당 capacity 오류 후 root 인계. 이미 작성된 raw-origin classifier category와 최근 최대8개 trusted receipt 진단을 검토. 기존 허용 조건은 동일하고, 진단 전용 복사에서 consumed/time/age를 제외해 shapeReason을 추가 관찰한다. marker 단독 허용 없음. native 3파일 입력 변경으로 새 immutable identity mp-mvzu3o6t 생성.
- root checker work11c1a446-e924-410e-b367-ed4efff6d552, session2715 실행중. 새 컴파일과 판별 selftest/실제 MCP startup 필요. 일반 애플리케이션 시나리오 자동 실행 없음. 실제 재시험 전 user 움직임 준비를 다시 요청한다.

- mp-mvzu3o6t native preparation 전체 exit0/prepared. classifier33/0fail, mcp-source/configure/compile/selftestcompile/actualstdio 모두0. independent reports/receipt-diagnostic-native-preparation.json. root parent execution ref revision23 추가, 수동 MCP07 연결/status 및 cursor 생성0 입력 완료. 이동 준비 응답 대기, collaboration off.

### MCP07 결과와 양방향 RAW 상관관계 수정

- 실제 user motion probe ready/pairs2 후 click op1: caption3 + application1(총5)에서 fail-open. RAW leftDOWN에 대응하는 최신 receipt가 없고 기존4개 receipt는 모두 consumed였다. 마지막 own LL count5와 실제 진단 목록4의 관측 시점이 달라 통지 순서 불일치 가능성. 확정 원인을 단정하지 않는다. release 추가 후 총6, stop/native close 실제0. op1 미재전송.
- root native/multi-pointer 세 파일 수정: full-tag LL receipt 공개 후 observation counter 증가; null-device own marker RAW만 최대8개/20ms 격리하여 뒤늦은 exact full-tag receipt와 기존 predicate로만 매칭. marker 단독 승인 불가. 각 mouse SendInput 뒤 hook+RAW 모두 정합될 때까지 다음 입력을 막음. 타임아웃/큐 초과는 fail-open. hook에서 할당/잠금/대기 없음. 실제 입력 문제 해결은 새 manual acceptance 전 미검증.

- 통지 순서 수정 mp-mvzuayjd preparation 전체0/prepared; classifier33/0fail, actualstdio0. source 변경없는 호스트56 검사 재사용(native-only 수정). root parent revision24 execution ref 추가. 수동 MCP08 status/off, pointer 생성 Windows입력0, 이동 준비 응답 대기. independent reports/own-raw-correlation-native-preparation.json. owning architecture의 회복/큐 경계 현황을 실제 소스와 일치시키고 실기 미수락 상태 유지.

### MCP08 클릭 통과와 사용자 복원 수정

- user movement 중 click op1 성공(no error), caption activation3 + app input2, ownRAW7 matched, phase ready/failure0. 모델 좌표500170 고정과 별도 user1214559 관측. 이후 idle restoration이 user logical 좌표를 계속 쫓아200ms 예산을 소진, lastFailure user_position_restore_failed로 fail-open. drag 미실행. stop/native parent 실제0.
- root broker 수정: 최신 user position latch·동일 사용자/세션/desktop target 검증·SendInput 및 capture 해제를 동일 routing UI invoke에서 처리. 실제 own hook/physical point/미처리 physical packet 검사는 유지. hook+RAW 정합 대기는 capture 해제 이후에도 강제. 이 수정의 실기 수락 전 성공을 주장하지 않음.
- 새 immutable checker 실행(work2ccfc73d-eefe-4a24-99a9-f14e6c4be873). 기존 host source56 검사 재사용.

- mp-mvzuho8u compilation/classifier33/actualstdio 全step0/prepared. independent user-handoff-native-preparation.json; current manual MCP09 connected/status off/pointer prepared no Windows input. root parent execution ref revision26. Actual idle handoff/drag awaits manual movement reply. Native previous08 stop verified; exact2 older cleanup proceeds independently, no current runtime deletion.

### MCP09 실제 이동 분리 확인 / RAW 대기 복원 보완

- continuous user mouse 중 클릭op1 성공·capture false/ready 유지. move logical700420, dragop2 1500ms→900450 성공153inputs; own LL/RAW160, failure0, 별도 user814458 관측. coop-drag-09 B 캡처에 새 직선 visible. 따라서 이 동작에서 모델 경로 분리 관측, 일반적인 협업 전체 수락과는 별개.
- 드래그 후200ms idle handoff 실패: own count160 그대로라 복원 SendInput 자체가 없었음. sent Ui::invoke가 queued RAW를 추월하며 firstUnmatched guard를 계속 보류한 경로. stop/native0.
- Ui routing thread에서 handoff 검사 전 controller WM_INPUT만 최대256개 Peek/Dispatch 처리(기존 controlProc+DefWindowProc 정리 유지). 종료/authority/firstUnmatched 검사 유지. source 수정 후 새 identity compile 및 수동수락 필요.

- raw drain 첫 preparation mp-mvzumtnn 전체0 후, 실기 전에 bounded restorationReason 진단 추가가 필요해 새 freeze 재실행. 앞선 실패에서 safe gate대기와 권한/표면검사 예외를 구분할 근거가 부족하므로 관측을 확정원인으로 간주하지 않는다. 첫 중간 runtime은 수동실행하지 않았고 독립 native-results를 reports/raw-drain-preparation-before-diagnostics.json에 보존. 즉시 obsolete cleanup 대상. 새 workef5c955a-0408-483f-9f84-b92ec3780cb4, 상세검사없던 사본을 추가 보존하지 않음.

- raw drain+bounded reason 최종 mp-mvzuo258 checker全step0, manual MCP10 off/pointer700480 준비. older08/09 actual0 proof로 root parent refs supported 해제(revision28). current runtime 보호 유지. 다음 실제 이동 준비 답변 대기.

### MCP10 continuous-motion handoff 原因確定

- 실제 user motion 중 dragop1 성공156inputs(caption3 포함), ownRaw156, failure0. 후속status에서 handoff physical_raw_pending, owncount156 unchanged 후200ms restoration fail. 이전 추정 중 권한/표면예외 가능성을 제거하고 continuous movement를 quiet gate가 막았음을 확인. stop/native0.
- idle handoff에서 zero-unmatched 요구만 제거: bounded RAW drain 후 최신 관측 user sample을 동일 UI turn에서 검증·복원하고 capture 해제. suppression 중40ms RAW watchdog·exact own hook/RAW·same-user/surface/session/desktop 및 partial no replay 유지. sample 이후 아직 queued된 물리 delta의 정확도는 실기에서 별도 관찰(원시 입력 모든 샘플의 완전 보존/acceleration fidelity를 주장하지 않음). 새 native compile workdc7c7b2c-a118-470c-a831-1ef341486880.

### MCP11 이동 분리·연속 작업·복원 실제 통과

- mvzuqvv5 continuous movement probe ready/pairs2. dragop1(700540→900570,1500ms) 성공156inputs(caption3포함), ownRAW157, restorationReason restored/capturefalse/readyfailure0. 후속status 사용자physical1235544==logical1235544, 모델900570 별도 유지. capture coop-drag-11 B에서 직선 확인.
- 같은 세션 재enable 없이 logical700600 이동 후 dragop2→900630,1000ms 성공103inputs. 후속ready/failedfalse/suppressionfalse/restored, ownLL261==matchedRAW261. 실제 일반마우스 이동 중 모델 경로 분리 및 반복 idle handoff를 이 환경에서 관측. 가속/모든장치/RAW소비앱 보장은 아님.
- 다음 수락: user click during model drag FIFO·다중창 재활성화·부분무재전송 및 종료. 설치본 미반영. MCP11 현재 off가 아니라 requested ready, idle physical native input 정상, 모델hold없음.

### 사용자 FIFO 시험 실패와 커서 UX 정정

- MCP11 op3 2000ms drag 도중 human RAW down queued1 확인, 약47ms 후 raw_delivery_lost로 모델부분drag중단; applicationInputs1/observeRequiredtrue, human skipped1/stopped_or_unroutable, native+parent0. op3 재전송금지. 사용자 실제 보고: 모델 드래그 위치로 마우스가 빨려 들어가 클릭됨. 앞선 성공은 모델 경로·idle handoff의 제한 관측이며 사용자 클릭 위치독립/사용성 수락이 아님을 정정.
- 현재 OS cursor는 active shared input을 따라가는데 모델 overlay는 시작점 고정, User와 모델색 유사. root UI지침 읽고 모델표시 active path추적(논리 next move는 종료후표시복원), User흰색/검정테두리 및 역할명, 모델색pill/역할명 추가. 전역cursor테마 변경/숨김은 하지않음.
- 감시근거: lastForeign physical button_down 직후 RAW감시47ms실패. motion RAW watchdog에 button/wheel hook을 섞지않고 motiontime만 별도추적; 물리 RAW motion이 hook보다 먼저 오는 순서도 timestamp상호대조. 기존 human raw down/up·gesture2s/fail-open 유지. userAtModelStart/lastHumanSubmission 좌표를 native 상태에 추가해 실제 사용자논리점 검증. Actual FIFO·UX 재시험 전 성공아님.

- mvzuxtgh native compiler/classifier33/stdio 全step0. reports/cursor-presentation-native-preparation.json preserved. Model pointer label/pill実像 visual-model-ready-desktop.png에서 한국어/색/클릭투과 그림판 표면 확인(현재light canvas). Userpointer 및動作render/FIFO/사용자체감은 다음실기대기. current MCP12 statusoff/readycursor700420. Screen helper 최초CopyFromScreen flag조합은APIenum제약으로exit1, BitBlt SourceCopy|CaptureBlt로고쳐실제exit0. helper는 read-only regioncapture, app input없음.

### MCP12 FIFO·좌표·표시 실기 확인 및 사용자 수락

- probe ready 후 모델dragop1(700420→900450,2000ms) 성공206inputs/caption3, 모델 종료 응답 당시 human queued3/completed0 → 후속status completed4/skipped0/lastHumanFailure none/lastHumanInputs2/queue0/readyfailure0/restored. 사용자 여러 클릭·짧은 이동4건이 모델뒤처리됨. 모델 userAtStart1189446과 lastHumanSubmission1299461, model종점900450 별도. 화면 coop-fifo-12-active-desktop에서 이동중 모델green pill/흰색사용자 실제분리표시 확인.
- 같은 op1 동일params를 status/capture 이후 재요청: duplicateOperationtrue, ownLL227→227로 입력재전송없음. collaboration disabled→off/suppressionfalse 확인. 실제 모델경로 및 queued입력수락은 이 Windows Paint 환경 범위, 모든장치/RAW앱/가속fidelity 보장아님.
- 사용자가 `의도한 곳에 클릭됐고 구분됐음` 명시확인. 이전 사용자빨려들어감UX실패를 수정후이번마우스협업 실기에서해소확인. Installed Azrael 미반영. 다음 두 root전경/정리/통합검토.

### 多창 준비 및 off-mode 간섭 관찰

- 사용자FIFO12 정상확인 후 명시 off모드에서 Abrushclick op2 성공: foreground c03d4, recovery round1/35ms/app2. A짧은dragop3는 실제physical wheel로 applicationdown1 이후중단, observeRequiredtrue/무재전송. 이때협업off이므로 정상적인간섭중단이며 협업FIFO검증과혼동하지않음.
- 자발적인 재enable에서는 physicalmotionprobe1pair뿐이어서 raw_survival_unproven으로fail-open, appinput추가없음. off재설정, 양Paintcapture로partial관찰후 다음의도op는새좌표450400 준비. 20초continuousmotion준비답을받아 enable후다중창시험. 이후 idle기간에는enabled유지/실제capturefalse로일반입력통과, 불필요한disable/reprobe 반복을피함.

### 최종 native MCP12 기본 협업 수락 범위

- continuous user motion 활성화후 A op4 drag성공, Bop5 caption fallback전경→drag성공, Aop6 caption전경→click성공. 모두 recoveryround1(44/49/45ms), ready/restore유지. forced OS refusal3회예산소진은실기미검증.
- atomicpressT op7 후 desktopcapture에서 texttoolbar확인(PrintWindow원창만캡처하면popuptoolbar누락). UIA는읽기 관찰만사용, 모든행동MCP마우스/키입력만. text상자dragop9 +Unicodeop10 `협업 MCP 2026` 23inputs와실제렌더확인. Bscrollop11 -120 실제stroke/scrollbar이동확인, op12 +120 원위치복귀.
- final status ready/humancompleted4/skipped0. stop/off/suppressionfalse 및MCP/native actualclose0/signalnull/terminationVerifiedtrue. 사용자앱저장/종료안함. all root input processes 종료됨. independent reports/cooperative-manual-acceptance-02.json. Source integration56호스트검사/33classifier및frozenprep0 근거재사용. 설치본 미변경, 전체제품빌드/설치명시권한없어다음사용자결정필요.
- cleanup05 exact2/19,802,396logicalB +cleanup06 exact3/29,900,633logicalB actualall0/deleted-finalized/remaining[] 보고수락. physicalreclaimed미측정.

### 사용자 추가 결함 보고: 드래그 종료 순간 사용자 커서 이동

- 사용자가 `드래그가 끝난 시점에 사용자 마우스가 그리로 순간이동` 보고. 앞선 click구분 확인은 이 종료 handoff UX를 수락한 근거가 아님. 일반 정상복원/협업완료 결론을 이 범위에서 철회하고 실제 종료경계 조사·수정 우선. 제품빌드/설치권한은 아직없고 진행보류. MCP12/native actual0 종료상태 유지, 입력없음.

### 종료 순간이동: Windows 커서 선행 가능성 및 경계 진단

- 사용자 `흰색사용자도옮겨감` 후 `Windows기본커서가먼저가서흰색이따랐을가능성` 정정. 순서확정하지않음. 실제기록op4 start2792624→user656420/model650430, op5 start2924842→user890309/model900320으로 기본/논리좌표변화추가조사필요. off-modeop2/3는실제로OS커서복원하지않는경로였으므로이후협업검증에사용금지.
- root native에64개고정UI-thread cursorTrace 도입: modelbegin/end, handoff latch/observed/release, idle GetCursorPos동기화전논리값과OSquery값, 이후physical hook제안좌표를구분기록. hook할당/잠금없음, 태그/PID/텍스트추가수집없음. 모델동작중logical원시누적은기존유지. 실제로Windows선행인지logical선행인지확정할단일제어드래그필요.
- 확인된별도metadata결함수정: dispatch의physicalCursor가handoff이전modelendpoint로남아collaboration상태와시점불일치. 성공응답은handoff후OS좌표재조회. 실제화면이동이해결됐다고주장하지않음. host56/classifier33검사는이하andoff결함실기증거가아님.
- cleanup07 exact2 actualall0/deleted-finalized/19,950,052logicalB 수락. xtghregister-only10,015,269B 보호유지. root temporary는pending/incomplete run-root whole-root투영으로현재조사owner부분폐기API없음, 현재작업/검증필요근거로보존하며나중완료전retention/owner경계해결필요.

- 경계 진단 mp-mvzvlwtd는 준비 단계 모두 exit0, 판별 검사33 통과. 현재 MCP13 off/그림판B 모델 시작점700380 준비. cursor-boundary-native-preparation.json 보존. 최초 시험은 3초 물리 이동 후 멈추고 드래그 중 및 종료 후2초 정지하는 단일 동작으로 진행한다. cursorTrace는64개 고정이며 hook_proposed와 cursor_query를 구분한다. acceptance02 상태를 provisional_reopened로, 소유 아키텍처를 수락 차단 상태로 수정했다. 제품 배포 권한이 없어 배포하지 않는다.

### MCP13 정지 조건 경계 진단

- 3초물리이동probe2pairs후정지상태 단일dragop1(700380→900400,1500ms) 성공. start/user/복원후OS3349250 유지. trace model_end와latch에서OS900400, handoff_move_observed→release에서3349250, 이후idlequery샘플모두같은좌표. 정지조건에서보고된순간이동미재현. 움직임동반종료결함을해결/부정한증거아님. reports/cursor-boundary-static-13.json 독립요약, transcript13 fulltrace.
- 협업ready유지하며다음논리시작700480 준비(Windows입력0), 다음시험은오른쪽빈Paint캔버스에서작게계속이동하는단일drag.

### MCP13 Paint 내부 연속 이동 조건

- op2(700480→900500,1500ms): userStart1228678, modelend에서user1215632/OS900500, handoffquery/release OS1215632, 이후physicalhook제안1216..1227과cursorquery1215..1226로사용자위치근처만관찰. 응답physical1231628/logical1231628, 후속physical1236673/logical1243673. 모델종료점900500쪽으로점프미관찰. 정상작동한이조건을기존결함부정/해결로간주하지않음.
- 기존이상op4/5 userstart2792624/2924842는Paint밖(다른화면)인반면이번start는Paint내부. 위치조건만바꿔다음단일drag로비교. reports/cursor-boundary-moving-inside-13.json 요약/fulltrace13유지.

- 사용자 요청에 따라 runtime13 직접 MCP 단일 2초 드래그 중 실제 사용자 클릭 시험: 모델 완료 직후 human queued1, 이후 completed1/skipped0, 버튼 입력2, lastHumanSubmission(1312,522); handoff 사용자(1324,547) 복원, suppressionfalse. 시각적 클릭 의도/순간이동 체감은 사용자 확인 대기. 근거 reports/cursor-boundary-user-click-13.json 및 manual MCP13 transcript.

- 사용자 실제 확인: runtime13 모델 드래그 중 클릭은 의도한 사용자 위치에 입력됐고 순간이동 없음. 이번 단일 시험은 수락; 이전 간헐적 순간이동의 원인·해결 여부는 미확정이며 전체 기능 수락/설치로 확대하지 않음. 근거 reports/cursor-boundary-user-click-confirmation-13.json.

- 다음 실제 사용자 혼합 입력 시험 준비: Windows x64 runtime13 ready, completedHuman1/skipped0, 대기열0. 사용자 무작위 이동·클릭·짧은 드래그와 모델 단일 MCP 동작들을 교대로 관측; 기존 마우스 지원 범위(드래그2초 이내), 초기 시험 그림판 캔버스. 자동화된 앱 시나리오는 사용하지 않음.

- 실제 무작위 사용자 이동·클릭·짧은 드래그 조건에서 모델 MCP 드래그3회(op5–7) 완료. 사용자 큐 동작 completed1→26(+25), skipped0→0, 종료 queued0/suppressionfalse/failure없음. 실제 사용자 의도 대비 누락·궤적 정확성은 계수만으로 입증하지 않으며 체감 확인 대기. reports/cursor-boundary-random-input-13.json.

- 사용자 확인으로 무작위 이동·클릭·짧은 드래그 실제 혼합 시험 수락: 의도대로 동작했고 문제 체감 없음. 모델3회/큐 사용자25건/skipped0 결과와 함께 해당 조건 통과. 전체 신뢰성 보장이나 이전 간헐적 순간이동 원인 해결로 확대하지 않음. reports/cursor-boundary-random-input-confirmation-13.json.

## 기본 시스템 포인터 숨김 구현
- 사용자 승인: Multiplex 방향 중단, 기존 Switched 협업 유지. 모델 입력 중 기본 포인터 숨김, 사용자 위치 handoff 뒤 표시. 오류·중단·EOF·broker 비정상 종료/응답 정지 복구. Windows x64 local Default desktop 한정; 설치본 미변경. 이전 좌표 순간이동은 별도 미해결.
- ShowCursor는 thread-local이므로 MagShowSystemCursor 사용. 테마/레지스트리/DLL주입 없이 same-EXE guard가 visibility 소유하고 broker 종료/heartbeat timeout에 복구. native worker 구현, root 통합·검증.
- 기존 REPL 상태가 초기화되어 MCP13 종료 결과를 관측하지 못함. 현재 OS native process 조회는 비어 있으나 정상 종료 증거로 보지 않음; 기존 lifecycle/참조 보존. 신규 compile 전 별도 live producer 충돌 여부 확인.

- 공개 호스트 진단에 collaboration.systemCursor(supported/hidden/restorePending/guardReady/lastError)만 추가. private PID/handle 및 malformed/path-like 값 제거 확인. node scripts/test-window-control-mcp.cjs actual0; reports/system-cursor-host-projection.json. native 실기 검증은 별도 대기.

- 新 native run run:EZ01:mp-mvzwe2m5 immutable source 97f85e4a60daa8097eab9ec28102f65485a85adc1856cf98d673d485942f381d: configure/compile/raw-selftest/guard-selftest/real-MCP-stdio all actual0. Guard target-free check covers hide/show/stop, competing lease, heartbeat timeout and exact created watch victim death; no app input. Source public projection actual0. MCP14 connected; system cursor not hidden while idle. Full product build/install not performed. Visual Paint acceptance next.

- MCP14 실제 협업 ready 뒤 op1 그림판 drag(450620→650640,1800ms) actual success. guard supported/ready true, 종료 hiddenfalse/restorePendingfalse/error없음. 시각적 깜박임 확인 대기. handoff에서 OS1757668 복원 확인 직후 같은 tick 후속 model_end에서 OS650646 기록: 이전 간헐적 좌표 점프 관련 새 구체적 근거이며 해결로 간주하지 않음. post OS/logical1744781. reports/system-cursor-manual-14.json.

- MCP14 사용자 실기 수락 실패: 기본 포인터 계속 보임 + 순간이동 발생. Mag API/guard 검사0은 실제 rendered hiding 성공 근거가 아니며 결론 정정. collaboration OFF 및 stop/native EOF 종료 관찰 후 원인 조사. reports/system-cursor-user-feedback-14.json.

- 숨김 실패 조사: 공식 Mag API prerequisites에서 누락 조건을 확정하지 못함. 테마·확대배율·레지스트리 변경이나 undocumented 대체 API는 실행하지 않음. 대상 조작/포인터 이동이 없는5초 visibilityProbe를 same-exe에 추가, API 상태와 실제 시각 판단을 구분하여 확인. handoff 직후 physical hook stale proposal(650642/650645/650646)이 capturefalse에서 통과한 기록을 별도 검토.

- 대상없는5초 숨김 probe actual0 및 사용자 숨겨졌음 확인. Mag API 자체 로컬 시각효과는 성공; runtime14 실제 Paint 조작 시 숨김 유지 실패와 구분. 추가 발견: handoff capturefalse 이후 show ACK(최대750ms nonpumping) 대기에서 오래된 physical hook이통과하는 창 존재. show ACK를 capturetrue 동안 처리하고 RAW/drain 최신위치 재검증·최종복원 후 blocking IPC 없이 capturefalse로 전환하도록 수정 예정. 모든 stale-input barrier를 입증하는 것으로 확대하지 않음.

- Root 수정: 두 단계 handoff에서 첫 복원 후 show ACK를 capturetrue 중에 처리하고, RAW drain·최신 위치 전체 재검증 후 다시 복원하여 blocking IPC 없이 capturefalse. 중간에 대기로 돌아가면 같은 UI 호출 종료 전에 다시 hide. hide()는 과거 ACK 캐시만 믿지 않고 입력 경계에서 API 요청을 재적용. 전경 변화가 원인인지는 미확정이며 실기로 효과·지연을 확인한다.

- MCP15 수정본 협업 ready, op1 drag450580→650600/1800ms actual success, guard API오류없음/hiddenfalse/restorePendingfalse/복원완료. 사용자 시각 확인 대기. reports/system-cursor-handoff-manual-15.json.

- MCP15 사용자 시각 수락 재실패: 기본 포인터 여전히 보임. 이번 응답에서 순간이동 부재까지 확정하지 않음. OFF/stop/EOF 실제 exit0. 숨김 API 재요청만으로 해결되지 않음; Windows 입력 전송·창 활성화·오버레이 단계별 관측을 추가해야 함. reports/system-cursor-handoff-user-feedback-15.json.

- 추가 표시 구분 시험 준비: 동일 frozen runtime MCP16, 실제 nativePID17820/parent20420/creation1793664562915/exe exact확인. one-off helper는 해당PID·생성시각·exe·AzraelSwitchedCursor class만 검증하여 자체 overlay2개 숨김; 사용자 창/포커스/입력 변경없음. overlay 없는 상태의 짧은 MCP드래그로 native포인터와 제품overlay 구분. 생성물은 기존 root temporary 소유이며 사용종료 후 owner 경계에 따라 정리 필요.

- MCP16 커서 표시 구분 시험: exact-owned overlay2개 hidden 확인, 단일 drag450540→650560/1800ms success; 사용자 시각 확인 대기. 시험 후 OFF/stop/EOF parent0, guard 표시복원 오류없음. reports/system-cursor-bare-manual-16.json.

- MCP16 사용자 확인: 선 그리는 동안에만 포인터 안 보임. 자체overlay 제거 조건에서 기본 포인터가 조작 중 숨겨지고 종료 후 다시 보이는 타이밍 수락. 동일 frozen runtime15/16에서 overlay 유무만 달라 앞선 표시가 자체overlay일 가능성은 커졌으나 단정하지 않음. 정상overlay 시각명확성/간헐적순간이동 신뢰성/설치본 반영은 별도. reports/system-cursor-bare-user-confirmation-16.json.

- cleanup08 owner 최종 결과 재사용: superseded mp-mvzwe2m5/mp-mvzx9640 실제 register/review/apply/finalize0, logical20,599,333B 삭제, remaining/refs/blockers없음(물리회수미측정). 최신 mp-mvzxfxhp는 register-only10,343,924B, complete/protection_knowntrue, root실행참조보호. 정상overlay 표시 명확성·사용자 최종확인과 간헐적점프조사를 위한 최소 native확인묶음으로 보존, 확인후 supported owner정리. 설치본미변경, 전체작업/커밋/기존보호잔여정리는 미완료. reports/cooperative-cleanup-08.json.

## 다중 포인터 활성 기간 전체의 기본 포인터 숨김
- 사용자 변경 승인: 모델 조작 여부와 무관하게 협업 ready 기간 기본 포인터 숨김. 준비실패/모드해제/오류/stop/EOF/종료 시 표시복구. Windows x64 기존 Switched/마우스 FIFO 범위 유지, 설치 미반영.
- Root overlay sync의 hide조건에서 capture의존 제거, 실제 @user overlay가 visible일 때만 hide. visible준비 실패는 routingfail+show. 모델 handoff의 show ACK를 제거해 대기에도 숨김 유지; 기존 두단계 restore·RAW drain·전체재검증·capturefalse 뒤 blocking IPC없음 유지. idle 사용자 좌표는 기존GetCursorPos/timer를재사용하므로60Hz표시 지연 실기확인 필요.

- 모드 전체 숨김 수정본 immutable run run:EZ01:mp-mvzy82a3: configure/compile/raw33/guardselftest/stdio 모두 actual0. MCP17 연결, 초기 collaborationOFF에서 hiddenfalse. 모델이 조작하지 않는 idle 숨김 유지·사용자 overlay 추종·disable 복귀는 실기 확인 대기.

- MCP17 모델 무조작 대기 실기: ready와5초후 모두 modelActivefalse/suppressionfalse/systemCursor.hiddentrue/guardreadytrue/error없음, user와physical좌표 각 관측에서 일치. OFF후 hiddenfalse, stop/EOF parent0. 사용자 시각·추종 지연 확인 대기. reports/system-cursor-mode-idle-17.json.

## 사용자 커서 표시 지연 개선
- 사용자 실기 피드백: 모드전체 숨김은 됐지만 지연 체감. 현재 입력 WM_INPUT 후 overlay 갱신은16ms timer까지대기하고 timer도숨김IPCACK후 이동하는구조 확인. 사용자가 개선승인.
- Root 수정: WM_INPUT처리 직후 자체 사용자overlay 즉시갱신; 안전timer는 유지하며 timer에서도overlay를숨김상태확인보다먼저갱신. 같은좌표면SetWindowPos생략. 숨김API는상태전환때만요청, 매번helper생존/오류를nonblocking확인. visibilityCommands 계수로실제중복요청없음을검증. 기존guardselftest에반복hide100회가새IPC를만들지않는검사추가(후속수정에서timer/이벤트마다동기요청을재도입할위험보존). Windows x64범위,입력FIFO/보안검증/복구감시유지. 실기지연량/개선체감은별도확인대기.

- 지연개선run run:EZ01:mp-mvzyjpst immutable source 32cd87b662c5563220d6af0920cb95b1f4873d5499d5ca45e0102c07ed8c7b3d configure/compile/raw33/guard(반복hide100회새IPC없음 포함)/MCPstdio actual0. 호스트공개계수검사0. MCP18연결·초기hiddenfalse/visibilityCommands0, 사용자추종체감과대기5초간명령계수유지확인예정. 설치본미변경.

- MCP18 무조작추종실기: ready/5초후 모두hiddentrue/modelActivefalse; visibilityCommands1→1(대기중동기hide요청추가0). OFF후hiddenfalse/commands2, stop/EOF parent0. 실제표시지연ms측정아님; 사용자체감확인대기. reports/system-cursor-latency-manual-18.json. cleanup09 exact2 logical20,688,269B deleted/finalized0 잔여없음, 최신run등록만10,350,113B 보호유지(물리회수미측정).

- 사용자지연개선수락: 충분히개선됨. runtime18무조작추종조건숨김유지/명령추가0/모드해제복원 수락; 실제지연ms미측정·설치본미반영·전체동시성신뢰성일반화없음. reports/system-cursor-latency-user-confirmation-18.json. 사용자확인종료로최신검증run실행참조해제, 독립결과유지후owner삭제예정.

- cleanup10 결과 인수: 최신 확인용run mp-mvzyjpst protectionrefresh/review/apply/finalize 모두 actual0, logical10,350,113B 삭제·finalized, remaining/refs/blockers없음. 독립근거SHA유지, 물리회수미측정. 사용자커서지연개선 실기 수락과 해당 개발native확인묶음정리완료. 설치반영·전체multi-pointer통합/기존보호잔여정리·taskcommit은 기존미완료범위로남김. reports/cooperative-cleanup-10.json.


## 커서 벡터·모션 시안
- 범위: 제품 입력 코드 변경 없이 [cursor-motion-preview.html](cursor-motion-preview.html)에 독립 HTML/SVG 시안을 작성한다. 사용자 요청 결과물로 보존한다. 사용자·모델 문구는 그대로 유지한다. 외부 의존성, 실제 OS 입력, 빌드·설치 변경은 없다.
- 채택·수정: 사용자는 순백색 #FFFFFF의 A형을 유지한다. 모델은 앞선 B형에서 첨부 사진 스타일의 인터넷 원본 후보 비교로 다시 검토한다. 사용자 전환은 기존 교차 페이드에 끝점의 점에서 커지는 모션을 더한다. 사용자 입력 대기는 색 변경 없이 저장 아이콘만 표시한다. 모델 드래그 진입은 위치 이동 없이 페이드·축소하여 점으로 전환한다. 기존 아래로 내려가는 움직임과 도약 곡선은 제거한다.
- 새 순간이동안: 사용자 요청에 따라 커서는 애니메이션 없이 즉시 새 위치로 이동하며 크기·불투명도를 유지한다. 이전 위치에만 B형 몸체 잔상을 24% 불투명도로 남겨 180ms 동안 제자리에서 페이드아웃한다. 이름표는 새 위치에만 표시한다. 기존 순간이동 축소·확대·소멸/출현 공백·링·중간 이동 궤적은 제거했다. 반투명 대기·종료 모션은 유지한다.
- 전체 12.8초 반복, 상태별 반복, 일시정지·스크럽·속도·배율·배경 선택과 reduced-motion 초기 정지를 제공한다. 사용자 A는 고정하며 모델은 원본 후보 5개를 선택한다. 모션·좌표는 시안용 연출이며 제품 큐 상태와 연결하지 않는다.
- 검증: Node v26.7.0 문법·SVG 참조·간이 DOM 타임라인/컨트롤 검사 actual0. 이전 수정의 순백색 유지·점 성장·드래그 진입 좌표 불변 검사를 재사용하고, 최신 변경은 순간이동 직전/직후 좌표 즉시 교체·라이브 커서 크기/불투명도 불변·잔상의 고정 위치/크기·24%에서 180ms 내 소멸·대기/종료/복귀·모션 줄이기·컨트롤을 확인했다. 최신 HTML은 22,349바이트, diff 공백 검사0이다. 실제 렌더링의 근거로 사용하지 않는다. 첫 시안의 외부 의존성 검사 exit1은 xmlns URI를 요청으로 잘못 분류한 검사 오류로, 리소스 참조 검사로 수정 후0이었다.
- 검토 제한: Chrome Browser가 file: 열기를 URL 보안 정책으로 거절했다. HTTP 우회·다른 브라우저 표면·헤드리스로 같은 접근을 재시도하지 않았다. 브라우저 기반 renderer도 보류하여 실제 화면·브라우저 상호작용은 미검증이다. 검토 이미지/임시 서버/패키지/빌드 생성 없음. 제품 적용은 별도이며 수정 시안의 사용자 시각 검토를 기다린다.
- 자체 작업 기록의 한글이 PowerShell→Node 파이프 기본 인코딩으로 손상된 사실을 확인해 해당 시안 섹션만 UTF-8 patch로 바로잡았다. 원래 작업 기록의 다른 내용은 유지했다.

### 원본 SVG 후보와 색 팔레트 비교
- 인터넷 검색·공식 저장소 확인으로 Fluent Cursor 16/24, Tabler Pointer, Phosphor Cursor, MingCute Cursor 2의 5종을 선정했다. 첨부 사진의 동일 원본은 특정하지 못했으므로 HTML에 유사 원본 후보임을 명시했다. 사진과 픽셀 단위 일치를 주장하지 않는다. 공식 원본 SVG는 그대로 전시하고 색 적용·모션용으로 원본 path를 수정 없이 재사용한다. 균일 확대·기준점 정렬은 검토용이며 실제 제품 hotspot은 미검증이다.
- 원본 pin: microsoft/fluentui-system-icons 9eb184e96268d3293462f9d9d19225b4c7b07774, tabler/tabler-icons ed177a085b652fe04ec4f37ced867c94621e7840, phosphor-icons/core 2b75f3ad12b420c9504ef05df8d2564a28f8500e, mingcute-design/mingcute-icons 4b85ae197f6c10c8740f2b03a0be0f0864fc18ec. SVG 전체 문자열·SHA-256·고정 원본 링크 및 MIT 3개/Apache-2.0 1개 전문을 HTML에 내장했다. 대형 저장소/패키지를 설치하지 않았다.
- 프리셋 9개(민트·제이드·블루·아이리스·라벤더·로즈·샌드·그래파이트·검정), color picker, HEX 입력·오류 안내, 선택적 보조 외곽선을 추가했다. 색은 모델 몸체·드래그 점·잔상·클릭 표시·이름표에 함께 적용한다. 원본 전시는 영향을 받지 않는다. 모델 문구·순백색 사용자·기존 잔상 모션은 유지했다.
- 검증 actual0: 공식 원본 SVG/모션용 path 동일성·SHA-256·라이선스 존재, SVG 참조, 간이 DOM에서 후보 5개·팔레트 9개·유효/잘못된 HEX·color picker·외곽선·기존 모션/제어·reduced-motion. 최종 HTML 58,577바이트. 실제 브라우저 렌더링 검증은 앞선 보안 제한으로 미완료다. 추가 임시 파일·브라우저 프로필·서버·빌드 없음. 결과는 HTML 시안에만 반영했으며 제품 코드는 미변경이다.

### A형 변형과 Life-All-In-One 팔레트
- 사용자 방향: A(Fluent Cursor 16)를 기준으로 모서리 굴곡을 유지한 폭 90%·80%, 각 폭의 흰 윤곽선형 총 4안을 비교한다. A1은 90%, A2는 80%, A3은 90%+흰 선, A4는 80%+흰 선이다. 위 행은 90%, 아래 행은 80%로 기본형·흰 선을 나란히 배치했다. 원형과 나머지 공식 원본 5종·라이선스는 접힌 참고 영역에 보존했다. 각 안을 모션에 선택 적용하며 흰 윤곽선은 별도 체크로도 비교한다.
- 바탕화면 `C:/Users/felre/Desktop/Life-All-In-One`에서 `docs/design/app/color-system.md` 및 `apps/laio_app/lib/services/color_palette_service.dart`의 `appDefaults`·`paletteFamilyNames`·`eventVariantDefaults`를 읽었다. 12계열 × Bright/Pastel/Deep/Clear/Porcelain/Luminous 6특성의 72개 불투명 HEX가 문서와 코드에서 모두 일치했다. 실제 앱 DB/프로필의 사용자 override는 읽지 않았고 LAIO 파일은 수정하지 않았다.
- 해당 72색을 시안에 내장하고 특성 선택기·12계열 버튼을 추가했다. 몸체 색은 원본 HEX 그대로, 이름표는 같은 계열의 등록 Pastel·Clear 조합을 사용한다. 직접 HEX 입력은 기존 기능을 유지한다. 초기 색은 LAIO Sky Blue Bright #38BDF8. 원본 경로·문서 경로·SHA-256을 HTML 데이터에 기록했다. 코드 SHA-256 dbe1fec89c84b49f8014f6b4b35a8a0df87bd60b913f9acbbb422326ceb7cecf.
- 검증 actual0: 원본 SHA 유지, 파생 폭/아래로 내린 좌표, 흰 선 선택, 72색 전체 선택 및 이름표 등록색 일치, 직접 색/오류 처리, 기존 드래그·잔상·대기·복귀·컨트롤·reduced-motion. HTML 72,719바이트. 간이 DOM 로직 검사이며 실제 화면 검증은 기존 보안 제한으로 미완료다. 요청 HTML·기존 기록만 수정했고 추가 임시 산출물/제품 빌드/설치/LAIO 변경은 없다.
- 굴곡 보존 수정: 앞선 비균등 가로 scale은 곡선도 함께 압축하므로 제거했다. Fluent A의 둥근 형태를 반경 1.0 SVG 단위 원호로 재구성하고, 직선 길이·연결 각도를 조정해 몸체 폭 90%/80%와 동일 높이를 맞췄다. 원호와 직선은 접선을 공유한다. 곡선 자체에 비균등 transform을 적용하지 않는다. 흰 선 2안은 대응 기본형과 완전히 같은 path를 사용한다. 우측 끝 아래로/원형 흰 선 독립안은 이번 4안 비교에서 대체했다. 초기 모션 선택은 A1(90%)이다.
- 최신 검증 actual0: SVG 원호 4개 각각 반경 1×1·직선 접선 연속성·폭 비율·동일 높이·비균등 transform 부재·기본/흰 선 path 일치, 원본 해시 유지, 모션 선택/흰 선·LAIO 72색·기존 사용자/드래그/잔상/복귀·reduced-motion. HTML 78,556바이트. 실제 화면 렌더링은 미검증이며 시안 기하와 간이 DOM 검사로 범위를 제한한다. 추가 파일·프로필·서버·빌드 생성 없음.

### 채택안과 Windows 사용자 커서 겹침 확인
- 사용자 채택: 모델 A3(폭 90% + 흰 윤곽선), 기존 LAIO 72색 팔레트. HTML 초기 선택도 A3으로 변경했다. 특정 단일 색의 최종 채택은 없으며 초기 Sky Blue Bright를 유지한다. 이번 범위는 HTML/SVG 디자인이며 제품 입력 코드·설치본은 변경하지 않는다.
- 현재 Windows 커서 설정과 공유 기본 화살표를 읽기 전용으로 확인했다. `C:/WINDOWS/cursors/aero_arrow.cur`, Windows 기본값, 시스템 DPI 96, 실제 로드 크기 32×32, hotspot (0,0). 파일 SHA-256은 06678bbf954f0bece61062633dc63a52a34a6f3c27ac7108f28c0f0d26bb22a7. API가 반환한 복사 GDI 비트맵은 해제했고 공유 커서·OS 설정·포인터 위치는 변경하지 않았다.
- 기존 사용자 SVG는 같은 hotspot에서 크기와 기울기가 맞지 않았다. 파일의 32×32 BGRA 참조에서 바깥 alpha 및 흰 내부 경계를 추적해 SVG를 다시 땄고, 별도 흰 외곽선/그림자를 제거했다. 일반 Windows 포인터의 전환 시작 모습도 실제 참조 PNG로 바꿨다. 수정 전후 Windows 배경/SVG 전경을 포개는 비교, 차이 강조 색상 및 전경 불투명도 조절을 HTML 첫 섹션에 추가했다. 새 사용자 윤곽의 시각 채택은 아직 확인받지 않았다.
- 실제 메모리 이미지로 원본과 재추적 형상 및 겹침을 확인했다. Pillow 16배 초과 샘플링 후 alpha≥128 실루엣 비교: 수정 전 intersection125/union512/불일치387, 수정 후 intersection125/union125/불일치0. 현재 32px 실루엣 기준의 일치이며 RGBA·안티앨리어싱·그림자·다른 DPI/접근성 크기까지 같다는 뜻은 아니다. 추가 단순화는 1~3픽셀 차이가 생겨 적용하지 않았다.
- 집중 검사 actual exit0: Windows 파일 해시·hotspot·크기·추적 path, A3/팔레트 채택 기본값, 비교 색상/불투명도 컨트롤, SVG ID/참조, 72색 선택, 사용자 점 성장·저장 아이콘·순백색 유지, 드래그/180ms 잔상/복귀·reduced-motion. HTML 86,575바이트. 전체 HTML 렌더링은 기존 Browser URL 보안 제한으로 미검증이며 우회하지 않았다. 이미지 처리는 메모리에서 끝냈고 임시 파일·서버·프로필·패키지·빌드 생성은 없다. 지속 디자인은 소유 아키텍처의 target 섹션에 연결했다.

### 사용자 커서의 직선 윤곽과 둥근 모서리 정리
- 사용자 수정 지시: 픽셀 경계를 따라 생긴 쭈글쭈글한 선을 제거하고, 기존 선의 대략적인 실루엣을 유지한 직선 및 둥근 모서리로 정리한다. 기존 HTML 시안에서만 실행하며 Windows x64 참조 외 플랫폼 지원이나 제품 설치 범위는 변경하지 않는다.
- 바깥/안쪽을 각각 7개의 직선과 접선이 이어지는 원호로 재구성했다. 바깥 형상은 기본 화살표의 기울기·왼쪽 변·우측 끝·꼬리를 유지하며, 흰 내부는 같은 지지 직선에서 0.94px 안으로 들인 구조를 사용한다. hotspot (0,0), 순백색, 문구·저장 아이콘·모션, 모델 A3 및 LAIO 팔레트는 유지한다. 픽셀 추적 상태와 정리 상태를 Windows 참조 위에 각각 포개도록 기존 비교 화면을 갱신했다.
- 검사: Node 문법·SVG 참조·양쪽 윤곽의 직선 7개/원호 7개·hotspot·A3 유지·흰 내부 검사 통과. Python/Pillow 16배 실루엣 비교 및 고해상도 벡터 이미지 생성 actual exit0, 메모리 이미지로 잔굴곡 제거와 둥근 접합부를 확인했다. 정리 후 alpha≥128 기준 intersection116/union125/불일치9, 겹침92.8%; 이전100%는 픽셀 추적 버전의 결과이며 이번 직선 디자인의 수락 기준으로 사용하지 않는다. 전체 HTML 렌더링은 기존 보안 제한으로 여전히 미검증이다.
- HTML 98,666바이트. 수정은 기존 시안·소유 디자인 문서·동일 작업 기록에 한정한다. 새 영구 테스트를 추가할 반복 작업 누락 위험은 없어 메모리 일회 검사만 수행했으며 임시 파일·프로필·서버·빌드 생성은 없다. 사용자 시각 검토 대기.

## 채택 커서의 native 표시 구현
- 사용자 `좋습니다. 이대로 구현해주세요`로 위 사용자 윤곽과 모델 A3/LAIO 팔레트·채택 모션의 실제 표시 구현 승인. 기존 Windows x64 local desktop Switched prototype 범위이며 입력 라우팅/FIFO/권한은 유지한다. 전체 제품 빌드·설치/배포는 별도 권한으로 남긴다.
- 현재 GDI Polygon + color-key overlay는 반투명·안티앨리어싱·잔상을 지원하지 않으므로 Windows 내장 GDI+와 per-pixel alpha layered window로 교체한다. 새 외부 패키지 없이 기존 UI 스레드, Raw Input 직후 위치 갱신, 안전 timer 및 system cursor guard를 재사용한다. 모션은 입력 좌표를 보간하지 않고 표시 형상/불투명도만 바꾼다.
- 분담: 자산 담당은 기존 HTML의 확정 vector/72색 및 원본 라이선스만 native data header로 고정한다. root는 native renderer/모션·실제 큐 상태 연결·검증·최종 통합 소유. 자산 준비와 독립적으로 UI/입력 호출 연결을 진행하고, 모두 고정된 뒤 최소 native 컴파일·비입력 렌더 검사를 수행한다. 새 런타임의 검증/정리는 기존 artifact lifecycle owner를 사용한다.
- 검증 목표: 실제 렌더한 밝은/어두운 바탕의 사용자·모델·대기 저장 아이콘·드래그 점·잔상·종료 프레임, 위치/입력 불변, FIFO/host 경계 회귀. OS 커서 설정/사용자 앱은 렌더 검사에서 조작하지 않는다. 실제 협업 시각 체감은 별도 사용자 시험 전까지 미확정이다.

### 구현·검증 결과와 확인 대기
- `cursor-assets.hpp`에 채택 사용자 outer/inner 각47점, 모델25점의 cubic vector와 LAIO 72색을 고정했다. HTML SHA cc60b5b2effdf8719ac4e92e99b17994e73617919370c720cd208593fb87732c 및 원본/팔레트 provenance를 보존한다. `CURSOR-NOTICES.md`의 Fluent MIT 전문을 검증 런타임 notice에 포함했다.
- `cursor-renderer.hpp`는 GDI+로 캐시된 premultiplied-alpha surface를 그린다. 흰 사용자 화살표/둥근 모델/색 계열 label/저장 아이콘을 그리며, 완성된 전체 커서에 불투명도를 한 번 적용해 border/text 중첩이 대기32%보다 진해지는 문제를 막았다. `cursor-presentation.hpp`는 입력/좌표 변경 없이 dot 성장, 드래그 dot 전환, 대기, body-only180ms 잔상,220ms 제거를 담당한다. Raw Input은 surface 위치를 즉시 옮기고, visual tween은16ms timer가 갱신하므로 고주파 마우스 입력마다 다시 그리지 않는다.
- 실제 FIFO에 admit됐지만 시작하지 않은 사람 gesture만 저장 badge 표시 조건에 연결했다. Broker 입력 요청의 active/drag/click, 논리 이동, explicit pointer remove에 표시 상태를 연결했다. 안전 stop/EOF/shutdown은 기존 즉시 해제·overlay 제거를 유지한다. 협업 활성화가 proven ready가 된 뒤에만 native 화살표에서 사용자 화살표로 전환하고 mode disable은 기본 포인터를 즉시 복원한다. 입력·타겟 권한·큐 순서는 유지했다. Native shape/path/palette·non-actuating 렌더 검사와 보존 inventory를 연결했다.
- Native 검증 4회: 첫 run mw07bwij는 UpdateLayeredWindow의 POINT const 인수 변환으로 compile actual1. 타입 수정 뒤 mw07di4u 전 단계0/render64. 전체 group-opacity 보정 뒤 mw07ks01 전 단계0/render80. Raw Input 재페인트를 timer로 분리한 최종 mw07n6du도 source/configure/compile/raw-origin/visibility-guard/render 전 단계 actual0, render80. 각 고정 입력·시각·소요시간은 독립 JSON으로 인계했으며 이전 결과를 최신 source 통과로 재분류하지 않는다. 최종 source SHA6b832a44dd573456fb66d57207f3cf34460a0b97c8e6d9aab5b277e015772c3f.
- 최종 native 프레임의 밝은/어두운 배경을 직접 확인했다. 96/144/192 DPI 숨긴 layered window의 hotspot 배치·click-through/noactivate 속성, frame alpha 상한·premultiplication, dot/대기/종료/reduced-motion을 검사했다. 렌더 시험 appInputs0·visibilityChangedfalse·foregroundUnchangedtrue. 최종 before/after 커서 좌표 차이는 물리 사용자 이동을 금지하지 않은 관측이며, 시험이 커서를 고정/복원했다고 주장하지 않는다. Guard 별도 selftest는 기존대로 잠깐 숨김/복원을 시험했다. 실제 앱 조작/협업의 시각·체감은 미검증이다.
- Mandatory host 경계 4파일의 첫 실행 actual1: `test-window-use-staging`의 Python PATH ENOENT만 실패, 다른3 suite는 보고된 실패 없음. 설치된 Python312 경로와 소유 TMP를 child env에 핀한 staging 재검사 actual0,4/4 pass. Python 설치나 제품 환경 변경 없이 검사 환경을 보정했다. MCP source 검사와 feature owner/check 연결·diff 공백 검사0. 렌더링·alpha·motion 및 업그레이드 누락을 예방할 native 검사만 유지했다.
- 최소 확인 묶음 `run:EZ01:cursor-check-mw07po24`, 경로 `artifacts/tasks/EZ01/runs/cursor-check-mw07po24`,512,326바이트: verified runtime, native PNG, 독립 요약 및 종료 근거. Runtime manifest SHA1393ec4b4381e05f25248137f278b55f07db9400b33a94de01055bb846d8e486 재검증됨. 복사 내용 검증은 성공했지만 producer close가 동시에 정리되던 fixture catalog의 ENOENT로 실패해 wrapper 실제 exit1을 보존했다. 자동 onExit가 stopped/failure/complete-membership로 close한 것을 확인했고 root 지원 API로 recovery 참조 `user-check-adopted-cursors`를 추가했다. 실패를 성공으로 바꾸지 않았다. 이후 writer/cleaner 경계를 직렬화했다.
- 확인용 runtime/이미지는 사용자 시각·정상작동 확인 뒤 recovery 참조를 지원 owner로 해제하고 fresh review/delete/finalize한다. 그 외 컴파일/fixture/재검사 묶음은 즉시 owner 정리한다. 독립 결과는 [cursor-native-implementation.json](cursor-native-implementation.json), 실제 정리 결과는 [cursor-native-cleanup.json](cursor-native-cleanup.json)이 소유한다. 전체 제품 빌드·설치본 교체는 하지 않았다. 실기 수락·기존 전체 작업의 보호 잔여물 처리 및 task-level commit은 아직 미완료다.
- 최종 정리 인수: 승인된 새9묶음은 owner 작업 actual0으로 deleted→finalized 및 run-root/producer-record 실제 부재 확인. 선택 논리 크기34,237,732바이트, 물리 회수량 미측정. 실행 중 writer 없음. 최소 확인 그룹 cursor-check-mw07po24만 register-only 완료/512,326바이트 존재, revision3·실제 failure exit1·recovery 참조를 그대로 유지한다. Native item.references가 비어 있어도 producer recovery 참조는 별개로 확인해야 하며, 사용자 확인 전 삭제하지 않는다. 이번 커서 소스 구현과 검증은 완료했으며 설치/실기 확인 및 확인용 묶음 정리는 대기 상태다.

## 채택 커서의 직접 MCP 실기 시험
- 사용자 선택은 입력 없는 시안 창이 아닌 실제 MCP 마우스 협업 시험. 이미 새 코드가 들어 있는 manifest SHA1393ec4b4381e05f25248137f278b55f07db9400b33a94de01055bb846d8e486의 확인용 runtime을 재검증해 재사용했다. 새 제품 빌드/설치/모션 중복 구현은 하지 않았다. `cursor-live-mw08oz9h` owner run을 시작하고 runtime 그룹에 dependency를 걸었다.
- Managed Window Use observation으로 기존 시험 그림판을 확인하고 stage4 공유 전경 입력 권한을 prepare/request로 승인받았다. 실제 조작은 사용자 요청대로 별도 개발 native MCP에 직접 한 동작씩 보냈다. 창 HWND0xc03d4/PID50984/생성 FILETIME0x1dd6a8310fb732e/실행파일 및144 DPI 화면 크기를 일치시켜 pin했다. 다른 세션이 점유한 앱은 제어하지 않았다. UIA 입력·클립보드·앱 조작 자동 시나리오는 사용하지 않았다.
- 첫 브러시 클릭과 단일1800ms 드래그 성공 및 새 선 화면 확인. 사용자 일반 표시 피드백은 문제 없음이었으나 드래그는 다른 작업 중 놓쳤다. 초기 trial의 사용자 처리1/skip6(intent_changed)는 그대로 기록하며 원인/광범위 신뢰성 해결로 주장하지 않는다. 다음 단일2초 드래그는 새 human intent가 없어 저장 아이콘 수락 근거로 쓰지 않았다.
- 사용자 요청으로 파란/보라 모델 커서2개를 표시해 각각2초 드래그했다. 두 번의 초기 capability 준비는 실제 상대 Raw 이동이 오지 않아 fail-open/no-actuation으로 끝났다. 같은 MCP 호출 안에서 최대8초 기다리는 bounded 준비로 바꾼 후 ready를 얻어 두 동작을 전달했다. 사용자는 두 커서 모두 점 전환과 종료 후 반투명 화살표 복귀가 정상이라고 확인했다.
- 최종 저장 아이콘 trial은 파란 기준선 다음 보라2초 선 중 실제 사용자 클릭을 받았다. 보라 드래그 종료 시 queued5, 이후 queued0·completed1→8(+7)·skipped6→6(추가0)·lastHumanFailure none. 사용자는 저장 아이콘과 의도한 클릭 위치 모두 정상이라고 확인했다. OFF 후 hiddenfalse/suppressionfalse 및 모델 overlay 제거 확인. 이 조건의 시각/클릭 수락이며 기존 간헐적 입력 결함 전체 해결이나 순간이동 잔상 별도 실기 수락으로 확대하지 않는다.
- 종료는 EOF/native close 실제exit0/terminationVerifiedtrue와 독립 Python witness를 함께 사용했다. witness가 broker30768/guard22164의 PID·생성시각·exe를 검증한 프로세스 handle을 미리 열었고, 두 handle이 모두 signaled 및 각 exit0을 직접 관측했다. witness child도 actual0으로 닫혔다. PID 부재만으로 종료를 추정하지 않았다. `requireStopEvidence:true` live run에 이 근거를 바인딩하여 complete/stopped/success/exit0으로 닫았다. log-save 변수 범위 오류는 실제 입력 완료 뒤 발생해 로그에서 결과를 복원했으며 입력은 재전송하지 않았다. 종료 record의 필수 reason 누락도 수정 후 지원 API로 닫았으며 실제 결과를 바꾸지 않았다.
- 독립 수락/종료 근거 [cursor-native-live-acceptance.json](cursor-native-live-acceptance.json), SHA40315d63fb91890e024d2ab0e3cd521cb53b3933a6622f354c28a45e75c01c3b. Window Use resource_status는 temporary resources0/bytes0이며 기존 소유하지 않은 child session은 건드리지 않았다. 사용자 확인 조건이 끝났으므로 live run dependency와 기존 확인용 recovery 참조만 지원 API로 해제하고 exact2 owner 삭제/finalize를 진행한다. 기존 확인 run의 failure exit1은 보존한다. 설치본은 미변경, 다른 앱/그림판 내용은 저장·종료·삭제하지 않는다.
- 실기 확인 후 정리 완료: live1,311,732B와 확인용512,326B의 지정 참조를 지원 API로 해제했고 register/refresh/review/apply actual0, deleted→finalized 및 run-root/producer-record 부재/remainingPaths[] 확인. 이번1,824,058 논리바이트, 커서 구현·검증 전체11묶음36,061,790 논리바이트 정리; 물리 회수량 미측정. 기존 wrapper failure exit1과 live success exit0은 독립 근거에 그대로 남겼다. 커서 실기 시험과 이 범위의 임시 산출물 정리는 완료했으며 설치 반영과 기존 전체 multi-pointer 작업의 별도 보호 잔여물·커밋 범위는 바뀌지 않는다.

상태: 승인된 계정 bridge 소스 해결 범위 완료. 기존 오류 재현, 호스트65·네이티브6 통과, 임시 산출물6묶음 삭제·부재 및 metadata 마감 확인 완료. 이 기록을 포함해 작업 커밋한다. 패키징/설치와 실제 계정·예약 변경은 수행하지 않았다.

# 엔진 연결 오류 조사

## 계정 bridge 후속 해결 범위

- 추가 승인: 계정 bridge 문제의 상세 원인 조사·재현 및 소스 수정과 관련 검증. 기존 초기 프레임 부재는 유지하며 역사적 원인을 확정하지 않는다.
- 공통 Windows x64/Linux x64/macOS ARM64 관리 계약을 수정한다. 실제 검증은 Windows x64의 네이티브 격리 fixture와 호스트 child fixture이며 다른 OS/설치본은 별도 수용 범위다.
- 확인된 결함: 계정 새로고침은 연결 없이 list만 호출하여 복구 불가. 네이티브 companion은 정상 ServerRequest 수신도 InvalidData로 취급하여 비재시도 protocol_error로 종료한다. 인증/승인 요청은 기존 소유 클라이언트만 응답해야 하며 companion의 응답 경쟁이나 자동 승인을 추가하지 않는다.
- root: native 요청 수신 경로·재현·수정·검증 및 통합/정리. bridge_diagnostics: 명시 계정 refresh의 기존 connect 재사용과 child fixture 회귀. protocol_cause: server broadcast 조건 읽기 전용 조사. 주기 poll의 protocol 재접속, mutation replay, 신원 초기화는 추가하지 않는다.
- 수용: 정상 서버 요청 뒤 관리 조회 지속·승인/토큰 응답 미전송; malformed input fail closed 보존; 명시 계정 새로고침의 연결 공유/동일 instance 검증과 mutation 재전송0; 기존 관리 회귀·타입 검사; owner 산출물 정리 후 작업 커밋. 현재 engine/이 기본 선택 소스이며 설치 source tree가 사라져 역사적 바이너리와 현재 routing의 동일성을 가정하지 않는다.
- 상세 source trace: account_processor.rs:1222-1259의 외부 ChatGPT token login → ExternalAuthBridge 설치 → login auth manager Unauthorized 복구 → external_auth.rs:33-45의 ChatgptAuthTokensRefresh → outgoing_message.rs:321-327의 무대상 send_request → shared_server의 같은 owner/context initialized broadcast. companion도 owner/context에 등록되며 role은 window lease에만 적용되고 session attach scope가 없는 bridge는 request 필터를 통과한다. 따라서 이 조건에서 정상 request 수신 → bridge InvalidData 종료가 성립한다. 응답을 보내지 않는 companion 수신 처리를 고쳐 owner 응답 권한과 기존 broadcast 정책을 보존한다. 최초 08:51 frame이 이 요청이었다는 증거는 없다.
- host 후속 검증: Windows x64 actual noEmit diagnostics0/exit0, 실제 child fixture 포함 47tests/exit0. run 20261029T022243281Z-f74110eb-9fdf-44f6-86d6-b6591ba331df. 명시 복구/동시 연결 공유/정상 연결 유지/instance mismatch 거절/mutation replay0를 추가 검증했다. 주기 poll과 UI 구조는 유지한다.
- 추가 통합 검증: 복구 중 타이머/Devin/project 조회가 먼저 실패하는 경합을 막도록 명시 복구 때만 account refresh를 선행했다. 정상/주기 조회 병렬 보존. 기존 UsageView 실제 메서드와 UsageWindowService 회귀를 관리 runner에 포함한 최종 Windows host 65tests/exit0, noEmit0, producerStopped=true(20261029T023649350Z-5b9846f1-d910-465b-b8ad-38a96e83ae62). UI 구조·문구·스타일 변경 없음으로 이전 화면 증거를 유지하며 새 렌더 fixture를 생성하지 않는다.
- 검증 준비 실패를 통과로 집계하지 않는다. 최초 native runner는 PATH에서 cargo를 찾지 못해 native producer 미시작/exit null, child 및 wrapper actual exit1; 종료 reconcile은 catalog 경합으로 실패해 독립 07 proof로 supported close를 failure/exit1로 완료했다. pinned Cargo 1.95.0 경로를 보완했다. 별도 시작 두 건은 run-claim 경합으로 실제 테스트/산출물 생성 전 exit1. host65 첫 시도는 소스 로더의 packaged media 경로4건 및 너무 짧은 fixture 시작 deadline1건으로 60pass/5fail; 실제 asset 경로를 연결하고 fixture 응답보다 먼저 끝나는 deadline/실제 list dispatch 검증으로 보완하여 최종65 통과했다. 상세는 06/07 소유 근거에 보존한다. 공용 잠금과 삭제 guard는 변경하지 않았다.
- native 재현: frozen run 20261029T023523819Z-614edef9-5bad-452e-983f-b86f2e997ece의 기존 종료 branch는 정상 서버 요청 주입 테스트에서 actual101/1 failed로 재현(타입0/선택1). 수정 branch check0 이후 Cargo owner metadata 마감이 catalog 경합으로 실패하여 행동 테스트 전 중단/래퍼1. 08-native-reproduction.json에 실제 결과를 불변 보존하고, 관측된 Cargo check0의 finishTargetOwner 재시도 및 failed run의 closeLifecycle failure1을 완료했다. 임의 exit나 프로세스 종료를 만들지 않았다.
- native green run: 20261029T025642374Z-dc55c26b-01f9-40ad-9f44-c242d64bb543, workId 6134e26f-68df-4de2-b218-7b1905aaa9f5 / session35406. 이전 frozen source digest c101510ac757bee7c2b0c39b8532757bb57537582505788e35efd3d82f223491를 그대로 확인하고 typed dependency(reference_id ei01-frozen-native-source, target_revision2)를 등록해 재사용했다. `check-shared-engine-native.cjs <frozen source> bridge`의 실제 remote library1 및 terminal binary5가 모두 통과(actual/wrapper exit0, 각 typeCheck0/비어 있지 않은 selection0, producerStopped=true, inputUnchanged=true). 02:56:53~02:59:35 UTC 실행. 정상 auth refresh/approval 반복 주입 뒤 management 응답 지속·타 클라이언트 요청 응답0 및 malformed stdin fail closed가 확인됐다. 독립 09 근거로 해당 dependency를 supported release 완료했다. 6개 후속 run만 owner 등록·검토·삭제·finalize하며 이전 7개 정리 완료 상태는 유지한다.
- 후속 정리 완료: 최초 native inventory572에서 해당 6그룹은 미등록이었다. catalog/maintenance 잠금 경합에 따른 실제 실패와 등록 진행은 10-followup-cleanup.json에 보존한다. 자기 동기 register 종료1과 정확한 fence를 고정한 11/12/13 recovery proof로 supported recover_reservation을 수행해 status=reservation_recovered/execution_outcome_changed=false 및 해당 reservation 실제 부재를 확인했다. 등록6건과 03:40:27 UTC fresh registered review를 완료했다(workId b8ceb879-817e-4b69-bfa1-81bac2eaf248 actual0). 6개 모두 complete membership, source match, blocker0/reference0/관측오류0을 확인해 exact token으로 모두 delete를 선택했다. 총205,614,781bytes의 stopped disposable root는 단일 apply에서 03:58:44 UTC actual0으로 모두 deleted/remaining=false(17.075분)였고 실제 경로6개와 제어 입력 부재를 확인했다(workId40936d95-9d45-4d86-9806-489904651ee0). 이후 supported finalize6건도 finalized로 완료했다. 반복 실행 없이 보존한 검증 요약은06~09, 최종 정리 근거는10이 소유한다. 잔여 payload나 보호 미해결 항목은 없다.
- 경합 조사: EK-01-user-wait-time의 cleanup native/parent56188을 확인했고 workId27013961-e09f-4f8d-8bdc-46fc4f6e4f50에서 parent의 실제 종료를 관측했다. 이후 별도 BT-01-request-scoped-command-approval의 등록도 같은 잠금을 점유했다. 다른 작업 중지·잠금 삭제 없이 기다렸고, 동일 guard의 제한된 재시도만 수행했다. 회복은 native 실행이 동기 종료되고 캡처한 child PID가 자기 reservation fence의 PID와 일치하는 경우에만 허용했다. 시간 경과/관측 종료를 삭제 허가나 테스트 성공으로 사용하지 않는다.

- 대상: azrael://threads/01a17fa6-7fda-78c2-ad60-ce2036d949e1
- 요청/권한: 권장 개선의 제품 소스·테스트·소유 문서 변경과 필요한 검증 승인. 배포본 생성/설치, 실제 인증·예약·사용자 프로세스 변경 없음. 최초 protocol_error는 근거 있는 추정으로 제시한다.
- 범위: 공통 재개/관리 transport 계약, 실제 관측 환경은 Windows x64 VS Code host 2026.0.13. 다른 OS 재현 미검증.
- 순서/소유: 설치 모듈의 격리 재현과 native 원인 후보 조사 → 승인된 호스트 소스 개선 → 타입·실제 child fixture·소스 보존 회귀·native UI/관리 HTML 렌더 검증 → 소유 산출물 정리 → 작업 커밋. root가 공통 계약과 통합·최종 수용을 책임지고 독립 담당자의 소유 변경만 통합한다. 산출물은 현재 계획과 독립 검증·정리 요약이다.
- 수용: 명시적 관리 재접속과 신원 검증 유지, 연결 오류 복구 후 제거, 예약/불명확 변경 오류 보존, 늦은 응답·중복 명령 방지, 안전한 protocolReason 분류, light/dark 및 좁은 화면 검증, 최초 원인 추정의 근거/한계 분리, owner 정리와 작업 커밋.
- 확인: 2026-10-29 08:53:57 KST 사진 응답; 08:54:15 예약 61eac147-4a8b-4780-ae2b-15d86d2cd5da waiting/turn_deferred 저장; 08:55:15와 08:58:00 하위 메시지 수신.
- bridge 로그: APPDATA/Code/logs/20261028T235020/window1/exthost/azrael-ex-local.azrael/Azrael Bridge.log:4, 08:51:07 protocol/protocol_error/retryable=false, attempt4, childPid9420. 채팅은 이후에도 진행.
- 소스: bridgeTransport.ts의 fail은 자식 종료 및 disconnect; accountService.ts onDisconnect는 protocol_error를 자동 재연결하지 않음; rootResumeView.ts에서 관리 연결 미검증 오류를 사진의 문구로 변환.
## 결론과 검증

- 설치 코드 대조: `.vscode/extensions/azrael-ex-local.azrael-2026.0.13/account-ui/dist/src/accountService.js:115,304`, `bridgeTransport.js:101`, `rootResumeView.js:241`에도 같은 연결 guard/중단/오류 표시 계약이 있다. Recovery.log:1은 hostPid4556의 이 릴리스 사용을 명시한다.
- 직접 장애 경로: 08:51:07 관리 bridge protocol_error(retryable=false) → transport 해제/미검증 → AccountService.onDisconnect 자동 reconnect 중단 → embedded subscribe/list의 rootResume 검증 guard에서 The engine connection has not been verified. → 사진의 한국어 문구. 재개 UI는 AccountService 관리 연결을 공유한다. 버튼 클릭 여부는 확인 불가하며 subscribe/list만으로도 표시 가능하다.
- 실제 재개 성공: 원본 rollout ordinal15004~15006. 09:02:17.018 claimed(rev2), 09:02:17.055 task_started(turn_trigger=root_resume, turnId cc633e41-295a-4d98-9aae-be40dfe60941), 09:02:17.080 resumed(rev3). Azrael.log:4703~4716에도 rev2/3 반영. 해당 예약이 실행되지 못했다는 가설은 관측과 맞지 않는다. 모든 시각 KST.
- 불확실성: bridge 로그는 phase/code만 보존하므로 최초 invalid JSON/message, native bridgeError, 예기치 않은 server request 등 실제 발생 가지는 특정 불가. 엔진 전체 종료·모델 네트워크 장애·예약 데이터 손상으로 단정할 증거 없음. 전역 state DB에서 대상 예약이 나오지 않아 예약 부재로 해석하지 않고 실제 rollout/호스트 이벤트를 근거로 사용했다.
- 승인 개선: 호스트 protocol_error 발생지점 진단, 명시적 관리 재접속, 복구 후 embedded 오류 상태 정합을 구현했다. 불명확한 변경 요청을 자동 재실행하지 않는 계약을 보존한다. 제품 패키징/설치·사용자 프로세스 중단·실제 예약 변경은 하지 않았다.

## 격리 실행 결과

Windows x64 Node v26.7.0에서 설치본 2026.0.13의 실제 compiled AccountService/BridgeTransport/RootResumeView를 VM 로드했다. 첫 실험은 spawn만 메모리 EventEmitter/PassThrough/Writable로 대체했다. 프로토콜 파서·연결 검증·재시도·UI handleEmbedded/postMessage는 제품 구현을 실행했다. 두 번째는 오류 잔류 경계를 좁히기 위해 BridgeTransport만 격리 대역으로 바꿨다. 실제 native 브리지 바이너리, 네트워크, 실제 VS Code renderer 또는 원래 메시지를 재현한 것은 아니다.

| 입력/조건 | 관측 및 assertion |
| --- | --- |
| 검증된 연결 이후 azrael/bridgeError(protocol, protocol_error, retryable=false) | 자동 재연결 없음, rootResumeAvailable=false, embedded subscribe가 사진의 정확한 문구 반환. 명시적 connect+embedded list 후 available=true/error=null |
| 검증된 연결 이후 잘못된 JSON 출력 | 위와 동일한 진단 코드와 표시/복구 결과. 현 로그만으로 두 원인을 구분할 수 없음 |
| 대조군 connection_lost(retryable=true) | 자동 두 번째 연결로 복구. protocol_error의 처리 분기가 차이를 만듦 |
| 명시적 재연결 시 instanceId 변경 | different engine instance로 거부, 미검증 상태 유지 |
| resume 전송 중 protocol_error | 변경 결과 uncertain, 재연결 후에도 resume 총 전송 1회. 중복 실행 없음 |
| 오류가 있는 embedded mount에서 connect만 성공 | available=true인데 error는 사진의 문구 그대로 유지. 연결 listener가 호출한 서비스 list 성공만으로 mount.error가 지워지지 않음 |
| 위 상태에서 embedded list 요청 | mount.error=null로 복구 |

- 실행 1: 5개 시나리오, actual exit 0, 각 메모리 transport dispose/kill 확인.
- 실행 2: 복구 후 오류 잔류 및 embedded list 회복, actual exit 0, dispose 확인.
- 관측 시간 제한: 자동 복구 여부는 5ms 재시도 설정과 40ms 관측 및 구현 분기로 판정했다. 실제 9시간 연결 지속 조건이나 타 OS 수용을 입증하지 않는다.
- 설치 입력 SHA256: accountService.js `83bc1a6bc9f40ce14ea711792cf412cbb7569d880423d730fe12b6b958115ef4`; bridgeTransport.js `c827a5a90371218c2f1b27af68687e3f7ecf60f4217e5f09ed116c8a796e884e`; rootResumeView.js `97697fb02d7789485597500d1fb3d2a8f32962a6cd17a84c8acb89af59a785c6`.
- native 조사 한계: 설치 build-info.json의 engineSourceRoot는 `artifacts/inputs/ec13-r3/project/engine`이며 현재 해당 bridge source 경로가 없다. 현재 engine 소스의 unexpected ServerRequest → InvalidData → protocol_error는 가능한 코드 경로 참고이며, 원래 설치 바이너리의 발생 가지로 확정하지 않는다. 현재 소스는 변형 중이므로 설치본 실행 증거와 구분한다.

## 승인한 수정 범위와 수용

1. 프로토콜 오류에서 자동 무한 재시도하지 않고 관리 연결의 명시적 재접속 제공. 기존 connect 및 같은 CODEX_HOME/version/instance 검증 재사용. 실제 엔진 재시작이 확인된 경우만 기존 supervisor 재시작 경로로 instance 재검증.
2. 재접속과 예약 목록 조회 성공 후 각 embedded mount의 연결 오류를 지우고 최신 예약 상태를 일관되게 전달. 예약별 실행 오류는 연결 오류와 구분하여 보존. 오래된 비동기 실패가 새 성공 상태를 덮지 않도록 현재 요청/연결 기준 확인.
3. UI에 채팅/예약 실행과 관리 연결 실패를 구분. 단순 엔진 전체 불가로 오인하는 문구 대신 관리 연결 상태 및 예약의 마지막 확인 상태 제공.
4. 안전한 발생 지점 enum(예: host JSON 파싱, connected 형식, native bridge 오류, unexpected server request)과 허용된 method 범주로 진단을 분리. raw payload/인증정보 수집 없이 최초 실패를 구분. 원래 장애의 구체적 입력을 알아내려면 이 진단 배포 후 자연 발생 증거가 필요할 수 있다.
5. 위 실패·복구·신원 불일치·uncertain 무재실행과 UI 오류 잔류를 기존 테스트에 연결했다. 후속 승인 개선 검증에서 source typecheck/child fixture와 light/dark 렌더를 실행했다. 배포 패키지 및 installed-host 검증은 별도이며 여기서는 수행하지 않는다.

- 초기 재현 정리: 실험은 stdin/메모리만 사용하여 파일·테스트 프로필·자식 프로세스·실제 연결을 생성하지 않았다. 원본 사용자 로그·DB와 설치본은 읽기 전용. 앞선 임시 계획 입력 부재 확인 완료.

## 승인 개선 실행 및 수용

- root: AccountService의 연결/조회 순서 guard, RootResumeView 명시적 재접속·오류 종류 정합·늦은 실패 무시, inline store 재접속 버튼·중복 차단, 문서/보존 inventory 및 최종 통합 책임. 독립 worker는 bridgeTransport 6종 protocolReason 및 기존 fixture/tests, UI worker는 기존 renderer fixture 확장·실행 소유. 읽기 전용 조사 worker는 최초 원인 후보를 조사했다. Windows x64에서만 실제 검증했고 공통 호스트의 Linux/macOS 및 설치본 수용은 별도다.
- 기존 자동 재연결 차단 정책·같은 home/version/instance 검증을 보존. 사용자 재접속은 list 조회만 하며 실제 엔진 재시작 신원 초기화 경로를 사용하지 않는다. 불명확한 변경 결과는 보존하고 재실행하지 않는다. native wire schema는 그대로 두고 호스트에서 안전한 발생지점 분류만 확장했다.
- 검사 도구는 기존 artifact-run owner로 생성 전 run roots를 예약하고 in-memory TS 변환을 사용한다. 실제 child bridge fixture를 실행하며 공유 dist를 수정하지 않는다. UI 검증은 기존 pinned React/CSS와 격리된 host 대역을 사용한다.
- 2026-10-29 10:06~10:10 KST: host 최초 시도는 runner의 typeRoots 누락으로 885 진단/exit1; runner 경로 수정 후 noEmit 0 및 42 tests/child exit0. 이 두 번째 wrapper는 종료 시 catalog lock 5초 대기 실패로 actual exit1이며 tests 성공과 구분한다. 세 번째 wrapper는 noEmit 0 및 43 tests와 정상 producer close/actual exit0. 마지막 변경은 재개 변경 요청 중 다른 화면의 재접속 금지 guard로 좁혔고 해당 10개 source 테스트 exit0.
- 보존 회귀: scripts/test-deferred-turn.cjs + controls 54개 exit0(104.908초), native pinned transformer 경로 포함. 최종 controls는 10개 exit0. UI 첫 run은 harness의 module-local 변수 접근 오류/exit1, 수정 full run은 실제 exit0/134 checks, 밝음·어두움·360px·마우스·Enter 및 브라우저 종료 확인. UI run IDs: 20261029T010614647Z-28a1d92b-d6d9-4ced-8c2d-ca987749626e(실패), 20261029T010759848Z-a0a35f80-6a2a-4c1d-8538-3ab72f74ebc5(통과).
- project_tests 경로도 시도했으나 첫 dispatch는 catalog lock busy, 다음 run `run-46488-3992-1793236346828017300`은 10.25초 후 124/producer_completed=true로 실패했다. 새 owned run 디렉터리나 해당 producer 생존을 발견하지 못했으며 테스트 통과로 집계하지 않는다. nested 실행기의 일시적 경계 문제로 최종 검증은 검증된 직접 artifact owner runner를 사용한다. 시도용 bundle 항목은 제거했다. 공용 관리 실행기를 이 작업에서 변경하지 않는다.
- 최종 host runner: `20261029T011313556Z-eea37ff5-6c2c-4e4c-a9f3-6bbc7fbcd6c8`, noEmit 진단0, 실제 child fixtures 및 UI host 44개/exit0, wrapper actual exit0/producerStopped=true. standalone 관리 페이지도 `AZRAEL_DEFERRED_RENDER_SCOPE=management`로 실제 HTML/CSS/nonce action을 실행해 17개/exit0, light/dark·360px·mouse/Enter·재접속 실패/성공·최신 revision 활성 확인. browserExit/producerStopped=true이며 03-management-verification.json에 독립 요약을 보존했다.
- 정리 계획: 모든 owned host/render run의 실제 종료 확인 후 요약을 이 폴더의 02-verification.json에 보존하고, 등록/검토/삭제를 고정 identity의 standalone maintenance_owner로 수행한다. 운영 제어 입력 `artifacts/tasks/ei01-cleanup-control.json`은 사용 직후 보통 삭제·부재 확인한다. owner/lock/보호를 우회하지 않는다. wrapper 종료 reconcile 실패 run은 관측된 wrapper exit1 및 child exit0/42tests를 그대로 보존하고 supported close API로 종료 metadata를 정합화한다.
- 정리 진행: wrapper 실패 run의 supported close는 outcome=failure/exit1로 완료. native registration 실패가 남긴 reservation은 실제 synchronous producer 종료 근거를 04-reservation-recovery.json에 바인딩하고 recover_reservation으로 해제했다(status=reservation_recovered, execution_outcome_changed=false). 등록 workId bffb6025-a82f-4369-9dc1-dd9b022a1a4a / session92141은 actual exit0으로 완료됐고, 01:21:50~01:31:18 UTC에 남은 6묶음을 순차 등록했다. fresh registered review에서 7묶음 모두 complete membership, blocker0, reference0, membership match를 확인하고 정확한 토큰으로 delete를 선택했다. 단일 apply session3445는 actual exit0으로 01:43:47 UTC에 완료됐다(시작 약 01:34:48 UTC, 약 9분). 7건 모두 status=deleted/remaining=false이며 234,073,855 bytes의 owned payload 경로와 제어 입력 부재를 확인했다. supported finalize 7건도 finalized로 완료했고 05-cleanup.json에 독립 요약을 보존했다. 02-verification.json의 cleanup pending은 당시 검증 시점의 불변 snapshot이며 최종 상태는 05가 소유한다. 구현·검증을 중복 실행하지 않았다.

## 최초 protocol_error 원인 추정

1. 가장 유력: 관리 companion이 server-initiated ServerRequest를 수신. 설치 bridge의 build-info와 실제 SHA 일치 및 바이너리의 `unexpected server request on management bridge` 문자열을 확인했다. 현 소스는 이 경우 InvalidData→protocol_error로 종료한다. 구체 후보는 Unauthorized 시 account/chatgptAuthTokens/refresh가 같은 owner-context 연결에 broadcast되는 경로다. 당시 해당 method가 발생했다는 기록은 없다.
2. app-server에서 잘못된 JSON-RPC 또는 WebSocket 프로토콜 오류가 발생한 경우. 현 소스/설치 문자열에 대응 경로가 있으나 원본 frame이 없어 판별 불가.
3. bridge stdout 파손/JSON 해석 실패. 이전 호스트에서는 같은 코드에 합쳐진다. 현 native writer는 단일 루프에서 직렬 기록하므로 상대적으로 낮게 보지만 배제하지 않는다.

설치 build-info source tree는 현재 부재이고 local changes가 포함되어 있으므로 현재 source routing이 설치본과 같다고 단정하지 않는다. ±5초 SQLite metadata에는 해당 기록이 없다. 위 순위는 정성적 추정이며 수치 확률이나 인증 만료 확정이 아니다. 이번 host protocolReason은 2/3의 호스트·네이티브 출처를 구분하지만 native_bridge_error 내부에서 1/2를 가르지는 않는다.

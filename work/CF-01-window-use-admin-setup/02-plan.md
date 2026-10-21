# Window Use 자식 세션 정리와 제어 복구 개선 계획

상태: 최소화 감지 및 미확정 입력 후 재검증 개선의 소스 구현·검증과 u22c 빌드·격리 프로필 f 설치 검증 완료. 새 호스트 6단계, 독립 최종 검사와 설치 검증 4단계는 통과했다. 설치 파일 20,918개 및 기존 설정·인증 등 19,661개 보존을 확인했으며 실제 viewer/모델 수용 시험을 시작한다. 사용자 승인 후 관리자 권한으로 세션 7을 로그오프했고 독립 closure 검사 exit 0으로 종료를 확인했다. 등록 리소스는 0개이며 요청 임시 파일 정리도 완료했다. 초기 native 종료 응답 exit 1과 후속 확인 성공을 구분해 `20261019-viewer-live-r1/reports/elevated-logoff7-result.json`에 보존한다. 부모 세션 2는 유지했다. 기존 로그오프 개선의 소스·설치 검증과 아래 실제 시험 결과를 구분한다.

## 격리 화면 최소화 감지와 사용자 복원 요청 검토

상태: 승인된 범위의 소스 구현과 검증 완료. 최소화 사전 감지와 과거 미확정 결과의 영구 차단 제거, 입력 해제 확인을 함께 구현했다. 설치·실제 세션 7 조작은 수행하지 않았다. root가 manager/controller/resources·통합·문서를, native와 host 지침 담당이 분리된 파일을 맡았다. 검증 산출물은 `artifacts/tasks/CF-01-window-use-admin-setup/runs/20261019-viewer-revalidation/`에서 관리한다.

### 구현 결과와 검증 범위

native viewer가 최소화 중 launch/capture/input을 worker 전송 전에 거부하고 사용자 복원 요청을 위한 구조화된 오류를 반환한다. 호스트와 오류 직렬화가 미실행·미확정·해제 증거 및 새 관찰 필요 여부를 전달하며, 유지 관리되는 stage 3 지침은 사용자 복원 확인과 새로운 관찰을 안내한다. 실제 모델의 요청 표시 여부는 새 설치 후 별도 수용 항목이다.

controller는 과거 미확정 flag로 캡처를 막지 않으며, 해제가 불확실한 동안 필요한 입력 재검증만 메모리에서 관리한다. 다음 입력 전에 manager가 정확한 live identity·권한·상태와 release 결과를 검증하고 기존 관찰을 폐기한다. 리소스는 해제 확인 후 `ready`로 반환한다. 기존 `unknown` 세션도 exact live proof가 있을 때만 admission lock 안에서 재사용하며, 호스트가 소유하지 않은 세션을 자동 채택하지 않는다. native 해제는 실패한 키·Unicode·버튼 추적을 남기며 과거 입력을 재생하지 않는다.

- 최종 핵심 검사 43/43 통과, exit 0. Windows x64 native actual-method fixture와 helper self-test도 exit 0이다. 기존 회귀 111항목 가운데 첫 실행은 109 통과·1 경로 guard 실패·1 optional fixture 생략이었으며, 실패한 logoff만 허용된 기존 작업의 고유 경로로 다시 실행해 통과했고 optional native reconciliation도 실제 컴파일 helper로 실행해 통과했다. 최종 host 26/26과 지침 fixture 적용 검사도 각각 exit 0이다. 상세 명령·로그·소스/바이너리 해시는 `reports/verification.json`에서 보존한다.
- 첫 핵심 검사의 warm admission 실패는 incomplete proof를 lease 생성 전에 거부하도록 바뀐 결과를 기존 검사가 반환값으로만 기대하던 차이였다. 거부와 무 lease 계약을 유지하도록 검사를 갱신했다. 지침 적용 검사의 첫 실패는 Python PATH 누락이며 설치된 Python 3.13 경로를 테스트 프로세스에만 제공한 뒤 통과했다. 보호 조건이나 제품 기능을 약화하지 않았다.
- 공유 maintenance lock 때문에 회귀 dispatch가 실행 전에 두 번 거부됐다. lock을 변경하지 않고 같은 검증 argv를 직접 실행했으며 실제 exit를 확인했다. 이후 lock이 해제된 시점에 fixture 그룹 등록·review·apply를 수행해 764,783바이트의 작업 전용 temporary 트리를 일반 삭제했다. logs·reports와 기존 세션의 기록은 유지한다.
- 독립 코드 추적 검토에서 현재 identity·입력 해제·새 관찰·권한 철회·terminal transport·재사용 경계의 구체적 결함은 발견되지 않았다. 이는 실제 desktop 시험 근거는 아니다. 다른 OS 또는 원격 viewer의 실행 검증으로 확대하지 않는다.
- 같은 파일의 기존 미커밋 로그오프·수동 recovery·앱 실행 변경에 의존하므로 해당 작업 소유자의 변경과 안전하게 분리된 task commit은 보류했다. 다른 작업을 임의 staging/commit하지 않았다. 패키징·외부 프로필 설치·새 viewer 실제 최소화/복원·모델 안내 표시·실제 종료/복구 정리 시험은 남아 있다.

원하는 흐름은 격리 화면 창 최소화 감지 → 제어 차단 → Agent가 사용자에게 해당 창의 최소화 해제를 요청 → 사용자 응답 후 실제 복원·권한·대상·연결을 다시 확인 → 새 캡처를 기준으로 작업을 이어가는 것이다. 로컬 Windows x64 stage 3의 부모 viewer가 대상이며, 자식 앱 자체의 최소화와 selected-window의 기존 `restore_window` 경로를 구분한다. Linux/macOS 및 원격 실행의 최소화 지원으로 확대하지 않는다.

### 조사 결과와 재사용

- `native/windows-child-session/ChildSession.cs`의 `Host : Form`이 부모 viewer와 RDP client를 직접 소유하고 `Requests`에서 자식 worker로 요청을 중계한다. 소유한 창의 UI 스레드에서 `WindowState` 또는 기존 `Native.IsIconic`을 조회할 수 있다. 창 제목 검색이나 새 라이브러리가 필요하지 않다. 요청 처리 스레드에서 Form 속성을 직접 읽지 않고 기존 `Invoke` 패턴을 재사용한다. 이 조회는 창을 복원하거나 포커스를 바꾸지 않는다.
- 현재 `IsIconic(target.hwnd)` 검사는 worker의 자식 앱 캡처에만 있다. 부모 viewer 최소화 여부는 중계 전에 검사하지 않는다. `FormClosing`은 실행 중 닫기 요청을 최소화로 바꾸므로 이 경로도 같은 검사에 포함한다.
- `scripts/window-use-isolation.cjs`는 입력 단계의 예외를 모두 `mutationOutcome: unknown`으로 만들고, `scripts/window-control-host.cjs`는 이를 일반 메시지로 바꾼다. 알려진 실행 전 차단을 보존하는 별도 오류 계약이 필요하다. 기존 selected-window `window_minimized`/pause/fresh-observation 설계는 참고하되, 복원 도구가 부모 viewer를 조작하도록 암묵적으로 확장하지 않는다.
- 지난 실험은 최소화 후 unknown 입력을 확인했지만, 직접 실패 원인은 아직 미확정이다. 새 검사는 확인된 최소화 상태를 예방적으로 차단한다. 모든 focus/SendInput/transport 오류를 최소화 오류로 해석해서는 안 된다.
- 설치된 u21a 소스 조사에서 살아 있는 세션의 미확정 입력 상태를 재검증해 해제하는 경로는 확인되지 않았다. 입력 예외는 controller의 `current.uncertain = true`로 고정되고, 이후 `owned()`가 캡처도 차단한다. `safeRelease`에서 native 입력 해제가 성공해도 이 flag는 지우지 않고 리소스를 `unknown`으로 저장한다. 이후 `acquireLease`는 `ready`·`pending`만 허용하므로 기존 세션 재사용도 막힌다. `test-window-use-isolation.cjs`의 uncertain-mutation 검사는 이 차단을 명시적으로 기대한다. manager에는 별도 연결 불확실성 flag가 있고, 이것 역시 정상 연결 관찰만으로 해제하지 않는다. 수동 recovery는 호스트가 소유하지 않은 기존 자식에 worker를 다시 연결하는 별도 절차이며, 활성 helper를 유지한 채 controller의 unknown을 복구하는 기능은 아니다. 종료 확인 후 reconcile/retire는 닫힌 세션 정리용이다. 따라서 현재 현상은 현재 건강 상태를 매번 재평가한 결과라기보다 이전 미확정 실패를 계속 유지하는 보수적인 설계이며, 최소화 사전 차단과 별도로 명시적인 재검증·재개 기능이 필요하다. 과거 입력 결과의 미확정 기록은 보존하면서 현재 제어 가능성·입력 해제·새 관찰을 별도로 검증해야 한다.

### 권장 변경안

1. Native Host가 `launch`·`capture`·`input`을 worker에 보내기 전에 소유한 viewer의 현재 상태를 검사한다. 최소화 상태이면 worker에 해당 작업을 보내지 않고 `isolated_viewer_minimized`, `actionExecuted: false`, `viewerState: minimized`, `requiredUserAction: restore_isolated_viewer`를 반환한다. 상태 확인·입력 해제·안전한 종료 절차는 이 차단 때문에 막지 않는다. viewer가 없는 수동 복구 경로는 `absent` 등 별도 상태로 표현하며 최소화로 추정하지 않는다.
2. JS manager/controller/host가 검증된 실행 전 거부 정보를 끝까지 전달하고 이전 observation을 폐기한다. 기존 held input이 있으면 새 입력은 중단하고 기존 child-local release 경로만 사용한다. 해제 실패나 연결 불확실성은 별도 unknown 상태로 유지한다. UI 상태 조회 실패도 최소화 확정으로 바꾸지 않는다.
3. Stage 3 모델 지침에 해당 오류를 받으면 제어를 멈추고 사용자에게 “`Azrael isolated session (model control)` 창이 최소화되어 작업을 일시 중지했습니다. 해당 창의 최소화를 해제한 뒤 알려주세요.”라고 요청하도록 추가한다. 한 대기 상태에서 같은 요청을 반복하지 않는다. 사용자 응답은 시간 제한이 있는 권한 승인이 아니며, 대기 중 재시도나 짧은 제한으로 작업 실패를 확정하지 않는다.
4. 사용자 응답 후 읽기 전용으로 실제 viewer 복원, 자식 연결, 대상 identity와 유효 권한을 다시 확인하고 새 캡처를 얻는다. 여전히 최소화되어 있으면 제어하지 않는다. turn 경계에서 stage grant가 만료됐다면 기존 승인 경로를 유지한다. 새 세션 생성·재연결·로그오프를 복원 대신 실행하지 않는다.
5. 전송 이후 최소화되는 경합은 사전 검사로 완전히 제거할 수 없다. native 결과에 전송 단계와 최소화 관찰을 함께 보존하되, 이미 전달됐거나 결과가 불명확한 입력에는 `actionExecuted: false`를 붙이지 않는다. 복원 후에도 unknown 입력을 재생하지 않고 새 상태부터 판단한다. 창 복원만으로 stop·취소·권한 철회를 해제하지 않는다. 현재 제어의 재개는 아래 재검증 설계를 적용하며 과거 입력 결과를 성공으로 바꾸지 않는다.

요청된 사용자 복원 방식이 권장안이며 자동 복원은 제안에 포함하지 않는다. Agent의 대화상 요청을 기본으로 한다. 기존 Azrael 내부 표시와 Windows 알림을 추가로 사용할 경우 기존 알림 전달 경로를 재사용하고, 복원 안내를 권한 승인 카드나 50초 권한 타이머에 연결하지 않는다. 모델 지침은 요청 흐름을 안내하고, 실제 입력 차단은 native/host가 강제한다.

### 미확정 결과 저장 정책과 재검증 제안

상태: 승인된 설계이며 소스 구현·검증 완료. 입력 결과를 세션 전체의 영구 `unknown`으로 저장하는 동작을 없애고, 개별 실행 결과·기존 진단 로그와 현재 제어 조건을 분리한다. 현재 제어에 필요한 검사를 유지한다.

| 항목 | 권장 처리 |
| --- | --- |
| 과거 명령의 실행 결과 | 실행 전 거부·전달 확인·결과 미확정을 구조화된 도구 응답과 기존 기록에 남긴다. 별도의 영구 세션 차단 flag로 복제하지 않는다. 전달 확인은 앱에서 의도한 효과까지 확인했다는 뜻이 아니다. |
| 현재 제어 가능성 | 현재 viewer·정확한 세션/worker/대상 identity·연결·권한·소유 lease·입력 해제 상태로 판정한다. 실패 후에는 새 검증과 새 observation이 필요하다. |
| 읽기 전용 관찰 | 이전 입력 결과가 미확정이라는 이유만으로 캡처·상태 조회를 차단하지 않는다. 현재 신원·권한·연결·최소화·캡처 검사는 계속 적용하고 읽기 자체가 실패하면 정확한 사유를 반환한다. |
| 다음 입력 | 미확정 동작을 포함한 기존 연속 작업은 멈추고 observation을 폐기한다. 현재 안전 조건이 재검증된 뒤 새로운 관찰에서 별도 판단한 작업을 허용한다. 이전 클릭·텍스트·드래그를 자동 재실행하지 않는다. 재검증에는 앱 실행이나 새 연결을 숨겨서 포함하지 않는다. |
| 호스트 재시작·응답 유실 | 세션 identity·리소스 소유권 등 기존 관리 정보는 유지한다. 새 호스트는 저장된 `ready`나 과거 로그만으로 입력 권한을 얻지 않고 항상 미검증으로 시작한다. 요청 종료가 확인되지 않은 transport는 새 변이와 겹치지 않게 차단한다. 결과 전달 전 호스트가 종료돼도 작업을 자동 재발행하지 않는다. |
| 자동 정리 | 과거 입력 결과 대신 현재 active/queued work·생성 주체·정확한 identity·미저장 앱·입력 상태·종료 증거로 판단한다. 오래된 `unknown` flag 때문에 영구 보류하지도, flag를 없앴다는 이유로 살아 있는 앱을 자동 종료하지도 않는다. |

명령 결과만 반환하는 방식은 호스트가 현재 안전 조건을 매번 강제하고, 재시작 때도 무조건 재검증한다는 조건에서 채택할 수 있다. Agent의 기억이나 도구 응답 보존 여부만으로 눌린 버튼·동시 실행·연결 손실을 관리하는 방식은 권장하지 않는다. 런타임의 진행 중 요청·눌림 추적·취소 generation·권한·lease는 계속 필요하지만, 이것은 영구적인 과거 실패 flag와 다르다. 새 액션 로그 저장소나 별도 DB를 추가할 필요는 현재 근거로 확인되지 않았다.

설치된 u21a의 native `ReleaseHeld()`는 `SendInput` 해제 반환 개수를 확인하지 않고 추적 목록을 비운다. 이 소스 개선은 각 해제 전송 결과를 확인하고 미확인 입력 추적을 남기도록 수정했다. 새 런타임 설치 전에는 기존 `releaseInput`의 `ok: true`나 `heldInput: false`를 강화된 증거로 해석하지 않는다. 캡처 성공도 과거 클릭의 효과나 실제 입력 해제까지 증명하지 않는다.

예를 들어 그림판에서 최소화로 입력이 실행 전 차단됐다면 복원 확인과 새 캡처 후 작업을 이어갈 수 있다. 전송 중 타임아웃으로 일부 드래그가 전달됐을 수 있다면 해제·연결 검증 후 새 그림을 관찰하고 다음 동작을 판단한다. 삭제·전송처럼 중복 효과가 있는 작업은 현재 앱 상태로 결과를 확인하거나 필요한 사용자 판단을 받은 뒤 진행한다. 과거 결과는 계속 미확정일 수 있지만 그것이 현재 세션 전체의 영구 사용 불가를 의미하지 않게 한다.

추가 검증 기준은 (1) 과거 입력 오류 후 읽기 관찰 가능, (2) 실제 입력 해제 검증 전 새 입력 차단, (3) 재검증 후 새 관찰을 통한 다른 동작 가능, (4) 응답 유실·부분 입력·호스트 재시작·늦은 응답에서 중복 실행과 동시 입력 없음, (5) 최소화와 stop·권한 철회 구분, (6) 저장된 리소스 상태를 제거하거나 마이그레이션해도 미저장 앱·종료·파일 정리 보호 유지이다. 기존 unknown 레코드는 직접 `ready`로 바꾸지 않고 정확한 소유 세션 재검증 또는 종료 증거로 전환한다. 소스·fixture 구현 및 검증 범위는 위 결과를 따르며 실제 세션·설치는 변경하지 않았다.

### 구현 순서와 검증 기준

Native 상태/실행 전 거부 계약 → manager/controller/host 오류 보존 → stage 3 모델 지침과 기존 상태 표시 연결 → 회귀 및 외부 프로필 실제 시험 순서로 진행한다. 구현 시 owning `docs/architecture/window-use.md`의 isolated-execution 절과 feature inventory의 관련 owner/check를 갱신한다. 설치에는 변경된 native helper와 runtime manifest의 일치 검증이 필요하다.

- 최소화 중 요청은 worker의 launch/capture/input에 도달하지 않고, 구조화된 복원 요청 사유와 미실행 결과를 반환한다. 표시된 viewer와 복구 경로, 자식 앱 자체 최소화는 각각 구분한다.
- 사용자가 복원하지 않은 채 응답했거나 응답이 늦어도 입력이 발생하지 않는다. 실제 복원 후 기존 observation은 거부되고 새 캡처가 필요하다.
- 실제 설치된 외부 프로필의 Agent가 복원 요청을 표시하고, 사용자가 복원한 뒤 새 캡처와 클릭·드래그·한영 입력으로 정상 상태 복귀를 확인한다. 기존 unknown 상태의 세션 7은 복원만으로 정상 판정하지 않는다.
- 입력 직전/직후 최소화, 드래그 도중 최소화, held-input 해제 실패, 창 종료·연결 손실, 권한 철회·사용자 stop은 unknown/stop 계약을 보존하고 입력 재생·자동 재연결·세션 종료가 없음을 검사한다.
- source/native fixture 검증과 실제 Windows x64 viewer 시험을 구분한다. 공통 오류 직렬화 변경은 다른 Window Use 단계와 기존 플랫폼 검사를 함께 수행한다. 소스 및 Windows x64 fixture는 위 결과대로 검증했으며 설치된 실제 viewer 시험은 남아 있다.

## 내부 승인 카드의 비동기 대기·재개 검토

상태: 사용자 승인으로 구현 진행 중이다. 진행 중인 u22c 설치·실제 시험과 별도 변경이다. Window Use 단계·앱 승인에 우선 적용하며, 일반 명령·파일 승인 전체로의 확대는 별도 범위다. 요청 상태·메시지 처리·재개 의미는 공통 계층에서 관리하고 Windows 알림과 자식 세션 재검증은 기존 Windows 어댑터를 유지한다. 기존 질문/queue 상태와 IPC를 조사한 결과 외부 승인을 안전하게 등록·결정·철회·복원할 typed engine 계약이 필요하며, elicitation timeout accounting counter는 durable 승인/큐 hold를 대신하지 않는다.

현재 작업 분담은 root가 host consent/30초 분리/권한 재검증/통합·수용, engine owner가 durable 승인 ledger/RPC/자동 큐 hold/정확히 한 번 재개, UI owner가 기존 카드의 턴 종료 후 유지·응답 검증과 queue의 승인 대기 표시를 맡는다. 같은 checkout의 기존 변경을 보존하고 build/cache를 중복 실행하지 않는다. artifact run은 `20261019-async-approval-r1`이며 root/engine/ui의 producer·실제 exit·입력 identity·대기 이유를 각 소유 경로에 남긴다. RPC와 응답 의미가 준비되면 host와 queue 표시가 연결되며, 그 전에는 독립적인 코드/검증 준비를 수행한다. 새 설치/패키징이나 Windows 세션 조작은 이번 구현에서 수행하지 않는다.

원하는 동작은 내부 카드와 Windows 알림을 표시한 뒤 승인과 독립적인 작업을 계속하고, 그 작업이 끝나면 턴을 마친 상태에서 응답을 기다리는 것이다. 승인 응답은 일반 채팅 전송 큐 대신 정확한 요청에 연결된 결정 이벤트로 처리한다. 사용자는 미응답 시 새 메시지를 큐에 보관하고 자동 실행을 보류하는 기존 질문과 동일한 동작을 선택했다. 현재 질문의 `user_questions` ledger와 `queued-compaction` 계약은 보관·자동 소비 보류 및 명시적 지금 보내기 예외를 제공하며, 항목 생성 자체를 막는 구조는 아니다. 이 기존 예외를 유지하고 승인 응답을 근거로 대기 중인 무관한 작업을 임의 실행하지 않는 방향으로 설계한다.

사용자가 승인한 동작은 **초기 동기 대기를 최대 30초로 두고, 이후에도 요청은 유효한 pending 상태로 유지**하는 것이다. 기존 설치본은 50초 만료이며 Bridge RPC의 별도 30초 transport timeout과는 다른 타이머다. 새 30초는 결정 만료·거절·승인으로 해석하지 않는다. 승인 요청은 카드 표시 전에 등록하고 큐 자동 소비 보류를 즉시 적용한다. 초기 대기 중 응답이 오면 현재 도구 호출이 계속될 수 있지만 action-time 검증은 유지한다. UI 전달 실패는 응답 지연과 구분한다. 동일 범위의 재요청은 같은 카드를 재사용하며 30초 대기를 반복하지 않는다. 대기 시작점은 최초 승인 UI 전달 성공이며, postMessage 성공을 실제 사용자 열람으로 취급하지 않는다. 이 추가안은 사용자의 “좋습니다. 구현해주세요” 승인으로 구현 범위에 포함됐다.

30초 뒤 미응답이면 도구는 `permission_pending` 성격의 구조화된 결과(요청 ID, pending 상태, `actionExecuted:false`)를 반환하고 카드·승인 요청을 남긴다. 모델은 승인과 무관한 작업을 이어가고, 더 진행할 일이 없을 때 턴을 마친다. 타이머가 진행 중인 독립 작업을 강제로 종료하지 않는다. 병렬 실행이 가능한 독립 도구도 승인 대기만을 이유로 막지 않는다. 승인 응답이 모델 작업 중 도착하면 결정만 확정하고 다음 안전한 경계에서 반영해 동시 턴을 만들지 않는다. 이미 턴이 종료됐으면 승인 이벤트가 원래 작업을 한 번 재개한다. 사용자 메시지 큐는 앞서 합의한 질문과 같은 정책으로 보관하며, 승인 응답은 그 큐 뒤에 넣지 않는다. 모든 blocking 요청이 해소돼도 취소·복구 예약·기존 큐 순서와 별도 실행 조건은 유지한다.

현행 `scripts/window-control-host.cjs::consent`는 50초 Promise 대기와 `turnId`·`turnVersion`에 묶여 있고 finally에서 요청을 지운다. 따라서 단순 timeout 교체가 아니라 요청 수명과 실행 턴 수명의 분리가 필요하다. 카드의 pending 상태를 유지하는 동안에는 권한을 부여하거나 작업을 실행하지 않는다. 응답은 요청 ID·소유 작업·실행 환경·승인 대상·정책 세대에 연결하고 중복 응답과 오래된 응답을 배제한다. 허용 응답이 도착하면 기존 질문 응답의 재개 경로를 재사용할 수 있는지 확인한 뒤 해당 작업을 한 번 재개한다. 재개 후 현재 권한·대상·연결을 확인하고 새 관찰을 얻은 다음 필요한 도구를 새로 호출하며, 과거 입력을 재생하지 않는다. 대기 턴의 정상 종료는 원래 작업 완료·사용자 취소와 구분하므로 pending 요청을 제거하지 않는다.

취소·거절·작업 종료·대상 변경·권한 철회 시 요청을 닫는다. 새 사용자 메시지의 큐 정책은 위 확인 결과에 맞추되 승인 응답 자체는 해당 요청의 결정과 재개 이벤트로 처리한다. 고정 50초를 사용자 결정의 만료로 쓰지 않고 실제 연결 문제·전달 실패와 사용자 미응답을 구분하는 방향을 제안한다. 엔진 재시작 후 요청 복원 여부와 정확한 설치 런타임의 지원 여부는 별도 검증 사항이다. 이번 검토는 primary 소스의 async 질문 경로를 근거로 하며 설치 중인 u22c가 해당 동시 작업을 포함한다고 주장하지 않는다.

추가 수용 기준은 ① 30초 이내 승인 시 정상 진행 ② 30초 이후 미응답이면 카드 유지·미실행·독립 작업 계속 ③ idle 후 늦은 승인으로 정확히 한 번 재개 ④ 모델 실행 중 승인으로 중복 턴 없음 ⑤ 30초 경계의 응답/타이머 경합에서 승인 소실·중복 실행 없음 ⑥ 여러 요청 중 일부 응답 시 나머지 큐 hold 유지 ⑦ 거절·중단·정책 변경 후 늦은 승인으로 재개 불가 ⑧ 승인 전후 메시지 큐 순서·명시적 지금 보내기 예외 보존 ⑨ UI 전달 실패와 미응답 구분 ⑩ 재시작 후 pending 상태 복원과 재검증이다. 공통 상태·큐·재개는 Windows/Linux/macOS 의미를 통일하고 실제 Window Use 실행/알림 검증은 지원되는 Windows x64 환경에서 별도로 수행한다.

## u22c 실제 시험 현황

### RunOnce 명령 길이 수정

사용자가 260자 이내로 만드는 소스 수정을 승인했다. Windows x64 로컬 child bootstrap만 대상이며 Linux/macOS·공통 UI·권한 정책은 변경하지 않는다. 짧은 32자리 요청 ID를 `--bootstrap` 인수로 전달하고, 기존 private journal과 동일한 검증·ACL·내용을 가진 `%LOCALAPPDATA%/Azrael/ChildBootstrap/<id>.json`에서 독립 pipe/nonce/hash를 읽는다. parent PID·생성 시각·session·SID·실행 파일도 검증한 뒤 기존 Worker를 호출한다. 명령 길이가 여전히 260자를 넘으면 RunOnce 등록·자식 생성 전에 거부한다. 기존 v1 journal은 정확한 과거 명령 검증을 유지해 정리에만 사용하고 새 실행에는 사용하지 않는다. 요청 파일은 journal의 정확한 정리·변경 보존 경로에 연결한다.

구현 소유 파일은 `native/windows-child-session/ChildSession.cs`, 해당 native fixture, 기존 `ui.window-control` 검사 연결 및 owning architecture 절이다. 검증은 실제 C# 컴파일·self-test의 260/261 경계·변조된 ID/명령·legacy 정리 record 검사, private 파일/정리 보존 fixture와 기존 child manager 회귀를 사용한다. 새 run `20261019-bootstrap-length-r1`이 frozen compile·logs·reports·temporary를 소유한다. 현재 요청은 소스 수정·검증이며 설치본 u22c와 세션 10은 변경하지 않는다. 기존 같은 파일의 다른 미커밋 변경은 보존하며 분리되지 않으면 task commit은 보류한다.

소스 수정과 Windows x64 검증 완료. 실제 설치 경로를 넣은 새 명령은 185자(기존 359자)이며 fixture 경로 명령은 210자다. C# 컴파일·순수 self-test·정확한 260자 허용/261자 거부·request ID/명령 변조·v1 정리 record 검사는 exit 0이다. 실제 private 파일 ACL/동일 내용·같은 세션 거부·변조 시 양 파일 보존·정상 요청/journal 제거 검사도 exit 0이다. native run `run-45928-956-1792372883240930900`은 전후 입력 identity 일치로 통과했다. 처음 시도는 프로세스 실행 정책 때문에 실행 전 실패했고, 프로세스 범위 정책을 지정한 다음 시도는 fixture의 PowerShell PSObject→String 변환에서 실패했다. fixture만 수정해 새 immutable a2로 통과했으며 실패 증거도 유지한다.

manager·수동 복구 관련 35개 검사는 pinned 새 helper로 생략 없이 통과했다. 함께 실행한 staging 4개 중 2개는 통과했고 2개는 현재 별도 변경의 `skyPolicyOwnerVersion` 2 대 기존 기대 1, `python` PATH 누락으로 실패했다. 이 staging 소유 파일들은 이번 수정에서 바꾸지 않았다. 전체 회귀 run `run-45928-960-1792372943331330300`은 37/39, exit 1로 보존하며 전체 통과라고 주장하지 않는다. 상세 argv·stdout·입력 identity·결과는 `20261019-bootstrap-length-r1/reports/execution.json`, native 상세는 `temporary/native-a2/fixture.json`에 있다. JS 문법과 변경 파일 diff 공백 검사는 exit 0이다.

새 요청 파일은 시험에서 제거됐고 기존 사용자/설치 파일·세션 10에는 입력/종료를 수행하지 않았다. fixture payload·실패 로그·보고서는 아직 원인 비교와 후속 패키지 검증에 필요해 보존한다. 현재 source acceptance와 설치된 u22c live acceptance를 구분한다. 새 패키지 빌드·설치·세션 생성/그림판 실제 시험은 이번 변경에 포함되지 않았고 미검증이다. 같은 C#·test·inventory·maintenance·설계 파일에 다른 작업의 큰 미커밋 변경이 겹쳐 안전하게 분리된 task commit은 보류했다. 임의로 다른 작업을 staging/commit하지 않았다.

현재 상태: retry-007에서 f host 45804의 진단 tap schema 2와 정확한 module hash·manager 생성 수 1·write failure 0을 확인했다. 새 3단계 승인을 받아 세션 10이 생성됐으나 `Child bootstrap timed out`, `failureStage:worker_wait`를 native 응답 필터 전에 수집했다. native의 40초 worker 대기 실패가 확인됐으며 handshake/admission은 성립하지 않았다. Agent turn 및 watcher는 정상 종료(exit 0)했으나 기능 시험은 실패다. 세션 10을 유지하고 추가 자동 재시도·그림판 실행·입력·로그오프는 하지 않았다. 제품 소스·설치 바이트 변경은 없다. 증거는 `outputs/agent-io/retry-007-completed.json`, `outputs/native-diagnostics.jsonl`, `reports/close9-and-fresh-producer.json`이다.

이전 retry-006은 실패한 세션 8 종료 후 f host 60980의 tap schema 1에서 새 세션 9를 생성했지만 worker 연결에 실패했다(`native_child_error`, HRESULT -2146233079, identity/admission null). 이때 실제 오류 문구가 누락됐으며, 이후 아래의 보완과 사용자 승인 종료를 수행했다.

진단 tap은 동작했으나 시작 오류의 고정 문구가 허용 목록에 빠져 실제 메시지가 보존되지 않았다. 이를 schema 2에서 보완하고 fixture를 통과했다(exit 0, `reports/diagnostic-harness/start-coverage-r2.log`). 이후 사용자 정상 새로고침으로 schema 2가 활성화됐고 retry-007 오류 문구 수집에 성공했다. 이미 누락된 retry-006 메시지를 복원했다고 주장하지 않는다.

별도 정적 조사에서 실제 helper 경로 138자와 동일 길이의 합성 비밀값으로 계산한 RunOnce 명령은 359자였다. Microsoft의 [Run/RunOnce 계약](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)은 명령행을 260자 이하로 제한한다. 이는 시작 경로의 구체적인 호환성 결함이나 이번 실패의 인과관계는 아직 검증되지 않았다. 해당 2분간 Shell-Core Operational 229건에는 Azrael/helper 일치 항목이 없었으며 이것만으로 실행 불가능을 입증하지 않는다. Windows x64 로컬 시작 경로에 한정한 조사이며 다른 플랫폼의 실패로 일반화하지 않는다. 후속 수정은 비밀값 길이나 identity 검사를 줄이지 않고 기존의 private bootstrap request/journal 재사용 가능성을 검토해야 한다.

증거는 `20261019-viewer-live-r1/reports/close-session8-admin-result.json`, `reports/diagnostic-harness/`, `outputs/native-diagnostics.jsonl`, `outputs/agent-io/retry-006-completed.json`에 보존한다. 이후 사용자가 세션 9 종료와 재시험을 승인했다. 동일 SID·부모 세션 2·자식 9·winlogon anchor 60436의 정확한 생성 시각을 관리자 스크립트에서 재검증하고 로그오프했다. 종료 결과는 exit 0, WTS 부재·잔여 프로세스 0개이며 `reports/close-session9-admin-result.json`에 보존한다. 다음 retry-007 명령은 준비만 했고 아직 게시하지 않았다. f 새로고침 응답과 schema 2의 hash·manager 생성 수·새 host 확인이 선행 조건이다(`reports/close9-and-fresh-producer.json`).

격리 프로필 f의 새 extension host PID 54652에서 runtime이 u22c manifest `a71b7ea6abc2da264846be9c11d2dc6d1ddff0f69f004178de1cdf19668219da`와 helper `564e01c87131bdf5e6cb1d675a6ab2e6b4037856940033ad8f67389d8934e044`를 참조함을 runner-ready로 확인했다. 첫 시작은 실행 도구에서 상속된 `ELECTRON_RUN_AS_NODE=1` 때문에 GUI를 만들지 못했으며 자식 시작 프로세스에서만 해당 환경변수를 제거한 뒤 정상 시작했다.

새 실제 thread `01a15191-8cfc-71f3-8225-6b6d8635cdd6`의 baseline001은 stage 3 승인 응답 없이 만료됐다. `approval_timeout`·`approvalState:expired`·`userResponded:false`·`actionExecuted:false`이며 자식 세션·앱·입력은 생성하지 않았다. 당시 창 목록에는 그림판 후보도 없었다. Agent turn 완료를 기능 시험 통과로 해석하지 않는다. 재시도 응답을 기다리며 최소화/복원·클릭/드래그/텍스트 실제 검증은 남아 있다. 증거는 `20261019-viewer-live-r1/outputs/agent-io/retry-001-completed.json`과 events, runtime-ready에 보존한다.

## 실제 Window Use 시험 결과

사용자 지시로 외부 프로필 f에 설치된 u21a를 시험했다. 시험 자료는 `artifacts/tasks/CF-01-window-use-admin-setup/runs/20261018-u21a-live-r1/`에 보존한다. 생성된 자식 세션은 7이며, 부모 세션은 2이다. 과거 세션 4·5·6은 재사용하지 않았다.

- 내부 Azrael 승인 카드와 Windows 알림 모두 표시됐음을 사용자가 확인했다. stage 3 승인 후 새 세션을 생성하고, 부모 그림판 없이 `Microsoft.Paint` 설치 패키지를 격리 세션에서 직접 실행했다. 이번 실행에서 UAC가 실제로 표시됐는지는 별도로 확인되지 않았다.
- 그림판 실제 캡처에서 `(200,270)` 점 클릭, `(250,320)→(480,320)` 가로 드래그, `(550,270)→(700,400)` 대각선 드래그 및 `Azrael u21a Test 123`, `격리 입력 시험` 표시를 확인했다. baseline 캡처는 `reports/retry004/baseline-paint.png`이다. 도구의 자동 readback 검증이 아닌 실제 이미지 확인으로 해당 시험만 통과 판정했다.
- 사용자가 `Azrael isolated session (model control)` 창을 최소화했다고 확인했다. 직후 캡처에는 기존 그림과 텍스트가 남아 있었지만, 첫 추가 입력인 `(800,600)` 왼쪽 mouse down이 `state_changed`, `mutationOutcome: unknown`으로 반환됐다. `actionExecuted` 값은 없었으며 재입력하거나 임의 up을 보내지 않았다. 후속 캡처도 `unsupported_action`, `nativeCode: child-operation-failed`로 실패했다. 최소화 후 정상 입력은 확인되지 않았다.
- 읽기 전용 프로세스 조회에서 session 7의 worker PID 38368과 winlogon PID 57500이 기존 생성 시각을 유지하며 존재했다. 세션이 종료됐다고 판정하지 않는다. 낮은 수준의 focus/SendInput/연결 오류 가운데 무엇이 직접 원인인지는 현재 호스트의 공개 오류만으로 확정되지 않았다.
- 격리 target을 부모 selected-window 전용 `status`에 전달하면 `Stale or forged target`으로 거부된다. 격리 캡처·입력은 별도 경로이다. 또한 `turn/completed`가 stage grant를 해제하므로 분리된 실행에서는 stage 3 재승인이 필요했으며, 한 실행 안에서 baseline과 최소화 비교를 진행했다.
- 입력 결과 미확정과 저장되지 않은 시험 그림을 보존하기 위해 후속 정상 종료·관리자 종료·파일 정리·새 세션 B 복구 시험은 중단했다. 세션 7, 그림판, 시험 창과 진단 자료를 보존한다. 재개 조건은 사용자의 명시적 재개와 새 권한·대상 검증이며, 원인을 해결하기 전 미확정 입력을 재생하지 않는다. 이번 시험에서 제품 소스·설정·설치 파일은 변경하지 않았다.
- 사용자 재개 지시와 viewer 복원 확인 후 retry005에서 외부 Agent의 읽기 전용 `context`·`resource_status`를 실행했다. 기존 세션 7과 소유권은 확인됐으나 리소스 `state: unknown`, `blocked: state unknown`이 유지됐고 대화 context의 stage 3은 `available: false`, `missingPrerequisite: child-session-admission`이었다. 하위 manager의 `admitted`/`admissionReady: true` 표시는 controller의 미확정 상태 해소를 뜻하지 않는다. 권한 요청·캡처·입력·로그오프는 미실행이며 viewer 복원 후 제어 복구는 통과하지 못했다. `reports/retry005/checkpoint.json`에 정확한 반환값을 보존한다. 외부 turn은 completed, 관찰자 exit 0이며 이것은 시험 통과가 아닌 읽기 전용 점검 완료이다. 남은 실제 종료·파일 정리·새 세션 복구 시험은 계속 보류한다.

## u22c 빌드와 격리 프로필 설치 검증

2026-10-19 사용자 지시에 따라 Windows x64 외부 격리 프로필 `f`에 새 빌드 `u22c` 설치와 설치 검증을 완료했다. 실행 기록은 `artifacts/tasks/CF-01-window-use-admin-setup/runs/20261019-viewer-deploy-r1/`이다. 검증된 불변 `u21a`에 아래 선택 수정과 테스트 기대값 보정을 포함한 16개 경로만 적용했다. 다른 엔진·Sky·질문 철회 변경은 포함하지 않으며 앱 버전은 `2026.0.10`을 유지했다.

선택한 검사는 변경 경계의 source tests와 `ui.window-control` 보존 검사이며, 공통 엔진은 기존 `n10a` 소스 지문과 `u17b` 바이너리·도구 증거를 재검증하여 재사용했다. 엔진 교체가 없어 FullRegression을 선택하지 않았다. 최종 동일 VSIX의 fresh host 6단계와 frozen input 검사를 모두 통과했다. 최종 fixture는 `artifacts/build/q`이며 기존 미확정 fixture `k`는 보존한다. 설치 담당은 `f`에만 NoLaunch·바탕화면 바로가기 변경 없이 설치했다. Root가 사용자 승인에 따라 기존 세션 7 종료를 별도로 검증하고 `fclosed`를 전달한 후 설치했으며, 정상 창 실행과 실제 제어 시험은 root가 이어서 담당한다.

`u22a` 입력 캡처와 의존성·엔진 provenance 사전 검사는 exit 0이었다. 빌드 전 source preservation은 전체 최신 feature manifest에 다른 작업의 `scripts/inject-question-withdrawal.cjs` 참조가 포함되어 exit 1로 차단되었다. 실제 제품 컴파일·패키징·설치는 시작되지 않았다. 해당 실패와 frozen source를 보존한다.

Root의 선택 수정 결정에 따라 `u22b`는 `u21a` feature manifest 전체에서 `ui.window-control` 객체만 이번 검증 객체로 바꿨다. `feature-selection-u22b.json`은 구성 원본과 SHA-256을 기록한다. Source suite는 439개 중 432 통과·2 실패·5 생략이었다. 두 실패는 한국어 중지 오류를 영문 `/explicit resume/`로 검사하던 기존 overlay 테스트의 기대값 불일치였다. Root 승인으로 세 assertion만 `state_changed`, `user_stopped`, `user_resume`, `restoreAllowed:false`, `actionExecuted:false`를 모두 확인하도록 수정했고 작은 overlay 시험은 exit 0이었다. 제품 동작은 바꾸지 않았다. 두 새 테스트의 `ui.window-control` 소유 범위도 root가 명시적으로 검토했다.

최종 `u22c` frozen input은 SHA-256 `50e69bcc0a2e7443b63b3013e75020041200783a7c55a4d3d46871fb811d1cd3`, 24,425개 파일·473,213,133바이트다. Source suite·Window Use 보존 검사·제품 빌드·엔진 보존 검사와 최종 helper self-test가 모두 exit 0이었다. 원래 build wrapper는 host 단계 종료값을 기록하지 못했으므로 미확정으로 보존한다. 독립 finalizer가 실제 fresh host 6단계 exit 0, 동일 패키지·frozen source·엔진 receipt·native closure를 다시 확인하고 exit 0으로 수용했다. VSIX SHA-256은 `2606b4480854f8eb4c4e6a5de0b3bb377d7f6e01932f592ed1b5832155041291`이다.

설치 wrapper와 engine receipt 사전 재확인·설치·설치 바이트/런타임 확인·원본 보존 비교의 네 단계는 모두 actual exit 0이었다. 설치 파일 20,918개를 검사했으며 20,917개가 패키지와 바이트 단위로 일치했다. `package.json`은 VS Code가 추가한 `__metadata`만 달랐다. 원본 Codex/audio와 설정·인증 등 19,661개 파일은 유지됐다. 런타임 manifest SHA-256은 `a71b7ea6abc2da264846be9c11d2dc6d1ddff0f69f004178de1cdf19668219da`, helper SHA-256은 `564e01c87131bdf5e6cb1d675a6ab2e6b4037856940033ad8f67389d8934e044`다. 설치 receipt는 `artifacts/build/u22c/artifacts/deployments/independent-20261019-092440-296/deployment.json`이며 별도 창 실행과 실제 Window Use 수용 시험은 이 설치 성공과 구분한다.

독립 확인 가능한 버전 증거는 `artifacts/build/u22c/artifacts/verification/window-viewer-revalidation-install/`, 현재 인계는 run의 `installed-u22c-handoff.json`이다. Native maintenance `cf01-viewer-u22c-version`은 payload와 fixture 두 경로의 완전한 소속을 등록했고 lock은 정상 해제됐다. 설치 후 추가 receipt는 같은 소속 경로 안에 있으며 삭제 전에는 현 identity를 다시 확인해야 한다. 설치된 `u22c`, 이전 검증 rollback `u21a`, pending live acceptance에 필요한 fixture·실패 진단 증거와 Git object-store 의존성은 보존한다. 이번 설치 인계에서는 cleanup review/apply나 삭제를 수행하지 않았다.

## 목표와 범위

Azrael이 자식 세션을 로그오프한 뒤 해당 세션 전용 임시 파일과 활성 관리 정보를 함께 정리한다. 검증 결과, 로그, 스크린샷 등 사용자가 보존을 요청한 기록은 유지한다. 기존 Window Use 작업의 후속 계획이며, 세션 4·5·6 수동 정리 결과를 근거로 한다. 해당 세션들은 이미 종료·정리했으므로 구현 검증에는 새 테스트 세션을 사용한다.

대상은 로컬 Windows 자식 세션 종료 경로다. 현재 조사 환경은 Windows x64이며 다른 OS나 원격 환경에서 검증한 것으로 취급하지 않는다. 공통 리소스 관리 코드를 변경하면 기존 플랫폼 계약에 따른 회귀 검사와 Windows 검사를 수행한다. Windows 사용자 프로필 자체, 계정·로그인 정보, 설치된 공용 helper 및 앱, 공유 캐시는 삭제 대상에서 제외한다.

## 확인한 현행 동작과 원인

- `native/windows-child-session/ChildSession.cs`의 `Stop()`은 안전 검사 후 WTS 로그오프와 자식·worker 종료를 확인한다. 복구 연결한 세션은 입력 해제만 허용하고 로그오프를 금지한다.
- `scripts/window-use-resources.cjs`에는 세션 종료 후 등록된 생성 파일을 지우고 제한된 이력을 남기는 정리 경로가 이미 있다. 일반 삭제와 실제 파일 식별 검증을 재사용할 수 있다.
- `scripts/window-use-isolation.cjs`의 세션 관찰·종료는 현재 호스트의 메모리상 `current`에 의존한다. 호스트 교체 또는 Windows 직접 로그오프 이후에는 저장된 세션 정보가 있어도 상태가 `unknown`이 되어 후처리를 진행하지 못할 수 있다.
- 수동 시험에서 세션별 종료 스크립트·실행 파일, 일회용 복구 요청 및 오래된 활성 리소스 관리 정보가 별도 정리 대상으로 남았다. 제품이 생성한 파일과 테스트 도구가 생성한 파일은 각각 생성 주체가 정리해야 한다.

## 권장 구현

### 1. 생성 시점에 정리 대상을 확정한다

기존 리소스 등록·그룹·잠금 방식을 활용해 세션 전용 산출물을 생성할 때 등록한다. 등록 대상은 실제 해당 세션이 소유하는 launcher/helper 사본, staging, 일시 캡처·readback, bootstrap·복구 요청 등이다. 영구 설치본과 공유 파일은 등록하지 않는다. RunOnce·예약 작업은 기존 소유권 검증 방식을 재사용해 정확히 소유한 항목만 처리한다.

세션 번호 외에 부모와 사용자 식별, 세션 인스턴스를 구분할 생성 시각·프로세스 식별 등 플랫폼에서 검증 가능한 정보를 기록한다. 기존 native identity와 journal을 우선 재사용하고, 재시작 후 검증에 부족한 필드만 추가한다. 파일 경로와 실제 파일 식별, 보존 여부를 함께 기록하며 검증 기록과 삭제할 payload의 경로를 분리한다. 파일 이름이나 나이만으로 과거 디렉터리를 찾아 삭제하지 않는다.

### 2. 모든 종료 경로에서 같은 후처리를 호출한다

권장 순서는 `종료 권한·안전 검사 → 정확한 세션과 파일 목록 고정 → 입력 해제 및 필요한 앱 종료 → 로그오프 → 해당 세션 인스턴스와 관련 프로세스 종료 확인 → 등록 파일 삭제 → 활성 정보 정리 및 결과 기록`이다.

후처리는 로그오프되는 자식이 아닌 부모 호스트가 맡는다. 정상 Window Use 종료 경로와 명시적으로 승인받은 관리자 로그오프 스크립트가 동일한 후처리를 사용하도록 연결한다. 기존의 미저장 작업·사용자 사용·소유권 검사와 복구 세션의 로그오프 금지 계약은 유지한다. 관리자를 통해 특정 세션을 종료하는 예외는 별도 사용자 승인 범위를 유지한다.

소유 프로세스가 종료됐다고 확인하기 전에는 그 프로세스가 사용하는 파일을 지우지 않는다. 다른 호스트·작업이 참조하는 산출물도 참조가 해제되기 전까지 보존한다. 테스트용 종료 스크립트 등은 제품의 임의 폴더 탐색 대신 테스트 실행자의 산출물 정리 단계에 연결한다.

### 3. 중단된 정리를 재개한다

기존 관리 manifest와 bootstrap journal을 활용해 종료 요청, 종료 확인, 파일 정리 중, 완료·부분 실패 상태를 저장한다. 호스트 시작 시에는 정확한 이전 세션 인스턴스가 종료됐다는 증거를 확인한 뒤 남은 파일 정리만 재개한다. 살아 있는 세션의 제어권을 자동으로 인수하지 않는다.

동일 세션 번호가 새 세션에 배정되거나 이전 인스턴스의 종료를 입증할 수 없으면 보류한다. 이전 형식의 기록에 필요한 식별 정보가 없는 경우도 자동 삭제하지 않고 부족한 근거를 보고한다. 중복 실행과 단계별 재시작은 안전하게 처리하며 이미 종료된 세션에 로그오프를 반복하지 않는다.

### 4. 종료 성공과 파일 정리 성공을 구분한다

결과에는 `logoffConfirmed`, `filesCleanupState`(`complete`, `partial`, `deferred`), `remainingPaths`, 실패 단계·오류 코드를 별도로 제공한다. 파일 삭제가 실패해도 로그오프 성공 여부를 정확하게 보고한다. 삭제 후 실제 부재를 확인하고, 마지막에 활성 세션 레코드를 제거하거나 완료 상태로 전환한다. 관리 정보 저장 실패도 다음 실행에서 재조정할 수 있게 한다.

일반 삭제를 사용한다. 잠금, 파일 변경, 추가 파일, 경로 이탈·링크, 권한 오류가 있으면 원인과 잔여 경로를 남기고 보류한다. 강제 삭제, ACL·소유권 변경으로 우회하지 않는다. 자동 관리자 권한 요청은 추가하지 않는다. 관리자 재시도가 필요하면 정확한 대상 목록을 표시하는 명시적 사용자 실행 경로로 제안하며 기존 아키텍처의 권한 상승 금지 범위와 충돌하지 않도록 설계 검토한다.

검증 기록에는 최소한의 세션 식별·작업 시간·종료 결과·정리 결과·잔여 경로를 보존한다. nonce, pipe 인증 정보, 복구 challenge와 요청 원문 등 일회용 비밀을 새 보존 기록으로 복사하지 않는다. 기존 검증 로그와 스크린샷의 보존 기간은 이번 변경으로 줄이지 않는다.

## 구현 소유 파일과 순서

1. `ChildSession.cs`, `window-child-session.cjs`: 기존 종료 증거와 journal 계약을 확인하고 재시작 후 정확한 인스턴스를 판별하는 최소 계약을 확정한다.
2. `window-use-isolation.cjs`, `window-use-resources.cjs`: 종료 후 정리 함수와 재시작 재조정을 연결한다. 생성 등록, 참조·잠금, 삭제 검증은 기존 구현을 재사용한다.
3. `window-control-host.cjs` 및 실제 관리자 종료·테스트 실행 스크립트: 공통 후처리 호출과 결과 전달을 연결한다. 저장소의 일회용 실험 폴더는 제품 정리 대상으로 확장하지 않는다.
4. 기존 테스트와 `docs/architecture/window-use.md`의 리소스 수명주기, 관련 feature inventory를 실제 동작에 맞춰 갱신한다.

## 검증과 완료 기준

- 정상 종료 시 자식 세션·소유 프로세스가 종료되고 등록된 전용 파일과 활성 관리 정보가 제거된다. 검증 기록과 부모 세션·공유 파일은 유지된다.
- 명시적 외부 로그오프 뒤 호스트 재시작 시 남은 정리를 재개한다. 새 세션에 재사용된 번호는 보호한다.
- 로그오프 실패·시간 초과·결과 미확정에서는 파일을 조기 삭제하지 않는다. 복구 세션의 기존 보호 규칙도 유지한다.
- 각 단계 중단·중복 요청·동시 작업 참조·파일 잠금·추가 파일·경로 링크·관리 정보 저장 실패를 검증한다. 부분 실패는 실제 잔여 경로와 일치해야 한다.
- Windows x64의 새 테스트 자식 세션으로 정상 종료와 승인된 외부 종료를 실제 검증한다. 검증 과정 자체의 임시 스크립트도 실행 종료 후 정리하고 검증 기록은 남긴다.
- 구현 후 필요한 기존 검사만 수행한다. 패키징·런타임 반영까지 요청받으면 build playbook, 필수 여섯 host 검사, 정확한 최종 패키지 검증을 거쳐 격리 프로필에 반영한다. 이번 계획 요청으로 배포를 시작하지 않는다.

권장 수용 기준은 ‘로그오프 성공’과 ‘정리 완료’를 각각 확인할 수 있고, 후처리 중단 후에도 재시도할 수 있으며, 검증 기록·사용자 데이터·다른 세션을 보존하는 것이다.

## 구현 및 검증 결과

- 기존 native/manager·resource manager·isolation observer를 확장했다. 원래 worker와 winlogon의 생성 식별을 저장하고, 외부 로그오프·호스트 교체 뒤에는 별도의 읽기 전용 helper로 정확한 종료를 검증한다. 정상 Stop의 복구 세션 보호는 유지한다.
- 이 환경에서 일반 권한의 winlogon 직접 생성 시각 조회가 거부돼 기존 Windows WMI COM의 정확한 Process Handle 조회를 사용했다. 현재 부모 세션의 실제 일반 권한 조회에서 마이크로초 정밀도의 UTC ticks가 반복 일치했다. worker의 생성 시각 검증은 기존 방식대로 유지한다.
- 확인된 종료만 세션 입력 lease를 해제하며, 파일 producer lease·소비자·명시적 보호는 유지한다. 종료 증거를 manifest에 먼저 저장하고 연결된 등록 파일을 정리한다. 파일 삭제 실패는 단계·코드·잔여 경로와 함께 종료 성공 여부를 별도로 반환한다. 오래된 lock이나 불완전 metadata 쓰기는 자동 강제 복구하지 않는다.
- 관리자 종료 스크립트와 일반 권한 CLI finalizer를 추가했다. UAC는 명시적 스크립트 호출에서만 사용한다. 실제 native 종료 영수증 없이 부모 프로세스 종료만 관찰한 경우 요청·계획 파일을 보존한다. 새 Windows runtime staging의 해시 목록에 종료 스크립트·CLI를 포함했다.
- 소비된 복구 요청은 terminal native 응답 후 정확한 파일 식별을 확인해 일반 삭제한다. 결과 미확정·변경된 파일·삭제 실패는 보존과 잔여 경로를 보고한다. 이미 존재하는 등록되지 않은 과거 파일을 임의로 편입하지 않는다.
- 최종 변경 범위 묶음 `window-use-logoff-files`: 85개 중 84 통과, 1개 선택적 native fixture 생략, 실패 0, exit 0. 별도 native·복구 검사에서는 실제 컴파일 helper와 선택적 fixture를 포함해 35/35 통과, exit 0. Windows x64 native 준비 컴파일·self-test도 exit 0이다.
- 실제 파일을 생성하는 CLI→리소스 관리자 통합 검사에서 등록 payload와 활성 레코드 제거, 별도 검증 파일 보존, fixture 일반 삭제·실제 부재를 확인했다. native logoff/UAC는 모의 경계 검사이며 실제 새 자식 세션의 로그오프를 검증한 것으로 취급하지 않는다.
- 전체 연결 회귀: 220개 중 218 통과, 1 실패, 1 선택적 fixture 생략, exit 1. 실패는 수정하지 않은 `test-window-use-staging.cjs:43`이 이전 작업에서 이미 2로 변경된 `computer-use-runtime.cjs`의 `skyPolicyOwnerVersion`을 1로 기대하는 기존 작업 간 불일치다. 이 작업에서 해당 제품 소스나 테스트 기대값을 바꾸지 않았다. Python 경로 준비 후 sync 검사는 통과했다.
- 첫 관리 도구 실행은 약 10초 뒤 exit 124로 종료돼 통과로 인정하지 않았다. 같은 범위를 native 실행 세션으로 끝까지 실행했다. 최초 재실행에서 발견한 상대 fixture 경로를 정규화하고, resource fixture에 PID를 포함해 중단·동시 실행의 경로 충돌을 피한 후 영향 검사를 재실행했다.
- 테스트와 컴파일을 맡은 두 작업은 병렬로 진행했고, 최종 회귀는 입력이 고정된 후 시작했다. 상세 생성·실행 시각과 재실행 결과는 아래 보존 기록에 남긴다. 실제 세션 생성이나 설치를 기다리는 실행은 없다.
- 별도 커밋은 만들지 않았다. 전체 필수 회귀 실패가 남아 있고, native/manager 변경이 이미 수정돼 있던 복구 코드 및 아직 index에 없는 복구 테스트를 전제로 하므로 이번 차이만 `git apply --cached --check`로 분리 적용할 수 없었다. 기존 작업을 섞어 커밋하지 않고 이번 차이의 독립 패치를 보존했다.

검증·독립 패치 보존 위치: `artifacts/verification/window-use-logoff-cleanup-20261018/`. 원본과 바이트 일치를 확인하고 참조를 전환한 뒤 테스트 helper·baseline·중복 로그/보고서 그룹의 세 경로를 모두 일반 삭제했으며 실제 부재를 확인했다. 검증 그룹은 사용자 보존 요구와 남은 수용·커밋 작업을 이유로 보류했다. 최종 검증 뒤 16개 입력 파일 해시가 일치하고 diff whitespace 검사도 exit 0임을 확인했다. 기존 세션 4·5·6의 검증 기록과 사용자 상태는 변경하지 않는다.


## ?? ??? ?? ??

??? ??? ?? Windows x64 ??? ?? ?? ??? f ??? ????. ?? ?? ??? ?? ? ?? ????? ?? ??????, ? ?? ??? ??? ?? ?? ??? ?? ????. ? ??? 2026.0.10? ????.

?? ?? u21a? ??? u20a? ??? ??? u20b? 13? ?? ????, ?? ???? ? ?? ?? ??? ????. ?? ????? ?? ???Sky ??? ???? ???. ?? broad ???? ??? Sky ?? ?? ???? ?? ?? ??? ????, ?? ????? ?? ??? ??? ?? ?? ?? ??? ????. u20b? ?? ???? ?? ??? ??? ??? ????? ???.

?? ??? ??? ??? ??? logoff_snapshot, ???? ??? 6?? ??? logoff_package, ????? ?? ? ?? ??? root? ????. ??? ??? UI/???native ??? ????? ??? ????. ??? ?? engine/bridge/code-mode-host? ?? ?? fingerprint ? ???? ??? ????? ?????. ?? ??? ??? ????? ?? ??, ? ???? 6? fresh-state ??? ??, ?? ??? ??? ?? ?? ????.

??? C:/Users/felre/av18/artifacts/f? extensions, agent-user-data, s, workspace??. ?? ???? ?? ?? ???? NoLaunch/???? ???? ?? ???? ????. ?? ? ???????? Codex ??? ??? ???? ?? ? ????. ???????? ????? ?? ? ?? ??? artifacts/tasks/CF-01-window-use-admin-setup/runs/20261018-logoff-deploy-r1? ??.

?? u21a ?? ?? ??: SHA-256 401b99a75359a3e3073ba4f28361909c6af65af34c631e943112ec594b04f550, 24,423? ??, 473,169,538???. local UI 19,632? ??? manifest? Bun?TypeScript closure? ????. ?? ??? rustc PATH ??? ?? ????? ??? ???? ?? ??? exit 0? ????. ?? source sweep? 432? ? 428 ??, 4 ??, ?? 0, ?? integrity ?? exit 0??. Window Use ?? ??? 180? ? 179 ??, ??? native fixture 1 ??, ?? 0?? namespace owner ??? exit 0??. ?? ??? ?? ??? ??? ?? ???. ?? ? ?? ??? 19,661? ??? ????.

?? ??? actual exit 0?? ?? ? ?? ?? ??? ????. post-build engine ?? ??? exit 0?? ???? provider/recovery/accepted-input ? ?? token-budget ??? ????. ?? final VSIX ?? ???? ?? ?? ??? ??? ?? ???? ???.

?? ??? VSIX SHA-256? 0681bb3235172950305f0d3e90b2b5baac7dd7fbfd59281a588aba246af15a33?? ??? 2026.0.10??. fresh-state ??? 6??? ?? exit 0??. ?? wrapper? ?? ?? ?? ??? ??? ?? ?? ??? ??? unknown?? ????. ?? finalizer r2? ?? ??, ?? ???, ? helper ? ?? ???? closure? ??? ??? ????? actual exit 0?? ?? ?? ??? ????. ?? finalizer? root ?? ? ??? ???? ?? ?? ?? ???? ????, ?? ????? ??? ???? ???. ?? execution+fixture ??? ??? ??? ?? ?? ?? ? ?? ?? ? ???? ??? ????.

?? ??? f ?? ??: engine receipt ????????? ?? ?? ????? ?? ?? actual exit 0?? installation-producer-r2 ??? installed-and-verified??. ?? receipt? artifacts/build/u21a/artifacts/deployments/independent-20261018-182544-880/deployment.json??. VSIX ?? 20,918? ? 20,917?? ?? ????? package.json ??? VS Code? ???? __metadata???. ???????? Codex/audio ? ?? ?? ?? ? 19,661? ?? ??? ????. runtime? f/s ? u21a/window-control? ???? logoffCleanupVersion 1? ? ?? ????? ?? ?? ??? ????. NoLaunch????? ???? ?? ???? ?? ?? ???UAC?Window Use ??/?? ??? ?? ???? ???.

?? ?? ??? ??????? 6???????? ??? artifacts/build/u21a/artifacts/verification/window-use-logoff-install? ???? ??? ??? ????. ?? ??? ?? ?? ??? ?? ?? ??? ?? ??? ????. ?? unknown wrapper ??? execution? fixture k? ?? ????. ??? ??? ??? ?? ??? ?? ?? ??? ?? ????, ?? ???? PID ????? ???? ???. ?? ?? u21a, ?? ???? ?? ?? ?? u19c, ?? ??? ?? ?? Git object store? ?? ??? u20b? ????. ?? ??? SkipCacheCleanup? ? ?? ??? ?????? ?? ?? ??? ?? ??? ??? ??? ????, ??? ??? ??? ??? ??? ? ??? ??? ?????.


구현 진행 기록 (2026-10-19): host의 typed ledger adapter, profile capability, 30초 grace와 durable defer, 동일 범위 카드 병합, 늦은 응답과 fresh operation 재검증을 연결했다. owner-key 단위 6개, host 비동기 시나리오 9개, UI queue 10개와 render 91개가 통과했다. 기존 host 오류 회귀 보정 후 98개도 통과했다. 엔진 순수 ledger 4개와 wire 1개는 pinned Windows x64 fixture에서 통과했다. 실제 Core·rollout·RPC·schema 통합은 별도 검증하며 이 fixture 결과를 전체 통합 통과로 취급하지 않는다. 기존 설치 f/u22c와 자식 세션 10은 변경하지 않았다.

소스 통합 보강: `engine.window-approval`에 frozen native runner와 mandatory Cargo preflight를 연결했다. manifest가 UI feature의 native check 배치를 거부해 별도 engine feature로 바로잡았다. 최종 feature/cache 검증 64개는 exit 0이다(`integration/inventory-r3.log`). 첫 관리도구 시도 exit 124와 잘못된 feature 배치의 exit 1도 보존했다. source 29개는 관리도구 `run-45928-984-1792375019980525500`/exit 0이며 전후 입력 일치를 확인했다. cold archive는 유효 승인이 남은 미로드 하위 대화를 이동 전에 거부하며, 대화를 재개해 승인을 취소하도록 안내한다.

엔진 검토 보강: typed 승인 RPC는 persistent subagent에도 정확한 thread·owner 검증으로 허용하며 일반 사용자 입력 제한은 유지한다. 다른 root/parent 대기 예약이 취소될 때 승인 재개를 깨우는 경로도 연결했다. 분기 대화가 복사·참조하는 조상 기록에서 승인을 물려받지 않도록 private ledger event에 originating threadId를 결합하고 restore/count/archive 모두 일치 검증한다. 기존 frozen r4는 변경하지 않고 결과를 보존하며, 이 수정은 새 소스 identity와 생성물·네이티브 검사로 검증한다.

최종 호스트 검사: `host/tests/host-r6.log`의 80개(비동기 16, 기존 오류 41, 알림 23)가 exit 0이다. 응답 저장 전 실패와 commit 후 전송 유실은 재조회로 정합성을 회복하며 resolve를 무작정 재전송하지 않는다. 보관·삭제 알림은 카드를 정리하고 늦은 클릭을 무시한다. 같은 pending 카드의 복원·재요청은 Windows 알림을 반복하지 않는다. 일반 프로필 준비의 module copy 목록도 보강했고 PowerShell parser 검사는 exit 0이다. 마지막 host 변경 뒤 source 29개를 다시 실행한 `run-45928-1019-1792380675230921500`은 exit 0·전후 입력 일치다(`integration/source-final-receipt.json`).

최종 엔진 frozen r6 SHA-256은 `487f3c581a8070a80ef9882ad7739edfbaff47671ad0563c50f7e31ef0a3d952`다. 현재 코드 28개와 생성 계약 1,139개는 해당 snapshot과 일치한다. 실제 core 13개 및 wire 1개는 exit 0이며 나머지 native stage는 실행 중이다. 앞선 r4 queue의 exit 101은 기존 Python interpreter PATH 누락으로, 설치된 SDK venv를 사용하도록 검증 환경을 보정했다. 실패 결과는 보존한다. 설치본 f/u22c와 Windows 세션 10은 유지한다.

검증 입력 보정: r6에서 core 13, wire 1, store 2, admission 5+21은 실제 exit 0이다. queue source preflight의 exit 101은 변경 전 `apply_to` ABI를 가진 공유 normal-dependency metadata 재사용이었다. Windows 복사가 보존한 소스 mtime이 이전 snapshot의 후속 컴파일보다 오래돼 Cargo가 fresh로 오판한 증거를 보존했다. 기존 snapshot·캐시는 변경하지 않고, 새 task-owned r7의 복사 파일 9,301개 mtime을 최종 immutable 준비 영수증 전에 단조 증가 시각으로 정규화했다. r7은 r6과 콘텐츠 SHA가 같으며 r6의 실제 test binary SHA 증거로 통과 범위를 재사용하고 queue/RPC/schema만 검증한다. 향후 패키징 준비에서는 이 캐시 freshness 전제를 다시 확인해야 한다.
### 자식 세션 소유권 질의와 현재 검증 경계

현재 호스트는 자식 세션 연결과 worker를 관리하며, 입력 lease의 owner는 대화의 `threadId`다. 자연어 작업마다 영구적으로 세션 하나를 배정하는 구조는 아니다. 같은 호스트의 warm 세션은 정확한 세션 식별과 admission, 입력 해제 상태를 확인한 뒤 다시 점유할 수 있다. 다른 프로필이나 소유 호스트를 잃은 세션을 공용 풀에서 자동 인수하는 동작은 현재 구현 범위에 없다. 검증된 빈 세션을 원자적으로 점유하고 반환하는 broker 확장은 가능하지만 이번 질의로 추가 구현하지 않는다.

승인 흐름의 최종 RPC 검증 중 r8은 제품 코드가 아닌 테스트 helper가 `pendingApprovalCount`를 0으로 고정한 오류로 실패했다. 실제 응답의 집계를 보존하도록 테스트만 수정한 r9에서 RPC 3개와 schema fixtures를 확인한다. r6/r7에서 통과한 제품 코드와 생성 계약은 유지하며, 실패 기록과 입력 identity를 보존한다. 설치된 f/u22c와 자식 세션 10은 변경하지 않는다.
### 비동기 승인 구현의 최종 소스 검증

승인된 구현과 필수 소스 검증을 완료했다. 초기 30초 대기 후 카드를 유지하고 `permission_pending`을 반환한다. 늦은 응답은 typed 내부 재개를 한 번 예약하며, 현재 권한·runtime·대상을 다시 확인한 새 도구 호출만 실행한다. 미응답 승인과 질문은 일반 메시지 자동 실행과 compaction을 보류하고 명시적 send-now는 유지한다. 일반 완료·재시작·연결 종료는 pending을 보존하고, Stop·철회·범위 변경은 무효화한다.

최종 결과는 host 80개, source 29개, UI queue 10개와 rendering 91개, feature/cache 64개가 각각 exit 0이다. Windows x64/Rust 1.95 native 검증은 r6 ledger 13개·wire 1개·archive/migration 2개·admission 5+21개, r7 queue 26개, r9 실제 RPC 3개·schema fixture 4개가 모두 exit 0이다. schema의 generator 진입점 1개는 의도된 ignore이며 검증 통과 수에 넣지 않는다. stable/experimental schema와 Python SDK 생성도 exit 0이다. r8/r9는 테스트 컴파일 및 helper 집계만 바뀌었으므로 동일한 제품 입력의 r6/r7 결과를 재사용했다. 최종 r9 SHA-256 `aeb57845ef9d152edda63a26310a7588057a8fc451d6b2bad7d879d312d4aefd`와 현재 소유 파일 30개·생성 계약 1,139개의 불일치는 0개다.

근거는 `artifacts/tasks/CF-01-window-use-admin-setup/runs/20261019-async-approval-r1/engine/verification-summary.json`, `engine/source-coverage.json`, `integration/source-final-receipt.json`, `host/tests/host-r6.log`에 보존한다. 초기 실패와 Cargo mtime 재사용 문제도 기록을 유지한다. 복사 기반 fork와 canonical ancestor history 격리는 검증했지만 실제 reference-backed fork 생성은 별도 시험하지 않았다. Linux/macOS 실행과 설치 환경의 전체 승인 UI 흐름은 미검증이다.

제품 빌드·패키징·설치·실제 Windows 조작은 수행하지 않았다. f/u22c와 자식 세션 10은 유지한다. 검증용 일회성 임시 fixture는 삭제를 확인했고, immutable 입력·실패 진단·최종 증거 및 UI 시험 프로필은 향후 별도 패키지·설치 수용 후 소비 참조가 해제될 때 재검토하도록 보존한다. 기존 공유 변경과 분리할 수 없는 작업 파일은 임의로 stage하거나 커밋하지 않는다. 최종 root 소유 파일의 whitespace 검사는 exit 0이다.

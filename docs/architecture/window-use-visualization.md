# Window Use 동작 시각화

Status: `partial` — native 구현, host 중지 연결과 소유한 실제 테스트 창의 light/dark 표시·입력 통과·대상별 중지를 검증했다. 같은 패키지의 격리 host 수용 검증을 통과하고 사용자 프로필에 설치했다. 사용자가 창을 다시 로드한 뒤의 실제 model/tool 실행, WGC 표시 제외와 다른 DPI의 모니터 전환 수용 검증은 별도다.

## 승인된 표시와 중지 동작

Window Use를 사용하는 실제 대상 창의 네 모서리에서 창 안쪽으로 빛이 퍼지는 효과를 표시한다. 중심의 앱 내용은 그대로 읽을 수 있어야 한다. Computer Use와 같은 종류의 부드러운 fade 표현을 사용하며, 전체 화면에 불투명 색을 씌우지 않는다.

제어 대상이 있는 모니터의 화면 좌측 하단, 작업 표시줄 위의 work area에 반투명 중지 안내를 둔다. 배경이 비치며 안내 전체와 모서리 효과는 마우스 클릭·스크롤·드래그를 아래 앱으로 통과시킨다. 현재 구현 범위의 안내는 표시 전용으로 버튼을 포함하지 않는다. Azrael의 기존 중지 컨트롤은 유지한다.

Computer Use의 pinned Sky 0.7.4 실행파일은 `Azrael is using the computer`, `Esc to cancel` 안내를 포함한다. Window Use도 Escape를 사용한다. Computer Use overlay의 소스와 렌더링 근거는 공급되지 않으므로 같은 픽셀·색을 복제했다고 주장하지 않는다.

- Escape는 현재 활성화된 정확한 제어 대상 창만 중지한다. 다른 앱이 foreground면 다른 제어 창을 중지하지 않는다.
- 별도 top-level dialog를 자동으로 같은 제어 대상으로 확대하지 않는다.
- 중지는 해당 창의 후속 동작과 대기 중 요청을 차단하고 명시적 사용자 재개를 요구한다. 모델의 같은 창 재선택으로 중지를 해제하지 않는다.
- 이미 전달한 앱 동작은 적용될 수 있다. 중지와 원상복구는 별개이며 불확실한 결과를 자동 재실행하지 않는다.
- 일반 코딩 대화의 다른 작업이나 다른 창의 제어까지 중지 범위를 확대하지 않는다.

기본 동작·권한·관찰 유효성은 [Window Use](window-use.md)가 소유한다. 전용 selectedWindow 대화의 기존 tool ceiling은 유지한다.

## 화면과 상태

모서리는 작은 native layered window에 투명 배경과 안쪽으로 감소하는 빛을 그린다. 대상의 위치·크기·DPI를 따라가며 최소화·종료·선택 변경·작업 완료 시 정리한다. 대상의 겹침 순서를 따르고 다른 창 뒤의 대상을 앞으로 올리지 않는다.

좌측 하단 안내는 짧은 제어 상태와 Escape 안내를 표시한다. 매크로에서는 단계 번호와 실행·결과 확인 상태를 보여준다. 입력값, 실행 파라미터, 비밀번호, 창의 내용을 안내 문구에 복사하지 않는다. 단축키가 동작하지 않는 상태를 사용 가능한 것처럼 표시하지 않는다.

현재 target이 foreground일 때만 Escape를 등록하고, 다른 앱으로 전환·완료·중지·종료하면 해제한다. 등록 충돌을 감지하면 Escape 사용 불가와 Azrael 중지 경로를 안내한다. 임의의 다른 키로 자동 변경하지 않는다. 포커스 변경과 키 처리가 경합할 수 있으므로 처리 시에도 대상 identity를 재확인한다.

빛 효과의 native renderer는 밝은 앱·어두운 앱 위에서 모두 내용을 가리지 않고 보인다. 반투명 안내는 배경을 보여주면서 읽을 수 있어야 한다. 현재 효과는 정적인 fade여서 움직임 감소 설정에서도 같은 의미를 전달한다. 안내 폭은 실제 글꼴로 측정하고 작업 영역 안에 제한하며, 좁은 폭에서는 작업 설명을 먼저 줄여 Escape 안내 또는 사용 불가 상태를 유지한다. 사용자 포인터나 전역 키보드 상태를 바꾸지 않는다.

## 실행 책임과 내부 연결

`macro executor → Window owner → verified native backend → overlay UI thread` 경로로 표시 상태를 전달한다. 실행기가 확인한 단계 정보를 사용하며 매 단계 모델 응답을 요구하지 않는다. `scripts/window-task-macros.cjs`의 진행 callback은 단계 실행 및 postcondition 확인 전 안전한 동작 상태를 발행한다.

host의 실제 backend는 내부 `overlayShow`, `overlayHide` 요청을 제공한다. 모델 도구 목록과 사용자 입력에서 이 native 관리 요청을 노출하지 않는다.

| 내부 요청 | 계약 |
| --- | --- |
| `overlayShow` | 기존 전체 `window` identity, opaque `targetId`, 비음수 `generation`, 안전한 짧은 상태 `label`; 응답은 `visible`, `hotkeyRegistered` |
| `overlayHide` | `targetId`, `generation`에 해당하는 표시 정리; 다른 실행을 숨기지 않음 |
| native 사용자 중지 event | `{event:{type:'overlayStop',targetId,generation}}`; 일반 요청 결과와 별개 |

native main loop의 UIA 호출이 오래 걸려도 overlay UI thread가 메시지와 단축키를 처리한다. stdout은 완전한 JSON line 단위로 잠가 요청 결과와 사용자 중지 event가 섞이지 않게 한다. `scripts/window-control-backend.cjs`는 현재 소유한 검증된 helper의 event만 수신하고 schema를 확인하며, event로 대기 중 tool call을 완료시키지 않는다.

`createWindowOwner`는 현재 실행의 targetId/generation이 일치할 때만 중지 event를 반영한다. generation을 무효화하고 paused 상태로 전환하며 기존 observation을 폐기한다. 실행 대기열을 기다리지 않으며 오래된 event로 새 선택·새 실행을 중지하지 않는다. native에서도 정지한 실행의 후속 변이를 차단한다. capture·inspection·변이가 실제 guard와 권한을 우회하지 않는다.

모델의 중지된 창 재선택은 거부한다. 사용자의 명시적 재개 또는 UI를 통한 새 선택이 중지 상태를 해제한다. host disposal, native 종료, 대상 소멸, 표시 해제를 수명 관리에 연결하고 내부 overlay HWND를 창 탐색 결과에서 제외한다.

## 플랫폼 재사용과 검증 경계

기존 `windows = 0.58.0`의 Win32/GDI/HiDpi 기능을 재사용한다. 비활성·입력 통과 표시에는 layered window와 transparent/noactivate/toolwindow 스타일을 사용하고, Escape는 OS hotkey 등록을 사용한다. 근거: [Window features](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features), [Extended styles](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles), [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey).

컴파일·unit test는 실제 앱의 입력 통과·겹침 순서·DPI·캡처 동작을 증명하지 않는다. 제품 native renderer를 소유한 fixture 창에 띄워 밝고 어두운 배경, 반투명 픽셀, 클릭 통과, foreground 보존, 대상 전환·중지·후속 입력 차단, 이동·최소화·종료·cleanup을 검증한다. native renderer와 실제 입력 동작의 근거를 구분한다. 앱별 WGC에 표시가 포함되는지와 설치된 host에서 모델 도구로 실행되는지는 별도 수용 항목이다. 이번 작업의 근거는 외부 작업 문서와 task 로그가 소유한다.

## 추가 시각화 제안

Status: `draft` — 현재 구현 범위에 포함하지 않는다.

Azrael 대화의 접을 수 있는 요약과 상세 미리보기에는 단계 목록, 대상 요소 경계, 실행 API 완료와 사후조건 확인의 구분, 부분 완료·불확실성을 표시할 수 있다. 단계 선택은 기록 열람이며 앱 동작 재실행이 아니다. 네이티브 stdout event와 별도로 제품 대화의 구조화된 렌더링 계약이 필요하다.

UIA의 `BoundingRectangle`은 물리 화면 좌표이며 실제 클릭 가능한 영역과 같다고 보장되지 않는다. 접근성 action의 시각화는 요소 표시와 동작 이름을 사용하고 실제 커서 이동이나 물리 클릭을 추정하지 않는다. 근거: [UIA property contract](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-automation-element-propids).

PNG 미리보기 위에 경계를 그리려면 캡처 영역의 검증된 원점·크기와 표시 배율·여백을 결합해야 한다. 창 바깥 크기와 WGC 이미지 크기가 같다고 가정하지 않는다. 현재 단계와 연결된 frame이 없으면 이전 캡처로 표시하고 현재 위치 강조를 생략한다. 접근성 관찰과 캡처는 원자적이지 않으므로 timestamp/observation ID 결합만으로 동시성을 주장하지 않는다.

전후 화면 기록이나 연속 영상은 캡처 비용·이미지 예산·20초 macro 한도를 측정한 뒤 별도 범위로 판단한다. 값·이름·이미지에 민감한 정보가 있을 수 있으므로 영구 저장, 재시작 후 재생, 보존 기간과 삭제 정책을 별도로 결정한다. 기존 pinned native UI의 컴포넌트와 light/dark theme tokens를 재사용하고 실제 렌더링·상호작용으로 수용 검증한다.

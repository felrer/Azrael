상태: 소스 구현·소유 Win32 fixture 수락 완료. 실제 사용자 동시 입력·일반 앱·설치본 수락은 미검증이다. 관리 잠금 해제까지 시험 산출물 8묶음의 일시 보존을 사용자 승인받았다.

# Azrael Windows 가상 마우스·키보드

## 목표와 현재 권한

사용자는 MouseMux 시험 후 Azrael에 필요한 가상 마우스·키보드만 자체 구현하도록 요청했다. MouseMux의 관찰 가능한 동작과 제공 SDK/프로토콜을 분석하고, Azrael의 기존 구현과 공개 구현을 조사하여 최소 경로를 만든다. 그래프/노드/범용 자동화 툴·다중 물리 장치 관리·MouseMux 런타임 의존은 요구하지 않는다. 앱 작업 자체는 마우스 클릭·키 입력으로 수행하며 RunProgram/셸/UIA 값 교체로 실제 입력 시험을 대신하지 않는다.

제품 소스 변경과 관련 검증은 이번 요청으로 승인됐다. 설치된 Azrael 교체·공개 배포·보호 프로세스/권한 상승·보안 설정 변경은 현재 실행 범위에 포함하지 않는다. 기존 Window Use 입력 사용 거절과 이후 읽기 전용 캡처 허용은 시험 도구 사용에 대한 결정이며 제품 개발의 앱/단계 권한을 약화하지 않는다.

플랫폼은 현재 Windows 로컬 x64 사용자 세션이다. Windows 11 Home build26200에서 MouseMux 표시만 확인했으며 자체 backend 소스와 host/provider 통합을 구현했으며 소유 Win32 fixture 검증을 통과했다. Linux/macOS 활성화와 child session 대체는 범위 밖이다. 앱/CPU/ABI 지원과 실제 확인 범위를 구분한다.

## 승인된 방식과 수락 범위

권고는 승인한 일반 앱 프로세스에 작은 x64 DLL을 로드하고 입력 관련 API만 후킹하는 방식이다. 커서 좌표·버튼·키 상태와 논리 포커스를 가상 사용자별로 관리하고, 실제 물리 키 상태와 구분되는 상태를 대상 앱에 제공한다. API hook가 가능한 공개 구현 사례는 있지만 Azrael/현대 Notepad/Firefox에서의 성공 증거는 아직 없다.

대상 앱 안에 DLL을 로드해 입력 API를 후킹하는 방식을 사용자가 승인했다. 우선 별도 테스트 프로세스에서 부착/해제와 실제 클릭·키 입력을 검증한다. 이 방식은 앱 프로세스의 실행을 변경하며 충돌 가능성과 앱별 호환성 차이가 있다. 프로세스 변경을 허용하지 않는 대안은 창 메시지 어댑터이며 키 상태/포커스 일관성의 호환성 범위가 더 좁다. 이를 동일한 가상화로 취급하지 않는다.

초기 앱 범위(독립 fixture, 시험 전용 Notepad/Firefox), x86/WOW64, 같은 프로세스의 여러 창, 한글 IME/TSF 조합 지원은 프로토타입 결과와 함께 수락 범위를 확정한다. Unicode 문자열 입력과 실제 IME 조합을 구분한다. 최신 요청은 자체 DLL 후킹 구현과 입력 독립성 검증이다. stationary fixture와 실제 사용자 동시 입력·범용 보장을 구분한다. 가상 상태와 실제 앱 입력의 성공은 각각 확인한다.

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

## 제안 구현과 순서

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

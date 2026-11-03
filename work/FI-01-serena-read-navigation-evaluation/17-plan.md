상태: 읽기 조사 결과 기록 — 이전 Azrael 렌더러 OOM과 최근 엔진 연결 종료를 확인했다. 최근 회색 화면의 최종 유발 원인·계정 선택과의 인과 관계는 미확정이다. 제품·설정·계정 변경 및 재실험 없음.

# 현 프로젝트 Azrael 회색 화면 조사

## 목표·범위

사용자는 다른 VS Code 프로젝트는 정상이고 이 프로젝트의 Azrael 패널만 회색으로 변한다고 보고했다. 대략 10분 전 발생했고 kmw 선택 과정의 브릿지 오류 가능성을 제시했다. 이는 수정·재시작·계정 재전환 권한으로 해석하지 않는다.

root가 Windows x64 설치의 기존 로그·Crashpad 덤프와 필요한 소스를 읽기 조사했다. 모델 실험·도구 연결·로그인·프로세스 종료·설정 변경·제품 수정은 수행하지 않았다. 다른 플랫폼은 검증하지 않았다. 이 문서만 결과물로 유지하며 원본 민감 로그·덤프를 복사·업로드하지 않았다.

## 결론

1. **16:02:48의 Azrael 렌더러 메모리 부족은 확인됐다.** Crashpad는 renderer PID 25048, VS Code 1.144.0/Electron 43.8.3, 예외 0xe0000008을 기록한다. `v8-oom-location=CALL_AND_RETRY_LAST`, `v8-oom-stack`은 설치된 Azrael 확장의 `webview/assets/app-initial-97d3534ad35f.js`를 지목한다. 마지막 GC는 약 3620.1 MB의 살아 있는 메모리를 회수하지 못했고 main cage는 4096 MB, 마지막 할당 상태는 `ran out of reservation`이었다. 이는 Azrael UI의 JavaScript 할당 실패이며 PC 전체 RAM 부족을 확정하지 않는다. 명확한 함수 위치나 heap snapshot이 없어 어떤 객체가 메모리를 보유했는지는 확인하지 못했다.
2. **16:47:05의 앱 연결 종료도 확인됐다.** 직전 대화 전환이 30초 timeout, `thread/items/list`가 약 70.8초 미완료인 상태에서 `selected engine disconnected; request outcomes may be unknown`으로 stdio 연결 프로세스가 exitCode 1로 종료됐다. 동시 `getAuthStatus`도 연결 오류로 끝났지만 요청 경과는 35ms여서 인증 요청을 원인으로 정할 수 없다. 16:47:28 확장 호스트는 renderer의 terminate message를 받고 exit0 후 재시작했다. 이를 확장 호스트의 크래시로 분류하지 않는다.
3. 사용자 최근 발생 시각은 16:02 덤프와 일치하지 않는다. 최근 회색 화면을 이 OOM으로 단정하지 않는다. 조사 시점 최신 덤프는 16:02 것이며 16:47의 새 dump/명시적 renderer crash 기록은 찾지 못했다. 기록 부재는 충돌 부재의 증거가 아니다. 브릿지 종료와 최근 회색 화면의 정확한 대응도 미확정이다.
4. **계정 선택이 연결 종료를 유발했다는 인과 관계는 미확정이다.** 고정된 16-verification.json의 kmw action은 15:50:08에 지원 owner RPC로 수행한 저장 프로필 `switch`이며 새 브라우저 OAuth 로그인은 아니었다(`manual_login:false`). 실험 owner에서 선택 일치·account_ready·복구 플래그 해제를 확인했다. 약 57분 뒤 연결 종료까지 이어지는 계정 실패 근거는 확보하지 못했다. 별도 실험 엔진과 이미 실행 중인 UI의 계정 상태 차이는 검토할 가설이며 확인된 원인으로 수용하지 않는다.
5. **당시 별도 실험 엔진의 `account:null/auth_needed:true`는 그 엔진의 관측이다.** 현재 UI의 로그인이 풀렸다는 증거로 확대하면 안 된다. 현 세션이 계속 작업했던 점과 구분해야 한다. 앞선 설명의 범위가 불명확했던 부분을 정정했다.
6. v3.2의 두 함수 도구는 독립 stdio 실험 세션에 요청 등록했다. 제품 catalog 설치·공유 설정 수정은 없었고 실행기는 종료·정리됐다. 현 UI에 직접 추가됐다는 증거가 없다. 다만 정상 계정 선택은 공유 selection 파일에 영향을 줬으므로 실험이 상태에 아무 영향도 없었다고 주장하지 않는다.

## 타임라인 — 2026-11-03, Asia/Seoul

| 시각 | 확인된 관측 |
| --- | --- |
| 15:40:25 | 별도 실험 owner가 현재 계정 없음·저장 프로필 3개 보고. UI 전체의 로그아웃 증거는 아님 |
| 15:50:08 | 사용자가 지정한 kmw를 정상 switch, account_ready 확인 |
| 15:53:58 | 단일 v3.2 모델링 추론 시작 |
| 16:02:48 | Azrael 스크립트를 기록한 renderer OOM 덤프 |
| 16:03:01 이후 | 기존 확장 호스트 exit0, 새 Webview lifetime/renderer_ready |
| 16:45:42 | 다른 대화로 resume 시작 |
| 16:46:12 | 대화 전환 30초 timeout |
| 16:47:05 | selected engine 연결 종료, stdio exit1, 미완료 RPC 결과 unknown |
| 16:47:28 | renderer terminate message 후 확장 호스트 exit0·재시작 |
| 16:47:44 | 새 Azrael Webview renderer_ready |
| 16:57 이후 | 현 대화의 reasoning/tool 이벤트 계속 수신 |

## 근거

- [16-verification.json](16-verification.json)의 `account_result`, `preparation_failures`, `shutdown`, 도구 노출 수용 기록. 고정 원본 변경 없음.
- VS Code 로그 root: `C:/Users/felre/AppData/Roaming/Code/logs/20261102T181623`. `window2/exthost/azrael-ex-local.azrael/Azrael.log` line 10713은 OOM 전 마지막 UI 이벤트, 10719는 다음 Webview lifetime, 10906은 navigation timeout, 10907–10910은 직접 연결 오류다. 같은 디렉터리 `Azrael Recovery.log` line 16090–16091에 RPC 경과·unknown 결과. `window2/exthost/exthost.log`의 16:47:28.213/28.253은 정상 종료 근거. 행 번호는 조사 시점 기준이다.
- Crashpad 원본: `C:/Users/felre/AppData/Roaming/Code/Crashpad/reports/f2daed9e-3739-4034-97c3-007ce4bc908e.dmp`, 2,073,120바이트. 읽기만 수행했다. 표준 라이브러리 struct로 헤더·exception stream·Crashpad annotation dictionary/objects의 PID·버전·OOM 값만 추출했다. dump 복사·업로드·의존성 설치 없음.
- 덤프 형식은 [공식 Crashpad 구조](https://raw.githubusercontent.com/chromium/crashpad/main/minidump/minidump_extensions.h), 예외 의미는 [공식 Chromium OOM 정의](https://raw.githubusercontent.com/chromium/chromium/main/base/allocator/partition_allocator/src/partition_alloc/oom.h)와 대조했다. 기존 debugger가 PATH에 없었다.
- 소스 `engine/codex-rs/app-server-daemon/src/session_handoff.rs`의 selected socket 종료/수신 오류 또는 ping 응답 실패가 같은 일반 오류 문구를 출력한다. 이 문구로 상대 프로세스 종료·소켓 오류·프레임 오류를 구분하지 못한다. 설치 바이너리와 현 소스가 완전히 동일하다고 가정하지 않는다.
- 계정 소스 `request_processors/account_processor/azrael.rs`의 commit_azrael_switch와 azrael_state.rs의 생성·초기 상태 경로를 확인했다. switch commit은 해당 auth manager 갱신·selection 저장·account-dependent 상태 갱신을 수행한다. 실제 실패 인과 관계를 재현하지 않았다.
- 공용 엔진 stderr는 해당 시각을 이진 탐색해 약 2MB만 로컬 검사했다. 일부 WebSocket reset·MCP 초기화 취소 경고는 연결을 확정할 식별·원인이 부족해 직접 원인으로 삼지 않았다.

## 다른 관측·한계

ResizeObserver 경고는 계정 선택 이전부터 반복돼 원인 증거로 사용하지 않았다. 계정 부가 웹 API의 403/Cloudflare challenge를 모델 인증 실패와 동일시하지 않는다. 다른 창의 로그가 공용 SQLite에 섞이므로 구분했다.

기존 safe inspector의 초기 조회는 5,000행 한계로 잘려 이후 시간·severity·target을 제한한 SQLite read-only 조회와 해당 파일 범위로 보완했다. broad rate_limit 분류는 실제 quota 실패가 아니다. 최근 3시간 retained WARN/ERROR 조회에서 ERROR가 없었지만 로그 보존·비동기 flush 때문에 오류 부재라고 해석하지 않는다. Windows Application event에서는 대응 이벤트를 얻지 못했다.

기본 python은 PATH에 없어 exit1, 설치 Python3.13 절대 경로로 정상 수행했다. 초기 작업 기록은 PowerShell 파이프 인코딩으로 한글이 손상돼 이 문서 자체를 정상 UTF-8로 교체했다. 제품 데이터 영향 없음.

## 후속 판단·보존

최근 사건은 selected socket이 왜 닫혔는지, 동일 시점 화면이 왜 회색으로 남았는지까지 확인하지 못했다. 임의 계정 재선택·로그아웃·브릿지 재시작을 반복하지 않는다. 후속 수정 후보는 renderer 메모리 증가의 소유자 확인, 연결 종료 reason 계측·UI 복구 처리, 실험 인증 owner와 실제 창 owner 경계 확인이다. 제안이며 구현·재현 권한은 아직 없다.

계획 생성용 임시 디렉터리는 context manager로 삭제됐다. 새 실행 번들·다운로드·dump 복사본·테스트 프로필은 만들지 않았다. 원래 플랫폼의 로그·덤프·계정 상태는 보존한다. 기능 변경이 없어 아키텍처 변경·제품 빌드·성능 재실험·회귀 실행은 수행하지 않았다.

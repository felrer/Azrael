상태: 조사 완료 — 직접 원인 확인. 동시 대량 출력을 만든 subagent 명령을 확인했다. 큐 전체 소유권은 미확정이며 수정은 요청 범위 밖이다.

# Azrael 중단 원인 조사

- 요청: 방금 발생한 Azrael 크래시 원인 조사. 허용 범위는 로그 및 설치 코드 읽기와 조사 기록이며 코드 수정·재설치·프로세스 종료는 포함하지 않는다.
- 환경: Windows x64 로컬 VS Code, Azrael 확장 2026.0.10. 다른 플랫폼의 발생 여부는 검증하지 않았다.
- 방법: 최신 VS Code 세션의 main/exthost/Azrael 로그와 설치된 extension.js를 대조하고 native logs_2.sqlite를 읽기 전용 조회했다. 동작 변경이 없어 설계 문서 변경 및 빌드·회귀 테스트는 해당하지 않는다.

## 확인된 원인

2026-10-19 21:27:16.128 KST, CodexMcpConnection에서 incoming_line_queue_overflow overflowThreshold=20000 queueDepth=20000이 기록됐다. 이어 Incoming line queue overflow 치명적 오류가 UI에 전달됐다. 설치된 out/extension.js의 DC.enqueueIncomingItems는 깊이가 한도 이상이면 onQueueOverflow를 호출하며, 해당 콜백은 broadcastFatalError 후 teardownProcess를 실행한다. teardownProcess는 대기 요청을 실패 처리하고 연결 프로세스를 kill하며 큐와 초기화 상태를 지운다. 따라서 관측된 직접 원인은 확장의 수신 큐 한도 도달과 그에 따른 연결 종료 처리다. 기록의 exitCode/signal은 null이므로 엔진 자체의 독립적인 네이티브 크래시를 입증하지 않는다.

직후 로그 44줄 범위에 item/commandExecution/outputDelta 알림 19개가 초기화 전 알림으로 기록됐다. 명령 출력 폭증이 관련됐을 가능성이 높지만 큐 전체의 구성, 누적 시간, 정확한 명령 및 스레드는 기록되지 않아 확정할 수 없다. 대량 출력, 여러 스레드의 합산, 소비 지연 중 기여도를 구분하지 못했다.

21:27:21부터 Codex process is not available이 반복됐다. 이후 21:29:31 및 21:30:19 확장 호스트는 종료 코드 0으로 재시작됐으며 exthost.log에는 renderer의 terminate 메시지가 있다. 재시작 후 본 조사 대화가 정상 진행 중이다.

## 근거

- C:/Users/felre/AppData/Roaming/Code/logs/20261017T230155/window2/exthost/azrael-ex-local.azrael/Azrael.log:7428 — 큐 한도 및 치명적 오류, 이후 알림과 연결 불가.
- C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.10/out/extension.js — DC.enqueueIncomingItems, uF 생성자의 onQueueOverflow, teardownProcess.
- C:/Users/felre/AppData/Roaming/Code/logs/20261017T230155/main.log 및 window2/exthost/exthost.log — 후속 재시작.
- window2/exthost/azrael-ex-local.azrael/Azrael Recovery.log — 재시작한 호스트 설정은 u17b 엔진을 가리킨다. 이는 크래시 이전 실제 엔진 경로의 독립 검증이 아니다.

## 결론 및 후속 제안

조사 범위 내 직접 원인은 확인했다. 다음 수정에서는 출력 이벤트의 묶음 전달, 큐 소비/역압력 처리, 연결 재복구 경로를 검토할 필요가 있다. 한도 숫자를 늘리는 것만으로 재발 방지가 입증되지는 않는다. 큐 전체의 소유권 확정에는 출력 이벤트별 thread/item 집계 등 제한된 진단이 추가로 필요하다. 코드 변경 및 재현 부하 실험은 수행하지 않았다. 기존 로그·상태는 보존한다.

## subagent 소유권 직접 확인

state_5.sqlite threads.source와 해당 rollout을 대조했다. thread 01a1541c-28ad-7db0-988a-7a3f3fcaa2c7은 /root/build_legacy_sources, role=luna_explorer이며 부모는 01a1540c-4ee8-76e2-9fba-ff6014763213이다.

call_841d5b5672a54490bdaf0eb47485c896은 21:27:05.832 KST에 시작해 21:27:17.229에 완료됐다. artifacts/build의 u18a, u18a-r2, u19b, u19c, u20a, u20b, g, h20, j 총 9개 폴더에 Get-ChildItem -LiteralPath $p -File -Recurse -Include producer*.json,completion*.json,... 명령을 병렬 실행했다. 출력에는 JSON 패턴 외 .gitattributes 등도 포함됐다. 잘리기 전 original token count는 u18a=140577, u18a-r2=522189, u19b=284928, h20=336682, j=179957로 이 5개만 합계 1464333이다. 이 수치는 명령 출력 규모이며 큐 메시지 수나 모델 청구 토큰 수가 아니다.

대량 출력 명령 실행 중간인 21:27:16.128에 큐 초과가 발생했고 직후 잔여 이벤트는 commandExecution/outputDelta였다. 따라서 subagent의 명령 출력 폭증이 유력한 기여 원인이다. 큐 20000개 각각의 thread/item ID가 미기록이므로 이 subagent 단독 원인이라고 확정할 수는 없다. 부모에게 보낸 일반 메시지 20000개라는 근거는 없다. 앞 절의 정확한 명령 미확정이라는 한계는 이 후속 확인으로 해소됐으며 큐 전체 구성의 불확실성은 유지한다.

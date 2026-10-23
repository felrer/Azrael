상태: 실제 세션 복사본 재실측과 생성물 정리 완료. 추천 세션01a1334d-6a69-7821-a164-da04f3cfa71f 단독 비교와 실제 긴 세션6개의 누적 비교를 수행했다. 최종 r16 exit0, 모든 소유 프로세스 종료, 새8그룹11항목 삭제·finalize 완료. 제품 최적화는 구현하지 않았다. 아래 최신 결과와 계약이 초기 계획을 보완한다.

실제 재시도 계약(2026-10-23): 작은 fixture r12/r13/r14는 실제 exit0이다. r14는 v3 checkpoint 뒤의 완전한 JSONL tail까지 보존하는 검증을 추가했다. 첫 실제 r11은 v3!==v5 assertion에서 snapshot/native 실행 전 exit1/stopped로 끝났다. v3는 미지원이 아니라 v5 lazy rebuild 대상이다. v5는 checkpoint prefix를 복사하고, 이전 버전은 캡처한 완전한 JSONL EOF까지 복사하며 기존 projection rows/version을 보존한다. 원본은 읽기 전용이다. 소스는 rebuild에서 전체 rollout byte vector와 projection-step vector를 보유함을 보여주며 그 peak는 실측으로 검증한다. 새 profile은 `.m/artifacts/p12`, lifecycle은 `run:DJ-01:real-history-r12`다. 추천 단독 A, 페이지 조회 누적 B, 전체 조회 누적 C의 세 backend 세대로 비교한다. 동일 snapshot은 한 번 만들며 임시 DB의 갱신은 다음 세대로 이어진다. 따라서 B의 stale-index 갱신 비용과 C의 갱신 후 조회 비용을 구분한다. 본문은 영구 근거로 보존하지 않는다.

### 실제 이력의 확인된 결과와 진행 범위

최종 다중 실험 r16은2026-10-23T00:32:10.605Z~00:38:09.586Z(약6분), 실제 exit0이다. 설치 receipt와 일치하는 w11aa/0.162.0 Windows x64 엔진,2개 mock window owner·2개 connector, MCP0, account null을 확인했다. inference·도구 재실행·server request 없이6개를 복원했다. 최종 source snapshot은664turn/56,580items, JSONL1,066,653,489bytes, item JSON224,307,185bytes다. 추천 세션은 이 시점에468turn/38,863items·407.18MiB로 증가했으므로 아래 A의467turn snapshot과 완전히 같은 입력이라고 취급하지 않는다. 각 snapshot의 hash/count/version을 별도로 보존했다.

| r16 단계 | loaded 수 | native tree Private Bytes 중앙값(MiB) | 클라이언트 RSS 중앙값(MiB) |
|---|---:|---:|---:|
| 초기 |0|63.67|62.13|
| 추천 복원 |1|103.61|60.03|
| 1개 전체 항목 page 조회 후 |1|118.52|110.51|
| 2개 복원 후 |2|220.69|85.16|
| 2개 page 조회 후 |2|297.31|143.39|
| 4개 복원·page 조회 후 |4|354.55|178.89|
| 6개 복원·page 조회 후 |6|362.91|168.41|
| loaded6에서 각 이력 전체 조회 후 |6|430.00|179.17|
| 전체 unsubscribe90초 후 |0|360.14|156.91|

연속351표본의 native tree 관측 최대650.43MiB는 첫 추천 세션의 복원 구간이다. 전체 조회 구간 최대는515.00MiB, 클라이언트 RSS 관측 최대529.61MiB다. 표본 자체 질의시간 최대1,379.8ms에250ms 대기가 더해지므로 짧은 peak를 놓칠 수 있다. system free 최소9,978.28MiB로 guard에 걸리지 않았다. 모든 API 실패/거부 집계는 빈 객체다.6개 page/full 조회의 item 수는 모두 snapshot과 일치했다. 기존 v3 두 세션은 실제로 v5로 갱신됐고 item 수는 보존됐다. v3 갱신은 동작했지만 가장 큰 peak는 현재 v5 추천 세션에서 관측됐으므로 구버전 색인을 단일 원인으로 결론 내리지 않는다.

단일 항목 크기 조사에서는 두 번째 세션의 저장된 mcpToolCall 하나가17.59MiB였고 해당 세션에는1MiB 초과 항목8개가 있었다. 세 번째 세션도 최대1.95MiB,1MiB 초과4개였다. 추천 세션은 최대 약79KiB로, 작은 출력이 많이 누적된 다른 유형이다. `limit=100`은 개수 제한이므로 응답 byte 상한을 보장하지 못한다. 이 조사는 멈춘 임시 DB의 SQL aggregate만 사용했고 본문을 보관하지 않았다(`evidence/real-history-r16/item-size-analysis.json`).

| 가설 | 이번 판정 | 근거와 한계 |
|---|---|---|
| 긴 실제 이력을6개 열면 약4GiB가 된다 | 이 조건에서는 재현되지 않음 | 보유363~430MiB, 관측 최대650MiB. 실제 공용 프로필 전체·활성 부하는 다름 |
| 전체 이력 반환은 paging보다 큰 할당을 만든다 | 지지 | A에서 page후114MiB, full후327~409MiB, client도 증가. D의 full 추가분은 이미 확보된 heap의 영향을 받으므로 일반 절감률로 환산하지 않음 |
| 100개 item page면 대형 응답을 피한다 | 충분하지 않음 | 단일 item17.59MiB. 별도 byte budget·본문 lazy fetch 필요 |
| 구버전 색인 재구축이 비용을 만들 수 있다 | 실제 갱신 확인, 전체 peak 원인 미확정 | v3→v5와 counts 보존 확인. 소스는 전체 suffix byte/step vector를 사용. v5 추천 복원 peak의 정확한 소유자는 남은 조사 대상 |
| unsubscribe하면 메모리가 즉시 초기값으로 돌아간다 | 기각 | 정상 loaded0 이후에도 A319MiB/D360MiB. allocator·cache·다른 참조의 구별과 leak 판정은 추가 heap 계측 필요 |
| 반복 full-read마다 메모리가 계속 선형 증가한다 | A의3회로는 지지되지 않음 | 327→409→402MiB. 무한 반복·실제 UI는 미검증 |

우선순위는 다음과 같다. 제품 변경은 이번 요청에 포함하지 않는다.

1. 기존 paginated/tail hydration을 우선 경로로 유지하고 full compatibility/fallback의 실제 호출 조건·응답 bytes를 계측한다. metadata/visible window만 우선 반환하고 전체 Vec<Turn> 구성·직렬화·connector 전달의 중복을 줄인다. A에서 약300MiB 보유량 차이가 있었으나 제품 전체의 절감 보장은 아니다.
2. 큰 command/MCP 결과는 요약·크기·본문 참조를 먼저 보내고 펼칠 때 읽는다. 원본 본문과 재조회 가능성을 보존하며 응답 byte budget·oversize-item descriptor를 검토한다. 저장된 MCP 결과와 실행 중 MCP 프로세스는 서로 다른 비용이다.
3. projection rebuild의 전체 byte/step vector를 bounded processing으로 바꾸는 후보를 검토한다. 기존 atomic projection/checkpoint 계약을 보존해야 하며 단순 부분 commit으로 바꾸면 안 된다. 추천 v5 resume peak는 context·projection·transport 단계별 aggregate 계측으로 먼저 귀속한다.
4. 실사용 공용 엔진에 loaded root/agent 수, context bytes, pending event bytes, subscriber와 unload 보류 이유, SQLite/cache/allocator aggregate를 연결한다. 이번 loaded0 잔류를 무조건 leak으로 부르거나 process working-set trim을 근본 해결로 삼지 않는다. 기존 MCP lazy-start 후보도 이전 실측 근거에 따라 유지한다.

한계: API용 클라이언트는 page를 폐기하고 자신의 GC를 수행하므로 실제 Webview state/DOM/이미지 캐시를 재현하지 않는다. 원본 전체4.4GB projection DB·수천 세션·fork/하위 agent·실행 중 추론·queue backpressure·다중 실제 창은 복사하지 않았다. MCP는 껐고 긴 독립 root만 골랐다. 따라서 실사용 엔진 약4GiB의 원인이나 누수를 확정할 수 없다. Windows 로컬만 검증했다. 장시간 누적과 활성 부하를 다루려면 위 aggregate 관측 및 실제 UI 경로의 후속 비교가 필요하다.

정리 완료: 수치/ID/hash 보고서31개와 driver source를 work/evidence에 독립 보관했다. native register→review(모든 blocker[])→명시적 delete→실제 remaining=false→supported finalize를 완료했다. 새8개 group의11항목, logical2,739,535,005bytes를 삭제했으며 이는 디스크 논리 크기이고 RAM 회수량이 아니다. p11/p12/p16와 테스트 DB/대화 복사본/개인 stderr는 제거됐다. 원본 사용자 profile과 실제 작업 프로세스는 정리 대상이 아니었다. 작은 관리 control evidence와 수치 근거는 감사 목적으로 보관한다. `evidence/real-cleanup-{register,review,apply,finalize}.json`이 실제 결과다. 이전 최초 native-a의 defer는 이번 작업에서 변경하지 않았다.

A 단독 비교는 완료됐다. run real-history-r12 전체는 뒤의 B 초기화에서 exit1이므로 전체 성공으로 기록하지 않는다. A의 정상 종료와 유효한 checkpoint/연속 표본은 독립적으로 보존했다. 추천 복사본은467turn/38,753items, JSONL405.67MiB, SQLite item JSON87.21MiB다. commandExecution12,415개가84,085,230bytes(약92%)이며 사용자 발화 자체는21,210bytes다. 저장된 명령 출력이 주요 이력 payload이지만 이 비율은 heap 소유 비율이 아니다.

| 추천 세션 단계 | native tree Private Bytes 중앙값(MiB) | 클라이언트 RSS 중앙값(MiB) |
|---|---:|---:|
| 초기 |58.74|62.07|
| excludeTurns 복원 |97.70|61.93|
| 최신 turn metadata page |97.70|61.68|
| 전체 항목388page 순차 조회·폐기 |114.45|116.08|
| 전체 이력1회 조회 |326.87|368.75|
| 전체 이력2회 조회 |409.22|349.84|
| 전체 이력3회 조회 |402.22|354.65|
| unsubscribe90초, loaded0 |318.66|128.44|

native tree는 실제 backend와 connector 합계이며 측정 driver·PowerShell·mock host를 제외한다. 같은 시점의 합이 아닌 별도 peak를 합산하지 않는다. 연속 표본에서 복원 구간 최대643.88MiB, 반복 전체 조회 구간 최대552.48MiB, 클라이언트 RSS 최대526.76MiB가 관측됐다. polling은 진짜 최대를 보장하지 않는다. 전체 응답은91,726,461bytes이며 매번467turn/38,753items를 정확히 반환했다. 페이지 조회는96,090,176bytes를388개의 응답으로 나누어 받고 폐기했다. 클라이언트는 checkpoint에서 자신의 GC만 수행한다. 실제 UI의 누적 캐시/DOM 비용을 재현한 수치는 아니다.

전체 조회의 큰 비용은 실측으로 지지된다. frozen thread_processor.rs의 paginated_thread_full_turns는 모든 page를 Vec<Turn>에 모으고 Full item view로 반환한다(3491 부근). 최신 compaction 이후 raw suffix는2.61MiB이며 복원 후 보유량은 낮지만, 복원 순간643.88MiB의 정확한 소유자는 미확정이다. 소스 추적에서 정상 v5/checkpoint==EOF 복원은 suffix context와 metadata를 읽고 전체 JSONL 재독회를 요구하지 않으므로 이 peak를 전체 파일 로드로 단정하지 않는다. 반복2→3회의 보유량은 증가하지 않았지만3회만으로 누수를 배제할 수 없다. loaded0에서도 남는318.66MiB는 allocator 보유·cache·다른 참조를 heap 관측 없이 구분할 수 없다.

다중 비교의 변경: p12 재사용 시 B는 기존 account-state path 소유 충돌로 초기화 실패했다(r12 후반/r13, 모두 stopped, exit1). 창별 고유 경로로 바꾼 r14는 첫 resume가-32600으로 거부됐고 종료 관측 assertion도 실패했다. 원래 report의 producerStopped=false를 보존했으며, 이후 모든 tracked child close와 관측 process generation·profile 경로 관련 프로세스 부재를 재검증해 supported closeLifecycle로 failed/stopped를 기록했다(`evidence/real-r14-stopped.json`). PID 부재만으로 복구하지 않았다. r14의 resume 거부 사유는 미확정이다. r16은 새 p16 snapshot과 단일 backend에서1/2/4/6개 resume→page를 먼저 비교한 후 loaded6 상태에서 각 전체 이력을 조회한다. 별도 C backend 비교는 수행하지 않으며, 이 변화로 재사용 fixture의 상태가 결과에 섞이는 것을 줄인다. 원본·제품·설치는 변경하지 않는다.

# Azrael 메모리 분석

## 요청·권한·플랫폼
- RAM 사용량 증가 원인, 최적화 우선순위, 회귀 위험 및 검증 방법을 분석한다.
- 읽기 조사와 격리 프로필 실측, 작업 전용 검증 driver 작성, 테스트 프로세스 정상 종료·생성물 정리를 수행한다. 실제 사용자 프로필·대화·계정·설정은 변경하지 않는다. 제품 최적화·제품 빌드·실사용 설치·덤프는 제외한다.
- 추가 권한: 사용자가 실제 세션 대화 내역을 임시 프로필에 복사해 여러 개 로드하는 재분석을 명시적으로 요청했다. 원본은 읽기 전용이며 인증·설정·실행 중 작업·예약은 복사하지 않는다. 과거 도구 호출 재실행, 새 추론 및 사용자 작업 종료는 제외한다. 대화 내용 자체를 보고서/콘솔에 출력하지 않고 크기·개수·메모리만 기록한다.
- 공통 구조를 검토하되 실제 관측은 Windows 11 x64 로컬 환경 한정. Linux/macOS 절감 효과는 미검증이다.
- 기존 미커밋 변경을 보존한다. 실행 w11aa의 build-info.json이 선택하는 artifacts/build/b13/engine을 런타임 조사 기준으로 삼는다. 현재 engine/과 구별한다.

## 작업·의존성·산출물
- root: 프로세스 역할·버전·메모리 표본, 호스트/provider 및 파일 기반 관측, 종합 판단.
- engine_memory: frozen engine의 thread/agent/history/queue 수명 읽기 전용 조사. 위 소스 신원 확인 완료 후 시작.
- 종합 판단은 실제 수치와 엔진 코드 조사 결과에 의존한다. 모든 결과는 이 기록에서 통합한다.

## 검증·완료 조건
- Private Bytes와 Working Set을 구분하고 VS Code 전체를 Azrael로 귀속하지 않는다.
- 확인된 보관/복사 구조와 실제 누수 의심을 구분한다. 시간에 따른 표본은 통제된 누수 재현이 아니다.
- 파일/기호 근거, 기대효과의 범위, 우선순위, 보존할 기능, 후속 측정안을 제시한다.
- 제품 동작을 변경하지 않으므로 설계 문서·제품 테스트·빌드·설치는 변경/수행하지 않는다.

## 관측 결과와 한계

실측 환경: Windows 11 Home 10.0.26200 x64, 물리 메모리 31.92 GiB, VS Code 1.143.0. 한국 시간 2026-10-23 01:02:04~01:04:11에 20초 간격 목표로 CIM 표본 7개를 수집했다(질의 시간을 포함한 실제 간격 약 21초). 분석 중인 대화와 다른 작업이 실행 중이므로 통제된 유휴 측정이 아니다.

실행 엔진은 PID 61016, `artifacts/build/b13/artifacts/releases/w11aa/engine/azrael.exe`이며 2026-10-22 19:50:02 KST 시작했다. `build-info.json`은 `artifacts/build/b13/engine`과 engine 0.162.0을 지정한다. 엔진/bridge/code-mode 실행 파일 세 개의 SHA-256은 release receipt와 일치했다. 전체 frozen source를 다시 해시하지는 않았다. 현재 primary `engine/`의 변경을 설치된 동작으로 간주하지 않는다.

| 관측 대상 | 개수 | Private MiB | Working Set MiB | 귀속과 해석 |
| --- | ---: | ---: | ---: | --- |
| 공용 Azrael 엔진 | 1 | 4316.4 | 2664.6 | 직접 확인된 가장 큰 Azrael 프로세스 |
| Window Use MCP | 50 | 1111.8 | 1287.3 | 엔진의 직접 자식. 필요한 작업인지 여부는 미확인 |
| node_repl | 50 | 146.3 | 448.5 | 엔진의 직접 자식. REPL 세션 상태 보존 조건 확인 필요 |
| code-mode host | 6 | 198.0 | 187.7 | 프로세스 수명과 상태 보존 조사 대상 |
| engine connector/기타 stdio 엔진 | 8 | 211.7 | 263.0 | 공용 backend와 구분. 경량 connector 6개 외 다른 stdio 경로 포함 |
| bridge | 6 | 28.8 | 67.5 | 전용 비용이 상대적으로 작음 |
| VS Code renderer 전체 | 18 | 6485.8 | 5263.7 | Azrael 외 편집기·다른 Webview 포함 |
| VS Code utility 전체 | 16 | 2778.1 | 1538.8 | 확장 호스트·watcher·다른 서비스 포함 |

위 표는 `process-summary.json`의 한 시점이다. MCP+REPL 전용 할당은 약 1.23 GiB이며, 앞선 표본에서는 약 1.27 GiB였다. 실제 물리 RAM 회수량이나 종료 가능한 양으로 해석하지 않는다. 같은 release 경로의 다른 Node 프로세스 6개는 581.9 MiB private이지만 역할을 충분히 검증하지 않아 주요 원인으로 귀속하지 않는다. Code.exe 프로세스 전체는 약 10.18 GiB private이며 Azrael 단독 사용량이 아니다. 별도 native 자식 실행 파일까지 포함한 전체 VS Code process tree 합계는 아니다. `code --status`는 6개 workspace 창을 보여주었고 원본 Codex·언어 서버 등도 함께 실행되고 있었다.

Private Bytes는 프로세스 전용 committed memory이며 실제 상주 RAM과 다르다. Working Set은 현재 상주 페이지로 공유 페이지도 포함한다. 따라서 여러 프로세스 Working Set의 합은 물리 RAM의 정확한 순증분이 아니다. 참고: [Microsoft 메모리 지표](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex).

7개 표본에서 엔진 private은 4193.5→4311.5 MiB(+118.0), Working Set은 2519.1→2657.0 MiB였다. 마지막 약 42초의 private은 거의 일정했다. 스레드는 317→323, handle은 2897→2858이다. 이 자료만으로 누수, 시간당 증가율, 모든 메모리의 소유 객체를 확정할 수 없다. 높은 live state, 일시 복사, 대기 큐, allocator의 재사용용 보관을 구분하려면 후속 계측이 필요하다.

## 호스트와 provider의 코드 근거

### 숨김 Webview 해제는 이미 존재한다

- frozen `scripts/webview-idle.cjs:35`는 기본 1시간의 hidden timeout을 사용한다. `:55`의 native reservation gate와 `:66`의 UI snapshot gate가 실패하면 새 1시간을 시작한다.
- `extensions/azrael-ex/src/accountService.ts:104`는 해당 연결의 예약이 모두 resumed/cancelled일 때만 해제를 허용한다.
- `scripts/webview-idle.cjs:14`~`:29`는 현재 화면 외 cached conversations의 작업·큐·미확인 제출·활성 goal도 검사한다. 하나라도 보호 상태면 해당 renderer를 보존한다.
- 설치된 `out/extension.js`에서 idle transform marker와 release command 존재를 확인했다. 실제 lifecycle 성공 빈도·실패 이유·개별 화면의 절감량은 확인하지 않았다.
- 제안: 기존 기능에 해제 시도/보류 이유·문서 크기 계측을 연결하고, 완전히 유휴인 화면에 한해 압력 기반 대기시간 또는 사용자가 선택하는 짧은 대기시간을 검토한다. 전역 gate를 좁히려면 큐·예약·승인의 실제 소유 관계부터 분리해야 한다. 활성 작업의 화면을 무조건 해제하지 않는다.

### Window Use MCP 중계 계층의 중복 비용

- frozen `scripts/window-control-mcp.cjs:181`의 `createProtocol`은 tool 요청을 thread metadata와 permission metadata로 검증하고 기존 relay로 전달한다. `:206`의 `runProtocol`은 stdio 입력의 생애 동안 프로세스를 유지한다.
- `:142` 부근 relay는 thread별 window session 파일을 읽고 인증된 host IPC로 전달한다. MCP 중계와 실제 Windows control backend는 별개다.
- 50개 프로세스 중 상당수가 미사용/완료 thread 소유라면 lazy start와 안전한 idle teardown의 효과가 클 수 있다. 단순히 50개를 전부 불필요한 프로세스로 간주할 수는 없다.
- 장기 대안은 중계의 공용화지만, transport 인증·thread별 승인·nonce·요청 순서·취소·고장 격리를 재설계해야 한다. 상태가 있는 node_repl의 전역 변수/모듈/자원은 thread 간 공유하면 안 된다.

### provider 요청의 일시 복사

- frozen `providers/opencodex/inference.ts:663`~`:666`은 stdin chunks → Buffer.concat → UTF-8 문자열 → 줄 분리 → JSON.parse 경로를 사용한다.
- `:479`는 adapter가 만든 요청 문자열을 `JSON.parse`하여 wire 객체를 추가로 보유한다. 입력 객체·변환된 메시지·직렬화 요청이 한 turn에서 함께 살아 있을 수 있다.
- `providers/opencodex/inference-mapping.mjs:8`~`:10`에는 8 MiB 텍스트/32 MiB 요청 제한이 존재한다. Rust `core/src/devin/native_runtime.rs:35`~`:60`은 stream capacity 64, frame 8 MiB, provider별 request 한도와 output 한도를 둔다. 무제한이라고 판단하지 않는다.
- 제안: 기존 제한과 요청 단위 helper 수명을 보존하면서 중간 Buffer/문자열의 조기 해제, framing의 증분 파싱, provider별 불필요한 parse/stringify 제거를 검토한다. 효과는 큰 context와 동시 turn의 peak에서 측정해야 하며 엔진의 4 GiB 지속 보유를 이 경로만으로 설명하지 않는다.

## 후속 측정과 수용 조건

1. 현재 loaded window/thread/agent, terminal/active/waiting 상태별 개수와 보유 history bytes, MCP별 PID·last-use·inflight 요청 수를 aggregate로 기록한다. 원문 대화·인증·이미지를 로그에 남기지 않는다.
2. 제품과 같은 frozen package의 isolated state에서 대화 열기→완료→다른 대화로 이동→닫기를 1/10/50회 반복한다. 완료 agent와 MCP/REPL 수, private/working set, 객체/queue bytes, dispose latency를 함께 본다. 실제 사용자 세션을 종료하는 실험은 별도 승인 대상이다.
3. 큰 tool output/이미지/history, 병렬 agent, 느린 UI 소비자·연결 끊김을 분리해 peak와 backlog를 확인한다. 일반 완료·취소·오류·연결 재시도 모두에서 자원 수가 회복되는지 검증한다.
4. 해제 후 다시 열기, 재개, approval, queue, root reservation, 미확인 부작용, account/window 격리 및 REPL 상태를 보존한다. 처리량·첫 응답/재개 p95도 측정해 메모리 절감과 지연을 함께 평가한다.
5. Windows 제품 프로세스 수명/IPC를 필수 회귀로 두고 공통 변경은 Linux x64/macOS ARM64의 native 수명도 각각 검증한다. 현재 보고서에는 다른 OS의 실측 근거가 없다.

통과 목표는 일정한 workload에서 완료/닫힌 thread에 비례해 MCP와 loaded state가 무한 누적되지 않고 안정된 상한에 도달하는 것이다. 정확한 MiB 목표와 절감률은 baseline 실험 후 정한다. 시스템 Working Set 강제 축소, V8 heap 한도 강제 하향, 로그/디스크 캐시 삭제, 주기적 재시작은 상태 보유 원인 분석을 대체하지 않는다.

## 보관과 실행 범위

`memory-samples.json`, `process-summary.json`, `runtime-identity.json`은 이 분석의 근거로 유지한다. 표본 수집과 실행 파일 hash 검사는 exit 0이었다. 제품 코드·설정은 변경하지 않았고 빌드·설치·전체 회귀 테스트·사용자 프로세스 종료·heap dump는 수행하지 않았다. 격리 테스트의 소유 프로세스만 정상 종료하고 생성물은 관리 도구로 정리한다. 계획 생성용 임시 본문은 일반 삭제로 제거했다. 기존 작업의 변경은 보존했다.

## 엔진 조사 결과

대상은 release receipt의 frozen `artifacts/build/b13/engine/codex-rs/`이다. 아래 경로는 이 디렉터리에 상대적이다. 읽기 전용 조사 결과를 재사용했으며 구현·성능 검증 결과와 구분한다.

| 경로와 기호 | 확인된 구조 | 증가 조건과 판단 한계 |
| --- | --- | --- |
| `core/src/thread_manager.rs:417`의 ThreadManagerState.threads, `:2600`의 등록 경로 | `Arc<CodexThread>`를 보관하며 일반 loaded-root 전체 상한은 없음. explicit removal/idle unload/정상 bounded shutdown 경로 존재 | 대화를 많이 로드한 뒤 안전한 해제 조건에 도달하지 않으면 session·history·MCP가 함께 남을 수 있다. 격리 loaded 개수는 측정했으며 실사용 엔진의 loaded 개수는 미측정 |
| `core/src/state/session.rs:68`, `core/src/context_manager/history.rs:91` | 세션별 ContextManager의 response-item vector 보관. compaction/rollback/reset에서 교체/정리하며 이 보관층에 독립 byte/item 상한 없음 | 큰 이력·도구 출력·이미지 등에 비례하는 상태 보유 가능. 기존 tool-output truncation은 존재하므로 모든 출력이 무제한이라고 해석하지 않는다 |
| `core/src/session/mcp_runtime.rs:379`, `codex-mcp/src/connection_manager.rs:635` | 일반 세션 MCP는 Eager, subagent는 LazyWhenCached. cache가 있어도 plugin/가시 tool 조건 등에 따라 즉시 시작할 수 있음 | 일반 대화 로딩 수가 MCP 프로세스 수를 배수로 늘릴 수 있다. 50쌍을 50개 실행 중 agent 또는 50개 방치된 thread로 단정하지 않는다 |
| `core/src/session/handlers.rs:356`, `codex-mcp/src/connection_manager.rs:930` | session shutdown은 prewarm 중지 후 MCP clients shutdown 수행 | cleanup 구현이 없는 것이 아니라, 보유 중 session이 실제로 언제 shutdown/unload되는지가 핵심 |
| `core/src/session/mod.rs:618`, `:2669`, `core/src/codex_thread.rs:851` | thread event 채널은 async_channel::unbounded. send 시 상한 없음. queued_event_count는 존재 | listener가 느리거나 막히면 대형 payload가 적체될 수 있다. 실제 적체/byte 점유는 미측정 |
| `app-server/src/thread_state.rs:129`, `:372` | listener command는 Tokio unbounded channel. active-turn history builder는 완료/defer/teardown 때 reset | active turn·listener 지연에 따른 비용. 완료된 모든 turn을 builder가 영구 보관한다고 볼 근거 없음 |
| `app-server/src/azrael_shared_server.rs:234`, `:388`, `:762` | owner context마다 processor를 map에 보유. connection closure와 context teardown은 다른 수명 | 다른 창이 엔진을 살려두면 이전 owner context가 남을 수 있다. rejoin·계정/승인·작업 routing 보존 목적이 있으므로 즉시 삭제는 위험 |
| `core/src/agent/control/mailbox.rs:15`, `:81` | unloaded agent의 pending mail은 Vec에 쌓이며 explicit shutdown에 정리 | 미소비 메시지가 쌓일 때 증가 가능. 읽지 않은 메시지 삭제는 허용할 수 없음 |

이미 있는 보호 장치: V2 subagent residency는 기본 tree당 resident 3개이고 eligible idle/completed agent만 eviction한다(`core/src/config/mod.rs:257`, `core/src/agent/control/residency.rs:130`). 이 제한은 일반 loaded root 전체를 제한하지 않는다. MCP catalog cache는 32개/30분 TTL이다(`codex-mcp/src/tool_catalog_cache.rs:33`). Guardian review history도 종류별 128항목/4 MiB 제한이 있다(`guardian-context/src/history.rs:25`). 공용 context event/outgoing relay는 capacity 128로 bounded이다(`app-server/src/azrael_shared_server.rs:425`, `:577`). 따라서 모든 cache·채널에 일괄 상한을 새로 넣는 접근은 근거가 약하다.

대기 큐의 일반 원리는 [Tokio 공식 문서](https://docs.rs/tokio/latest/tokio/sync/mpsc/fn.unbounded_channel.html)에서도 확인했다. 다만 Core event 큐는 async_channel이고, Tokio 문서는 app-server command 큐와 일반적인 unbounded 적체 위험을 뒷받침한다. 라이브 적체가 확인된 것은 아니다.

## 권고 우선순위와 영향

| 순서 | 제안 | 기대효과의 근거 | 보존 조건·trade-off |
| --- | --- | --- | --- |
| P0 | loaded root/context/agent 수, history bytes, event backlog bytes, MCP last-use/owner 및 Webview 해제 보류 이유를 먼저 계측 | 4.2 GiB 엔진의 실제 소유 범주와 회수 대상을 좁힌다. 수집 자체가 절감 기능은 아님 | aggregate만 수집. 현재 trace/queued_event_count/기존 Webview lifecycle 진단 재사용. 승인/작업을 변경하지 않음 |
| P1 | 기존 idle-unload를 활용해 완료·미사용 root/context를 안전하게 해제하고 MCP shutdown이 따라오는지 검증. 일반 MCP에도 가능한 범위에서 lazy start 확장 | 엔진 session/history와 약 1.2 GiB MCP+REPL 관측을 함께 줄일 수 있는 구조적 경로 | 저장 완료·진행 turn/child/queue/예약/approval·미확인 부작용·미소비 mail을 검사. REPL 상태가 필요한 세션은 보존. 재진입 지연 증가 가능 |
| P2 | 기존 Webview idle 정책의 설치본 성공/보류 비율부터 측정. 완전 유휴 화면의 압력 기반/짧은 timeout과 대화별 gate 검토 | renderer 전체에 큰 비용이 관측됨. 이미 구현된 lifecycle을 개선할 수 있음 | 18개 renderer 모두가 Azrael은 아님. active 작업·draft/attachment·scroll·queue client ownership·복원 handshake 보존. cold restore 비용 증가 |
| P3 | Core event와 listener command에 byte-aware budget·생산 속도 제어 도입 | unbounded 적체 경로를 제한하고 소비자 지연 때 시스템 안정성 개선 | async_channel/Tokio의 기존 bounded 기능부터 검토. token delta/대체 가능한 상태만 안전하게 합치고 승인·결과·terminal 순서를 유지. 잠금을 보유한 await와 제어 이벤트 교착 회귀 필수 |
| P4 | provider framing/JSON 중간 복사와 큰 이력의 메모리 표현 최적화 | context가 크고 동시 turn이 많을 때 일시 peak 감소 가능 | protocol/capability/tool schema·reasoning replay·image·hash·요청 한도 유지. 전체 엔진 지속 보유의 주원인으로는 아직 입증되지 않음 |

현 단계에서 절감률·고정 RAM 목표는 제시하지 않는다. Window Use MCP 약 1.1 GiB private은 최적화 대상의 현재 보유 비용이며, 그 전체가 회수 가능하다는 뜻은 아니다. 해제 가능한 세션 비율과 재기동 비용에 따라 실제 절감이 달라지므로 isolated 반복 workload로 검증해야 한다.

현재 사용자가 선택할 구현 결정은 요구하지 않는다. 이번 산출물은 분석이며 P0~P4는 후속 구현 제안이다. 전체 cache 삭제, 컴팩션 비율 변경, subagent 최대 수 일괄 축소, 원본 Codex 비활성화는 분석 결과에서 자동 승인되는 조치가 아니다.

## 최종 판단

격리 실측은 대화별 MCP의 선행 시작 비용을 확인했다. 10개 대화에서 MCP 유무에 따른 전체 native process tree Private Bytes 차이는 298.3MiB였다. 반면 MCP 없는 빈 대화 20개와 단일 8MiB/64턴 이력은 각각 86.6MiB, 113.4MiB 수준으로, 실제 공용 엔진의 약4.2GiB를 재현하지 못했다. 정상 idle 대화는 기존 60초 지연 해제 경로를 통해 90초 표본에서 loaded0/MCP0으로 회수됐다. 따라서 새 idle unloader 도입이나 30초 보유를 누수로 단정하는 제안은 철회한다.

우선순위는 MCP의 안전한 lazy start, 실제 엔진의 loaded/subscriber/보류 이유·이력 크기·queue bytes 계측, 기존 paging을 이용한 전체 이력 materialization 축소다. UI 숨김·닫기 절감량, 활성 추론/streaming·느린 consumer의 peak/backlog, maintenance metadata 비용은 미검증이다. 제품 변경 없이 확인한 범위를 넘어 절감률이나 4GiB의 단일 원인을 확정하지 않는다.

## 격리 실측 실행 계획

### 실제 세션 재실측 입력과 순서

사용자가 지정한 `azrael://threads/01a1334d-6a69-7821-a164-da04f3cfa71f`를 우선한다. 사용자 state metadata에서 paginated/openai인 독립 root를 골라 최대6개를 사용한다. fork/history_base/parent가 있는 세션은 이번 묶음에서 제외해 원본 ancestor를 읽는 오류를 피한다. 추천 세션은 사전 관측에서 JSONL 약424MB,465turn/38634items이며 실행 중 증가할 수 있으므로 실제 실험은 별도 SQLite 읽기 transaction의 projection checkpoint 시점으로 고정한다.

root는 `real-history-snapshot.mjs`의 원본 읽기 전용 snapshot과 전체 결과 통합을 소유한다. real_history_contract는 frozen source의 paginated 저장/로드 계약 및 설치 UI caller만 읽는다. real_history_driver는 `real-session-memory-probe.mjs`만 작성하며 root의 준비 완료 확인 전 실행하지 않는다. 후속 native 비교는 snapshot helper의 count/type/hash/path 검증과 driver syntax 검증에 의존한다. root가 생성물 정리를 소유하며 자식은 재위임하지 않는다.

전체 사용자 DB를 복제하지 않는다. 실제 원본은 `DatabaseSync(readOnly:true)`로 열고, 선택한 threads/dynamic tool descriptors와 해당 history projection의4개 테이블만 새 DB로 옮긴다. schema/migration checksum은 보존한다. `thread_history_projection_state`와 turn/items가 같은 SQLite 읽기 transaction에 있으며, raw JSONL은 그 checkpoint byte offset까지의 완전한 prefix로 복사한다. 서로 다른 두 DB와 로그 파일의 단일 원자적 snapshot이라고 주장하지 않는다. 마지막 newline·길이·SHA256·type분포·count를 확인한다. snapshot의 state rollout_path/cwd는 자기 home/workspace로 바꾸고 project/section 소속을 해제한다. account·credential·config·root reservation·실행 작업 상태는 복사하지 않는다. 본문과 이력 모드는 유지한다.

검증은 추천 세션 단독의 metadata/resume/page/full-read·반복 조회·90초 unsubscribe 후 회수, 새 backend에서1/2/4/6개 누적 로드·조회·회수를 비교한다. page 경로와 compatibility 전체 조회를 구분하며 실제 UI caller가 어느 경로인지 별도 확인한다. MCP는 이전 실험으로 비용을 확인했으므로 이번에는 제거해 이력 비용을 분리한다. 최신 원본 이력 복사본은 한 번 만들고 backend만 재시작해 중복 생성비를 줄인다. 제품 최적화와 새 제품 빌드는 하지 않는다.

이번 관측 시작 시 여유 메모리는 약9.76GiB였다. 실제 수GiB 가설을 시험하기 위해 기존 합성 실험의2GiB 상한 대신 소유 native tree4GiB/시스템 여유3GiB/driver RSS2GiB를 중단 기준으로 둔다. 자원 압박 시 소유 연결과 mock host만 정상 종료하며 사용자 프로세스는 종료하지 않는다. endpoint/PID/생성 시각과 descendant 부재를 검증한다. profile은 `.m/artifacts/p11`, lifecycle은 `run:DJ-01:real-history-r11`로 생성 전에 등록한다. 메시지 본문을 콘솔·보고서로 저장하지 않고 수치·식별자·hash만 보존한다. 원본 복사본은 결과 수용 후 관리 도구로 정리한다.

사전 소규모 SQLite4-thread fixture 검사(`check-real-history-snapshot.mjs`, 자체 lifecycle real-snapshot-unit-r11)는 실제 exit0이다. 이 검사는 schema/BLOB migration checksum 복사, 정확한 projection prefix/hash, type/count, 격리 경로와 project/section 해제를 확인했다. 실제 사용자 본문은 이 사전 검사에 사용하지 않았다.

- 입력: 현 실행 릴리스 w11aa의 receipt와 실행 파일. 엔진 소스는 같은 b13 frozen root. 기존 사용자 상태를 복사하지 않는다.
- native_probe owner: 작업 전용 `native-memory-probe.mjs`, lifecycle `run:DJ-01-azrael-memory-analysis:native-r1`, runRoot `artifacts/tasks/DJ-01-azrael-memory-analysis/runs/native-r1`, 짧은 임시 프로필 `artifacts/tasks/mj1` (사전 부재 확인). Windows socket 길이 제한 때문에 프로젝트 안의 짧은 관리 경로를 사용한다.
- root owner: VS Code 격리 프로필 준비, 실제 renderer/extension-host 측정, 결과 통합 및 cleanup. native 측정과 UI 측정은 같은 호스트에서 순차 실행한다. UI 준비만 병행한다.
- native 비교: MCP 없음(0/1/5/10/20 loaded roots), 실제 Window Use MCP+node_repl(0/1/5/10 roots), 합성 이력 크기별 load/read, unsubscribe 후 loaded count와 자식 보유, 마지막 window owner 종료 후 소유 자식 종료. 실제 API·인증·추론 호출은 하지 않는다.
- UI 비교: 같은 패키지의 별도 user-data/extensions/native state에서 화면 0/1/다수, 숨김/닫기, 가능하면 큰 이력과 자연 GC 대기. 기존 원본 user-profile과 비교하지 않고 격리 baseline 내 차이를 측정한다. 실제 제품 경로와 테스트 한정 계측 차이를 명시한다.
- 안전·자원 조건: 테스트 전용 process identity·경로·생성 시각을 추적한다. 시스템 여유 2 GiB 미만 또는 native 테스트 private 합계 2 GiB 초과 시 확대를 중지한다. 활성 사용자의 프로세스는 종료하지 않는다.
- 초기 준비/캐시 비용과 반복 증가를 구분하고 3회 표본의 중앙값·프로세스 수·loaded count를 함께 제시한다. 사용자 작업의 간섭이 있는 호스트이므로 system free 변화만으로 효과를 판단하지 않는다.
- 이벤트 큐 byte 지표가 기존 바이너리에서 노출되지 않으면 미검증으로 남기고, 느린 소비자/연결 단절의 process-level 반응과 직접적인 queue 누수 증명을 구분한다.
- 완료 기준: 가설별 지지/반증/미검증 판정, 추가 최적화 후보, 실제 exit codes·실험 identity·재현 입력·측정 한계 보존, 생성 프로필/확장/캐시/로그 및 테스트 프로세스 정리 결과 확인. 필요한 작은 근거는 work 기록에 남긴 후 전체 generated group을 관리 도구로 검토/정리한다.

### 측정 관리 경계

공용 catalog.lock은 Windows Restart Manager가 실사용 엔진 PID 61016의 열린 파일로 확인했다. 이를 삭제·변경·우회하지 않는다. 최초 native-r1 시도는 등록 전 exit 1이며 테스트 프로세스나 프로필을 생성하지 않았다.

독립 실험의 등록소까지 격리하기 위해 최초 관리 프로젝트 `artifacts/m`을 만들었다. 생성 전 실제 부재와 주 registry의 ancestor/descendant 소유 기록 0개를 확인했다. 주 프로젝트의 registry·잠금·산출물은 수정하지 않는다. 생성한 control config/registry는 이번 실험 소유이며, 실험 프로필·확장·캐시·로그 제거 후 필요한 작은 실행 근거를 work 문서에 보존한다.

테스트 실행 순서는 native a→b→c→VS Code profile이며, 다른 실사용 작업의 CPU·디스크 경쟁 가능성을 결과 한계로 남긴다.

바이너리의 실제 socket basename은 24 hex 자리여서 처음 계산한 20자리보다 4 bytes 길었다. native-a는 111-byte endpoint 사전 검사에서 중단되었으며 connector/backend 미실행이다. 다음 native-a-r2는 관리 루트 직하 홈을 등록하려 했으나 `recordLifecycle`이 `<root>/artifacts/*`만 허용하여 mkdir·native 실행 전에 exit 1로 종료됐다. managed_roots 설정만으로 이 API 제약을 바꿀 수 있다는 앞선 판단을 정정한다.

현재 관리 루트는 프로젝트 안의 `.m`이다. 생성 전 부재와 주 registry의 중첩 소유 기록 0개를 확인했으며 config는 UTF-8 BOM 없이 만들었다. 상태 홈은 허용 경로인 `.m/artifacts/a,b,c`(native), `d,e`(UI)이다. 실제 24자리 basename 기준 endpoint는 102 bytes로 제한(<108)을 충족한다. 새 native run ID는 `native-a-r3/b-r3/c-r3`이다. 이전 실패 기록은 보존·검토 후 함께 정리한다. 공용 helper의 제품 동작은 변경하지 않았다.

UI 실행은 설치 확장의 복사본과 synthetic native history만 사용한다. 복사본에는 측정용 전역 참조, 가짜 인증 응답, built-in provider 지정을 넣고 외부 Devin CLI 계정 조회를 생략한다. 원본 설치는 변경하지 않는다. 기본 정책 실행 후 별도 새 프로필에서만 idle 지연을 1시간→5초로 줄여 기존 해제·복원 기구를 검증한다. 이 가속 실행은 제품 기본 설정에서의 1시간 실측과 구분한다. PID와 생성 시각을 함께 저장하여 종료 확인 때 고아 자식 프로세스도 확인한다.

추가 사전 실행에서 시작 인수에 따른 endpoint identity 불일치(r3), CIM 생성 시각의 100ns→1µs 절삭(r4)을 발견해 드라이버에서 수정했다. 원래 실패 결과는 유지하고 실제 receipt와 프로세스 정체성에 근거해 소유 backend 종료를 확인했다. r5는 Azrael host의 `model_providers` override 금지로 측정 전에 실패했다. frozen `core/src/config/mod.rs:3833`의 호스트 소유 endpoint/auth 정책을 유지한다. 이후 native는 built-in openai, 무인증, no-turn 방식이며 이력은 offline JSONL replay로 전환했다. UI에도 built-in provider만 지정하고 `turn/start`를 차단한다.

r6에서 roots-0→1 smoke는 통과했으나 unsubscribe 후 loaded count=1이 30초 동안 유지됐다. 이 RPC가 root unload를 수행한다는 초기 실험 가정을 정정한다. frozen app-server의 unsubscribe 구현은 connection subscriber만 제거한다. 이후 matrix의 성공 기준은 unsubscribe 후 상태를 실측하는 것이며 loaded=0을 요구하지 않는다. 마지막 소유 window 종료 시 전체 backend·관측 자식 종료 조건은 유지한다. 이 발견을 fixture 실패와 구분하며 heap leak으로 단정하지 않는다.

## 격리 실측 결과 — native 완료, UI 비교 미검증

| 검증한 가설 | 판정 | 범위와 후속 조치 |
| --- | --- | --- |
| 대화마다 MCP가 선행 시작되어 기본 비용이 커진다 | 지지 | 도구 미호출 상태에서도 10개 대화/20개 MCP. 같은 loaded 수의 차이 298.3MiB. lazy start 후보를 우선 검토 |
| 빈 loaded root 개수만으로 공용 엔진 약4.2GiB를 설명한다 | 이번 조건에서 재현 실패 | MCP 없는 20개 root의 총 native tree는86.6MiB. 실제 root·history·활성 상태는 다를 수 있음 |
| unsubscribe 30초 후 MCP 보유는 unload 구현 누락이다 | 기각 | 기존60초 지연 정책 존재.90초 표본 loaded0/MCP0. 정상 idle 조건만 검증 |
| 단일 큰 이력은 수GiB를 지속 보유한다 | 이번 조건에서 재현 실패 | user8MiB/64턴 replay+read 후113.4MiB. 다수 긴 대화·이미지·실시간 추론 미검증 |
| 숨김 UI가 실제로 회수되지 않는다 | 미검증 | fixture 준비 오류 후 수정했지만 유효 비교 전 여유 메모리 guard로 중단 |
| 이벤트 backlog/추론 중 복사/maintenance metadata가 큰 peak를 만든다 | 소스 후보, 미검증 | queue bytes와 작업별 peak 계측이 필요. 엔진4GiB의 확인된 원인으로 보고하지 않음 |

Windows x64에서 실제 w11aa 엔진과 실제 MCP 실행 파일을 사용했다. 수치는 소유 backend·connector·MCP·자식 프로세스의 Private Bytes 합계에 대한 3회 중앙값이며 드라이버·측정 PowerShell·mock window host는 제외한다. Working Set과 V8 heap을 합산하지 않는다. 다른 사용자 작업과 같은 호스트이므로 cold-start와 스케줄링 변동이 남는다. 모든 성공한 native run은 실제 exit 0과 backend/PID·생성시각으로 추적한 자식의 종료를 확인했다.

| loaded 대화 수 | MCP 없음(MiB) | Window Use+REPL / 대화(MiB) | 실제 MCP 프로세스 수 |
| --- | ---: | ---: | ---: |
| 0 | 55.3 | 50.9 | 0 |
| 1 | 61.5 | 91.8 | 2 |
| 5 | 68.5 | 225.5 | 10 |
| 10 | 75.2 | 373.5 | 20 |
| 20 | 86.6 | 미실행 | 미실행 |

r7의 전체 실행 시간은 2026-10-22 16:35:20.823Z~16:39:17.493Z이다. 대화 10개에서 MCP 유무 차이는 약 298.3MiB다. 두 baseline 차이까지 보정한 MCP pair 증분은 약 30.3MiB/대화다. MCP를 호출하지 않고 대화를 불러오기만 해도 발생한 비용이다. 10개 시점에서 Window Use node 226.5MiB, REPL 27.3MiB, backend 83.2MiB, conhost 등 기타 자식 25.5MiB, connector 11.1MiB가 관측됐다. 각 범주의 중앙값은 총합의 중앙값과 정확히 합치지 않을 수 있다.

MCP가 없는 대화 20개 자체는 약 31.3MiB 증분이다. 따라서 **빈 root 수만으로 실사용 4.2GiB 엔진을 재현하지 못했다.** MCP eagerly started session 비용은 실측으로 지지된다. conhost 증분의 생성 원인은 미확인이다. frozen stdio MCP launcher는 이미 `CREATE_NO_WINDOW`를 사용하므로 그 플래그 누락으로 단정하거나 동일 변경을 권하지 않는다.

### 60초 delayed unload 검증과 판단 정정

추가 소스 조사에서 `thread_lifecycle.rs:20-80,374-407,430-492`의 subscriber/activity watch와 `core/src/config/mod.rs:3972-3980`의 기본 60초 지연을 확인했다. Running/Deferred는 보유 대상이다. 앞선 “unsubscribe는 subscriber만 제거한다”는 사실은 맞지만, 이것만으로 후속 runtime unload 경로가 없다고 해석하면 틀린다.

새 r9에서 idle 대화 1개와 실제 MCP 2개, window owner 2개를 유지했다. unsubscribe 직전 loaded1/MCP2/95.0MiB, 30.025초 후 loaded1/MCP2/94.0MiB, 90.020초 후 **loaded0/MCP0/65.6MiB**였다. metadata-only read는 앞 두 지점에서 idle, 마지막에는 thread-not-loaded였다. 두 창 owner를 닫기 전에 unload가 일어났다. 기존 정상 회수 경로가 동작함을 확인했으며, 30초 보유를 누수로 보는 가설은 기각한다. unload 후 baseline56.3MiB까지 즉시 내려오지는 않았지만 잔류 약9.2MiB만으로 allocator leak을 판정하지 않는다. 마지막 owner 종료 후 전체 소유 프로세스가 종료됐다. r9 실행은 16:48:07.566Z~16:50:35.413Z, exit0이다.

### 이력 크기 실측

서로 다른 fresh backend에 offline JSONL 1/2/4/8턴을 각각 불러왔다. 턴당 user128KiB이며 추론·streaming은 수행하지 않았다. native read가 정확한 턴 수와 completed 상태를 반환했음을 확인했다.

| user 이력 | fresh baseline(MiB) | load+read 후(MiB) | read 응답 bytes |
| --- | ---: | ---: | ---: |
| 128KiB | 57.1 | 85.2 | 263,949 |
| 256KiB | 54.2 | 79.4 | 395,572 |
| 512KiB | 53.4 | 82.1 | 658,818 |
| 1MiB | 55.8 | 92.9 | 1,185,317 |
| 8MiB / 64턴 | 54.6 | 113.4 | 8,556,402 |

작은 범위는 cold-profile 변동이 커서 byte당 보유율이나 선형 기울기를 확정하지 않는다. 추가 8MiB/64턴 r10도 exit0으로 통과했다. 본체 backend는 41.11→89.97MiB, 전체 native tree는54.57→113.41MiB이며 authored JSONL은16,863,891bytes다(동일 user text를 response와 event 양쪽에 표현하는 형식). 합산 resume+read는3,789ms이고 별도 RPC별 시간은 계측하지 않았다. 정확한64개 completed turns를 native read로 확인했으며 freeRAM 최소4.22GiB, 마지막 소유 프로세스 identity snapshot은 빈 배열이었다. 실행 시간은17:07:07.270Z~17:08:36.509Z다. 단일 큰 이력의 비용은 확인했지만4GiB를 재현하지 못했고 여러 긴 root로의 선형 외삽은 미검증이다.

r8 네 case의 전체 시간은16:40:13.567Z~16:47:01.511Z이며 모두 exit0이다. 최종8턴 profile에 작은 completed 대화3개를 추가한 UI seed는 native 종료 후 immutable 상태로 인계됐다. 남아 있는 WAL도 DB와 함께 복사한다.

### 추가 최적화 후보의 근거

- MCP lazy start/공유 가능한 정적 catalog 재사용을 우선 검토할 근거가 생겼다. 다만 REPL state, thread별 권한·workspace·승인 격리를 보존해야 하며 process 공유를 일괄 적용하지 않는다.
- root idle unload를 새로 만드는 제안은 제외한다. 이미 있는 60초 기구의 실제 보류 사유, subscriber 수, Running/Deferred 구분을 관측하는 것이 먼저다. 실사용 50쌍이 정당한 활성 소유인지 UI/연결 보유인지 아직 확인하지 않았다.
- full-history read/resume는 원본 history와 별도 API turn vector를 함께 만들 수 있다. paginated thread에는 `excludeTurns`, `initialTurnsPage`, `thread/turns/list`, `thread/items/list`가 이미 있다. 전체 hydration을 줄이는 데 기존 기능부터 활용할 수 있다. legacy paging은 응답을 줄여도 서버가 전체 rollout을 replay할 수 있어 paginated 저장 형식과 구분해야 한다. 이는 소스 기반 후보이며 절감량 실측은 아직 없다.
- Core/App-server 무제한 이벤트 큐, slow consumer, live inference의 JSON/문자열 transient peak와 사용자 상태의 장시간 누수는 이번 native no-turn/replay 실험에서 검증하지 않았다.

원시 sample·provenance·producer 종료 근거는 `evidence/native-*/`에 보존했다. 일시 프로필은 UI/추가 replay 소비가 끝난 뒤 native maintenance 도구로 검토·정리한다. 실패한 준비 시도의 exit1은 성공 실험으로 바꾸지 않는다.

### UI 드라이버 보정 기록

첫 UI 시도는 복사한 DB의 Windows 확장 경로 접두사(`\\?\`) 소유 검사에서 중단됐다. 두 번째는 초기 inspector context 교체 중 `Promise was collected` 오류와 초기화 전 전역 참조 오류였다. 해당 테스트 창은 자기 inspector의 정상 closeWindow 명령으로 닫았고 driver 실제 exit1을 확인했다. 기존 관측 22개 PID·생성 시각과 현재 profile root·자식을 다시 검사해 남은 테스트 프로세스가 없음을 확인한 뒤 supported closeLifecycle로 failure를 유지했다. 처음 검사에 측정 PowerShell 자신의 command line이 포함된 것도 확인해 sampler 자신과 자식을 제외하고 재검증했다.

세 번째는 baseline만 측정하고 대화 DOM 준비를 너무 일찍 검사해 실패했다. 네 번째는 진단용 DOM을 보존해 `paginated rollout path ... does not have a canonical rollout filename`을 확인했다. path 기반 native replay는 synthetic `.000Z` 파일명을 허용했지만 ID 기반 UI resume는 19자리 timestamp를 요구했다. frozen `rollout/src/rollout_file_name.rs:39-55`를 확인하고 **UI 복사본의 파일명과 DB path만** canonical 초 단위 형식으로 고쳤다. 원본 seed는 변경하지 않았다. 모든 실패를 원인과 실제 exit1로 보존하며 UI RAM 결과로 합산하지 않는다.

다섯 번째는 초기 sample에서 freeRAM<2GiB guard로 exit1 종료했고 모든 소유 프로세스가 종료됐다. 당시 사용자 rustc 약2.95GiB 등이 별도로 실행 중이었다. 테스트 창 종료 후 free4.84GiB를 확인해 작은 native r10을 먼저 순차 실행했다. r10 종료 후3.6GiB, cleanup 등록 검증 중 한 시점4.02GiB로 GUI baseline 약1.35GiB와 추가 panel을 안정적으로 감당할 여유가 부족했다. 다음 UI 실행 전 valid `git init --template=` 경계를 만들고 상위 저장소 자동 탐색을 끄도록 드라이버를 고쳤다. 제품/사용자 설정은 변경하지 않는다. resource guard에 중단된 실행을 UI 절감량 비교에 사용하지 않는다.

### UI 검증 종료 조건과 결과 해석

여섯 번째 UI 실행은 `.m` 정리 잠금과 독립적인 관리 루트 `.u`를 사용했다. 실제 `git init --template=`으로 상위 저장소 자동 탐색을 막았으며, 복사본에만 canonical rollout 이름을 적용했다. 실행은 2026-10-22 17:20:27.445Z~17:21:41.325Z, 실제 exit1이었다. 초기 측정에서 system free<2GiB 보호 기준으로 중단돼 유효 sample/stage가 없었다. 정상 closeWindow 후 모든 관측 PID·생성 시각의 프로세스 종료와 `producerStopped=true`, `processesStopped=true`를 확인했다. 근거는 `evidence/ui-default-6/{producer,result}.json`이다.

5·6회가 같은 자원 조건으로 중단됐으므로 현재 호스트에서 추가 GUI 반복은 종료한다. 기존 사용자의 작업은 종료하지 않는다. hide/dispose/restore의 메모리 차이와 5초로 가속한 idle 해제는 미검증으로 남긴다. 앞선 두 실패 실행의 전체 VS Code baseline 약1.35~1.48GiB를 Azrael 단독 비용이나 정상 대화 UI의 비교값으로 사용하지 않는다. 후속 UI 재실측은 별도 작업 부하가 줄어 충분한 여유 메모리가 확보된 환경에서, 같은 두 대화와 실제 DOM 준비·정상 복원 검증을 포함해 수행한다.

### 임시 자료 정리 결정

모든 성공/실패 native 및 UI 실행의 결과·원시 측정·종료 근거를 `evidence/`에 보존했다. 재현용 driver와 근거는 후속 최적화의 비교 기준으로 보관하며, 대체 검증이 확보되거나 분석 근거 보관이 끝나면 재검토한다. UI 후속 실행은 중단했으므로 c88 seed를 포함한 임시 프로필의 downstream 사용을 해제했다. 제품 설치·사용자 프로필·실제 작업 프로세스는 정리 대상이 아니다.

관리 도구의 첫 `.m` 그룹 `run:DJ-01:ui-default` 삭제 결과는 두 member 모두 `deleted`, `remaining=false`다. `artifacts/m`의 `native-a-r2`도 삭제·부재를 확인했다. 반면 최초 `native-a`의 작은 run/profile은 producer membership과 종료 근거가 불충분하여 defer했다. 지원 절차로 정확한 child 종료 근거와 producer close가 수용될 때 재검토한다. 기존 pending 상태는 수정하지 않았다. 나머지 `.m` 및 `.u` 그룹은 등록·review·명시적 결정·실제 삭제 결과를 별도 cleanup audit에 기록한다. 잠금 제거·강제 삭제·관리 도구 우회는 하지 않는다.

사용자의 continue 후 중단된 비동기 셀을 재조회했으나 기존 셀은 사용할 수 없었다. 소유 자식 agent도 남아 있지 않았다. native registry의 현재 결정과 owner catalog를 대조해 `.m`의 native12개 그룹·UI1/2/3, `.u`의UI6가 이미 삭제된 것을 확인했다. 기존 종료 결과를 새 실행 성공으로 바꾸지 않았다. UI1과UI6은 지원 `finalize`가 member 부재·참조 없음·blocker 없음으로 완료됐다. UI6 비동기 completion은 이 실제 근거로 종료 처리했다. 같은 삭제를 반복하지 않았다.

남은 UI4/5는 아직 등록되지 않은 stopped failure record였고, 독립 보관한 producer 근거의 SHA256이 원래 기록과 일치했다. 기존 잠금이 없는 상태에서 root가 두 그룹의 순차 정리를 인수했다. 내용 등록·review·apply 각각의 실제 결과를 `evidence/cleanup-ui45.json`에 즉시 기록한다. 첫 audit 저장의 PowerShell 인용 오류는 native 작업 전에 exit1로 실패했으며, 새 실행은 직접 파일 쓰기로 보정했다. 재현 driver 두 개의 최종 `node --check`는 각각 exit0이다. 근거 JSON55개도 parse 검사를 통과했다.

### 추가 소스 가설: project-maintenance 자체의 metadata peak

### 최종 정리 결과와 추가 관측

최종 native inventory에서 `.m`17개 그룹/34개 항목, `.u`1개 그룹/2개 항목이 모두 `deleted`, `remaining=false`다. 두 control root의 producer catalog도 각각0개다. 이전 `artifacts/m`의 native-a-r2 한 그룹/한 항목 삭제를 합치면19개 그룹/37개 항목을 삭제했다. 초기 native-a 작은 두 항목의 defer는 유지한다. 관리 config·삭제 receipt와 분석 근거·driver는 검토 가능성을 위해 보관하며, 근거 보관이 종료되거나 대체 검증이 수용되면 각 metadata 소유 절차로 재검토한다. 임시 profile payload는 `.m`/`.u`에 남지 않았다. 결과는 `evidence/cleanup-final.json`이 소유하며 이전 중간 audit의 미완료 표시는 당시 상태를 나타낸다.

UI4는 두 항목 실제 삭제 후 finalize 명령의 여분 괄호 때문에 exit1이었다. 구문만 수정한 supported finalize는 exit0/remaining[]/references[]/blockers[]로 끝났고 복구 결과를 해당 audit에 추가했다. UI5는 등록·review·삭제·finalize가 완료됐으며 실제 finalize exit0이다. 실패를 성공으로 덮거나 삭제를 반복하지 않았다. 마지막 UI5 정리 구간은 2026-10-22 19:18:39Z~20:22:18Z다. 등록 종료는20:18:52Z, 실제 삭제와 finalize 종료는20:22:18Z다. 이 시간에는 호스트 경합과 실행 조율 대기가 포함되므로 순수 알고리즘 처리시간으로 해석하지 않는다.

정리 지연 확인용 추가3회 표본(20:21:40~45Z, sampler exit0)에서 현재 도구 엔진 PID61336은 같은 w11aa 경로, private3136.65~3137.65MiB, WS2221.42~2222.16MiB였다. 약4.46초 동안 CPU는약4.86초 증가했고 시스템 여유 메모리는12.9~13.15GiB였다. 이전4.2GiB 관측의 PID61016과는 다른 프로세스이며, profile 삭제에 따른 절감이나 maintenance 단독 메모리 기여량을 입증하지 않는다. 당시 GUI 중단 조건과 현재 호스트 상태도 다르다. 추가 GUI 재실측은 새 통제 실행으로 분리하며, 이번 UI 검증을 성공으로 변경하지 않는다. 원시 근거는 `evidence/cleanup-engine-samples.json`이다.

### Maintenance metadata 후보의 상세 근거

실사용 엔진이 공용 catalog.lock을 가진 사실은 관측했지만 이것만으로 4.2GiB 원인이라고 판단하지 않는다. 별도 좁은 source review에서 아래 후보를 찾았다. 모두 **소스 기반·RAM 기여량 미실측**이다.

1. `project-maintenance/src/paths.rs:574-620,223-239`는 전체 경로 목록과 entry별 JSON record Vec를 만들고 이를 다시 직렬화한 Vec를 만든다. 파일 본문은 64KiB buffer로 streaming하므로 큰 파일 하나를 통째로 읽는 구조는 아니다. Windows에서는 cache guard가 hit 재사용을 하지 않는데도 operation-scoped digest cache에 각 파일을 삽입한다(`:147,214-217`). streaming hash 직렬화와 쓰이지 않는 Windows cache 삽입 제거를 검토할 여지가 있다.
2. `registry.rs:96-143,250-265,307-318`의 observe는 consistency 확인용으로 전체 catalog를 두 번 materialize한다. 개별 JSON record16MiB 제한은 있으나 총 record 수/bytes 제한과는 다르다. 중복 보유를 줄이는 방향을 검토하되 일관성 검증을 보존한다.
3. `storage.rs:14-20,65-86`는 전체 state manifest를 읽고 parse하며 변경 시 전체 pretty-serialized buffer를 만든다. item/group/run/decision 집합은 커질 수 있다. Store는 per-dispatch이고 inventory 응답 자체는 paging되어 있어 영구 heap 보유라고 단정하지 않는다.
4. ungrouped review의 `related_items`와 handler의 전체 `result.to_string()`은 큰 도구 결과를 만들 수 있다(`lib.rs:698-772`, `core/src/tools/handlers/project_maintenance.rs:425`). group member200 제한은 member 내부 파일 수나 related_items 총량 제한이 아니다. paging·상세 결과 파일 참조 같은 후보를 검토할 수 있으나 실제 session-history 보유와 연결되는지는 미검증이다.

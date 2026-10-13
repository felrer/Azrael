상태: 검증 완료. API·핵심 도구 통과, 컨텍스트 개선 및 VS Code 화면 오류를 보고한다. updater가 잡고 있는 소형 로그만 조건부 보존한다.

# Heretic2 API 검증

목표와 권한: 사용자가 제공한 handoff ZIP과 API 키 파일을 사용해 Windows x64의 VS Code 격리 프로필에서 실제 API 모델 사용, 도구 왕복/제공 범위, 시스템 컨텍스트 비용, 통신과 이력 낭비를 확인한다. 실서버 추론과 별도 프로필/테스트 파일 생성은 승인됨. 제품 수정·일반 프로필 변경·배포·외부 메시지 전송은 범위 밖이다.

대상과 적용 범위: Windows x64 로컬 데스크톱에 한정. Azrael 설치 확장 2026.0.6, w13e engine 0.162.0을 재사용. 기본 시험은 사용자 VS Code 1.140.0, MCP 시험은 기존 독립 실행본 1.138.0. 요청된 범위와 실제 검증 환경을 동일하게 유지하고 다른 OS로 일반화하지 않는다. 제품 코드 변경이 없어 architecture/feature inventory 변경은 불필요하다.

방식과 의존성: handoff 확인/인증 조회 → 직접 API smoke → 실제 설치 확장 복사본과 격리 상태에서 확장 소유 app-server RPC 시험 → 46개 합성 MCP 도구의 deferred 검색/추가/호출 → 컨텍스트·확장 오류·인증값 노출 분석 → 프로세스/fixture 정리. root가 모두 수행했으며 subagent 위임 없음. 원본 사용자 작업과 키 파일을 보존한다.

검증 결과:

- 직접 smoke exit 0, 52.85초. 인증 없는 조회 401, 모델 조회 200/heretic2/262144 context. 일반 응답, auto/required/named 도구 왕복, SSE DONE/usage, 입력+출력 한도 초과 거부 통과.
- 기본 설치 확장 검증은 2026-10-13 13:10:16~13:12:10 KST. 파일 읽기·셸 실행·파일 작성/실내용 비교와 다음 턴 기억 통과. 6개 실서버 요청 모두 200. VS Code exit 0.
- MCP 확장 검증은 2026-10-13 13:19:32에 시작. 46개 도구 중 tool_search로 lookup_probe_marker를 찾고 다음 요청에 추가하여 실행, 프롬프트에 없는 결과를 최종 답변과 다음 턴에서 반영. 4개 요청 모두 200. VS Code/시험 실행 exit 0. thread 준비 및 실행 환경 자원 대기와 추론 시간을 구분한다.
- 설치 확장 경유 총 10개 요청: 2.884~22.246초, 중앙값 7.901초. 기본 첫/마지막 X-Request-ID 조회도 COMPLETED. 모든 생성은 순차, POST 자동 재시도 없음.
- 기본 첫 입력 17100 tokens, context 한도의 6.52%. 시스템 44413 bytes, 도구 15742 bytes. 6개 요청의 시스템 message는 매 요청 1개/같은 hash. 마지막 입력 18019 tokens. 과거 시스템 메시지 누적 중복은 관측하지 않았다.
- MCP catalog는 18→19 tools, 18571→18946 bytes. 큰 합성 catalog 전체 대신 필요한 도구를 추가한다. 과거 검색 스키마의 반복 누적은 관측하지 않았다.
- 제공 도구는 exec_command/write_stdin/apply_patch/view_image, goal·agent 도구이며 MCP 등록 시 resource/discovery 도구가 추가됐다. 파일 읽기/쓰기는 exec_command로 실행했다. 개별 apply_patch·view_image·write_stdin·subagent 전부의 실행 검증을 의미하지 않는다.

확인된 문제와 판단:

1. 스킬 이름 8종이 .azrael-ex/skills와 .agents/skills 두 루트에서 중복 노출됐다. 전체 안내 목록 구간 약 14.2KB. 고정 컨텍스트에 낭비 여지가 있다.
2. API direct function catalog에 functions.exec가 없는데 공통 지침에 사용 안내가 남는다. 실제 alias 목록을 명시하는 마지막 Tool contract가 있어 이번 도구 왕복은 통과했지만 정합성 개선 대상이다.
3. 단순 파일 작업에서 get_goal 추가 호출 1회와 검증 근거 없는 토큰/100k context/없는 newline 설명이 나왔다. 응답 텍스트의 telemetry 주장은 판정 근거로 사용하지 않았다.
4. 두 VS Code 실행본에서 this.getWorkspaceProject is not a function 오류 각각 2회. sendPersistedAtomState/handleMessage 경로. API·엔진 시험 성공과 화면 전체 정상 수용은 구분하며 UI 오류 원인은 미수정이다.

최초 실행 재시도 사유: ELECTRON_RUN_AS_NODE 상속으로 Code exit 9, 해당 변수 제거 후 재실행. MCP 최초 Code 실행은 기존 업데이트 잠금으로 exit 1, 사용자 updater에 개입하지 않고 기존 독립 실행본과 update.mode none으로 재실행. API 미확정 POST 재시도는 없었다. 완료된 기본 Node 시험 오케스트레이터가 VS Code exit 0 이후 남아 있어, 모든 API 응답 완료/fixture 창·엔진 종료를 확인한 뒤 종료했다(오케스트레이터 exit -1). 모델/VS Code 검증 종료 코드와 구분한다.

미검증: 채팅 입력창 조작/전체 화면 렌더링, 장시간 SSE와 중단, 실제 최대 맥락, 부하/429, 모든 외부 connector/모든 native 도구/subagent. 직접 API SSE와 확장 nonstream 수용은 구분한다. timeout 180초/max output 2048/thinking off/parallel tools off 범위. handoff 7200초 권장과 제품 timeout 최대 900000ms의 차이는 장기 생성 후속 점검 대상.

산출물: [결과 보고서](../../artifacts/logs/heretic2-api-20261013/report.md), direct-smoke.json/.log, installed-identity.json, host-result.json, wire-metrics.json, system-context.txt, gateway-request-status.json, extension-errors.json, audit-summary.json. 추가 MCP 증거는 artifacts/logs/heretic2-api-20261013-search/에 보존. 키 노출 검사 24개 파일에서 실제 키 문자열 일치 0, 원본 설치 runtime 설정 비교 일치. 임시 fixture는 artifacts/verification/heretic2-api-20261013 및 -search에 한정해 정리하며 영수증은 cleanup-result.json.

최종 판정: API·핵심 도구 경로 통과, 컨텍스트 최적화 필요, VS Code 화면 오류 존재. 제품 수정은 이번 승인 범위 밖이며 결과와 권고만 전달한다.

종료 정리 근거: Restart Manager로 파일 잠금 원인을 확인했다. 기록된 시험 엔진의 자식인 orphan account helper 32712/57916만 종료했다. 공유 VS Code updater 14148이 보유한 소형 로그는 updater 종료/핸들 해제 후 같은 PowerShell 일반 삭제 대상으로 보존한다. user updater 중단은 하지 않는다. cleanup-result.json과 cleanup-processes.json에 실제 범위와 재제거 조건을 기록한다.

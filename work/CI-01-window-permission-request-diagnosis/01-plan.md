상태: 오류 정보 수정 및 Windows 대상 검사 완료. 설치된 앱 반영은 수행하지 않았다.

# Window Use 권한 요청 오류 정보 수정

## 승인된 범위

대상 세션 `azrael://threads/01a14be5-e9fc-7872-9661-609e7b9c08b2`의 원인 조사 후, 사용자가 다른 제안을 제외하고 오류 정보만 수정하도록 요청했다. 기존 오류 변환 함수를 재사용한다. 제품 권한·재개·단계 전환·UI 및 관련 작업은 변경하지 않는다. 새 의존성은 없다.

공통 JavaScript 오류 정보 변경이며 Windows x64 로컬 Node에서 검증했다. 다른 OS의 실제 실행과 설치 앱 검증은 포함하지 않는다. 기존 architecture/window-use.md의 알려진 복구 오류 분류 계약을 바로잡는 수정이므로 계약 변경이나 별도 설계 문서 수정은 필요하지 않다.

## 확인된 원인

원본 기록은 `C:/Users/felre/.azrael-ex/sessions/2026/10/18/rollout-2026-10-18T07-05-22-01a14be5-e9fc-7872-9661-609e7b9c08b2.jsonl`이다. 1577행에서 paused/user_stopped가 확인됐고, 1618·1626행에서 권한 요청이 미분류 오류로 끝났다.

`request_stage`는 중지 상태에서 승인 호출 전에 `User stop requires explicit resume`를 반환한다. 이 문구가 기존 오류 분류에서 누락됐다. 현 소스와 설치본 2026.0.10의 외부 입력 없는 메모리 재현에서 2/4단계 모두 같은 오류였으며 승인 함수 호출은 0회였다. 실제 중지가 버튼·단축키·대화 중단 중 어디서 왔는지는 확인하지 않았다.

## 변경과 검증

- scripts/window-control-errors.cjs: 정확한 중지 문구를 state_changed로 변환하고 한국어 재개 안내, pauseReason:user_stopped, recovery:user_resume, restoreAllowed:false, actionExecuted:false를 전달한다. 나머지 오류 분류 및 알 수 없는 내부 오류 fallback은 유지한다.
- scripts/test-window-control-errors.cjs: MCP 결과에 재개 안내와 메타데이터가 전달되고 직렬화 왕복에서 보존되는 회귀 검사를 추가했다. 알 수 없는 내부 실패가 계속 숨겨지는 것도 확인한다.
- 실행: `node --test --test-name-pattern 'user stop|recovery instructions|tool errors retain|minimized pause metadata' scripts/test-window-control-errors.cjs`
- 결과: Windows에서 4개 통과, 실패 0, 실제 exit code 0. 오류 직렬화·MCP 전달·기존 복구 정보와 최소화 메타데이터 검증 범위다. 디스크 fixture나 별도 실행 로그를 생성하지 않았고 결과를 이 문서에 보존한다.

성공 기준인 일반 미분류 오류 제거 및 구체적인 재개 안내 전달을 소스 경계에서 확인했다. 권한 차단을 성공으로 위장하거나 사용자 중지를 해제하지 않는다. 빌드·패키징·설치·다른 세션 제어는 수행하지 않았다. 다른 작업의 기존 staged/unstaged 변경은 보존하고 본 작업의 코드·검사·기록만 커밋한다.
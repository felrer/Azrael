상태: 소스·설치 모듈 fixture 검증 완료 — 추가 요청 허용은 등록된 2026.0.6에 포함되어 기존 창 재로드가 필요함. 신규 중단 버튼은 별도 빌드·설치가 필요함.

# Capacity 실패 뒤 같은 세션 추가 요청

- 목표/권한: capacity 실패 및 자동 재시도 중단 이후 같은 세션에 사용자의 새 요청/계속 요청을 보낼 수 있도록 확인·보완. 전체 앱 빌드·설치 지시는 없음.
- 기존 결정: 이전 01-plan.md의 중단 버튼·수동 retry·플랫폼 범위 유지. Windows x64/Linux x64/macOS ARM64 공통 host/UI 정책이며 실제 검증은 Windows fixture.
- 근거: 사용자 thread의 rollout terminal error는 structured server_overloaded이며 host 로그는 systemError/failed를 other로 분류하여 terminal_state_not_admitted로 차단함. 해당 창의 엔진 PID 58172(parent host 38388)는 w06-all-20261011-r5, frozen source win06-integrated-r2. 설치된 2026.0.5 recovery-state는 서버 오류 허용 규칙이 없고 2026.0.6/current source는 있음. 현재 창의 정확한 host module은 로그에 없어 추정 범위를 넘기지 않음.
- 재사용: 현재 recovery-state.cjs의 structured serverOverloaded admission과 일반 신규 instruction start route를 그대로 사용한다. 최신 소스에 동일 기능을 중복 구현하지 않는다. 이전 UI 중단 기능이 일반 start/steer를 막지 않음을 통합 검증한다.
- 수행: owning UI/recovery 계약에 중단 이후 신규 input 의미 명시 → UI 실제 transformed CNi와 RecoveryState 연결 검사, pinned bridge의 capacity 후 계속/신규 input 전달 검사 → 기존 recovery/stop 회귀 → 작업 커밋.
- 성공: 같은 세션에서 중단 후 계속과 임의 신규 text/attachment/model 요청을 한 번씩 정확히 전송; 옛 timer callback은 추가 요청을 만들지 않음; active 상태 steering 및 unresolved receipt guard 유지. live provider·installed window는 업데이트/재로드 이후 별도 확인.
- 기존 진단 inspector의 최신 2000개 이벤트는 주로 thread/read 조회라 차단 이벤트를 포함하지 않았음. 정확한 소유 host log의 UUID·event·상태 필드만 추가 필터해 차단을 확인했으며 사용자 payload는 작업 문서에 복사하지 않음.


## 결과와 검증

- 제품 로직 추가는 필요하지 않았다. 기존 `scripts/recovery-state.cjs`의 structured serverOverloaded 허용 규칙을 재사용했고, 중단 버튼의 same-session 신규 입력/계속/steer 경로와 pinned host bridge 전달 검사를 보강했다. 일반 오류에 대한 admission을 넓히거나 안전장치를 제거하지 않았다.
- `node --test scripts/test-capacity-retry-stop.cjs scripts/test-recovery-state.cjs scripts/test-recovery-bridge.cjs`: 342/342 통과, exit 0, 31.94초. 로그 `artifacts/logs/capacity-retry-stop/followup-tests.log`. 새 지시의 본문·image input·모델·clientUserMessageId 보존, 계속 요청 1회 전달, 중단 timer 재전송 없음, 기존 active attachment/steering 및 unresolved guard를 확인했다.
- 등록 정보 `~/.vscode/extensions/extensions.json`은 Azrael 2026.0.6을 가리킨다. 등록된 모듈 `azrael-ex-local.azrael-2026.0.6/out/recovery-state.cjs`로 synthetic systemError/serverOverloaded fixture의 계속/새 지시 2개 확인, exit 0. 로그 `artifacts/logs/capacity-retry-stop/installed-admission-fixture.log`. 전체 설치본 수용/실제 사용자 창 재개/모델 가용성 검증은 아니다.
- 진단 요약: `artifacts/logs/capacity-retry-stop/followup-diagnosis.json`. payload를 포함하지 않는 진단 필드만 보존했다. 기존 inspector 출력의 불필요한 2000-event 파일과 임시 plan body는 삭제했다.
- UI 렌더 코드·표현은 바뀌지 않아 01-plan.md의 light/dark·narrow·keyboard 검증을 재사용했다. 테스트 파일의 혼합 줄바꿈은 기존 동일 구간 바이트를 유지하고 새 줄만 LF로 정리, diff --check 통과. 추가 앱 빌드/설치, 사용자 세션 취소, 데이터 수정, 사용자 창 강제 재로드는 하지 않았다.

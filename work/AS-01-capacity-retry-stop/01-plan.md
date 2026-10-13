상태: 소스 구현·검증·정리 완료 — 설치된 앱 반영은 전체 빌드·설치 지시가 필요함.

# Capacity 자동 재시도 중단

- 목표/권한: capacity 오류 카드에 자동 재시도를 멈추는 버튼 구현·검증. 전체 앱 빌드·설치는 별도 지시 범위.
- 범위: Windows x64, Linux x64, macOS ARM64 공통 pinned UI 동작. 실제 검증은 Windows의 소스 fixture와 Chromium 밝은/어두운 테마. 다른 OS 및 설치 창은 미검증.
- 근거: pinned app-initial-c014f9ee4429.js의 SNi는 최신 failed turn에 CNi를 표시하며 CNi의 타이머가 COe(capacity_retry_automatic)를 보낸다. 엔진 수정 없이 기존 수동 retry, 소유자 admission, 중복 요청 guard를 재사용한다.
- 동작: 카운트다운 옆 재시도 중단 버튼으로 해당 실패 응답의 자동 요청을 차단한다. 같은 카드 재마운트에도 중단을 유지하고 수동 다시 시도는 제공한다. 이미 전송된 요청의 취소는 기존 composer Stop 동작 범위다.
- 소유: root가 scripts의 guarded UI transform, native timer 동작 검사, 렌더링 검사, UI 계약과 feature inventory를 수정한다. 기존 다른 작업 변경은 보존한다.
- 순서: UI 계약 갱신 → transform/타이머 중단 → fake clock 행동 검사 및 통합 parse → native React/CSS 양 테마 렌더·버튼/키보드 → 검증 기록/작업 커밋.
- 성공 조건: 중단 후 시간 경과/남은 callback/재마운트가 자동 요청을 보내지 않음, 다른 thread는 영향 없음, 수동 재시도와 기존 native guard 보존, 밝은/어두운 테마·좁은 폭에서 조작 가능.


## 검증과 정리

- Windows source: `node --test scripts/test-capacity-retry-stop.cjs scripts/test-immediate-stop.cjs scripts/test-thread-branch.cjs` 26/26, exit 0, elapsed 61.65초. 로그: `artifacts/logs/capacity-retry-stop/source-tests.log`.
- 추가 실패 처리 검사 후 `node --test scripts/test-capacity-retry-stop.cjs` 5/5, exit 0, elapsed 107.78초. 로그: `artifacts/logs/capacity-retry-stop/capacity-tests.log`. 실제 transformed CNi의 fake clock/상태/콜백 검증이며 타이머 중단, 재마운트, 다른 turn/host/thread, 수동 요청, 중복 admission 및 재시도 실패 후 수동 복구를 확인함.
- `node scripts/verify-capacity-retry-render.mjs`: native React/button/card/CSS의 light/dark 9개 검사 통과, exit 0. host·localization·timer는 synthetic fixture. 로그/스크린샷: `artifacts/logs/capacity-retry-stop/render/summary.json`, `light.png`, `dark.png`, `narrow.png`. screenshot 직접 확인함.
- 렌더링 첫 실행은 fixture의 `Tme` context 누락으로 실패해 host adapter를 보완함. 다음 실행은 UI 검사 통과 후 브라우저 종료 확인 10초 제한 때문에 exit 1이었으며, 실제 프로세스 종료 확인·정리 후 대기 30초와 PowerShell 정리를 적용해 다시 실행, 최종 exit 0. 제품 수정 재실행이 아닌 검증 환경/정리 보완임.
- injector/render/namespace `node --check` exit 0. feature registry와 transform rules 검증 exit 0: `artifacts/logs/capacity-retry-stop/registry.log`. 최종 metadata 변경은 rule 등록/필수 count와 architecture 상태 표시만이며 이전 통합 parse 결과를 재사용함.
- 작업 소유 browser가 종료되고 `artifacts/verification/capacity-retry-ui`의 부재를 확인함. pristine UI는 변경하지 않음. 앱 전체 빌드·패키징·설치 및 live capacity provider 요청은 수행하지 않음. Linux/macOS native 미검증.

상태: 구현·검증 완료 — 승인된 임시 보관 5개 묶음 유지, 사용자 추가 조치 없음.

# 모드별 평균 전역 설정

## 결과와 한계

### 정리 대기

후속 batch PID 36172 / native owner PID 31600이 10분 후에도 실행 중이다. 등록 중 잠금 경합으로 첫 두 run에 예약이 남아 있어 해당 owner 종료 근거와 `recover_reservation` 절차가 필요하다. 실제 보호를 우회하지 않는다. 사용자가 아래 5개 묶음을 별도 batch 종료 후 안전하게 삭제하는 조건으로 임시 보관하고 이번 변경을 커밋하도록 승인했다. 현재 남은 작업은 task-only commit이며 보관 예외를 유지한다.

총 228,615,429 bytes(약 218.0 MiB), 5개 run이며 사용자 실제 프로필은 포함하지 않는다. 해제 조건은 별도 batch 종료 및 exact reservation 복구·fresh owner review 통과다.

| 용도 | 정확한 프로젝트 상대 경로 | bytes |
| --- | --- | ---: |
| 초기 실패 렌더 fixture/profile | `artifacts/tasks/verify-context-compaction-render/runs/20261029T154838052Z-433c1dc2-efeb-4163-a041-90ede9e80c23` | 57,011,667 |
| 초기 실패 렌더 fixture/profile | `artifacts/tasks/verify-context-compaction-render/runs/20261029T154919312Z-8c66b671-9fa0-495e-9339-440d921a9c82` | 57,497,443 |
| 격리 엔진 상태 | `artifacts/tasks/mode-averages-native/runs/20261029T154942964Z-801c6fb4-6327-4579-a609-5dc40200a872` | 1,287,568 |
| 통과 렌더 fixture/profile | `artifacts/tasks/verify-context-compaction-render/runs/20261029T155013712Z-e8766ebf-43fd-4b82-a467-a76b18d04abf` | 57,454,374 |
| 기존 설정 회귀 fixture/profile | `artifacts/tasks/verify-provider-context-render/runs/20261029T155313556Z-486639be-ab8b-4e4d-9c13-4b3fa22be7b0` | 55,364,377 |

위 경로의 root는 `C:/Users/felre/Desktop/pi-harness-init`이다. 아래 5개 묶음의 임시 보관은 사용자에게 승인되었다. 별도 batch 종료와 exact reservation 복구·fresh owner review 통과 후 삭제하며, 범위나 조건이 바뀌면 재검토한다. 일반 사용자 프로필·설정은 보관/삭제 범위에 포함하지 않는다.

정리 의존성: 별도 `EC-01` 작업의 연속 maintenance 작업 때문에 등록이 `OS lock busy`로 거부되었다. Node PID 29668의 180초 대기는 시간 초과했으며 이후 실제 종료 신호를 확인했다. 후속 batch PID 36172가 같은 잠금을 계속 사용한다. 종료 후 검증된 owner로 예약 복구·등록·검토·삭제를 수행한다. 실패한 등록이 남긴 첫 번째 렌더 run의 예약(PID 21424)과 두 번째 렌더 run 등록 실패(PID 16752, 실제 exit 1)를 먼저 확인해야 한다. 기능 검증은 끝났으며 사용자가 승인한 보관 예외로 커밋을 진행한다. 다른 작업의 프로세스·잠금은 변경하지 않는다.

- `node --test scripts/test-provider-context.cjs`: 25/25, exit 0, 약 67초. 기존 model picker 36개는 초기 결합 실행에서 모두 통과했고 해당 입력은 변경하지 않았다. 초기 provider-context 2개 실패는 메모이제이션·렌더 자식 순서 회귀를 수정한 뒤 전체 25개 재검사로 해소했다.
- `verify-context-compaction-render.mjs`: exit 0. light/dark에서 기본 on·키보드·공통 값 유지·저장 실패·포커스 재조회, 360/474/1000px 및 기존 자동 압축 동작을 확인했다. 밝은/어두운 474px 스크린샷을 직접 확인했다.
- `verify-provider-context-render.mjs`: exit 0. 기존 설정 저장·실패·모델별 기본값과 light/dark·좁은 폭 보존을 확인했다.
- `node --test scripts/test-namespace-cache-owner.cjs`: 7/7, exit 0. 자동 정리된 fixture의 실제 부재를 확인했다.
- 실제 설치된 `w13r-99afefb1/engine/azrael.exe`를 격리된 `CODEX_HOME`에서 두 번 실행했다. 제품 저장 소유자를 사용해 기본 on→off 저장→재시작 off 복원→on 저장을 검증했다. 두 엔진 종료 코드 모두 0이며 사용자 실제 설정은 수정하지 않았다.
- 초기 관리 도구 실행은 10초 제한으로 exit 124여서 직접 실행의 실제 종료 결과를 사용했다. 렌더 fixture의 초기 lazy 초기화/옛 대화별 off 기대값은 수정 후 재실행했다. 다른 작업의 catalog/maintenance 잠금 경합으로 시작·종료 기록과 정리를 재시도했으며 잠금을 제거하거나 우회하지 않았다. 실패 상태는 보존한다.
- 영속 검증 요약: [verification.json](verification.json), [final-verification.json](final-verification.json). 제품 빌드·설치 및 Linux/macOS 실제 실행은 수행하지 않았다. 현재 설치 UI에는 별도 빌드·설치 후 반영된다.

사용자 요청: 기본 on, 엔진 저장, 세션·프로젝트 공통 적용. 소스와 검증이 범위이며 제품 빌드·설치는 별도다.

공통 대상은 Windows x64/Linux x64/macOS ARM64이며 실제 검증은 Windows다. 기존 `desktop` UI 설정과 `config/read`, `config/value/write`를 재사용한다. `desktop.azraelModeAveragesEnabled`를 사용자 레이어에서만 읽고 미설정이면 true로 사용한다. 기존 대화별 값은 메모리 상태여서 이관이 필요 없다. 같은 클라이언트 구독자가 공유하고 대화 변경·포커스 복귀에 재조회한다. 저장 중 중복 변경을 차단하고 실패 시 확인된 값을 유지하며 오류를 표시한다. 그래프 계산과 대화별 자동 압축은 보존한다.

root 단독으로 소유자→UI→기존 테스트/렌더 fixture→검증→정리·작업 커밋을 수행한다. 기존 동시 변경을 보존한다. 소유자 테스트로 기본/저장/새 소유자 복원/프로젝트 override 무시/실패 경계를 검증하고 Windows native React/CSS light/dark·키보드·대화 변경·재mount를 검사한다. 실제 엔진 격리 RPC로 저장·재시작을 확인한다. 기존 ui.provider-context 보존 연결을 유지한다. 일회성 산출물은 기존 소유자로 정리하고 결과를 이 문서에 요약한다.

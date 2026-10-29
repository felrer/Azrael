상태: 구현·검증·소스 커밋 완료 — 승인된 임시 보관 예외 3개 묶음(약 109MiB), 정리 후속 필요.

# 모드별 평균 전역 설정

## 목표와 범위

사용자 요청대로 모드별 평균 표시 기본값을 켜고, Azrael 엔진 사용자 설정에 저장해 세션·프로젝트에서 공유한다. 소스 수정·검증·커밋이 범위이며 제품 빌드·설치는 수행하지 않았다.

공통 대상은 Windows x64/Linux x64/macOS ARM64이며 실제 검증은 Windows x64다. 기존 `desktop` UI 설정과 `config/read`, `config/value/write`를 재사용한다. `desktop.azraelModeAveragesEnabled`를 사용자 레이어에서만 읽고 미설정이면 true로 사용한다. 기존 대화별 값은 메모리 상태여서 이관이 필요 없다. 같은 클라이언트 구독자가 공유하고 대화 변경·포커스 복귀에 재조회한다. 저장 중 중복 변경을 차단하고 실패 시 확인된 값을 유지하며 오류를 표시한다. 그래프 계산과 대화별 자동 압축은 보존한다.

## 구현과 검증

- 소스 커밋: `dbf2a89b4a7871f7e1f9fd598631d9102bc9339a`. 다른 작업의 변경과 기존 스테이징을 보존했다.
- `node --test scripts/test-provider-context.cjs`: 25/25, exit 0, 약 67초. 기본/저장/새 소유자 복원/프로젝트 override 무시/실패/저장과 조회 경합을 검증했다. 초기 회귀 2개는 수정 후 전체 25개 재검사로 해소했다.
- 기존 model picker 36개는 초기 결합 실행에서 모두 통과했으며 해당 입력은 변경하지 않았다. 최초 관리 도구 실행은 10초 제한으로 exit 124여서 직접 실행의 실제 종료 결과를 사용했다.
- `verify-context-compaction-render.mjs`: exit 0. native React/CSS light/dark에서 기본 on·키보드·공통 값 유지·재mount·저장 실패·포커스 재조회, 360/474/1000px와 기존 자동 압축 동작을 확인했다. 밝은/어두운 474px 스크린샷을 직접 확인했다.
- `verify-provider-context-render.mjs`: exit 0. 기존 설정 저장·실패·모델별 기본값과 테마·좁은 폭 보존을 확인했다.
- `node --test scripts/test-namespace-cache-owner.cjs`: 7/7, exit 0. 자동 정리된 fixture의 실제 부재를 확인했다.
- 실제 설치된 `w13r-99afefb1/engine/azrael.exe`를 격리된 `CODEX_HOME`에서 두 번 실행했다. 제품 저장 소유자로 기본 on→off 저장→재시작 off 복원→on 저장을 검증했다. 두 엔진 종료 코드 모두 0이며 사용자 실제 설정은 수정하지 않았다.
- 영속 검증 요약: [verification.json](verification.json), [final-verification.json](final-verification.json). Linux/macOS 실제 실행과 설치 UI 반영은 미검증이다. 현재 설치 UI에는 별도 빌드·설치 후 반영된다.

## 정리와 승인된 보관

사용자는 최초 검증용 5개 묶음 약 218MiB를 별도 정리 작업 종료 후 안전하게 삭제하는 조건으로 임시 보관하고 소스를 커밋하도록 명시적으로 승인했다. 외부 작업의 실제 종료 후 지원 owner로 등록 실패 예약 2개를 복구하고, 5개 묶음 등록과 `registered` 검토를 완료했다. 검토 당시 모두 소비자·참조·보호 blocker가 없었다.

같은 owner의 일괄 삭제는 native PID 46952 / exit 1 / Windows `os error 33`으로 실패했다. 오류에는 잠긴 파일 경로가 없었고, 같은 시점 별도 EQ-01 maintenance 실행이 확인됐다. 정확한 잠금 대상·원인은 특정되지 않았다. 삭제 worker의 Job containment/종료 경계, 실제 native 종료와 현재 PID/자식 부재를 확인했다. 강제 삭제나 잠금/registry 우회는 하지 않았다.

실제 경로 확인 결과 2개 run은 부재이고 3개 run에 114,149,388 bytes(약 108.9MiB)가 남았다. 남은 경로는 사용자 승인 범위의 부분집합이다. 5개 native 삭제 예약과 pending intent는 후속 owner 복구·재검토가 필요하며, registry 정리 완료로 주장하지 않는다. 독립적인 검증 요약과 복구 근거는 생성물 밖에 보존했다.

현재 보관 경로(root: `C:/Users/felre/Desktop/pi-harness-init`):

| 용도 | 프로젝트 상대 경로 | bytes |
| --- | --- | ---: |
| 실패 렌더 fixture/profile | `artifacts/tasks/verify-context-compaction-render/runs/20261029T154919312Z-8c66b671-9fa0-495e-9339-440d921a9c82` | 57,497,443 |
| 격리 엔진 상태 | `artifacts/tasks/mode-averages-native/runs/20261029T154942964Z-801c6fb4-6327-4579-a609-5dc40200a872` | 1,287,568 |
| 기존 설정 회귀 fixture/profile | `artifacts/tasks/verify-provider-context-render/runs/20261029T155313556Z-486639be-ab8b-4e4d-9c13-4b3fa22be7b0` | 55,364,377 |

잠금 해제 후 exact owner/worker 종료 및 예약 fence를 다시 검증하고 지원 `recover_reservation`→fresh review/reconcile→ordinary owner 삭제를 수행한다. 이미 부재인 2개와 남은 3개를 구분하고 실제 부재 확인 후 lifecycle을 finalize한다. 기존 승인 범위와 조건이 유지되는 동안 보관 승인을 재요청하지 않는다. 상세 결과와 후속 입력은 [cleanup.json](cleanup.json), 현재 보관 범위는 [retention.json](retention.json), native 복구 영수증이 참조하는 독립 종료 근거는 `reservation-stop-0.json`, `reservation-stop-1.json`이 소유한다.

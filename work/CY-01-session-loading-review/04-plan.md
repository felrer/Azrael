상태: 최신 설치본의 native RPC·기존 trace 범위 재측정과 임시 산출물 정리 완료. 추가 제품 구현·build·설치는 수행하지 않았다.

# 최신 설치본 세션 복원 재측정

## 범위와 방법

- 대상: `01a1334d-6a69-7821-a164-da04f3cfa71f`. 원본을 읽기 전용으로 조사하고 대상 rollout과 필요한 DB 행을 격리 사본으로 고정한다. 자동 실행 queue·goal·resume 예약·credentials는 사본에 넣지 않는다. 원본에는 쓰지 않는다.
- Windows x64 설치본 Azrael 2026.0.12의 실제 실행 파일 identity를 확인한다. 공통 최적화의 판단 근거로 쓰되 Linux/macOS나 UI 첫 표시를 검증했다고 주장하지 않는다.
- initialize, metadata, cold engine resume, warm resume, recent turns/items를 측정한다. 같은 고정 입력과 각기 새 프로필을 사용하고 OS cache와 engine warm 상태를 구분한다. 내부 계측이 필요한 경우 설치 source와 일치하는 임시 계측 사본만 사용하며 설치본 시간과 별도로 보고한다.
- 성공 기준: 실제 응답·오류·exit·남은 소유 프로세스·예상 밖 turn/network를 확인하고, 겹치는 span을 합산하지 않는다. 모델 turn/tool을 시작하지 않는다.

## 소유권·실행 의존성

소유자 `CY-01-session-loading-review`, 실행 group `CY-01-resume-profile-r2`, 경계 `artifacts/tasks/CY-01-session-loading-review/runs/20261025-resume-profile-r2` 아래 inputs/temporary/logs/reports만 생성했다. 상하위 producer/native claim 충돌은 확인되지 않았다. 잠금 삭제 이벤트를 관찰하고 lifecycle 등록 성공 뒤 payload를 생성했다. 원본·설치·공유 source/cache는 생성물 소유 범위가 아니다.

설치 확인 및 읽기 전용 schema 조사는 등록 대기와 독립이다. 사본 준비 후 실제 installed engine 측정을 먼저 실행한다. 내부 계측 compilation은 정확한 input/cache 조건과 필요성이 확인된 경우에만 한다. 상세 실행 증거를 독립적인 작은 JSON으로 이 작업에 보존한 뒤 임시 사본·로그·프로세스를 정리하고 실제 결과를 기록한다.

## 이미 확인한 입력

현재 rollout은 441,373,260 bytes로 이전 약 360MB와 달라 동일 입력 전후 개선율을 산출하지 않는다. 설치 runtime은 `artifacts/workspaces/h/artifacts/releases/w13r-99afefb1`, frozen source는 `artifacts/inputs/dm01-w13r/project/engine`이다. DB들 간 snapshot과 rollout 복사가 단일 원자적 transaction이 아님을 기록하며 대상 revision 변화를 확인한다. 공유 checkout의 다른 작업 변경과 staged 파일을 보존한다.

## 2026-10-25 실행 준비 결과와 대기

설치 engine SHA256 `8015338b3f3f3f958e8b154d6175d2bce6497d51313e7be6e8e83998fdd7beca`는 설치 receipt와 일치한다. 기존 trace에는 session_init 등의 span이 있지만 read/decode/reducer 각 시간의 완전한 구분은 아직 확인되지 않았다.

Lifecycle 등록 producer(session 19816)는 catalog.lock 해제를 10분 기다린 뒤 exit 1로 종료했다. 등록·격리 payload 생성·복원 측정은 수행되지 않았다. 잠금 생성 시각은 2026-10-25T04:53:25.6020383Z이며, 그 시각 시작된 별도 DM-01 cache retirement 작업 `owner-call.cjs old-copy-apply apply`의 node PID 73596 / parent 49572가 관찰됐다. 이 사실만으로 잠금 소유나 작업 성공을 확정하지 않는다. 원본·잠금·다른 작업을 변경하거나 종료하지 않았다.

읽기 전용 watcher의 runtime work completion `47544d70-1bc6-4280-b751-8ff16a6cd590`은 잠금 경로의 실제 삭제를 관찰해 성공·exit 0으로 종료했다. 이 결과는 다른 cleanup 작업 성공을 의미하지 않는다. 이후 등록 성공을 확인하고 fixture를 준비했다. 관리 잠금 대기는 아래 복원 성능에 포함하지 않는다.

## 계측 조건과 fixture 보정

실제 설치 registry도 `2026.0.12`를 선택한다. 새 계측용 엔진을 build하지 않고 설치본의 기존 JSON trace와 RPC monotonic wall time을 재사용했다. rollout SHA256은 `160570334ef7b724ae4408413b7d8c7c20a4d6d5d896fe494abf4a915c5f7409`, 441,373,260 bytes·164,704행이다. 복사한 projection에는 502 turns·40,040 items가 있다. DB quick_check는 모두 ok였다.

격리 계정은 유효한 signed-out selection, credentials 복사 없음, explicit MCP 없음, `apps=false`다. 자동 queue·accepted input·goal·parent wait·root resume 예약은 사본에서 제외했다. rollout에는 host approval ledger event가 없었다. inherited 계정/rendezvous 환경을 제거하고 독립 git project 경계를 만들었다. provider/plugin HTTP 연결은 로컬 거부 proxy로 보내 각 성공 실행의 CONNECT 시도 5건을 차단했다. network 시도 0건으로 해석하면 안 된다. turn 명령·server request·unexpected turn/started는 0건이었다.

첫 시도는 reserved `openai` provider override가 거절됐고 다음은 `requiresRecovery=true`가 resume 자체를 거절했다. 두 runner는 exit 1, engine은 exit 0이며 성공 측정으로 계산하지 않았다. 이후 유효 signed-out selection과 내장 provider를 사용했다.

초기 대상-only DB 사본에서 global `backfill_state`·`rollout_migration_state` 완료 표시를 빠뜨려 initialize가 18.4–21.7초였다. 원본의 두 marker를 읽기 전용으로 보존한 seed revision 2에서는 331–361ms였다. 초기 두 성공 실행(`baseline3`,`baseline4`)도 기준 집계에서 제외했다. 이 차이는 fixture 보정이며 제품 최적화 효과가 아니다.

## 기준 결과 — 새 프로필 3회

| 구간 | 중앙값 | 범위 |
| --- | ---: | ---: |
| 엔진 시작 → initialize 응답 | 346ms | 331–361ms |
| metadata read | 174ms | 173–203ms |
| 새 엔진의 thread/resume 전체 | 22.745초 | 21.217–24.452초 |
| 위 복원 중 전체 rollout read/decode | 21.460초 | 19.896–23.121초 |
| session_init 시작 → 전체 로더 시작 | 442ms | 408–529ms |
| 전체 로더 반환 → session_init 종료 | 589ms | 526–612ms |
| 같은 엔진의 재복원 | 18.9ms | 17.5–23.5ms |
| 최근 20 turns | 14.9ms | 12.0–16.3ms |
| 최신 turn의 items (6개) | 6.4ms | 6.2–7.5ms |
| 모델 목록 API 응답 | 5.1ms | 4.2–5.5ms |

각 cold resume에서 전체 로더 trace는 1회, 164,704 items·parse error 0이었다. 전체 read/decode가 RPC wall time의 **93.8–94.6%**다. cold 전후 engine CPU 증가량은 20.2–23.0초로 wall time과 가깝고 peak working set은 약 732–738MB다. CPU 처리 비용이 주요 후보임을 뒷받침하지만 raw I/O와 개별 decoder 비중을 직접 측정한 값은 아니다.

내부 persistence는 7.5–15.5ms, auth/MCP projection은 1.3–2.2ms로 병렬 실행됐다. plugin/skill warmup은 351–445ms, MCP manager init은 0.7–1.1ms였다. 중첩·병렬 span은 합산하지 않는다. 이 값은 signed-out·제한된 설정 조건이며 로그인한 실제 MCP/모델 준비 시간을 뜻하지 않는다.

JSON syntax parse와 typed decode는 분리하지 않았다. read/decode span은 전체 read, JSON Value 파싱, canonical typed decode, Vec 구체화를 합친다. post-load 구간은 질문·승인 reducer, Vec 해제, 초기 history/receipt 정리를 포함한 합산 구간이다. OS cache는 flush하지 않았고 사본 복사로 warmed 상태다. 성능 측정 중 Cargo/rustc/link 실행은 관찰되지 않았다. webview 첫 표시·입력 가능 시각, 로그인 상태의 MCP 준비, Linux/macOS 수용은 검증하지 않았다.

추가 새 프로필 1회에서는 **resume 전에** 최근 20 turns가 318.8ms, 최신 turn의 6 items가 6.0ms에 반환됐다. 이후 cold resume 17.525초·warm 15.4ms였다. 선표시용 native API의 사용 가능성을 보이며 UI 첫 paint를 검증하지 않는다. 이 단일 실험의 cold 시간 차이를 선조회 효과로 해석하지 않는다.

## 최적화 우선순위 갱신 — 구현 전 제안

1. **최적화 build 비교 실험을 우선 추가**한다. 해당 배포의 `engine.log`는 `Finished dev profile [unoptimized + debuginfo]`와 기본 Cargo build 명령을 기록한다. 실제 설치 hash는 그 배포 receipt와 일치한다. 현재 CPU 비중이 큰 전체 decoder 비용에 영향을 줄 가능성이 크다. release/최적화 profile의 동일 fixture·동일 기능·최종 상태 비교 및 mandatory 검증을 권고한다. 이번에는 build나 개선율을 측정하지 않았다. 앞선 정적 분석에는 반영하지 못했던 빌드 조건이다.
2. **복원 상태 checkpoint + 검증된 tail replay**는 로그 크기 의존을 줄이는 구조적 후보로 유지한다. 최적화 build만으로 O(전체 기록)은 없어지지 않는다. 질문·승인·accepted input의 동일 상태와 오류 검출·fork·revert·crash 의미를 보존하는 기존 제안을 따른다.
3. **최근 대화 선표시**의 가능성이 구체화됐다. native paging은 엔진 attach 전에 동작했지만 host/webview 연결·첫 표시·입력 잠금·stale 응답·live 중복 처리 검증이 필요하다. 입력 허용을 앞당겼다고 주장하지 않는다.
4. MCP·모델 목록·표시 조회는 이 제한된 실험에서 주요 critical path가 아니다. 로그인한 실제 설정의 별도 측정 없이 이를 생략하거나 권한을 완화할 근거는 없다.

## 증거·정리

수치·span·fixture·실패 시도·실제 exit를 [보존 증거](05-remeasurement-evidence.json)에 기록했다. 모든 9개 시험 engine의 실제 exit 0과 기록 PID·직접 자식·시험 경로 관련 프로세스의 잔여 일치 0건을 관찰했고 [불변 종료 근거](06-producer-stop.json)를 보존했다. 일회성 probe·격리 프로필·raw logs는 더 이상 소비하지 않는다.

close 시점에 catalog.lock이 다시 점유됐고 단일 close producer도 10분 대기 후 exit 1로 종료했다. 08:02 UTC 확인 시 동일한 07:20:34 UTC 생성 lock이 남아 있었다. 읽기 전용 watcher `0f13d698-b5e0-4308-81c6-893889ee52bf`가 실제 잠금 삭제를 관찰해 exit 0으로 종료한 뒤 close 재시도가 성공했다. 관리 대기로 인해 결과 수용이 지연됐으나 측정 수치에는 포함하지 않았다.

native group 등록 시 논리 크기 5,149,802,696 bytes였다. registered-mode review의 blocker는 없었으며 명시적 delete 결정을 적용했다. apply 결과는 group/member 모두 deleted·remaining false·error null이었다. 이어 producer finalize가 remaining/reference/blocker 없이 성공했다(08:19 UTC 확인). 물리 회수량은 도구가 제공하지 않아 논리 크기와 구분한다. 임시 probe·프로필·raw log는 모두 제거했고 일회성 테스트를 남기지 않았다. 새로 보존한 것은 이 문서·측정 JSON·불변 종료 근거 3개뿐이다. 공유 checkout의 다른 작업 변경과 staged 파일은 보존했다.

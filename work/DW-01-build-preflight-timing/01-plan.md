상태: environment-preflight 동일 설정 2회 실측·통계 산출·임시 자료 정리 완료. 사용자 추가 조치 없음.

# 빌드 환경 사전 검사 시간 측정

- 요청: Azrael 빌드 초반 한 단계를 실행하고 걸린 시간을 통계로 제시한다.
- 선택: `deploy-azrael.ps1`의 `environment-preflight`, 실제 `node scripts/pipeline-preflight.cjs --environment <config>`를 사용자 지정에 따라 동일 설정으로 2회 순차 실행한다. 전체 빌드·컴파일·의존성 설치·기능 수정은 하지 않는다.
- 입력: 현재 프로젝트와 기본 engine 소스, 실제 engine 영역 manifest 선택, 설치된 Python 3.12/Cargo 및 SDK 전용 Python. CLI와 manifest 및 핵심 SDK/도구 설정의 해시를 실행 전후 비교한다. 제품용 소스 복사는 필요하지 않다.
- 플랫폼: Windows x64에서의 실제 환경 검사만 측정한다. 타 OS/전체 제품 빌드 시간이나 완전한 빌드 준비 상태로 일반화하지 않는다.
- 측정: 각 CLI의 자식 프로세스 시작부터 종료까지 monotonic wall time(밀리초)을 기록한다. 각 내부 probe 시간, 1회차·2회차, 시간 차이·감소율과 2회 평균을 산출한다. 소표본이므로 일반적인 성능 분포를 추정하지 않는다. OS 캐시를 비우지 않으며 첫 회를 엄밀한 cold run으로 부르지 않는다. 측정·표시 준비 및 정리 시간은 CLI 단계 시간에 포함하지 않는다.
- 실행 조건/소유: root가 단독 수행한다. 기존 artifact-run/lifecycle helper로 생성 전 전용 run과 config/로그/임시 probe 경로를 등록한다. 자식은 SDK import, Python identity, Cargo version만 수행하며 컴파일 캐시를 점유하지 않는다. 예상 수십 초이며 첫 60초 내 결과를 확인한다.
- 성공 조건: 동일 입력 2회가 actual exit0, 모든 선택된 probe가 통과, 결과 통계를 이 문서에 독립적으로 보존한다. 실패는 성공 표본과 분리하며 실제 원인을 보고하고 필요한 수정만 승인 범위에서 수행한다.
- 정리: 결과 검토 후 요청된 측정 수치/입력 identity/종료 상태를 이 작업 문서에 보존하고, 전용 config·원시 로그·임시 폴더 전체는 native group review/apply로 삭제하고 finalize한다. 임시 문서 생성 body도 삭제한다. 정리 실패/보호로 남겨야 하면 사용자에게 정확한 경로·사유·재검토 조건을 제시하고 보존 허락을 받는다.
- 설계/코드: 제품 동작 변경이 없어 설계 문서 수정이나 제품 빌드는 필요 없다. 작업 단위 커밋은 결과 기록만 포함한다.

## 실제 측정 결과

- 단계: environment-preflight, Windows x64, Node v26.7.0. 실제 CLI를 동일 config로 정확히 2회 실행했다.
- UTC 시작: 2026-10-26T04:04:49.318Z, 종료: 2026-10-26T04:04:57.398Z. 전체 준비·정리 시간은 아래 단계 시간에 포함하지 않는다.
- 결과: 성공. 선택 입력 해시 전후 일치: true. lifecycle: run:DW-01:environment-two-20261026T040440663Z.

| 실행 | 전체 단계(ms) | 실제 exit |
| --- | ---: | ---: |
| 1 | 5134.485 | 0 |
| 2 | 2935.445 | 0 |

- 평균 4034.965ms, 최소 2935.445ms, 최대 5134.485ms.
- 1회차 대비 2회차 감소: 2199.041ms (42.829%). 음수이면 2회차 증가를 의미한다.

| 내부 probe | 1회차(ms) | 2회차(ms) |
| --- | ---: | ---: |
| python-sdk-import | 4368 | 2271 |
| child-path-sdk-python | 233 | 204 |
| child-path-python | 181 | 172 |
| child-path-cargo | 231 | 193 |

- 원본 probe는 32바이트 exclusive-write/read-back/ordinary-delete를 검사한다. 저장소 여유 공간은 관측했으나 compiler 증가량 추정치는 제공하지 않아 storage.status=unknown을 유지한다.
- OS 캐시를 비우지 않았으므로 첫 회는 엄밀한 cold 측정이 아니며, 2회 결과만으로 차이를 캐시 효과에만 귀속하거나 성능 분포로 일반화할 수 없다.
- 전체 제품 빌드/소스 검증/설치는 수행하지 않았다.

### 선택 입력 SHA-256

- scripts/pipeline-preflight.cjs: ea9f51e4c1d211c86fda954e6ad31d96049351f245be360ec9f46350be133b32
- scripts/azrael-feature-contracts.json: 07d9ada59285d16ee86cf3c2fc840f6e2461b3026863541cf2fcda1fcca45dfc
- scripts/cargo-target-owner.cjs: 6bb5299038040a3dde8440adeec32c686817a37d6bc93c564579a8a0bbc0ef1b
- scripts/directory-state.cjs: 8077bba1c2241194647ded74e867e6a4ac11585b7a02f5e73d8bc38db7986bc7
- engine/codex-rs/rust-toolchain.toml: 029fd8fde748bb7dd75f20e21576e36f1f567bba8149af4602310086a2a0dc58
- engine/sdk/python/src/openai_codex/generated/v2_all.py: 674fdec196ff540405973a40aee01240633c072763002ebe3b9246a21c3d988e

### 실제 도구/probe 식별 결과

- python-sdk-import: actual exit 0, {"python": "C:\\Users\\felre\\Desktop\\pi-harness-init\\engine\\sdk\\python\\.venv\\Scripts\\python.exe", "pydantic": "2.13.4", "module": "C:\\Users\\felre\\Desktop\\pi-harness-init\\engine\\sdk\\python\\src\\openai_codex\\generated\\v2_all.py"}
- child-path-sdk-python: actual exit 0, C:\Users\felre\Desktop\pi-harness-init\engine\sdk\python\.venv\Scripts\python.exe
- child-path-python: actual exit 0, {"python": "C:\\Users\\felre\\AppData\\Local\\Programs\\Python\\Python312\\python.exe", "version": "3.12.10", "tomllib": "C:\\Users\\felre\\AppData\\Local\\Programs\\Python\\Python312\\Lib\\tomllib\\__init__.py"}
- child-path-cargo: actual exit 0, cargo 1.95.0 (f2d3ce0bd 2026-03-21); release: 1.95.0; commit-hash: f2d3ce0bd7f24a49f8f72d9000448f8838c4e850; commit-date: 2026-03-21; host: x86_64-pc-windows-msvc; libgit2: 1.9.2 (sys:0.20.4 vendored); libcurl: 8.15.0-DEV (sys:0.4.83+curl-8.15.0 vendored ssl:Schannel); os: Windows 10.0.26200 (Windows 11 Core) [64-bit]

## 정리와 최종 검토

- 두 CLI 모두 actual exit0이며 내부 probe 4개씩도 모두 exit0이다. 컨트롤러 종료 actual exit0, lifecycle producer.status=stopped/outcome=success/exit_code=0, membership_complete=true를 확인했다. 컴파일이나 비동기 daemon은 실행하지 않았다.
- 결과와 재현 조건을 이 문서에 독립 보존한 뒤 native 등록/registered-mode review를 수행했다. group member 1개(전용 run 전체), 30,664 logical bytes, blockers=[], references=[]였다. 측정용 원시 로그/config/report/probe를 포함한 그룹에 명시적 delete를 적용했다.
- native apply 실제 결과: group.status=deleted, item.status=deleted, remaining=false, deletion.error=null, aborted=false. 물리 회수 용량은 도구가 측정하지 않았으므로 주장하지 않는다.
- supported lifecycle finalize 실제 exit0/status=finalized, remaining/references/blockers=[]를 확인했다. run 실제 부재도 확인했다. 생성에 사용한 계획 body 파일은 이미 삭제했고, 전용 빈 상위 폴더도 일반 삭제했다. 작업 결과 기록 외의 전용 payload/로그/config/테스트/백업은 남기지 않았다.
- native 등록·검토·삭제 호출에서 별도 대기 시간이 발생했다. 이는 측정된 CLI 5.134초/2.935초 및 두 실행 합계 8.070초에 포함되지 않는다. 측정은 중간 실패나 재실행 없이 정확히 2회였다.
- 제품 소스나 지침 및 기존 산출물/캐시는 변경하지 않았다. 최초 SDK import 4,368ms, 두 번째 2,271ms로 전체 감소 2,199.041ms의 대부분을 차지한다. 이 차이를 OS 파일 캐시만의 순수 효과로 단정할 수 없다.
- 검증: 실제 두 프로세스와 내부 probe의 exit, 선택 입력 전후 해시, 통계 계산값, 삭제 결과와 finalize, 작업 diff를 검토한다. 제품 전체 빌드·설치 성공을 의미하지 않는다.

상태: 소스 구현·필수 검증·실제 provider 재현 분석과 임시 자료 정리 완료. 실행 중인 w31b 배포본은 교체하지 않았다. task commit 식별자는 Git 이력과 완료 보고를 참조한다. 원래 429의 provider 세부 원인은 보존된 근거 부족으로 미확정이다.

추가 실행 준비: 과거 Git `ccbcbf93906a72cc7654aa9c57c670d5e2e3831d`에서 현재 localIntegration의 originalReceipt와 JSON 전체가 같은 원본 영수증을 찾았다. raw SHA-256도 기존 기록의 `12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6`와 같다. root가 `artifacts/shared/engine-original-ccbcbf93`에 Git 원본을 새로 복원하고 공식 snapshot validator로 검증한다. 압축 임시 파일은 이 run의 temporary, 검증 로그/보고서는 logs/reports 소유다. primary 소스와 현재 배포본은 이 복원 입력으로 사용하지 않는다. 원본 바이트 전체 검증이 통과하고 native 실행이 끝난 뒤에만 공식 recorder로 이번 7개 Rust delta 영수증을 갱신한다.

# 근거 기반 오류 분류와 Anthropic 429 재현

## 요구사항과 권한

기존 오류 문구에 해당하는 경우와 이번 원인 후보(429 요청/토큰/사용량 제한)를 명확한 근거로만 분류한다. 알려진 규칙에 해당하지 않는 오류의 표시 문구는 정확히 `정의되지 않은 오류`다. 원문에 포함된 단어나 일반 HTTP 상태만으로 세부 원인을 추측하지 않는다. 진단 로그에는 상태, 고정 코드/사유, 검증된 수치와 제한 헤더만 남긴다. 사용자 요청으로 구현 후 실제 provider 재현을 수행할 권한이 있다. 자동 계정 전환/재시도 정책, 계정/설정/기존 대화, 전체 제품 빌드와 설치는 변경 범위에 포함하지 않는다.

범위는 Azrael의 대화/모델 요청 오류 처리 공통 경계다. 임의 프로그램의 stdout/stderr나 도구 결과를 일반 문구로 덮어쓰지 않는다. 공통 의미는 Windows x64/Linux x64/macOS ARM64에 적용하고 이번 실행은 Windows에서 검증한다.

## 순서와 소유권

root: provider 분류/안전한 진단 계약/문서/통합/실제 재현과 최종 판단. error_presentation_map: scripts의 오류 표시 경계와 근거를 읽기 전용 조사. 구현 담당 배정 시 파일 소유권과 확정 계약을 명시한다. UI 표시와 native 진단은 shared contract 확정 후 독립 범위로 진행한다.

## 완료 조건

1. bare 429, 비정상/알 수 없는 오류 본문, 인용·부정·모순 내용은 요청 제한/사용량/인증 오류로 잘못 분류하지 않는다.
2. 기존 명확한 오류는 그 의미를 유지하고, 이번 429 세부 분류는 직접 근거만 사용한다. 나머지 사용자 표시 결과는 `정의되지 않은 오류`다.
3. 정해진 transport 계측과 기존 SQLite/검사기를 재사용해 원문·토큰·계정 식별자 없이 재현 원인을 추적한다.
4. Windows source/native 경계의 필요한 회귀 검사와 light/dark 표시 검사를 통과한다. 실제 재현 성공/실패/미재현과 역사적 사건의 불확실성을 구분한다.
5. 변경 문서/보존 inventory/정리와 task 단위 commit을 완료한다. 전체 빌드/설치가 필요한 경우 그 지점에서 프로젝트 지침을 따른다.

## 산출물과 보관

실행 로그와 작은 안전한 재현 보고서는 `artifacts/tasks/error-specificity/runs/01/`의 logs/reports에 root 소유로 보관한다. 임시 fixture/스크립트는 temporary 아래에 두고 검증 후 일반 삭제한다. 현재 w31b 실행본과 사용자 계정 저장소는 보호한다. 이전 분석은 `01-plan.md`를 참조한다.

## 구현 결과와 기존 기능 보존

`implementation` skill을 적용해 기존 provider HTTP/SSE 분류기, progress/transport/SQLite 경로와 오류 표시기를 확장했다. 새 라이브러리나 재시도 경로는 추가하지 않았다. 공통 formatter를 standalone 채팅과 pinned native UI의 실제 `Zdn` selector에 연결했다. 기존 native React 카드와 CSS를 사용한다. 알려진 구조화 오류/완전 일치 문구만 표시하고 unknown과 native `Unclassified`의 외부 표시는 정확히 `정의되지 않은 오류`다. 임의 메시지 접두사도 unknown 표시를 바꾸지 않는다. 기존 retry/policy 카드 억제, account/queue/recovery admission은 유지했다.

기존 인증 실패를 자격 증명 만료로 단정하던 문구를 인증 거부로 바로잡았고, session budget과 provider usage를 구분했다. 일반 429/402, `Retry-After`, Anthropic `rate_limit_error`만으로 구체적 제한 원인을 추측하지 않는다. 명확한 구조화 코드·전체 메시지·문서화된 spend-cap detail·거부된 subscription window를 사용한다. 요청/입력 토큰/출력 토큰/전체 토큰/동시성/증가율 제한은 해당 차원의 직접 근거가 있을 때만 분류한다. 미지 코드, 인용·부정·상충하는 알려진 유형은 다른 오류 의미를 빌리지 않는다.

오류 본문은 기존 최대 16,384바이트/1초 범위를 유지한다. 안전한 provider type/reason/body-state 고정 라벨, 숫자 rate/reset/retry 헤더만 export한다. helper, native transport validator와 read-only Python 검사기가 같은 allowlist를 강제한다. vendor 원문/자격 증명/계정 ID는 새 진단에 저장하지 않는다. 기능 보존 inventory에 `engine.error-classification`, `ui.error-presentation`과 실행 가능한 검사를 등록했다.

## 실제 재현과 원인 판단

수정된 source helper로 2026-10-16 22:24:23~22:24:34 KST와 22:25:51~22:25:59 KST에 진단 요청을 한 번씩 보냈다. 두 요청 모두 원본 세션과 같은 account임을 값 대신 비교 결과로 확인했고 `anthropic`, `claude-opus-5-5`, effort `high`를 사용했다. 각 요청의 실제 network fetch는 1회, 도구 호출은 0회다. 원래 약 35,385토큰의 전체 context를 재전송한 것이 아니라 최소 harmless prompt(두 번째 실제 입력 156토큰)를 사용했다. 원래 429의 입력 조건과 동일하다는 주장은 하지 않는다.

| 구분 | 관측 사실 | 의미와 한계 |
| --- | --- | --- |
| 원래 21:49 세션 | HTTP 429, 생성/도구 0, attempt 1, retry 없음 | 요청이 provider HTTP 단계에서 거부됨. 당시 본문·제한 헤더 미보존으로 구체 원인 확정 불가 |
| 첫 source probe | HTTP 200, 답변 없음, `provider_incomplete`, 10,675ms | 원래 429 미재현. 진단 실행 exit 0은 모델 추론 성공을 뜻하지 않음 |
| 두 번째 source probe | HTTP 200; `message_start` → `message_delta(stop_reason=refusal)` → `message_stop`; output 0, 8,488ms | provider가 거부 종료를 명시. 네트워크 무응답이나 429와 구분되며 거부 이유 자체는 제공되지 않음 |

두 번째 경로는 기존 Anthropic adapter가 `refusal`을 `content_filter` 종료 사유로 변환하고(`vendor/src/adapters/anthropic.ts`), helper의 완료 허용 사유에 해당하지 않아 `provider_incomplete`가 되는 경로(`inference.ts`)와 일치한다. 새 refusal 전용 사용자 분류는 추가하지 않았다. 원래 429와 같은 원인이라고 판단하지 않는다. 원래 문제에는 (1) provider의 429 거부와 (2) 그 원인을 모두 요청 빈도 제한처럼 표시한 Azrael 분류 문제가 함께 있었다. 이번 변경은 (2)를 수정하고, 향후 (1)을 구분할 제한된 근거를 보존한다.

안전한 보고서: `reports/live-probe.json`, `live-probe-02.json`. 실행 전후 source hash가 같음을 기록했다. 각 probe가 만든 새 provider binding UUID 2개만 owner/thread/path를 확인해 일반 삭제했고, 원본 binding은 보존했다. 임시 probe 스크립트와 renderer fixture/profile 제거 확인은 `reports/cleanup.json`, `reports/error-render/summary.json`에 남겼다.

## 검증 근거

모든 아래 경로는 `artifacts/tasks/error-specificity/runs/01/` 기준이다. Windows에서 실제 수행했으며 Linux/macOS 실행, 전체 app build/설치 및 설치된 창의 새 동작은 검증하지 않았다.

| 검사 | 결과 / 실제 종료 코드 | 근거 |
| --- | --- | --- |
| Provider 분류·실제 inference mock·Claude OAuth/tool fixture | 12 pass, exit 0, 301 assertions | `logs/provider-regression-serial.log`, `reports/provider-regression-serial.json` |
| Standalone TS 준비 및 채팅 오류 | 최종 보존 보완 후 24 pass, exit 0 | `logs/presentation-legacy-final.log` (최종 legacy 회귀 포함) |
| 실제 pinned selector 변환 + recovery bridge/표시 | 34 pass, exit 0; 보존 보완 후 selector 2 pass, exit 0 | `logs/presentation-integration-final.log`, `logs/integrated-error-final.log`, 대응 reports JSON |
| shared stall/progress telemetry | 20 pass, exit 0 | `logs/shared-telemetry-tests.log` |
| Devin provider cause 검증 | 7 pass, exit 0 | `logs/node-provider-diagnostics-tests.log` |
| Python SQLite exporter | 21 pass, exit 0 | `logs/python-inspector-tests.log` |
| 실제 Cargo native 4 scopes | 1+3+5+1 = 10 pass, exit 0 | `logs/native-cargo-tests-03.log`, `reports/native-cargo-tests-03.json` |
| native source harness | 8 + 1 pass, exit 0 | `logs/native-contract-tests.log`, `logs/native-prefix-tests.log`; 실제 helper/transport와 protocol 표현식. seam이 포함되어 Cargo 통합 검사의 대체 근거로 쓰지 않음 |
| native React/CSS light/dark/narrow 표시 | 최종 43 checks, exit 0, browser/fixture 정리 확인. 중간 실패도 보존 | `reports/error-render-acceptance/summary.json`과 PNG, `logs/error-render-acceptance.log`; 중간 실패는 error-render-final/summary.json |
| selector + namespace cache owner/실제 pinned target | 최종 9 pass, exit 0 | `logs/integrated-and-cache-acceptance.log`, 대응 reports JSON |
| feature inventory + injector 소유권 | valid, exit 0 | `logs/feature-inventory-final.log` |

초기 provider 검사 일부가 archived 파일도 수집했으므로 최종 근거는 명시적인 `./` 경로를 쓰는 위 12개 검사다. Cargo와 동시에 실행한 final 시도에서는 Claude fixture의 Windows ACL `EICACLS`/15초 timeout으로 11 pass/1 fail이었다. 이를 보존하고, Cargo 시작 전에 동일 변경을 단독 재실행해 12 pass를 확인했다. 실제 계정 ACL을 변경하지 않았다. 렌더 fixture 최초 중복 selector binding 실패는 수정 후 동일 검사 31개가 통과했고 실패 기록도 보관했다.

첫 Cargo 실행은 대화 중단으로 종료 근거가 사라져 성공으로 간주하지 않았다. 재개 후 관련 Cargo/rustc/link/runner 프로세스가 없음을 확인하고 새 로그 `native-cargo-tests-02.log`로 재실행했다. CPU 경합을 줄이기 위해 build jobs=4로 제한했다. protocol의 실제 unknown test는 1m45s 준비 컴파일 후 1 pass를 확인했다. 이 실행은 새 테스트에서 expected 값을 이동 후 재참조한 Rust E0382로 2026-10-16 22:39:12~23:07:16 KST, exit 101로 끝났다. 값을 clone하도록 수정했고 새 실행 03은 23:08:26~23:14:43 KST에 4 scopes/10 tests 모두 exit 0으로 통과했다. 기존 28분 준비 컴파일의 캐시를 재사용했으며 03의 실제 경과는 약 6분17초다.

## 출처와 배포 범위

현재 실행 중인 w31b package/engine/helper는 교체하지 않았다. 초기 조사에서는 공식 recorder가 요구하는 독립 원본 baseline `artifacts/source-snapshots/win06-integrated-r2`가 해당 경로에 없었다. 이후 아래 절차로 원본을 Git 바이트와 기존 영수증에 맞춰 복원하고 공식 검증을 통과했다. 그 원본을 사용해 `record-engine-local-changes.py`에 변경된 Rust 7개 경로를 명시했고, engine/SOURCE.json을 공식 갱신했다. primary의 공식 snapshot 검증도 exit0이다. 현재 source SHA는 68ffbde622960c8721ce5f1649b73ede38a0b3fe40571746332048c3d2615f61, receipt SHA는 85a9b11bca89a1e5ab9550f3a076496ac2b1f83586cd1c78dc9201100ee701ef, 파일 수 9,264개다. 관련 log는 source-receipt-record.log/current-source-snapshot.log, report는 current-source-snapshot.json이다. 이번 Cargo/source 검증은 전체 app package나 설치된 창의 수락을 의미하지 않는다.


## 최종 보존 보완과 자원 관찰

최종 검토에서 기존 native의 계정 removed/revoked·이미지 입력 오류가 공통 badRequest 안내로 축약되는 보존 공백을 수정했다. 해당 category에서 전체 문구가 정확히 일치하는 6개만 보존한다. other의 기존 local watchdog/deadline 8개도 완전 일치로 유지한다. 알 수 없는 provider_failure, 일반 HTTP 오류와 변형·인용·상충 category는 이 allowlist에 추가하지 않았다. 첫 TS 추론 오류는 명시적 undefined guard로 수정했고 최종 24개 검사가 통과했다.

이후 실제 pinned selector 통합 2개 검사도 exit 0으로 통과했다. compile과 동시에 수행된 selector parse 검사는 약 212초가 걸렸다. 그 시점 OS 조회는 약 32GiB RAM 중 free physical 약 3GiB를 보였다. 어떤 자원이 각 지연의 단일 원인이라고 단정하지 않는다. 정확히 식별한 소유 Cargo(51360, parent26448, 명령/시작시각 대조)와 그 자식의 실행 우선순위만 BelowNormal로 낮췄으며 실행 중인 Azrael/사용자 브라우저는 조작하지 않았다(`reports/native-priority.json`).

보완된 화면의 39개 동작 assertion과 light/dark PNG 육안 검사는 통과했다. 단, 테스트 브라우저가 30초 안에 종료됐다는 확인을 얻지 못해 script exit 1과 profile을 보존했다. 이후 해당 profile의 Chrome process 0개와 기록된 port5345의 listener0개를 직접 확인하고 포함 경로 검증 후 일반 삭제했다. `reports/error-render-final-cleanup.json`은 이 별도 정리 명령의 exit 0이며 원래 renderer exit 1을 덮어쓰지 않는다. 설치된 앱 동작의 통과 근거로 사용하지 않는다.


## 최종 source·renderer 수락

옛 helper의 고정 rate 문구가 불명확한 429에도 쓰였다는 원래 조사 근거를 반영해, 그 정확한 과거 문자열은 저장된 rateLimitExceeded category가 있어도 화면과 복구 진단에서 unknown으로 처리한다. 원문/대화 저장·recovery admission은 변경하지 않는다. generic legacy helper failure/HTTP 400/5xx 원문도 복구 UI의 원인으로 재사용하지 않는다. 최종 standalone 24개와 recovery 32개는 각각 exit 0(`presentation-legacy-final.log`, `recovery-legacy-final-03.log`)이다.

가장 마지막 source로 실제 pinned selector와 cache owner를 함께 검사해 9 tests/exit0을 확인했다. 렌더러는 Cargo 종료 후 별도 `reports/error-render-acceptance`에 실행했고, 옛 rate 문구를 포함한 light/dark/narrow 43 checks/exit0, Chrome 종료·fixture/profile 제거를 모두 확인했다. light/dark PNG도 육안 확인했다. 중간 renderer exit1과 후속 수동 정리 근거는 보존하고 최종 exit0으로 덮어쓰지 않았다.

원본 SOURCE 영수증은 Git commit ccbcbf93와 같았지만 그 commit의 전체 engine 트리에는 원본 manifest 밖 파일 1개와 다른 바이트 6개가 있었다. 최초 snapshot 검증은 이를 거부했다. 새 복원본 안에서만 manifest 밖 파일을 Git 바이트/경로 소유권 확인 후 일반 삭제하고, 나머지 6개는 각 파일 Git 이력에서 원래 SHA-256에 정확히 맞는 blob을 찾아 복원했다. 추정 바이트는 사용하지 않았다. 파일별 원본 commit/hash는 `reports/original-source-restoration.json`에 기록했다. 최종 공식 snapshot은 9,199개 파일, 원본 receipt SHA 12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6, inventory c1bc93529cd8242ef691525ffe3cf1a51574d346b7a076e4f839db1aad046d13으로 exit0이다(`original-source-snapshot-03.json`, 대응 log). Windows 긴 경로를 처리해 복원했으며 이 작업은 primary SQL/코드를 바꾸지 않았다.

native 실행이 자동 갱신한 기존 tracked pending-snap 파일은 작업 시작 때 깨끗했던 HEAD 바이트로 복원해 이번 변경에서 제외했다. 정상/실패 테스트의 실제 종료 근거는 logs/reports에 유지했다. 복원용 임시 zip과 비어 있는 temporary 디렉터리는 일반 삭제했고, 원본 baseline은 이후 출처 검증을 위해 shared에 보존한다(`reports/archive-cleanup.json`).


## 최종 보관과 완료 범위

복구된 독립 원본은 artifacts/shared/engine-original-ccbcbf93/engine이며, 부모 디렉터리의 origin-snapshot.json/restoration.json만으로도 원본 해시와 복원 blob의 이력을 읽을 수 있다. version:engine-original-ccbcbf93 / BU-01-engine-original 소유로 등록해 engine/SOURCE.json의 현재 원본 참조가 끝날 때까지 보존한다. task의 logs/reports는 work:BU-01-error-specificity-run-01 소유로 보존하고, 새 배포본의 독립 검증 근거로 승격되어 현재 진단 소비가 종료된 후 재검토한다. 기존 호환 Cargo/TS cache는 해당 공유 소유자 아래 유지한다. 새 temporary directory, probe bindings 2개, 테스트 Chrome profile은 남기지 않았다. user의 기존 upstream untracked 디렉터리는 보존한다.

최종 원래 원인의 확신 범위는 provider HTTP429 거부와 Azrael의 과도한 포괄 분류까지다. 후속 최소 prompt의 HTTP200/refusal은 별도 관측이며 원래 35,385토큰 요청의 동일 재현이나 제한 해제 증거로 해석하지 않는다. 새 소스는 원인 미확인 오류의 확정적 문구를 막고 이후 재발 시 안전한 제한 근거를 보존한다. 전체 배포 build/설치와 Linux/macOS 실제 실행은 범위 밖이며 미검증이다.

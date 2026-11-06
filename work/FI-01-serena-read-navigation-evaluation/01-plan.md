상태: 읽기·탐색 평가와 임시 환경 정리 완료 — 기본 도구 도입 여부는 후속 설계·승인 대상.

# Serena 읽기·탐색 평가

## 목표·권한·범위

Serena 읽기·탐색 기능을 격리 환경에 준비하고 실제 Azrael 소스에서 속도·출력량·탐색 반복·정확성을 비교한다. 사용자는 함수 단위 읽기의 장점과 함께 배경지식 없는 모델의 파일 발견, 잘못 고른 함수의 반복 조회를 우려했다. 제품 코드·기본 지침·사용자 MCP 설정·실제 설치는 변경하지 않는다. development-workflow, implementation, testing을 적용했다. root가 환경·계측·통합·최종 판단과 정리를 소유한다.

공통 기능 도입 여부를 검토하되 실제 실행은 Windows x64 로컬이다. Linux/macOS·원격·제품 통합은 미검증이다. 제품 동작 변경이 없어 architecture 변경·제품 빌드·설치는 수행하지 않는다. 이번 결과에 따른 도구 도입/기본 사용 강제는 승인·실행하지 않았다.

## 입력·평가 설계

Serena-agent 2.1.0(Python 3.13.15), Azrael scripts의 JS/CJS/MJS/TS/JSON 541파일·7,465,908 bytes를 run에 복사해 고정했다. 각 파일 SHA-256을 측정했다. 원본 checkout의 동시 변경과 분리하며 모든 source hash는 마지막에도 동일했다. SERENA_HOME, npm/uv/XDG 캐시와 TEMP를 artifacts/verification/sr01에 고정했다. MCP stdio, ide context, planning mode, read_only:true, dashboard 비활성 상태로 실제 호출했다. CLI만 모방한 실험이 아니다.

동일 역할 gpt-6-luna xhigh의 독립 cold 세션 3개에 같은 증상 중심 질문 두 개를 주었다. 정답 파일명·함수명이나 원래 대화 배경은 주지 않았다. 일반 조건은 파일 목록·rg 검색·원문 읽기, Serena 조건은 여기에 개요·심볼·참조·패턴 검색을 추가했다. Serena 세션에도 일반 읽기 fallback을 허용했다. 추가 안내 조건은 첫 비교 결과를 보존한 뒤 한 번만 추가한 별도 세션이며, 파일 발견→개요→관련 함수 묶음, CommonJS 심볼 모호성, 일반 읽기 fallback을 안내했다. 결과를 보고 유리해질 때까지 재시도하지 않았다.

- Q1: 자동압축 비활성화 시 게이지 계산·경계·색상·추가 용량 안내·검증 근거.
- Q2: 관리 실행기 앱 receipt 부재/손상·override·identity·legacy fallback·검증 근거.

성공 기준은 실제 API 실행, 원문 추출 보존, 필요한 근거 발견, 후보 실패/재조회 포함 계측, 한계 구분과 owner 정리다. 파일/호출량 하드 제한은 두지 않았다. 루트 아래 worker·클라이언트는 실행을 계측하는 일회성 도구이며 제품 기능으로 추가하지 않았다.

## 비교 결과

| 조건 | 조회 수(Q1+Q2) | 원시 응답 문자 | 실제 도구결과 문자 | 첫→마지막 요청 input 증가 | 세션 시작→최종 기록 | 추론 요청 수 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 일반 검색·파일 읽기 | 7+7=14 | 194,672 | 144,344 | 42,631 tokens | 101.189초 | 16 |
| Serena 추가, 일반 안내 | 19+18=37 | 218,371 | 116,489 | 47,995 tokens | 153.256초 | 13 |
| Serena 추가, 파일 발견·개요·관련 함수 안내 | 27+19=46 | 95,721 | 115,605 | 46,972 tokens | 207.415초 | 48 |

원시 응답은 client 계측값, 실제 도구결과는 각 rollout response_item call_output의 텍스트 합계(guide·wrapper 포함)다. 실제 결과 잘림은 일반 2회·Serena 일반 1회·안내 0회였다. 문자량을 토큰량으로 바꾸지 않았다. input 증가는 마지막 답변 생성 요청 입력에서 첫 요청 입력을 뺀 값으로 그 뒤 최종 출력은 포함하지 않는다. 첫 input은 24,757/24,819/24,885, 마지막은 67,388/72,814/71,857이다. 생성 output 합계는 8,816/15,160/17,441 tokens였다. 원시 출력 절감이 모델 호출·프롬프트·추론까지 포함한 컨텍스트 절감으로 이어지지는 않았다.

세션 시간은 모델 추론·도구·대기를 포함한 한 번의 관측이다. 실행 순서를 무작위화하지 않았고 같은 host·직렬 MCP worker를 공유했다. 최초 두 세션은 겹쳐 실행됐고 안내 세션은 나중에 실행됐다. microbenchmark 약 2.6초도 일부 겹쳤다. 속도 개선률이나 모델 성능 저하율로 일반화하지 않는다. 별도 계측한 service time 합계는 일반 5.257초, Serena 일반 10.753초, 안내 2.872초였다. 도구 실행 자체보다 모델의 탐색 선택·호출 구성과 추론을 포함한 시간이 더 컸다.

### 정확성과 탐색 실패

세 조건 모두 핵심 계산·예외 분기와 관련 테스트 assertion 위치를 찾았다. 테스트는 실행하지 않았으므로 제품 런타임 수용 증거는 아니다. 반환 심볼 본문 55건이 선언된 원본 줄 범위 안에 정확한 부분 문자열로 존재함을 확인했다. 중간 열에서 시작하는 callback·Property는 전체 줄과 동일할 필요가 없으며 이를 추출 실패로 판정하지 않았다.

- 일반 조건: 넓은 compact 검색 70,145문자, 오소유 파일 후보를 읽은 뒤 검색으로 교정했다.
- Serena 일반: 넓은 OR 패턴 검색 3건이 과대 결과 요약을 반환했다. Function과 CommonJS export Property의 동명 때문에 참조 조회 3회가 실제 실패했다. 반환된 [0] name_path 지정으로 해결했다.
- 안내 조건: 모호성 오류는 없어졌지만 과대 검색 1건, test callback의 정확한 이름 재조회, 개별 함수·테스트 연속 조회가 남았다. 함수 본문 19회·개요 9회·일반 read_file fallback 8회였다. 필요한 원문은 줄였지만 조회/모델 요청 수는 늘었다.

Q1 근거 소유자는 scripts/inject-provider-context.cjs의 gaugeProgress/decorateGauge/useThreadAutoCompaction 및 scripts/test-provider-context.cjs다. Q2는 scripts/maintenance-owner-config.cjs의 installationPath/plainFile/validateCapabilities/resolveMaintenanceCommand, scripts/test-maintenance-owner-config.cjs와 scripts/test-maintenance-lock-owner.cjs다. 실제 조회는 입력 복사본에서 수행했다.

## 도구 자체 지연

준비 후 scripts/maintenance-owner-config.cjs와 plainFile을 대상으로 각 5회 측정했다.

| 작업 | 서비스 시간 중앙값 | 최소–최대 | 반환 문자 |
| --- | ---: | ---: | ---: |
| 일반 파일 전체 읽기 | 0.97ms | 0.83–1.28ms | 13,431 |
| 파일 심볼 개요 | 79.86ms | 74.08–107.56ms | 617 |
| 이름·파일을 아는 함수 본문 | 81.40ms | 65.52–87.62ms | 816 |
| 함수 참조 | 123.67ms | 117.08–139.21ms | 4,334 |

MCP ready까지 3,020.05ms, 첫 overview는 510.53ms였다. 패키지 설치 및 전체 언어 서버 준비/인덱싱과 분리된 값이며 cold 설치시간을 뜻하지 않는다. mailbox roundtrip 중앙값은 각각 39.06/109.78/108.45/156.64ms다. 존재하지 않는 함수는 54.92ms에 []를 반환했고 잘못된 후보를 자동 교정하지 않았다. 모든 microbenchmark 호출은 정상 응답했다.

MCP 초기 안내는 6,523문자, 선택한 읽기·탐색 4개 도구 정의는 9,686문자, 노출 10개 전체 정의는 16,587문자였다. 초기 안내/정의 비용은 개별 함수 추출 절감과 분리해야 한다. 이번 모델 비교는 동일 guide를 세 조건에 제공했으므로 실제 제품에서의 도구 정의 추가 비용까지 재현하지 않는다.

## 판단과 다음 제안

현재 Serena를 기본 읽기 방식으로 강제하는 것은 권하지 않는다. 함수 원문의 정확한 경계를 자동으로 가져오는 기능은 유용하지만, 모델이 검색·개요·본문 조회를 직접 조립하면서 반복이 증가했다. 사용자 우려가 이번 표본에서 나타났으며 사용법 안내만으로 해결되지 않았다. 주 모델을 포함한 모든 모델이 같은 결과를 낼 것이라는 결론은 아니다.

후속 검토 방향은 일반 경로/텍스트 검색을 발견 단계에 유지하고 파일·심볼을 찾은 뒤 선택적으로 심볼 읽기·참조를 쓰는 혼합 방식이다. 여러 심볼을 한 호출로 받는 읽기 인터페이스, Function/Property를 구분하는 안정적인 식별자, 짧은 signature·docstring을 가진 파일 개요를 검토할 수 있다. 함수 밖 설정/주석과 복잡한 테스트는 일반 연속 읽기로 즉시 돌아갈 수 있어야 한다. 이 인터페이스를 구현하거나 기본 지침을 변경하지 않았고, 개선 효과는 별도 검증이 필요하다. 원문/호출 횟수의 하드 제한은 제안하지 않는다.

## 범위와 재현 한계

JS/CJS/MJS/TS/JSON scripts 복사본만 평가했다. Rust·Python·전체 엔진·실제 버그 수정 성공률·Linux/macOS·장기 세션·native app 통합 latency는 미검증이다. 조건당 두 문제·한 세션이므로 통계적 성능 비교가 아니다. 원래 모델 세션 기록은 기존 Azrael 세션 owner가 관리하며 임시 정리 대상으로 복사/재등록하지 않았다.

공식 기능/설정 자료: [Serena 도구](https://oraios.github.io/serena/01-about/035_tools.html), [프로젝트 설정](https://oraios.github.io/serena/02-usage/040_workflow.html). 설치 버전은 PyPI serena-agent 2.1.0으로 고정했다.

## 실행 및 정리 근거

임시 환경·입력·캐시·로그·실험 코드는 artifacts/verification/sr01 한 root다. 생성 전에 lifecycle run:serena-read-eval:20261102:r1 (owner work:serena-read-eval)에 경로를 등록했다. standalone maintenance_owner의 문서상 pin SHA-256 cf9cbd25713cf0a7688d4609271cfe3ec5619635fb1550b7e02e1b59608d56f1과 설치 선택기를 검증했다. 분석 근거를 이 문서에 독립 요약한 뒤 owner register/review/apply로 삭제한다. 보존할 임시 환경이나 원시 로그는 없다.

설치 exit 0, 마지막 microbenchmark exit 0, 입력/본문 검증 exit 0, 평가 worker 정상 종료 exit 0이다. 종료 전에 소유 process tree 10개를 PID+생성시각으로 고정했고 종료 후 동일 identity 생존 0·평가 경로 관련 process 0을 확인했다. 최초 harness는 MCP SDK server_info를 serverInfo로 잘못 읽어 exit 1이었다. 수정 후 재시작했으며 Serena 동작 실패로 오인하지 않았다. PowerShell pipe/redirection의 인코딩 집계/문서 생성 오류도 있었고 UTF-8 파일 기반 쓰기로 교정했다. 성공으로 위조하지 않았다.

정리 전 상세 자료 SHA-256:

- input-manifest.json: `82b87ffefa8e7cf45ed3ea5884aeb38718559748af6712537946a036f41e0b87`
- input-verification.json: `5fec7d05333d94d606d67809ea4b636b7d08ab65ca882ea4c6a0cc85093a7ffb`
- body-verification.json: `124c712520eda957a4a950b04db2792cf06f0d6197a6b91328e4ab2f90705b36`
- benchmark-results.json: `a4843724ea46ea59d53d97b1e1b8dc0219ceaa172438b8b107e502563830c87f`
- trial-summary.json: `97706dcb23812c1b3f6c16fb50110881cd3582db587248f9704ed1b87cb2c976`
- trial-delivery-summary.json: `eded5c2b89c73cdabff9aa00226ef754a60346713ce4d8efe6a3fbda1acce574`
- calls.jsonl: `74198d98eaa25a1ea3971bff35fc758e78f36413d694393a22f78c69912f8755`
- process-stop-verification.json: `5a752715bb21eda0a627317c14e30264b8a6a4a183c34309448d54987851296f`

### 정리 완료

문서상 pin과 일치하는 standalone owner로 complete membership을 등록했다. 논리 크기는 260,912,012 bytes였으며 physical reclaimed 값은 제공되지 않았다. registered review는 차단 사유·참조 없음이었고 fresh token의 명시적 delete를 적용했다. native apply exit 0, group/item deleted, remaining:false, error:null, aborted:false, cancelled:false를 확인했다. 삭제 attempt는 attempt-33460-5260-1793620442078이다. artifacts/verification/sr01의 실제 부재와 lifecycle finalization(status finalized, remaining/references/blockers 모두 빈 배열)을 확인했다. 임시 환경·입력 복사본·패키지·캐시·원시 로그·평가 스크립트는 남기지 않았다. 독립적인 결과 요약과 hash는 이 계획에 보존한다. 사용자 정상 동작 확인을 기다릴 제품 변경은 없다.

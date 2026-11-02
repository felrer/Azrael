상태: 실험용 확장의 선택적 구조 설명 구현·검증·임시 출력 정리 완료. 제품 기본 도구 전환은 미실시.

# Serena 개요·일괄 읽기 확장 평가

## 목표·권한

기존 FI-01 평가의 후속이다. 사용자는 짧은 시그니처·설명을 포함하는 개요와 관련 함수 여러 개의 일괄 읽기를 구현해 호출 감소와 모델의 적절한 사용을 검토하도록 요청했다. Serena 2.1.0의 실제 읽기/탐색 API를 재사용한 실험용 확장과 비교 평가를 수행한다. 제품 기본 도구 연결·사용자 MCP 설정·기본 지침 변경·배포는 제외한다.

## 계약과 범위

개요는 정확한 심볼 식별자, 종류, 위치, 짧은 시그니처와 설명 출처를 제공한다. 실제 문서 주석·테스트 제목은 기본 표시하고, AST에서 관측한 참조·호출·반환 키는 심볼별 선택적 펼침으로 제공한다. 추정한 기능 설명이나 추가 모델 호출은 사용하지 않는다. 여러 심볼 읽기는 파일을 넘나드는 선택 목록을 받고 원문·위치·파일 identity를 반환하며 개별 실패를 구분한다. 함수밖 문맥과 일반 파일 읽기를 유지한다. 줄 수나 호출 수의 하드 제한은 도입하지 않는다.

공통 도구 후보를 검토하되 실제 검증은 Windows x64 로컬의 JS/TS 계열 고정 scripts 입력이다. 다른 언어·OS·제품 통합은 미검증으로 남긴다. root가 계약·Serena 연동·계측·통합·정리를 소유한다. AST 메타데이터 추출은 독립 모듈로 분리해 작업할 수 있다.

## 비교 설계

동일한 신규 고정 입력과 질문에서 기존 Serena, 개선 개요만, 개선 개요+일괄 읽기의 세 조건을 동일 역할의 독립 cold 모델 세션으로 비교한다. 조건당 두 세션, 같은 질문 두 개를 계획한다. 개요 효과와 일괄 읽기 효과를 분리하고 모든 결과를 기록한다. 모델에 정답 파일/함수명은 제공하지 않는다. 공통 발견·원문 읽기·참조는 허용한다. 일괄 읽기 비율·배치 크기뿐 아니라 선택한 함수가 답변 근거로 실제 쓰였는지, 빗나간 후보·중복·원문 재조회·정답 근거·컨텍스트 증가·모델 왕복·시간을 평가한다. 조건당 두 번의 소규모 관측을 통계적 성능으로 일반화하지 않는다.

## 검증·산출물·정리

개요의 시그니처·설명 출처·동명 심볼 구분, 일괄 원문 정확성·중복 제거·부분 실패·입력 변경 거부를 직접 확인한다. 원래 소스/Serena 읽기 계약을 보존한다. 재사용 가능한 확장 소스와 최소 직접 회귀 검사를 작업 산출물로 남기고, 일회성 worker·입력·환경·패키지·캐시·상세 로그는 artifacts/verification/sr02에 한정한다. 초기 cleanup owner pin 확인 실패 후 실행 루트·계획·환경 생성이 lifecycle 등록보다 앞섰다. 변경된 owner identity를 재확인하고 lifecycle run:serena-read-eval:20261102:r2에 실제 소유권을 즉시 조정했다. 이 순서를 사전 등록 성공으로 간주하지 않는다. 결과를 아래에 보존한 뒤 producer 종료·owner 등록/review/apply로 임시 묶음을 삭제한다. 다른 작업의 변경·staged 내용은 보존한다.

## 구현 결과

- `scripts/serena-read-metadata.cjs`: 설치된 TypeScript AST를 파일당 한 번 파싱한다. 선언 시그니처와 주석/테스트 제목을 추출하고, 설명이 없는 심볼은 명시적 펼침 요청 시 `Observed:`로 반환 키·호출 등 관측 구조를 표시한다. 설명 생성용 모델 호출은 없다. 길이 축약 여부와 설명 출처를 명시한다.
- `scripts/serena-read-tools.py`: Serena 실제 `LspApi` 위의 개요·일괄 읽기 어댑터다. 개요는 source hash에 결합된 ID, 종류, 위치, 시그니처, 설명을 제공한다. 일괄 읽기는 파일을 넘나드는 ID 또는 이름/종류 선택, 중복 매핑, 개별 오류를 지원한다. 본문을 자르지 않으며 UTF-16 위치를 원문에 적용한다. 변경된 소스의 ID와 배치 중 바뀐 파일 결과를 거부한다.
- `scripts/test-serena-read-metadata.cjs`, `scripts/test-serena-read-tools.py`: 위 계약의 직접 회귀 검사. 재사용할 실험 산출물로 유지한다.
- 제품 도구 등록·MCP wire 연결·기본 지침·아키텍처 기능 계약은 변경하지 않았다. 직접 Python API 실험과 제품 통합 검증을 구분한다.

## 실험 입력과 방법

아래 모델 비교 수치는 선택적 펼침을 도입하기 전, 구조 설명을 기본 표시하던 버전의 결과다. 선택적 펼침의 모델 호출 감소 효과를 재측정한 결과로 해석하지 않는다.

Serena 배포판 2.1.0을 별도 환경에 고정했다. 내부 agent version 문자열은 `2.1.0-1750fdb5-dirty`이며 vendor 코드는 수정하지 않았다. 기존 scripts의 JS/CJS/MJS/TS/JSON 541개, 7,466,046바이트를 고정 복사했다. 확장 소스도 모델 실험 전에 hash로 고정했다.

동일한 `luna_explorer` 역할(gpt-6-luna, xhigh)의 신규 세션을 조건별 두 번 실행했다. 질문은 (1) 자동 압축을 끈 컨텍스트 게이지 계산·경계·잘못된 값·안내와 테스트, (2) maintenance executable receipt 부재/손상·환경변수 override·identity/fallback과 테스트였다. 정답 파일·함수명은 알려주지 않았다. 공통 검색·파일 읽기도 허용해 자연스러운 도구 선택을 관측했다.

기존 조건 base2와 개선 개요 조건 overview1의 최초 실행에서는 PowerShell의 한글 정규식 인코딩이 깨졌다. 두 실행만 제외하고 UTF-8 안내를 고친 신규 세션 base2r/overview1r로 교체했다. 오류 없는 세션을 얻을 때까지 반복한 실험은 아니다. 제외 실행은 각각 27회/175,409문자, 20회/238,565문자였다. 대체 overview1r의 동명 Function/Property 참조 오류 1건은 실제 도구 오류로 결과에 포함했다.

## 비교 결과

호출 수는 모델이 요청한 도구 조회 수다. 원시 응답 문자는 반환값 전체, 실제 출력 문자는 wrapper가 모델에 전달한 문자열이다. 두 값을 토큰으로 환산하지 않았다. 컨텍스트 증가는 첫 요청과 마지막 답변 생성 요청의 input token 차이다.

| 조건/실행 | 도구 조회 | 원시 응답 문자 | 실제 출력 문자 | input token 증가 | 세션 초 | 모델 요청 |
|---|---:|---:|---:|---:|---:|---:|
| 기존 base1 | 21 | 295,533 | 163,540 | 47,849 | 116.778 | 24 |
| 기존 base2r | 21 | 363,992 | 190,906 | 60,720 | 122.873 | 24 |
| 개선 개요 overview1r | 32 | 669,905 | 200,001 | 64,233 | 175.306 | 34 |
| 개선 개요 overview2 | 16 | 110,850 | 116,769 | 34,899 | 102.941 | 19 |
| 개선 개요+일괄 batch1 | 15 | 262,129 | 143,110 | 46,163 | 108.437 | 17 |
| 개선 개요+일괄 batch2 | 21 | 211,128 | 166,052 | 54,486 | 120.000 | 23 |

개선 개요만으로 호출이 일관되게 줄지는 않았다. 일괄 읽기는 한 실행에서 21→15회 수준이었으나 다른 실행은 21회였다. 조건당 2회이므로 특정 감소율이나 안정적 성능 향상을 주장하지 않는다. 컨텍스트 증가 범위도 겹친다. 모든 실행이 핵심 계산식·예외 분기·테스트 근거를 찾았고, 직접 테스트가 없는 입력 경계도 구분했다. 제품 테스트 자체를 실행한 결과는 아니다.

기존 조건 모델이 stock overview를 선택하지 않은 경우도 있다. 따라서 이 비교는 동일한 개요 사용 절차의 통제 실험이 아니라 도구 가용성과 모델의 자연스러운 선택을 포함한다. 하나의 worker/cache를 순차 공유해 cold 모델 세션과 cold 언어 서버를 구분해야 한다. 조건 순서를 무작위화하지 않았으므로 도구 서비스 시간이나 총 시간을 순수 도구 속도 차이로 해석할 수 없다.

### 일괄 선택의 실제 적절성

두 모델 모두 일괄 읽기를 자발적으로 사용했다. 총 7회 중 5회가 여러 본문을 읽었으며 배치 크기는 3, 6, 3, 2, 2였다. 나머지 2회는 단일 본문이었다. 전체 18개 선택 중 16개가 다중 배치에 포함됐다. 실제 배치 반환에는 오류·중복이 없었다.

- batch1 Q1: `gaugeProgress`, `decorateGauge`, `renderThreadAutoCompaction` 3개를 함께 읽었다.
- batch1 Q2: resolver와 receipt/capability 후보 6개를 함께 읽었다. `validateCapabilities` 대신 그 안의 49문자 `some()` 콜백을 고른 ID 선택 오류가 있어 부모 함수 516문자를 단일 호출로 다시 읽었다. `verifyInstalledCommand` 3,275문자는 답변에 쓰이지 않은 인접 helper였다. 모델의 사후 확인에서도 두 선택을 각각 잘못된 노드·불필요한 후보로 인정했다. 사후 확인은 본 실험의 시간/컨텍스트에서 제외했다.
- batch2 Q1: `gaugeProgress`, `decorateGauge`, `policyDescription` 3개를 함께 읽었다.
- batch2 Q2: resolver/installationPath, plainFile/validateCapabilities를 각각 2개씩 읽고 관련 테스트 callback은 단독으로 읽었다.

따라서 일괄 읽기 자체는 실행됐고 대부분 질문에 관련됐지만, 관련 함수 자동 선택이 완전히 해결된 것은 아니다. 부모/콜백 구별과 인접 helper의 관련성 판단이 남는다. 호출을 합치는 기능만으로 잘못된 후보 선택을 막을 수 없다.

### 개요 비용과 다음 개선 후보

실제 개요 12개의 상세 심볼에 시그니처 누락은 없었다. 다만 `maintenance-owner-config.cjs` 개요는 stock 617문자에서 상세 6,404문자로 커졌다. 다른 개요는 9,370·10,513문자였다. 전 심볼의 설명을 항상 풍부하게 보여주면 처음부터 컨텍스트 비용이 증가한다.

짧은 시그니처와 실제 문서 요약을 우선하고 구조 설명은 선택적으로 확장하는 변경은 아래 절에 구현했다. 남은 후보는 기본 개요에서 최상위 선언/부모와 콜백 계층을 더 명확히 구분하고, 검색 결과에 일괄 선택 가능한 정확한 ID/종류를 연결하는 것이다. 파일 발견·넓은 검색 비용도 남아 있으므로 추가 실험 없이 제품 기본 도구로 전환하지 않는다. 다른 모델·실제 수정 작업·긴 세션·다른 언어/OS에서 재현 여부는 미검증이다.

## 검증 및 종료 증거

- 최종 Node 직접 검사: `node --test scripts/test-serena-read-metadata.cjs`, 8/8 통과, exit 0. 소스/테스트의 `node --check`도 통과했다.
- 최종 Python 직접 검사: 소유 임시 디렉터리의 `SERENA_READ_TEST_ROOT`를 사용해 `python -B scripts/test-serena-read-tools.py`, 4/4 통과, exit 0. cross-file 본문/중복/부분 실패, stale ID/동명 모호성, 경로 탈출, 배치 중 소스 변경을 검사했다.
- 실제 Serena 통합 검사 exit 0: 모델 선택 18개와 preflight 4개, 총 본문 22개가 고정 원문과 일치했다. 541개 입력과 고정 확장 소스의 변경은 0개였다.
- worker 종료 전 생성시각과 PID로 소유 프로세스 6개를 기록했다. 종료 후 동일 identity 생존 0개, 관련 프로세스 0개를 확인했다.
- 종료 파일은 exit 0을 기록했지만 native session 38793의 관측 exit는 1이었다. worker 로그에서 종료 실패의 원인은 확인되지 않았다. 로그의 traceback은 앞서 기록한 정규식/동명 참조 오류이며 종료 원인이라고 단정하지 않는다. 실험 쿼리·최종 검사 성공과 worker native 종료 실패를 구분하고 lifecycle은 failure/exit 1로 닫는다. 초기 preflight worker session 72717은 exit 0이었다.
- 초기 preflight 후 worker를 재시작해 확장을 고정했고, 모델 평가 중에는 worker를 재시작하지 않았다. 순차 평가의 총 경과 시간과 서로 다른 세션 시간의 합을 동일시하지 않는다.

상세 일회성 파일은 정리하며, 아래 SHA-256과 표·검증 내용을 독립적으로 보존한다. 경로는 삭제 전 `artifacts/verification/sr02/` 기준이다.

| 파일 | SHA-256 |
|---|---|
| trial-summary.json | 06d4548fde64111347d1b2d315c25fa8f83822c1c749a05d649e389a0bd76c72 |
| delivery-summary.json | 73e758d57c00dcb90acc4372c32b30bab983aa37985f7b3d7f2901bd531f2e7e |
| integration-verification.json | 034bdad7ac939081fb3dda870bb2c1138b72e05bda15c46e02f576e78cb33911 |
| overview-verification.json | 1abb0fb9c5a6f2439eb071503a2799d1db7441077ea875ffaf822f69595f24a8 |
| process-stop-verification.json | 5e967dfa4d6db992ca46e76f331bf1f5bf157c0ffc25ae1e1d3a7f9c60f55f03 |
| extension-inputs.json | dbadaf42d8aba42f502b84359de2ea51b8391e9a3d8529f5fba6ac04121a34b2 |
| input-manifest.json | 138baeeae90c126b5f91838160cfaaf57cf57864ed6e926b7530bb392ef7dec6 |
| metadata-tests-final.log | 625a9f0a2f8735caf3b43628d0558249540d3c95a49883533ed3d3fa142ebb3a |
| adapter-tests-final.log | 79c2808075bf08f4aa6c89c8347e769e70495ef201ff0eb688b76ff9d47749f1 |
| worker.log | 41cba0ab63c6786df7af3f26e47ec65d4f4c6600432ff947dfda431fd52f1d09 |

## 정리 결과

검증된 standalone owner `maintenance-owner-ff01-group-win-x64-20261102/payload/maintenance_owner.exe`(SHA-256 `31cbf0c24ae42b3d783b7fe299d5168cd0f2f29323842c144d0761222edfdc89`)의 등록·registered review·apply가 각각 exit 0으로 끝났다. review의 blockers와 references는 비어 있었다. 소유 루트 251,053,236바이트를 delete 결정으로 처리했고 결과는 `deleted`, `remaining:false`, `error:null`이었다. 실제 루트 부재를 확인했다. lifecycle finalize도 `finalized`, remaining/references/blockers 모두 빈 배열이었다. 강제 삭제나 다른 shell/API 우회는 사용하지 않았다. 정리 호출 준비 중 `command` 대신 실제 계약 `executable`을 사용해야 하는 필드 오류 1건을 고쳤으며, 잘못된 호출은 producer 재실행이나 삭제를 수행하지 않았다.

네 개 실험 소스/회귀 검사와 이 결과 문서는 요청한 산출물로 유지한다. 제품 실행·설치·사용자 설정·다른 작업의 소스와 staged 변경은 이 작업 범위에 포함하지 않았다.

## 선택적 구조 설명 계약과 검증

사용자 요청에 따라 기본 개요의 구조 설명을 접고, 기존 metadata 추출기와 overview 캐시를 재사용해 선택적 확장을 구현한다. 범위는 기존 실험 어댑터의 JS/TS 계열이며 검증 환경은 Windows x64 로컬이다. 제품 연결·설정·배포·다른 플랫폼 지원 범위는 바꾸지 않는다.

- 기본 `overview(relative_path, depth=0)`는 시그니처·주석·테스트 제목을 유지하고, 구조 설명을 생략한 행에 `structure_deferred: true`를 표시한다. 구조 설명을 위한 AST 순회도 기본 모드에서는 수행하지 않는다.
- 같은 파일/깊이에서 `overview(relative_path, structure_ids=[id1, id2])`로 요청한 심볼들만 한 번의 metadata 파싱에서 펼친다. 응답은 전체 개요이며 선택하지 않은 행은 유지한다. 펼친 결과가 기본 개요 캐시에 섞이지 않는다.
- source hash에 결합된 기존 ID를 재사용하고 알 수 없거나 다른 파일/깊이·이전 소스의 ID는 거부한다. 변경된 소스에서 이전 ID를 자동 추측하지 않는다. 본문 일괄 읽기는 그대로다.
- metadata 직접 입력에서는 심볼별 `include_structure: true`로 동일 동작을 요청할 수 있다. 실제 주석/테스트 제목이 있으면 기존 설명 우선순위를 유지한다. `structure_deferred`는 펼침 가능 후보를 뜻하며, 분석할 관측 내용이 없으면 펼친 설명은 비어 있을 수 있다.
- 기존 구조 설명 테스트는 명시적 확장 모드로 바꾸고, 기본 생략/일부 선택/주석·제목 유지와 캐시 오염·stale ID 거부 검사를 보완한다. 추후 metadata 호출이나 캐시를 단순화할 때 구조 설명이 다시 기본 반환되거나 확장 결과가 기본 캐시에 새는 실수를 막기 위해 기존 테스트 파일에 유지한다.
- 일회성 출력은 사전 등록한 `run:serena-read-eval:20261102:r3`의 `artifacts/verification/sr03`에 한정한다.
- Node metadata 검사 9/9, Python adapter 검사 5/5 모두 통과했고 실제 exit는 각각 0이었다. Python 테스트는 Serena API 경계를 최소 fake로 대체하고 실제 Node metadata subprocess·파일·캐시·본문 ID를 사용한다. 이번 변경으로 Serena 설치나 모델 비교를 재실행하지 않았으며 모델의 호출 수 개선은 미측정이다.
- 실제 `scripts/maintenance-owner-config.cjs`의 최상위 함수 8개에 같은 metadata를 적용했다. 모든 구조 설명을 펼친 JSON은 2,103문자, 기본 JSON은 1,166문자, 첫 함수만 펼친 JSON은 1,209문자였다. 시그니처는 모두 동일했다. 이는 metadata 부분의 출력 크기이며 전체 Serena 개요나 모델 토큰의 감소율이 아니다. 측정 소스 SHA-256: `14a1cc5ed75f389fd5e883ae69916064388284fb4fafb5b2a137c6da6d89cafb`.
- `node --check`는 metadata 소스와 테스트 모두 exit 0이었다. 동기 테스트·metadata subprocess 명령은 모두 종료 결과를 받았고 백그라운드 producer를 생성하지 않았다.
- 삭제 전 출력 SHA-256: `metadata-tests.log` = `e9cc0aa2dec22f5547cac5c2171d28811615e0c5023e0b3dd582262d1ae71b56`, `adapter-tests.log` = `49a6d95428382debe92692c0253fa9e8754000d7677543078a95c39d7c35d360`, `output-size.json` = `76217d4d673fb92771ed40916da220bcc17fe6f9faf2e10eb1d433905d333eae`.
- r3 lifecycle은 success/exit 0으로 종료했다. 검증된 owner의 등록·registered review·apply도 각각 exit 0이었다. blockers/references 없이 1,714바이트 임시 출력 루트를 삭제했고 `deleted`, `remaining:false`, `error:null`이었다. 실제 `sr03` 루트 부재와 lifecycle `finalized`(remaining/references/blockers 없음)를 확인했다.

상태: 완료 — 기본3항목·선택 시그니처 구현, 기존 검색/보호 계약8개 검사 및 지원 owner 정리를 완료했다. 시그니처 이름 중복 제거는 제안만 했다.

# 함수 검색 응답 압축과 선택적 시그니처

## 승인·범위

사용자가 기본 검색 결과를 [ID, 시작 줄, 끝 줄]로 압축하고 시그니처를 선택 옵션으로 두는 제안을 승인했다. 현재 experimental scripts/serena-read-tools-v3.py와 직접 소비자인 기존 v3 unit만 수정한다. include_signature는 keyword-only bool=False, true이면 각 행의4번째 값으로 기존 전체 시그니처를 추가한다. 기본/false는 항상3항목이다. 시그니처의 ID 중복 제거는 별도 설계 질문이므로 이번에는 조사·제안만 하고 내용을 임의로 가공하지 않는다.

검색은 기존처럼 native ID·전체 signature·기존 JSDoc 첫 문장에 대해 casefold literal AND를 유지한다. 문서 주석은 검색 대상이며 기본3항목에는 반환하지 않는다. 빈 검색어·잘못된 옵션은 조회 전에 거절하고 결과 순서·원문 전체 본문·일괄 읽기·중복·경로/변경 감지는 보존한다. v1/v2 및 보관 실험 JSON을 바꾸지 않는다. 기본 Azrael 도구 등록·설치·공유 지침·의존성 추가·제품 빌드·성능/모델 반복은 없다.

## 소유·검증·정리

root는 reader/기존 v3 테스트/이 문서/시그니처 개선 제안/최종 수용·커밋을, v32_large_runner는 작은 일회 unit run의 생성 전 lifecycle 등록·환경·로그·실행·최소 독립 검증 근거·지원 owner 정리를 소유한다. 타인·동시 변경과 기존 staged 파일을 보존하며 자식 추가 위임은 없다. 구현 READY 뒤 기존 v3 unit을 실행해 압축 결과·옵션 true/false·기본값·invalid bool·검색 영역 보존·원문/경로/stale 계약을 확인한다. 변경하지 않은 v1/v2 근거는 재사용하고 공유 경계에 구체적 부족이 있을 때만 추가 검증한다.

공통 Python/JS·TS 어댑터 의미를 보존하고 실제 검증은 Windows x64/Python3.13/Node/설치 TypeScript다. 다른 OS/실제 native provider 재기동·새 모델 성능·최종 API 비용은 검증하지 않는다. 새 unit의 보존 사유는 이후 반환 최적화에서 시그니처/주석 검색 능력이나 기본3항목·옵션 계약을 다시 누락할 수 있기 때문이다. 현재 제품 catalog에 연결되지 않은 실험 도구라 architecture/feature inventory 변경은 없다.

run의 로그·임시 fixture·cache는 owner에 귀속해 최소 독립 결과를 남긴 뒤 close/refs 확인/register/review/delete/finalize 및 실제 부재를 확인한다. 승인 보존 sr04에 새 의존 참조는 필요하지 않다. 기존 실행·정리·커밋 지침은 계속 적용한다. 시그니처는 TypeScript AST의 기존 선언 정보 재사용을 우선 검토하고, 정규식으로 ID를 무조건 삭제해 타입/기본값까지 손상시키는 방식은 제안하지 않는다.

## 구현·검증 결과

find_symbols(relative_path, query, *, include_signature=False)의 기본 결과는 [[id,start_line,end_line], ...]이며 true에서만4번째 값으로 기존 원문 signature를 붙인다. signature/doc은 출력 여부와 무관하게 기존 검색에 참여하고 invalid include_signature는 source lookup 전에 거절한다. 기본3항목과 옵션 원문 보존을 기존 v3 테스트에 통합했으며 실제직접consumer는 이 테스트뿐임을 확인했다. native 동적 도구 schema는 지난 run의 보관 증거일 뿐 현재 상시 등록은 없으므로 수정하지 않았다.

Python3.13.15 -B scripts/test-serena-read-tools-v3.py -v는 실제exit0/8개PASS/signalnull, unittest5.044초·producer5.251초였다. Windowsx64/Nodev26.7.0/TypeScript5.9.3에서 입력9개 전후 불변이다. root가 전체 source/test diff와8개 verbose 결과를 직접 검수했다. reader SHA23473236add45efb919e0373f5208c7587f7bd57e86addd6183ffac20287cc32, test SHA13558127dc9dae09f496d1c9fc5d68479874c049ddd21d198172386c7f6612bb다. 추가v2suite/기존버전성능/새모델trial/nativeSerena기동/설치는0회다.

과거18의6개 성공 검색 응답을 같은 항목 그대로 재직렬화한 정적 계산은 기존4,764자→기본압축1,504자(−68.4%), signature포함압축3,616자였다. width검색은4,202→1,353자였다. 이전 응답에서ID/행/선택header를 같은 순서로 재표현한 계산이며 새로운 모델의 선택·토큰·속도·API 비용을 측정하지 않았다. 기본 결과에 필요할 때시그니처를추가요청하는 비용은 여기에 포함되지 않는다.

## 시그니처 중복 제공 개선안 — 제안, 미구현

ID가 별도이므로 함수 시그니처는 매개변수·제네릭·반환타입·필요 수식어를 중심으로 제공할 수 있다. 예를 들어 function estimateTableColumnWidth(column, rows, density)는 (column, rows, density)로 표현한다. async/static/export나TypeScript제네릭·optional/rest/기본값·반환타입은 필요정보로 보존할 범위를 정해야 한다. 일반 함수와 다른 class/interface/getter/constructor 등 선언도 기존검색대상에 있으므로 선언종류별 계약을 함께 정해야 한다.

기존 serena-symbol-metadata.cjs의 TypeScript AST를 재사용해 선언 이름 토큰과 매개변수/반환타입의 위치를 추출하는 방식을 권한다. ID 문자열을 전체 header에서 일괄 replace하면 동일 이름이 타입/기본값에 있을 때 정보손실이 생길 수 있다. 검색에는 기존 전체원문header를 계속사용하고 표시용서명만별도만드는방식이 가능하다. 이번 승인된 옵션 구현은 전체원문서명을 유지했고 중복제거 방식은 아직 적용하지 않았다.

## 산출물·정리

run artifacts/verification/minimal-id-v3-compact-unit-20261103-7d93b2a6, lifecycle run:serena-read-eval:20261103:v3compact-7d93b2a6는생성전등록했다. sr04새참조는없다. 독립 [19-verification.json](19-verification.json)은9,953바이트/SHA256 825f0b53e1d47410690f4d4d3a57e64b25f84dfed75eb5aa588d8575784254a3로 고정했으며 이후 수정하지 않는다. root도 해시·크기와 실제 run 부재를 확인했다. 작은 동기 producer 실제exit0 및 관련process0이며 별도 native/LSP 백그라운드 기동은 없었다. lifecycle close exit0/rev2/complete/references[]다.

검증 owner SHA c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680의 inventory/register/fresh review/apply 실제exit0, blockers[]/references[]를 확인했다. item e6f3d622a00c4334e60ce7da7851fba2ba898b2f96e3decde9e88cdfd79ff5d9, decision1f72306fb318fb5fd1b1367bf66d78982f786ca1a7b8b7c3f75b0db639ff72a4, attempt-41044-5693-1793701543278이다. 논리170,125바이트 삭제/deleted/remaining:false 및 실제 run_exists:false다. 물리 회수량은 미측정/null이고 finalize 실제exit0/finalized/remaining[]/references[]/blockers[]다. 이번 source/test/문서와 독립 근거만 유지하며 새 disposable 잔여·정리 대기·활성 producer는 없다.

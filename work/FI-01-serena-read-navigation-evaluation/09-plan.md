상태: 완료 — 읽기 단위 목록 필터 정상동작·기존 보호 검증 및 새 산출물 정리 완료.

# 읽기 단위 목록 필터 검증

사용자가 요청한 변수·매개변수 목록 제외 수정의 정상동작만 확인했다. 성능 측정과 모델 비교는 수행하지 않았다. root가 어댑터·TypeScript 보완 helper·유지 단위검사를 소유하고 검증 executor는 이 보고와 검증/정리를 소유한다. 07-plan의 불변 근거 및 08-plan의 기존 비교 결과는 수정하지 않았다.

## 실제 종류와 구현 계약

native Function/Method/Constructor/Class/Interface/Struct/Enum을 목록에 포함하고, 제외된 데이터 부모도 자식 전체를 순회한다. 실제 JS provider는 arrowTop과 top/arrowLocal을 Constant, Box/arrowProperty를 Property로 분류했다. 종류만 거르면 유효한 화살표 함수가 숨겨지는 문제가 확인되어 root가 기존 TypeScript AST를 통한 callable initializer 위치 판별로 보완했다. 문자열·주석 regex로 판별하지 않는다. 목록 API는 여전히 ID 문자열 배열만 반환하며 내부 parser 위치를 모델에 노출하지 않는다.

이 보완으로 JS/TS 목록에는 Node와 기존 `extensions/azrael-ex/node_modules/typescript`가 필요하다. Python-only 종류 필터와 달리 JS/TS 파일은 내부 AST subprocess를 사용한다. 제품 도구 등록·설치·공개 응답 스키마 변경은 없다. 알려진 ID의 read_symbols 계약은 유지한다.

## 검증 결과

Windows x64/Python3.13/Serena2.1.0 실제 LspApi와 JS/TS language server로 실행했다. sr04의 Python을 `-B`로 읽기 전용 재사용했으며 Serena/XDG/TEMP/npm/LSP/로그는 모두 새 고유 run 하위에 격리했다.

- 유지 단위검사: 기존7개+데이터/중첩/빈목록 필터+실제 parser callable/문자열 falsepositive 검사, 총9개 실행·exit0.
- 실제 JS 목록: arrowTop, Box, Box/constructor, Box/arrowProperty, Box/method, holder/child, top, top/arrowLocal, top/nested. 일반 상수·변수·속성·지역 데이터7개는 제외됐다. Constant 부모 holder를 제외해도 holder/child Method는 유지됐다.
- 실제 TS 목록: Shape(Interface), Shape/area(Method), Status(Enum), typed(Function). Alias(Variable), enum 값(Constant)은 제외됐다.
- native 화살표 종류는 Constant/Property 그대로지만 세 화살표 모두 목록에 포함됐고 일괄 read_symbols 원문은 실제 provider range로 독립 추출한 source substring과 정확히 일치했다.
- 기존 비ASCII/이모지 완전 본문, 함수/메서드 파일간 batch·중복 제거, 파일변경 거부·재목록 회복 검사를 통과했다. 알려진 데이터 ID constantValue의 직접 읽기도 유지됐다.
- 실제 JS provider는 매개변수 심볼을 내보내지 않았다. native 매개변수 필터링을 실행했다고 주장하지 않으며, Parameter 제외는 모의 공개 계약 검사가 담당한다.

첫 probe는 native에 매개변수가 노출된다고 강제한 검사 가정 때문에 exit1이었다(단위8개는 exit0). 실제 종류 증거를 root에 전달했고 매개변수 가정을 바로잡았다. 화살표 제외는 정상 결과로 수용하지 않았으며 root가 production 보완 후 최종 probe를 재실행하여 exit0을 확인했다. 실패와 최종 결과를 구분하여 보존했다.

독립 근거는 [09-verification.json](09-verification.json)에 있다. 실제 명령, 제품/검사3개 SHA256, native ID/kind 전체, 정확 화살표 본문, 검사 결과 및 첫 검사가정 오류, 각 실행의 자식 PID/create_time/종료 결과를 포함한다. 이 JSON은 lifecycle close의 hash 고정 근거이므로 이후 변경하지 않는다.

## 종료와 정리

새 run은 `artifacts/verification/minimal-id-kind-check-20261103-b7c5de40`, lifecycle `run:serena-kind-filter:20261103:b7c5de40`, owner `work:serena-read-eval`, version `minimal-id-kind-filter`다. 생성 전에 planned root를 등록하고 sr04 runtime에 typed execution 참조를 걸었다. 모든 실행에서 agent.on_shutdown이 정상 반환했고 LSP는 shutdown response/exit notification 뒤 exit0으로 종료했다. 각 실행에서 PID/create_time으로 고정한 자식5개가 모두 종료되었고 remaining=[]였다.

독립 근거 보존 후 lifecycle close revision2 complete/refs[]로 실행 참조를 해제했다. resolver가 선택한 검증된 standalone maintenance_owner의 SHA256은 `c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680`이었다. native register exit0으로 논리용량50,094,039바이트를 등록했고 fresh registered review에서 blockers=[]/참조0개를 확인했다. 최신 item token으로 delete를 적용하여 apply exit0, group/item deleted, remaining=false를 확인했다. decision_id는 `ecd06d799704cf1d9df477fd713545da1e5000b8d1c836d7ac8f6bd73544dab0`이다. finalize exit0에서 remaining/references/blockers 모두 빈 배열이며 실제 run 경로도 존재하지 않는다.

새 fixture·일회용 probe·parser/LSP 설치물·cache·raw log·plan-body는 남기지 않았다. 독립 최소 보고09-plan/09-verification만 유지한다. 기존 sr04 사용자 승인 보관 예외와 과거 overlap 보호는 변경하지 않았다. 다른 OS/CPU, JS/TS 이외 native 종류, Struct 실물 매핑은 미검증이다.

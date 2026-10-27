상태: 네 가지 개선·Windows 관련 검증·DW-10 생성물 정리 완료. DW-09의 별도 정리 승인 대기는 유지하며 통합 커밋은 보류한다.

# 테스트 선택과 공유 준비 비용 정밀화

## 승인 범위와 현재 상태

사용자가 테스트 선택 범위 정밀화, 전체 캐시 행렬의 변경별 실행, 공통 번들 변환 결과 공유, 준비 단계 중복 검사 제거를 요청했다. DW-09에서 반영된 부분을 보존하고 남은 오탐·누락된 dependency gate·호출 경로 차이·동일 경계의 재검사만 개선한다. 실제 제품 기능·권한·지원 플랫폼은 유지한다. 공통 Windows x64/Linux glibc x64/macOS ARM64 코드, 실검증은 Windows x64다. 제품 빌드·설치는 하지 않는다.

## 구현과 검증

- selector 담당: 실제 AST import와 닫힌 경로를 분석하고 문자열·주석을 의존성으로 오인하지 않는다. 변이·shadowing·열린 runtime 경로는 기존 uncertainty와 fallback을 유지한다. 기존 선택 회귀와 안정된 동일 입력의 전후 선택 파일·시간을 비교한다.
- matrix 담당: 기존 asset별 행렬에 알려진 pinned asset 변경 합집합을 연결한다. deferred header의 실제 cache dependency 누락을 보완하며 공통·미분류 변경과 exhaustive는 전체다. 정책 행동 검증, header key 무효화, 실제 header cold/warm 결과 동등성을 확인한다.
- 공유 fixture 담당: BTW의 상대 fullPath를 실제 root의 절대 경로로 전달해 공통 번들이 같은 기존 disk cache를 사용하게 한다. key/환경/도구/source/소유 guard를 유지하며 독립 소비자 재사용을 확인한다.
- 준비 담당: 동일 validate 경계에서 production verifier가 이미 수행한 환경·receipt 검사를 중복하지 않는다. 실행 전후의 별도 검증은 유지하고, 주입 verifier의 추가 환경 검증도 보존한다. 기존 receipt 오염·실패·환경 변경 거부를 재검증한다.
- root: 통합·문서·feature 연결·결과 해석·정리와 커밋. 담당 파일은 겹치지 않으며 기존 DW-09 및 동시 사용자 변경을 보존한다.

## 산출물과 정리

아래 검증 결과를 독립 증거로 남기고 검토가 끝난 원시 로그·캐시를 정리한다.

## 실제 검증 결과

Windows x64, Node 26.7.0에서 실행했다. 다른 OS와 제품 빌드·설치는 검증하지 않았다. 신규 검사는 현재 선택·무효화·공유·receipt 보존 동작의 지속적인 회귀 계약으로 유지한다.

| 검증 | 실제 결과 | 시간 |
| --- | --- | --- |
| policy / UI fixture / cache micro 및 실제 pinned header cold-warm / BTW 4파일 | exit 0, 42 통과 | 122.698초 |
| feature-preservation 첫 실행 | exit 1, 24 통과·1 실패. 새 fixture에서 manifest 파일을 저장하지 않은 준비 오류 | 28.366초 |
| manifest 준비 수정 후 같은 feature-preservation 파일 | exit 0, 25 통과 | 28.104초 |
| 선택기 전체 회귀 | exit 0, 38 통과 | 130.246초 |

최종 관련 검사는 총 105 통과·실패/skip 0이다. 실행 시간은 서로 겹치므로 합산하지 않는다. 실제 실행 로그 `artifacts/tasks/dw10-checks/{sharing,preflight,preflight-retry,selector-suite}.log`는 검토 후 정리하며 본 문서가 독립 검증 요약이다. 생산 source-preflight verifier는 경계마다 환경·입력·로그를 검증하고 같은 경계에서 추가 환경 측정을 하지 않는다. 주입 verifier의 독립 비교, 누락된 증거·변조·환경 변경 거부는 유지해 검증했다.

### 선택 정밀화와 비용

실행 AST만 읽어 주석·문자열 안의 예제 require를 제외한다. 닫힌 const/path/require.resolve 표현식은 실제 의존성에 포함하고, 변이·shadowing·열린 경로는 보수적 fallback을 유지한다. manifest-data 전용 입력은 직접 변경 소유권을 유지하며 모듈로 재귀 분석하지 않는다. manifest-owner 또는 실제 static-import와 겹치면 계속 재귀 분석한다.

초기 구현이 upstream UI 데이터를 실행 모듈로 따라가 분석이 확대됐다. root의 첫 비교는 실제 성능 저하를 관측한 후 정확한 소유 프로세스를 종료했고 exit 1로 남았다. 별도 단일 profile은 exit 0으로 완료했다. profile에서 분석 14,788파일·94.643초였으며 역할 경계 수정 후 355파일·4.384초로 줄었다. 이 수치는 작업 중 발생한 성능 회귀의 수정 결과이며 기존 선택기 대비 개선율이 아니다.

DW-09 분리 index의 기존 선택기와 수정 선택기에 같은 현재 의존 파일을 사용해 6개 입력을 비교했다. 파일 선택 결과와 separateChecks는 유지됐으며 선택기 비용은 아래와 같다. 현재 실제 프로젝트의 열린 runtime 의존성 때문에 대표 입력의 테스트 수는 추가 감소하지 않았다. AST의 정밀성을 얻었지만 기존 정규식 방식보다 평균 분석 비용은 늘었다.

| 변경 입력 | 테스트 수 전→후 | 기존→수정 분석 시간 |
| --- | --- | --- |
| inject-btw | 13→13 | 2.088→4.252초 |
| native-verification-cache | 9→9 | 2.837→2.591초 |
| source-test-policy | 12→12 | 1.990→3.011초 |
| source-preflight-reuse | 3→3 | 1.873→2.312초 |
| namespace-cache-owner | 94→94 | 2.058→2.693초 |
| ui-test-transform-fixture | 8→8 | 2.064→2.913초 |

평균 2.152→2.962초. 같은 호스트에서 다른 검증과 겹친 단일 반복 관측이며 전체 소스 단계 속도 비교가 아니다. fixture 회귀는 실제로 예제 문자열이 가짜 의존성을 만들지 않는 것과 닫힌 실제 의존성이 누락되지 않는 것을 검증한다.

### 캐시 행렬 및 번들 공유

기존 namespace/policy를 DW-09 분리 index에서 읽어 비교했다. 같은 33개 전체 행렬 중 deferred 변경은 **33→9**, 알려진 pinned header만 변경하면 **33→1**이다. BTW 변경은 4→4, 공통 asset-cache 변경은 33→33으로 전체 fallback/기존 범위를 보존한다. 미지의 asset·다른 pin·manifest·공통 owner·직접 test 편집·exhaustive는 전체 행렬을 유지한다. deferred의 실제 header 의존성을 cache gate에 추가해 캐시된 no-op도 제대로 무효화한다.

BTW는 다른 공통 번들 소비자와 같은 절대 upstream fullPath를 전달한다. 정확한 경로·source·환경·TypeScript·owner guard는 유지하며 캐시 키를 임의로 정규화하지 않는다. 실제 `webview/assets/app-initial-97d3534ad35f.js` 한 번 비교에서 cold 18.445초, 기존 상대경로 별도 소비자 18.313초(miss/producer 1회), 수정 절대경로 별도 소비자 **0.523초(hit/producer 0회)**였다. 변환 바이트와 metadata가 같음을 검증했다. 이 대표 입력의 후속 소비 비용은 약 97.1% 감소했으며 전체 빌드 개선율로 일반화하지 않는다. 입력 A/B/A 교대와 별도 fixture 소비자의 disk hit도 회귀 검사로 통과했다.

## 정리 및 미완료 경계

모든 DW-10 생산자와 비교 실행은 실제 terminal outcome을 확인했다. 최초 실패와 종료한 비교의 실패 상태는 최종 passing 검증과 별도로 기록했다. 최적화 관리 실행기 SHA-256 `6ffd3d7e5787439381740a8bb3a32a7f4d4ab0d91beba4ee145c954287a06a96`를 확인하고 기존 inventory를 조회한 뒤 DW-10 그룹을 등록했다. register exit 0(5.392초), fresh review exit 0(5.491초)이며 두 멤버 blockers는 비어 있었다. 명시 delete apply exit 0(30.519초), aborted false, 각 멤버 deleted/remaining false를 확인했다. `artifacts/tasks/tw10` 35,394,044바이트와 `artifacts/tasks/dw10-checks` 1,594,170바이트는 삭제 후 직접 부재를 확인했다. lifecycle finalize는 finalized/remaining·references·blockers 빈 배열이다. `.git/dw10-*` 제어·profile 파일도 사용 종료 후 보통 삭제하고 부재를 확인한다. scoped whitespace 검사는 exit 0이다.

DW-09의 `artifacts/t-b7c4` 관리 범위 설정 변경은 아직 승인되지 않았으므로 그 그룹은 건드리지 않았다. DW-09 자료와 분리 index는 [09-plan.md](09-plan.md)의 재개·정리 목적 때문에 남아 있고, 보존 승인·정리 완료로 처리하지 않는다. 따라서 전체 정리와 통합 커밋은 아직 미완료다.

출력 생성 전 `run:DW-10:selection-and-sharing`에 `artifacts/tasks/dw10-checks`, `artifacts/tasks/tw10`을 계획 등록한다. `.git/dw10-*` 제어 파일은 root 소유다. 검증 후 필요한 결과를 본 문서에 남기고 최적화 관리 실행기로 생성물을 정리한다. DW-09의 관리 범위 밖 빈 폴더 정리 설정 변경은 승인된 것으로 해석하지 않는다. 기존 차단 경위와 미완료 항목은 [09-plan.md](09-plan.md)에 남아 있다.

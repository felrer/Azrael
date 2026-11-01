상태: 소스 구현·관련 검증·임시 fixture 정리 완료 — 제품 빌드·설치와 Linux/macOS 실제 실행은 수행하지 않았다.

# 다중 플랫폼 공통 캐시 재사용

## 목표와 권한
공유 가능한 빌드 캐시 재사용으로 반복 변환과 중복 저장을 줄인다. 사용자 승인 범위는 소스 개선·관련 검증·정리다. 제품 전체 빌드·설치·원격 동기화와 기존 캐시 일괄 삭제는 수행하지 않는다.

## 범위와 결정
- Windows x64, Linux x64/glibc, macOS ARM64의 공통 UI 자산 변환을 대상으로 한다. 실제 실행 검증은 Windows이며 다른 OS의 실제 빌드 수용과 구분한다.
- 기존 asset-transform-cache와 namespace-cache-owner의 입력 해시·모듈 바이트 검증·경로 경계·writer 잠금을 재사용한다. 별도 캐시 엔진이나 의존성을 추가하지 않는다.
- 플랫폼에 독립적인 입력·규칙·TypeScript가 같으면 같은 변환 결과를 저장한다. 플랫폼별 최근 사용 집합을 유지해 다른 플랫폼이 사용하는 결과를 지우지 않는다. 한 플랫폼이 갱신하면 다른 플랫폼의 참조가 없는 자신의 이전 결과만 회수한다.
- portable host 준비와 고정 입력에서 호출하는 producer가 지속 소유 프로젝트의 namespace 캐시를 사용하도록 연결한다. native Cargo 및 의존성 바이너리의 플랫폼 분리는 유지한다.
- 캐시 키는 제품 버전·플랫폼 이름을 불필요하게 포함하지 않는다. 원격 전송과 NAS/NFS 공유 잠금 수용은 범위 밖이다.

## 순서와 검증
루트가 전체 변경을 소유한다. 캐시의 플랫폼별 참조 보존 → portable 준비·호출자 전달 → 문서·보존 매핑 → 최소 관련 검사 순서로 진행한다.
기존 retention/owner/host 준비 검사를 재사용한다. 같은 입력의 플랫폼 간 재사용, 공통 payload 단일 저장, 다른 플랫폼 참조 보호와 이전 결과 회수를 작은 기존 테스트 확장으로 검증한다. 향후 준비 경로 변경 시 캐시 전달을 누락하거나 글로벌 prune으로 되돌리는 반복 실수를 막는 부분만 유지한다.
임시 fixture는 기존 테스트 소유자의 finally/after가 일반 삭제하고 부재를 확인한다. 실제 제품 빌드 시간·전체 용량 절감은 측정 없이 주장하지 않는다.

## 구현 결과
- portable 준비가 Windows와 같은 `artifacts/cache/namespace`를 사용한다. 고정 입력 producer는 원래 프로젝트 또는 명시한 `--cache-project-root`를 전달해 임시 입력 사본 안의 캐시 생성을 피한다. 준비 영수증에 선택한 소유 프로젝트·경로를 기록한다.
- 변환 payload 키는 기존 내용·규칙·TypeScript identity를 유지한다. 플랫폼은 payload 키에 추가하지 않으며, `scope-<OS>-<CPU>.json`의 사용 집합만 분리한다. 공통 자산과 no-op 결과는 재사용하고, 플랫폼별 이전 결과는 마지막 참조 해제 때 회수한다.
- 손상된 사용 기록과 writer 점유는 삭제를 보류한다. 삭제 실패·중단 시 미회수 결과의 소유 기록을 먼저 게시해 이후 정상 재시도가 가능하다. 명시 소유 프로젝트의 실행 모듈 바이트 검증과 경로 보호를 유지한다.
- Cargo·node-pty·keyring·검증 결과·최종 패키지를 다른 OS의 결과로 대체하지 않는다. 원격 저장소나 공유 파일시스템을 만들지 않았으며 기존 캐시의 일괄 이동·삭제도 수행하지 않았다.
- `build.shared-ui-cache` 보존 매핑을 추가했다. 기존 검사의 실제 호출자 옵션을 확장하고, 글로벌 prune 복원·플랫폼 키를 payload에 추가·실패 삭제의 소유 기록 누락이라는 구체적 재발 경로만 작은 유지 검사로 막는다.

## 검증과 정리
- 관련 5개 검사 파일: 76개 중 75 통과, Unix 실행 권한 1개는 Windows에서 skip, 실제 exit 0 / 약 116.3초. 네이티브 제품 빌드나 Rust 검사는 실행하지 않았다.
- 실패 삭제 재시도 보완 후 관련 retention/owner 14개를 다시 실행해 14 통과·0 skip, exit 0. 최종 계측만 추가한 owner 검사도 7 통과·0 skip, exit 0이다. 변경되지 않은 자산 변환의 전체 fixture 결과는 재사용했다.
- 실제 pinned UI 두 자산: cold 변환 223.1ms, Linux scope warm 14.4ms, Mac scope warm 17.9ms. 세 scope 모두 Windows에서 실행했다. 추가 producer 0개이며 공통 payload 2개/295,287 bytes와 작은 사용 기록 3개만 저장했다. 전체 빌드 시간이나 실제 OS 간 측정값으로 일반화하지 않는다.
- JavaScript 7개 구문과 feature manifest 검증 통과. 관련 diff whitespace 검사도 통과했다. 상세 입력 해시·종료 결과는 [02-verification.json](02-verification.json)에 보존했다.
- 테스트 소유자 finally/after의 일반 삭제 후 `cache-retention-test-*`, `cache-scope-test-*`, `namespace-owner-*` fixture 부재를 확인했다. 계획 할당용 임시 본문도 삭제했다. 실제 사용자·제품 캐시는 수정하거나 삭제하지 않았다.
- 기존 staged 변경과 병행 소스 변경을 보존하며 이 작업의 변경만 분리해 커밋한다. 분리 index와 제어 파일은 사용 직후 일반 삭제하고 부재를 확인한다.

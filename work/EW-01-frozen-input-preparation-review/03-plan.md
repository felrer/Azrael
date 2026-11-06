상태: 완료. 상시 native 선택 축소, source 검증 및 임시 자료 삭제·수명 기록 정리를 완료했다.

# 네이티브 검사 유지·삭제 검토

## 목표·권한·범위
사용자는 개선된 testing 지침에 따라 앞으로 내가 반복할 누락·잘못된 수정만 막는 최소 검사를 남기고, 존재/현재 구현 확인 및 재발 경로가 불명확한 검사는 삭제하는 방향을 요청했다. 대상은 직전에 설명한 engine.shared-engine 단계의 appserver/session-handoff/stable-source와 함께 실행되는 source 묶음이다. 제품 기능·출처·IPC 최종 패키지 수용 요구를 없애는 범위는 아니다. 현재 필수 검사 매핑이 바뀌는 후보는 구체 변경 범위와 줄어드는 자동 검증을 먼저 제시한다. 제품 빌드·설치·사용자 상태 변경은 수행하지 않는다.

## 플랫폼·소유
공통 등록은 Windows/Linux/macOS에 영향을 주며 Windows PTY와 직접 libtest 실행 예외는 Windows 범위다. 실제 조사 호스트는 Windows x64. 원본 engine/은 docs/ops/development.md Source and state와 engine/SOURCE.json이 지정한 통합 소스다. 읽기 전용 appserver·handoff·wrapper 조사를 분리했고 root가 유지 기준·통합·최종 범위를 소유한다. 기존 dirty/untracked 수정과 다른 세션의 실행은 보존한다.

## 판정 기준
파일/함수/문구 존재, 내부 호출 횟수, 구현 형태 고정, 단순 값 계산·직렬화, 과거 결함 발견만으로 유지하지 않는다. 앞으로 반복하는 입력 추가·패키지 포함·설정 전달·플랫폼 예외·호출자 연결 작업이 실제 누락 경로를 만들고 기존 도구가 검출하지 않는 최소 검사만 유지 후보로 둔다. 모든 코드에 나중에 조건을 지울 수 있다는 일반론을 붙여 유지하지 않는다. 삭제가 자동 검증 범위 축소라면 그대로 보고하고 대체 테스트를 요구하지 않는다.

## 적용 결정과 변경 범위
사용자의 테스트 유지 기준에 따른 자동 검증 축소를 실행한다. appserver는 광범위 17개 Cargo 선택(Windows)에서 명령 인자·설정 전달·브랜드별 host 선택의 5개 특정 검사로 좁힌다. handoff는 3개 crate의 전체 prefix(정적 선언 31개)에서 daemon socket/WebSocket/preview 2개와 app-server 전달/권한 4개로 좁히며 core libtest는 제외한다. Rust 제품·테스트 본문은 수정하지 않고 상시 빌드 선택을 삭제한다. 원본 Rust 테스트는 선택 범위 밖으로 남아 별도 명시 실행에만 사용되며 이 작업에서 영구 유지 기준을 모두 충족한다고 주장하지 않는다. stable-source 및 cache-lifetime 프로필은 유지한다. package-default 선행조건을 공유 엔진 등록에서 제거하되 실제 패키지 입력·출처·IPC·설치 수용은 유지한다.
자기 대입/undefined 소켓 비교, 잘못 구성된 다른 home fixture 단정, 전체 core integration-test 파일 목록 고정, 내부 catalog 호출 횟수 고정, 패키징 도구가 이미 검출하는 provider 누락 전용 케이스는 삭제한다. 다른 행동 검사와 제품 코드에는 손대지 않는다. 제거된 일반 상태·직렬화·저장소·PTY 묶음의 상시 자동 검증은 대체 테스트로 재생성하지 않는다.
조기 Cargo 준비의 중복 선택 목록도 제거하고 runner의 부수효과 없는 selectedScopes 정의를 공유한다. 동일한 목록을 테스트에서 자기 비교하지 않고 기존 인자전달 검사에서 독립된 필요한 필터와 제외 범위를 확인한다. 검증은 기존 source/recipe/runner 테스트와 실제 선택 함수 이름의 정적 대조로 제한한다. Rust 소스가 변하지 않아 전체 제품·네이티브 재컴파일은 선택하지 않으며 실제 시간 절감은 미측정으로 보고한다.


## 완료·검증 결과
- appserver의 Windows 기준 Cargo 선택 17개를 정확한 필터 5개로 줄였다. handoff는 넓은 prefix의 정적 선언 31개에서 6개로 선택을 제한하고 core libtest target을 제외했다. 원본 Rust 테스트 본문은 유지하며 기본 빌드 선택만 축소했다.
- 초기 Cargo 준비도 runner의 같은 selectedScopes를 사용하도록 고쳐 제거한 범위를 미리 준비하지 않도록 했다. 무의미한 자기 비교·내부 호출 수·전체 파일 목록 고정과 중복 provider 누락 검사를 제거하고 package-default 전체 묶음을 engine 필수 선행조건에서 제외했다. 제품 최종 패키지 수용 조건은 유지했다.
- 기존 Node 테스트 80개와 Python manifest 정책 테스트 9개 모두 통과, 실제 종료 코드 0. package 테스트 파일의 구문 검사, 선택한 Rust 함수 선언 11개 정적 대조, 변경 feature inventory 검증 및 diff 공백 검사 통과. Windows x64에서 수행했으며 mocked OS 분기 검증은 해당 OS의 네이티브 수용 증거가 아니다.
- 실제 Rust 테스트 실행·제품 컴파일·빌드 시간 재측정은 수행하지 않았다. 일반 상태·저장소·직렬화·PTY 등 자동 검증 범위가 의도적으로 줄었으며 동등한 대체 검증을 주장하지 않는다.
- 독립 검증 결과는 11-native-test-trim-verification.json, 정리 영수증은 12-native-test-trim-cleanup.json. 임시 run 자료 46,162 bytes를 검증된 maintenance_owner로 삭제하고 실제 경로 부재 및 lifecycle finalized를 확인했다. 남은 작업용 임시 자료는 없다.
- 기존 dirty/untracked 변경과 겹치므로 파일 전체 staging·commit은 수행하지 않았다.

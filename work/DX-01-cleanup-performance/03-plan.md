상태: 소스 구현·Windows native 137개 회귀 검증·생성물 삭제와 부재 확인 완료. 설치 앱은 변경하지 않음.

# Catalog의 개별 기록 누락과 검사 범위

- 권한: 사용자는 다른 레코드의 누락·손상으로 참조를 확인할 수 없어도 무시하고 삭제하도록 결정했다. 확인하지 못한 소비 참조가 실제 존재할 가능성을 허용한다. 삭제 대상 자신의 소유·구성·종료 증거는 계속 필요하다.
- 범위: native producer_registry_v1 관측의 공통 Windows/Linux/macOS 정책. 실제 회귀는 Windows x64/MSVC/Rust 1.95.0. 제품 전체 빌드·설치·배포, Node writer의 등록/소유 이관 정책은 변경하지 않는다.
- 변경: 개별 JSON 읽기 실패·형식/필드 오류는 관측에서 제외한다. 읽을 수 있는 정상 레코드의 전역 참조 검사는 유지하고, 실제 member 경로/권한 검사는 선택 owner로 좁힌다. owner가 누락·손상되면 삭제할 소유 근거가 없으므로 차단한다.
- 보존: catalog root/listing/lock, 중복 ID, 비 JSON 중첩 구조, 유효한 기록의 관측 중 바이트 변경, 정상 소비 참조, 대상의 권한/링크/보호 검사, durable intent/result. force 삭제·잠금 우회 없음.
- 소유/순서: root는 계약·src/registry.rs·embedded 회귀·문서·동결/실행/정리를 소유한다. catalog_parse_reuse worker는 tests/registry.rs만 소유한다. 테스트 입력은 통합 후 동결하며 컴파일 중 변경하지 않는다.
- 검증: 기존 helpers와 request-local parser cache를 재사용한다. 개별 불량/누락/거부 기록 무시 후 실제 삭제, 정상 inbound 보호, owner 불량 차단, 무관한 member 권한 검사 미실행 및 대상 검사 유지. 기존 전체 crate library mandatory check로 mutation/lock/Windows 삭제 회귀 보존.
- 생성물: 실행 전 고유 lifecycle로 source/target/temp/log/report를 계획 등록. 실제 종료와 결과를 검토하고 필요한 요약만 본 문서에 보존한 뒤 native register/review/apply와 finalize로 삭제·부재 확인. 기존 archive 승인본은 변경하지 않는다.
- task commit은 이번 소유 변경만 포함하고 기존 staged/working 변경을 보존한다. .git/dx03-plan-body.md는 할당 후 즉시 삭제한다.

## 실행 준비

- 소유 run `run:DX-03:mvp28ir8`, 경계 `artifacts/tasks/zmvp28ir8`를 생성 전에 pending/incomplete로 등록했다. 이전 archive는 읽거나 변경하지 않았다.
- 일반 engine capture는 대상 디렉터리 부재로 한 번, frozen Git object indexing의 `spawnSync git EOF`로 한 번 실패했다. 이를 성공한 동결로 취급하지 않았다. 복사된 자료는 준비 자료로만 사용하고, 실제 컴파일되는 crate·로컬 utils/process 의존성과 workspace manifest/lock/toolchain/config 31개 파일을 현재 primary에서 다시 읽어 일치 확인하고 고정했다. focused 입력 SHA `c27370bd25c76ea92fa6f07e7f3f0ffbca1c17b143b72dbec802f0e2751f6f09`. 제품 provenance 수용을 의미하지 않는다.
- 첫 native check는 Windows 환경의 PATH 키 중복으로 Cargo를 시작하지 못했다(`not-started`, ENOENT). PATH 키를 하나로 정규화한 뒤 같은 고정 입력으로 재실행했다. 아직 시작하지 않은 producer를 중복 실행하지 않았다.
- capture helper는 독립 Git metadata가 준비된 경계를 전제로 하는데 이를 준비하지 않아 primary 조상 Git의 mixed reset이 실행되었다. 기존 staged 추가 파일 4개의 staging 해제를 발견해 원래 존재하던 Git 객체로 즉시 복원했다. working 내용은 변경하지 않았다. 전체 17,504개 index 중 이전 작업 소유 7개를 제외한 17,497개 엔트리의 SHA `db49d5d1bb2fce71d88e23c805a5390ded976c971f6e41e9be491a7a8143c3e5`가 이전 승인 작업 기록과 정확히 일치해 원상 복구를 검증했다. 최초 index-before 관측은 복원 전 상태이므로 보존 증거로 사용하지 않는다.
- 신규 source 회귀는 다른 producer의 physical member 접근을 실행하지 않는지와 owner의 warm-cache 권한 검사를 유지하는지 확인한다. 읽는 도중 관측된 내용 변경은 누락 허용과 구별하여 계속 차단한다.
- 초기 `.git/dx03-plan-body.md` 부재 확인 완료. task commit용 `.git/dx03-task.index`는 생성 전에 제어 파일로 선언하고 commit 직후 일반 삭제·부재 확인한다.

## 검증 결과

- `node scripts/check-project-maintenance.cjs <frozen engine> --stage library`: Windows x64/MSVC, Rust 1.95.0, release, locked/offline. 실제 exit 0, 137 passed / 0 failed / 0 ignored. type-check exit 0(24.818초), nonzero selection 137개 exit 0(101.271초), 실제 테스트 exit 0(85.503초). 전체 211.665초이며 준비와 실행을 포함한 검증 시간이다. 별도 성능 개선율을 측정한 결과는 아니다.
- 개별 malformed JSON·필드 누락·읽기 거부·읽기 전 사라진 다른 기록이 있어도 review/apply와 실제 두 파일 부재를 확인한다. 정상 inbound consumer가 혼재하면 삭제를 차단하고 파일을 보존한다. owner의 오류·부재·읽기 거부, 중복 ID, catalog 구조·잠금, 대상 권한·링크·durable intent/result 회귀는 유지한다.
- 다른 producer의 member 물리 경로·권한 callback이 호출되지 않고, 선택 owner의 cache hit 경로/권한 검사가 반복됨을 검증했다. 관측 도중 metadata 또는 읽은 바이트가 변경되면 누락으로 취급하지 않고 차단한다.
- 동결된 31개 입력과 primary의 현재 bytes가 모두 초기 선택 SHA와 일치했다. rustfmt --check 및 scoped git diff --check exit 0. Linux/macOS native 실행과 설치 앱 반영은 수행하지 않았다.
- 원시 로그 `artifacts/tasks/zmvp28ir8/logs/library-2.log`, 상세 결과 `reports/verification.json`을 검토했다. 본 기록에 독립 요약을 보존했으며 원시 로그·동결 사본·target·fixture·임시 자료는 아래 정리 결과에 따라 삭제한다.
- commit 전 복원된 전체 index에서 이번 소유 4개 경로를 제외한 17,501개 엔트리 SHA `f38564921fb0638962def2d1d539a1c5c6db954dfc9ab7734bc3d0898b7bc7f7`를 고정했다. 기존 staged 추가 4개와 무관한 working 변경은 commit에 포함하지 않는다.

## 정리 결과

- native inventory로 등록한 이번 단일 run의 논리 크기는 404,230,176 bytes였다. fresh registered review의 blocker/reference는 없었고 소유·구성·종료가 확인되었다.
- explicit apply 결과 aborted=false, group/item deleted, remaining=false, deletion error=null, attributes=[]를 확인했다. attempt `attempt-54328-3045-1793008242236`. 물리 회수량은 도구가 null을 반환하므로 주장하지 않는다.
- `artifacts/tasks/zmvp28ir8`의 실제 부재를 확인했다. supported finalize는 finalized, remaining/references/blockers=[]이며 producer registry 파일도 실제 부재다. 동결 사본·Cargo target/pending·OS temp/fixture·실행 준비 자료·원시 logs/reports를 모두 정리했다. 이전 사용자 승인 archive는 변경하지 않았다. 보관 승인 대기나 잔여 예외는 없다.

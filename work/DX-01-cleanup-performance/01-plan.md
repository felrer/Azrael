상태: 최적화·성능 비교·123개 회귀 검증 완료. 생성물은 사용자가 승인한 이번 보관 예외로 archive에 이동 및 부재 확인 완료.

# 삭제 도구 최적화와 전후 시간 비교

- 요청/권한: 삭제 도구 구현을 최적화하고 같은 조건에서 개선 시간을 측정·보고한다. 필요한 집중 테스트 컴파일과 fixture 삭제는 포함하며 제품 전체 빌드·설치·배포는 포함하지 않는다.
- 보존 계약: 현재 권한 callback, source/user 보호, 전체 producer 유효성, 신규 consumer 감지, 경로/링크 identity, durable intent/result, 부분 실패·취소·미확인 결과를 유지한다. TTL 또는 변경 감지 없는 캐시는 사용하지 않는다.
- 범위: 주 checkout engine/codex-rs/project-maintenance 및 필요한 기존 권한/검증 소유자. 공통 Rust 로직이며 Windows x64 실제 회귀와 전후 성능 비교. Linux/macOS 의미는 보존하고 해당 OS 실기기 실행 여부는 별도 보고.
- 기존 상태: 설치 w13r는 별도 frozen source로 실행 중이다. 최적화 검증은 현재 개발 소스를 컴파일한 동일 native 진입점으로 수행하며 설치 앱 반영으로 주장하지 않는다. 소스의 무관한 paths.rs/background_command와 다른 작업 변경을 보존한다.
- 조사: 반복 catalog 재검증·ancestor metadata·manifest 재저장 비용을 확인하고 기존 구현·표준 기능을 우선 재사용한다. 데이터 형식/복구 계약을 바꾸지 않는 최적화를 우선한다.
- 순서/소유: root가 설계·구현·비교 benchmark/통합 검증·정리를 소유한다. 읽기 전용 agent는 지정된 mutation/durability 테스트 계약만 조사한다. 기준 binary 측정을 먼저 준비하고 이후 변경 binary와 동일 fixture·명령·profile·대상에서 비교한다.
- 검증: 동일 fixture seed/항목 수/등록 상태로 전후 각각 2회 측정. 준비·등록·review·apply와 실제 native 전체 시간을 구분하고 cache 조건을 명시한다. 새 보호 회귀와 crate 기존 회귀를 실행한다. 정확한 방법은 코드 조사 결과에 따라 보충한다.
- 생성물: 실행 전 고유 lifecycle에 frozen inputs/compile target/fixture/로그/report 경로를 기록한다. 원본 프로젝트 관리 상태에는 실험용 데이터를 넣지 않는다. 원본 변경/설치 없이 자체 fixture만 삭제한다. 검증 종료 후 임시 자료를 즉시 정리하고 실제 부재를 확인한다.
- 완료: 보호 계약 회귀 통과, 비교 가능한 전후 실제 측정·exit 확인, owning 문서 일치, 임시 자료 정리, 이번 변경만 task commit. 상세 결과는 본 문서에 독립 보존한다.
- 계획 할당 제어 파일 .git/cleanup-performance-plan.body.md는 할당 직후 일반 삭제·부재 확인한다.

## 실행 범위 확정

- 상태 JSON을 compact 직렬화하고, durable result와 최종 관측 및 묶음 상태가 동일할 때만 세 번째 저장을 생략한다. catalog/ancestor 관측 캐시는 도입하지 않는다.
- 작업 run `run:DX-01:cleanup-20261026070935`, 소유 루트 `artifacts/tasks/x0709351aeb`: frozen 입력, release Windows x64 native 실행기, Cargo target/pending/OS temp, fixture, 로그/report/controller를 포함한다.
- 기준 frozen 입력 SHA-256 `2fcce7f772adaad6296e736430dc32e7437e8afdffdc78af61440391184b7bde`. 기준 compile actual exit 0, 40.147초.
- 비교 fixture는 단일 묶음 48개 파일, 합성 과거 결정 1,012건(건당 관측 32개), 최초 manifest 9,238,646 bytes. 실제 native register/review/apply를 사용하며 합성 이력은 새 fixture에만 기록한다. 실제 프로젝트의 producer catalog 비용을 포함하지 않는 상태 저장 중심 비교다. 전후 각각 2회, 같은 profile/target/seed, OS cache 초기화 없음. 각 프로세스 시작부터 종료까지 측정하고 실제 48개 부재와 결과를 확인한다.
- 저장 변경은 독립 sol_executor가 소유한 세 파일로 한정했고 root가 통합 검증한다. 기존 read-only 계약 조사도 완료했다.

- 검증 중 공용 Cargo target이 경로가 다른 frozen 소스에서 동일 binary를 재사용한 것을 SHA-256 및 144회 commit으로 발견했다. 최초 after 측정은 성능 결과에서 제외한다. 별도 소유 `temporary/target-after`로 최적화 소스를 다시 컴파일하고 새 fixture에서 2회 측정한다. 기준 2회 결과는 유지하며 무효 실행 종료도 확인한다. 이는 기능 변경이 아닌 측정 입력 교정이다.

## 성능 비교 결과

- 환경: Windows x64, Rust 1.95.0 (59807616e 2026-04-14), target x86_64-pc-windows-msvc, release (optimized + debuginfo). 준비/컴파일/fixture 생성은 apply 시간에서 제외한다. 같은 seed와 이력 수를 사용하며 절대 fixture 경로 길이에 따른 초기 manifest 차이는 240 bytes이다. 전체 producer catalog 비용은 비교 범위 밖이다.
- 변경 전 apply: 57.488309 / 53.111955초, 평균 55.300132초. 변경 후: 51.220071 / 47.816438초, 평균 49.518255초. 평균 5.781877초(10.46%) 단축. 2회씩의 관측이며 통계적 유의성이나 실제 프로젝트 전체 속도로 확대 주장하지 않는다.
- 실제 register/review/apply 12개 호출 모두 exit 0, 유효 측정 4회마다 48개 항목의 deleted/remaining=false와 실제 부재를 확인했다(192개). 기준 commit 144회 → 최적화 96회, 최종 manifest 9,267,272 → 6,278,658 bytes. 각 회차는 새 프로세스와 새 fixture, OS cache 초기화 없음. 전후 compiler cache는 입력 재사용 오류를 방지하기 위해 분리했고 측정 실행에는 Cargo를 포함하지 않는다.
- before binary SHA-256 `01899ad7916d1725f1e397fb0d9d4d595a3f6dfcb61cbfa6496fbf515eb69904`, after `72e02facf40ab657b2427fd63e00d89a42de3afddfdaa08a288888e693fb9ce3`. after frozen base SHA `92da90c2a93c8c425352c5f209c7fdff99198bf3b792976c6eaa08ee9ef07fba`; 포맷만 반영한 tests/contracts.rs SHA `5b5526aed5cc42752f138b09096fd2beaf4f3c42161e3bfec154e28d3200c81e`. 런타임 src/storage.rs SHA `e7085cec4c80642668fc8bf5b14947a28ed56e7b866b8a08b1a628a6f7766e22`, src/apply.rs SHA `06d6d5cedd161b3121a9770202ae3d226d0164987b2d5cd61a7e170a656edbdd`. 주 소스와 검증 입력 일치 확인.
- 이후 작업 commit을 위한 임시 index `.git/dx01-task.index`와 잠금 부수 파일은 생성 전 선언하며 기존 index의 무관한 staged 작업을 보존한다. commit 종료 후 일반 삭제 및 부재를 확인한다.

## 검증 및 정리

- `check-project-maintenance.cjs <frozen after engine> --stage library`: actual exit 0; 선택 테스트 type-check, nonzero selection, 실제 실행 모두 exit 0. 전체 crate 123 passed, 0 ignored, 0 failed. 소요 165.607초. full release Windows x64 회귀이며 Linux/macOS는 미실행이다.
- 추가한 영구 회귀 3개는 최종 상태가 같은 경우의 durable 묶음 결과, 파일 재등장/관측 거부의 재저장, intent 저장 실패 시 비삭제를 검증한다. 향후 저장 최적화의 안전 계약을 보호하므로 유지한다. 기존 mutation·consumer·lock·membership 회귀도 통과했다.
- rustfmt --check 최종 exit 0, git diff --check exit 0. 이후 검증 입력과 주 소스 3개 SHA 일치 재확인. 설치/배포 미수행.
- 모든 소유 producer의 실제 종료/stdio 종료를 확인하고 완료 증거를 기록했다. 검증 요약과 입력/binary identity는 본 기록에 독립 보존하며, disposable run 전체를 native 등록·검토·삭제로 정리한다.

### 사용자 지정 보관 예외

- 사용자가 이번 작업에 한해 생성물을 삭제 대신 archive로 옮기도록 명시했다. 삭제 apply는 실행하지 않았다. `artifacts/tasks/x0709351aeb` 전체(등록 논리 크기 703,943,756 bytes)를 `archive/DX-01-cleanup-performance-20261026`으로 일반 rename 이동했다. 원래 경로 부재와 이동 전후 volume/file identity 일치를 확인했다. 기존 archive 내용은 보존했다.
- 해당 경로의 frozen source, target 2개, 실행기, fixture, 로그/report/controller를 사용자 예외에 따라 보관한다. 다음 archive 정리 요청 시 재검토한다. `archive-receipt.json` 및 원래 lifecycle 사본을 함께 보관한다.
- 기존 native 그룹은 이동 전 역사적 등록이며 삭제 성공 기록이 아니다. archive는 기존 자동 관리 경계 밖이므로 향후 삭제에는 현재 경로의 새 등록/검토가 필요하다. 원래 producer registry는 실제 원래 경로 부재 확인 후 소유자 finalize로 해제한다.

- 원래 producer registry 항목은 supported finalize 결과 finalized, remaining/references/blockers 모두 없음으로 종료했다. archive 실체와 원래 경로 부재를 확인했다. 변경은 이번 소유 파일과 문서 단락만 task commit으로 남기며 기존 staged/working 변경을 보존한다.

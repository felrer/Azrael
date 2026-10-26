상태: 전후 각 2회 속도 비교·실제 삭제 검증·승인된 archive 이관 완료. 설치 앱 변경 없음.

# Catalog 검사 범위 변경의 속도 비교

- 권한: 사용자는 이번 변경 전후 속도 비교를 요청했고, 작업 후 생성물은 삭제 과정을 생략하고 archive로 옮기도록 승인했다. 앞서 정한 전후 각 2회 측정을 유지한다.
- 대상: 변경 전 3c5ba080과 변경 후 6f6f874e의 native maintenance_dispatch. 둘 다 기존 JSON 파싱/Windows worker 최적화를 포함하므로 이번 catalog 검사 범위·누락 허용 변경만 비교한다. Windows x64/MSVC/Rust 1.95.0/release에서 측정한다. Linux/macOS와 설치 앱 반영은 제외한다.
- 방법: 동일한 64 producer/512 member/선택 파일 8개 fixture, 동일 payload와 환경/TEMP, fresh fixture로 각 2회 register→review→apply 실행. 정상 기록만 사용해 양쪽 모두 실제 삭제하도록 비교한다. apply 실행 시간과 review 실행 시간을 따로 기록하며 컴파일·준비는 제외한다. OS cache 강제 초기화는 하지 않는다.
- 소유·순서: 컴파일 owner는 고정 소스/실행기만 준비하고 root는 fixture/controller와 측정·결과 해석·archive 이관을 소유한다. 같은 host의 컴파일과 측정은 겹치지 않는다. source 및 runner 재사용 근거·실행기 SHA·실제 exit와 파일 부재를 확인한다.
- 정리 예외: 이번 고유 lifecycle의 source/target/temp/fixture/log/report 전체를 종료·참조 해제 확인 후 `archive/DX-04-catalog-benchmark-20261026`으로 동일 볼륨 ordinary rename한다. 삭제했다고 보고하지 않는다. archive는 사용자 요청에 따라 보존하며 다음 명시적 archive 정리 요청 때 재검토한다. 이동 전후 디렉터리 identity와 원래 경로 부재를 확인하고 원래 producer는 지원 finalize로 마무리한다. 이전 archive는 변경하지 않는다.
- 실제 결과는 본 문서에 독립 요약한다. 소스/기능 변경 없이 이번 기록만 task commit한다. 계획 할당용 `.git/dx04-plan-body.md`는 사용 후 일반 삭제·부재 확인한다. 기존 staged/working 변경은 보존한다.

- 소유 run `run:DX-04:mvp33bkk`, 생성물 경계 `artifacts/tasks/bmvp33bkk`를 생성 전에 pending/incomplete로 등록했다. 측정 순서는 before1→after1→before2→after2로 교차한다. 동일 길이 fixture 경로를 사용하고 정상 무관 기록 63개/504개 파일의 보존도 확인한다.
- compile owner는 windows_delete_worker이며 root controller는 `controller.cjs`를 소유한다. 두 실행기 준비·컴파일 종료 후 root가 측정을 시작한다. controller 구문 검사 exit 0.
- 지정 revision의 lockfile은 이미 선언된 codex-utils-process 의존성이 빠진 상태이므로 지난 native 검증에 사용한 현재 보정 lockfile을 양쪽 동일하게 고정한다. 첫 준비에서 이 lock과 과거 protocol manifest 조합은 --locked 업데이트 요구로 compile exit 101(5.035초)을 반환했다. 입력을 수정해 성공으로 취급하지 않고 실패 receipt를 보존했다. 새 입력 identity에서는 protocol manifest도 두 side 동일한 현재 bytes로 선택해 일관성을 복원한다. macOS 전용 선언은 Windows 비교의 독립 변수가 아니며 registry.rs만 side별로 구분한다. primary 파일은 변경하지 않는다. 상세 입력 SHA와 공통 교정은 compile receipt로 보존한다.

## 측정 결과

- 양쪽 release/MSVC focused example compile exit 0, before 30.462초/after 30.929초. 컴파일과 준비는 아래 성능 통계에 포함하지 않는다. 실제 의존 closure는 변경 없이 유지했고 두 side의 차이는 registry.rs뿐이다. closure SHA: before `6e631fb5511039ebcd4adee3fe80e9b1b6bcfc79644bf1c6fcd84ee9b9a22c99`, after `29542de5942b7d2d8008b168339fc88ea54aa166174a77c314e05908986f8a0f`.
- 실행기 SHA: before `b2ccefec1898f4d4a72c690d95be413be02309d1d356b3f18eea48e54c9a263b`, after `ef4b37753cf51c599b7b83f744232969ea73099b74d743cca0dbd34baa998bab`. controller SHA `71fcb711133f400e4f2a9cc26496c9fc9b6321c2e9e9a4f6f3e00ba73e18300e`.
- Windows x64, 정상 catalog 64 producer/512 member, 선택 파일 8개, before1→after1→before2→after2. 동일 payload·환경/TEMP·경로 길이, OS cache 초기화 없음. 손상 기록 없이 양쪽 모두 동일 삭제를 수행하므로 실패의 빠른 반환을 개선으로 계산하지 않는다.

| 단계 | before 1회/2회 (초) | after 1회/2회 (초) | before 평균 (초) | after 평균 (초) | 단축률 |
| --- | --- | --- | --- | --- | --- |
| register (준비 보조값) | 3.613286 / 3.252847 | 1.530808 / 1.429659 | 3.433067 | 1.480233 | 56.88% |
| review (보조값) | 2.544570 / 2.700051 | 0.932418 / 1.005903 | 2.622310 | 0.969160 | 63.04% |
| apply (삭제 실행) | 47.130846 / 46.077780 | 16.811075 / 17.101132 | 46.604313 | 16.956103 | 63.62% |

- 주 결과: apply 평균 29.648210초 단축, 약 2.7485배 빠름. apply는 catalog 관측·검사와 실제 파일 8개 삭제를 포함한 결합 시간이며 catalog만의 개선율로 분해하지 않는다. 각 2회 표본이므로 통계적 유의성이나 모든 실제 작업의 동일 개선율을 주장하지 않는다.
- 총 12 native 호출 actual exit 0. 삭제 결과 32개 모두 deleted/remaining=false와 실제 부재를 확인했고, 비선택 파일 504개×4회의 존재·내용 보존도 확인했다. controller actual exit 0, 147.655초(전체 fixture 준비·register/review/apply 포함). 전후 실행기 SHA는 종료 후에도 동일했다.
- 이전 소스 변경의 Windows 137개 통과 근거를 재사용하고 이번에는 소스를 수정하지 않았다. 전체 제품 빌드·설치·Linux/macOS 검증은 수행하지 않았다.
- 기존 index의 이 문서 제외 17,505개 엔트리 SHA `b7631f3402f37b92bb60098303604d6c95d4775ee951c78b911e6d1bbee0ef34`를 고정했다. 이번 기록만 commit한다.

## Archive 이관 결과

- 사용자 승인 예외에 따라 이번 생성물 전체를 `archive/DX-04-catalog-benchmark-20261026`으로 ordinary Move-Item 이관했다. 삭제 도구 실행이나 대규모 재등록·재측정을 하지 않았다. 모든 컴파일/측정 producer는 실제 종료했으며 정상 종료·참조 없음 상태를 확인한 뒤 옮겼다.
- 이동 전 물리 source/목적지 부모의 프로젝트 내 포함과 동일 볼륨을 확인했다. 이동 후 원래 `artifacts/tasks/bmvp33bkk` 부재, 목적지 존재, dev `3057815611`/ino `5629499534379088` 동일성을 확인했다. `archive-receipt.json`에 원래 경로·새 경로·승인·보존 조건·종료 결과·identity를 남겼다. 원래 producer는 supported finalize 결과 finalized, remaining/references/blockers=[] 및 registry 파일 부재를 확인했다.
- 상세 측정은 archive의 `reports/summary.json`, `reports/benchmark.json`, `logs/controller.log`; 컴파일 및 고정 입력 근거는 `reports/compile-readiness.json`, `reports/compile-input-closure-v2.json`, `reports/compile-{before,after}-v2.json`에 보존했다. 최초 실패 입력/로그도 같은 사용자 승인 archive에 포함한다. 이번 자료는 삭제된 상태가 아니며, 다음 명시적 archive 정리 요청 때 현재 소유·참조·관리 경계를 새로 검토한다. 이전 archive는 변경하지 않았다.
- 계획 할당 제어 파일 `.git/dx04-plan-body.md`는 일반 삭제 후 실제 부재를 확인했다. 승인되지 않은 잔여 생성물이나 보관 승인 대기는 없다.

상태: 소스 구현·Windows native 검증·task 산출물 정리 완료. 사용자가 승인한 필요한 선행 변경만 포함해 작업 단위 커밋하며, 전체 제품 빌드·설치·실사용 상태 형식 이관과 VSS 장기 관측은 미수행이다.

# Windows 유지관리 I/O 안정성 및 처리량

## 목표와 권한

- 사용자 요청: Windows 크래시를 최소화하는 조건에서 최대 처리 속도를 목표로 구현한다.
- 앞선 읽기 전용 조사에서 Volsnap 25 반복, C:에 위치한 C: 섀도 저장소(최대 37.2GB), 현재 섀도 복사본 없음, legacy 상태 파일 27,488,993바이트를 확인했다. 이벤트가 Azrael 결함 또는 OS 크래시 원인임을 입증하지는 못했다.
- 구현·관련 검증·문서·작업 단위 커밋은 승인됨. 전체 제품 빌드·설치·VSS 설정 변경·실사용 저장소 이관은 수행하지 않는다. 기존 사용자 및 동시 작업 변경은 보존한다.
- Windows x64 로컬 파일시스템의 대량 유지관리 I/O를 우선한다. 공통 측정 최적화는 기존 Windows/Linux/macOS 의미와 저장된 identity를 유지한다. 실제 검증은 Windows이며 다른 OS 수용을 주장하지 않는다.

## 구현 방향과 보존 조건

1. Windows 표준 백그라운드 I/O 자원 우선순위를 대량 측정·삭제 구간에 적용한다. 고정 sleep으로 유휴 처리량을 제한하지 않으며 전역 잠금의 상태 확정·해제 구간을 불필요하게 낮추지 않는다. 원래 우선순위 및 오류 처리를 보존한다.
2. 등록 측정의 전체 JSON 배열/직렬화 중간 복제를 스트리밍 SHA-256으로 대체해 peak 메모리를 줄인다. 기존 identity 바이트와 완전히 호환되어야 한다.
3. Windows 삭제의 정확한 승인 트리 경계와 반복 탐색을 검토하여 안전하게 개선한다. 새로 생긴 자식 경로를 재귀 삭제하지 않으며 ordinary deletion·링크·hardlink·속성·부분 실패·unknown 보호를 유지한다.
4. 동일 `refresh_group`에서 source·예약·구성원·보호 검사를 모두 통과한 뒤 그룹/멤버 JSON 값이 완전히 같으면 manifest 쓰기와 revision 증가를 생략한다. 실제 변화·일반 Store::save·삭제 의도/결과는 기존 동기 저장을 유지한다. 비교는 선택 그룹/멤버만 사용해 전체 상태를 추가 복제하지 않는다.
5. 분할 저장은 기존 기능을 재사용할 수 있으나 FF-01 비교에서 처리 시간이 늘어난 경우도 있어 자동 이관하지 않는다. 실사용 이관의 writer 호환/종료 전제 없이 형식을 바꾸지 않는다. Windows QoS는 시스템의 다른 작업에 우선순위를 양보하며 물리 디스크별 전역 대역폭 상한이나 크래시 예방 보장은 아니다.

## 분담과 실행 순서

- root: 계약·Windows I/O 우선순위 범위·설계 문서·고정 입력 검증·통합·커밋/정리.
- stream_measurement: paths.rs의 측정 스트리밍과 identity 보존 검사. 기존 권한·파일 안정성 검사 유지.
- windows_deletion: windows_delete.rs의 background process mode·정확한 승인 경로 삭제 및 최소 기존 테스트 확장.
- native_verification: `artifacts/tasks/fw01/runs/native1`의 producer 기록·고정 최소 workspace·원래 lock 의존성·실제 utils/process·Windows native package 검사와 task 출력 정리.
- 기존 조사 담당: 저장/삭제 경로의 실행 가능성 근거만 반환.
- 검증은 입력 확정 후 기존 native maintenance 검사 owner를 사용한다. 중복 빌드/과도한 부하를 피하고 순차 실행한다.

## 검증 및 수용

- 원래 측정 identity와 스트리밍 결과의 일치, 파일 변경 및 권한 오류 보존.
- Windows 실제 우선순위 진입/반환·실패 경계와 실제 삭제 fixture의 성공/거절/부분 실패/worker 종료 확인.
- 기존 maintenance native 회귀 및 feature 보존에 필요한 변경 범위 검사. 명령 exit, 실제 검사 수, source identity를 기록한다.
- 작은 동일 조건 fixture의 시간·메모리/IO 관측으로 방향성을 비교한다. OS 크래시 무발생 보장이나 전체 처리량 최적해를 주장하지 않는다.
- 실사용 VSS 재발 여부는 설치 후 장기 관측 영역이며 소스 검사와 분리한다.
- task-owned 로그/고정 입력/검증 출력은 owner 기반으로 정리 후 부재 확인. 최소 결과는 이 문서에 보존한다.

## 현재 실행 및 통합 근거

- 구현은 Windows 등록 측정 scope의 thread background mode, 삭제 worker의 process background mode, SHA-256 스트리밍, exact-path ordinary 삭제, 변경 없는 refresh 저장 생략으로 한정한다. CPU-only 우선순위나 고정 sleep/MB 제한은 사용하지 않는다.
- 현재 checkout 전체를 수정 전 HEAD로 되돌리거나 기존 index를 덮지 않는다. 다음 Git blob은 이번 작업 직전 해당 파일 내용으로, 자체 diff만 커밋하기 위한 기준이다: registration.rs `475ba5b61a0a6c470efa261aaad2ad7c207302c9`, lib.rs `fb7ae74ebdc6dd080e9b07d02a2d2da5ecf79f16`, groups.rs `e99289349fb9dabfdd7556648b6a1822ad424a95`, tests/registry.rs `d9866b5e6b25a296623fac70a0b31b74da7eb819`, windows_delete.rs `cff7698d90badd72024a964d991e2a00b9bbb015`, architecture `caa168e85f023ae035ddbed20ab599de20f3bbfc`, feature inventory `00d5114806cdac630cacec6a0b8db73c2b897d26`.
- native 검증 사전 준비에서 실제 cargo/rustc 1.98 실행 exit0. 최초 vendor metadata 준비는 cached source의 checksum 파일 부재로 실패했고 제품 compile은 시작하지 않았다. 기존 archive/checksum 기반으로 준비를 수정하며 실제 결과는 아래에 기록한다.

## 검증 결과와 남은 조건

- Windows x64 고정 최소 workspace에서 실제 `azrael-project-maintenance` 전체 package 검사: **258 passed / 0 failed / 0 ignored**, 실제 exit0, `selected-tests-v2` accepted=true. 원래 dependency lock identity subset과 실제 utils/process를 사용했고 고정 원본43파일/검증 입력이 불변이었다. 고정 입력 aggregate SHA256: `9900cce5f7e2eec598bb377eff34d5cae33b86636b90bf0bdd869691618092f7`.
- 명령은 기존 managed Cargo owner를 통해 `test -p azrael-project-maintenance --locked --offline -- --test-threads=2`, compile jobs2. 전체 준비 compile+검사는 777.301초이며 테스트 소요만으로 표기하지 않는다. 제품 전체 빌드·설치 검증이 아니다.
- 기능 inventory 검증 exit0, `tool.project-maintenance`에 새 I/O priority owner를 연결했다. 기존 구현 보존을 위한 library 검사 전체를 수행했으며 변경하지 않은 core/prompts/Node producer/전체 앱 검사를 이 결과로 대체했다고 주장하지 않는다.
- 제한된 실제 CLI 비교: 동일250파일/총2890바이트 fixture, baseline3회/candidate3회를 교차 순차 실행. 각 register→refresh3회→review→delete가 exit0이고 6개 payload 모두 실제 부재를 확인했다. 첫 두 비교 fixture 준비는 lifecycle role 및 managed-root 경계 때문에 거절되어 결과에서 제외했다.

| 단계 | baseline 평균 ms | candidate 평균 ms | 해석 |
| --- | ---: | ---: | --- |
| 등록 | 1345.08 | 1416.48 | 약5.3% 증가; 첫 candidate 표본 영향이 크다 |
| 변경 없는 refresh(각9회) | 140.24 | 128.31 | 약8.5% 감소; 동일 상태의 manifest 쓰기 제거 |
| 삭제 | 3836.64 | 4873.43 | 약27.0% 증가; background QoS와 정확한 삭제 경계의 비용을 포함 |

- 비교는 debug·로컬 C:·프로세스 시작 포함의 작은 표본이며 peak 메모리는 실측하지 않았다. 스트리밍 구조로 전체 JSON records/직렬화 복제를 제거했지만 고정 경로 목록은 남는다. 전체 처리량 향상, 최적해, VSS 오류 제거 또는 OS 크래시 예방을 입증하지 않는다. 안전 조건을 약화시켜 비교 수치를 개선하지 않는다.
- 기존 `windows_delete.rs`의 미커밋 `DeletionContext` 선행 구현에 이번 개선이 의존한다. 사용자가 **필요한 선행 변경만 함께 포함**하도록 승인했다. 범위는 이 파일의 기존 경로 정규화/조상·트리/속성 검사 루프를 C#으로 옮긴 선행134추가/94삭제와 이번 개선이다. 다른 파일의 기존 변경과 다른 작업의 stage는 포함하지 않는다. 선택 커밋에는 별도 Git index를 사용하며 기존 index의 대상 경로가 HEAD와 같은지 재확인한다.
- task run `run:fw01:native1`의 source/cache/binaries/raw logs 및 root-control은 pinned owner로 삭제 완료했다. logical1,304,673,609바이트 대상, apply exit0/status deleted/remaining false, attempt `attempt-32968-7306-1793873020279`, decision `b392ab23d617ea04bb16061beec6bc76f82ac615c21904545af5d0e093587844`. finalize remaining/references/blockers 모두 비어 있으며 native1과 빈 fw01 부모 디렉터리의 실제 부재를 확인했다. 물리 회수량은 null이므로 주장하지 않는다. 별도 caller 출력은 stdin을 사용해 남지 않았다.
- native run 정리와 겹치지 않도록 선택 커밋의 일시 Git 제어 파일은 `.git/fw01-commit.index`와 `.git/fw01-commit.patch`만 사용한다. 원래 `.git/index`나 다른 작업의 lock을 대체하지 않으며 커밋 후 이 작업이 만든 두 파일만 ordinary 삭제하고 부재를 확인한다.

## 기존 설계 및 근거

- [유지관리 계약](../../docs/architecture/project-maintenance.md)
- [운영 및 분할 이관](../../docs/ops/project-maintenance.md#경합-진단과-상태-분할-전환)
- [플랫폼 계약](../../docs/architecture/multi-platform.md)
- Windows SetThreadPriority/SetPriorityClass background mode는 CPU뿐 아니라 I/O·메모리 자원 우선순위를 낮춘다. 공유 잠금에서 priority inversion을 피하도록 bulk 구간만 사용한다.
- 공식 API 근거: [SetThreadPriority](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setthreadpriority), [SetPriorityClass](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setpriorityclass). 자원 우선순위는 VSS 예약 용량이나 물리 디스크의 처리량 보장이 아니다.
- 독립 검증 근거: [02-verification.json](02-verification.json), SHA256 `778fcd22f713a46cb4a836bfef1e02fdbb6c33a0d27dd86fdb51475e6113440e`. 최소 원본/frozen 입력 식별, 실제 명령·258개 결과, 개별 비교 표본과 검증 한계를 포함한다. 원시 실행 로그와 compile 출력은 이 근거를 남긴 뒤 정리한다.

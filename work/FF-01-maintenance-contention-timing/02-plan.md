상태: 완료 — Windows x64 standalone 최적화·필수 검증·전후 측정·기본 경로 전환·일회 자료 정리 완료. 구형 실행기2.7MB는 사용자 승인에 따라 workbench 서버 종료까지 보관한다.

# 유지관리 등록·검토·삭제 비용 최적화

## 목표와 권한
앞선 잠금 대기 개선과 계측의 후속 작업이다. producer catalog 반복 로드, 항목별 전체 그룹 재검토, Windows 다수 파일 처리에서 보호 의미를 보존하면서 비용을 줄인다. 검증 후 이 체크아웃의 기본 standalone 실행기를 교체하는 기존 승인을 이어간다. 전체 Azrael 앱 빌드·설치는 제외한다.

## 범위와 보존 조건
공통 코어는 Windows x64, Linux x64/glibc, macOS ARM64 로컬 파일시스템을 대상으로 유지한다. Windows 어댑터 변경은 Windows 전용이다. 이번 실제 실행 검증은 Windows x64다. 소유권·소비 참조·source fence·정확한 구성·fresh token·권한 callback 변화·partial/unknown·durable intent/result·취소 후 결과 기록을 보존한다. 잠금 반환 이후 관측 재사용은 변경 없음을 검증할 수 있는 경우에만 허용한다. 기존 staged/unstaged 변경을 보존한다.

## 조사와 실행 순서
1. catalog 관측과 삭제 경로를 독립 조사하고 root가 재사용/무효화 계약을 정한다. 표준 라이브러리와 기존 구현을 먼저 재사용한다.
2. task-owned run에 생성 계획과 고정 입력을 기록한다. 현재 설치 실행기를 baseline으로 보존하고 관련 소스의 시작 identity를 기록한다.
3. 안전한 중복 제거를 구현하고 기존 보호 테스트를 확장한다. architecture owner에는 계약이 달라지는 부분만 반영한다.
4. 고정된 focused native workspace에서 필수 package 테스트와 standalone 빌드를 실행한다. 같은 fixture 구성·state 이력·순서에서 baseline/candidate를 순차 측정한다.
5. 등록·검토·삭제 wall time과 catalog load·current review·preflight·physical delete·잠금 획득/보유 시간을 구분한다. 중첩 span은 합산하지 않는다. 개선되지 않는 경로는 실제 결과와 남은 원인을 보고한다.
6. 수용된 실행기를 versioned 경로에 게시하고 실제 기본 선택·등록→검토→삭제·잠금 대기를 검증한다. 사용 종료한 fixture·입력·target·raw log와 구형 실행기는 owner 절차로 삭제·부재확인·finalize한다.

## 성공 기준
- 관련 native package 필수 검증의 실제 exit0 및 1개 이상 실행, source identity 보존. JS 변경이 있으면 해당 adapter 필수 검사.
- 기존 owner/reference/path/권한/취소/동시성 차단이 유지된다.
- 동일 조건 전후 wall·단계 비용으로 효과와 남은 병목을 설명할 수 있다. 단회나 공유 디스크 영향은 명시한다.
- 설치 선택 identity와 실제 기본 경로 수용이 일치한다.
- 필수 문서·정리 완료, 남는 disposable은 명시적 사용자 승인 없이는 완료 처리하지 않는다.

## 현재 근거와 미확정 사항
앞선 실제 checkout에서 1,204byte 등록51.331초 중 catalog load48.645초, 3group 검토19.111초 중 load18.685초였다. 별도200항목 삭제는 current_review379.733초/전체436.546초였다. Windows4000파일 삭제는 physical90.827초·preflight14.894초/전체106.500초였다. 서로 중첩된 값이며 이전 binary 비교는 통제되지 않아 개선율의 근거로 사용하지 않는다. 이번 구현과 동일 조건 실측은 아래 근거가 소유한다.

## 확정 구현과 보존 근거
- catalog의 중복 registration source binding은 저장된 fence·정확한 owner가 같은 경우에만 하나로 묶는다. 선택한 source의 예약 검증은 이미 수행하는 두 번의 최신 source 관측에 결합하고 **두 관측 모두** 저장된 fence·raw owner를 비교한다. 다른 source는 계속 별도로 최신 검증한다. 서로 다른 saved binding은 오류다. 잠금 반환 후 snapshot은 버리고 새 바이트 비교가 필요한 파싱 결과만 유지한다. 새 revision/index 형식·writer 이관·새 read 잠금은 도입하지 않았다.
- Batch::current는 권한 callback 이후 모든 미완료 멤버·삭제된 멤버의 부재·source를 계속 검토한다. 공통 토큰·보호 근거는 전체 멤버를 사용하고 응답 복사/구성만 소비하는 한 항목으로 제한한다. 멤버 관측 캐시는 callback의 다른 멤버 변경을 숨기므로 채택하지 않았다.
- Windows worker는 기존 C# 도우미로 canonicalization·정확한 tree·정규화 루프를 옮긴다. 각 단계와 entry의 fresh ancestor/attribute 조회, junction callback, hardlink pin/count, 부분 속성 결과, 최종 일반 Remove-Item과 Worker containment를 유지한다. Rust preflight의 file identity는 SHA/JSON 문자열 대신 원래 (volume,file-id) tuple로 직접 비교한다. 새 의존성은 없다.
- 보호 조건을 누락하는 후속 최적화를 막도록 기존 unit test 안에서 선택 응답/전체 근거 동등성, saved raw owner/fence, 중복 source binding 충돌을 추가했다. 기존 callback mutation·source switch·새 consumer·Windows hardlink/junction/worker 검사를 그대로 실행한다.

## 검증과 실행 상태
- baseline snapshot과 실행기 사본을 먼저 고정한 뒤 소스를 수정했다. baseline은 기존 queued 실행기 SHA474ec68…27c3, 후보는 SHAde9a46aa…798ee다. 생성물은 pending run `run:ff1:perf2`, 새 실행기는 `version:maintenance-owner:ff01:perf-20261102`가 소유한다.
- focused immutable workspace는 원본 lock의 외부77개 package identity를 보존한다. 필수 library command `cargo test -p azrael-project-maintenance --locked --offline -- --test-threads=4`, isolateHostEnvironment=true: 실제 exit0,240pass/0fail, selected-tests-v2 accepted=true. 07:23:32Z–07:26:04Z. 이후 release exit0, 고정 source 불변. [독립 수용 근거](09-native-acceptance.json).
- 첫 full package240pass 후 wrapper의 격리/thread 설정 누락을 확인하여 종료를 관측하고 같은 compiled target에서 정확한 필수 실행을 재수행했다. 최초 결과는 성공으로 보존하되 필수 수용 근거는 후속 exact 실행이다. 중복 동시 producer는 없었다.
- baseline과 candidate는 같은 harness·depth·구성·내용·state 순서로 순차 측정했고 모든 실제 종료와 삭제대상 부재를 확인했다. 공유 디스크 영향과 단회 한계는 아래 실측 근거에 명시한다.
- version 준비 copy producer 실제 exit0와 종료를 관측한 후 close했다. 성능 비교 후 기본 pin을 전환하고 실제 기본 경로를 수용했다. 최소 근거는 사용하는 새 version의 verification에도 보존했다.

## 전후 실측과 기본 실행기
Windows x64 로컬, 각 조건 단회, 동일 harness·fixture와 history, baseline 다음 candidate를 순차 실행했다. 공유 디스크·cache·순서 영향이 남으므로 보장 개선율이나 통계적 효과를 주장하지 않는다. [전체 단계·잠금 근거](11-performance.json).

| 조건 | 단계 | baseline 초 | candidate 초 |
|---|---|---:|---:|
| producer catalog200 + 1KiB | 등록 |46.364|15.942|
| 동일 | 검토 |4.861|3.371|
| 동일 | 삭제 |11.609|9.795|
| native80항목 | 등록/검토 |1.629/0.400|1.613/0.356|
| 동일 | 삭제 |190.553|57.516|
| 4000파일16MiB | 등록/검토 |13.103/0.066|11.593/0.087|
| 동일 | 삭제 |87.770|71.717|

- catalog 등록 snapshot load16→8회, 합산33.034→15.334초. 중복 관측 횟수 감소는 코드·실측으로 확인했다.
- native80 삭제 current_review80회는 보존했고52.343→43.576초였다. 잠금 획득162회87.234→5.522초, state.commit160회44.725→3.838초 차이가 전체 wall 감소의 큰 부분이다. 이를 모두 응답 구성 최적화 효과로 해석하지 않는다. current_review의 최신 멤버 관측과 실제 저장 IO는 다음 병목이다.
- 많은 파일 삭제 preflight9.056→8.423초, physical77.969→49.499초. candidate에서는 잠금 획득 합산0.428→10.107초 등 다른 비용이 늘어 전체 wall 감소는 더 작다. 중첩 span은 합산하지 않는다.
- measurement owner18개 child 모두 actualclose/exit0와6개 targetset 실제 부재를 확인했다. [설치 전환](12-installation.json), [실제 기본 경로](13-default-acceptance.json): native stdin 등록→검토→삭제, ReadOnly/Hidden35→32, Node queue 기본600000ms에서8660.55ms 대기 후 취득, 외부6개 child actualclose/exit0. [추가 종료 관측](14-native-close.json)은 lease를 보유한 native의 정확한 Windows handle을 열고 반환 후 실제 exit0를 확인했다. 최초 보완 시도의 PowerShell 파일 실행 정책 실패(exit1)와 그때 놓친 자식 exit는 그대로 보존했다. 설정을 바꾸지 않고 좁은 인라인 -Command로 재실행했다. 기존 누락 exit를 소급 성공으로 만들지 않았다. Linux/macOS 실기기는 미검증이다.

## 보관 승인과 정리
- 다른 작업의 `scripts/serve-instruction-workbench.cjs --port 4318` 서버(PID51840)가 구형 실행기 PID40600을 `workbench.data` lease로 사용 중임을 ExecutablePath/CommandLine/CreationDate로 확인했다. 해당 작업이나 프로세스를 중단하지 않는다.
- 사용자가 `artifacts/versions/maintenance-owner-ff01-queued-win-x64-20261102`(9파일,2,704,492byte)를 **서버 종료까지 보관 승인**했다. 목적은 현재 workbench lease 유지다. 서버 종료 후 실제 process 사용·소비 참조를 재확인하여 기존 installation 참조 반환과 owner 검토·삭제를 수행한다. 그때까지 기존 정확한 installation 참조를 유지한다. 새 기본 선택은 perf 실행기다.
- run:ff1:perf2의 source/cache/target/fixture/harness/raw log **1,223,791,179byte**를 native owner의 등록→fresh review→명시 delete→actual absent→producer finalize로 정리했다. 등록120.309초·검토6.810초·삭제192.313초, controller07:40:32Z–07:45:58Z·실제 exit0. 생성했던 빈 ff1/runs·ff1 부모도 일반 삭제 후 부재를 확인했다. [종료·독립 근거](15-run-close-proof.json), [실제 정리](16-cleanup.json), [최종 검증](17-final-verification.json).
- 실제 checkout의 큰 run 삭제는 physical147.861초·preflight24.444초·catalog load17.343초가 남았다. 등록도8회 load24.446초 외 payload의 최초 내용 측정이 필요하다. 반복 최신 멤버 관측, 물리 삭제/속성 preflight와 저장 IO가 다음 최적화 후보이며 이번에는 보호 검사를 생략하지 않았다.
- 새 실행기의 source39개와 source context, pin/binary SHA·기본 capability·독립 근거 불변을 최종 재확인했다. 전체 앱 빌드·설치는 수행하지 않았다.
- 기존 staged/unstaged 기능 기반과 현재 수정이 같은 파일/의존 경계에 섞여 있어 작업 단위 commit을 안전하게 분리할 수 없다. 기존 index를 보존하고 commit하지 않았다. 원격 push는 수행하지 않았다.

상태: 구현·Windows 검증·기본 standalone 교체·실측 분석·산출물 정리 완료. 기존 동시 변경과의 의존성 때문에 task commit만 보류했고 index를 보존했다.

# 공용 유지관리 대기와 단계별 성능 분석

## 목표와 권한
- 기존 5초 실패→수동 재시도 경로를 공용 OS 잠금 반환 대기로 개선한다. 상주 daemon이나 세션 통합 서비스는 추가하지 않는다.
- 실제 등록·검토·삭제·잠금 획득/보유 시간을 분리 측정하고 다음 개선 우선순위를 제시한다.
- 구현·검증·작업 소유 fixture 정리 승인. 전체 Azrael 제품 빌드·설치·타 작업 삭제는 제외한다. 검증 후 standalone 기본 교체는 사용자 승인 완료다.
- 공통 의미는 Windows x64/Linux x64/macOS ARM64 로컬 파일시스템에 적용한다. 실제 실행 검증은 Windows x64이며 다른 OS 수용과 구분한다.

## 구현 방향과 보존
- 기존 native lease, OS file lock, Worker IPC, opt-in timing을 재사용한다. 차단 경로의 잠금 반환은 재진입 힌트이며 소유권·작업 성공/종료 증거가 아니다.
- 짧은 catalog 변경은 제한된 대기 후 정확한 현재 상태로 한 번 실행한다. 대기는 write/CAS/unknown/recovery 오류를 재실행하지 않는다.
- 전체 잠금 획득 시 부분 잠금을 반환한 뒤 기다리며, 긴 내용 측정과 실제 삭제 동안 독립 작업의 전역 잠금을 유지하지 않는다.
- fresh token, 권한·identity·참조·예약·unknown·복구 보호를 유지한다. 사용자 취소와 종료 불확실성을 성공 처리하지 않는다.
- 원래/변경 실행기로 고정 fixture의 단계별 시간을 측정한다. lock wait와 lock hold의 중첩 시간을 전체 시간에 중복 합산하지 않는다.

## 실행·인계
- root: 요구/설계, JS 연결·진단/측정, 문서·통합·최종 수용.
- 읽기 조사: 기존 대기 경계와 재사용 가능한 통지 수단 확인. 기존 OS lease 외 공용 완료 queue는 없고 daemon 추가 제외 계약 확인.
- native owner 변경 범위와 테스트는 구현 계약을 고정한 뒤 별도 인계한다. 같은 target의 heavy compile은 하나만 실행한다.
- 입력/출력/로그는 artifacts/tasks의 task-owned run으로 사전 선언하고 최소 독립 결과를 이 작업에 보존한 뒤 폐기한다.

## 수용 기준
- 실제 다른 프로세스가 잠금을 5초 넘게 보유해도 지정 deadline 안에 반환하면 caller가 재등록 없이 한 번 실행된다.
- deadline·busy·I/O·legacy marker·identity 변경·unknown 보호를 유지한다. 잠금 반환 후 재검증한다.
- 등록·검토·삭제·획득/보유의 실제 exit와 측정 결과를 확인하고 병목과 측정 한계를 명시한다.
- 관련 retained 회귀와 feature 필수 검사 실행, 작업 산출물 삭제/부재 확인. 동시 변경이 섞여 task commit 분리가 불가능하면 이유를 보고한다.
## 실제 구현·검증
- Windows x64 source/기본 standalone: SHA `474ec68c553dbea5babcdc4ebf79a84a045b7fa6d2ff3574d3ee14f4778d27c3`, 2,678,272 bytes. 최대 대기 capability는 600000ms다. 기본 선택과 설치 영수증을 maintenance→catalog 순서 아래 CAS 교체하고 정확한 새 version에 installation 참조를 먼저 설정했다.
- native 237 passed/0 failed, actual Cargo exit0, selected-tests-v2 accepted=true, 고정 입력 전후 불변. 실행 06:04:17Z–06:07:11Z(약174초). 같은 입력의 release 빌드는06:07:30Z–06:09:02Z(약92초), exit0이다. 검증 입력은 원본 package·dependency·lint/profile을 재사용한 축소 workspace이며 외부77개 의존성 identity는 원본lock의 부분집합이다.
- Node adapter/연결 검사: 최초297 pass/2개 entrypoint 준비 실패(공용 run claim5초초과). 해당2개는 caller-owned 출력 경로를 명시한 재실행에서18 pass/0fail. 후보 실제 lease13개 범위도exit0. 새 retained 검사는 capability/명시0 전달 누락, 부분잠금 보유대기, 취소 후 확정결과 유실, 전체취득 polling 재발을 방지하는 기존검사 확장이다.
- 실제 경합: baseline native 등록5134ms 후busy/exit1/전체취득53회, 후보는 잠금반환 후7022ms/exit0/전체취득2회. 후보대기중 별도maintenance lease취득성공. Node caller및native 고정OS handle종료를 관측했고 EOF취소는 wire ok:false/owner불변으로검증했다. 기존lease 프로토콜은 작업실패와CLI dispatch exit를분리하므로 실제exit0을그대로보존한다.
- 설치 후 override없는기본경로6142ms대기취득·native actualexit0, stdin 등록→검토→삭제→실제부재 확인. 상세는 [후보 수용](03-acceptance.json), [설치](04-installation.json), [실제 기본 경로](05-default-acceptance.json).
- 최초native의 테스트 handshake는 전체취득반복을전제로해 수정했고, 다음native에서발견한취소후결과저장차단은코드수정후 exactcase와전체패키지로 재검증했다. 원래 실패는 성공으로 바꾸지 않았다.
- 현재 소스와검증native입력35개hash일치. 전체Azrael앱·설치된내장도구 갱신 및 Linux/macOS실기기검증은이번범위가아니다. 기존 staged/unstaged 유지관리변경에의존하므로 이번작업만의안전한commit분리가되지않아 기존index를보존한다.

## 단계별 실측과 다음 개선
Windows x64, 각16MiB·배경native200항목, 단위초. 각조건1회다.

| 실행기 | 파일 수 | 등록 | registered 검토 | registered 삭제 |
|---|---:|---:|---:|---:|
| 이전fc02 |32|0.587|0.035|1.651|
| 이전fc02 |4000|16.664|0.041|61.002|
| 새ff01 |32|1.058|0.097|2.656|
| 새ff01 |4000|33.508|0.217|106.500|

- 전후속도개선율이나회귀율을주장하지않는다. 단회이며공유디스크에서독립producer가한동안함께실행했고, baseline의중간정리로native decision이력이추가되어시작state가완전히같지않다. 이번변경은공용대기실패/전체취득반복을줄이며등록·삭제알고리즘자체는유지했다.
- 4000파일삭제: physical_delete52.449/90.827초, normalization_preflight8.133/14.894초(이전/신규). 같은실행의global maintenance hold합은0.250/0.322초, 선택group예약은60.863/106.101초다. 선택그룹보호와전역배타성을구분한다.
- 별도200member정리436.546초에서는current_review200회379.733초, safe_entries.pre_intent200회382.688초가중첩되며, 물리삭제8.659초·상태저장16.275초다. 최초commit주원인추정은이계측으로정정했다.
- 실제checkout 정리 추가계측: 1,204byte 묶음 등록51.331초 중 registry.catalog_snapshot_load16회 합48.645초, reservation.verify_sources7회 합39.308초가 중첩됐다. 2.68MB 구형version 등록57.324초도 catalog snapshot16회51.065초가 지배했다. 3group review19.111초 중 snapshot load6회18.685초다. 작은payload에서도 비용이 커서 공용관리기록 반복관찰이 실제사용의 우선병목이다.
- 1순위후속: producer catalog snapshot을 같은등록에서16회 다시읽는경로. revision/변경근거 기반으로 재사용할 수 있는 경계를 설계하되 현재 source fence·owner proof·consumer 참조·권한 보호를 보존해야 한다. 기존 연속잠금구간 snapshot 재사용과 달리 잠금반환을 넘는 재사용은 새 검증근거가 필요하다.
- 2순위후속: apply::safe_entries가매항목GroupBatch::current의전체group검토를다시만드는경로. 현재구성/참조/재등장/권한callback변경을검증하는계약을보존하면서선택항목·변경근거의재사용가능범위를설계·검증해야한다. 단순검사생략은현재권한이아니다.
- 3순위후속: 파일수가많은Windows normalization_preflight/실제삭제의반복경로·속성조회와트리검증비용. 기존worker프로세스재사용은이미있으므로재기동최적화만으로설명하지않는다.
- 4순위후속: 최초등록의내용측정. unchangedgroup은재등록하지않고refresh_group/registered흐름을유지한다. 새측정캐시나내용검사축소는이번에추가하지않았다.
- 등록/검토/삭제wall과중첩span을더하지않는다. 수치·PID/path/operation/event별집계·실패복구·측정한계는독립 [실측 결과](02-measurement.json)가소유한다.

## 정리
- 최소수용근거는이work와사용중새version verification에존재한다. root run `run:ff1:r1`, 실행기검사에서생긴정확한cargo-cache-tests run, 사용종료fc02 version을기존native owner로등록/refresh→freshreview→명시delete→실제부재→finalize한다.
- 실제기본경로수용과모든baseline측정child종료후구형installation참조만해제했다. 다른참조·권한·잠금·unknown보호를우회하지않는다. 진행과실제결과는 [정리](06-cleanup.json), 독립종료근거는 [proof](07-cleanup-proof.json)에보존한다.
- 실제결과: 2026-11-02 06:26:32Z–06:36:30Z(약598초), controller/native각단계actualexit0. root run1,318,176,459byte·정확한추가test run1,204byte·구형version2,682,062byte를모두deleted/remaining:false·실제부재·producerfinalize로확인했다. 합계1,320,859,725논리byte이며물리회수량은측정하지않았다. 별도일회controller8,033byte와빈ff1상위폴더도일반삭제·부재확인했다. 새실행기와최소수용근거외남은disposable대상은없다.
- 실제checkout의첫등록은OS queued wait10.088초를거친뒤성공했다. apply3group 전체298.830초 중 physical_delete191.979초, catalog snapshot62.065초, normalization_preflight22.198초다. groupreservation3개의보유시간합은서로중첩하므로전체실행시간으로합산하지않는다.

상태: 구현·고정 후보 native 검증·전후 측정·기본 standalone 전환·실제 기본 수용·일회 자료 정리 완료. 사용자가 현재 다른 세션의 작업들이 사용하는 이전 storage 실행기를 해당 작업 사용 종료까지 보관하도록 승인했다. 이 제한된 보관 예외를 반영해 작업을 완료했다.

# Catalog 관측 비용 최적화

## 목표·권한·범위
사용자가 요청한 다음 병목인 Catalog 관측을 개선한다. 앞선 FF-01 기록과 기본 standalone 갱신 승인을 이어간다. 전체 Azrael 앱/내장 엔진의 빌드·설치는 포함하지 않는다. 공통 Rust 로직(Windows x64, Linux x64/glibc, macOS ARM64 대상)을 수정하되 이번 실기 검증은 Windows x64다.

## 현재 계약과 변경
소유·새 소비 참조·source fence와 raw owner, 누락/잘못된 레코드 처리, 중복 ID 차단, 권한 callback·경로/링크 검사 및 실제 바이트 전후 비교를 보존한다. metadata 시간만으로 내용 읽기를 생략하거나 writer generation/index 형식을 새로 도입하지 않는다. 잠금 반환 후에는 최신 바이트를 다시 읽는다.

registry.read에서 이미 얻은 checked_metadata 결과를 사용하여 같은 경로의 별도 metadata 재조회 두 번을 제거한다. Catalog snapshot은 요청/연속 잠금 epoch 안의 Rc로 공유하고, 같은 검증된 레코드에서 역참조 색인을 만든다. 관련 owner/consumer의 정렬·중복 의미와 canonical hash를 유지하면서 전체 map 복사·반복 검색·canonical JSON 복사를 줄인다. payload/ancestor 조회 결과를 다음 관측에 캐시하지 않는다. 기존 표준 라이브러리 BTreeMap/BTreeSet/Rc 및 serde_json을 재사용한다.

## 실행·의존 관계
root는 계약·registry 구현·통합·문서·최종 수용을 소유한다. read-only 조사자는 Node writer와 기존 테스트 계약을 확인한다. 검증 준비 owner는 단일 run:ff1:catalog4 안에 baseline binary/source identity와 원본 lock 의존 폐쇄를 고정하고, 수정된 후보가 동결된 후 정확한 native 전체 package 검사와 release를 순서대로 실행한다. 측정은 같은 harness, fresh 같은 깊이 fixture, task-owned AZRAEL_STATE_ROOT에서 baseline/candidate를 직렬 실행하며 compilation과 디스크 부하를 겹치지 않는다. 실제 command close·exit와 단계별 시간을 기록한다.

## 성공 기준과 검증
- 새 소비자/직접 바이트 변경/같은 크기·mtime 복원/owner 변경/권한·link/중복 ID·실패 관측이 감춰지지 않는다. 기존 native registry/group/contention 검사를 보존하고 재발 가능한 cache/index 실수를 막는 최소 회귀 사례를 추가한다.
- 정확한 필수 native package 검사 `cargo test -p azrael-project-maintenance --locked --offline -- --test-threads=4`를 managed owner, isolateHostEnvironment=true로 실행하고 실제 비영 테스트 결과·exit0·고정 입력 불변을 확인한다. 이어 명시된 standalone release를 빌드한다.
- 대표 producer catalog(200개 배경 기록 + 작은 소유 묶음)에서 실제 native 등록·검토·삭제, 전체 wall·catalog load/hit·잠금 대기를 분리한다. 바이트 재관측은 유지하며 개선율을 보장하지 않는다. 큰 catalog 및 작은 조건의 추가 필요는 최초 결과로 판단한다.
- 검증된 versioned standalone을 기본 pin으로 전환하고 실제 기본 경로 등록/검토/삭제/lease를 수용한다. 실제 내장 앱 적용과 구분한다.
- 독립 최소 근거를 work와 version verification에 보존하고 모든 일회 source/cache/target/fixture/harness/log는 기존 owner 등록·검토·명시 삭제·부재/finalize로 정리한다. 기존 실행기가 사용 중이면 실제 소비자와 범위·크기를 확인해 기존 보관 승인 조건 또는 필요한 명시 승인을 적용한다.

## 변경 소유·보존
현재 registry.rs와 관련 owning 문서에는 이전 미커밋 기능이 있으므로 보존한다. 전체 파일을 다른 작업과 섞어 커밋하지 않는다. 이번 논리만 검증된 입력과 동일하게 분리할 수 없으면 작업 단위 커밋을 만들지 못한 사유를 기록한다. immutable build 입력은 실행 중 갱신하지 않는다.

## 구현·준비 근거
- product 변경은 registry.rs 내부뿐이다. checked_metadata의 같은 검사 결과를 사용하고 원래 전후 전체 바이트 읽기·callback·조상 검사를 유지한다. Rc<CatalogSnapshot> 공유와 BTreeMap/BTreeSet 역참조 색인, canonical Value 빌림으로 map 및 JSON 복사를 줄였다. 디스크 변경 감지 색인이나 writer 형식 변경은 없다.
- 새 색인 검사 1개는 관련 ID 정렬·자기 참조·여러 동일 대상 참조·owner 없는 대상의 canonical 직렬화/fence가 기존 전체 순회와 같음을 검사한다. 기존 member callback 변경 검사를 같은 길이 owner 변경+mtime 복원으로 강화했다. 후속 최적화가 metadata만 신뢰하거나 중복 참조를 중복 기록하는 실수를 반복할 수 있어 유지한다.
- baseline binary f98ae805137e50035a475b2873e7ee5ab71b45c4a9e513ce5a60203625bceb00 및 baseline registry c41cdbe83dd7973607ff5d042cc4fa5c5ae051602fd6da97430519c77e305fb0를 수정 전에 고정했다. 후보 registry c8c4e6cc18f6cac96d4524b8c71be7a8f5756d40c069feec92a2c21048a691e0, 후보 입력 aggregate f9071c68df8f87984abe48add0a363c8749f9e60a2fce5d4b67fba08030c21ce다.
- focused metadata 실제 exit0, 원본 lock SHA28ba826e…9711e의77external/79total identity subset 및 focused lock b7e5a8e…aef8681를 보존했다. manifest-only scaffold는 resolver 준비만으로 분리하고 실제 고정 package/utils-process 소스를 다시 검증했다. 첫 raw graph의112external은 전체 workspace feature union이므로 그대로 복사하지 않았다. 최초 Windows cmd quoting 준비 실패는 Cargo 실행 전이었고 기존 VS 환경 script로 수정했다.
- 측정 harness는 0/200/1000 배경 producer+1KiB 한 항목이며 SHA a10b1d42efae5c8909741648a6d1e5b744e158a4fd7bdddcd7fcf9ace8d269b2다. 사전 검토에서 producer role과 native member role을 일치시키고 실제 child PID 기록을 보완한 뒤 동결했다. 각 실제 close, 기존 history·producer refs 보존과 durable deleted·pending 없음·실제 부재를 검사한다. 첫 0 조건이 실제 fixture 준비 확인을 겸한다.

## 실제 native 검증과 기준 측정
- 집중 registry::catalog_tests 11pass/0fail 및 정확한 필수 전체 package 247pass/0fail/0ignored, 각 managed Cargo 실제 exit0·selected-tests-v2 accepted다. 전체 검사는152.388초, release는32.341초·exit0이며 source 불변과 모든 producer의 실제 종료·target lease 해제를 확인했다. 집중 검사의 첫 바깥 PowerShell wrapper만 stderr NativeCommandError로1을 반환했으나 내부 managed Cargo 및 결과 script는 실제0이었다. 테스트 재실행으로 감추지 않고 이후 wrapper가 LASTEXITCODE를 명시 반환하도록 수정했다. [독립 native 근거](30-catalog-native-acceptance.json).
- 고정 candidate 실행파일은 SHA cf9cbd25713cf0a7688d4609271cfe3ec5619635fb1550b7e02e1b59608d56f1·2,817,024byte다. baseline f98 버전을 만든 소스39개와 비교하면 registry.rs 하나만 달라졌고 나머지38개는 일치한다. Linux/macOS 실제 실행과 전체 앱/내장 엔진 빌드는 이번 검증에 포함하지 않는다.
- 기준 측정은 9개 native child 모두 actualclose·exit0/null signal이며 세 fixture의 삭제·참조·history·pending 검사가 통과했다. register/review/apply wall은 catalog0:17.770/0.142/14.955초,200:34.788/5.758/35.374초,1000:110.449/20.604/66.204초다. 같은 등록의 catalog load8회는 각각0.279/18.616/100.548초다. lock_wait는 prerequisite를 포함한 취득 경과이며 baseline은 모두 acquired·attempt1, 별도 queued_wait는 없었다. 이를 실제 OS 경합 대기 시간으로 단정하지 않는다.

## 전후 결과와 기본 경로 수용
Windows x64 공용 호스트에서 baseline→candidate 순서의 조건별 단회다. [전체 독립 측정 근거](31-catalog-performance.json)에 실제18개 native close와 producer/historical reference 보존·durable deleted·pending 없음·부재를 보존했다. 처음 보고서 비교에서 JSON 경로의 backslash 정규화만 실패했고 escaped-prefix 비교를 수정한 후 동등성을 확인했다. native 측정은 재실행하지 않았다. native state의 기존 이력은 비어 있었으며 비어 있지 않은 producer historical reference의 보존을 별도로 확인했다.

|배경 기록 수|단계|전체 wall 기준→후보 초|catalog load 기준→후보 초|
|---|---|---:|---:|
|0|등록|17.770→0.793|0.279→0.245|
|0|검토|0.142→0.139|0.080→0.078|
|0|삭제|14.955→1.486|0.149→0.144|
|200|등록|34.788→14.588|18.616→14.156|
|200|검토|5.758→3.058|4.927→2.996|
|200|삭제|35.374→8.953|24.845→7.803|
|1000|등록|110.449→81.997|100.548→81.506|
|1000|검토|20.604→19.363|20.481→19.278|
|1000|삭제|66.204→47.587|56.667→46.397|

catalog load 횟수8/2/5와 snapshot hit10/0/4는 바꾸지 않았다. 새 index 준비는200개 조건에서 등록2.035ms/검토0.513ms/삭제1.232ms,1000개에서12.502/2.831/7.659ms였다. 큰 조건은 여전히 full-byte 관측과 경로 검사가 대부분이다. metadata 중복 제거·순수 참조색인 외 별도 IO/경합 변화가 섞여 있어 전체 감소를 모두 이번 최적화 효과로 단정하지 않는다. 특히 기록0개의 큰 wall 차이는 catalog load가 수ms만 달라졌으므로 최적화 성과로 주장하지 않는다. 모든 잠금 취득 attempt1이고 queued wait는 없었다. 중첩 span을 전체 wall 분해로 합산하지 않는다.

- native 계약·전후 보호 검사와 관측 개선을 수용하여 catalog-20261102 version을 준비했다. 복사 producer actualexit0·SHA 일치 후 close했고 기존 installation consumer에 새 version 참조를 추가한 뒤 catalog lease 안에서 두 pin의 기존 bytes를 CAS 비교해 전환했다. [버전 준비](32-catalog-version-preparation.json), [설치](33-catalog-installation.json).
- [실제 기본 수용](34-catalog-default-acceptance.json): normal-env parent resolver는 cf9cbd…56f1·args[]·maxwait600000을 선택했다. capabilities/lease/register/review/apply/inventory6개 actualclose·exit0/nullsignal, lease released·예약 없음, registered token 적용·실제 target 부재·durable deleted·pending 없음, 두 pin bytes 동일/불변·최종 resolver 동일을 확인했다. child AZRAEL_STATE_ROOT만 격리했으며 앱/내장 엔진은 빌드·설치하지 않았다.

## 정리·보관·최종 확인
- 모든 run 내부 producer 및 downstream consumer가 종료하여 [독립 close 근거](35-catalog-run-close-proof.json)로 run:ff1:catalog4를 close했다. source42개 및 입력 hash·native247·전후18close·실제 기본6close를 work 및 version verification에 보존했다. 일회 source/cache/target/fixture/harness/raw log 1,143,222,063byte는 [native owner 정리](36-catalog-cleanup.json)의 등록168.139초·검토9.395초·삭제284.405초, 실제 exit0 및 deleted·remaining:false였다. 실제 root 부재·lifecycle finalized·remaining[]/references[]를 확인했다. 비어 있는 task-owned ff1/runs·ff1 부모도 containment와 비어 있음 확인 후 일반 삭제했다. 논리 크기이며 도구의 물리 회수량은 null이다.
- 다른 세션의 parent12928(app desktop verify),23904·32048·56992(Node 작업)가 이전 `artifacts/versions/maintenance-owner-ff01-storage-win-x64-20261102`를 사용했다. 사용자는 해당 작업들의 사용 종료까지 이 12파일·2,915,578byte의 보관을 승인했다. 정확한 이전 installation reference를 유지한다. [implementation SKILL.md](C:/Users/felre/.azrael-ex/skills/implementation/SKILL.md)의 “obtain the user's explicit retention approval before closing the task”를 충족했다. 사용 종료 후 현재 사용·참조를 재확인해 owner 절차로 정리한다.
- 승인 반영 시 원래 parent23904는 같은 생성 시각으로 여전히 실행 중이었고, native56192/parent32496의 추가 사용도 관측됐다. 원래 승인 조건은 아직 끝나지 않았으며 추가 소비자 관측으로 승인 범위를 자동 확장하지 않는다. 조건 종료 때 모든 소비자·참조를 재확인하고 보호가 남으면 보존하며 필요 시 변경된 보관 승인을 받는다. 점유 작업을 중단하거나 종료를 추정하지 않았다. [최종 통합 확인](37-catalog-final-verification.json)은 새 binary/pin·검증 근거 불변과 일회 자료 삭제를 통과했으며 complete_with_approved_retention으로 갱신했다. 최소 근거는 현재 version verification에도 해시 일치로 복사했다.
- 변경 파일의 HEAD diff에는 이전 snapshot/epoch·reservation·recovery 기능 기반이 함께 있다(registry.rs1096추가/156삭제). 전체 파일 커밋은 다른 작업을 섞고 일부 hunk만 커밋하면 검증된 고정 소스와 달라진다. 기존 index를 보존하고 이번 작업 단위 커밋을 만들지 않았다.

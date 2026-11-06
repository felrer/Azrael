상태: 그룹 재검토 최적화 구현 중. 기존 보호·저장 계약과 standalone 갱신 승인을 이어가며 추가 사용자 결정은 없다.

# 그룹 재검토의 순수 관계·토큰 재사용

## 목표·범위·보존
사용자가 지목한 80항목 삭제의 그룹 재검토 비용을 줄인다. 매 항목의 pre-intent 재검토, 쓰기 권한 callback 뒤의 최신 전체 멤버·삭제 멤버 부재·source 관측, 원래 모델 토큰 비교와 항목별 durable intent/result를 유지한다. 최신 파일/권한 검사 결과를 다음 항목에 캐시하지 않는다. 전체 앱/내장 엔진 빌드·설치 없이 검증 후 이 체크아웃의 기본 standalone을 갱신한다.

공통 Windows x64/Linux x64·glibc/macOS ARM64 로컬 코어 범위이며 실제 native 실행은 Windows x64에서 검증한다. 이전 storage 실행기는 사용자가 이름 붙인 작업들의 사용 종료까지 보관 승인된 상태다. 새 범위의 이전 실행기 보호는 실제 사용·참조에 따라 별도 확인한다.

## 설계와 재사용
기존 std BTreeMap/Rc/RefCell, serde_json::Value와 기존 hash/json!를 재사용한다. 새 의존성·상태 형식·인증 경계는 만들지 않는다.

- Batch의 고정 멤버에 대한 순수 경로 관계 계획을 도출한다. 다른 항목의 raw id/path/source_path와 그룹 membership_source 및 map 구성/순서를 현재 State와 비교한다. 해당 관계 입력이 같을 때만 계획을 재사용하고 바뀌면 재도출한다. 동적인 참조·보호·cleanup 상태·관련 run·실제 경로/권한/부재 관측은 매번 현재 값으로 평가한다. State.revision만을 재사용 근거로 삼지 않는다. 잘못된 관계 입력은 원래 순서의 오류로 유지한다.
- 원래 토큰의 모든 입력이 같은 경우에만 순수 hash 결과를 재사용한다. runs 전체 snapshot은 같은 immutable State의 한 current 관측 안에서 공유하고 새 관측에서 전체 값을 비교한다. item 전체(unknown 필드 포함), verification, observation/measurement/recovery, config, preference revision, 두 retirement policy와 매번 새로 읽은 evidence identity를 키에 포함한다. cache miss는 기존 json! 순서·기존 hash를 그대로 사용한다. serde_json의 map feature에 따른 직렬화 순서도 바꾸지 않는다.
- combine의 전체 멤버 근거·보호 판단을 유지한다. 이번에도 선택 응답만으로 전체 그룹 근거를 줄이지 않는다. 추가 직렬화 최적화는 기존 token bytes 동등성을 검증할 수 있는 순수 범위로 한정한다.

## 소유와 순서
root는 관계 계획·lib/groups 통합·문서·수용을 소유한다. bounded worker는 새 review_reuse.rs의 순수 토큰 cache/API와 최소 검사를 소유한다. 조사자는 apply/Store 상태 경계와 기존 mutation 검사를 읽는다. native 준비 owner는 group5/native의 불변 source·offline closure·managed Cargo를, 측정 owner는 group5/measurement의 fresh fixture/harness를 소유한다. 다른 작업과 index를 보존하고 자식 재위임은 하지 않는다.

의존 복사·metadata 준비가 끝나면 baseline을 먼저 실행한다. root 구현과 fixture 준비는 독립 진행한다. 모든 product 변경이 끝난 뒤 후보를 freeze하고 집중 검사→정확한 필수 전체 package→명시 release를 순서대로 실행한다. compilation과 baseline/candidate 디스크 측정은 겹치지 않는다. 통과 후보 identity를 측정 owner에 전달하고 전후 결과 확인 후 version·pin 전환, 실제 기본 수용, 독립 근거 승격과 owner 정리를 수행한다.

## 성공 기준·검증
- 원래 token/json/fence 의미와 전체 그룹 보호, sibling mutation·같은 크기/mtime 복원·source/consumer 변화·중첩/overlap·run 보호가 유지된다. 관계 입력 변경 및 토큰 cache 키 누락을 막는 최소 검사를 추가하고 기존 group/registry/runtime 검사를 보존한다.
- 기존 mandatory command `runCargoTest(...,["test","-p","azrael-project-maintenance","--locked","--offline","--","--test-threads=4"],{isolateHostEnvironment:true,...})`의 실제 비영 test 결과·exit0·입력 불변을 확인한다. 원본 lock의 정확한 offline identity subset/일반 workspace metadata를 유지한다.
- 4/80개의 1KiB native 그룹 항목을 같은 content/config/depth에서 실제 등록→registered 검토→apply한다. apply.current_review N회, intent/result commit2N회·durable deleted·history 보존·pending 없음·실제 부재·각 child 실제 close를 확인한다. 전체 wall, 순수 관계/token 구간, current_review·저장·잠금 취득을 구분하고 중첩 합산이나 공용 호스트 단회 값의 보장 효과 주장을 하지 않는다.
- 통과 실행기를 side-by-side version으로 설치하고 normal-env 기본 resolver·pin·capabilities·lease 해제·실제 stdin 등록/검토/삭제/inventory를 수용한다. 앱 내장 엔진 교체와 구분한다.
- 최소 수용 근거를 work/version verification으로 옮긴 후 일회 source/cache/target/fixture/harness/log는 native owner의 등록·fresh review·명시 삭제·부재·finalize로 정리한다. 사용 중/불확실 material은 보호하고 승인된 조건 밖 잔여 보관은 명시 승인을 받는다.

## 기준 입력
baseline은 catalog-20261102 실행기 SHA cf9cbd25713cf0a7688d4609271cfe3ec5619635fb1550b7e02e1b59608d56f1이다. 원래 groups.rs/lib.rs/apply.rs 사본과 SHA를 수정 전에 run:ff1:group5 inputs에 고정했다. root의 새 구현은 같은 파일에 섞인 기존 미커밋 기능을 보존한다. 검증된 입력과 동등하게 작업 단위 커밋을 분리할 수 없으면 이유를 보고하고 index를 변경하지 않는다.

## 구현·실행 기록
- 기준 단회 측정: 80항목 apply 61.8695초, current_review 80회 47.961792초, state.save 160회 8.826708초, commit 160회 3.940272초. 잠금은 모두 첫 시도 취득이며 queued 대기는 없었다. 중첩 구간을 총시간에 더하지 않는다.
- 관계 계획과 wire-sensitive 토큰 cache를 구현했다. 별도 읽기 전용 통합 검토에서 순수 입력 누락·동적 검사 누락·순서/횟수 변경은 발견되지 않았다. 객체 순서와 숫자 문자열도 비교하여 원래 JSON 표현을 보존한다.
- 첫 고정 입력의 집중 library 검사는 컴파일 exit101, 테스트 미실행이다. duplicate_claims.rs의 review_single 호출에 새 선택 인자 None이 누락됐다. 해당 호출만 보정하고 원래 실패 근거를 보존한 채 새 불변 입력 attempt02로 집중→필수 전체→release를 재개했다. 이전 입력 aggregate b7edade6cf8e85ebe4ddc9bbe77d43b9401df132734625abf2eeeec49dfff258의 결과와 새 결과를 구분한다.
- attempt02 집중 검사는 실제 exit101, 96개 중95개 통과/새 회귀1개 실패다. 기존 blocker는 serde_json Value 표시로 문자열 ID에 따옴표를 포함하므로 새 테스트 기대값만 기존 형식에 맞췄다. 실패 시 실제 review를 표시하는 진단도 추가했다. 제품 보호 메시지·로직은 바꾸지 않고 attempt03에서 새 입력으로 재검증한다.

- attempt03 집중96개·필수 전체252개·release 모두 실제 exit0, Windows x64 MSVC 검증. 원본/frozen44개와 helper9개 불변. 다른 OS 실행은 미검증이다.
- paired native close12개 모두 exit0. 80항목 apply61.869469→59.818921초(-3.31%), current_review80회47.961792→45.276726초(-5.60%). current.members39.787390초가 주요 잔여이며 relations14.161ms/combine23.077ms. token별 span은 없었다. save160회8.826708→9.652319초로 변동했다. 4항목 apply1.960228→1.647022초(-15.98%). 단회·공유 호스트 표본으로 보장 효과를 주장하지 않는다.
- group-20261102 standalone side-by-side 설치와 두 pin/normal resolver 전환 완료. 기본 수용6native close 모두 exit0, executable/pin·lease 해제·등록/검토/삭제/inventory·durable/noPending 통과 후 owner 정리를 수행했다.

## 그룹 재검토 최종 수용·정리
- 38~45에 source44개 일치·필수252개 exit0·paired12/default6 native close exit0·동일 pin을 기록했다. 당시 설치 consumer revision30에는 group version 참조만 남았다.
- group5 일회 자료1,264,407,861바이트와 퇴역 storage2,915,578바이트, Catalog3,063,050바이트를 fresh owner 검토→명시 삭제→부재→finalize로 정리했다. 빈 ff1/runs·ff1 부모도 일반 삭제 후 부재 확인했다. Catalog 사용자 종료와 storage 승인 조건 종료를 재확인하여 잔여 보관 없이 완료했다.
- 44/48 누적 보고서의 finalize 당시 정확한 bytes는49~51 독립 snapshot으로 보존했고 hash mapping은52에 있다. 최소 근거는 work와 당시 현재 version verification에 보존했다.
- 실제 검증 범위는 Windows x64 standalone이며 Linux/macOS·앱 내장 엔진 수용은 아니다.
- 기존 공용 변경과 duplicate_claims.rs의 다른 staged 추가를 보존해야 하므로 작업 단위 커밋은 만들지 않았다. 검증된 전체 입력을 이번 변경만으로 분리 커밋할 수 없어 index를 유지했다.

## 후속: 최신 멤버 검사 세분 측정
상태: 사용자 요청으로 측정 진행 중. 이전 group 최적화·설치·정리 결과는 그대로 보존한다. 이번에는 검증 의미를 바꾸지 않고 진단 계측만 더하며 기본 standalone/앱 설치는 하지 않는다.
- 기존 timing logger를 재사용하고 상세 진단은 AZRAEL_MAINTENANCE_DETAIL_TIMING=1일 때만 활성화한다. group.current.members 관측마다 반복 구간을 메모리에 집계해 출력 횟수와 측정 간섭을 줄인다. 경로·요청·권한 내용 등 새 민감정보를 수집하지 않고 static 구간명/count/elapsed/max만 추가한다. 기존 timing=1 동작과 반환·오류는 보존한다.
- 실제 Windows x64에서 1KiB sibling4/80항목을 native 등록→registered 검토→삭제한다. 동일 후보의 상세 OFF/ON80항목을 fresh 같은깊이 fixture로 비교해 진단 출력 영향과 호스트 변동을 함께 기록한다. 멤버별 최신 파일·권한·예약 검사와 N 재검토/2N commit 유지, durable 결과/부재/noPending/실제 child close 확인이 성공 기준이다.
- root는 상세 logger와 lib/paths/reservation/groups의 계측 및 분석을 소유한다. 기존 native owner는 member6의 환경→고정입력→필수 검사/측정용release, 측정 owner는 fresh harness를 소유한다. 환경 준비와 계측은 독립 진행하고 컴파일과 성능 측정은 겹치지 않는다. run:ff1:member6을 생성 전에 pending run-root로 기록했다.
- 통과 후보의 44개 이상 전체 native 입력/필수 package 검사/실제 release 종료를 확인한 뒤 측정한다. 새 fixture/source/cache/target/rawlog는 run에 귀속하고 최소 근거를 work로 승격 후 검증된 현재 standalone owner로 정리한다. 기본 설치 pin은 바꾸지 않는다.

- timing.rs에 thread-local 관측별 bounded static-label 집계·중첩 복원·기본 비활성 진단을 추가했다. lib/groups/paths/reservations의 기존 순서·반환은 유지한다. 집계 누수·중첩 혼합·미활성 수집을 막는 최소 timing 회귀1개를 유지한다.

- member6 첫 집중 검사는 Rust E0509로 테스트 미실행 exit101을 보존했다. Drop을 지키는 take()로 보정한 attempt02에서 집중97개·필수 전체253개·측정용 release 실제 exit0. 원본/frozen44개와 helper9개 불변, 모든 producer 실제 종료·target lease 부재 확인. full321.130초/release117.576초의 지연 원인은 확정하지 않았다.

- 상세 native4/80/80 실제 close9개 모두 exit0. current_reviewN·commit2N·durable deleted/부재/noPending 통과. 상세80멤버54.152173초 중 live3240회46.330231초/completed3160회7.779600초. live의 예약38.351489초/내용7.968279초. 중첩 metadata19360회49.404183초(91.23%), 조상329280회45.144200초(83.37%), leaf19360회3.144293초, 권한callback348640회0.302985초. token3240회0.035175초.
- 관측 metadata 수는 live당 예약4회+대상1회, completed당 부재1회로 3240*5+3160=19360과 일치한다. 조상329280회는 실제 count이며 경로별 깊이 분포는 계측하지 않았다. 54의 균일17개 추론은 산술 오류로60에서 정정했다. 조상 구간은 경로 준비·Win32조회/fallback·결과 검사를 포함한다. 권한 callback 시간은 fixture 범위이며 내장 permission backend로 일반화하지 않는다.
- control80 apply491.790초/save351.274초, detailed80 apply97.231초/save29.007초로 호스트·순서 변화가 커서 계측 overhead나 개선율을 추정할 수 없다. 모두 첫 시도 취득·queued 대기 없음. 단일 관측에서 다른 CPU 작업이 확인됐으나 지속 부하·원인을 입증하지 않는다. 상세 계측은 진단이며 검사 축소·최적화·설치를 하지 않았다.

### 세분 측정 최종 수용
상태: 완료. 53~60에 검증·계층 집계·분석·한계·소유 정리 근거를 보존했다. 검사97/253·측정9native close 실제exit0와 N재검토/2N저장·durable부재/noPending을 확인했다. 조상 균일깊이 산술 오류만60에서 정정했으며 원시 count/time은 바꾸지 않았다.
- member6 일회 source/cache/target/fixture/실행파일/rawlog1,179,447,188바이트를 기존 standalone owner의 fresh 검토→명시 삭제→부재→finalize로 정리했다. 불변 finalize 근거58 hash 일치와 빈 부모 일반 삭제·부재도 확인했다. 잔여 보관 없음.
- 당시 기본 pin은 group-20261102/SHA31cb...dc89 그대로이고 측정용656a...1956은 삭제했다. 상세 계측 소스·운영문서만 추가했으며 최적화·검사축소·내장/standalone 설치는 하지 않았다. 후속 후보는 반복 조상 경로 순회다.
- 공용 변경과 timing.rs의 staged 추가를 보존하여 커밋은 만들지 않았다. native44개 현재 source 변경 목록은57에 기록했다.

## 후속 시도1: 조상 경로 준비 재사용 (미수용·원복)
상태: 시도1은 성능 기준 미충족으로 설치하지 않고 정확한 입력 hash 확인 후 원복했다. 아래는 시도1의 설계·검증 이력이다. 사용자 개선 요청으로 기존 반복 조상 검사에서 순수 준비 비용을 줄이고자 했다. 기존 standalone 전환 승인·소유 정리 절차를 이어가고 앱 내장 엔진 빌드·설치는 제외한다.
- Windows x64의 기존 plain short local path fast path에만 조상 목록·원래 경로 표현·UTF-16 인코딩 준비를 요청별 재사용한다. 최대128경로, 각 경로는 기존248u16 버퍼의 지원 한계 안으로 제한한다. 원시 OsString을 키로 써 slash/dot/device 표현이 Path 동등성 때문에 섞이지 않게 한다. UNC/verbatim/긴·비정상 경로는 기존 fresh fallback을 유지한다. Linux/macOS의 기존 순회는 유지하며 공통 반환·권한·보호 의미를 바꾸지 않는다.
- 실제 metadata·존재·reparse·권한 결과는 저장하지 않는다. 각 호출의 root containment 확인, 각 조상의 동일 순서 callback, callback 이후 fresh OS조회, leaf metadata와 junction 검증을 모두 유지한다. RefCell borrow는 callback 전에 놓고 Rc로 현재 계획만 고정하여 재진입·eviction을 허용한다.
- 기존 std/Rc/RefCell/OsString/BTreeMap과 기존 Win32조회/normalization-admission helper를 재사용한다. 구조적 순회 생략이나 권한/예약 확인 삭제는 이번에 하지 않는다. 새 plan/build/query 상세 구간으로 준비 재사용과 남은 실제 조회를 구분한다.
- run:ff1:ancestor7을 출력 전에 pending run-root로 등록했다. 기존 native owner가 변경 전44원본/helper9개를53과 exact비교 후 baseline을 불변복사했다. 수용된253개 검사 근거를 재사용하고 baseline release만 실제exit0으로 생성했으며, 후보는 새입력freeze·집중→필수 전체→release를 실행한다. root는paths/lib·문서·수용을, 측정 owner는 같은harness/freshfixture를 소유한다.
- 측정 순서는 baseline4/80A→후보4/80A/80B→baseline80B다. 양쪽 timing/detail을 같은설정으로 켜고 독립같은깊이/길이 fixture를 사용한다. metadata/권한/조상/leaf 검사 횟수·N current_review/2N commit·durable/noPending/실제부재·모든nativeclose를 보존하고, 절대시간·중첩구간·호스트변동을 구분한다. 컴파일과 측정 I/O는 겹치지 않는다.
- 기존 warm callback순서·callback중 조상junction치환 검사를 유지하며, 향후 raw-path키/한계/fallback 또는 실제관측캐시로 잘못바꾸는 편집을 막는 최소 pureplan 검사를 추가한다. 결과가 통과하고 개선근거가 있을 때 기존승인범위의 기본 standalone을 전환하고 실제기본경로 수용·owner정리를 완료한다. 계측용baseline/candidate와 source/cache/fixture/rawlog는 최소근거를work/설치version으로 승격 후 정리한다.
- baseline 불변44개/helper9개는53과 exact 일치하며 253개 수용 근거를 재사용했다. baseline 새release 실제exit0/35.316초, SHA02766a214a6285f51fb40ede2bfd38c4e2684e4cdfa1594218a393cfa9fc5a57. baseline4/80A 실제nativeclose6개 exit0, N/2N·durable부재/noPending 통과. 80A apply53.176621초/current_review40.319683초/members35.869119초. fixture가 이전 member6보다 한 단계 얕아 metadata19360·조상309920·권한329280회이며 후보도 동일 조건으로 비교한다.
- 독립 읽기 전용 검토에서 순수계획이 실제관측을 캐시하지 않고, callback 전 borrow해제·동일순서 fresh조회·fallback 보존에 구체적 누락이 없음을 확인했다. 후보 입력을 freeze하여 집중→필수 전체→release를 실행 중이다.
- 기록 유지 과정의 PowerShell→Node stdin 문자 인코딩 손상으로05에 생긴 물음표 문장을 기존53~60/38~52 근거와 현재 대화 기록으로 복구했다. 파일은 UTF-8로 저장하고 잔여 손상 패턴 없음 확인. 제품 입력이나 검증 근거 JSON은 바꾸지 않았다.
- 후보 집중98개·필수 전체254개·명시release 모두 실제exit0. full160.273초/release25.130초, baseline과 분리한 후보44개/helper9개 최종 불변. baseline253개 수용 재사용과 새release/provenance는61, 후보검사는62에 보존했다. 후보 SHA01c5d3a2f853f27bc8e22893b0a29bd217b8f9080e4d3b279761d3571143666d. 후보4/80A/80B→baseline80B 실행을 인계했다.

## 후속 시도2: 예약 읽기의 중복 초기 metadata 순회 결합
상태: 현재 후보 구현·검증 진행 중. 시도1은 baseline80평균61.348390초/후보65.258692초(+6.37%), 범위가 겹쳐 개선을 입증하지 못했다. 계측에서 준비 cache hit는 확인됐지만 실제 OS조회가 계속 지배했다. 결과63과 입력62를 보존하고 정확한 후보 hash를 확인한 lib/paths 두 파일만 불변 baseline으로 복원했다. 효과 없는 cache·그 전용 테스트는 최종 소스에서 제거했다.
- 현재 delta는 reservations.rs 하나다. local_group의 존재 확인 직후 다시 수행하던 read_bytes 초기 checked_metadata를 합치고, 방금 얻은 fs::Metadata를 read_bytes_observed로 즉시 전달한다. 둘 사이 I/O·callback은 없다. 일반 read_bytes는 자체 초기 관측을 유지하며 decode_record만 공용화한다. 다른 멤버·관측 구간으로 결과를 저장하지 않는다.
- 읽기 직전의 fresh 권한 callback, 파일 종류/64MiB bound, 두 번의 bounded 읽기·내용 비교, 읽기 사이 fresh path 검사, 마지막 fresh metadata identity·길이 비교, 예약 소유 및 source fence 검사를 유지한다. 중간·마지막 검사는 합치거나 생략하지 않는다. absent/owning reservation disappeared 처리는 유지한다.
- 이 결합은 Windows/Linux/macOS 공통 의미이며 실제 실행 수용은 Windows x64로 구분한다. 변경된 읽기를 후속 편집에서 단일 읽기나 identity 비교 생략으로 바꾸는 실수를 막도록 mid-write/late-write/같은바이트새identity/권한거부/정상 case 한 개를 유지한다. 기존 group/registry/예약 mutation 검사도 유지한다.
- 후보02는 baseline과 분리 freeze하여 집중98개 통과 후 필수 전체→release 진행 중이다. 독립 읽기 전용 검토를 인계했다. 새측정 harness로 fresh 후보4/80A/80B→baseline80C를 실행하고 기존 baselineA/B도 보존한다. 멤버 current_reviewN·commit2N·두 번 읽기·durable/noPending 보존과 metadata19360→16120(중복3240회 감소)을 확인한다. 조상/권한 감소 수는 실제경로/계측으로 판단하며 균일깊이를 가정하지 않는다.
- 권한과 실제파일이 바뀔 수 있는 I/O/callback 경계를 없애는 변경이 아니며, 연속된 초기 관측의 중복만 제거한다. 실제 성능 개선과 필수 검증이 통과해야 기본 standalone 전환을 진행한다.
- 시도2 집중98개·필수 전체254개·release 실제exit0, full178.626초/release27.434초. baseline/시도1 입력·실행파일은 별도로 불변 보존했고, 현재 baseline과 다른 제품파일은 reservations.rs 하나다. 수용근거72, SHAc0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680.
- 읽기 전 경합 검토에서 처음 제기된 관측 창 확대 우려는 마지막 full check 기준 재검토로 철회됐다. 현재와 baseline 모두 마지막 full check→파일 종류/크기→auth(path,Read)→open/read 순서이며, 새 I/O/callback이 사이에 추가되지 않았다. 제거한 것은 앞선 중복 초기 관측이다. 두 읽기·중간 경로·마지막 identity·소유 검증의 보존을 확인한 후 시도2 측정을 시작했다.
- 시도2 fresh native12개 close 실제exit0, 4/80A/80B/기준80C 모두 durable부재/noPending/current_reviewN/commit2N 통과. 후보80범위46.549701~50.282981초, 평균48.416341초. 기준A/B/C는53.176621/69.520160/54.605704초다. 최근C 대비 전체11.33%·current_review14.20% 감소를 관측했으며 보장/통계 유의성을 주장하지 않는다.
- 실제80 metadata19360→16120, 조상309920→254840, 권한329280→270960. 해당 예약 경로의 실제조상17개를 기준으로3240중복순회·55080조상·58320권한 callback 중복이 감소했다. 예약payload6480읽기와160commit은 유지했다. 상세 read_observed 경계는 기존read_bytes와 달라 직접 비율을 비교하지 않는다.
- 최소근거73을 바인딩한 reservation-20261102를 side-by-side 설치하고 기본pin·normalresolver 전환했다. 새 기본 수용native6close 실제exit0, 동일pin·정확한binary·lease해제·N1/commit2·durable부재/noPending 통과. 앱 내장 엔진 빌드·설치는 하지 않았다. 현재 다른 작업이 쓰는 구형 group 실행기의 보호를 유지하며 owner 정리를 준비한다.

### 예약 초기 관측 결합의 현재 수용·정리 상태
상태: 승인된 한시 보관을 포함해 완료. 구현·필수 검증·기본 standalone 적용과 임시 run 정리를 마쳤고, 사용 중인 이전 group 실행기만 사용자의 명시 승인 조건으로 보관한다.
- 시도2 source44개 현재 일치와 필수254개 exit0, 성능fresh12/기본6 native close exit0를69에 기록했다. 두 pin·normal resolver·실행파일 identity와73 성능근거 binding을 확인했다. 기본 경로 수용 후 원본/current hash도 일치한다.
- run:ff1:ancestor7 일회 자료1,413,971,099바이트를 현재 standalone owner의 등록·fresh 검토·명시 삭제·실제부재·finalize로 정리했다. 불변71-ancestor-retirement-0160b6d0.json과 hash일치를 확인했다. 빈ff1/runs·ff1도 일반 삭제·부재 확인했다.
- 잔여는 artifacts/versions/maintenance-owner-ff01-group-win-x64-20261102, 3,223,528바이트다. 관측된 부모36632/native33604가 계속 사용하므로 installation 참조를 유지하고 native defer를76에 기록했다. 목적은 해당 작업의 기존 실행기 사용 유지이며, 사용 종료 후 실제사용·부모identity·참조를 재확인하고 정확한 설치참조 해제→refresh/review→native 일반삭제로 정리한다. 사용자가 질문01a19ca0-0224-7110-bd75-484c12b48855에 해당 작업 사용 종료까지 보관을 명시 승인했다. 77에서 동일 PID·생성 시각의 현재 사용을 재확인했고78에 승인 범위와 조건을 기록했다. 이 조건이 끝나면 별도 정리 승인 없이 현재 보호·참조를 재검토해 기존 owner 절차로 삭제한다. 이전 storage/catalog 승인은 이 group 버전으로 확대하지 않는다.
- 최소 수용근거와 현재 상태는 work 및 reservation version verification에 보존했다. 공용/이전 변경과 staged 파일을 보존해야 하므로 작업 전체를 안전하게 분리한 커밋은 만들지 않았다. 앱 내장 엔진·다른 OS 실기 수용은 하지 않았다.

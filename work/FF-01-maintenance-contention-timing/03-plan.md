상태: 구현·필수 native 검증·전후 측정·기본 전환·수용·정리 완료. 일회 자료와 사용 종료 queued/perf 버전을 삭제하고 실제 부재 및 세 lifecycle finalize를 확인했다. 새 storage 기본 실행기와 독립 검증 근거만 보존한다. 작업 단위 커밋은 기존 미커밋 기반과 분리 문제로 만들지 않았다.

# 결과 저장 비용 최적화

## 변경 분리와 커밋
이번 범위는 storage.rs의 저장 준비·병합 최적화와 6개 회귀 검사, 해당 architecture/ops 문서 및 이 작업 기록이다. 현재 storage.rs의 HEAD 대비 diff에는 이전 잠금 대기·transaction·partition 관련 미커밋 변경도 함께 있다(689추가/55삭제). 이 기반을 포함한 전체 파일 커밋은 다른 작업을 섞으며, 기반 없이 이번 hunk만 커밋하면 독립 검증한 소스와 달라진다. 따라서 현재 작업 단위 커밋은 만들지 않았고 기존 변경과 index를 보존했다. 검증된 것은 작업 트리의 고정 입력 및 설치 binary다.

## 목표·권한·범위
앞선 저장 비용 계측의 후속 구현이다. 삭제 전 durable intent와 각 항목의 실제 결과 저장, CAS 병합, 동시 작업 보존, 취소·실패·pending 복구 및 legacy/partitioned-v1 형식을 그대로 유지하면서 저장 준비 비용을 줄인다. 항목별 저장을 지연·생략하거나 저장 형식을 자동 전환하지 않는다. 검증 후 이 체크아웃의 기본 standalone 교체에 대한 기존 승인을 이어간다. 전체 앱 빌드·설치는 제외한다.

공통 Windows x64·Linux x64/glibc·macOS ARM64 로컬 코어 변경이며 이번 실제 검증은 Windows x64다. 기존 다른 작업의 staged/unstaged 변경과, 서버 종료까지 보관 승인된 queued 구형 실행기를 보존한다.

## 조사 근거와 접근
직전80항목 삭제는160회 state.commit에3.838초가 걸렸다. 현재 save는 전체 State→Value, CAS merge, Value→State 재변환, 다시 Value, legacy snapshot 복사와 JSON byte 생성을 수행한다. merge의 decision 목록은 contains/find/position을 반복하므로 이력이 길면 비용이 커질 수 있다. 우선 실제 의미와 기존 테스트를 확인한다.

1. baseline 실행기·소스와 task-owned run을 먼저 고정한다. 원본 lock identity를 보존한 focused native workspace를 준비한다.
2. 중복 변환/복사와 decision 검색을 기존 표준 자료구조로 개선한다. duplicate/legacy/malformed ID 및 CAS 동작은 보존한다. 파일·권한 검사와 sync/rename 순서는 유지한다.
3. commit 총 시간 외 준비·merge·serialization·write·sync·rename을 opt-in 기존 timing으로 구분해 남은 비용을 확인한다. 잠금 대기·보유와 중첩 span을 합산하지 않는다.
4. 같은 fixture/history에서 baseline/candidate를 순차 측정한다. 실제 native apply를 통해 durable intent/result 저장 횟수·결과·부재와 정상/동시 commit을 확인한다. 필요하면 별도 순수계산 측정을 구분한다.
5. 필수 native library 검사, 고정 후보 빌드와 실제 기본 경로 수용 후 versioned pin을 전환한다. 독립 최소 근거를 보존하고 일회 fixture/cache/input/target/raw log를 기존 owner 절차로 삭제·부재·finalize한다.

## 성공 기준과 검증
- 기존 per-item durability, fresh authorization, CAS/동시 unrelated 결과와 실패/pending/취소 보호를 보존한다. 합치기 전에 반드시 요구되는 intent/result commit은 유지한다.
- 필수 package 전체 검사 실제 exit0·실행수>0, 고정 입력 전후 불변, 후보 identity와 실제 기본 선택 일치.
- 저장 단계별 전후 비용과 남은 병목을 실제 자료로 설명한다. 단회·공유 디스크 영향으로 보장 개선율을 주장하지 않는다.
- owning 문서와 작업 기록을 갱신하고 필수 정리를 완료한다. 현 사용 때문에 남는 material은 기존 승인 범위만 재사용하고 그 밖에는 승인 없이 완료 처리하지 않는다.

## 현재 미확정 사항
저장 횟수 감소·새 journal/형식·자동 이관은 이번 접근에 포함하지 않는다. 아래 구현과 검증 범위를 확정했다.

## 확정 구현·재사용·보존 조건
- 이미 설치된 serde_json1.0.149의 Value는 Eq/Hash를 지원한다. 표준 HashSet<&Value>로 전체 값 동등성 조회를 만들고 HashMap의 첫 삽입으로 원래 find/position의 첫 ID 일치를 보존한다. 임의 JSON을 다시 직렬화한 문자열 fingerprint는 수치 동등성 등에서 의미가 달라질 수 있어 도입하지 않는다. 알 수 없는 필드·legacy·null/비문자 ID·중복 ID·순차 충돌·기록 순서를 보존한다.
- save는 순수 local State→Value snapshot을 reconciliation 취득 전에 준비한다. current가 base와 같으면 불필요한 current 전체 복사를 생략한다. **merge는 항상 검증**하고 merged와 local 전체 값이 정확히 같을 때만 typed state를 재사용한다. 다르면 원래 decode/normalize 경로를 거친다. stable-ID 기록 제거가 병합에서 무시되는 동작도 유지한다.
- legacy용 logical.clone을 없애고 논리 snapshot을 직접 직렬화한다. partitioned 준비 결과만 별도 소유한다. 각 항목의 intent/result 저장 횟수, pending create→serialize→write→sync→rename과 이후 collection 순서는 유지한다.
- 기존 transaction_tests에 ID/임의 JSON/첫 일치·중복 순차충돌을 다루는5개와 실제 Store save·기록 제거·다른 writer 보존1개를 추가했다. 후속 성능 수정이 값 검증을 생략하거나 중복 ID를 단순화하는 오류를 막기 위해 유지한다.
- state.save(전체), prepare_local, merge, decode_merged/prepare_merged, prepare_partition, open_pending, serialize, write_pending, sync_pending, rename, collect_obsolete를 기존 opt-in timing으로 나눈다. state.commit은 기존처럼 취득 후 시작하며 local 준비는 밖으로 이동하므로 전후 비교는 실제 apply wall과 함께 해석한다. baseline에는 새 세부 span이 없음을 명시한다.

## 준비와 실행
- run:ff1:storage3를 pending/membership incomplete로 생성 계획에 등록하고 baseline을 먼저 고정했다. 기존 기본 perf 실행기 SHAde9a46aa…798ee, 원본 lock SHA28ba826e…9711e;77external/79total의 focused offline closure는 원본 name/version/source 부분집합이다. 실제 metadata와 도구 버전 preflight exit0이며 불필요한 넓은 cache 복사를 만들지 않았다.
- 실제 checkout의 직전 decision 이력1759개를 근거로, 합성 fixture의 history0/2000와20항목 실제 삭제를 legacy 및 partitioned-v1에서 측정한다. 각 apply40commit·20결과의 durable 기록과 실제 부재, history 전체 동등성을 검증한다. main 저장 형식·기록은 이관하거나 수정하지 않는다.
- 최초 baseline3조건은 실제 exit0 및40commit/20부재를 확인했으나 측정 harness가 AZRAEL_HOME을 사용해 preferences admission이 task-owned로 격리되지 않았다. 공유 preferences는 읽기·activity gate만 사용했고 프로젝트 상태는 합성 root였다. 최초 자료를 준비 결과로 보존하고 최종 비교에서 제외한다. 올바른 AZRAEL_STATE_ROOT와 fresh base0001/cand0001에서 같은 harness/env로 재측정한다.
- 격리 baseline 최종3조건 모두 실제 exit0·각20개 삭제/부재·40commit·원래 history 전체 동등성·최종 pending 없음이다. apply/commit 합산은 history0 6.906/0.903초, legacy2000 13.338/6.535초, partition2000 42.620/33.900초다. partition 초기 이관0.992초는 apply 밖이다. partition state.read20.919초는 commit 내부 중첩이다.
- 후보 고정 입력의 첫 전체 package 실행은 exit101(99pass/1fail/실행100)로 중단했다. library90개는 통과했으나 기존 `immediate_commit_busy_retains_reservation_when_abort_cannot_reacquire`의 예약 유지 assertion이 실패했다. 해당 fixture가120ms 후 holder를 반환하여 느린 abort가 반환 이후 실행될 수 있다. 동일 소스·환경의 해당1case 진단 재실행은 exit0/1pass였다. 기대값/소스를 수정하지 않고 정확한 필수 전체 package를 재실행하여 exit0/246pass/0fail, selected-tests-v2 accepted를 확인했다. 최초 실패와 진단 재실행은 [독립 native 근거](18-storage-native-acceptance.json)에 보존한다. 이 가설만으로 모든 환경에서 시간 민감성이 없다고 단정하지 않는다.
- 이후 같은 고정 입력의 managed release는 exit0, 후보 SHA f98ae805137e50035a475b2873e7ee5ab71b45c4a9e513ce5a60203625bceb00·2,712,064byte이며 source 불변과 실제 producer 종료를 확인했다. version storage-20261102의 복사 producer도 실제 exit0 관측 후 close했다. 성능 확인 후 기본 pin을 아래와 같이 전환했다.
- 최초 paired3조건은 모두 actualexit0/20개삭제·40commit·history 동등·최종pending없음이다. apply baseline→candidate는 history0 6.906→10.117초, legacy2000 13.338→9.913초, partition2000 42.620→31.263초다. 작은 조건 증가를 숨기지 않고 fresh B,C,C,B 네 번으로 추가 확인했다. candidate 작은 조건의 순수 prepare_local5.811ms·merge4.853ms와 달리 metadata/취득/sync 변동이 초 단위라 환경 가설을 검토했으나 원인은 확정하지 못했다. 원래3조건 자료는 그대로 유지하며 반복 비교를 별도 보존한다.

## 실측 결론과 설치 수용
- 추가 B,C,C,B 네 번은 모두 actualexit0·20개 삭제/부재·40commit·history 동등·pending 없음이다. wall은7.088/8.015/7.468/7.075초, 같은 경계의 intent+result save는2.018/2.399/2.314/2.652초다. 평균 save는 baseline2.334742초/candidate2.356370초로 작은 조건의 개선을 주장하지 않는다. 평균 wall7.081879→7.741092초 증가의 원인은 미확정이다. 새 순수 준비·병합·직렬화는 합계 수ms이며 sync 등 IO 변동이 남았다. 네 번 뒤 추가 반복은 하지 않았다.
- 이력2000에서 candidate commit/state.save는 legacy2.037/3.841초, partitioned23.321/25.263초였다. baseline commit은 각각6.535/33.900초이나 local snapshot을 lock 밖으로 옮겨 span 경계가 달라졌으므로 직접 절감률로 사용하지 않는다. 전체 apply의 관측 차이와 같은 경계 save를 구분한다. partitioned의 다음 병목은 state.read16.859초, prepare_partition2.401초, collect_obsolete2.159초이며 중첩 합산하지 않는다. [전체 비교와 반복 근거](20-storage-performance.json).
- 값·durability·CAS 보존 검증과 이력이 긴 조건의 개선을 근거로 기본 standalone을 storage-20261102로 전환했다. 작은 조건의 시간 증가와 원인 미확정은 유지한다. [전환](21-storage-installation.json), [실제 기본 경로](22-storage-default-acceptance.json): normal-env parent resolver·SHA·capabilities 및 두 project pin 불변, 직접 native capability/lease/register/review/apply/inventory6개 actualclose/exit0, target 실제 부재·durable deleted 영수증·최종 pending 없음. child preferences만 task-owned AZRAEL_STATE_ROOT에 격리했다. 전체 앱은 빌드/설치하지 않았다.

## 정리와 보관
- 최초 정리는 run 등록 exit0 뒤 구형 queued 등록에서 `project config changed during registration`으로 exit1 중단했다. 삭제는 시작하지 않았고 실패 근거를 24-storage-cleanup.json에 보존했다. 다음 시도는 지원되지 않는 환경변수로 대기 시간을 지정하여 즉시 busy exit1이었다(26-storage-cleanup-retry.json). 올바른 request.lock_wait_ms=600000을 명시한 27-storage-cleanup.json 실행으로 이어갔다. 기존 등록된 run은 refresh로 재측정을 피하며 현재 보호 검사와 fresh review를 유지한다.
- perf 보관 승인 후 실제 FG-01 parent PID38316과 두 구형 버전 exact executable 사용이 관측되지 않았다. 보관 조건이 종료되어 25-storage-retirement.json을 근거로 정확한 perf installation reference를 지원 API로 반환했다. installation consumer revision26은 새 storage 버전만 참조한다. 사용자 승인으로 기존 작업을 중단하거나 종료 결과를 만들어 내지 않았다.
- run:ff1:storage3 모든 producer와 consumer의 종료 후 최소 근거를 work 및 새 version verification에 보존하고 lifecycle을 close했다. 원시 cache/input/target/fixture/harness/log와 구형 queued 버전은 native apply에서 deleted·remaining:false였다. perf 버전은 순서 대기 중 설정이 다시 바뀌어 `config changed during review`로 차단됐다. 이미 삭제된 두 그룹을 finalize하고 perf만 fresh review/apply하여 exit0·deleted·remaining:false 및 finalize를 확인했다. 삭제·권한·보호 검사를 우회하지 않았다.
- [마지막 정리](28-storage-cleanup-completion.json): perf review9.718초/apply24.276초, 세 그룹 모두 finalized·remaining[]·references[]. 전체 삭제 논리 크기는 1,156,348,464byte이며 실제 물리 회수량은 도구가 null로 보고하여 단정하지 않는다. task-owned 빈 부모 artifacts/tasks/ff1/runs 및 artifacts/tasks/ff1도 containment·비어 있음 확인 후 일반 삭제하고 부재를 확인했다.
- 이전 queued 서버 및 FG-01 cached-command parent의 실제 사용 종료 후 정확한 설치 참조만 반환했다. 사용자의 보관 승인은 해당 실행 종료까지였고 조건 종료 후 두 구형 버전 모두 삭제되어 보관 예외는 남지 않았다. [implementation SKILL.md](C:/Users/felre/.azrael-ex/skills/implementation/SKILL.md)의 “obtain the user's explicit retention approval before closing the task”에 따라 사용 중에는 승인된 범위만 보존했으며 다른 세션을 중단하지 않았다.
- [최종 통합 확인](29-storage-final-verification.json): 검증 입력 중 원래 소스39개 SHA 일치, binary f98ae805…ceb00·2,712,064byte 일치, 두 pin 동일, 18–22에 대한 close-proof hash 불변, 삭제 경로 실제 부재, installation consumer revision26은 storage만 참조한다. 최소 검증 근거는 새 버전 verification에도 독립 복사·해시 확인했다. Windows x64에서 검증했으며 Linux/macOS와 전체 앱 설치는 이번 검증 대상이 아니다.

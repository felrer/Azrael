상태: 구현·필수 검증·임시 생성물 정리 완료. 제품 빌드·설치 및 설치본 수용은 별도 범위다.

# 판단 요청이 작업 완료로 표시되는 문제

## 목적과 범위
사용자 스크린샷의 판단 요청 표시 누락 원인을 조사하고 합의한 종류별 활동 그룹을 구현·검증한다. 공통 webview 계약은 Windows x64, Linux x64, macOS ARM64에 해당하며 실제 조사·검증 환경은 Windows x64 로컬 VS Code 및 작업 전용 headless Chrome이다. 전체 제품 빌드·설치는 수행하지 않는다.

기준 계약: docs/architecture/ui-presentation.md#parent-decision-request-activity, docs/architecture/root-resume.md#parent-decision-requests. 요청 상태와 자식 실행/완료 상태를 독립적으로 유지해야 한다.

## 조사 입력
2026-10-22 recovery.runtime은 u17b release를 가리키며 build-info.json의 engineSourceRoot는 artifacts/n10a/engine이다. 유지 소스는 engine/이다. 설치본 webview에 parent-request-activity-v1 변환이 존재한다.
사용자 테스트의 parent thread 01a162fa-2880-7040-8e86-7e8edba5ceef 및 child thread 01a162fb-e81a-7893-b89d-86e1fd9f7314의 rollout과 state_5.sqlite를 읽기 전용으로 확인했다.

## 실행 순서와 소유
root 단독: 런타임 출처 → 원본 요청/대기/완료 이벤트 → 투영/요약/렌더 경로 → 제한된 함수 재현 및 기존 검사 → 수정안. 제품 변경과 신규 subagent 실행은 하지 않는다.

## 성공 기준
구체적 코드 경로와 사건 시각으로 원인을 설명하고, 확인 사실·추론·미검증을 구분한다. 요청 상태 보존과 일반 활동 회귀를 포함한 수정/검증 범위를 제시한다.

## 분석 결과

원인은 요청 렌더러에 이르기 전의 별도 subagent 요약 경로다. 기존 변환은 nC에서 parentRequest를 전달하고 nE에서 전용 React 행으로 분기한다(scripts/inject-parent-request-activity.cjs:16–17). 설치본에도 두 변환이 존재한다. 그러나 현재 대화의 subagent presentation은 아래 경로를 사용한다.

- local-conversation-thread-2429c4b61076.js의 subagent 분기: 같은 agentThreadId의 모든 활동을 모아 activityItems를 만든다.
- 같은 파일의 xm: sites-end-resource의 export I(로컬 alias xu), 즉 ZT를 호출한 뒤 local-conversation-turn의 export i(alias fu), 즉 Vs에 rows/status를 넘긴다.
- sites-end-resource-90d3046b3014.js의 ZT: Map을 agentThreadId로 구성하여 같은 자식의 마지막 활동만 남긴다. 결과에 parentRequest와 원본 item ID를 보존하지 않는다. backgroundAgent.status가 done이고 해당 부모 턴의 마지막 활동이면 activityStatus를 done으로 덮는다.
- app-initial-c014f9ee4429.js의 LHi: runtimeStatus가 active가 아니면 done으로 분류한다. active가 없는 deferred 상태를 판단 요청과 연결하는 처리가 없다.
- local-conversation-turn-9fb266d5c020.js의 Vs는 이 요약을 subagent-activity-inline-group으로 렌더링한다. nE와 azraelParentRequestActivity를 거치지 않는다.

따라서 ① 판단 요청 전용 행이 실제 요약 경로에 연결되지 않음, ② 실행 대기와 완료가 같은 done으로 축약됨, ③ 요청 식별자 대신 자식 식별자로 활동을 병합함이 결합한다. 실제 완료 이벤트가 나중에 생기면 마지막 활동 선택 때문에 요청이 더 가려진다. 요청 DB 상태 자체가 completed로 덮이는 문제는 확인되지 않았다.

## 실제 사건과 확신의 범위

원본 DB는 readOnly로 열고 원본 rollout을 읽었다. 관련 시각은 한국시간이다.

| 시각 | 확인한 사건 |
| --- | --- |
| 18:46:33.763 | 부모 rollout에 parent-request-01a16301-53a1-72d0-b981-7e44e31e1e20, kind interacted, status pending 저장 |
| 18:46:37.696 | 자식 turn_deferred; 응답 대기 |
| 18:47:11.015 | 부모 turn_aborted |
| 18:47:38.816 | 같은 요청 행이 명시적 응답으로 cancelled 갱신 |
| 18:47:45.695 / .707 | 자식 task_complete와 부모 subagent-completed 별도 이벤트 |

자식이 대기한 시점부터 사용자 중단까지 해당 자식의 완료 이벤트는 없었다. 취소 후 실제 완료는 별도 ID로 기록됐다. 따라서 대기 중 표시를 설명하기 위해 엔진이 완료를 조기 발행했다고 가정할 필요가 없다. 스크린샷의 정확한 촬영 시각 및 당시 메모리 속 요약 입력은 저장되지 않아 확정할 수 없지만 설치본 함수에서 pending→done 및 요청 손실을 직접 재현했다. 최신 소스만으로 설치 여부를 추정하지 않았으며 recovery.runtime과 u17b build-info 및 설치 asset을 함께 확인했다.

## 검증과 기존 검사의 공백

- node work/CZ-01-parent-request-activity-diagnosis/probe-summary.cjs: 실제 설치본 ZT 함수를 AST로 추출해 VM 실행. pending+done background → 요청 정보 없이 done, 동일 자식 요청 2건 → 1행, 요청 뒤 완료 → 1개의 done 행. 세 사례 모두 assertion 통과, 실제 exit 0. 기록: probe-summary.log.
- node scripts/test-parent-request-activity.cjs: 14 checks 통과, 실제 exit 0. 기록: existing-check.log.
- 기존 검사는 nC 투영과 nE 전용 렌더러를 검증한다. render verifier도 nC 결과의 직접 렌더 경로를 구성하며 xm→ZT→Vs 경로를 검증하지 않는다. 그러므로 이 통과는 실제 대화 요약 통합의 정확성을 보장하지 않는다.
- evidence.json: 사건 시간·상태·원본 경로, 설치 asset 4개의 SHA256. 질문 본문 및 불필요한 세션 내용은 복제하지 않았다.

이는 Windows에서 수행한 정적 추적 및 실제 함수의 제한된 실행이다. 새 라이브 subagent 테스트, 브라우저 렌더 검사, 엔진 전체 검사, 빌드·설치 및 Linux/macOS 실행은 하지 않았다.

## 합의된 표시 방향과 수정안

판단 요청과 실제 작업 종료는 각각 별도의 새 활동으로 추가한다. 기존 여러 에이전트를 겹쳐 표시하는 시각화는 유지하되, 기존 묶음 범위 안에서 판단 요청끼리, 작업 종료끼리 분리하여 합친다. 요청 하나마다 항상 독립된 화면 행을 만드는 앞선 제안은 이 방향으로 대체한다. 요청의 원본 식별자는 그룹 내부에서도 보존한다.

예: 같은 묶음 범위에서 A 판단 요청, B 작업 종료, C 판단 요청, D 작업 종료가 들어오면 판단 요청 그룹은 A·C, 작업 종료 그룹은 B·D를 표시한다. 같은 A가 판단을 요청한 뒤 실제 종료하면 A는 두 종류의 활동에 각각 포함된다. 기존 묶음의 턴·대화 범위를 넘어 전체 이력을 합치는 변경은 포함하지 않는다.

1. 실제 대화 presentation 분류와 그룹 생성에서 활동 종류를 구분한다. parentRequest가 있는 활동은 판단 요청 그룹으로, 실제 completed 활동은 작업 종료 그룹으로 보낸다. 현재 xm→ZT→Vs 경로는 parentRequest를 버리므로 그룹 모델부터 렌더러까지 요청 데이터와 종류를 보존한다.
2. 그룹 외형은 기존 avatar 겹침·간격·테마를 재사용한다. 판단 요청 그룹은 판단 요청 의미와 상세 접근을 제공하고 작업 종료 그룹은 기존 종료 표시를 유지한다. 기존 nE/azraelParentRequestActivity의 요청 상세·텍스트 안전성·접근성 처리를 활용하되 실제 그룹 경로에도 연결한다.
3. 판단 요청의 논리적 원본은 requestId 또는 안정 item ID로 유지한다. 여러 에이전트를 한 그룹으로 보여도 개별 질문·추천·blocked action·저장된 응답을 잃지 않는다. 같은 자식의 요청 여러 건도 내부적으로 유지하며 각각 상세에 접근할 수 있어야 한다. 그룹에 pending이 있으면 판단 요청, 모두 같은 응답 상태이면 해당 상태, 응답 상태가 섞이면 판단 응답으로 표시한다.
4. 같은 request ID의 명시 응답은 기존 요청 항목의 상태/상세를 갱신한다. 요청 응답과 실제 자식 종료는 별도 사건이다. 자식 active/idle/deferred/completed, 부모 중단/재개, 이후 메일이 요청을 종료 활동으로 바꾸지 못하게 한다. 재전송·history replay는 같은 ID를 중복 추가하지 않는다.
5. 작업 종료 그룹에는 실제 종료 활동을 사용한다. LHi의 비실행→done 계산만으로 판단 요청을 작업 종료로 분류하지 않는다. 일반 자식 실행 요약 자체의 대기 표시 변경은 요청/종료 그룹 분리와 구분하며 필요한 범위를 조사해 제안한다.
6. owning UI 계약과 ui.parent-request-activity feature에 종류별 묶음 및 실제 conversation 경로 검사를 연결한다. 신규 라이브러리는 필요 없다. 엔진의 기존 request/종료 별도 ID·저장 계약을 우선 재사용한다.

현재 허용 범위는 합의한 개선의 구현·검증·문서 반영·정리·작업 커밋이다. 제품 전체 빌드·설치는 별도 요청 범위다. 공통 webview 4개 자산의 guarded transform과 기존 검증을 확장하며 엔진 상태/저장 계약은 변경하지 않는다. Windows에서 소스 및 light/dark 실제 React/CSS 렌더 검증을 수행하고 Linux/macOS 실행 및 설치본 적용 여부는 구분한다.

구현 소유는 root 단독이다. 요청의 내부 식별자는 유지하고 native avatar group과 개별 요청 상세를 재사용한다. 소스 변환 → 실제 conversation projection/group 함수 검사 → scoped browser 렌더 → preservation/namespace checks → 작업 diff 검토·정리·커밋 순서로 진행한다. 그룹에 pending이 하나라도 있으면 판단 요청, 모두 같은 응답 상태이면 해당 상태, 응답 상태가 섞이면 판단 응답으로 요약하며 상세에는 각 상태를 유지한다.

## 구현 시 필수 회귀 범위

- 실제 conversation presentation→summary/row 경로에서 pending 요청이 active→deferred/idle→완료로 변해도 유지되는지 검증한다.
- 여러 자식의 판단 요청끼리와 작업 종료끼리는 기존처럼 겹쳐 묶이고, 두 종류가 교차 도착해도 별도 그룹인지 검증한다. 동일 자식의 요청→실제 종료가 두 활동에 각각 남는지 확인한다.
- 같은 자식의 요청 2건을 그룹 내부에서 보존하고 각각 상세에 접근할 수 있는지, 일반 메일 혼재·같은 ID 응답 갱신·원래 부모 턴/이전 턴/새 부모 턴의 경계를 검증한다.
- resolved/deferred/cancelled 각각 및 명시 중단 시 pending 보존을 검증한다. 사용자 중단 자체를 요청 취소로 합성하지 않는다.
- history/reload와 live item/completed 갱신 모두에서 요청 유지·중복 방지·상세 펼침 상태를 검사한다.
- 실제 대화 렌더 구성으로 light/dark와 좁은 폭에서 행과 상세를 확인한다. 기존 직접 nE 렌더 검사는 유지한다.
- 일반 spawn/진행/메일/정상 완료 표시 회귀와 Windows 공통 경로 검증을 수행한다. 엔진 변경이 필요해질 때에만 해당 native 검사 범위를 추가한다.

## 구현 및 검증 결과

inject-parent-request-activity.cjs를 v2로 확장했다. nC 투영을 유지하고 ZT의 native 이름·아바타 계산을 재사용하되 요청은 requestId별로, 종료와 일반 활동은 각각 에이전트별로 보존한다. 실제 종료는 completed 활동에만 귀속하며 idle/deferred에서 완료 문구를 합성하지 않는다. Vs는 기존 아바타 그룹 렌더러를 별도 컴포넌트로 유지하고 요청/종료/일반 활동의 그룹을 나눠 호출한다. 요청 그룹은 native IO의 아바타·이름·overflow를 재사용하고 개별 요청 상세를 펼친다. BEM의 np/ap/mp/xm 경로도 요청·종료를 새 활동으로 분류하고 같은 턴/종류만 묶으며 최초 항목의 앵커를 유지한다. 새 라이브러리·엔진 변경은 없다.

기존 feature ui.parent-request-activity의 behavior 검사 소유 파일을 확장했으므로 stable feature/check ID는 유지한다. 기존 namespace-cache-owner 검사를 유지하고 실제 전체 namespace transform 4개 자산의 구문과 inventory의 연결도 확인했다. 공용 inventory 파일의 다른 작업 변경은 수정하지 않았다.

| 최종 검사 | 결과 |
| --- | --- |
| node --test scripts/test-parent-request-activity.cjs scripts/test-namespace-cache-owner.cjs scripts/test-namespace-source.cjs | 상위 12 tests 통과, fail/skipped 0, 실제 exit 0. 요청 파일 내부 57 checks 포함 |
| namespace transformAsset 실제 전체 파이프라인 | 자산 4개 구문 검사 통과, parentRequestActivityEdits 1/7/2/6 |
| feature manifest + transform rules | 76 features 검증 통과 |
| node scripts/verify-parent-request-activity-render.mjs | 최종 79 checks 통과, 실제 exit 0. work ZT/Vs 및 standalone xm/ZT/Vs 경로, light/dark, 좁은 폭, pending/응답 혼합, 같은 에이전트 복수 요청, 교차 완료, Enter/Space, 4명 overflow 확인 |

렌더 fixture는 실제 React·Intl·native 아바타·CSS를 사용한다. standalone fixture에서 외부 background-agent 구독만 고정하고 projection 및 summary/renderer 본문은 실제 변환 코드를 실행한다. 브라우저 오류는 0이며 작업 전용 Chrome 종료 및 프로세스 트리 부재를 확인했다. source 검사는 약 20초이고 전체 namespace 통합 구문 검사를 추가 실행했다. 렌더 1차 67 checks 이후 event별 완료 보존과 mixed/overflow 검증을 추가하여 최종 입력으로 79 checks를 재실행했다. 동시 run 생성 중 registry claim lock으로 source 검사가 실행 전 거부된 1회는 실제 테스트 결과에 합산하지 않았으며 잠금을 건드리지 않고 렌더 등록 후 새 source run을 실행했다.

독립 보존 근거: artifacts/tasks/parent-request-grouping-evidence/runs/20261022T103019893Z-3f4f9f2f-2157-499c-b26f-7935f0d18907. reports/에 양쪽 렌더 요약·최종 source 요약·입력 SHA256, logs/source-checks.log에 실제 exit 및 상세 결과, outputs/에 두 테마의 요청/종료 그룹 스크린샷 4개를 보존했다. 이 근거는 native 관리 도구로 등록·검토하고 defer했다. 재검토 조건은 후속 package/installed-host 수용이 이 근거를 대체한 시점이다.

Chrome 프로필·raw fixture를 포함한 렌더 run 2개와 중복 source run 1개는 근거 인계 후 native 관리 도구의 fresh review/apply로 삭제했다. 모두 status deleted, remaining false를 확인했고 producer lifecycle finalize도 blockers/remaining 없이 완료했다. 이 정리에는 등록·검토·삭제 재검증 대기가 있었으며 코드 검증 시간과 구분한다. 독립 근거 1개만 retained/deferred다.

Windows의 소스·함수·React/CSS fixture 수용이며 실제 설치본의 live subagent 수용, 제품 빌드·설치, Linux/macOS 실행은 별도다. 사용자 세션·요청 DB와 다른 작업의 변경을 유지한다. 기존 진단용 작은 로그·repro는 원인 근거로 보존하며 임시 검증 자료는 커밋에서 제외한다.

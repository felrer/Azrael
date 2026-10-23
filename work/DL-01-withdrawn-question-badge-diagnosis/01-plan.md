상태: 개선안 1·2 구현 및 Windows 소스56건·화면28건 검증 완료. 공용 관리 잠금으로 검증 산출물 정리를 보류합니다. 빌드·설치·사용자 대화 변경 및 태스크 커밋은 수행하지 않았습니다.

# 철회 질문의 입력 필요 표시 진단

## 목표와 범위
스크린샷에 표시된 채팅 목록의 입력 필요 배지가 철회 질문 때문에 남는지 확인하고 개선안을 제안한다. 의미는 Windows x64, Linux x64, macOS ARM64 공통 UI에 해당한다. 실제 조사 환경은 Windows x64다.

## 조사 및 검증
현재 설치 UI와 실행 엔진의 출처를 확인하고, 질문 철회·상태 투영·채팅 목록 배지 경로를 추적한다. 변경 없는 함수 실험으로 오류 조건을 확인한다. 실제 세션 상태와 코드로 확인 가능한 결함을 구분한다.

## 권한과 보존
개선안 1·2의 제품 소스와 관련 계약·검증 변경이 승인되었다. 기존 질문 ID·답변 이력·남은 활성 질문·승인 대기·큐 의미를 보존한다. 공통 UI를 수정하고 Windows x64에서 source 및 native React/CSS fixture를 확인한다. 타 OS 실행, 전체 제품 빌드·설치와 기존 대화 수정은 범위 밖이다.

루트가 변환·index 갱신·목록 판정 통합 및 최종 수용을 소유한다. 기존 `Nxn`의 활성 ID 계산을 확장하면 `Mxn/jxn`을 통한 index 갱신과 `g0t`의 배지가 함께 갱신되므로 별도 상태 저장·API·의존성을 추가하지 않는다. 기존 source 검사에 index와 badge 회귀를 추가하며 이는 수정 수용을 위한 검증이다. 제안 3의 데이터 조정은 하지 않는다.

검증 산출물은 실행 전 기존 producer helper로 고유 run을 등록한다. source 로그·renderer fixture/profile/스크린샷은 해당 run의 소유이며 결과 확인 후 삭제/보류를 명시적으로 결정한다. 소스 입력을 고정한 뒤 검증을 실행하고 기존 다른 작업은 보존한다.

## 확인된 원인

- 실행 중인 Azrael 프로세스는 `artifacts/build/b13/artifacts/releases/w11aa/engine/azrael.exe`를 사용한다. 해당 release의 `build-info.json`이 가리키는 엔진 원본은 `artifacts/build/b13/engine`이다. 설치 UI는 `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.11/webview/assets`에서 직접 확인했다. 이것만으로 스크린샷 창의 정확한 런타임까지 식별한 것은 아니다.
- 설치된 `app-initial-97d3534ad35f.js`의 `Nxn`은 질문의 원래 index로 ID를 만들지만 `withdrawn`을 검사하지 않는다. `Axn`은 이 ID들에서 답변 ID만 제외하여 `unansweredAsyncQuestions`를 만든다.
- 상태 변경 검사 `jxn → Mxn → Nxn` 역시 질문 ID만 비교한다. ID가 같은 철회 업데이트는 변화로 인식되지 않으며, 이 결과는 conversation index의 상태 재계산 여부에 사용된다.
- 설치된 `app-initial-c014f9ee4429.js`의 `g0t`는 미응답 ID의 `VD` 상태가 없으면 미응답으로 판단한다. `oM`이 이를 `userInputAsync` 입력 요청으로 투영하고 `Gjr`이 비활성 채팅 행에 `needs-input` 배지를 표시한다.
- 기존 `scripts/inject-question-withdrawal.cjs`는 질문 패널용 `Jv`에서 철회를 제외하고 `rRt`를 통해 질문 패널·초안을 정리한다. 그러나 채팅 목록의 위 index asset은 변환 대상에 없다. 따라서 질문 패널은 제거되어도 목록 ID가 남고, 삭제된 패널 상태가 오히려 입력 필요 판정을 참으로 만든다.

## 검증과 한계

설치 asset의 실제 함수를 `node:vm`으로 추출하여 메모리에서 실행했다. 제품 파일이나 사용자 상태는 변경하지 않았다. 실제 exit 0이며 결과는 다음과 같다.

| 조건 | 실제 결과 | 필요한 결과 |
| --- | --- | --- |
| 진행 중 턴의 질문 2개 모두 `withdrawn:true` | 미응답 ID 2개 유지 | 미응답 없음 |
| 같은 ID의 질문이 활성에서 철회로 변경 | `jxn=false` | 상태 변화 감지 |
| 질문 2개 중 1개만 철회 | ID 2개 유지 | 활성 ID 1개만 유지 |
| 모두 철회한 ID 목록과 삭제된 패널 상태 | `g0t=true` | 해당 질문에 의한 입력 필요 없음 |
| 턴 상태가 `completed` | `Axn=null` | 정상적인 완료 상태 보존 |

검증 asset SHA256: `3b9b36a6b02f1be22cbc9fd80485827347e63eb1d21f5f8c5b49c35bc2834d19` (`app-initial-97d3534ad35f.js`). 셸 출력에 위 결과를 보존했으며 별도 로그 파일이나 테스트 산출물은 생성하지 않았다. Windows x64의 함수 수준 재현이다. 실제 렌더링, 재시작·재연결, 타 OS 수용은 검증하지 않았다.

일반 상태 DB를 읽기 전용으로 열어 스크린샷 제목과 정확히 일치하는 대화를 조회했으나 결과가 없었다. 따라서 스크린샷의 특정 세션에서 실제 철회가 완료되었는지, 다른 활성 질문이 있는지까지는 확정하지 않는다. 코드 결함 재현과 특정 사건의 확정은 구분한다. 완료 후에도 배지가 지속되는 경우에는 과거 진행 중 턴 또는 stale snapshot 여부를 추가 확인해야 한다.

기존 테스트는 질문 패널·답변 이력·큐 보류를 다루지만 이 conversation index와 채팅 목록 배지까지 연결하는 재현을 포함하지 않는다. 이 범위를 대상으로 기존 검사를 확장하는 것이 필요하다.

## 권장 개선안

1. 기존 철회 변환에 conversation index asset을 포함한다. `Nxn`에서 원래 index를 유지한 채 `withdrawn:true`인 질문을 제외한다. 이 변경으로 `Mxn/jxn`에서도 철회에 따른 활성 ID 변화가 감지되도록 하고 index 갱신 경로를 검증한다. 새 의존성이나 엔진 API는 우선 필요하지 않다.
2. `g0t`와 질문 패널이 동일한 활성 질문 집합을 사용하도록 연결한다. 단순히 패널 상태가 없으면 무조건 완료로 바꾸면 실제 미응답·초기 로딩 질문을 숨길 수 있으므로 그렇게 수정하지 않는다. 캐시된 index도 원본 질문 상태 변경 후 다시 계산되어야 한다.
3. 기존 대화는 정상 history 로드·재연결 시 현재 질문 상태로 index를 재구성한다. 사용자 DB나 과거 질문 이력을 임의로 삭제하지 않는다. 실제 재현 세션은 읽기 전용으로 ID와 최신 상태를 확인한 뒤 수용 검증에 사용한다.
4. 기존 source 검사와 보존 인벤토리에 해당 asset을 연결하고, 모든 철회·부분 철회·동일 ID 업데이트·다른 채팅에서 철회·재열기·재연결을 검증한다. 원래 index와 기존 답변 연결, 남은 활성 질문, 별도 승인 대기, 큐 보류/해제와 진행 표시를 보존한다. 밝은/어두운 테마에서 실제 채팅 목록 배지와 질문 패널을 함께 확인한다.

기존 질문 생명주기 의미를 복구하는 수정이며 제품 정책 변경이나 이력 마이그레이션은 포함하지 않는다. `ui-presentation.md`의 질문·목록 계약, `ui.question-withdrawal` 보존 owner 및 명시적 source/render test bundle을 함께 연결했다.

## 구현 결과와 검증

- `Nxn`은 원래 index로 ID를 만든 채 `withdrawn:true`인 질문만 제외한다. `Mxn/jxn`이 활성 ID 변화를 감지하여 기존 conversation index 갱신 경로를 사용한다. 별도 배지 상태, API, 의존성이나 사용자 데이터 변경은 추가하지 않았다.
- 기존 pinned anchor·중복/부분 변환 방어를 세 번째 index asset에도 적용했다. namespace의 기존 asset-owner 매핑이 변환 대상 배열을 사용하므로 해당 asset과 캐시 의존성에 자동 반영된다.
- 실제 native index class를 사용하여 canonical/legacy 및 transcript index 준비 여부 네 조합에서 부분·마지막 철회, 캐시 갱신, snapshot 재구성, 원래 질문 ID와 답변 연결을 확인했다. 실제 `g0t` 판정에 draft 부재·답변 완료를 넣어 확인했다.
- source: `question-withdrawal-ui-source`의 질문·큐·소비·namespace owner 검사 **56/56 통과, exit 0**, 약21.7초. 기존 프로젝트 runner가 실행 전 소유 등록과 종료 결과를 기록했다. 원본 결과: `artifacts/tasks/DL-01-withdrawn-question-badge/runs/2026-10-22T18-37-31-283Z-2c0f51eb-de81-4c93-8835-1f1ed2ea7854/reports/results.json`.
- render: **28건 통과, exit 0**. 실제 변환된 pending index와 badge selector가 native Gjr/rQ/Bkr 행을 구동한다. 밝은/어두운 테마의 활성·부분 철회 배지, 마지막 철회 후 배지 제거, 별도 승인 대기, keyboard disclosure, 원래 reply ID, 이력, queue status, 360px overflow와 browser error 부재를 확인했다. 부분 철회/전체 철회 스크린샷도 직접 확인했다. 원본 결과: `artifacts/tasks/verify-question-withdrawal-render/runs/20261022T183906054Z-42502547-1309-4b81-a958-9badc38527fa/logs/summary.json`. test browser 종료는 exit0 및 프로세스 검사로 확인했다.
- 최초 native maintenance 실행은 10초 제한(exit124)과 새 테스트의 잘못된 변수 참조로 실패했다. 변수 참조를 수정한 후 전체 테스트는 검증된 기존 project runner로 실행했다. 큐 회귀 fixture에서 기존 함수 의존성 `xsn`이 누락되어 실제 pinned 함수를 함께 로드하도록 보완했다. 동시에 변경된 큐 작업의 제품 코드와 테스트 의미는 보존했다.
- 렌더 재실행 원인은 fixture의 export 소유 경로, host query 값, native 행의 summary 입력, 중복 `role=status` 선택자였다. 제품 검증 조건을 줄이지 않고 실제 행과 queue status 선택자를 구분했다. shared run-claim lock 충돌은 생성 전 거부되었으며 잠금을 제거하지 않았다.
- 소스·테스트의 최종 diff 공백 검사는 exit0. 전용 worktree는 생성하지 않았다. 다른 작업이 이미 stage한 엔진·설정·UI 파일이 있으므로 관련 변경을 섞는 태스크 커밋은 수행하지 않는다. 설치와 실제 세션, Linux/macOS 실행은 별도 수용 범위다.

## 산출물 보존과 남은 작업

소유 renderer 6회와 source runner 3회는 실제 종료 결과가 있다. renderer의 `browserExit.confirmed:true`로 테스트 브라우저 종료를 확인했다. 공용 `.run-claim.lock` 및 `catalog.lock` 충돌로 독립 수용 근거 묶음의 생성이 거부되었고, native 등록도 `exclusive maintenance lock unavailable (abandoned locks require explicit recovery): 파일이 있습니다. (os error 80)`로 거부되었다. 실패한 새 근거 묶음 생성은 등록·파일 생성 전에 중단되었다. 잠금 제거·다른 API에 의한 삭제·실행 중인 타 작업 중단은 하지 않았다.

보존 대상은 다음 소유자와 실행 ID로 한정된다. 최종 source stdout/stderr/results 및 renderer summary·네 장의 스크린샷이 현재 독립 검증 근거다. 테스트 프로필도 같은 renderer run 안에 남아 있다.

- `run:DL-01-withdrawn-question-badge:` 아래 `2026-10-22T18-34-35-519Z-f9649f4b-d808-45bb-870f-9ab55f13ad11`, `2026-10-22T18-36-03-836Z-ec8e6bb7-0db0-4258-89da-110e4f9c8f27`, `2026-10-22T18-37-31-283Z-2c0f51eb-de81-4c93-8835-1f1ed2ea7854`.
- `run:verify-question-withdrawal-render:` 아래 `20261022T183416595Z-1f5d5085-44d9-4710-aa23-98878e42aad9`, `20261022T183520979Z-5589b60a-1f37-46b9-8149-e531dd73f9d6`, `20261022T183553210Z-ade317d3-cee7-4c6e-b7cd-6127b62a05b7`, `20261022T183646641Z-fe9dbf92-a987-4179-98af-159e472d1fff`, `20261022T183754396Z-f1929819-d6f2-4e1b-86a5-390465ac1ae3`, `20261022T183906054Z-42502547-1309-4b81-a958-9badc38527fa`.

보류 사유: 관리 잠금 거부로 안전한 native review/apply 및 근거 이전을 완료할 수 없다. 재검토 조건: 잠금 소유 작업이 정상 종료하여 관리 도구가 허용되면 최종 소스 로그와 화면 근거를 프로필 없는 수용 묶음으로 먼저 보존하고 참조를 전환한다. 위 9개 raw run을 기존 producer 기록으로 native 등록·검토한 뒤 명시적 삭제를 적용하고 실제 부재·참조·finalize를 확인한다. 필요한 최종 근거는 build/install 수용이 보존할 때까지 유지한다. 첫 maintenance 테스트의 실패 기록 `run-61336-1508-1792693922982814400`은 native 관리 기록으로 남으며 exit124를 통과로 바꾸지 않는다.

현재 완료 범위는 제품 소스와 관련 계약·검증이다. 실제 설치된 채팅 화면에 반영하려면 별도의 빌드·설치와 해당 배포의 세션 수용이 필요하다.

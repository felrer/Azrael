상태: 소스 수정·Windows 관련 검사92개 통과·작업 산출물 정리 완료. 작업별 커밋을 기록한다. 빌드·설치·배포 및 설치창 검증은 수행하지 않음.

# 전송한 요청의 입력란 잔류·복원 분석

## 요청과 범위
사진처럼 전송된 문장이 입력란에 다시 나타나는 원인을 조사하고 재현한 경로를 수정한다. 제품 코드, 기존 회귀 검사, owning 계약 및 보존 매핑의 변경과 소스 검증이 승인 범위다. 공통 webview 로직이며 확인 환경은 Windows, 실제 설치 화면 및 Linux/macOS 동작은 미검증이다. 설치본 교체·배포는 이번 실행 범위에 포함하지 않는다.

## 확인 결과
- 설치 경로: `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.16`. `app-initial-7a199c66e670.js`에 `composer-draft-v4`가 있다. 현재 창의 로드 버전은 미확인이다.
- 이전 CQ-01 기록 이후 v4는 clear 이후 선택·첨부 변경에도 전송한 저장 초안을 삭제하도록 보완됐다. 이번 조사에서는 최초 clear 전 상태 변경 경로가 남아 있음을 확인했다.
- `scripts/inject-composer-draft.cjs`의 `__azraelComposerSnapshot`은 text/persistedText뿐 아니라 저장 draft, 첨부, 선택, 앱도 포함한다. `__azraelOwns` 전체 비교가 실패하면 retained 생성과 `__azraelClear`를 모두 생략한다. 이후 성공 처리도 release 콜백이 없어 저장 초안을 삭제하지 않는다.
- 초안 복원 기능 자체보다는 전송 완료 처리와 편집 상태 보호 조건이 결합된 것이 문제다.

## 검증
기존 `scripts/test-composer-draft.cjs`의 fixture와 pinned production 전송·삭제 함수를 메모리에 로드했다. 파일 수정, 사용자 저장소 변경, 실제 요청 전송은 하지 않았다. Node 명령 실제 종료 코드 0.

| 최초 clear 이전 변화 | 전송 호출 | 오류 | 입력란 | clear 횟수 | 저장 초안 |
| --- | --- | --- | --- | --- | --- |
| 없음 | 1 | 없음 | 빈 문자열 | 1 | 없음 |
| 선택 xW 변경 | 1 | 없음 | A | 0 | 유지 |
| 동일 문장 초안 메타데이터 갱신 | 1 | 없음 | A | 0 | 유지 |
| 자동 컨텍스트 첨부 추가 | 1 | 없음 | A | 0 | 유지 |

실험은 전송 성공에도 입력란과 저장 초안이 남는 경로를 입증한다. 사진에서 clear가 생략됐는지, 비워진 뒤 복원됐는지 및 어떤 상태가 변했는지는 실시간 관찰하지 않아 확정하지 않는다. SQLite 장애나 중복 실제 전송을 확인한 것은 아니다. 기존 테스트도 첨부 변경 시 입력 문장 A를 남기는 결과를 기대하고 있다.

## 권장 수정 방향
전송한 텍스트·저장 초안의 소비와 첨부·선택 상태 보호를 분리한다. 새 입력은 보호하면서 부수 상태만 달라진 경우 전송한 문장이 남지 않도록 한다. 실패 재시도 보호와 기존 clear 이후 보완을 유지한다. 이 방향의 수정은 사용자 요청으로 승인됐다.

## 구체적인 수정 계획

### 재사용할 기존 기능과 조사 근거
- `Bba`는 텍스트뿐 아니라 첨부·댓글·앱 캡처·선택 등을 함께 초기화한다. 전체 상태 보호 조건만 완화하고 이 함수를 그대로 호출하면 새 첨부까지 지워질 수 있으므로 그대로 완화하지 않는다.
- 기존 editor 연결은 `$U(controller.view, callback)`으로 문서 변경을 구독한다. 같은 문장을 지웠다가 다시 쓴 경우도 보호하도록 이 기존 경로를 이용해 전송별 문서 변경을 추적한다. 콜백의 문서 변경 의미와 해제는 구현 시 직접 검증한다.
- `cQn.setDraft`는 `expectedValue`를 가진 조건부 레코드 갱신을 이미 지원한다. 새로운 저장소나 초안 저장 비활성화 없이 이 경로를 재사용한다.
- 일반 draft 쓰기에는 `lQn=250` 지연이 있고 삭제·조건부 갱신은 지연 0이다. 삭제 이후 대기 중인 옛 저장이 되살아나는지까지 저장 어댑터 경계에서 확인한다. 지연이 이번 증상의 실제 원인이라는 증거는 아직 없다.

### 목표 동작과 구현 경계
1. 비동기 준비 전에 전송별 소유권을 잡는다. 대상 composer 세션, 텍스트/직렬화 표현, 문서 변경 여부, 제출 초안과 첨부 스냅샷을 보유한다. persisted draft 메타데이터나 자동 컨텍스트 변화는 텍스트 편집으로 취급하지 않는다.
2. 기존 수락·큐 인계 경계에서 비운다. 클릭 직후 무조건 비우거나 모델 응답 완료까지 기다리지 않는다. 전송 실패·결과 불명 시 요청을 잃지 않는 기존 custody 경계를 보존한다.
3. 전체 상태가 그대로면 기존 `Bba`를 재사용한다. 텍스트는 그대로이고 첨부·선택만 바뀌었으면 텍스트만 비우는 좁은 경로를 사용해 새 상태를 보존한다. 새 텍스트 편집 또는 같은 문장의 재입력이 있었다면 비우지 않는다.
4. 성공 시 전송한 텍스트에 해당하는 저장 상태도 정리한다. 새 초안이나 새로 추가한 첨부 관련 상태를 통째로 지우지 않도록 현재 값 기준 조건부 삭제/갱신을 사용한다. 대상 세션의 별칭 키도 기존 범위를 보존하며 다른 세션에는 적용하지 않는다.
5. 실패 시 재시도 가능한 입력을 보존한다. 이미 비운 입력을 복원할 때는 이후 사용자 편집을 덮어쓰지 않는다. 결과 불명은 확정 성공으로 처리하지 않으며 기존 큐 custody를 유지한다.
6. 중복·늦은 콜백은 전송별 소유권으로 무해하게 처리하고 다른 전송의 초안을 건드리지 않는다. 문서 변경 구독은 모든 종료 경로에서 해제한다.

### 검증과 변경 범위
- 최초 clear 이전 선택·메타데이터·자동 컨텍스트 변경 후 성공 → 전송 문장 제거, 새 첨부·선택 유지.
- 전송 중 새 문장 또는 동일 문장 재입력 → 새 입력 유지. 세션 전환 → 다른 세션 불변.
- 확정 실패·결과 불명·중복 콜백 → 입력 손실 및 이중 정리 없음.
- 성공 후 세션 재방문·webview 재로드 → 전송한 텍스트 복원 없음. 지연 저장과 조건부 삭제의 순서도 확인.
- 기존 `test-composer-draft.cjs`를 중심으로 현재 버그를 기대값으로 고정한 첨부 변경 사례를 갱신하고, 프로젝트 초안·namespace cache·/btw 접점의 필수 범위를 적용한다. 새 대규모 테스트 구조는 만들지 않는다. 구현 시 testing 지침을 적용한다.
- 주 변경 소유자는 `scripts/inject-composer-draft.cjs`, 해당 기존 검사, `ui.composer-draft` 계약과 feature inventory다. 저장 어댑터 변경은 위 순서 검증에서 필요성이 확인된 경우에만 제안 범위에 포함한다. 공통 webview 의미이며 Windows 회귀와 실제 창 재로드 검증을 구분하고, 다른 OS 미실행은 명시한다.
- 제품 코드·계약·검사 수정은 승인됐다. 설치본 변경은 별도 범위다.

## 산출물
영구 산출물은 본 기록뿐이다. 실험은 메모리에서 종료됐고 로그·빌드 산출물·백업은 생성하지 않았다. 계획 할당용 임시 본문은 할당 후 일반 삭제하고 부재를 확인한다. 최초 `python` 명령은 PATH에 없어 실행되지 않았으며 설치된 Python312의 절대 경로로 할당한다.

## 지연 저장 복원 가설의 재현 결과

### 대상과 방법
사용자 요청에 따라 재현 실험을 추가했다. Windows / Node.js v26.7.0에서 설치본 `2026.0.16`의 실제 함수 본문을 AST로 추출해 실행했다. 제품 코드를 바꾸거나 실제 사용자 저장소에 접근하지 않았다.

- webview: `app-initial-c014f9ee4429.js`의 `Pm`, `km`, `Am`, `jm`, `g3e`, `i3e`, `y3e`; `app-initial-7a199c66e670.js`의 `_Nt` merge.
- host: 설치 `out/extension.js`의 실제 persisted-atom-update 처리, `updatePersistedAtomValue`, `enqueueUpdate`, `$Ke` merge 및 프로젝트 조회 함수.
- 실제 Node 타이머와 Promise를 사용했다. VS Code Memento 저장 I/O와 알림만 메모리 어댑터로 대체했고, 프로젝트 조회 지연은 지정 시나리오에서만 주입했다. 실제 VS Code UI와 디스크 저장 통합 재현은 하지 않았다.
- 설치본에는 `azrael-persisted-atoms-v1` 주입이 없고 `out/persisted-atoms.cjs`도 없다. 작업 소스의 SQLite 저장 구현과 다르므로 Memento 경로로 검증했다. 처음 SQLite 모듈을 읽으려던 명령은 ENOENT로 종료 코드 1, 어떤 저장 실행이나 파일 생성도 하지 않았다. 이를 수정한 실제 실험 명령은 종료 코드 0이다.

### 실제 보호 로직
`Pm(..., delay=0)` 삭제는 같은 atom의 `jm`을 호출해 pending timer와 entry를 제거하고 즉시 삭제를 게시한다. `i3e`는 pending entry의 token과 store revision이 같아야 게시한다. 따라서 취소 직전 예약된 옛 콜백을 강제로 호출해도 entry가 없으면 저장하지 않는다. 이미 host queue에 들어온 쓰기는 `enqueueUpdate`가 저장 완료까지 직렬화한다.

### 결과

| 조건 | 게시 순서 | 저장 commit 순서 | 최종 초안 |
| --- | --- | --- | --- |
| 저장 타이머 전 삭제, 이후 350ms 대기 | delete | 없음 | 없음 |
| 삭제 후 취소된 콜백 강제 호출 | delete | 없음 | 없음 |
| 타이머 실행 후 삭제 | save → delete | A → 없음 | 없음 |
| 저장 commit을 보류한 채 삭제 요청 후 commit 해제 | save → delete | A → 없음 | 없음 |
| 이미 게시된 save의 프로젝트 조회만 지연, delete 먼저 완료 | save → delete | 없음 → A | A 복원 |

마지막 조건에서는 삭제 직후 초안 부재를 확인하고, 보류한 옛 저장을 풀자 A가 다시 저장되는 것을 확인했다. host는 레코드 merge/쓰기 queue에 들어가기 전에 `await getWorkspaceProject()`를 호출한다. webview 메시지 listener는 `this.handleMessage(e,u)`를 개별 실행하며 완료를 기다리는 공통 queue가 없다. 따라서 이 조회 구간에서 순서가 역전되면 저장 queue 자체의 직렬화로는 막지 못한다.

다만 이 지연은 인위적으로 주입했다. 실제 `getWorkspaceProject`와 `getWorkspaceRoots`를 로컬 `file` 프로젝트 조건으로 1,000쌍 실행한 결과 save/delete 진입 역전은 0회였다(명령 종료 코드 0). 가상 workspace는 파일 생성·조회 비동기 경로가 있지만 이번 사용자 창에서 그 경로를 사용했다는 증거는 없다. 위 재현을 일반 로컬 프로젝트에서도 자연 발생하는 것으로 해석하지 않는다.

### 결론과 다음 수정 판단
단순히 250ms pending timer가 삭제 후 살아남는 가설은 이번 실제 함수 실험에서 재현되지 않았고 명시적 취소·token 보호와도 맞지 않는다. 이미 host에 게시된 저장이 삭제를 뒤늦게 추월하는 경우는 조건부 재현됐으나 실제 사진의 원인으로 입증되지 않았다. 이전 최초 clear 생략 경로는 별개로 재현된 결함이다. 따라서 타이머 취소를 새로 추가하는 수정은 근거가 없다. 텍스트 정리 수정과 별도로 조회 전부터 저장·삭제 순서를 보장할 필요성을 평가하되, 실제 창의 이벤트 순서를 관찰하지 않고 이를 원인으로 단정하지 않는다.

일회용 코드는 stdin/메모리에서 실행했고 별도 테스트 파일, raw 로그, DB, 백업을 생성하지 않아 추가 정리 대상은 없다. 결과 요약은 본 기록에 유지한다.

## 입력란 복구 자체의 재현

### 목표와 범위
사용자 요청에 따라 저장 레코드가 되살아나는지에서 한 단계 확장해, 실제 입력 복원 코드가 전송 후 빈 편집기에 같은 문장을 다시 넣는지 검증했다. 실제 설치본 `2026.0.16`의 `zMa`, `Fyr`, `Bba`, `NG`, `sbr`, `cbr`, `dbr`, `Lyr`, `xMa`, snapshot 비교 함수 본문을 그대로 추출해 실행했다.

기존 composer fixture의 controller·atom·RPC 어댑터를 사용하고, 기존에 빠져 있던 `xMa`의 retained 초안 감시를 연결했다. `XG`와 `eK`의 파생 의미는 설치 코드와 대조했다: retained와 같은 저장 초안은 감추고, retained가 없어지면 저장 prompt를 노출한다. React hook 실행과 atom 변경 통지는 제한된 메모리 어댑터다. 따라서 실제 VS Code 창, 실제 React 스케줄러, 실제 ProseMirror 화면, 실제 호스트 메시지 전달을 통합 재현한 것은 아니다. Windows 제어 가이드는 Codex 확장 자동조작을 금지하므로 해당 UI의 자동 전송은 시도하지 않았다.

### 결과: 명령 실제 종료 코드 0

| 시나리오 | 실제 입력 상태 순서 | 전송 호출 | 오류 | 마지막 저장 초안 |
| --- | --- | --- | --- | --- |
| 정상 성공, 저장 상태 변경 없음 | A → 빈 문자열 → 빈 문자열 | 1 | 없음 | 없음 |
| clear 뒤 동일 prompt의 부가 정보 변경 후 성공 | A → 빈 문자열 → A | 1 | 없음 | A |
| clear 뒤 응답 실패 주입 | A → 빈 문자열 → A | 1 | controlled response failure | A |

성공 재현의 이벤트 순서는 `start=A`, `after-clear=''`, `same-prompt-metadata-update=''`, `native-setPromptText=A`, `end=A`였다. 복원하려고 테스트 코드에서 직접 `revisit()`이나 텍스트 복원 함수를 호출하지 않았다. 설치 `xMa` 감시 콜백이 `setPromptText`를 호출했다. 실패 시나리오는 의도된 재시도 복구 대조군이며, 이를 성공 전송 결함으로 혼동하지 않는다.

성공 시나리오는 clear 후 `{prompt:'A',pullRequestChecks:[]}` 저장 값에 `usedDictation:false`를 추가한 경우다. 이는 사용자의 새로운 텍스트 입력 없이 저장 상태만 바뀌는 사건을 어댑터에서 주입한 것이다. 이 부가 정보 변경이 실제 사용자 창에서 자연 발생했다는 증거는 없으며, 저장 타이머 자체가 이를 만들었다고 주장하지 않는다.

### 확인된 복원 연결
1. 전송 초안을 retained 상태로 잡고 `Bba`가 입력란을 실제로 비운다.
2. clear 이후 저장 draft가 retained draft와 완전히 같지 않게 된다. 문장 A는 그대로다.
3. 성공 release에서 전체 snapshot 비교가 실패하고 `cbr`도 false가 되어 해당 저장 초안을 삭제하지 않는다.
4. retained 소유권은 해제된다.
5. `xMa`는 retained 해제를 감지하고 `eK`의 A를 읽어 빈 입력기에 `setPromptText(A)`한다.

따라서 앞서 재현한 최초 clear 생략 외에도, 성공 후 saved draft와 retained draft의 부가 정보 불일치 때문에 실제 복원이 일어나는 코드 경로가 확인됐다. 기존 fixture는 이 native 복원 hook을 실행하지 않았으므로 입력란이 빈 상태만 확인하면 이 경로를 놓칠 수 있다.

### 다음 수정 판단
승인된 수정 방향은 텍스트·문서 편집 소유권과 저장 초안의 전체 객체 동등성을 분리하는 것이다. 성공 시 해당 전송 텍스트가 남지 않게 정리하되 새 사용자 입력·첨부를 보호하고, native `xMa` 복원까지 포함해 확인한다. 실제 메시지/편집/저장 이벤트가 어떤 순서로 발생했는지는 추가 실사용 관찰이 필요하다.

최초 통합 실험은 hook 어댑터의 `Dh` 식별자 누락으로 종료 코드 1이었다. 어댑터에 누락된 상수만 추가한 재실행에서 위 세 시나리오의 assertions가 통과했고 종료 코드 0이었다. 설치 함수 본문은 수정하지 않았다. 모든 실험은 stdin/메모리에서 종료됐으며 별도 정리 대상 파일·브라우저·프로세스를 남기지 않았다.

## 구현 및 검증

- 루트 소유: `scripts/inject-composer-draft.cjs`, 계약 문단, 기존 feature inventory의 검사 소유자 연결, 본 기록과 통합·커밋·정리. 테스트 executor는 `scripts/test-composer-draft.cjs`만 소유했고 작업 전 미커밋 변경을 보존했다. 제품 요구 해석과 최종 수락은 루트가 수행한다.
- 기존 `$U` 문서 구독, `Symbol.dispose`, native `RG.setDraft` 조건부 갱신과 기존 `Bba`를 재사용한다. 새 저장소·의존성·초안 비활성화는 도입하지 않는다. 실제 문서 편집을 revision으로 추적하고 전송 자체의 programmatic clear는 구분한다.
- 전체 편집 상태가 같으면 native clear를, 첨부·선택만 다르면 text-only clear를 수행한다. 저장 draft 부가 정보는 full editor clear 판단에서 제외한다. 저장 정리는 제출한 persisted prompt와 같은 레코드에만 expectedValue를 붙여 적용하며 새 비텍스트 필드와 다른 prompt를 보존한다.
- native `xMa`는 성공 또는 편집 소유권을 잃은 release에서 옛 초안을 다시 삽입하지 않도록 제어한다. 실패 복구는 기존 편집 소유권 조건으로 유지한다. 주입 marker는 v5로 변경한다.
- 기존 회귀에 native `xMa` 효과와 문서 변경 구독을 연결한다. 이 경로를 fixture에서 누락하거나 전체 객체 비교로 회귀시키는 실수를 방지하기 위해 기존 검사에 포함해 유지한다. 테스트 수 자체를 늘리는 것이 목적은 아니다.
- `project_tests.plan(sent-draft-restoration-source)` 호출이 장시간 결과를 반환하지 않아 대기 cell을 종료했다. 테스트 run은 호출하지 않았다. 기존 `scripts/test-project.cjs.runSelection` owner를 사용해 동일한 검토된 Node 명령을 실행한다. 계획 호출의 지연을 제품 테스트 성공/실패로 취급하지 않는다.
- 첫 managed 실행: `2026-11-03T09-45-17-754Z-7ada6aba-892a-40c9-b4cf-84977ca1542c`, composer 62개 중60개 통과, 종료 코드1. 입력 복구 방지는 동작했으며 새 non-text 필드 보존 기대와 변경된 transform corruption needle 두 곳을 수정했다. 실행 lifecycle은 owner가 stopped/failure로 정상 종료했다.
- 두 번째 실행은 관련 4파일 묶음 91개 중90개 통과, 종료 코드1. `/btw` fixture가 새 문서 추적 helper를 로드하지 않아 실패했으므로 실제 helper와 disposal adapter를 연결했다. 이어 native 첨부 custody가 조기 해제되는 경우에도 saved prompt를 소비하도록 보완했다.
- 최종 검증: `node --test scripts/test-composer-draft.cjs scripts/test-namespace-cache-owner.cjs scripts/test-btw.cjs scripts/test-project-drafts.cjs`, Windows에서92개 모두 통과, skipped/cancelled0, 실제 종료 코드0. KST 2026-11-03 18:51:11.529~18:52:33.611(82.082초). 실행 중 입력 스크립트는 변경하지 않았다. 편집 및 저장 metadata 변경, native `xMa` 복원 방지, 같은 문장 재입력, 새 prompt B와 조건부 저장 충돌, 첨부 custody 조기 해제, 실패 복원, 구독 해제, `/btw`, namespace 캐시 및 프로젝트 초안 범위를 포함한다. Linux/macOS native 실행과 설치창 검증은 하지 않았다. 시각적 레이아웃·색상은 변경하지 않았다.
- 작업 로그는 확인을 마쳤고 아래 최소 결과를 보존했으므로 owner 정리 대상으로 전환한다. 정리 그룹은 이 작업의 아래3 run만이며 다른 작업의 artifacts·설치본·사용자 초안은 포함하지 않는다.

### 독립 보존 검증 근거

| run(공통 앞부분 `run:FJ-01-sent-draft-fix:`) | 결과 | 실제 exit | results.json SHA256 |
| --- | --- | --- | --- |
| `2026-11-03T09-45-17-754Z-7ada6aba-892a-40c9-b4cf-84977ca1542c` | 60/62, 2건 수정 후 재실행 | 1 | `ea4760b69380bb201f587fa6c8c500f47b140f937ed4a9fb22d7d231b1364884` |
| `2026-11-03T09-49-03-341Z-43ac0eeb-a89a-4804-bd63-00f9348986b2` | 90/91, btw adapter 수정 후 재실행 | 1 | `2f60e7910c4bd8074862647e65aa46f07a392331592a971b2164cadd72b3c2ab` |
| `2026-11-03T09-51-05-721Z-a1897097-9c98-488c-b0a1-d1274c3a7a3b` | 92/92 | 0 | `2e2405be83d8b1edb4263e44b4cdfc5e817cde9bd9c7eeba2fe4c0d62c64dc2f` |

모든 run의 명령은 terminal close를 반환했고 signal은 null, 해당 producer는 owner 영수증에서 stopped이다. 재실행은 테스트 기대/어댑터 보완과 첨부 custody 통합 보완 때문에 필요했다. 상세 stdout/stderr는 각 run의 `logs/`에 생성했으며 최종 검토 후 owner로 삭제했다. 이 표와 실행 범위/실패 원인 설명은 삭제 이후에도 남는 검증 요약이다.

검증한 working source의 SHA256: `scripts/inject-composer-draft.cjs` = `cc123c6a6e9489ec2f5ba7f1b242401df067737efdc8b46438b390f7ce2d69ec`, `scripts/test-composer-draft.cjs` = `8bbf210a2d1e4d1b1f2ddec6dc23cd106a274f76b72ae8a5ec27c9a4eb927cc7`, `scripts/test-btw.cjs` = `56d6558f70b1c311ce2d546f803c3d461dbc203e8c8186ed338650919e0c3b8f`.

커밋은 별도 Git index로 이번 변경만 구성해 기존 staged engine/instruction 변경을 포함하지 않는다. 공유 테스트 파일의 기존 테스트 제거와 owning 문서·feature inventory의 다른 변경도 working tree에 보존하며 이번 커밋에는 포함하지 않는다. 기존 파일의 줄바꿈 형식은 유지한다. 임시 index는 Git 작업 종료 후 일반 삭제하고 부재를 확인한다.

### 정리 수락

검증된 Windows standalone owner로 3run 합계33,825 logical bytes 및 빈 상위 task container(0bytes)를 삭제했다. register/review/apply/finalize의 실제 종료 코드는 모두0이며, 모든 삭제는 `deleted`, `remaining:false`, `error:null`이다. `artifacts/tasks/FJ-01-sent-draft-fix` 실제 부재와 해당3run 및 container lifecycle 기록0개를 확인했다. 실패 run의 결과는 변경하지 않았다. 물리 회수 bytes는 owner가 제공하지 않으므로 주장하지 않는다.

첫 native register의 catalog Busy가 남긴 예약은 원 spawnSync terminal exit1과 비자식생성 register 경로를 확인한 뒤 지원 `recover_reservation`으로 복구했다. `execution_outcome_changed:false`, `pending_intents_changed:false`였다. 필수 보호 control evidence `artifacts/maintenance/evidence/fj01-registration-reservation-recovery.json`(1,774bytes)과 native 관리 영수증은 owner의 복구 근거로 유지한다. raw 로그·요청파일·빌드·백업 잔여물은 없다. 사용자 정상 동작 확인용 산출물 보관 대기는 설정하지 않는다. 현재 설치본에는 수정이 아직 적용되지 않았다.

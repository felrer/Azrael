상태: 사용자가 세션 6 복구 시도를 종료하고 관련 데이터 정리를 요청했습니다. 시험용 개발 창과 복구 도우미를 정상 종료하고 외부 프로필의 시험용 확장 변경을 복원했습니다. 재시도 파일 25개를 삭제한 뒤, 사용자가 명시적으로 요청한 Windows 관리자 권한으로 남은 복구 요청 파일 3개와 폴더도 삭제하고 부재를 확인했습니다. 이어 사용자의 별도 세션 종료 지시에 따라 세션6을 로그오프하고 Window Use의 childAbsent:true 및 세션6 프로세스0개로 종료를 확인했습니다. 부모 세션2와 로그인·설정은 유지합니다. 종료 미확인 producer가 참조하는 빌드·진단 자료는 보존합니다. 복구·그림판 제어 성공은 확인되지 않았습니다.

# Window Use 관리자 준비 및 런타임 반영

### 일회성 관리자 복구 — 시험 종료, 외부 요청 데이터 정리

모든 개별 자식 세션 파일 정리: 사용자가 검증 기록을 남기고 모든 자식 세션 파일 삭제를 지시하여 외부 f 프로필의 미갱신 세션5·6 resources.json, 세션4·5 로그오프용 생성 소스/실행파일5개, 세션6 및 관련 관리자 정리의 임시 소스/실행스크립트9개를 일반 Remove-Item으로 삭제했습니다(합계15파일, exit0, 실패0, 잔여0). 삭제 전 세션4·5·6 프로세스와 도우미 및 외부 프로필 writer의 부재를 확인하고 정확한 경로·상위 reparse 부재·파일SHA256을 고정했습니다. resources.json은 session 레코드2개만 있고 history·파일entries·leases·consumers가 비어 있음을 확인했습니다. 종료된 레코드의 최소 식별 정보는 검증 증거로 producer.json에 보존하고 실행 관리 인덱스에서는 제거했습니다. 외부 Window Use 디렉터리에는 공용 owner.json만 남았으며, 두 상태 루트의 child-bootstrap 및 Azrael.Child RunOnce 잔여는 발견되지 않았습니다. 세션별 독립 Windows 프로필을 만든 구조가 아니므로 공유 로그인·설정은 삭제하지 않습니다. 검증 JSON·로그·이미지·검증스크립트와 공용 제품/회귀용 native helper·참조 중 빌드 자료는 보존합니다. 증거: artifacts/maintenance/child-session-retirement-20261018/{producer.json,result.json}. 실제 기존 세션5 종료 검증 JSON, child-input-verified.png, 세션6 종료 검증 JSON의 존재를 재확인했습니다.

세션 종료: 사용자가 세션6 종료를 명시적으로 지시하여 Window Use context/resource_status/cleanup을 먼저 확인했습니다. 관리 소유 세션과 정리 자원이 없고 sessionCleanup:false/existing_child_not_owned였으며 cleanup은 아무 세션도 종료하지 않았습니다. Windows 자체 종료 작업으로 범위를 전환해 부모2·실제 WTS child6·기록된 winlogon2664/생성1792281055504ms·동일 SID를 관리자 권한에서 재확인한 뒤 WTSLogoffSession(6,false)을 호출했습니다. 실행 exit0/requestAccepted:true/error0이며 독립 Window Use 재조회는 childAbsent:true/idError1168/errors:[]/parent2, Windows 프로세스 재조회는 세션6에0개로 종료를 확인했습니다. 이전 앱 보존 지시는 이 후속 종료 지시로 대체됐습니다. 최소 실행·검증 근거는 session6-cleanup-20261018의 session6-logoff-result.json 및 session6-logoff-verification.json에 보존합니다.

정리 범위는 Windows x64 로컬의 세션6 복구 시험 데이터이며, 소스 기능 제거·세션 로그오프·사용자 상태 삭제는 포함하지 않습니다. 외부 f 개발 Code18340을 CloseMainWindow로 종료하고 기록된 전체 프로세스 트리 및 helper53676의 종료를 확인했습니다. 자식6 프로세스는 정리 전후32개였으며 로그오프나 앱 종료를 요청하지 않았습니다. agent-runner/extension.cjs는 시험 전 바이트로 복원했습니다. 별도 외부 관리 루트 av18에서 등록한26항목 중 재시도006~008과 개발 실행 상태25파일은 관리 도구로 삭제하고 실제 부재를 확인했습니다. manual-recovery 폴더의 일반 삭제는 처음 실패했으나 사용자가 관리자 권한 삭제를 명시적으로 승인했습니다. 동일 SID의 Windows RunAs 실행에서 고정 절대 경로·상위 경로 reparse 부재·정확한 파일3개·각 SHA256을 재확인한 뒤 일반 Remove-Item으로 파일과 빈 폴더를 삭제했습니다. 관리자 실행 exit0/elevated:true/directoryRemoved:true/error:null이며 독립 Test-Path도 false입니다. 강제 삭제·속성·ACL 변경은 없었습니다. 삭제 후 내장 관리 도구 재검토는 tree entry disappeared 오류로 기록 갱신에 실패했으며, 실제 부재 근거는 admin-delete-result.json과 최종 result.json에 보존합니다. 원래 복구 run과 u20a/u20b는 u20b wrapper의 실제 최종 종료가 미확인이고 Git/UI 공유 참조가 있어 보존하며, 정확한 producer 종료 및 마지막 소비 참조 해제 후 재검토합니다. 근거와 실제 정리 결과는 artifacts/maintenance/session6-cleanup-20261018에 둡니다. 이 보존은 복구 재시도를 계속한다는 의미가 아닙니다.

2026-10-18 15:03 KST 실제 재시도008: 사용자의 명시적 재시도로 이전 완료 turn007을 확인하고 동일 u20a 개발 host6976에서 실행했다. 이전 미소비 ticket d6859503…를 보존 이름으로 이동한 뒤 새 b60cc10f…를 생성했다. prepare_permissions는 authorized:true/prepared:true로 실제 승인됐고, 정상 request_stage3이 ticket을 소비했지만 native_child_error/HRESULT -2146233079/phase:start로 실패했다. admission:null, ownershipVerified:false, cleanupUnconfirmed:true이며 WTS는 기존 child6 live를 확인했다. helper53676은 parent2/host6976 하위에 남아 보존했다. broker 디렉터리에 receipt는 남지 않았고 TaskScheduler Operational 로그는 비활성화되어 과거 실패 원인을 복구할 수 없었다. 소스상 broker 실패 메시지 뒤에 경로·세미콜론을 붙이고 진단 경계가 전체 문자열을 가려 실제 원인을 사용자에게 전달하지 못하는 공백이 있다. 이는 실패 원인 자체의 확정이 아니다. 네이티브 결과가 불명확하므로 재실행·강제 정리·세션 로그오프하지 않았다. 그림판 실행·클릭·드래그는 미시도다. 요약은 live/retry-008-summary.json, 실제 turn은01a14d9a-c497-74d3-ace4-1c5ae8491790이다.

2026-10-18 05:53Z 사용자 명시적 재시도: 외부 실제 host6976 생존·identity와 이전 turn 완료를 확인하고, 정확히 소유한 만료 ticket076bb982…를 같은 private 폴더 expired.UUID.json으로 보존한 뒤 새 ticketd6859503…를 만들었다. retry007/turn01a14d91…의 prepare_permissions는05:52:26~05:53:16 50초 후 approval_timeout/expired/userResponded:false/actionExecuted:false로 종료됐다. request_stage/UAC/앱 실행·입력은 미시도이며 세션6과 앱을 유지했다. 카드가 표시됐다는 증거는 없으므로 사용자 무응답 원인으로 단정하지 않는다. 사용자에게 카드가 보였는지/허용을 눌렀는지 관찰을 요청했다. 승인 관련 bounded host/renderer 로그에는 해당 시점 오류가 없고, 코드상 ordinary publisher는 view에 broadcast하며 Windows 알림 클릭 시에만 정확한 대화로 이동한다. 실제 카드 표시·렌더·응답 경로는 아직 미검증이다. 증거 live/retry-007-summary.json 및 외부 retry-007-events.jsonl. 명시적 재시도 대기 규칙을 유지한다.

2026-10-18 04:53Z 설치 없는 실제 요청 결과: 정리한 환경의 세 번째 개발 창에서 04:52:26Z 준비 응답을 확인했다(실제 extension host6976, 정확한 u20a 경로/host SHA bb850446…/version2026.0.10/f/s). 복구 ticket076bb982…를 생성하고 실제 스레드01a14c5c…에 retry006 turn01a14d5a…를 전달했다. Agent가 새 manifest63944c85…의 context와 규칙을 읽고 prepare_permissions를 호출했으나 50초 무응답으로 approval_timeout/expired/userResponded:false/actionExecuted:false가 반환됐다. turn은04:53:48Z completed. request_stage/UAC 복구/그림판 실행·입력은 미시도다. 공통 가이드의 명시적 재시도 대기 규칙에 따라 자동 반복하지 않는다. 세션6·앱·개발 창·진단 증거를 보존한다. 실제 결과는 live/retry-006-summary.json 및 외부 agent-io/retry-006-events.jsonl에 기록했다. u20b는 독립 검증 중이며 이번 무응답과 인과관계가 없다.

2026-10-18 04:46Z 설치 없는 시험 경로: 사용자가 다음 패키지 설치 없이 가능한 시험을 지금 진행하라고 지시하여, 동일 VSIX와 준비된 u20a 확장 폴더 20,916개 파일을 대조(exit0)한 뒤 외부 f 프로필에서 개발 확장으로 실행했다. u20a 동일 VSIX SHA256 `8de490a25888d87edc667f509067ec6fc7697bc63de6d913ec5920e478a45d85`의 새 g/s fixture 호스트6단계는 모두 exit0으로 수락됐다. 설치 등록은 변경하지 않았다. 첫 GUI 실행은 상속된 ELECTRON_RUN_AS_NODE 때문에 시작하지 못했고, 두 번째 실행은 실제 개발 확장 활성화 후 엔진 endpoint discovery 10초 제한에서 실패했다. 동일 엔진을 정리한 환경으로 독립 조회하니 exit0/6.8초로 정상 descriptor를 반환했다. 외부 시험 창만 CloseMainWindow로 정상 종료하고 04:52Z 같은 환경 정리 방식으로 재실행했다. 시험 runner는 실제 확장 경로·버전·호스트 해시·f/s를 검증하며 실제 native bridge/thread/turn만 사용한다. 아직 새 복구 ticket이나 retry006은 보내지 않았다. 세션6·기존 앱·기본 창을 유지한다. 증거는 해당 run의 live/dev-host-* 및 live/dev-endpoint-probe.json에 보존한다.

사용자가 일회성 스크립트를 작성해 관리자 복구 요청을 보내고 기존 세션을 재연결하는 구현과 실행을 승인했다. 세션 6을 닫거나 새 자식을 생성하지 않고 외부 격리 프로필에서 진행한다. Windows x64 로컬 실행에 한정하며 자동 복구 기능은 후속 제안으로 남긴다. 루트는 요청 스크립트·관리자/격리 실행기 연동·문서·최종 수락을 소유하고 native 담당은 기존 helper 안의 명시적 recover 경로와 임시 작업 스케줄러 실행을 소유한다. 공통 코드의 기존 단계·앱 승인과 다른 플랫폼의 동작은 유지한다.

스크립트가 지정 상태 루트의 private one-shot 요청을 생성하고, 승인된 3단계 활성화 중에만 호스트가 해당 요청을 소비한다. 관리자 broker는 명시한 기존 자식 세션·동일 SID/프로필·부모 세션과 살아 있는 helper 점유 부재를 재확인한 뒤 임시 트리거 없는 작업으로 일반 사용자 helper를 해당 세션에 실행한다. 관리자 토큰을 worker에 전달하지 않는다. 실제 연결은 기존 무작위 pipe/challenge, peer PID/시작 시각/helper hash/SID/세션 검증과 플랫폼 admission을 모두 통과해야 한다. 요청이 없으면 기존 무소유 세션 거절 동작을 유지하며 자동 인계는 추가하지 않는다. 성공 여부와 무관하게 기존 세션 로그오프·기존 앱 종료·불명확 입력 재실행은 수행하지 않는다.

산출물은 `artifacts/tasks/DU-01-window-use-stages/runs/20261018-manual-recovery-r1`에 귀속한다. 먼저 요청·권한·점유·취소·만료와 native 컴파일을 검사하고, 선택 소스를 고정한 외부 프로필 배포와 필수 호스트 수락을 수행한 뒤 실제 UAC/재연결 및 그림판 클릭·드래그를 검증한다. 연결 가능 여부와 임시 작업 삭제 여부는 실제 결과로 확인한다.

현재 근거: native attempt3 컴파일·자체 검사 exit 0, 관리자/격리/권한 선택 검사 65개 중 64개 통과·선택 native fixture 1개 보류 후 동일 고정 native를 지정한 관리자 검사 21/21 통과, Windows PowerShell 요청 생성 성공·중복 거절을 확인했다. 읽기 전용 WTS 조회는 부모 2와 살아 있는 자식 6을 확인했다. 배포 소스 `u20a`의 r1은 대상 폴더 누락, r2는 대상 Git 메타데이터 누락으로 실패했다. r3에서 대상 메타데이터와 기준본 인덱스를 복구하고 전체 기준본 24,416개 파일·473,034,596바이트·SHA `998937b978675e9e98846a8832f3af171683734b832df6ff32734184a46155f1` 일치를 확인한 뒤 선택 변경 7개만 적용했다. 최종 고정 소스는 24,418개 파일·473,069,153바이트·SHA `c8eade56031cb59fc35d2a437686c22c711063c2bdef73b75ddd152a979ad0b1`이며 `u19c`의 Git 객체를 참조하므로 기준본을 보존한다. 패키지 빌드·호스트 6단계·실제 UAC 수락은 별도로 확인한다.

배포 preflight와 engine source 검사는 exit 0이었다. 첫 source sweep은 테스트용 UI 원본에서 필요한 asset 5개가 빠져 ENOENT로 실패했다. 제품 소스 변경 없이 같은 pristine `26.1007.21434`에서 해당 fixture를 보충하고, 실패 검사와 필수 source sweep부터 별도 실행 기록으로 재개한다. 최초 실패 기록은 보존하며 패키지·호스트 수락 완료 전에는 설치하지 않는다.

사용자는 기본 세션에 그림판을 먼저 여는 준비를 거부하고 격리 세션에서 직접 열도록 명확히 했다. 기존 공개 API가 관찰한 부모 창만 허용한 것이 원인이므로, 현재 사용자에게 등록된 Windows MSIX full-trust 앱의 `packageName`·선택 `applicationId`를 검증해 같은 관리형 실행 경로에 전달하는 변경을 진행한다. arbitrary 실행 경로·명령·인자·URI는 허용하지 않는다. 앱 승인은 기존 Azrael UI를 재사용하고 승인 후 등록을 재조회·해시 고정한다. 루트는 host/policy/MCP·회귀 검사·가이드·문서, resolver 담당은 기존 child 모듈의 읽기 전용 등록 조회와 단위 검사를 소유한다. Windows 로컬 MSIX 지원에 한정하며 다른 앱 종류나 플랫폼 지원을 확대하지 않는다. 실제 이 PC의 `Microsoft.Paint` 11.2605.81.0, manifest application `App`, `PaintApp/mspaint.exe`를 읽기 전용으로 식별했다. 고정 소스 u20a의 관리자 복구 검증은 유지하며 추가 변경은 별도 고정 입력·패키지 수락으로 반영한다.

직접 실행 변경의 resolver 단위 검사 8/8과 policy/MCP/격리 입력/단계 권한 통합 검사 41/41이 exit 0으로 통과했다. 통합 r1의 새 fixture에는 필수 authorize 콜백이 빠져 이를 수정했다. 기존 실패 admission fixture의 리소스 정리 검사는 r1에서 `failed`였으나 원인이 출력되지 않았으므로 결과 reason을 assertion에 포함했고, 동작 변경 없이 r2에서 통과했다. 이를 별도 수정 완료로 과장하지 않고 최초 실패 로그를 보존한다. 선택 변경 12개의 해시는 `deployment/u20b-overlay-ready.json`에 고정했으며 feature inventory는 u20a에 신규 검사 2개만 추가한 파생본을 사용한다. 패키지와 실제 MSIX 실행은 아직 미수락이다.

추가 통합 검토에서 비동기 등록 조회·해시 계산 중 앱 승인이 철회되어도 기존 launch 최종 검사가 단계 권한만 확인하는 공백을 발견했다. 최종 launch에 같은 앱 identity를 전달해 앱 승인까지 다시 확인하도록 수정하고, resolver 도중 철회 시 native launch가 0건인 검사를 추가했다. selector 오류도 `unclassified` 대신 명시적 `invalid_request`로 반환한다. 최종 조합 검사 50/50·skip 0·exit 0이며 `tests/installed-integration-r4.log`를 보존한다. 고정 변경은 revision 3의 13개다. u20b r2는 이전 revision을 읽은 상태에서 host 해시 변경을 검출해 실패했고, 원본 복사를 반복하지 않고 선택 변경만 보정한 r3가 성공했다. 최종 소스는 SHA `9ba0e1d56df364c333e1eec4cfcdbfb00561b442b09417feab695a223f405f69`, 24,420개 파일, 473,091,069바이트다. u20a와 u19c Git 객체 및 u20a의 검증된 pristine UI 입력은 소비 관계를 기록해 보존한다. 사용자가 기다리는 동안 연 부모 세션의 그림판은 최소화 상태로 식별만 했고 복원·입력하지 않았다. 현 설치본의 stage 3 admission은 여전히 미충족이므로 실제 실행은 새 설치본 수락 후 진행한다.

### 기존 자식 세션 자동 소유 연결 복구 — 후속 설계 제안

사용자는 소유 연결이 없는 경우 Agent의 판단이나 별도 도구 호출 없이 내부에서 자동 연결을 시도하는 방식을 검토하도록 요청했다. 현재 범위는 조사와 설계 권고이며 제품 구현·기존 세션 인계 실행은 승인된 것으로 취급하지 않는다. 대상은 Windows 로컬 자식 세션의 호스트 재시작·확장 재설치 후 연결 복구다. 기존 단계·앱 승인 의미는 공통 계약으로 유지하고 Linux나 원격 환경의 지원 확대는 포함하지 않는다.

현재 `createWindowsChildSessionManager`의 transport·identity·inputOwner와 격리 실행기의 current·owner는 프로세스 메모리 상태다. 같은 실행기 안에서는 warm child acquire가 가능하지만, 새 호스트는 probe에서 살아 있는 child를 발견하면 `existing_child_not_owned`를 선행 차단한다. native Start도 기존 child를 거절하고, worker는 단일 부모 pipe 연결을 사용하며 연결 종료 시 입력을 해제한다. bootstrap journal의 복구는 RunOnce 준비 상태 정리용으로, 실행 중 세션의 인증된 재연결 기능을 대체하지 않는다. 따라서 단순 재시도나 차단 제거만으로 자동 복구를 구현할 수 없다. 근거: `scripts/window-child-session.cjs`의 manager/start, `scripts/window-use-isolation.cjs`의 start/acquire, `native/windows-child-session/ChildSession.cs`의 Start/ValidateIdentity/Worker.

권장안은 유효한 3단계 요청의 내부 절차에 인증된 reconnect를 추가하는 것이다. Agent는 기존처럼 3단계를 요청하며 호스트가 기존 연결 재사용, 검증된 자기 세션 재연결, 세션 부재가 입증된 경우의 생성 경로를 결정한다. 관찰 전용 context 호출은 연결·생성을 시작하지 않는다. 연결 검증과 실제 작업의 입력 임대를 분리하고, 재연결 성공으로 단계·앱 승인을 새로 만들거나 만료·철회를 취소하지 않는다.

구현하려면 사용자 권한으로 동작하는 연결 관리자의 수명을 VS Code 창보다 길게 유지하거나 재인증을 받을 수 있는 worker 수명/통신 구조를 마련해야 한다. 보호된 복구 기록과 인증된 IPC를 재사용 가능한 기존 리소스 임대 구조에 연결하고, Windows 계정 SID·프로필·부모/자식 세션·세션 수명·worker PID와 생성 시각·검증된 helper 버전/프로토콜 및 제어 범위를 확인한다. 세션 번호나 계정 일치만으로 인계하지 않는다. 비밀 인증 정보는 모델·일반 로그에 노출하지 않으며 기존 Windows 보호 저장소와 접근 제어를 우선 검토한다. 다른 살아 있는 호스트나 작업이 입력 임대를 소유하면 자동으로 빼앗지 않는다. 연결 복구 후 과거 타깃·관찰은 폐기하고 새 캡처와 필요한 admission을 확인하며, 결과가 불명확했던 클릭·드래그를 재실행하지 않는다.

복구 시도는 제한된 시간과 횟수 안에서 처리하고, 증명 부재·기록 변조·세션/PID 재사용·버전 불일치·점유·취소·권한 철회 시 원인을 반환한다. 실패했다고 기존 세션을 로그오프하거나 별도 자식 세션을 강제로 만들지 않는다. 현재 세션 6은 구버전의 복구 가능한 인증 정보와 살아 있는 제어 구성요소가 있는지 아직 확인하지 않았으므로 이 설계로 복구된다고 보장하지 않는다.

검증 기준은 호스트 재시작·외부 프로필 재실행·재설치 후 자기 세션 자동 재연결과 그림판 클릭/드래그의 새 캡처 확인, 두 호스트 동시 복구의 단일 입력 소유, 다른 프로필/계정·변조·stale 세션/PID·호환되지 않는 helper·취소/철회의 거절, 불명확한 입력의 비재실행, 부모 입력 무영향이다. 우선 관리형 재연결과 수명 분리 가능성을 작은 Windows 검증으로 확인한 뒤 본 구현과 배포를 진행하는 안을 권장한다. 제품 코드는 이 검토에서 변경하지 않는다.

### 재설치 후 그림판 재시험 — 2026-10-18

사용자의 재시험 요청으로 외부 프로필의 기존 테스트 전달기를 재실행하고 실제 native RPC를 통해 기존 외부 Agent 대화에 `retry-005`를 전달했다. 제품이나 권한 설정은 변경하지 않았다. 실제 thread `01a14c5c-7f32-7da3-a6b3-82c56f5a79ce`, turn `01a14cf9-218a-7af1-93bb-c67697ad7c25`는 UTC 03:05:57 시작 응답 후 03:06:51 `completed`, `error:null`로 끝났다. 근거는 `C:/Users/felre/av18/artifacts/f/agent-io/retry-005-{producer,delivered,events,completed}` 파일이다.

결과는 그림판 제어 통과가 아니다. 관리형 내부 권한 준비는 `authorized:true`, `prepared:true`였으나 실제 `request_stage(3)`가 `authorized:false`, `existing_child_not_owned`를 반환했다. 최신 Agent 진단은 자식 세션 6 생존, `ownershipVerified:false`, `connectionAttempted:false`다. 그림판 앱 승인·입력·전후 캡처를 수행하지 않았고 기존 앱과 세션을 유지했다. 내부 승인 UI 변경은 이 별도 소유권 장애를 해결하지 않는다. 기존 소유 관리형 연결 복구 또는 검증된 복구 경로가 다음 선행 조건이다. 해당 실패를 재현하고 후속 테스트에 사용하기 위해 외부 프로필·전달기·작은 요청/결과 기록을 보존하며, 소유 연결 문제가 해결되고 세션 유지 요구와 활성 참조가 해제되면 함께 정리 여부를 검토한다.

### 외부 설치 확인 — 2026-10-18

외부 검증 복사본 정리도 최종 완료했다. `deployment/external-cleanup-result.json`의 그룹·항목 결과가 모두 `deleted`, `remaining:false`, `error:null`이고 실제 `f/host6-u19c` 경로 소멸을 확인했다. Native 삭제 도구가 전체 트리 재검증·해시·Windows 경로/속성 검사를 반복하므로 3.17GB·57,413개 항목 정리에 긴 대기가 발생했다. 등록은 UTC 02:20~02:33, 삭제 실행은 약 02:39~03:00이었고, 대기 중 동일 생산자를 중복 실행하지 않았다. 완료된 정리 원장과 설정을 작업 근거로 복사한 뒤 임시 프로젝트 별칭, 외부 정리 설정·출처 파일·정리 원장과 이번에 만든 빈 부모 디렉터리를 제거했다. 실제 외부 프로필과 기존 Windows 자식 세션 6은 삭제 대상에 포함하지 않았다. 아래의 ‘삭제 결과 별도 확정’은 이 최종 결과로 충족한다.

정리 판단은 `deployment/cleanup-ownership.json`, `local-cleanup-result.json`, `retention-decisions.json`에 기록한다. 실패한 `u19b`의 생성 출력과 의존성 폴더, 이번 빌드·세션 조회 임시 폴더 6곳은 Native 정리 도구의 항목별 결과가 모두 `deleted`, `remaining:false`이고 실제 경로 조회도 모두 없음을 확인했다. `u19b` 소스와 Git 객체는 `u19c`가 참조하므로 보존한다. 현재 `u19c` 런타임·VSIX·수락 근거와 이전 복구 버전, 사용 중인 외부 프로필은 명시한 참조 해제 조건까지 보존한다. 외부의 새 상태 호스트 검사 복사본 `f/host6-u19c`는 별도 정리 대상으로, Windows 자식 세션 6과 다른 파일시스템 경로다. 임시 외부 정리 설정에서 관리 루트와 삭제 대상이 같아 첫 검토가 보류됐으며, 외부 프로젝트 루트의 하위 경로라는 실제 소유 범위에 맞춰 설정을 수정한 재검토는 보호 항목 없이 통과했다. 삭제 결과는 별도로 확정한다.

승인 UI 변경의 제품 빌드, 소스 검사 35개 파일, 엔진 보존 8개 검사와 새 상태 호스트 6단계가 모두 통과했다. 현재 체크아웃의 다른 UI 변경과 함께 검사한 13개 통합 검사도 통과했다(`primary-integration.log`, 종료 코드 0). `u19c` 패키지 SHA-256은 `1a30c7096d52a6636c83f8f74183e939e1f4d6e34405679e05f77306bc007ef1`이며 앱 버전은 `2026.0.10`을 유지했다. 엔진 보존 첫 시도는 사전 검사와 TypeScript 실행 경로가 달라 입력 불일치로 종료 코드 1을 반환했다. 같은 실행 경로를 재사용한 `manual-u19c-preserve-r2`의 8개 검사와 `manual-u19c-accept-r3`의 최종 재확인은 종료 코드 0이다. 소스와 제품 빌드 바이트는 바꾸지 않았다.

실제 재설치 대상은 `C:/Users/felre/av18/artifacts/f`이고 설치 기록은 `artifacts/build/u19c/artifacts/deployments/independent-20261018-110958-462/deployment.json`이다. 첫 설치 시도는 Python PATH 누락으로 설치 전 검증에서 중단됐다(`hostInstalled:false`); 빌드와 같은 도구 환경으로 재실행한 설치는 종료 코드 0이다. `deployment/installed-verification.json`은 설치 파일 20,916개를 확인했다. 20,915개는 VSIX와 바이트가 같으며 `package.json`은 VS Code가 추가한 `__metadata`의 설치 시각·플랫폼·크기 외에 JSON 내용이 동일하다. 이 메타데이터를 제외한 임의 변경은 허용하지 않았다. Window Control manifest SHA-256은 `057bc9f02ee7b7254243d4479b89e12de8ae92f8d11b9cb8e07dff4632605db6`이다.

외부 프로필 `f/agent-user-data`, 확장 경로 `f/extensions`, 작업 폴더 `f/workspace`를 지정해 다시 열었다(실행 종료 코드 0, 부모 세션 2의 새 Code 루트 PID 20400). 기존 기본 Code 루트 PID 20784는 유지했다. 설치 전후 읽기 전용 조회 모두 Windows 자식 세션 6의 실제 존재를 확인했다(`deployment/child-before.json`, `child-after.json`, 종료 코드 0). 세션 종료·새 세션 생성·기존 세션의 임의 인계·그림판 입력을 수행하지 않았다. 실제 사람의 승인 UI 응답과 Windows 알림음 확인, 기존 세션 6의 소유권 복구 및 그림판 실기 재검증은 이 설치 확인과 구분한다.

새 상태 호스트 검증의 원본 결과 3개는 `artifacts/build/u19c/artifacts/logs/manual-u19c-accept-r3/archived-host/`에 복사했고 `retained-check-result.json`이 보존한 결과 파일을 가리킨다. 과거 `f/check-result.json`은 이전 `u18c` 검증 기록이므로 현재 패키지의 증거로 사용하지 않는다. 현재 패키지·실행·정리 근거는 `20261018-approval50-r1/deployment/`와 위 `u19c` 로그에 연결한다.

### 승인 UI 구현 검증 및 외부 배포 실행 기록 — 2026-10-18

현재 승인 변경 실행은 `artifacts/tasks/DU-01-window-use-stages/runs/20261018-approval50-r1`에 기록한다. 호스트 검사는 `host/focused-r3.log`에서 91개 중 90개 통과·Linux 전용 1개 생략, 종료 코드 0이다. 초기 권한 준비/MCP 검사는 `root-tests-r3.log`에서 6개 통과, 종료 코드 0이다. 기존 React/CSS를 사용하는 내부 승인 카드의 밝은·어두운 테마와 900/360 폭 검증은 `ui/panel-final/result.json`, `ui/native-final/result.json`에 보존했다. Windows 알림의 강제 무음 XML을 제거하여 OS 기본 알림음을 요청한다. 실제 소리와 배너는 Windows 설정의 영향을 받으며 아직 사람이 확인하지 않았다.

배포 입력은 기존 검증 소스 `artifacts/build/u18a-r2`의 SHA-256 `6f430ae0663d50939a83cde68b8d913c1a894300b60086ac100c69e42037efe3`에 승인 변경 17개 경로를 적용한 `artifacts/build/u19b`이다. 최종 소스 SHA-256은 `b55c7854589b19f90405af09b2667d245fddd9fa495c9696317282d17e1e881e`이며 24,416개 파일, 473,033,364바이트다. 다른 작업의 feature inventory 변경은 제외했다. `u19a`는 대상 Git 메타데이터 준비 전 복사를 시도하여 종료 코드 1로 끝났고 소스 디렉터리를 만들지 않았다. 올바른 메타데이터를 준비한 `u19b` 복사는 UTC 01:25:23~01:31:22, 약 358초에 성공했다. 공유 Git 객체 참조 때문에 기반 소스는 계속 보존한다.

`u19b` 제품 빌드는 종료 코드 0으로 끝났지만, 확장된 소스 검사에서 기존 `test-use-settings-integration.cjs`, `test-window-control-host.cjs`의 이전 모달 승인 가정이 실패했다(소스 검사 종료 코드 1). 제품을 약화시키지 않고 두 fixture가 실제 내부 단계 카드를 등록·응답하도록 수정했다. 앱 승인 검증은 유지하고 외부 모달이 호출되면 실패시킨다. 수정 fixture와 호스트 오류·단계 검사 66개가 모두 통과했다(`host/integration-fixtures-r1.log`, 종료 코드 0). 실행 중이던 입력을 바꾸지 않았으며 새 입력 `artifacts/build/u19c`와 배포 이름 `u19c`로 재검증한다. `u19b`의 실패 결과는 성공으로 바꾸지 않는다.

수정 입력 `u19c`의 SHA-256은 `998937b978675e9e98846a8832f3af171683734b832df6ff32734184a46155f1`(24,416개 파일, 473,034,596바이트)이다. 복사는 UTC 01:37:55~01:43:50, 약 354초에 성공했다. 내부 승인 UI·정책·MCP는 지원 플랫폼의 공통 의미를 유지하고 Windows 자식 세션과 기본 알림음의 실제 실행은 Windows에 한정한다. 현재 실제 검증 환경은 Windows x64, Node 26.7이며 Linux 실행 검증은 수행하지 않았다. 원격 실행과 해상도 옵션의 지원 범위는 변경하지 않는다.

소스 선택기의 별도 검증 항목은 다음 증거로 닫는다: 네이티브 알림 소스는 Windows 제품 빌드, 신규 권한 준비 테스트는 feature inventory의 기존 Window Use behavior check와 소스 검사, 두 render 검증 스크립트는 실제 pinned React/CSS를 사용한 `ui/panel-final/result.json`·`ui/native-final/result.json`으로 연결한다. 테스트 fixture 수정은 제품 UI/호스트 입력을 바꾸지 않으므로 해당 화면 검증 결과를 재사용한다.

빌드·패키지·새 상태 호스트 검증 producer는 `deployment/build-package-accept.cjs`, 단계별 실제 종료 코드는 `artifacts/build/u19b/artifacts/logs/manual-u19b/manual-metrics.json`에 기록한다. Windows 소켓 경로 제한을 피하기 위해 새 검증 상태는 `C:/Users/felre/av18/artifacts/f/host6-u19b/state`를 사용한다. 이 검증이 끝난 뒤에만 실제 `f/agent-user-data`, `f/extensions`, `f/s`를 지정해 재설치한다. 사용자 전역 설치와 자식 세션 6 종료는 범위에 포함하지 않는다.

## 내부 승인 UI와 작업 초기 권한 수집 계획

상태: `implementing` — 사용자 요청으로 **Azrael 내부 승인·Windows 알림·50초 응답 대기·작업 초기 권한 수집**의 코드 변경과 외부 프로필 재설치를 실행한다. 대상 설치는 `C:/Users/felre/av18/artifacts/f`이며 사용자 전역 설치와 자식 세션 6 로그오프는 제외한다. 권한 UI 변경과 기존 세션 소유권 복구는 별개다.

구현은 root가 정책/MCP/가이드와 통합을, `approval_host`가 host 승인·수명·관련 테스트를, `approval_ui`가 기존 내부 렌더 경로·실제 화면 검증을 소유한다. `approval_deploy_prep`는 기존 immutable build와 격리 설치 절차를 조회한다. UI/host 출력을 고정한 뒤 선택 소스 스냅샷으로 빌드·최종 패키지 확인·새 상태 host 6단계·격리 설치를 진행한다. 실행 근거 소유자는 `artifacts/tasks/DU-01-window-use-stages/runs/20261018-approval50-r1/producer.json`이다.

### 현재 구현과 과거 UI 재사용 근거

- `scripts/window-control-host.cjs`의 `consent`는 앱 승인을 `mcpServer/elicitation/request`로 발행한다. 일반 대화는 기존 native elicitation 승인 카드, 전용 selectedWindow 대화는 Azrael 패널에서 처리한다. `registerApprovalUI`·`respondApproval`이 실제 사용자 응답과 요청 소유자를 검증한다. 과거 커밋 `20499adb`에도 이 내부 승인 요청이 있으며, Windows 알림은 내부 카드 전달 후 추가되는 구조였다. 과거 UI를 새로 복제하기보다 현재 남아 있는 경로를 재사용한다.
- 같은 파일의 `requestStage`는 현재 `vscode.window.showWarningMessage(..., {modal:true}, '허용')`를 호출한다. 이 VS Code 경고 창을 Azrael 내부의 단계 승인 카드로 옮기는 것이 변경 대상이다. 테스트 fixture에서 대체 표시한 앱 승인 경고 창도 제품의 내부 카드와 구분하여 검증한다.
- 앱 승인은 기본 25초에 만료된다. 3단계 요청에는 MCP/host의 360초 전송 제한이 별도로 있다. `native/window-control/src/approval_notification.rs`는 알림 수명을 최대 300,000ms로 검증한다. 사용자 대기 시간을 늘릴 때 UI 타이머만 바꾸면 다른 계층에서 먼저 종료될 수 있으므로 승인 수명·도구 전송·알림 수명을 함께 설계한다.
- 소유 설계는 [Window Use](../../docs/architecture/window-use.md)의 단계 권한·승인 UI·Windows 알림과 [UI presentation](../../docs/architecture/ui-presentation.md)이다. 기존 native 카드·버튼·주제 색상·간격·키보드 동작을 유지한다. 현재 구현 상태를 이 계획만으로 완료 처리하지 않는다.

### 권장 사용자 흐름과 승인 범위

1. **초기 조사:** 모델이 작업 시작 시 필요한 단계, 실행 위치, 알려진 앱, 예상 제어, 사용자 작업 영향과 필요한 Windows 준비를 수집한다. 읽기 전용으로 설정·기존 유효 승인·앱 식별·세션 준비/소유 상태를 확인한다. 허용해도 진행할 수 없는 조건은 먼저 설명한다. `existing_child_not_owned`는 추가 앱 승인이나 UAC 허용으로 해결됐다고 취급하지 않는다.
2. **내부 승인 카드:** 현재 Azrael 대화에 작업용 권한 목록을 제시한다. 각 항목에 단계·앱의 실제 식별 정보·현재/자식 세션·목적·영향·허용 기간을 표시하고, 사용자에게 허용/거절/취소를 제공한다. 범위가 같은 단계·앱은 한 번에 검토하되 항목별 선택을 유지한다. 요청하지 않은 단계나 모든 앱을 기본 선택하지 않는다. 일반 대화와 selectedWindow 패널 모두 같은 승인 계약을 사용하며, 전용 대화의 도구 제한은 유지한다.
3. **Windows 알림 병행:** 새 단계·앱·초기 묶음 승인마다 내부 카드 전달을 확인한 뒤 Windows 알림을 한 번 보낸다. 제목에 Window Use와 승인 필요를 표시하고, 대상 작업·요청 앱 또는 앱 수를 짧게 안내한다. 클릭하면 요청을 만든 Azrael 창의 해당 카드로 이동한다. 허용 버튼은 내부 UI에만 둔다. Windows 알림 실패·닫기는 승인·거절로 처리하지 않는다. 기본 알림음을 요청하되 Windows의 소리·집중 모드·알림 설정을 존중하며 실제 배너/소리 표시를 보장한다고 안내하지 않는다.
4. **승인 후 실행:** 사용자가 선택한 항목만 기록하고, 다음 작업을 시작하기 직전에 권한·실제 앱/창·세션 소유·정책 세대·사용자 중지를 다시 확인한다. 묶음 승인이 창 선택이나 관찰을 대신하지 않으며, 사전 조사 단계에서는 앱 실행·세션 생성·관리자 변경을 수행하지 않는다. 재검증 후 남아 있는 요청만 추가로 묻는다.

초기 묶음 승인에는 **현재 작업의 명시된 범위**를 권장한다. 기존 앱의 '항상 허용'은 사용자가 별도로 선택한 경우에만 재사용하고, 초기 묶음 승인 때문에 상시 허용이나 allow-all 설정을 자동으로 만들지 않는다. 단계 권한과 앱 권한은 카드에서 함께 검토할 수 있지만 저장·집행에서는 각각 유지한다. 2단계의 정확한 창 바인딩과 4단계의 활성 turn 권한은 해당 실행 시점에도 검증한다. 자식 세션의 소유권을 얻지 못한 경우 승인 결과만으로 임의 인계하지 않는다.

| 구분 | 초기 수집 가능 범위 | 중간 요청이 필요한 경우 |
| --- | --- | --- |
| 단계·위치 | 작업에 필요한 단계와 현재/자식 세션을 명시하여 검토 | 단계 상승, 위치 변경, 작업 범위 확대, 정책 변경·취소 |
| 앱 | 실제 실행 파일 등 기존 규칙으로 식별 가능한 알려진 앱들의 명시적 목록 | 새 앱, 대상 식별 변경, 기존 승인 철회, 조사 중 식별 불가였던 앱 |
| 정확한 창·입력 | 승인할 의도를 초기에 수집하고 실행 시 최신 창/관찰로 검증 | 다른 창으로 대상 변경, 점유 충돌, 사용자 중지, 불명확한 입력 결과 |
| Windows 관리자 작업 | 필요한 준비·영향을 초기 안내하고 알려진 준비 작업을 묶을 수 있는지 확인 | 실제 Windows UAC·자격 증명 입력은 사용자가 직접 수행. Azrael 승인으로 대체하지 않음 |
| 동작별 확인 | 정책상 사전 승인이 유효한 동작만 구체적 대상·효과로 수집 | 삭제·전송 등 실행 직전 확인이 필요한 동작, 새 외부 전송 범위, 별도 로그오프 승인 |

### 느린 응답에 대한 권장 설계와 결정할 사항

확정된 50초 응답 제한은 기존 활성 thread/turn에 묶인 승인 경로에서 보장한다. `prepare_permissions`는 작업 시작 시 단계와 알려진 앱 최대 8개를 기존 내부 카드로 순서대로 검토하고 결과를 반환한다. 카드마다 50초를 보장하며 기존 유효 권한은 건너뛴다. 사용자는 각 카드에서 독립적으로 허용·거절할 수 있다. 하나의 새 체크박스 카드나 새로운 상시 권한 체계를 만들지 않고 기존 승인 UI를 재사용한다. 응답이 늦다는 이유로 중복 요청·반복 알림·자동 허용·임의 재개를 하지 않는다.

장기 대기를 도구와 분리하여 `pending`으로 보존하고 재개하는 방식은 별도 검토 제안으로 남긴다. 50초를 넘긴 응답이나 끝난 turn의 callback을 다시 허용하는 기능은 이번 구현에 포함하지 않는다. 이 제안은 기존 연결/turn 소유 규칙과 재개 계약을 별도로 설계해야 하므로 승인 UI 교체를 위해 임의로 도입하지 않는다.

승인 응답 대기 제한은 사용자 지정으로 **50초**로 확정한다. 나머지 항목은 구현 전 검토할 제안이다.

| 항목 | 권장 제안 | 영향·비교 |
| --- | --- | --- |
| 승인 대기 기간 | **50초**. 사용자 취소·정책 철회·작업 폐기 시 즉시 종료 | 사용자 지정으로 확정했다. 현재 앱 승인 기본 25초를 50초로 늘리고 내부 카드·알림의 남은 시간과 일치시킨다. 만료 뒤 늦은 응답은 허용으로 처리하지 않는다. |
| 모델 실행과 분리 | 이번 구현은 활성 turn의 50초 승인 대기. 장기 pending/비동기 재개는 후속 검토 제안 | 현재 turn에만 묶인 승인 응답을 그대로 장기 허용으로 바꾸지 않는다. 만료 시 명시적 재시도를 기다린다. |
| 전송 타임아웃 | 승인 준비/상태 조회를 짧은 비동기 요청으로 만드는 방안을 검토한다. 동기 승인 경로는 50초의 응답 시간을 보장하도록 관련 MCP/host 제한과 전달 여유를 맞춘다 | 기본 전송 제한 30초가 승인 대기를 먼저 끝내지 않게 한다. 3단계 세션 준비의 360초 제한과 일반 동작 타임아웃은 승인 제한과 구분한다. |
| 알림 수명·재알림 | 알림 수명과 승인 수명을 분리하고, 기존 native 최대 5분 제한을 고려. 최초 알림 1회, 추가 알림은 사용자 요청 또는 명시적 정책으로만 | 배너가 사라져도 내부 pending은 남을 수 있다. 서로 다른 남은 시간을 잘못 표시하지 않는다. |
| 초기 권한 목록 | 모델이 필요한 단계·식별된 앱 목록을 제출하는 prepare 경로 제안 | 단일 `request_stage` 확장과 별도 prepare 도구 중 기존 API 구조에 맞춰 결정한다. 1024×768/선택 해상도 계획과 같은 작업·실행 위치를 설명하되 준비만으로 세션을 만들지 않는다. |

장기 pending의 일관된 소유자는 thread·요청 ID·권한 범위/세대이며, 활성 실행의 turn ID와 native 연결은 권한 확정 시 다시 바인딩한다. 원래 turn이 끝난 뒤 기존 callback으로 승인하는 경로는 계속 거절한다. 재연결/재로드 시 host가 검증한 pending만 복원하고, 소유 창이나 요청이 사라진 알림은 폐기한다. 만료·취소된 요청의 늦은 응답은 승인으로 전환하지 않는다. 응답 기록과 실행 권한의 수명을 구분하고, 정책 변경·중지·앱 철회는 실행 전에 항상 우선한다.

### 구현 순서·보존·검증

- **계약·기록:** 위 선택을 확정한 뒤 owning architecture와 feature inventory에 내부 단계 승인·초기 권한 수집·대기/재개 의미를 연결한다. 기존 앱 승인 기록은 유지하고 단계 범위나 상시 권한으로 재해석하지 않는다. 대상은 공통 Azrael 내부 UI/호스트, Windows 전용 알림·자식 세션·UAC다. Linux/macOS의 단계/알림 지원을 새로 약속하지 않는다.
- **승인 경로:** `scripts/window-control-host.cjs`, `scripts/window-use-approvals.cjs`, `scripts/inject-window-control.cjs` 및 native 승인 분류/렌더 경로를 재사용한다. 단계·앱·초기 묶음을 구별하는 유형과 명시적 허용 범위를 추가하고, 실제 내부 카드의 사용자 응답만 승인으로 받는다. UI가 연결되지 않았으면 `connection_error`로 남기며 VS Code 모달을 대체 승인 경로로 자동 사용하지 않는다.
- **준비·실행 분리:** `scripts/window-control-mcp.cjs`와 host 계약에 필요한 사전 조사/준비·pending 조회를 연결한다. 기존 grants를 재사용하고 대상·정책 변경 시 무효화한다. 등록된 앱 경로의 승인과 실제 생성할 앱의 동일성을 기존 검증으로 확인한다. 앱이 미확인인 경우 범위 없는 미리 승인을 만들지 않는다.
- **알림·대기:** host의 알림 발행·해제·클릭 이동과 `native/window-control/src/approval_notification.rs`를 확장한다. 승인·거절·취소·만료·연결 종료의 UI/알림 상태를 일치시키고, 재로드·중복 응답·두 외부 프로필·늦은 발행·다른 대화 클릭을 검증한다. 장기 pending의 보존과 연결 종료 시 취소할 활성 실행 요청을 명시적으로 구분한다.
- **기능 검증:** 알려진 단계·앱 여러 개를 한 번에 승인한 뒤 작업 중 같은 범위의 재요청이 없는지, 새 앱·권한 확대에서만 추가 요청하는지 확인한다. 부분 허용/거절, 상시 허용 미선택, all-app 미변경, 실제 사용자만 승인, 중지/철회 우선, 4단계 turn 범위 보존, UAC 분리를 검증한다. 사전 조사로 부작용이 생기지 않는지도 확인한다.
- **실제 화면·느린 응답:** 기존 `test-window-control-approval`, `test-window-approval-ui-integration`, `test-window-approval-notifications`와 두 approval-render 검증을 확장한다. light/dark·좁은 화면·키보드/포커스, 25초 초과~50초 이내 응답 수용·50초 만료 후 응답 거절·재로드/재연결·명시적 계속을 검증한다. Windows에서 배너·기본 알림음·정확한 카드 이동·종료 후 알림 제거를 실측하고, OS 설정으로 억제된 경우와 제품 실패를 구분한다. 실제 격리 프로필에서 단계와 그림판 앱 승인에 제품 내부 카드를 사용해 클릭·드래그를 검증하며 fixture 모달 통과로 대체하지 않는다.
- **회귀·배포:** 공통 승인 동작에는 Windows 회귀와 일반/selectedWindow 경로를 포함한다. 실제 검증 플랫폼과 지원 의도를 분리한다. 구현·배포가 별도로 요청되면 기존 immutable build·격리 설치·런타임 식별·보존 절차를 따른다. 사용자 프로필 전체 설치나 세션 6 로그오프는 이 계획으로 승인되지 않는다.

## 연결창 최소화 동작 검증

2026-10-18 후속: 사용자가 외부 프로필 하나를 닫았다. 조회 결과 `minimize-user-data` 프로필과 그 helper/worker는 사라졌지만, 읽기 전용 Windows 조회에서 자식 세션 6은 생존했다. 최소화·그림판 클릭/드래그는 아직 검증하지 않았다. 미완료 command 014는 결과가 없으며 재실행하지 않는다. 사용자의 외부 Agent 위임 요청에 따라 남은 테스트 소유 `standalone-user-data` VS Code 루트 PID 47240의 경로·프로세스 종류를 확인하고 정상 창 닫기를 요청했다. 새 `agent-user-data` 프로필은 동일한 f 격리 설치본을 사용한다.

실제 native provider의 기존 RPC를 사용하는 별도 테스트 러너 `f/agent-runner`로 Agent 요청을 전달했다. 합성 turn/권한 메타데이터를 사용하지 않는다. UTC 2026-10-18 00:00:11의 `f/agent-io/request-delivered.json`은 실제 thread `01a14c4f-05d5-7f70-a041-2c7590a03fcf`, turn `01a14c4f-0a0c-7532-866f-770409952792`, `inProgress`를 확인했다. 요청에는 관리형 Window Use로 그림판 제어 검증, 사용자 직접 단계·앱 승인, 세션 6 종료/임의 인계/우회 금지, 테스트 후 세션·앱 유지, 제품 수정 금지를 명시했다. 전달 성공은 그림판 제어 성공의 근거가 아니다. 관련 producer는 같은 실행의 `agent-request-producer.json`이며 프로필·로그는 후속 검증 동안 보존한다.

외부 Agent의 실제 첫 turn은 41.211초 후 완료됐다(`f/agent-io/completed.json`). 관리형 context/status/list_windows를 호출했으며 3단계 `available:false`, `child-session-admission` 미충족, 선택 대상 없음, 그림판 미발견을 보고했다. 격리 환경 스킬 목록에서 Window Use를 발견하지 못해 승인 요청과 입력 전에 멈췄다. 확인된 스킬 경로를 후속 전달하기 위해 같은 테스트 프로필을 정상 닫고 재시작했으나, 실제 native `thread/resume`/`turn/start` 시퀀스가 `Engine disconnected`로 끝났다(`followup-error.json`, UTC 00:01:50). 후속 turn 실행 성공은 확인되지 않았으며 자동 재전송하지 않았다. 세션 6 로그오프·임의 인계·그림판 입력은 수행하지 않았다. 다음 작업은 외부 Agent의 정상 재연결과 기존 자식 세션 admission 장애 확인이며, 현재 결과는 그림판 제어 검증 통과가 아니다.

사용자의 재시도 요청에 따라 테스트 러너에서 실제 native 성공 응답 후 요청을 보내도록 보완했다. retry-001/002는 `thread/read`에서 프로토콜 오류(-32600)로 실패해 Agent turn을 시작하지 않았다. retry-003은 정상 닫기 전에 command 파일을 생성해 이전 러너가 먼저 소비했으므로 역시 read 단계에서 끝났다. 이전 runner 종료와 새 `retry-runner-ready`를 확인한 뒤 생성한 retry-004는 UTC 00:14:53에 실제 thread `01a14c5c-7f32-7da3-a6b3-82c56f5a79ce`, turn `01a14c5c-81f0-7ad3-a353-15343d202e40`의 `inProgress`를 받았다. 실제 스킬 절대 경로와 세션 6 보존, 승인·소유권 우회 금지를 포함했다. 근거는 `f/agent-io/retry-004-*`이며 각 retry의 producer와 실패 단계도 보존한다. 기존 대화 조회 실패 원인은 확정하지 않았으며 프로토콜 변경이 원인이었다고 결론 내리지 않는다. 제품 코드·설정·설치본은 변경하지 않았다.

retry-004 Agent의 완료 결과(`f/agent-io/retry-004-completed.json`, UTC 00:18:23)는 관리형 3단계 요청이 `existing_child_not_owned`, `authorized:false`로 차단됐음을 확인했다. 자식 세션 6은 살아 있지만 현재 host는 소유권을 확인하지 못하며 기존 세션의 임의 인계를 거절했다. 그림판 승인·클릭·드래그 검증은 진행하지 않았다. 필요한 후속 작업은 기존 관리형 소유 연결의 복구 또는 검증된 소유권 복구 경로 검토이며, 현재 도구에 제공되지 않은 복구를 실행한 것으로 취급하지 않는다. 세션·프로필과 진단 근거는 보존하고, 테스트와 세션 보존 요구가 해제될 때 전체 프로필 정리를 다시 검토한다. 내부 승인 UI 계획은 이 admission 차단을 해결했다고 주장하지 않는다.

사용자가 최소화 상태의 실제 동작 검증을 요청했고, 다른 테스트에 사용할 자식 세션을 닫지 말라고 명시했습니다. 기존 child5는 이전 승인으로 이미 로그오프됐으므로 새 세션 생성 요청을 진행합니다. 세션 정리·로그오프·연결 종료·검증 프로필 종료를 이번 종료 절차에 포함하지 않습니다. 살아 있는 세션/프로필/입력 소유·임대 상태와 후속 사용 경로를 기록해 보존합니다.

제품은 검증된 u18c 설치본 그대로 사용합니다. `av18/artifacts/f` 아래 별도 `minimize-user-data`, `minimize-runner`, `minimize-app`, `minimize-io`와 `20261018-minimized-r1` 실행 기록을 준비했습니다. 테스트 앱에 클릭 횟수와 텍스트 readback을 추가했고 10분 자동 종료를 제거했습니다. runner는 완료/시도한 명령을 재실행하지 않으며 이 실행에서는 정리 도구 호출을 허용하지 않습니다. 이는 테스트 fixture 변경이며 제품의 최소화·렌더링 동작은 바꾸지 않습니다.

같은 설치본의 실제 singleton/MCP protocol/인증 pipe/native child를 사용하되 모델 turn 발급·권한 metadata는 기존 통합 fixture라는 한계를 유지합니다. 사람이 단계·앱 승인을 직접 선택합니다. 자식에서 새 앱을 실행해 표시 상태의 화면/기록을 확인한 뒤, 연결창의 최소화 상태를 정확한 새 helper PID·생성 시각·창 핸들의 읽기 전용 조회로 입증합니다. 최소화 전후의 캡처와 실제 버튼 클릭/문자 입력을 앱 자체 기록으로 대조하고 부모 테스트 앱 기록에 입력이 없는지도 확인합니다. 창이 남아 있는 사실만으로 통과시키거나 화면을 복원한 뒤의 결과를 최소화 결과로 취급하지 않습니다.

성공 기준은 최소화 확인 이후의 새 화면 캡처, 버튼 클릭 이벤트 증가, 정확한 텍스트 readback, 부모 테스트 앱 무변경, 마지막에도 최소화/자식 세션 생존/연결 유지 확인입니다. 실패나 불확실한 입력은 자동 재실행하지 않고 원인을 기록합니다. 실제 시험 결과는 같은 실행의 근거와 함께 이 절에 반영합니다.

## 격리 세션 생성 시 해상도 지정 계획

상태: `draft` — 기본값 1024×768과 선택적 모델 입력은 사용자 요구로 확정됐다. 아래 API 모양·한도·재사용 처리는 구현 제안이다. 창 숨김은 문의에 대한 조사 항목으로, 해상도 기능의 실행 범위에 자동 포함하지 않는다.

### 요구사항·권한·검토할 선택

기본 화면 크기는 **1024×768 픽셀**이다. 모델이 격리 세션을 처음 열 때 선택적으로 가로·세로를 지정할 수 있게 한다. 이번 요청의 산출물은 구현 계획과 연결창 설명이다. 제품 코드 수정·빌드·재배포·Windows 설정 변경·새 세션 생성은 실행하지 않는다. 기존 설정, 사람의 단계/앱 승인, 권한·소유권·입력·정리 보호는 유지한다.

대상은 Windows x64 로컬 대화형 환경의 동일 사용자 자식 세션이다. 공통 MCP 요청·검증 변경의 영향과 실제 Windows 검증을 구분한다. Linux/macOS의 기존 선택 창 기능을 격리 세션 지원으로 확대하지 않는다. [멀티플랫폼 계약](../../docs/architecture/multi-platform.md)을 따른다.

| 선택 | 권장 제안 | 영향·대안 |
| --- | --- | --- |
| 모델 입력 | `request_stage`의 `stage: 3`에만 `resolution: { width, height }`를 선택적으로 추가 | 생성 요청에 함께 지정한다. 별도 화면 변경 도구보다 범위가 명확하다. |
| 허용 범위 | 각 값은 정수 200~8192, 곱은 최대 16,777,216픽셀 | 기존 캡처의 변·픽셀 예산을 초기 상한으로 재사용한다. 모든 조합의 적용 가능성을 보장하지 않으며 실제 네이티브 수용 여부도 확인한다. 더 좁은 제품 한도는 자원·검증 결과를 보고 결정한다. |
| 기존 세션 | 옵션 생략은 현재 해상도로 재사용하고 실제 값을 반환, 명시한 값이 다르면 충돌 응답 | 사용 중 재연결·동적 해상도 변경과 자동 세션 종료는 추가하지 않는다. 다른 작업·앱·관찰에 영향을 주지 않는다. |
| 적용 불일치 | 요청값과 자식에서 읽은 실제 값이 다르면 성공 처리하지 않고 두 값을 노출 | 조용한 기본값 대체를 피한다. 이미 생성된 세션은 식별자·실패·정리 상태를 보존한다. |

위 제안은 구현 검토 대상이며 기본값과 선택적 입력 자체는 다시 결정할 필요가 없다. 창 숨김 기본값과 설정 추가는 이번 요청으로 확정하지 않는다.

### 현재 경로와 API 제안

`native/windows-child-session/ChildSession.cs`의 `Host.Start`는 연결 전 `DesktopWidth=1024`, `DesktopHeight=768`을 고정한다. 기존 Windows RDP 속성을 재사용하며 새 라이브러리나 privileged broker를 추가하지 않는다. 이 속성은 연결 전에 설정하고 OS별 한도를 확인해야 한다. [DesktopWidth](https://learn.microsoft.com/en-us/windows/win32/termserv/imstscax-desktopwidth), [DesktopHeight](https://learn.microsoft.com/en-us/windows/win32/termserv/imstscax-desktopheight).

```json
{
  "stage": 3,
  "targetId": "<observed-parent-app-target>",
  "reason": "승인된 앱을 격리 세션에서 실행",
  "resolution": { "width": 1920, "height": 1080 }
}
```

`resolution`을 생략한 **신규 생성**은 1024×768을 적용한다. 한쪽만 지정, 문자열·소수·0·음수·과도한 크기·알 수 없는 하위 필드, `stage: 2/4`에서의 지정은 플랫폼 동작 전에 거절한다. 검증은 MCP뿐 아니라 host/manager/native 직접 호출 경계에도 적용하고, 불량 요청 때문에 UAC나 세션 생성이 일어나지 않게 한다. DPI 배율 변경은 포함하지 않는다.

### 구현 순서와 소유자

1. **공통 계약:** `scripts/window-control-mcp.cjs`의 스키마·안내·응답 투영과 `scripts/window-control-host.cjs`의 검증·승인 설명·전달을 확장한다. 승인 화면에 요청 또는 재사용할 실제 해상도를 설명한다. 기존 단계 승인의 조기 반환에서도 해상도 충돌 검사를 생략하지 않는다.
2. **생성·재사용:** `scripts/window-use-isolation.cjs`의 `start` → `scripts/window-child-session.cjs`의 `start` → native 시작 요청으로 검증된 값을 전달한다. 현재 엄격한 필드 허용 목록을 필요한 만큼만 확장한다. 같은 소유자/잔여 세션 재사용 조기 반환과 동시 시작 직렬화에도 생략·동일값·다른값 규칙을 적용한다. 충돌 시 기존 세션·앱·임대·관찰을 변경하지 않는다.
3. **네이티브 적용:** `native/windows-child-session/ChildSession.cs`가 연결 전 해상도를 적용하고, 연결 후 검증된 자식 worker가 실제 화면 픽셀 크기를 읽어 반환한다. 부모 모니터 크기·연결창 외곽 크기·앱 캡처 크기를 세션 해상도로 오인하지 않는다. 실제값 비교에 실패하면 기존 실패·정리 보호로 처리하고 자동 재시도하지 않는다.
4. **상태·가이드:** `request_stage`, `context`/`resource_status`의 자식 세션 상태에 요청값·실제값·재사용 여부를 제한된 구조로 노출한다. `instructions/window-use/stage-3.md`에 기본값·생략·충돌·좌표 의미를 설명한다. 앱 입력은 계속 해당 앱의 최신 캡처 좌표를 사용하며, 세션 해상도를 이유로 이전 관찰을 재사용하지 않는다. 오류 상세 보존과 취소 후 늦은 응답 무효화를 유지한다.
5. **설계·검사 연결:** 구현 전에 합의된 계약을 [Window Use 설계](../../docs/architecture/window-use.md)와 `scripts/azrael-feature-contracts.json`의 `ui.window-control` 소유 범위·필수 검사에 반영한다. 이 계획 작성만으로 현재 설계의 구현 상태를 변경하지 않는다.
6. **검증·격리 배포:** 아래 성공 기준 이후 [빌드 playbook](../../docs/playbooks/build.md)의 동결 입력·provenance·필수 보존 검사·동일 VSIX host6를 적용한다. 후속 설치도 사용자 기본 프로필과 분리한다. 생성 전 lifecycle 기록, 실제 결과·참조에 따른 정리/보존과 작업별 커밋을 완료한다.

root가 요청 계약·통합·최종 수용을 소유한다. 계약 확정 → 공통/네이티브 전달 → 실제 크기 확인 → 앱 동작 → 격리 설치 검증이 의존 순서다. 이번 계획 작성에서 구현 담당자를 새로 배정하거나 실행을 시작하지 않는다.

### 성공 기준과 검증

- **경계:** 무옵션 기본값, 유효값 전달, 불량값과 비대상 단계 거절을 native 및 MCP/host/isolation/manager 통합 검사로 확인한다. 거절 시 플랫폼 변경이 없어야 한다.
- **재사용:** 옵션 생략/동일값 재사용, 다른값 거절, 반복 단계 승인 조기 반환과 다른 작업 임대·동시 요청에서 기존 화면·앱·관찰이 유지됨을 검증한다.
- **실제 크기:** Windows x64에서 신규 1024×768 기본값과 1920×1080 명시값을 각각 생성하고 자식 worker의 실제 값과 대조한다. 연결창 표시·크기 변경만으로 통과시키지 않는다. 2560×1440은 추가 검증 후보이며 미검증 상태를 명시한다.
- **앱 동작·보존:** 각 실제 해상도에서 승인된 일회용 앱 실행, 최신 캡처, 실제 마우스 클릭과 텍스트 입력을 앱 자체 readback으로 확인한다. 부모 테스트 창에 입력이 가지 않는지도 확인한다. 기존 연결·렌더·키보드·마우스 admission, 설정/승인 취소, 실패 상세, 자원 소유·정리 보호를 보존한다.
- **실패·범위:** 요청/실제값 불일치·취소·접속 실패·정리 불확실성을 성공으로 반환하거나 부모 세션으로 우회하지 않는다. 생성된 세션의 식별자를 보존한다. 공통 검사와 실제 Windows 결과, 제품 빌드와 기능/host6 결과를 구분하고 다른 OS·일반 앱 호환성으로 확대 해석하지 않는다.

### 사진의 연결창과 숨김 실행 문의

사진의 제목은 현재 `Host`의 `Azrael isolated session (model control)`과 일치한다. `Application.Run(host)`로 실행되는 **제품의 RDP ActiveX 연결 유지 창**이며 테스트 전용 뷰어가 아니다. `Enabled=false`로 직접 입력을 차단한다. `Shown` 이벤트에서 요청 처리 루프를 시작하며 UI/COM 메시지 루프를 유지한다. 연결 시작 후 X를 누르면 현재 코드는 종료 대신 최소화한다. 흰 화면이나 창의 존재만으로 현재 세션 연결·렌더링 성공/실패를 판단할 수 없다.

창을 계속 표시하지 않고 동작하는 숨김 모드의 개발은 검토 가능하다. 현재 설정·도구에는 해당 옵션이 없고, 숨긴 상태에서의 연결·렌더·입력·정리는 검증하지 않았다. 단순히 창 표시를 제거하면 `Shown` 의존 초기화가 실행되지 않을 수 있으며, viewer 프로세스 종료는 숨김과 동등하지 않다. 숨김·연결 해제·로그오프를 분리해야 한다.

별도 구현을 추진한다면 `Shown` 의존 초기화와 화면 표시를 분리하고 살아 있는 ActiveX 핸들·메시지 루프를 유지하는 구조를 먼저 검토한다. 표시/숨김별 기본·지정 해상도의 연결·캡처·클릭·입력 readback, 부모 포커스·작업 표시줄 영향, 취소·종료 보호를 비교한다. Windows 인증/UAC 대화상자를 숨기거나 자동화하지 않는다. 사용자 요구가 확정되기 전에는 표시 기본값이나 숨김 설정을 변경하지 않는다.

## 오류 상세 누락 수정과 격리 프로필 진단

현재 해결 실행: 네이티브 Guard의 인수를 먼저 bool로 변환했고, 동결된 candidate SHA256 `40c656968db6f4c289aa2f54f822c44ea68a4093ba9f0ad304cd224c04da8a55`의 컴파일·자체 검사(bootstrap14/setup17/admission3)는 exit0입니다. 새 별도 프로필 `artifacts/verification/wf18`에서 부모 일반 권한 session2와 child4의 연결·소유 검증 및 실제 render/keyboard/mouse fixture가 `admissionReady=true`로 통과했습니다. 기존 Guard 오류가 해결되었음을 확인했습니다. 테스트 프로필은 exit0으로 종료했습니다.

같은 실행의 정상 stop은 `ok=false`로 거부되어 child4가 남았습니다. stop의 상세 reasons를 재현용 축약 formatter가 보존하지 않은 한계가 있으므로 특정 PID 하나를 거부 원인으로 단정하지 않습니다. 코드의 UnownedWindows/UnownedProcesses 검사는 소유하지 않은 앱·동일 사용자 프로세스에서 정리를 보류하며, 읽기 전용 사후 목록에서 Windows 자동 시작 앱 및 NVIDIA/Realtek 프로세스를 확인했습니다. fixture가 연결 transport를 종료했으므로 새 helper로 이 세션을 채택하거나 시작을 재시도하지 않았습니다. 보호 검사는 완화하지 않았습니다.

사용자는 테스트 child4 로그오프를 별도로 승인했습니다. 일반 권한의 logon identity 조회가 Access denied로 중단되어 시스템 변경은 실행하지 않았고, 이후 UAC로 승인된 고정 대상 도우미에서 부모2/child4/기존 winlogon PID13404·생성 시각을 재검증한 뒤 WTSLogoffSession(4,true)을 수행했습니다. exit0, Win32 error0이며 후속 child 조회는 not-found1168, childAbsent=true, session4 프로세스0, 부모2 유지로 검증했습니다. 자동 정리가 성공했다고 기록하지 않습니다. `logs/approved-logoff-uac.json`과 `approved-cleanup-verification.json`이 근거입니다. 진단 자료와 후속 배포 준비는 새 `run:window-use-fix-20261018-r2` lifecycle로 관리합니다.

이전 단계에서 상세 오류 누락 수정, 별도 프로필 재현, 원인과 해결안 제시를 완료했고, 후속 문제 해결 요청은 확인된 네이티브 오류 수정과 검증·런타임 반영까지 포함합니다. 대상은 Windows x64 로컬 대화형 세션이며, 공통 host 오류 전달 수정의 회귀도 Windows에서 확인했습니다. Linux/macOS 실행 검증은 하지 않았습니다.

별도 `--user-data-dir`와 빈 `--extensions-dir`를 둔 VS Code 1.142.0 개발 확장 프로필 `artifacts/verification/wd18`에서 설치된 u17b manager와 helper를 그대로 호출했습니다. helper SHA256은 `03c8f8b644a90a457bb3befea5a0e8244c6f996360d5748ae8d20d5435f244bd`입니다. 사전 probe로 live child 부재를 확인한 뒤 한 번만 시작했고, `'ChildSession.Host'에 'Guard'에 대한 정의가 없습니다.` 및 HRESULT `-2146233088`을 수집했습니다. 별도 프로필은 정상 종료(exit0)했으나 이는 기대한 실패의 재현 성공이며 제품 연결 성공이 아닙니다. 전후 WTS enumeration은 모두 child 부재를 확인했습니다. 임시 RunOnce 값과 journal이 남지 않았고 테스트 프로필 프로세스도 종료했습니다. 기존 사용자 host 하위 helper PID32452는 그대로 보존했습니다.

원인은 `Host.Start`의 `Guard(client.AdvancedSettings7.RedirectClipboard==false,...)`입니다. dynamic 인수를 받은 한정되지 않은 Guard 호출이 중첩 클래스의 인스턴스에서 런타임 바인딩되어 `Host.Guard`를 찾습니다. 이 위치는 `client.Connect()` 전이므로 이 실패는 인증 실패가 아닙니다. 같은 중첩 인스턴스·dynamic 식 구조의 순수 C# fixture에서 RuntimeBinderException을 재현했습니다. 처음 fixture의 static 메서드는 인스턴스 구조와 달라 재현하지 못했으며, 실제 구조로 맞춘 r3에서 재현·대안 검증 모두 exit0입니다.

권장 해결안은 속성값을 먼저 `bool clipboardRedirected = client.AdvancedSettings7.RedirectClipboard;`로 읽고 `Guard(!clipboardRedirected,...)`를 호출하는 것입니다. 순수 fixture에서 false는 통과, true는 기존 격리 오류로 거부함을 확인했습니다. 이 검증은 언어 바인딩 해결안에 한정하며 실제 RDP 연결·worker·capture/input 성공을 보장하지 않습니다. 네이티브 소스를 고친 뒤 컴파일·해당 실행 경로 회귀, 새 격리 프로필의 실제 admission과 정리 검증, 최종 패키지 필수 검사 순으로 진행하는 것이 다음 해결 작업입니다.

누락 수정은 `window-use-isolation.cjs`의 failure→throw 경계와 `window-control-host.cjs`의 stage3 catch가 `diagnostic`으로 code/HRESULT/cleanup/phase/type/최대512자 안전 메시지를 보존하게 했습니다. 민감 경로·명령·자격 증명 형태는 메시지 전체를 가립니다. 사용자용 한국어 메시지, authorized=false, 현재 child 상태 및 재시도 금지는 유지했습니다. 기존 도구 응답/히스토리 경로를 재사용하며 별도 파일 로거·수집 서비스를 만들지 않았습니다. 실제 native payload를 넣은 host→isolation 회귀를 포함해35개 통과(exit0), 기존 host 수동 회귀도 exit0입니다. 소스 수정은 아직 설치본에 반영하지 않았습니다.

진단·검증 자료는 `artifacts/tasks/DU-01-window-use-stages/runs/20261018-diagnostic-r1`에 소속됩니다. `reproduction.json`, `guard-binding-result-r3.json`, `process-closure.json`, `logs/window-error-details-tests-r4.log`, `logs/window-control-host-manual.log`가 주요 근거입니다. 프로필과 로그를 같은 lifecycle group `run:window-use-diagnostic-20261018-r1`으로 등록하고 native review/apply에서 두 멤버 모두 defer 완료했습니다. 자료는 보존되어 있으며 네이티브 해결안의 실제 검증·비교가 끝나고 후속 소비가 종료된 뒤 재검토합니다. 이 원인 진단을 Windows Home이나 계정 암호 문제의 증거로 확대하지 않습니다.

사용자는 코드 수정, 관리자 권한 요청을 통한 자식 세션 준비, 런타임 반영을 승인했습니다. 기존 실험 기록은 [직접 진단 기록](../../artifacts/tasks/DU-01-window-use-stages/runs/20261017-direct-admin-r1/plan-body.md)에 보존합니다. 직접 관리자 연결은 성공했지만 제품 경로는 TEMP 및 자동 준비 부재로 실패했습니다.

대상은 Windows x64 로컬 대화형 사용자 세션입니다. 공통 단계 권한·취소·앱 승인 의미와 Linux/macOS의 기존 지원 범위는 유지합니다. 엔진은 설치된 검증 배포판의 동결 소스와 바이너리를 재사용하며 현재 다른 작업의 engine 변경을 포함하지 않습니다. 앱 버전은 유지합니다.

관리자 권한은 WTSEnableChildSessions 활성화와 TermService 시작에만 사용합니다. 현재 SID/부모 세션과 일치하는 UAC 요청만 허용하며 방화벽·정책·시작 유형·자격 증명은 변경하지 않습니다. 실제 연결·worker·앱은 일반 사용자 토큰을 유지합니다. 알려진 준비가 완료된 PC에서는 재요청하지 않습니다. UAC 취소·결과 불명·권한 취소 시 연결을 시작하지 않습니다.

기존 네이티브 도우미, System.ServiceProcess, Windows RunAs, 전제조건 probe 및 해시 검증을 재사용합니다. 별도 상시 관리자 서비스는 추가하지 않습니다. probe TEMP/TMP는 사용자 소유의 개별 임시 디렉터리로 제한합니다. stale WTS ID는 성공한 세션 목록 조회로 실제 부재가 확인될 때만 무시합니다.

루트는 JS manager/host/MCP, 테스트, 설계·feature inventory, 최종 패키지·설치·검증을 소유합니다. native_child_setup은 ChildSession.cs/probe.ps1 및 순수 테스트만 소유하며 live UAC는 실행하지 않습니다. runtime_deployment는 읽기 전용으로 기존 배포 경로와 필수 검증을 확인합니다. 네이티브 소스 준비가 끝나면 동결 패키지 생성의 입력으로 넘깁니다. JS 회귀와 설치 환경 준비는 독립 진행합니다.

성공 기준: 사용자 TEMP에서 실제 probe 성공; UAC 취소·권한 취소 시 미연결; 준비 후 일반 토큰 연결 및 SID/profile 검증; 실제 managed stage3 fixture의 연결·렌더·키보드·마우스 검증; 승인 앱의 캡처/입력 확인; 소유 세션 안전 정리. 소스 검사나 컴파일만으로 stage3 성공을 선언하지 않습니다. 런타임 설치는 동일 최종 VSIX의 여섯 host 검사, 원본 Codex·설정 보존, 설치 receipt 확인을 요구합니다. 동작 중 창 강제 종료나 실행 중 배포판 덮어쓰기는 하지 않습니다.

산출물은 artifacts/tasks/DU-01-window-use-stages/runs/20261017-product-fix-r1 및 새 배포 identity에 소속시킵니다. producer.json으로 계획 출력을 기록하고 종료 후 실제 membership을 등록합니다. 진단 중 자료와 현재·직전 설치본은 보존하며 그 밖의 임시 자료는 소유·참조 확인 후 정리합니다.

현재 검증: JS 관련 56개 중 55 통과, 1 조건부 skip, 실패0, exit0. 마지막 변경 후 js-tests-final.log로 동일 결과를 확인했습니다. skip된 실제 네이티브 headless reconciliation 검사는 attempt-03 exe와 존재하지 않는 전용 journal을 지정해 별도로1개 통과(exit0, headless-test.log). 네이티브 attempt-03 컴파일/self-test/probe C# 컴파일은 각각 exit0이며 순수 setup 검사17개를 통과했습니다. 종료 후 stale ID 검증도 성공한 세션 enumeration과 worker 종료를 요구하도록 보정했습니다. 실제 probe는 비관리자 토큰으로 오류0, feature=false, TermService=Stopped, stale ID3 실제 부재를 읽었습니다. live UAC, 배포·managed 검증은 아직 남아 있습니다.

배포 입력은 설치된 artifacts/n10a의 전체 동결 소스를 기존 capture-project-inputs.cjs로 새 artifacts/build/u17a에 복사한 뒤 이번 소유 파일만 덮어쓰고 새 해시를 고정합니다. 다른 작업의 엔진·모델 프로필 변경은 제외합니다. 엔진 source/binary pair는 n10a/engine 및 w10e/engine을 재사용하고 기존 파이프라인의 provenance와 host6단계 검사를 유지합니다. 복사 준비 시작은 2026-10-17T14:27Z이며 아직 제품 빌드를 시작한 것은 아닙니다. PATH에는 실제 MSIX PowerShell7.6.7, 설치 Python3.13, .cargo/bin을 명시합니다. 공용 native target은 현재 producer가 없을 때만 재사용합니다.

동결 입력은24415개 파일/472990156바이트, SHA256 4245e32da7ea995f4f1e54cdd9b5cc784c64e92d970e430e11aa46bab70d6e2c입니다. overlay11개 모두 primary와 일치함을 확인했습니다. 일반 자동 배포 첫 시도는 생성 이전 socket path preflight에서143바이트로 거부(exit1); 설치본과 제품 출력 변경은 없었습니다. 동일 동결 입력을 유지하고 새 release u17b로 문서의 수동 build/prepare/check/install 경로를 사용합니다. 검증 fixture만 Z:→primary artifacts/verification 매핑에 두고 StateRoot Z:/u17b/s(소켓52바이트)를 지정합니다. 실제 release/runtime/사용자 state는 C: 절대 경로를 유지합니다. fixture 정리 및 참조 종료 후 매핑을 제거합니다. 수동 실행은14:40Z 시작했으며 필수 source preflight·영향 검사·engine preservation·동일 VSIX6단계·pre-install input/receipt 검사와 원본 Codex/설정 보존을 유지합니다.

제품 빌드 u17b는 2026-10-17T14:42:15Z~14:49:03Z, exit0으로 완료했습니다. 첫 소스 검사는 격리 입력에 TypeScript/UI 및 이전 Computer Use 원본 fixture가 없어 실패했습니다. 원본 manifest SHA256과 대조한 이전 plugin 5개 파일, 현재 pristine runtime, legacy runtime, TypeScript5.9.3과 pinned UI6개 파일을 검증용 입력으로 준비했습니다. 사용자 plugin cache는 변경하지 않았습니다. 보완 입력의 source preflight는 exit0이며 같은 소스 선택을 재실행합니다. frozen source hash는 post-build에도 동일합니다. 최종 도우미 자체 검사는 exit0(bootstrap14/setup17/admission3)입니다. 검증·패키지·preservation은 각각 verify-u17b/package-u17b/preserve-u17b 로그로 분리합니다. 빌드를 다시 수행하지 않고 성공한 동일 산출물을 재사용합니다.

보완 후 source-tests는 357개 중 353 통과, 4 조건부 skip, 실패0이며 명령 및 후속 source-preflight 재검증까지 exit0으로 완료했습니다. 실행 로그는 `artifacts/build/u17a/artifacts/logs/verify-u17b/source-tests/2026-10-17T14-54-43-465Z-23344`입니다. 제품 설치와 실제 managed stage3 검증은 아직 완료로 기록하지 않습니다. 설치 후 기존 VS Code 호스트에는 Reload Window가 필요하며, 실제 UAC와 자식 연결의 성공 여부는 해당 활성화 이후 확인합니다.

대기 원인은 engine preservation의 필수 `auto_compaction` Rust 테스트 의존성 컴파일입니다(14:56Z 시작, 선택된 n10a 소스의 debug target). 제품 engine 바이너리 재빌드가 아니며, 실제 엔진 source/binary provenance 검증은 통과했습니다. 패키지 준비는 별도 작업으로 진행합니다. 두 producer가 종료하기 전에는 중복 실행·설치·해당 출력 정리를 하지 않습니다.

최종 패키지 준비는 exit0으로 완료했습니다. HostVersion은 기존과 같은 2026.0.10, VSIX SHA256은 `93cc17b2db47d2385ee29ad876c7805dca234c8b50b02f3b5abfee231f0d461b`입니다. 패키지는 `artifacts/build/u17a/artifacts/deployments/manual-u17b/package/azrael-host.vsix`입니다. 엔진 보존 검사 완료와 독립적인 최종 VSIX host6 검증을 즉시 시작합니다(`acceptance-u17b`). 설치는 두 결과의 실제 성공을 모두 확인한 이후에만 수행합니다. 같은 host6을 재실행하지 않고 검증한 동일 파일 해시를 설치 입력으로 연결합니다.

첫 host6은 standalone AccountService 연결 실패로 중단했습니다. 원인 로그 `artifacts/verification/u17b/s/app-server-daemon/engines/de16d39ce644666ceb4df183cca4b9de8bb8e953909e23aa2bd56beef4eb0546/azrael.stderr.log`는 `Error: path must be shorter than SUN_LEN`입니다. Z: 표시 경로는 짧아도 engine이 실제 경로로 정규화해 제한을 넘었습니다. 제품 변경 없이 동일 VSIX로 실제 짧은 전용 경로 `C:/Users/felre/av17/artifacts/f`에서 새 host6을 시작합니다(`acceptance-r2-u17b`, socket76bytes). 전용 root는 생성 전에 부재를 확인했고 owner.json 및 project-maintenance/lifecycle로 소유와 출력을 기록했습니다. 검증 종료 후 관리 도구로 정리하며, 실패 근거는 보존합니다.

MCP 전역 설정의 old w10e 경로는 이번 managed 경로의 장애 원인이 아닙니다. `window-control-host.cjs`의 thread/start·resume overlay가 현재 검증된 runtime의 MCP command/args/CODEX_HOME을 주입하고, 이미 통과한 host 회귀 검사가 stale 경로 교체와 원 요청 불변을 확인합니다. binary-only 설치에서 config.toml은 그대로 보존하며 새 host 활성화 이후 실제 주입 경로를 확인합니다. 외부 직접 MCP 호출의 전역 설정 변경은 이번 범위에 포함하지 않습니다.

짧은 실제 경로에서 동일 VSIX의 host6은 모두 exit0이며 standalone/coexistence 결과 모두 passed=true입니다. Engine preservation도 exit0으로 완료했습니다. 설치는 `artifacts/build/u17a/artifacts/deployments/independent-20261018-005028-647/deployment.json`의 installed-reload-required, hostInstalled=true로 확인했습니다. 설치 후 실제 runtime의 windowControl.directory는 u17b이며 helper SHA256은 검증된 최종 exe와 같습니다. 기존 Codex·settings·비대상 registry 항목 보존과 config.toml SHA256 불변을 확인했습니다. 독립 배포 근거 28개 및 설치 receipt/runtime/검증 결과는 `artifacts/versions/window-use-u17b`와 evidence-index.json에 보존합니다.

실제 UAC→일반 권한 자식 세션 연결·capture/input 및 정리는 Reload Window 이후의 필수 검증으로 남습니다. 이를 통과하기 전에는 단계3 정상 동작 완료로 판정하지 않으며 작업별 최종 커밋도 보류합니다. 현재 배포 source/package와 진단·fresh host baseline은 해당 검증 및 교체/복구에 사용되므로 관리 도구 등록·보존 판정을 진행합니다. 보존 재검토 조건은 새 runtime의 managed stage3 확인 및 기존 자료 소비 종료이며, 설치본을 포함한 snapshot은 후속 검증 배포가 교체하고 현재/직전 버전 보호가 해제된 뒤에만 삭제 후보가 됩니다.
관리 등록 후속 기록: `work:window-use-u17a`와 `version:window-use-u17b`의 native 등록을 완료했습니다. 현재 설치 버전이 snapshot을 참조하므로 실제 stage3 검증과 교체·복구에 필요한 자료를 보존합니다. 별도 host6 fixture `C:/Users/felre/av17/artifacts/f`는 native review/apply에서 명시적으로 defer했고, 재검토 조건은 새 런타임의 실제 managed stage3 검증 및 baseline 소비 종료입니다. 임시 Z: 매핑은 정상 제거하고 부재를 확인했습니다. 전체 작업은 Reload Window 이후 실제 UAC·자식 연결·capture/input·세션 정리 검증을 기다립니다.
2026-10-18 재설치 후 managed 재검증: 인증된 context의 manifest hash는 설치 u17b의 `a5be90debfdcc4696c1f7d3f7b7c5bd40a4affc514039134e3521740b7ea3df5`와 일치합니다. stage1 창 목록 조회는 성공했습니다. GrowKick Welcome Code 창을 선택한 뒤 stage3 request가 `authorized=false`, `missingPrerequisite=native_child_error`로 실패했습니다. 사후 probe는 부모 일반 권한 session2, child feature=true, TermService=Running, enumeration 성공 및 stale child3 실제 부재, errors=[]였습니다. UAC가 실제 표시·승인되었는지는 이 반환만으로 확정하지 않습니다. manager는 identity=null, cleanupUnconfirmed=true를 반환했으므로 시작을 재실행하거나 다른 입력 경로로 우회하지 않았습니다. 이 시점 동일 u17b helper PID32452가 부모 host31196 하위에 남아 있으며 강제 종료하지 않았습니다. bootstrap journal 파일은 없었습니다. `window-use-isolation.cjs`가 native 오류 message를 throw하지만 `window-control-host.cjs` stage3 catch가 상세를 버려 code만 노출하는 진단 공백을 확인했습니다. 상세 원인은 아직 확정하지 않았습니다. Code 로그 두 최신 디렉터리에서도 해당 오류 기록은 찾지 못했습니다. 후속 parent capture는 window_minimized/actionExecuted=false여서 stage1에서 복원하지 않았습니다. 실제 child admission/capture/input/정리 성공 및 최종 커밋은 여전히 미검증입니다.


2026-10-18 isolated-install steering: user requires all new installation and follow-up Window Use verification inside an isolated VS Code profile/extensions directory and isolated Azrael StateRoot. Global installed u17b and user state remain outside this installation authority. Deployment owner prepares frozen u18a-r2 from accepted u17a plus nine agreed overlays. Baseline capture completed (~366s), 24,415 selected files / 472,990,156 bytes / SHA256 4245e32da7ea995f4f1e54cdd9b5cc784c64e92d970e430e11aa46bab70d6e2c. Final overlay fingerprint and runnable preparation are next handoff. Root prepared live-runner and disposable WinForms app under the fix-r2 run while capture ran; node syntax check exit0. Planned live outputs belong to av18/artifacts/f group. Runner explicitly labels synthetic lifecycle/permission metadata, uses installed singleton + production MCP protocol/authenticated pipe, and leaves settings and grants to actual user choices. Package checks and isolated host6 must pass before live launch. Native real admission already passed; app launch/capture/input and final package verification remain pending.


2026-10-18 isolated u18c acceptance completed: product build exit0, corrected source tests exit0, package prepare exit0, engine preservation and final receipt recheck exit0, all six fresh isolated host stages exit0/passed=true. Final VSIX SHA256 7701ea8d1c0c8583ca03b335fb6f474a2e87c3567ee4a61728138fe7a6e3ccf7, version2026.0.10. Installed only av18/artifacts/f/extensions with StateRoot f/s; host acceptance applied no runtime override and original extension before/after hashes match. Logs: frozen u18a-r2/artifacts/logs/manual-u18c (build), manual-u18c-r2 (source/package), manual-u18c-r3 (preservation/host6/final identity). Failed earlier wrapper attempts retained with causal evidence: missing ignored tool inputs; missing explicit UI identity bindings. Successful outputs reused, no repeated successful build. Live installed singleton/protocol/pipe runner ready in isolated profile; context/list/select succeed. Fresh stage3 defaultfalse verified; settings opened and human toggle requested per Window Use skill. No native child start or app control attempted while disabled. Current exact state stored in isolated-acceptance-and-live-state.json; preserve active profile/version pending app launch/capture/input, cleanup, and final task commit.


2026-10-18 isolated u18c live test: user enabled stage3 revision1; human stage and app consent accepted. Managed child5 admission passed (ordinary parent2, connection/SID/profile/render/keyboard/mouse gates). Installed production MCP protocol/relay + singleton launched disposable app in child5; fresh image manually inspected; one text input delivered and independent app record + after-image verified exact string. Parent session2 test text remained empty. Owned test apps closed normally via fixture lifecycle sentinel. Managed cleanup truthfully deferred: Session unknownState is not confirmed clear. New exact child5 logoff approval requested; prior child4 approval not reused. Evidence in fix-r2/live-evidence/summary.json and result012?020/readbacks/image. Test metadata remains synthetic native lifecycle/permission fixture, not generated-model proof; general application/GPU/data compatibility unverified.


2026-10-18 child5 cleanup approval: user explicitly approved exact test child5 logoff. Fixed-target helper revalidated parent2, WTS child5, recorded winlogon PID29928 and creation Unixms1792278712555 before WTSLogoffSession. Helper exit0; logoffReturned=true/error0. Independent isolated runtime probe exit0: childAbsent=true/not-found1168, parentSessionId2, errors=[]; session5 processcount0. Managed owner conservatively keeps connected_unverified/cleanupUnconfirmed after external logoff; this is not automatic managed cleanup success. Evidence: logs/approved-session5-logoff-uac.json, approved-session5-cleanup-verification.json, live-evidence/summary.json. Retain isolated installed profile and source/runtime while the requested isolated environment is open; final lifecycle review waits for actual profile/helper reference release. No global install occurred. Task-level commit remains pending final lifecycle/integration; mixed unrelated dirty changes remain excluded.

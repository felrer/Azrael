# 프로젝트 테스트와 생성물 관리

상태: `partial`. 공통 Rust·native handler/권한·가용성 지침과 주요 Windows producer/cleaner의 소스 수용을 확인했다. 설치 앱의 가용성, 다른 OS 실기기와 과거 경로의 물리 이전은 별도다. 상세 검증 상태는 [작업 기록](../../work/BI-01-project-maintenance/01-plan.md)이 소유한다. 기능 보존 ID는 `tool.project-maintenance`다.

## 성공한 삭제의 상세 이력

상태: `current` (Windows x64 standalone). 공통 소스 구현과 실제 수용은 [빌드 비용 검토](../../work/FT-01-periodic-system-freeze/02-plan.md)에 기록한다. Linux/macOS 실기기 및 앱 내장 실행기 교체는 별도다.

현재 삭제 호출의 응답에는 파일별 속성 변경 목록을 유지한다. 영구 이력에는 해당 배열의 schema·개수·직렬화 SHA-256·논리 바이트를 담은 `attributes_summary`를 저장한다. 외부 결과와 deletion 결과 모두 deleted/remaining=false이고 deletion.error가 명시적 null이며 외부 오류가 없는 경우만 요약한다. 실패·차단·미완료·비정상 형식·이미 요약된 기록은 변경하지 않는다. 대상·결정 identity·이유·토큰·실제 결과·알 수 없는 필드는 유지하며 중첩된 다른 감사 snapshot은 재작성하지 않는다.

`review_decision_history`는 최상위 이력의 후보와 현재 revision·순서별 전체 record identity를 token에 결부한다. 명시적 `compact_decision_history`는 해당 token과 이유를 요구하고 기존 exclusive state transaction에서 legacy/stable-ID 기록의 상세만 요약한 뒤 집계 감사 영수증 하나를 저장한다. 행 삭제·순서 변경·저장 형식 이관은 하지 않는다. 일반 suspended writer의 CAS와 legacy 변경 금지 검사는 유지하며 stale review와 동일 record 동시 수정은 실패한다. 변경할 후보가 없으면 revision과 저장을 생략한다. 정리 이전의 source-retirement snapshot은 새 검토가 필요하다. 요약은 사용자 승인에 따른 상세 삭제이며 원래 파일별 목록을 복원할 수 없다.

## Windows 대량 I/O와 측정 메모리

상태: `current` (소스·Windows x64 native 검증). 근거는 [FW-01 작업](../../work/FW-01-volsnap-io-safety/01-plan.md)이 소유한다. 보존 기능은 `tool.project-maintenance`이며 실사용 설치·VSS 재발 관측과 다른 OS 검증은 별도다.

등록의 대량 파일 측정은 유지관리·catalog 전역 잠금을 반환한 뒤 Windows 스레드 백그라운드 모드로 실행한다. 이 모드는 CPU뿐 아니라 I/O·메모리 자원 우선순위를 조절하며 고정 대기나 처리량 상한을 추가하지 않는다. 새 진입 실패는 측정을 시작하지 않는 오류이고, 종료 후 원래 모드를 복원한 다음 전역 상태를 재취득한다. 이미 background인 호출자의 모드는 반환하지 않는다. 다른 OS는 기존 스케줄링을 유지한다. 실제 오류 취소·예약 및 CAS·의도/결과의 동기 저장은 유지한다.

Windows 삭제 전용 프로세스도 Job Object containment gate 이후 백그라운드 모드를 적용한다. 호스트 전체의 우선순위는 바꾸지 않는다. 검토된 경로만 자식부터 ordinary Win32 삭제하고 비어 있지 않은 디렉터리는 실패시킨다. 마지막 검사 뒤 추가된 이름을 재귀 탐색하여 삭제하지 않는다. 기존 junction·hardlink·System 속성·ReadOnly/Hidden 정규화·부분 실패·unknown 보호는 유지한다. 경로 기반 삭제가 같은 이름의 동시 객체 교체까지 원자적으로 방지한다고 주장하지 않는다.

공통 측정 identity는 기존 JSON 배열의 바이트를 고정 크기 버퍼로 SHA-256에 스트리밍한다. 전체 트리의 JSON records와 최종 직렬화 버퍼를 동시에 보유하지 않으며 기존 경로 목록·파일 전후 안정성 검사와 저장된 digest 의미는 유지한다. 이는 OS 크래시 무발생 보장이나 디스크별 전역 처리량 제한이 아니다. 분할 저장은 아래의 명시적 이관 조건을 유지하며 자동으로 실사용 저장소를 전환하지 않는다.

`refresh_group`은 전역 상태·catalog 잠금 아래 기존 예약·source·구성원·보호 검사를 모두 수행한다. 선택한 그룹과 모든 멤버의 전체 JSON 값이 같으면 응답을 반환하되 manifest를 다시 쓰거나 revision을 올리지 않는다. 어느 값이든 달라지면 기존 동기 저장을 수행한다. 이 생략은 refresh에만 적용하고 일반 저장·삭제 의도·실제 결과·실행 종료 기록에는 적용하지 않는다.

## 개인 맞춤 설정과 관리 기능 중지

상태: `partial` — 설정·UI·실행 경계의 구현과 검증 범위는 [작업 기록](../../work/FE-01-maintenance-preferences/01-plan.md)이 소유하며 설치본 수용과 다른 OS 실기기 확인은 별도다. 보존 기능은 `tool.project-maintenance`다.

Azrael의 **개인 맞춤 설정 → 프로젝트 유지관리**는 산출물 그룹, 유지관리 잠금, 관리형 삭제를 설정한다. 기존 동작을 보존하도록 미설정 기본값은 모두 켬이다. 요청값과 실제 적용값을 구분한다. 그룹에는 그룹·잠금이, 삭제에는 그룹·잠금·삭제가 모두 필요하며 의존 기능이 중지되어도 원래 선택은 유지한다. 일반 명령 실행 권한은 바뀌지 않는다. 관리형 테스트·빌드·생성자는 중지 사유를 반환하며 잠금 없는 공유 상태 변경으로 대체하지 않는다.

사용자 상태 루트의 `maintenance-preferences.json`은 공통 native owner가 소유한다. `preferences read`와 JSON stdin을 받는 `preferences write`는 schema1·단조 revision CAS로 설정을 읽고 변경한다. 호스트는 runtime의 상태 루트를 명시하고 설치 식별·capability를 검증한 실행기로 전달한다. UI만 숨기는 방식에 의존하지 않고 native 명령/lease 및 생성자가 신규 진입을 검사한다. 현재 모델의 오래된 도구 요청도 실행 시 설정을 다시 검사하고 다음 도구 계획에서 지원을 철회한다.

끄기는 새 작업 진입을 차단하고 이미 시작한 작업이 소유 잠금을 정상 반환하도록 한다. 실행 중 native 명령과 lease는 사용자 범위의 OS shared activity handle을 보유한다. 끄기 후 기존 handle이 남아 있으면 `draining`을 표시하며, 재활성화는 배출 종료를 확인한 후 수행한다. 설정 쓰기 동기화 잠금은 기능 자체의 잠금과 구분한다. 프로세스를 강제 종료하거나 잠금 파일을 삭제하지 않는다. 이 버전의 activity handle을 보유하지 않는 이전 실행기·다른 세션의 보호 기록은 자동 해제하지 않으며 기존 복구 절차가 계속 소유한다.

기존 작업의 결과 기록·close·참조 반환·확인된 복구는 중지 상태에서도 제한된 reconciliation 경로를 사용한다. 이 경로는 새 producer 생성, 소유·멤버 identity 변경 또는 참조 추가를 허용하지 않는다. 종료 미확인 예약·보호는 원래 기록에 유지하며 설정 변경을 성공이나 복구 증거로 취급하지 않는다. 다시 켜기는 저장된 선택을 적용하고 필요한 잠금을 현재 상태에서 새로 획득한다. 과거 잠금과 예약을 재생하거나 보류 삭제를 자동 실행하지 않으며 삭제에는 새 검토가 필요하다.

<a id="maintenance-platform-modules"></a>
## 다중 플랫폼 관리 명령과 모듈 경계

상태: `partial`. 공통 maintenance CLI와 Windows 설치 선택 연결은 소스에 구현하며 실제 제품 릴리스 수용은 별도로 수행한다. Unix 물리 삭제의 승인 구성·마운트 경계 어댑터는 Linux x64의 로컬 ext4(WSL2 검증 환경)와 macOS ARM64의 로컬 APFS에서 실제 검증했고 Windows 회귀도 확인했다. 나머지 아래 Unix 어댑터와 OS별 제품 전환은 `target`이다. 상세 환경·수용 범위는 [작업 기록](../../work/FF-01-maintenance-contention-timing/06-plan.md)과 [검증 근거](../../work/FF-01-maintenance-contention-timing/79-unix-verification.json)가 소유한다. 묶음 등록·조회, 소유·소비 참조와 보호, 검토·삭제·복구 및 잠금 lease를 각 OS용 Azrael 실행파일의 `maintenance` 하위 명령으로 제공한다. 기능 보존 ID는 기존 `tool.project-maintenance`를 유지한다. 내장 도구와 CLI가 같은 관리 코어를 사용하며 현재 설치물의 기능 수용이나 저장 형식 전환을 의미하지 않는다.

### 공통 코어와 플랫폼 어댑터

묶음 구성·소유·consumer 참조·보호 판정, 전체 그룹의 동일 결정, fresh review token, CAS 병합, 잠금 순서와 부분 획득 반환, durable 예약, intent/실제 결과 및 제한된 복구는 공통 코어가 소유한다. 플랫폼 모듈은 정책을 재판단하거나 보호 실패를 성공으로 바꾸지 않는다.

일회용 요청·응답·전송 로그는 호출 작업의 run이 소유하며 관리 상태 및 삭제 대상 밖에 둔다. CLI는 `--request -`로 EOF까지 단일 JSON을 받거나 작업 소유 파일을 읽는다. 두 전송은 같은 최대 64MiB 입력 한도와 dispatch/권한 경계를 사용하고, `capabilities.request_transports`로 지원을 알린다. 파일 요청은 `artifacts/maintenance` 아래에서 읽지 않는다. 보호된 관리 영역은 상태·예약·참조되는 최소 수용/복구 근거를 보존하고, evidence/receipt의 기존 경로·SHA·참조 검증은 유지한다. 기존 보호 기록의 이동·삭제 권한이나 일반 compaction을 추가하지 않는다. `tool.project-maintenance`의 CLI owner와 필수 library 검사, 공통 지침 동일성 검사가 이 경계를 보존한다.

| 모듈 | 책임과 보존 조건 |
| --- | --- |
| 공통 명령·프로토콜 | 등록·보호·검토·삭제·복구와 내부 lease 요청을 구분한다. stdout 응답과 stderr 진단을 분리하고 제한 크기·취소·실제 결과를 유지한다. |
| 파일시스템 어댑터 | 열린 객체 identity, 경로·링크·관리 루트 검사, 승인된 정확한 삭제 구성, 일반 삭제 및 최종 존재 관측을 담당한다. |
| 잠금 어댑터 | 기존 Rust OS handle 잠금을 우선 재사용한다. shared/exclusive 동작, busy/기타 오류와 handle 종료를 검증하며 잠금 파일의 존재나 PID로 점유를 추측하지 않는다. |
| 프로세스 어댑터 | 내부 lease와 필요한 삭제 worker의 연결·종료·취소를 담당한다. OS handle 반환과 durable 예약 해제, 프로세스 종료와 작업 성공을 구분한다. |
| 설치 실행기 선택 | 활성 릴리스의 절대 실행 경로·플랫폼·identity와 프로토콜/저장 형식 지원을 확인한다. OS별 배포·서명·권한은 [플랫폼 계약](multi-platform.md)에 따른다. |

Windows x64, Linux x64/glibc, macOS ARM64는 공통 코어와 동일한 명령·보호 의미를 갖는다. Windows와 Unix 파일 연산은 별도 구현하고 Linux/macOS의 공통 Unix 처리를 공유한다. macOS의 볼륨·경로 의미와 각 OS의 프로세스 처리는 그 아래에서 보정한다. 모듈 분리는 Rust 코드·OS API의 책임 경계이며 OS마다 독립적인 관리 제품을 복제하는 방식이 아니다.

### 파일 처리와 삭제

Windows 어댑터는 기존 handle/file ID·reparse 검사와 exact-tree worker, Job Object 격리, 승인된 생성물의 ReadOnly/Hidden 정규화 및 외부 hardlink 보호를 보존한다. PowerShell worker 안의 반복 탐색·정규화는 같은 C# 도우미에서 수행하며 각 단계와 항목의 조상·속성 관측을 새로 실행한다. 정규화 전후와 junction 제거 후의 정확한 구성 검사, 부분 속성 결과와 일반 삭제 경계를 유지한다. 현재 PowerShell worker는 내부 구현 의존성이다. 명령 진입 통합만을 이유로 검증된 worker를 제거하거나 Unix에서도 PowerShell을 요구하지 않는다.

Unix 어댑터는 승인된 descendant 목록을 소비하고 열린 디렉터리에 상대적인 no-follow 연산으로 탐색·관측·삭제한다. 삭제 직전에 객체 identity와 승인 구성을 확인하고 새 entry·교체·링크·특수 파일·권한 오류가 확인되면 해당 그룹을 중단해 실제 부분 결과를 남긴다. 단순 경로 재귀 삭제를 승인 목록 검증의 대체로 사용하지 않는다. 기존 exec-server의 no-follow 파일 연산과 workspace의 rustix/libc를 재사용 후보로 삼되, 현재 해당 remove API는 재귀 삭제를 지원하지 않으므로 그대로 호출하면 기능이 충족된다고 간주하지 않는다. maintenance가 상위 exec-server를 의존하도록 만들지 않으며, 공유가 필요한 저수준 primitive만 공통 utility로 분리하거나 기존 workspace 의존성을 직접 사용한다.

Unix에서는 임의 chmod·소유권·ACL 변경으로 삭제 실패를 해결하지 않는다. 일반 unlink의 hardlink 이름 제거와 공유 inode의 속성 변경을 구분하며, 선택하지 않은 외부 hardlink의 내용·속성을 보존한다. 경로 입력·프로토콜의 UTF-8 제약을 명시적으로 유지하고, 변환할 수 없는 이름은 손실 변환해 다른 경로를 가리키지 않도록 거절한다.

현재 물리 삭제 구현은 Linux의 `statx(STATX_MNT_ID)`와 macOS의 `fstatfs` 볼륨·마운트 이름을 사용한다. 선택된 프로젝트 루트부터 대상과 하위 항목까지 비교하며 관측을 지원하지 않으면 차단한다. 삭제 전 전체 구성을 비교하고, 각 unlink 직전에는 열린 조상 경로·현재 객체와 부모 구성을 새로 확인한다. 다른 하위 트리의 변화는 그 트리를 처리할 때 확인하여 부분 실패를 기록한다. 등록·전체 내용 측정의 공통 경로 탐색까지 같은 마운트 차단이 구현되었다는 뜻은 아니다.

열린 객체를 유지하므로 descriptor 사용량은 항목 수에 비례하며 한도를 넘으면 삭제 시작 전에 실패한다. 큰 단일 디렉터리의 반복 구성 조회 비용은 남아 있다. Unix의 관측과 `unlinkat` 사이에 적대적인 동시 rename을 원자적으로 배제하는 보장은 없으며, pinned descriptor와 인접한 재검사는 이 경합을 줄이고 관측된 변화를 차단한다. 모든 트리 변경을 원자적으로 배제했다고 주장하지 않는다.

macOS에서는 문자열 소문자 변환만으로 보호·소유권 identity를 확정하지 않는다. 볼륨의 대소문자 의미, 같은 객체를 가리키는 별칭, Unicode 이름과 device/inode 관측을 결합하며 확인할 수 없으면 보수적으로 차단한다. APFS의 대소문자 구분·비구분 구성을 각각 검증한다. Linux에서도 문자열 경로 비교를 실제 객체 identity의 대체로 사용하지 않는다.

새 관리 경로의 첫 수용 범위는 각 OS의 로컬 파일시스템이다. NAS·SMB·NFS 및 여러 OS가 동시에 여는 공유 관리 기록은 후속 범위다. 같은 프로젝트의 다른 OS 체크아웃은 그 로컬 루트의 관리 상태·예약·객체 identity를 사용하며 다른 OS의 review token이나 절대 경로 기록을 그대로 재사용하지 않는다. 등록 루트 안의 별도 마운트·bind mount도 자동으로 같은 삭제 경계로 포함하지 않는다. 승인된 관리 루트와 그 파일시스템을 고정하고, 새 mount/identity 경계나 확인 불가 경계를 만나면 중단한다. 별도 등록 루트의 처리는 그 루트에 대한 독립 검토를 필요로 한다. device 값만으로 모든 마운트 경계를 식별했다고 주장하지 않으며 Linux bind mount와 macOS volume 경계를 별도로 검증한다.

### 실행 진입과 권한

사용자 진입은 Windows의 `azrael.exe maintenance …`, Unix의 `azrael maintenance …`로 통일한다. 명령은 계정·UI·모델·네트워크 초기화 없이 진입한다. Node/PowerShell 호출자는 검증된 활성 릴리스의 같은 실행파일을 사용하며 임의 PATH 탐색이나 구형 실행기로의 조용한 fallback을 하지 않는다. 읽기 전용 capability 조회로 플랫폼·protocol·지원 operation·저장 형식을 확인하고 불일치하면 변경 전에 거절한다.

공통 진입은 `maintenance capabilities`, `maintenance --project-root ABS --request ABS`, `maintenance --lease ABS …`다. capability 응답의 schema·protocol·platform·operations·storage_formats와 실행파일 identity를 설치 시 검증한다. Windows 설치기는 새 설치물의 실제 lease와 격리 등록→검토→삭제·부재·fixture 정리를 확인한 뒤 상태 루트의 `maintenance-installation.json`을 OS lease 안에서 원자적으로 게시한다. 준비만 한 설치는 선택하지 않는다.

로컬 호출자는 검증된 설치 영수증의 절대 실행파일과 `maintenance` 접두 인자를 함께 전달한다. 설치 선택 영수증이 없는 이전 설치에서만 프로젝트의 고정 standalone을 사용한다. 선택 영수증이 손상되거나 실행파일·플랫폼·수용 근거가 맞지 않으면 변경을 거절하며 standalone으로 되돌리지 않는다. 명시적 검증용 실행파일 override는 실행 모드까지 함께 전달한다. 이 연결은 현재 설치나 저장 형식을 자동 이관하지 않는다.

내부 lease는 같은 실행파일의 별도 자식 프로세스에서 제공한다. 별도 worker가 필요한 경우에도 같은 설치 릴리스·제한된 내부 프로토콜을 사용한다. 상주 관리 daemon이나 모든 세션을 하나로 합치는 서비스는 추가하지 않는다. 부모 연결의 EOF·명시 취소·자식 종료와, 프로세스가 자손에게 연결을 상속한 경우를 실제로 검증한다. Linux 전용 parent-death 기능을 macOS에도 있다고 가정하지 않는다. parent PID 인자나 PID 부재는 전체 process-tree 종료 증거를 대체하지 않는다. 작업 중 연결이 끊겨 결과를 확인할 수 없으면 unknown과 보호 예약을 남기며 삭제 요청을 재전송하지 않는다.

내장 도구는 현재 대화의 경로별 권한·sandbox·취소를 적용하는 라이브러리 진입을 유지한다. CLI와 내부 worker는 그 실행 경계에서 허용된 권한과 선택 루트 안에서만 처리하며, worker 선택이 더 넓은 권한을 주지 않는다. 테스트·빌드 명령 실행도 기존 엔진 실행 owner와 승인 경계를 유지한다. 독립 CLI를 호출해 내장 도구의 거부를 우회하지 않는다.

### 플랫폼별 수용과 전환

각 OS에서 실제 CLI와 내장 호출의 등록→소비 참조/보호→검토→삭제 거부/성공→복구를 연결해 검증한다. 공통 계약의 필수 회귀는 부분 잠금 반환·동시 독립 commit 보존·동일 범위 충돌·부모/worker 비정상 종료·unknown 보존·정확한 묶음 삭제와 실제 부재·권한 거부다. 파일 교체/entry 추가/링크/hardlink/마운트 경계, macOS 두 APFS 구성, Unix 권한과 Windows 속성은 해당 OS의 실제 파일시스템에서 검증한다. 컴파일·기존 앱의 일반 기능 검사·mock 통과는 관리 기능 수용을 대신하지 않는다.

공통 소스는 세 OS를 대상으로 구현하고 native 관리 회귀를 기존 플랫폼 CI에 연결한다. 고정 입력·검증된 실행파일·실제 설치 경로를 묶은 OS별 수용을 통과한 플랫폼부터 순차 전환한다. 다른 플랫폼의 검증 중에는 그 플랫폼의 기존 경로를 유지한다. 기존 저장 형식으로 명령·모듈 통합을 먼저 수용하고 분할 저장 형식 이관은 별도로 진행한다. 실제 writer 전환·설치·데이터 이관은 각 단계의 별도 실행 권한과 모든 writer의 형식 호환성을 확인한다.

## 생성 소유권과 보관·관찰 책임

상태: `partial` — 현재 checkout의 Node 구현과 Windows x64 연동을 검증했다. 다른 OS 실기기·과거 기록의 전체 전환은 미완료이며, 앱 내장 엔진은 변경하지 않았다. [현재 구현·검증 작업](../../work/DW-01-build-preflight-timing/16-plan.md)이 수용 범위를 소유한다. 기능 보존 owner는 `tool.project-maintenance.lifecycle-source`와 같은 inventory의 writer 검사다.

실제 생성자 기록은 자기 구성원의 변경·삭제 판단 경계를 나타낸다. 다른 작업의 공유 사용은 소비 참조로 연결한다. 보관·관찰 기록은 발견한 경로와 미확정 사항의 inventory이며, 해당 경로를 생성했다고 주장하거나 변경·삭제 권한을 얻지 않는다. 관찰 범위끼리 또는 관찰과 생성 범위가 겹치는 것은 허용한다. 새 실제 생성자가 기존 다른 생성자의 경계를 겹쳐 소유하려 하면 명시적 소유권 이관이 필요하며, 과거 중복 기록의 정확한 기존 구성에 대한 종료·참조 갱신은 막지 않는다.

관찰 기록은 별도 record type과 조회·전환·해소 API로 관리하되 producer catalog와 같은 OS lease 및 예약 검사 경계를 사용한다. 미확정 사용·복구 보호는 실제 생성자에게 향하는 명시적인 scoped consumer reference로 투영한다. 현재 native protocol이 읽는 관찰 scope carrier는 retained/incomplete 및 generated/protection false를 유지하므로 삭제 가능한 producer가 아니다. 관찰 기록을 native 정리 그룹으로 등록하거나 producer cleanup/reservation/finalize의 대상으로 취급하지 않는다. 새 생성자와 미해결 관찰 범위가 겹치면 보호 참조를 먼저 저장하며, 부분 실패로 owner만 노출되거나 hold가 사라지지 않게 한다. 관련 없는 레코드와의 단순 경로 겹침을 소유권 충돌로 확대하지 않는다.

기존 미분류 custody 전환은 정확한 custodian·revision·원본 bytes SHA와 외부 독립 근거를 요구하며, 관찰 경로·기존 소비자·원래 불확실성을 보존한다. 전환만으로 경로의 생성이나 종료를 확정하지 않는다. 선택한 hold의 해소에는 실제 생성자의 고정 identity·정확한 구성·기존 종료 근거와 관찰 소비자의 범위별 제외 근거가 필요하다. 다른 hold와 소비 참조는 유지하고 실제 생성자 기록·실행 결과를 변경하지 않는다. 현재 사용·복구 필요성이 불명확하면 보호를 유지한다. 같은 catalog의 변경은 기존 native source fence와 예약 충돌 검사에 포함되며, 이 분리가 파일 이동·삭제나 앱 내장 엔진 교체를 뜻하지 않는다.

## 목적과 책임

Azrael은 프로젝트가 가진 테스트·빌드 명령을 등록된 묶음으로 실행하고, 일회성 검증물·빌드 결과·캐시·백업의 정리 판단에 필요한 정보를 제공한다. 판단은 현재 대화의 모델이 한다. 상주 서비스, 예약 실행기, 별도 모델 API 호출은 없다. 기간·용량 정책은 다음 관리 호출에서 검토할 후보를 고르는 조건이며 삭제 권한을 부여하지 않는다.

테스트 소스와 묶음 정의는 프로젝트가 소유한다. 저장소의 `project-maintenance.json`에는 프로젝트 ID, 명령·작업 디렉터리·환경·입력·선행 묶음·검사 조건, 관리 루트와 보호 경로를 둔다. Azrael 엔진에 포함되는 Rust 라이브러리는 설정 해석, 실행 계획, 영속 기록, 정리 검토와 결정을 담당한다. 프로젝트마다 관리 실행파일을 복사하지 않는다. 실제 테스트 명령에 필요한 Node·Cargo·PowerShell 등은 해당 프로젝트의 의존성이다.

상태 manifest는 같은 schema의 compact JSON으로 원자 저장한다. 삭제 전 intent와 실제 삭제 결과는 각각 동기 저장하며, 이후 최종 관측은 항상 수행한다. 이미 저장한 결정 결과와 묶음 전체 상태가 모두 같을 때만 중복 commit을 생략한다. 파일 재등장·관측 오류·묶음 상태 변경은 다시 저장하고, 저장 실패 시 기존 durable 결과 또는 pending intent를 보존한다. 이 최적화는 삭제 권한·경로 및 consumer 재검증을 생략하지 않는다.

결과 저장은 요청 소유의 순수 local snapshot을 짧은 reconciliation 잠금 획득 전에 준비한다. 최신 disk snapshot과의 CAS 병합은 잠금 안에서 수행하며, 전체 값의 동등성이 확인될 때만 기존 typed state와 local snapshot을 재사용한다. 결정 목록의 값 동등성 및 첫 ID 위치를 인덱스로 조회하되 구형 영수증의 불변성, 중복 ID의 첫 일치·순차 충돌, 배열 순서와 알 수 없는 decision 필드를 보존한다. legacy snapshot은 같은 논리 상태를 직접 직렬화하며 불필요한 전체 복사본을 만들지 않는다. blob 준비·pending 생성·JSON 직렬화·write·sync·rename·이후 obsolete 회수의 순서와 실패 보호는 유지한다. opt-in timing은 저장 전체와 순수 준비·병합·직렬화·쓰기·동기화·교체를 나누며 중첩 구간을 합산하지 않는다.

## 테스트와 빌드

빌드·배포 단계, 프로젝트 테스트 명령, feature 검사 및 managed Cargo는 새 명령을 시작하기 전에 `build-resource-admission.cjs`의 공통 조건을 확인한다. OS가 보고하는 가용 물리 RAM이 4GiB 미만이면 2초마다 다시 확인해 기다리고 4GiB 이상이면 시작한다. 측정 실패는 새 명령을 시작하지 않는 오류다. 대기와 회복은 stderr에 기록하며 이미 실행 중인 프로세스를 중지·종료하거나 메모리를 예약하지 않는다. 하위 도구가 자체적으로 만드는 worker/thread의 개별 시작은 제어하지 않으므로 시작 이후 RAM 하한을 보장하지 않는다. 공통 Node OS API를 사용하며 실제 수용 환경은 Windows x64다.

작업 래퍼의 caller 참조 추가는 저장된 revision과 같은 프로세스의 활성 handle을 함께 갱신하는 공통 경로를 사용한다. 종료는 catalog lease 안에서 현재 기록과 handle의 정확한 revision/identity를 확인하며 임의의 최신 기록으로 덮어쓰지 않는다. 관측별 종료 보고는 불변 내용 파일로 보존하고 producer 근거는 그 파일과 SHA를 가리킨다. `reports/producer.json`은 현재 관측의 조회 view이며, 기존 근거 파일을 대체하지 않는다. 고정 입력 준비의 통과와 래퍼 종료 기록의 성공은 별도 결과로 유지한다. 수용 상태는 [작업 기록](../../work/DW-01-build-preflight-timing/16-plan.md)이 소유한다.

묶음은 `test`, `prepare`, `build` 단계와 `one_off`, `retained` 목적을 각각 가진다. 일회성은 특정 작업을 확인하기 위한 목적이며 실행 횟수의 제한이 아니다. 모델은 실행 결과를 검토하고 문제가 있으면 수정한 뒤 재실행한다. 목적 달성 후 일회성 항목의 삭제 또는 보류를 선택한다. 장기 테스트의 제거에는 보호 계약의 폐기·대체 또는 충분한 중복 근거가 필요하다.

테스트는 등록된 검사만 실행한다. 검사에 필요한 준비 컴파일은 별도 단계로 표시하고, 제품 빌드는 별도 호출로 선택한다. 테스트 통과와 빌드 성공은 서로 다른 결과다. 프로젝트가 등록한 명령의 부작용도 계획에 밝혀야 하며, 도구가 명령의 이름만으로 그 동작을 보증하지 않는다.

계획은 선행 관계를 검사하고 동일한 실행 의미를 가진 명령을 공유한다. 작업 디렉터리, argv, 환경, 입력 identity, 단계, guard와 의존 관계가 다르면 같은 실행으로 합치지 않는다. 실행을 공유해도 소비하는 묶음별 결과를 남긴다. 컴파일·검사 결과 캐시의 eligibility와 무효화는 기존 프로젝트 소유자가 판단한다. 관리 도구가 새로운 느슨한 성공 캐시로 대체하지 않는다.

프로젝트 테스트 runner의 기본 출력도 작업/실행 단위로 관리한다. `--work-id`로 작업을 지정하며 생략하면 `project-tests`를 사용한다. 고유한 run을 실행 전에 pending으로 등록하고 `logs/`에 개별 명령 출력, `reports/`에 결과 checkpoint를 둔다. 성공한 실행은 complete로 기록하여 모델 검토를 기다리고, 실패·미확인 실행은 보호 상태를 남긴다. 명시한 기존 출력 경로의 배치와 호출 계약은 단계적 이전 동안 유지한다. 목록/계획만 조회하면 run이나 producer record를 생성하지 않는다. 이 계약의 소스 수용 상태는 작업 기록에서 구별한다. Checkpoint는 원자적으로 교체하며, Windows의 일시적인 `EPERM`·`EBUSY` 교체 오류만 25·50·100·200·400ms 간격으로 재시도한다. 재시도 소진이나 다른 오류는 기존 checkpoint와 실패를 보존하고 이후 명령 실행을 막는다.

Windows 모의 배포 검사도 `deploy-checks`의 실행별 `temporary/`, `logs/`, `reports/`에 fixture·출력·요약을 함께 둔다. `ChangedOnly`는 검사 선택에만 영향을 주며 과거 작업 로그를 출력 루트로 재사용하지 않는다. 생성 전 pending, 실제 검사 종료 후 complete 또는 failed 상태를 기록한다. 이는 모의 검사 producer의 종료 상태이며 실제 앱 배포의 성공을 뜻하지 않는다.

배포 입력 준비는 `deployment-workspace.cjs`와 `capture-project-inputs.cjs`가 소유한다. 선택한 파일은 읽기 전후의 파일·부모 identity와 물리 경계를 확인하고 독점 생성으로 별도 사본에 기록한다. 같은 읽기에서 계산한 Git blob ID로 기존 객체를 조회하며 없는 객체만 저장한다. 최종 독립 전체 내용 해시, 초기화된 중첩 저장소·삭제 파일·모드와 imported engine 출처 검사는 유지한다. 전체 준비의 엔진 사전검증 결과는 검증 도구 bytes가 같을 때 같은 실행의 복사 전 기준으로 재사용하고 원본 루트 identity를 단계 경계에서 고정·확인한다. 검증 도구가 교체되면 고정된 도구로 복사 전 기준을 새로 검증한다. 원본의 사후 검증과 두 사본의 독립 출처 검증은 유지한다. 보존 항목 `tool.project-maintenance`의 `test-capture-project-inputs.cjs` 실제 사본·교체·junction·Git 객체 검사와 `test-deployment-workspace.cjs`의 입력 고정·소유·변조 및 동일 바이트 루트 교체 거절 검사가 이 경계를 보호한다. 읽기 방식에 독립적인 테스트는 한 번만 실행하고 방식에 따라 달라지는 읽기 중 변경 경계만 두 모드로 확인한다. 반복 빌드의 세부 계약은 [빌드 playbook](../playbooks/build.md#반복-빌드검증의-입력과-캐시)이 소유한다. 실제 검증 환경은 Windows x64/Node 26.7이며 다른 OS의 네이티브 검증을 대신하지 않는다.

### 기본 입력과 스크립트 변경의 분리

`prepareDeploymentWorkspace`는 검증된 `sourceInputs`가 명시되면 기존 불변 입력을 참조하고 변경된 스크립트만 새 불변 그룹에 저장한다. 작업 사본은 독립 Git 메타데이터로 한 번 생성하며 기존 불변 입력이나 작업 사본을 수정하지 않는다. 이 파생 입력은 schema 2의 `script-delta`이고 완성된 불변 소스 디렉터리를 가장하지 않는다(`immutableProjectRoot: null`). 원본 전체 inventory·출처, 변경 파일과 모드, 기본 입력에 변경을 적용해 계산한 fingerprint 및 실제 작업 사본을 검증한다. 기본 입력과 원래 manifest, 파생 manifest의 dependency는 실행 종료 이후에도 유지된다. 준비 실패는 실제 실패 상태와 생성된 범위를 기록한다.

이 경로는 기존에 선택된 `scripts/` 바로 아래 일반 파일의 명시적 내용 교체만 지원한다. 추가·삭제·엔진·잠금 파일 등의 변경은 전체 입력 준비가 필요하며 자동으로 범위를 넓히지 않는다. 읽기 전용 검사는 기존 `reuseDeploymentInputs`, 준비된 호스트의 패키징은 기존 compact packaging 경로를 사용한다. 변경된 입력의 검사·제품 빌드와 최종 패키지 수용 여부는 각 소비자가 판단하며 입력 재사용만으로 이전 결과를 통과 처리하지 않는다.

선택된 소스 검사의 사전검사는 실제 고정 UI 자산 목록, instruction fixture의 프로젝트 경계·일반 디렉터리 상위 경로 및 Windows Cargo fixture의 linker 출력 길이를 확인한다. 파일 존재나 절대 경로가 생성·삭제 권한을 증명하지는 않으며 caller가 소유 수명을 관리한다.

## 실행과 복구

### 소유권과 잠금 경계

중단된 생성자의 재시작 권한은 정리 권한 및 성공 결과와 구분한다. `authorizeRestart`는 동일 owner·generation·revision, 종료가 검증된 unknown/null 생성자, 정확한 기존 record에 묶인 독립 증거와 SHA를 요구한다. 기존 catalog 잠금과 native CAS를 유지하며 active cleanup reservation, 변경된 증거·구성·소유권을 거부한다. 원래 결과와 보호 상태를 유지한 채 다음 generation만 허용하고, 다음 실행은 증거를 재검증하며 이전 unknown 결과를 별도 generation 기록으로 보존한다. 공유 Cargo owner는 물리 target lease 퇴역 영수증과 캐시 identity까지 검증하며 payload를 복사하거나 이전 실행을 성공으로 승격하지 않는다. 필수 검사는 기존 `tool.project-maintenance` 및 `engine.shared-engine`의 lifecycle·shared-cache 검사에 연결된다. 실제 소스 수용은 Windows x64이며 다른 플랫폼 실행 수용은 별도다.

상태: `current` (Windows x64 standalone·Node·PowerShell). [실행 작업](../../work/DW-01-build-preflight-timing/16-plan.md)이 구현·검증·설치 근거를 소유한다. Linux/macOS 실행 수용과 앱 내장 엔진 교체는 포함하지 않는다.

- 새 producer는 생성 전에 고유 run 루트를 예약한다. 공유 상위 디렉터리는 소유 단위가 아니며, legacy custody는 명시적으로 고정한 구성만 보호한다. 미확정 기존 자료를 시간이나 이름만으로 새 작업에 인수하지 않는다.
- producer ledger가 소유권과 참조의 기준이고 native inventory는 측정·결정의 파생 기록이다. producer 변경은 공통 native 쓰기 경계를 사용한다. 입력·버전·캐시 참조는 필요한 실제 대상에 한정하며 실행·설치·복구·증거의 독립 보호를 유지한다.
- 실제 배타성은 OS handle 잠금이 소유한다. 남은 진단 파일의 존재와 프로세스 종료를 작업 성공으로 해석하지 않는다. 구형 sentinel은 지원되는 명시적 복구 없이 인수하지 않는다.
- 잠금 가용성 확인은 공유 OS 잠금을 획득한 뒤 해당 handle로 메타데이터를 읽고 경로 identity·내용을 재확인한다. 배타 소유자의 메타데이터를 잠금 획득 전에 읽어 Windows OS33으로 대기 경로를 벗어나지 않으며, 경합은 기존 `maintenance_busy`와 명시적 대기 한도로 처리한다. 보존 범위는 `tool.project-maintenance`의 `lock_recovery.rs`와 필수 library 검사에 연결된다. 소스 수정의 수용과 설치된 실행기 전환은 구분한다.
- apply의 catalog 잠금은 예약·검증·commit에 한정한다. 물리 삭제 동안은 revision과 고유 fence에 묶인 그룹 예약을 유지한다. 새 참조·소유권·구성 변경을 포함한 모든 경로가 예약을 검증한다. 최초·변경 등록도 기존 범위와 incoming 범위를 먼저 예약한 뒤 전역 잠금 밖에서 내용을 측정한다. 설치된 실행기의 수용 상태는 운영 문서와 작업 기록에서 구별한다.
- 취소는 항목 사이와 파괴적 작업 직전 확인한다. 실제 완료·미시도·미확인 상태와 durable intent를 유지하고 Windows worker를 요청 수명에 연결한다.

삭제 검증은 최초 승인과 실제 삭제 사이의 경계를 명시한다. 사용이 끝난 자료는 기존 소유자 삭제 절차를 따르며 archive fallback이나 archive API를 추가하지 않는다.
상태: `current` (삭제 직전 중복 확인 제거, Windows x64 소스·standalone 후보 검증; 기본 설치는 별도). 최초 review/token 심사와 예약 획득, 항목별 intent 전 대상·권한·보호·참조 확인으로 삭제 목록을 승인한다. durable intent 저장 뒤에는 같은 목록에 대한 safe_entries와 예약·source 검증을 반복하지 않고, 취소 확인 후 승인된 목록으로 실제 삭제한다. intent 저장 중 발생하는 권한 callback·참조·경로 변경을 추가 심사하는 계약은 제공하지 않는다. 관리된 writer의 예약 준수는 유지하며 일반 외부 프로그램의 변경을 별도 승인 취소로 취급하지 않는다. 실제 삭제의 OS 오류·승인 트리·link 처리, 부재·결과 저장과 예약 해제는 유지한다. Windows의 짧은 일반 로컬 경로에서 최초 leaf 외 상위 경로는 필요한 reparse 속성을 새로 조회하고, leaf는 전체 metadata로 검증한다. 긴 경로·UNC·verbatim/device·정규화에 민감한 이름과 빠른 조회 실패는 기존 metadata 경로를 유지한다. 중복 확인 제거는 공통 코어 동작이며 다른 OS의 경로 구현은 유지한다. 검증·설치 수용 상태는 별도다.

상태: `current` (연속 catalog 잠금 구간 snapshot 재사용, Windows x64 소스·standalone 후보 검증; 설치는 별도). 같은 source의 OS catalog 잠금을 연속 보유하는 동안 성공한 catalog 파일 목록·검증된 기록 snapshot을 요청 내에서 재사용한다. 잠금 없는 관측은 기존처럼 새로 읽으며, 잠금 해제·재획득과 자체 catalog 쓰기·삭제 시 snapshot을 폐기한다. 선택 owner가 달라지면 해당 owner의 payload·recovery proof 검증은 별도로 수행한다. 오류는 snapshot으로 저장하지 않고 외부 review와 apply 사이에도 공유하지 않는다. 관리 writer가 잠금을 지킨다는 전제이며, 잠금을 우회한 외부 기록 변경을 같은 구간 중간에 감지하는 보장은 제공하지 않는다. revision/변경분 인덱스나 저장 형식은 추가하지 않는다.

### 요청 조정과 범위별 실행

상태: `partial` — 분리한 소스의 Windows x64 native·다중 프로세스 수용을 확인했다. 성능·VSS의 실제 검증 범위는 [통합 개선 작업](../../work/FW-01-volsnap-io-safety/02-plan.md)이 소유하며 기본 설치본의 동작과 구분한다. 다른 OS 실기는 별도다.

Azrael 관리 호출자는 요청을 한 번 접수하고 요청 identity로 대기·실행·결과를 추적한다. 공통 native owner가 프로세스 사이의 충돌 순서와 실행권을 소유한다. 같은 프로젝트·소유 generation·대상 구성·검증 모드·승인 근거의 요청만 동일 실행에 합류한다. 각 요청자의 권한은 별도로 확인하며 경로가 다시 생성되면 이전 승인을 사용할 수 없다. 즉시 반환을 명시한 저수준 호출은 기존 busy 의미를 유지한다.

관리 잠금은 snapshot·예약·현재 revision/fence 검증·내구성 있는 intent/result 반영에 한정한다. payload 측정·탐색·물리 삭제·대기는 이 잠금 밖에서 수행한다. 잠금 밖 결과를 반영할 때 config, 관련 소유/참조/보호, 실행 자원과 승인 근거를 재확인한다. 무관한 상태 변경과 같은 대상의 충돌을 구분한다.

허용된 읽기 사용은 여러 소비자가 공유할 수 있다. 변경·삭제는 실제 충돌 범위에서 배타적으로 실행한다. 경로 관계와 identity 검증부터 실행 범위 예약까지 원자성을 유지하며 여러 범위의 부분 예약을 보유한 채 나머지를 기다리지 않는다. 묶음의 전체 보호와 동일 정리 결정을 유지하고, 초기 병렬화는 독립 묶음/요청 사이에만 적용한다.

충돌 대상의 적격 요청은 접수 순서를 지키고 무관한 요청은 먼저 진행할 수 있다. 삭제 접수 이후의 신규 사용은 삭제 뒤에 대기하지만 기존 소비자를 강제로 종료하지 않는다. 참조 해제와 완료 기록은 해당 대기를 해소할 수 있도록 진행한다. 보호된 대상의 접수는 삭제 승인이 아니며 승인 근거가 바뀌면 재검토가 필요하다. 대기 256건/프로젝트, 32건/세션과 기본 기한 10분으로 무제한 접수 및 기아를 제한한다.

대기는 관리 잠금과 불필요한 실행 슬롯을 보유하지 않는다. 완료 알림은 최신 상태를 확인하는 신호이며 성공이나 삭제 권한이 아니다. 대기 취소는 해당 요청자에게 적용한다. 실행 뒤 취소는 다음 안전 경계에서 새 작업을 중단하며 시작한 OS 삭제의 실제 종료를 확인한다. 연결 종료·잠금 해제·PID 부재만으로 실행 성공이나 전체 producer 종료를 추정하지 않는다. 재시작 시 미확인 실행은 보호하고 자동 재실행하지 않는다.

같은 유지관리 설정 home을 사용하는 프로젝트와 진입점은 OS handle 잠금으로 삭제 예산을 공유한다. 기본 동시성은 1이며 설정으로 최대 2까지 허용한다. 현재는 물리 디스크 매핑을 구현하지 않아 모든 볼륨과 VHD에 하나의 보수적인 공유 예산을 적용한다. 서로 다른 설정 home 사이에는 예산이 공유되지 않는다. Windows I/O 우선순위와 순차 묶음 처리의 기존 안전 경계를 유지한다.

### 관리 잠금의 소유와 명시적 복구

#### 경합 처리와 보유 시간 관측

상태: `current` (Windows x64 소스·기본 standalone 수용; 앱 내장 도구는 별도). 변경 전 획득과 등록의 측정 후 재획득은 maintenance → 정렬된 catalog 순서의 전체 잠금 집합을 대상으로 한다. 기본은 한 번 시도하고 부분 획득을 반환한 뒤 즉시 `maintenance_busy`를 보고한다. 응답은 재시도 가능 여부·잠금 경로·안전하게 읽을 수 있는 소유 진단을 포함하며 소유 진단을 종료·성공 근거로 사용하지 않는다. 호출자가 `lock_wait_ms` 또는 lease의 `waitMs`를 0..600000 범위로 명시한 경우에만 일시적 OS 경합을 제한적으로 기다린다. 상위 실행자는 실제 소유 작업의 완료 신호나 명시적 대기를 선택한다. 등록 범위 예약은 측정과 명시적 대기 동안 유지하며, 재획득 후 최신 manifest와 source fence·revision·권한을 검증한다. 저장·삭제·권한 실패나 결과가 불명확한 변경은 재실행하지 않는다. intent 전임과 정확한 자기 예약·source·미완료 intent 부재가 확인된 정상 실패만 명시적 마무리로 예약을 해제하고, 그 확인이 불가능하면 기존 복구 경계를 유지한다.

삭제 전 그룹 전체 파일·hardlink 정규화 사전 검사는 범위 예약을 확보한 뒤 전역 관리 잠금 밖에서 수행한다. 그룹 전체의 사전 검사와 intent 전 승인, durable intent와 실제 결과의 저장 경계는 유지한다. 관계없는 그룹은 이 탐색 동안 관리 transaction을 진행할 수 있다.

`AZRAEL_MAINTENANCE_TIMING=1`은 native stderr의 JSONL 진단을 활성화한다. `maintenance.lock_wait`는 전체 획득 시도의 경과 시간·시도 수·획득/실패 결과이고 `maintenance.lock_hold`는 실제 OS 획득 이후 handle 종료까지의 시간이다. 보유 event의 outcome은 해제 경계 검증 결과이며 작업 성공이 아니다. `maintenance.phase`는 apply의 예약·intent 전 검증·intent/result 저장·물리 삭제·부재 확인과 registry/source 관측의 구간·결과를 기록한다. registry.catalog_snapshot_load와 registry.catalog_snapshot_hit는 실제 catalog I/O와 같은 잠금 구간의 snapshot 재사용을 구분한다. phase의 success는 해당 함수가 Ok를 반환했다는 의미이며 실제 삭제 상태는 결과 protocol로 확인한다. 중첩 구간의 시간은 합산하지 않는다. stdout protocol·잠금 metadata·권한·복구 상태는 바꾸지 않는다. 기본 출력은 비활성이며 진단 출력 실패가 실제 작업 결과를 바꾸지 않는다. 로그 수집·보관은 호출자의 기존 실행 로그 owner가 담당한다.


#### 공용 잠금 반환 대기

Node 소비자는 worker·native 시작과 초기 소유자 응답에 60초의 별도 응답 여유를 적용한다. 이 여유는 native OS 잠금 대기 예산을 늘리지 않으며 명시적 `waitMs: 0`과 `5000`도 그대로 전달한다. 초기 응답을 포함한 10초 지연 진단, 제한된 종료·배출 관측 및 unknown 보호를 유지한다. 보존 범위는 `tool.project-maintenance`의 `maintenance-lock-owner.cjs`와 필수 `test-maintenance-lock-owner.cjs` 초기 응답·실제 종료 회귀에 연결된다.

상태: `current` (Windows x64 소스·standalone·기본 경로 수용; Linux/macOS 실기기 미검증) — [구현·실측 작업](../../work/FF-01-maintenance-contention-timing/01-plan.md)이 수용 범위를 소유한다. 짧은 producer catalog 변경은 검증된 실행기의 `max_lock_wait_ms` capability에 맞춰 최대 10분까지 기다린다. 구형 실행기는 기존 5초 한도를 유지하고, 명시적 0은 계속 즉시 busy다. 일반 native 요청은 미지정 기본 0을 유지한다.

부분 획득한 잠금은 반환한 뒤, 이미 권한을 확인한 정확한 OS 잠금 handle의 반환을 기다린다. Windows는 OS 비동기 잠금 이벤트를 사용하고 다른 OS는 같은 handle에 대한 제한된 확인 간격을 사용한다. 잠금 반환은 다시 취득을 시도할 수 있다는 신호이며 producer 성공·종료나 복구 권한이 아니다. 재취득 시 현재 경로·권한·manifest·catalog·fence를 다시 검사한다. 공정한 ticket 순서나 상주 daemon은 추가하지 않는다. CAS·저장·권한·legacy marker·unknown 오류는 재실행하지 않으며 deadline과 취소·연결 종료는 계속 실패로 처리한다. 이미 완료한 삭제 결과·취소 결정·abort bookkeeping은 취소 후에도 제한된 취득을 거쳐 확정한다.

기존 `AZRAEL_MAINTENANCE_TIMING=1` 진단은 작업 wall time과 구간별 phase, 잠금 획득·보유 및 반환 대기를 구분한다. 포함 관계인 span을 더해 전체 소요시간으로 보고하지 않는다. 원문은 작업 run이 소유하고 독립 최소 결과를 보존한 뒤 일반 정리한다.

#### 관리 상태 분할

상태: `current` (소스·Windows x64 합성 저장소 검증, 실제 저장소 이관 미실행). `partitioned-v1`은 기존 State의 items/groups/runs/decisions 의미를 유지하며 section별 고정 16 bucket으로 데이터를 분할한다. items/groups/runs는 ID의 SHA-256 첫 바이트로, decisions는 배열 위치로 bucket을 고른다. SHA-256 이름의 불변 blob은 bucket의 정확한 구성원과 값을 보유하고, 작은 `manifest.json` 인덱스가 ID/위치와 blob을 연결한다. 살아 있는 blob은 최대 64개이며 특정 bucket의 크기가 균등하다는 보장은 없다. 항목별 수천 파일을 매번 여는 비용을 피하면서 변경 bucket만 저장한다.

읽기는 blob의 내용 hash와 정확한 bucket 구성을 검증하고 같은 요청에서 동일 blob을 한 번만 읽는다. 분할 형식의 읽기 전용 요청은 read 권한만으로 maintenance의 공유 OS 잠금을 보유해 스냅샷 읽기 중 blob 회수를 막는다. 쓰기는 기존 배타 잠금과 identity별 CAS 병합을 유지하며 변경 blob을 동기 저장한 다음 `manifest.pending`의 작은 인덱스를 동기 저장·원자 교체한다. 독립 파일 측정·삭제는 범위 예약 아래 병렬로 진행하고 공용 인덱스 반영은 짧게 직렬화한다. 완전히 독립된 동시 commit이나 공정한 ticket 대기열을 제공한다고 해석하지 않는다.

`partition_storage`는 자동 실행하지 않는 명시적 이관이다. 정확한 원본 manifest SHA, writer 종료 근거와 hash, 유효 구성, maintenance→catalog 배타성, pending·활성/불명확 예약·미종료 실행의 부재를 요구한다. 상태·구성·근거는 인덱스 반영 직전에 다시 확인한다. 새 인덱스의 revision 표식은 구형 State decoder의 숫자 형식과 달라 구형 실행기가 거절하게 한다. 같은 저장소를 사용하는 내장 엔진·standalone·호출자를 함께 전환하기 전 실제 이관하지 않는다. 보통 작업은 기존 저장 형식을 자동 변경하지 않는다.

정상 commit 뒤 이전 인덱스와 새 인덱스의 참조 차이에 해당하는 정확한 이전 blob만 검사·일반 삭제한다. 정상 prepare와 이 증분 회수는 무관한 namespace를 열거하지 않는다. 명시적 `compact_storage`의 전체 회수는 owner marker·namespace·내용 hash·인덱스 참조를 확인하며 이관과 동일한 종료·SHA·예약 검증을 요구한다. 미확인 저장의 pending과 미commit blob은 복구 근거로 보호하며 실패를 성공으로 바꾸지 않는다. `recover_refresh_pending`은 같은 지원 형식의 두 스냅샷을 검증해 기존의 보호 revision 전용 차이 검사만 수행한다. 분할 형식에서는 참조 blob과 marker의 hash·내용·identity도 최종 폐기 경계에 고정한다. 형식 간 pending이나 그 밖의 불명확 commit은 이 제한된 복구로 폐기하지 않는다.

관리·producer catalog·run claim은 schema 2 진단 파일과 OS handle 잠금을 사용한다. 정상 종료와 프로세스 소실은 OS 배타성만 해제하며 파일은 삭제하지 않는다. 남은 PID·시각은 진단 정보이며 점유나 작업 성공의 근거가 아니다. 획득·commit·해제는 열린 handle과 경로 identity를 재확인한다. 기존 schema 1·empty·미확정 sentinel은 자동 인수하지 않는다. `recover_lock`은 구형 marker의 명시적 폐기만 담당하고 새 OS 잠금 파일은 제거하지 않는다. run claim도 기본 즉시 busy와 명시적 대기 정책을 따르며 불명확한 경계는 계속 차단한다.

물리 작업 전 catalog 트랜잭션 안에서 선택 그룹의 revision·owner·member·consumer 근거를 durable 예약과 고유 fence에 고정한다. 그룹별 OS lease는 작업 수명 동안 유지하며 새 참조·중첩 소유·구성 변경과 입력 준비를 차단한다. 관계없는 작업은 짧은 catalog/manifest 트랜잭션으로 진행할 수 있다. manifest 저장은 변경한 identity와 기준 revision을 비교해 병합하고, 같은 항목의 충돌을 거부한다. 각 intent와 실제 결과의 동기 저장 경계는 유지한다.

producer 예약 완료 명령은 catalog 잠금 안에서 전체 예약을 먼저 검증한다. 각 terminal 영수증을 동기 저장한 뒤에는 해제할 ID의 OS lease·durable 예약·producer source fence만 새로 검증한다. 다른 예약 전체를 해제마다 반복 검증하지 않는다. 변경된 그룹과 미확인·불완전 outcome의 예약은 보존하며, 앞서 완료한 독립 그룹의 실제 결과는 유지한다.

등록 예약은 기존·신규 항목 ID와 경로, 구성 증거, 변경 전후 producer source를 함께 보호한다. 측정 후 maintenance → 관련 catalog 순서로 잠금을 다시 얻고 변경 identity의 CAS 병합, 설정·루트 객체·source fence·참조를 재검증한 뒤 저장한다. 관계없는 변경은 보존하고 같은 범위의 변경은 거절한다. 정상 취소나 저장 전 검증 실패는 미저장 상태를 버리고 자기 예약만 해제한다. 저장·source fence가 불확실하면 durable 예약을 남겨 명시적으로 복구하며 성공으로 바꾸지 않는다. `refresh_group`은 내용 재측정 없는 기존 짧은 경로를 유지한다.

예약 소유 프로세스가 사라져도 durable 예약과 미확인 intent는 남는다. `recover_reservation`은 정확한 예약 raw SHA·fence/token·원래 lease owner와 독립적인 전체 process-tree 종료 근거를 요구한다. 구형 PID 부재만으로 인수하지 않으며 pending manifest·변경된 source fence·확인 불가는 차단한다. Windows에서는 조회 가능한 프로세스 객체도 OS 종료 신호가 확인되면 PID 거부 조건만 해제한다. 실행 중·접근 거부·상태 불확실성은 차단하며 독립적인 종료 근거를 대체하지 않는다. 초기 쓰기 중 손상된 예약도 원래 stable lease metadata와 raw SHA를 고정한 별도 명시적 복구로만 해제한다. 복구는 작업 성공이나 exit code를 만들지 않는다.

소유자 실행기의 `recover_lock`은 `maintenance`, `catalog`, `run_claim`의 정확한 제어 경로만 다룬다. 요청은 원래 marker의 raw SHA-256·token(구형 token 없음은 null), 독립 producer/process-tree 종료 확인, 이유, 보호된 관리 evidence 경계의 증거와 SHA-256·별도 영수증 경로를 명시한다. 살아 있는 owner PID 또는 관측 권한의 불확실성은 복구를 거부한다. PID 부재나 경과 시간은 종료 증거를 대체하지 않는다. 원래 실행 결과와 nullable exit는 변경하지 않는다.

복구 시도끼리는 별도 stable OS guard로 직렬화한다. `recover_lock`과 `recover_reservation`은 `manifest.pending`을 차단한다. 링크·reparse·경계 이탈, 권한 거부, marker/증거 변경도 차단한다. 독립적으로 읽을 수 있는 복구 영수증을 먼저 보존하고 정확한 원래 파일만 일반 삭제한다. 구형 empty/PID-only sentinel도 동일한 독립 근거가 필요하다. 기존 복구 API의 검증은 [작업 기록](../../work/DT-01-old-log-cleanup/03-plan.md)이 소유하며 설치된 내장 도구의 지원을 의미하지 않는다.

`recover_refresh_pending`의 대상은 미커밋 보호 revision 갱신만이다. 정상 manifest와 pending의 정확한 SHA·연속 revision·producer registry 그룹과 동일 구성, 독립적인 전체 producer 종료 증거 및 PID 거부 조건을 확인한다. 변경은 해당 그룹과 구성원의 `protection_revision`에 한정하며 실행·삭제 결과, intent, 참조·소유·구성 등의 다른 변경은 거부한다. maintenance OS 잠금과 복구 guard 안에서 별도 동기 영수증을 먼저 저장하고, 최종 권한·내용·identity를 재확인한 pending만 일반 삭제한다. 정상 manifest는 변경하지 않으며 이후 보호 정보를 새로 갱신한다. 이 좁은 복구는 불명확한 저장 결과의 범용 rollback이 아니다. 구현·Windows x64 standalone 수용 상태는 [현재 작업](../../work/EC-01-unused-file-archive/01-plan.md)이 소유하고 다른 OS 실기 및 내장 엔진 교체는 별도다.

`recover_lifecycle_pending`은 lifecycle 참조 해제의 미게시 pending을 폐기하는 별도 `decision:"abort"` 경계다. 정상 JSON과 pending의 정확한 SHA·동일 소유자·연속 revision, 원래 참조 해제 요청의 canonical SHA 및 선택한 참조만 제거한 차이를 확인한다. 독립적인 writer/process-tree 종료 증거와 PID 거부 조건, 새 catalog OS lease, 예약·권한·파일 identity 검사를 모두 요구한다. 선택 프로젝트의 관리 evidence 안에 고정한 요청·종료 근거를 검증하고 별도 동기 영수증을 먼저 보존한 뒤 정확한 pending만 일반 삭제한다. 정상 JSON과 참조·원래 실패/unknown 결과는 바꾸지 않으며 publish나 범용 rollback을 제공하지 않는다. Windows x64 별도 standalone에서 선택 회귀·전체 PM 검사·release와 실제 미게시 참조 해제의 abort를 검증했다. 실제 복구 수용 및 일회성 실행파일의 사용 종료는 [작업 기록](../../work/ET-01-cold-build-cache-audit/01-plan.md)이 소유한다. 기본 standalone 및 앱 내장 도구 지원과 다른 OS 실기 검증은 별도다.

보존 범위는 [기능 목록](../../scripts/azrael-feature-contracts.json)의 `tool.project-maintenance`에 연결된다. `lease.rs`·`lib.rs`·standalone CLI가 복구 경계를 소유하고 `tests/registry.rs`의 선택 회귀 및 `tool.project-maintenance.library`가 정상 JSON/참조 불변과 실패 보호를 검사한다.

내장 도구는 조회·등록, 테스트 계획/실행, 빌드 계획/실행, 정리 검토, 정리 적용을 구분한다. 명령은 기존 엔진 실행 경계를 통해 같은 sandbox·approval·취소 정책을 적용한다. 도구가 금지된 대화나 원격 환경을 로컬 실행으로 우회하지 않는다. 파일을 직접 읽거나 변경하는 동작에도 실제 경로별 권한 검사를 적용한다.

등록된 프로젝트 ID는 엔진의 프로젝트 별칭 목록에서 정확한 루트로 해석한다. 별칭 등록·해제는 설정 메타데이터만 다루고 소스를 생성하거나 삭제하지 않는다. 같은 ID를 다른 루트에 조용히 덮어쓰지 않는다. 프로젝트 밖의 소유 백업 디렉터리도 설정과 별도 ID를 가진 관리 루트로 등록할 수 있다. 관리 경로는 각 등록 루트 안에 한정하고 등록 루트 자체는 보존한다.

실행 ID와 단계는 명령 실행 전에 기록한다. 선언된 입력과 설정을 실행 전후 확인하고 변경되면 이전 입력의 통과로 기록하지 않는다. 종료 상태와 실제 exit code는 관측한 값만 저장한다. 시작 실패·중단·진행 중·세션 유실·미실행은 통과와 구별하며, 실제 결과를 얻지 못한 exit code는 `null`이다. 선행 단계의 성공을 확인하지 못하면 후속 단계는 실행하지 않는다. producer 수명 종료와 검사 결과 확인을 구분한다. 실행 경계가 종료를 확인한 producer는 검사 결과가 불확실해도 중복 실행 보호를 해제할 수 있다. 대화나 엔진이 종료되었다는 이유만으로 실행 완료를 만들거나 동일 producer를 중복 실행하지 않는다.

세션을 잃은 실행은 모델이 정확한 producer와 자식 프로세스의 종료를 별도로 확인한 근거·이유를 제출하여 복구할 수 있다. 현재 엔진에 속한 세션은 해제하지 않는다. 복구는 미확인 결과와 `null` 종료 코드를 유지하며 producer 보호만 해제한다. PID 부재만으로 종료나 성공을 추론하지 않는다.

프로젝트 상태는 Git에서 제외되는 `artifacts/maintenance/`에 둔다. 갱신은 배타적 잠금과 원자적 교체를 사용한다. 잠금·producer 상태를 확인할 수 없으면 작업을 보류하고 소유자 확인 없이 잠금을 제거하지 않는다. 명령 출력과 짧은 결과, 상세 로그 위치를 연결하며 테스트 성공이 정리 실패를 감추지 않게 한다.

## 생성물과 백업

완결되고 종료가 검증된 `producer_registry_v1` 묶음의 최초 등록은 생산자가 계획한 부재 구성원도 보존한다. 전체 소유·구성·보호 검증을 통과한 부재 항목만 identity 없는 0바이트 상태로 등록하며, 확인 불가나 임의 단독 항목은 허용하지 않는다. 부재 경로가 다시 나타나면 검토·적용을 차단한다. 이미 없던 용량은 실제 삭제량에 포함하지 않는다.

Windows 생성물 항목의 `verified_junctions`는 정확한 상대 하위 경로·`junction` 종류·절대 물리 대상을 최대 1024개 명시한다. `verified_file_symlinks`는 같은 형식의 `file_symlink` 선언을 최대 1024개 받되 대상은 같은 항목 안에 존재하는 물리 일반 파일이어야 한다. 상대 또는 절대 파일 링크 텍스트를 지원한다. 등록은 비추적 handle identity·생성 시각과 정확한 reparse 종류/원시 내용을 고정하며 측정은 링크를 통해 대상 내용을 읽거나 중복 집계하지 않는다. 루트·상위 경로·중첩 예외·미선언 링크·디렉터리 symlink·링크 체인·외부 파일 대상·알 수 없는 reparse 종류는 계속 거부한다. 등록 모드 검토는 선언된 링크를 재검증하고, 적용 전 전체 경로 열거가 새 미승인 링크를 차단한다. 지원된 링크는 속성을 바꾸지 않고 링크 자체만 ordinary Win32 삭제하며 실패하면 나머지 묶음 증거를 보존한다. 대상은 자체 소유 구성원으로 독립 측정·권한 확인·정규화·삭제한다. 파일 링크 선언은 Windows 전용이며 다른 OS의 기존 링크 거부는 유지한다. 구현과 native 검증 범위는 [파일 링크 작업](../../work/GE-01-file-symlink-cleanup/01-plan.md)이 소유하며 설치본 반영을 뜻하지 않는다. 보존 항목 `tool.project-maintenance`의 library 검사가 정션과 파일 링크의 구분을 검증한다.

ReadOnly·Hidden 속성의 일반화가 필요한 Windows 파일은 삭제 루트 안에서 확인한 hardlink 이름 수가 실제 연결 수와 일치해야 한다. 외부 연결과 서로 다른 구성원에 걸친 연결은 보수적으로 차단한다. 모든 구성원의 사전 검사를 통과한 뒤에만 삭제를 시작하며, 일반 삭제와 직전 identity·연결 수 재확인을 유지한다. System 속성과 ACL은 변경하지 않는다.

Windows 삭제는 하나의 maintenance 요청에 속한 PowerShell worker를 순차 재사용한다. 각 항목은 새 검사·속성 기록·삭제 결과를 갖고, 결과 응답을 받은 뒤 기존 durable 저장을 마쳐야 다음 항목으로 진행한다. 프로세스는 요청 밖으로 공유하지 않으며 EOF로 종료·회수한다. 응답 유실이나 통신 실패는 같은 삭제를 재시도하지 않고 미확인 결과를 보존한다. 완전히 검증된 결과를 받은 뒤 프로세스가 종료해도 해당 결과는 유지한다.

일반 삭제 범위는 선택한 프로젝트의 `project-maintenance.json`에 있는 `managed_roots`의 엄격한 하위 경로다. 이 범위에 들어가지 않는 대상은 `outside configured managed roots`, 관리 루트 자체인 대상은 `managed root itself is protected; select owned descendants`로 구별한다. 등록된 묶음도 같은 경계와 별도의 보호 참조·권한 검사를 따른다.

Windows 삭제에 사용하는 내부 PowerShell은 공용 `background_command` 정책으로 콘솔을 생성하지 않는다. 표준 입출력, 프로세스 종료 관측, 삭제 전후 검사와 실패 시 보존 규칙은 그대로 적용한다. 이 정책은 Windows 프로세스 생성에만 적용하며 Unix 삭제 경로를 바꾸지 않는다.

### 동일 경로의 중복 소유권 통합

상태: 소스 구현 및 Windows x64 standalone 수용 완료. 실제 중복 등록 통합·일반 삭제 근거는 [전체 캐시 정리 작업](../../work/ET-01-cold-build-cache-audit/01-plan.md)이 소유한다. 설치된 앱 반영과 다른 OS 실행은 미검증이다. 보존 feature ID는 `tool.project-maintenance`다. `reconcile_duplicate_groups`는 완결된 generic native 그룹들이 같은 물리 경로를 중복 등록한 경우의 명시적 metadata 이전 절차다. producer registry 그룹의 소유권이나 실행 결과는 이 절차로 변경하지 않는다.

요청은 모든 원래 그룹과 각 소유자, 새 그룹·소유자, 이유와 원본 전체 기록을 담은 외부 증거 및 SHA를 지정한다. `review` 단계의 토큰은 원래 구성·등록 측정·현재 물리 identity·config·증거를 묶으며 `apply`는 같은 조건을 다시 검증한다. 동일 경로의 측정이 다르거나 중첩 경로·미선택 소유·불완전 구성·변경된 증거·실행/복구/참조/보호/예약·권한 문제가 있으면 이전하지 않는다. 관리 루트 자체 보호도 유지한다.

성공한 통합은 경로별 단일 항목과 하나의 완결 그룹을 같은 트랜잭션에 저장하고 원래 기록·이전 근거를 감사 이력에 보존한다. 실제 payload는 변경하지 않는다. 이후 일반 검토·토큰·명시적 delete/defer가 삭제를 판단한다. 종료와 부재가 이미 확인된 과거 삭제 항목만 관리 루트 폐기의 겹침에서 제외할 수 있으며 다시 나타난 경로는 계속 보호한다.

### 중첩 소유 항목의 단계적 폐기

`retire_nested_member`는 같은 소유자가 완결된 서로 다른 두 묶음에서 엄격히 중첩된 항목을 정리하는 제한된 절차다. 각 묶음에는 실제 live 항목이 하나만 있어야 한다. 요청은 `parent`, `child`, `owner`, `reason`, 삭제 경계 밖 `evidence_ref`를 명시하고 양쪽 묶음을 함께 검토한다. 일반 중첩 보호는 유지하고, 이 정확한 쌍의 별도 whole-group 결정 요구만 대체한다. 다른 중첩 항목과 원본·membership evidence·실행·참조·권한·링크 보호는 유지한다.

적용은 fresh token을 가진 상위 `defer`와 하위 `delete` 두 결정만 허용한다. 상위의 보호나 stale token도 하위 삭제를 차단한다. 하위를 먼저 처리하고 기존 durable intent·삭제·부분 실패 기록을 재사용한다. 삭제 직전 상위의 구성과 membership evidence도 다시 확인한다. 하위 삭제는 상위 내용 변경이므로 상위는 현재 내용으로 전체 재등록하고 새 검토를 받아야 한다. 상위까지 같은 호출에서 삭제하거나 원래 producer의 unknown 결과를 성공으로 바꾸지 않는다. 요청과 증거 identity를 토큰 및 결과에 보존한다. 검증 범위와 실제 적용 결과는 [작업 기록](../../work/DS-01-version-011-cleanup/01-plan.md)이 소유한다.

### 관리 경계 폐기

상태: 소스 구현 및 Windows 검증 완료. crate의 90개 검사에 폐기 회귀 8개가 포함되어 통과했고, 별도 소유자 실행기 컴파일을 확인했다. 다른 OS 실행과 설치된 제품의 반영은 별도다. 일반 검토·삭제의 관리 루트 보호는 유지한다. 생성물의 수명이 끝나 관리 경계 자체를 폐기할 때만 `review`와 `apply`에 같은 `retire_managed_roots` 요청을 명시한다. 요청은 정확한 항목 ID 목록, 등록된 소유자, 폐기 이유, 삭제 경계 밖의 보존 근거를 가진다. 등록 프로젝트 루트 자체는 폐기할 수 없다.

대상은 완결된 lifecycle group에 속하고 항목과 그룹의 소유자가 요청과 같아야 한다. 경로는 정확히 설정된 managed root이며 프로젝트의 엄격한 하위여야 한다. 다른 등록 항목·원본 경로·중첩 관리 경계와 겹치면 거부한다. 참조·보존·실행·pending·구성·권한·링크·예약 경로·보호 경로 검사는 그대로 적용한다. 증거는 프로젝트의 보호된 `artifacts/maintenance/evidence/` 아래 1 MiB 이하의 읽기 가능한 일반 파일이어야 한다. 폐기 요청 전체와 현재 증거 내용 identity를 검토 토큰에 묶어 일반 삭제 토큰이나 변경된 폐기 요청을 재사용하지 못하게 한다. 같은 그룹의 모든 live 구성원에 대한 명시적 결정과 실제 결과를 요구한다.

적용은 기존 durable intent와 일반 삭제 경로를 재사용하고 폐기 요청을 결과에 남긴다. 부분 실패를 등록 해제나 부재로 바꾸지 않는다. 설정된 관리 경계와 native 이력은 보존하여 결과를 재검토할 수 있게 한다. 실제 payload 부재와 별칭·기록의 해제는 별개의 결과다. `maintenance_owner`는 선택한 절대 프로젝트 경계 안에서 `inventory`·`register`·`review`·`apply`를 수행하는 소유자 실행기다. 실행 환경의 권한을 따르며 자동 승격이나 제품 설치를 하지 않는다. 공통 정책의 대상은 지원 플랫폼 전체이고, 실제 검증 환경은 검증 결과에 따로 기록한다.

#### 배포 제어 파일과 빈 컨테이너의 폐기

상태: `partial` — Windows 전용 소스 구현이며 실제 수용과 남은 검증은 [FW-01 작업](../../work/FW-01-volsnap-io-safety/02-plan.md)이 소유한다. 보존 기능은 `tool.project-maintenance`다. 일반 `.git` 보호와 재귀 삭제 경계는 유지한다. 이 예외는 payload 소유 기록이 이미 최종화된 생성 배포 workspace의 일반 gitfile 하나와 명시적으로 열거한 빈 구조 디렉터리에만 적용한다. 전용 배포 소유자의 경계는 프로젝트 `artifacts`의 엄격한 하위이며 일반 native `managed_roots` 소속과 별도로 검증한다. 설정된 보호 경계 및 managed root 자체·조상은 이 예외로 폐기하지 않는다.

배포 소유자는 원래 생성자의 ID·소유자·generation, 종료·참조 해제·payload 부재 근거, gitfile의 정확한 bytes·SHA·이전 `control/git` 연결과 그 대상의 부재를 별도 불변 증거에 묶는다. 새 폐기 소유권과 journal은 살아 있는 caller run 아래 게시하며 원래 실행 결과를 변경하지 않는다. 다른 소유·참조·예약과 경합하거나 내용·identity·구성이 달라지면 삭제를 거부한다. Windows의 대상과 상위 경로에서 reparse 속성을 새로 확인한다.

일반 native 항목과 실행 입력의 보호도 확인한다. 이 전용 경로는 Windows의 `legacy` 저장 형식만 광고하는 검증 실행기로 제한하며 분할 저장 형식은 지원하지 않는다. 준비와 적용은 완전한 metadata inventory 및 실행 상세를 읽고 manifest·설정 identity와 SHA가 조회 전후 같음을 확인한다. inventory의 그룹 요약에 없는 구성원 ID는 같은 fence로 검증한 legacy manifest에서 읽어 요약 수치·핵심 필드·항목의 역방향 소속과 대조한다. 과거 pending/unknown decision은 대상의 항목·그룹·source·출처·참조 경로와 겹치거나 해석이 불확실하면 보호하며, 무관함이 확인된 이력은 다른 대상의 폐기를 차단하지 않는다. `provenance_ref`의 기존 `문서.md: 설명` 형식은 실제 문서 경로와 설명을 구분하며 일반 경로 필드의 모호한 colon은 계속 거절한다. 저렴한 구조 검사를 실행 상세 조회보다 먼저 수행한다.

상태 잠금은 그 다음 catalog 잠금 순서로 취득하고 같은 snapshot을 CAS로 재확인한다. 다른 active reservation·미게시 pending 제어 파일·관련 실행 입력·일반 소유 및 source 경로가 있으면 거부한다. 상태 잠금 안에서는 native inventory를 다시 호출하지 않는다. 이 작은 예외에 한해 물리 작업이 끝날 때까지 상태 잠금을 유지하며 대량 payload 삭제의 잠금 범위는 넓히지 않는다.

적용은 native 소유 예약을 유지한 별도 worker에서 일반 unlink와 빈 디렉터리 rmdir만 사용한다. 시작된 작업은 실제 worker·native·속성 조회 프로세스의 종료와 pipe close까지 기다린다. 이 경로의 `drainOnly`는 timeout에 의한 kill을 사용하지 않으며 기존 lease 호출자의 기본 정책은 바꾸지 않는다. 부분 실패와 미확인 결과는 성공으로 바꾸거나 자동 재실행하지 않는다. 물리 부재·예약 종료·소유 기록 최종화를 각각 확인해야 완료다. 협력하는 writer의 예약 보호와 외부 프로세스의 임의 파일 교체에 대한 원자적 방어를 동일시하지 않는다.

관리 항목은 테스트/fixture, 실행파일, 빌드 결과, 캐시, 소스 스냅샷, 패키지, 백업으로 구분한다. 생성 시각·소유자·생성 작업·원본·경로·내용 identity·크기·버전/출처·관련 실행·최근 사용·보존 사유와 재검토 조건을 기록한다. 버전 정보에는 확인 가능한 소스 커밋, 도구 버전, 대상과 설정, 캐시 형식 등을 담으며 알 수 없는 정보는 추정하지 않는다.

일반 목록 조회는 등록된 기록과 측정 시점을 반환한다. 매번 전체 프로젝트를 복사하거나 전 캐시를 해시하지 않는다. 명시한 항목의 검토·적용 시에는 실제 파일 identity와 보호 상태를 갱신한다. 논리 크기와 실제 회수 공간을 구분하고 하드링크·공유 파일 때문에 확보 공간을 과장하지 않는다.

새 생성물은 생성 소유자가 등록한다. 기존 항목은 알려진 manifest·실행·설치·복구 기록에서 후보로 수집한다. 파일명, 확장자, 오래된 시각만으로 생성물이나 삭제 가능 상태를 확정하지 않는다. 사용·보호 상태를 확인하지 못한 후보는 삭제하지 않는다. 현재 설치본·직전 복구본·활성 실행/lease·고정 입력·인계 대기 결과·현재 증거의 입력을 보호한다. 유일한 복구 백업은 대체 복구본이나 복구 종료 근거가 필요하다.

## 정리 결정과 적용

### 기능 의존 캐시와 연결 정리

동결 작업 사본의 module cache는 명시적인 `artifactProjectRoot`를 장기 소유자로 사용한다. 새 배포 manifest는 `moduleCacheProjectRoot`와 물리 owner identity를 고정하고, 파생 사본과 읽기 전용 재사용도 이를 검증한다. 기존 manifest는 선택 경계에서 명시된 artifact root만 검증해 전환한다. 독립 build의 로컬 기본값과 명시적 owner 선택은 유지한다.

사본의 companion 준비 의존성은 사용 전에 장기 owner의 정식 lifecycle consumer에도 연결한다. `module-cache-consumers.cjs`가 생성하는 소비 영수증은 source project/version, 물리 root와 release identity, 정확한 module/key를 묶고 native catalog의 inbound reference 검사에 참여한다. 패키징 전 아직 없는 release는 정확한 예정 경로와 project/owner 및 존재 ancestor의 물리 identity를 고정하고 pending 소비자로 보호한다. release 디렉터리를 미리 만들지 않으며, 패키징 성공 직후 같은 module lease 안에서 필수 package 파일의 SHA와 실제 release identity를 별도 immutable seal에 묶는다. 예정 경로의 소비 참조 해제에는 이 seal이 필요하며, 봉인 전 중단·사본 부재도 보호를 숨기지 않는다. 이미 존재하는 release를 연결하는 기존 물리 identity 검증은 유지한다. 물리 module lease 아래 source 참조와 owner 참조를 확정한 뒤 도구를 사용한다. 활성 영수증은 pending 상태로 자체 삭제도 차단한다. 완료 준비 검증 후 source의 정확한 참조를 CAS 해제하고, owner에 독립적인 완료 근거를 남긴 뒤 대응 참조를 해제한다. 참조가 모두 해제된 영수증만 complete로 전환해 기존 관리 owner로 정리할 수 있다. 사본 퇴역 전에 이 영수증도 정리해야 하므로 빈 소비 기록을 무기한 남기지 않는다. 중간 중단 시 같은 요청으로 재개하며 다른 key·installation·recovery 참조와 실패·미확인 결과를 해제하지 않는다.

완료 캐시의 조회·새 publication은 전체 과거 project의 존재와 분리한다. 재사용은 현재 lease, 정확한 key/owner marker, 완료 lifecycle과 전체 출력 해시를 요구한다. 과거 catalog 부재는 기존 키 교체와 삭제를 계속 차단한다. 정상 사본 퇴역은 owner 측 잔존 소비, 원래 catalog, 설치·복구 및 producer 종료를 검사한 기존 `retire` 절차를 거쳐 등록을 해제한 뒤 수행한다. 캐시 handle 종료와 사본 퇴역은 별개이며, 사본 삭제로 소비 참조를 해제하지 않는다.

WindowControl의 기본 target도 같은 장기 owner 아래 `artifacts/cache/window-control-native/target`을 사용한다. 별도 target lease와 정식 lifecycle이 컴파일·child-session helper 생성·release 복사 전체를 보호한다. 소스·도구·실행 파일 hash의 기존 재사용 검사를 유지하며, 이전 pending/failed 결과는 receipt hit로 승격하지 않고 재생성한다. 명시적 `WindowControlTargetDirectory`는 기존 선택을 보존한다. 이 Windows 전용 빌드 경로 변경은 Linux/macOS native 지원 변경을 의미하지 않는다.

Windows 모듈 캐시의 NUL 손상 owner marker 복구는 일반 정리와 구분한 명시적 경로다. 기존 cache lease와 단일 root 생성 소유권, stopped/unknown/null 결과, 검증된 `cleanup_recovery`와 완전한 membership, 정확한 현재 revision 및 손상 marker SHA를 모두 요구한다. marker는 링크가 아닌 단일 hardlink의 1..64KiB 전부 NUL인 파일이어야 하며, 유효한 marker·다른 손상·임의 legacy 항목을 이 경로로 처리하지 않는다. marker를 복원하거나 unknown을 성공으로 바꾸지 않고 같은 정리 owner의 최신 소비 참조·설치·프로세스·경계 검사와 native 검토/예약/일반 삭제/finalize를 유지한다. root/revision/marker 증거는 실제 삭제 직전 검사에서도 다시 확인한다. 이 복구는 동결된 앱 입력을 수정하는 기능이 아닌 독립적인 운영 도구이며 수용 범위는 해당 Windows 회귀로 확인한다.

외부 정리 owner의 producer 예약도 등록 그룹의 정리 검토와 같은 복구 의미를 유지한다. `producer_records`가 선택한 원본 기록의 전체 독립 recovery proof를 검증하고 현재 snapshot과 정확히 일치함을 확인한 뒤에만 검증된 `cleanup_recovery`의 예약을 허용한다. 필드 존재만으로 검증을 대체하거나 일반 unknown/pending 항목을 예약하지 않는다. 완전한 membership, 소비 참조, 정확한 생성 구성과 durable 예약 fence는 그대로 적용한다.

모듈 입력 fingerprint와 출력 검증은 한 번의 관리 코드 배치에서 파일을 열거하고 SHA256을 계산한다. 파일 읽기와 해시 계산은 최대 4개 작업으로 제한해 병렬 처리하며, 결과는 열거 단계에서 확보한 원래 행에 기록한다. 키의 입력 순서·상대 경로·정렬·직렬화 의미와 전체 출력 해시는 유지한다. 입력 manifest를 같은 스캔에서 만들며 도구 값은 해시 identity로 남긴다. 기록의 `missReason`·`phaseMetrics`는 관찰 정보이고 성공 receipt나 삭제 근거를 대신하지 않는다. 해시 처리 중 파일 변경과 경계의 링크를 검사하며, 실제 캐시 선택·publication·정리는 기존 lease와 소비자 보호를 유지한다.

공유 Cargo entry는 호환성 identity와 물리 target lease 아래 stable source를 함께 소유할 수 있다. 불변 입력은 별도로 유지하고, 지원하는 imported source만 내용이 바뀐 파일을 갱신한다. 변경 전후 전체 source 검증이 실패하면 실제 Cargo exit와 별개로 결과를 실패 처리하고 성공 관찰 hook을 호출하지 않는다. 미종료 producer 보호와 명시적 복구 정책은 동일하다. 지원 범위와 fallback은 [빌드 playbook](../playbooks/build.md#inputs-and-caches-for-repeated-builds-and-verification)이 소유하며 실제 Windows 회귀와 다른 플랫폼의 수용을 구분한다.

Status: `current` for the script-level cache/log integration verified on Windows x64; full product builds, installation and other-platform execution remain separate acceptance scopes.

재생성 범위는 기능 이름의 추측 목록 대신 실제 입력 바이트, 모듈별 생성 recipe, 도구·플랫폼 identity로 결정한다. companion과 providers는 서로 다른 recipe를 키에 포함하며 공통 cache/command helper 변경은 양쪽 키에 반영한다. Cargo 중간 컴파일은 Cargo의 dependency fingerprint를 사용하고, 완성 엔진 번들 재사용은 전체 source provenance와 bundle hash 일치를 요구한다. asset 및 검사 결과는 기존 파일/검사별 owner의 키와 lease를 유지한다.

모듈 생성의 원시 로그는 해당 content-key의 `logs/`에 기록한다. 캐시 payload와 로그는 한 producer lifecycle 구성원이다. 새 키를 선택하면 같은 모듈의 사용이 끝난 이전 키를 기존 cache owner의 guard와 명시한 보존 수 아래 정리하며, 새 출력의 검증·publication 성공까지 기다리지 않는다. 새 생성이 실패해도 이전 키를 fallback으로 보존하지 않는다. 선택 키·실제 설치·다른 소비자·실행 중인 캐시는 계속 보호하고 다음 빌드는 수정한 입력에 해당하는 키를 사용한다. 캐시 hit에서도 이전 미사용 키를 정리하며 생성 명령은 다시 실행하지 않는다. build metrics에는 사용한 키와 결과를 기록한다. 버전의 acceptance evidence는 raw module log의 영구 참조에 의존하지 않는다.

준비·검사 도구(TypeScript/vsce)는 재생성 가능한 빌드 입력이며 설치 이력의 `preparation-inputs.toolDirectory`나 `build-info.moduleBuild.typeScriptPath`만으로 캐시를 계속 보호하지 않는다. 설치·직전 복구의 실제 package/release 경로, 명시적 consumer 참조, 선택 키, 실행 프로세스와 cache lease 보호는 유지한다. 준비는 실제 공유 도구의 물리 cache root에 읽기 lease를 잡는다. 완료 checkpoint의 VSIX·준비 영수증을 재검증한 뒤 정확한 release 소유자·경로와 tool key가 일치하는 `dependency/companion-tool` 참조만 기존 revision·증거 기반 release API로 해제한다. 실패·미완료 준비, 다른 key와 installation/recovery/evidence 참조는 그대로 남긴다. 준비가 끝난 뒤 새 검사에는 현재 검증 도구를 다시 준비한다. 최종 설치 호스트 수용은 TypeScript나 전체 namespace 소스 회귀를 다시 요구하지 않는다. 공유 cache owner는 등록된 모든 project의 producer registry를 검사하며, 어느 하나의 활성·잔존 소비 참조나 조회 불확실성도 삭제를 차단한다. 복사되어 독립적으로 읽을 수 있는 provider payload는 캐시의 영구 소비자로 취급하지 않는다. 실제 설치·복구 의존성의 해제는 그 소비자의 기존 owner 절차를 따른다. 구현·회귀 연결은 `tool.project-maintenance`와 `engine.shared-engine.host`가 소유한다.

선택형 host 수용의 fixture 정리도 실제 선택 단계·정수 종료·boolean mode 증거를 확인한다. 기존 6단계 영수증은 이전 형식의 완료 근거로만 읽는다. 배포가 이미 소유한 보고서·compact evidence를 쓰는 경우 cleaner의 `ReportLifecycleId`는 정확한 azrael-release version과 두 출력의 member 포함을 검사하고 그 소유를 재사용한다. 부모 상태를 변경하거나 후보 소유를 추가하지 않는다. 독립 정리는 기존 별도 cleanup owner를 사용하며 보고서·근거는 삭제 후보 밖에 둔다.

과거 출력과 lifecycle catalog가 함께 사라진 등록은 기본 `inspect`/`retire` 경로에서 계속 차단한다. 등록된 프로젝트 경로 자체가 없는 경우에도 목록을 읽을 수 있지만, 실제 캐시 회수는 모든 소비 프로젝트의 존재 확인을 유지한다. 부재 등록의 명시적 `retire-legacy`는 schema 3의 원래 전체 소비 목록·해제 증거·정리 권한과 현재 registry 해시를 요구한다. 부재만으로 안전을 추론하지 않는다. 명시적 `inspect-legacy`/`retire-legacy` 경로는 등록된 project의 모든 `artifacts`와 별도 생성 출력의 부재, 실행·설치·복구 소비 해제 및 사용자 정리 권한을 검증한 뒤 등록만 해제한다. project·registry identity, 외부 증거와 권한 기록의 SHA256을 lease 아래 다시 확인한다. 원래 소비 목록은 `unavailable`, 실행 결과는 미확인 상태로 남긴다. 빈 catalog를 만들어 대체하거나 이 동작에서 source·payload·cache를 삭제하지 않는다. 이후 cache 삭제에는 기존 실제 소비자 검사와 별도 삭제 결정이 필요하다. 구현 owner와 필수 검사는 feature inventory의 `tool.project-maintenance`에 연결한다. 이 경로와 기존 모듈 캐시 회귀 검사는 CR-01에서 Windows x64 PowerShell 7.6.7로 통과했다. 다른 OS와 제품 빌드 검증은 별도 범위다.

검토된 이전 버전 정리에서 module cache 정리를 함께 선택하면, 기존 설치·직전 복구·실행·shortcut 보호 아래 버전 payload와 그 원시 로그를 먼저 정리하고, 이어 cache owner의 lease 아래 더 이상 소비자가 없는 모듈 key와 그 로그를 정리한다. 성공·시간 경과만으로 버전 삭제를 선택하지 않는다. legacy 미등록 cache는 소유·소비 근거를 확인하기 전 보존한다. 모듈 정리는 산출물을 먼저 삭제하고 로그, cache/owner receipt, 빈 root 순서로 진행한다. 산출물 삭제가 실패하면 로그와 소유 기록을 남기고, 로그 삭제가 실패하면 소유 기록을 남겨 재시도할 수 있게 한다. 부분 실패는 실제 잔여와 미시도 로그를 기록하며 전체 완료로 보고하지 않는다.

Cargo 검증 호출자는 선택적으로 `AZRAEL_CARGO_CACHE_SCOPE`를 지정하여 기본 캐시와 분리된 재사용 entry를 선택한다. scope는 소문자 영숫자·하이픈 1..64자이며 호환성 identity에 포함한다. scope가 없는 기존 key/경로는 보존한다. scoped entry는 Windows 도구의 경로 길이를 줄이도록 `artifacts/cargo/<key 앞 32자리>`에 두되 전체 key와 identity marker로 충돌·변경을 거부한다. 각 Cargo 실행은 기존 generation CAS와 물리 target lease를 유지한다. 이미지 검증의 `--private-target`은 고정 scope와 debug=0 설정을 선택하고, 필터 사이에도 실행 참조로 캐시를 보호한다. 이전 run 소유 target 전체 복사·해시를 통한 seed는 하지 않는다. 캐시 재사용은 테스트 통과 증거가 아니며 불변 입력 검사와 실제 테스트 실행은 그대로 수행한다. 구현·필수 source 검사는 기존 `engine.shared-engine.fixture-guards`의 Cargo owner/cache/verification 연결을 따른다.

### 생성물 소유와 삭제 검토

신규 배포 manifest의 상세 분할 저장과 인증된 복원은 [배포 manifest 계약](upstream-preservation.md#deployment-manifest-details)을 따른다. 분할 파일은 원본 manifest와 같은 reports 소유 경계에 두며 원본 보고서 member를 보호하는 재사용 참조가 함께 보호한다. 분할 목록만 독립적으로 제거하거나 실행 중인 이전 manifest를 재작성하지 않는다.

생성물의 기본 소유 단위는 작업/실행, 버전, 공유 캐시다. 각 파일은 한 소유 단위에 속하며 다른 작업의 사용은 명시적 소비 참조로 표현한다. 신규 프로젝트와 단계적 이전의 기본 구조는 `artifacts/tasks/<work-id>/runs/<run-id>/{inputs,temporary,outputs,logs,reports}`, `artifacts/versions/<product-version+unique-build-id>/{payload,verification}`, `artifacts/shared/<cache-kind>/<content-key>`다. 동일 제품 버전도 빌드 ID로 구별한다. 원시 로그는 생성 실행에 두고, 보존할 버전에 필요한 검증 근거만 독립적으로 읽을 수 있게 버전 소유로 승격하고 참조를 전환한다. [수명주기와 마이그레이션 playbook](../playbooks/artifact-lifecycle.md)이 도입 절차를 소유한다.

Windows 배포의 신규 입력 준비는 `deployment-workspace.cjs`가 기존 capture/snapshot과 독립 Git 메타데이터를 재사용한다. `artifacts/inputs/<id>`의 불변 입력은 별도 그룹이며 실행은 이를 참조한다. `artifacts/workspaces/<id>`는 컨테이너이고 소스 최상위 항목과 `control/`만 작업 그룹이 소유한다. 하위 `artifacts/`의 버전·캐시·검증 산출물은 각 생성자가 소유한다. 컴파일 전후에 불변 전체 inventory와 두 소스 snapshot을 비교한다. 패키지는 선택적인 `RetainedSourceRoot`를 받아 빌드 영수증과 보존 소스를 복사 전후에 검증하고, 최종 `build-info.engineSourceRoot`에 보존 경로를 기록한다. 컴파일과 native 검사는 가변 작업 사본을 사용하며 preflight와 최종 검사 입력 경로를 동일하게 유지한다. Windows의 루트 `.git` gitfile은 내용과 물리 위치를 검증하는 보호된 제어 근거로 남기며 컨테이너 전체 삭제를 주장하지 않는다. 엔진은 출처 영수증이 있는 imported snapshot만 지원하고, 모호한 Git 엔진 입력은 거절한다.

읽기 전용 후속 소비자는 명시적 원본 manifest hash/project fingerprint로 성공한 불변 입력을 재검증하고 `reuseDeploymentInputs`의 실행 참조로 연결한다. 원래 작업 사본은 필요하지 않으며 payload/Git 복사는 하지 않는다. 입력과 원본 manifest의 실제 소유 member를 함께 보호하고, 변조·이동·신원 교체·미완료 소유·정리 예약이 있으면 재사용을 거절한다. `packaging-workspace.cjs`는 이 전체 audit를 참조해 패키징 script/license/verifier 의존 파일만 실행별로 고정한다. 정확한 override에는 별도 packaging identity를 부여하며 전체 engine 소스의 동등성을 임의 축소하지 않는다. compact 그룹의 dependency와 각 소비자의 execution 참조는 구분하며, 소비 종료 뒤 필요가 끝난 dependency는 소유자의 명시적 release 절차로 해제한다. 실제 수용 상태와 측정 한계는 [현재 작업](../../work/EC-01-unused-file-archive/04-plan.md)이 소유한다.

서로 다른 project root의 lifecycle catalog 사이에는 들어오는 참조가 자동 전파되지 않으며 build-info 경로도 의존 참조를 생성하지 않는다. 호출자는 작업 소스와 실행 참조를 해제하기 전에 입력 소유자와 같은 catalog의 보존 소비자에 dependency 또는 installation 참조를 지원 API로 등록한다. 기존 run을 인계 소비자로 사용하면 그 run의 검증 근거도 참조가 유지되는 동안 보존한다. 소비자를 옮길 때는 새 참조를 먼저 등록하고 실제 버전·설치 인계를 검증한 뒤 기존 참조를 명시적으로 해제한다.

기존 producer의 경로를 당장 옮길 수 없는 경우 `scripts/artifact-lifecycle.cjs`와 PowerShell 어댑터가 같은 수명의 payload·입력·로그·보고서·패키지·배포 근거를 하나의 producer record에 연결한다. 실행 전 예상 경로를 pending/incomplete로 기록하고 실제 종료 뒤 결과와 구성원을 조정한다. 실패·중단·미확인 결과는 자동 삭제되지 않는다. 이 어댑터는 프로젝트의 기존 Node 실행 환경을 재사용하는 출처 연결 계층이며 내장 Rust 관리 도구를 대체하는 상주 서비스가 아니다.

단독 검사·renderer·검토 자료 writer는 `scripts/artifact-run.cjs`로 생성 전에 고유 run을 등록한다. 실제 부모 exit와 추적한 모든 child의 close를 확인한 뒤 complete/failed를 기록하고, 미확인 종료는 pending으로 둔다. `reports/producer.json`을 먼저 쓴 뒤 terminal metadata를 기록하므로 보고서 쓰기 실패를 성공으로 남기지 않는다. 안전한 명시 출력도 같은 소유에 포함하고 기존 목적지·다른 소유·링크·경로 탈출 충돌은 쓰기 전에 거절한다. deploy의 accounts/independent 검사는 명시한 pending 부모의 실제 경로 포함을 확인한 후 그 소유를 재사용하며 부모 상태를 변경하지 않는다. Windows 브라우저 종료 검사는 기본 Windows PowerShell의 절대 경로를 사용한다. PATH의 `pwsh` 가용성을 종료 증거로 가정하지 않는다.

단독 packaging의 입력은 실제 version 소유자에 연결한다. 미등록 legacy 입력은 검증 과정에서 실제로 읽는 선언 파일만 retained/incomplete 입력 소유로 귀속하고 참조한다. 혼합 release 부모 전체를 생성물로 만들거나 기존 pending/failed/retained 입력을 성공으로 승격하지 않는다. instruction release의 기본 CLI 출력도 고유 run을 쓰며 명시한 외부 API 출력은 호출자의 소유 계약을 유지한다.

과거 경로의 관리 범위는 producer/native/cache owner와 소스·사용자·고정 입력 계약을 함께 대조한다. 출처 미확정 경로는 원래 생성자를 추정하지 않고 보관 책임, 근거, 다음 발견 조건을 기록한다. Node member의 `generated:false`는 이 불확실성을 보존하며 cleanup 계획을 차단한다. 중첩 member를 부모로 투영해도 자식의 불확실성을 유지하고, 일반 업데이트로 이를 true로 승격할 수 없다. 정리 명령의 관찰 대상은 그 명령이 생성한 출력이 아니다. 정리 명령은 자신의 보고서만 소유하고 다른 묶음의 자료 사용은 소비 참조로 표현한다. 서로 다른 native/producer ID가 동일 생성 소유자의 같은 자료를 가리키는 경우 mapping에 별칭을 명시한다. 현 프로젝트의 경계·별칭·보호 및 미확정 목록은 [현재 adoption map](../../work/BI-01-project-maintenance/05-adoption-map.json)에 있다.

명시적 보관 이관은 일반 승격과 별개다. `transferCustody`는 생성 근거가 확인된 `artifacts/logs/` 아래의 정확한 legacy-custody 경계만 새 소유 그룹으로 넘긴다. 사용자 승인, 보관 owner와 revision, 경로별 생성/사용 확인 및 삭제 경계 밖의 증거 파일 SHA-256을 요구한다. 다른 소유·소비 참조, 경계 밖 경로·링크·부분 부모 선택과 미확정 증거는 이관을 차단한다. 보관 기록 전체나 원본·백업의 불확실성을 자동 해제하지 않는다. 원래 member와 상태/실행 결과는 source의 이관 영수증에 보존하며, 새 소유 그룹의 완료는 소유 확인의 완료이지 과거 테스트의 성공이 아니다.

보관 이관 writer는 catalog 잠금 아래 새 target을 pending/incomplete로 기록하고, source에서 선택한 claim만 이관한 뒤 target을 확정한다. 중단 시 미완료 target과 겹친 claim이 보호를 유지한다. 동일 증거·요청의 재개만 허용하며, 이미 정리된 target을 재생성하지 않는다. 이관 자체는 파일을 이동하거나 삭제하지 않는다. 이후 native 등록·fresh review·명시적 apply와 실제 부재 확인을 거친다. 일반 `record`의 protected member 승격 금지는 유지한다. 이 기능의 owner는 기존 `tool.project-maintenance.lifecycle-source`이며 공통 Node 의미를 갖고 실제 검증 범위는 작업 기록에 둔다.

과거 보관 범위의 컨테이너에 새 생성물이 추가되어 충돌하면 `refineCustody`로 확인된 직접 자식만 분리한다. 정확한 기존 owner/revision과 외부 생성·종료·소비 해제 증거를 요구하며, retained/incomplete 상태의 `legacy-custody` 또는 `legacy-input` claim에만 적용한다. 상위 claim은 선택하지 않은 현재 직접 자식의 같은 미확정 보호로 바꾼다. 다른 member·상태·생성 여부는 바꾸지 않는다. 하나 이상의 미선택 자식이 남아야 하며 다른 소유·링크·변경된 parent/child identity·구성은 차단한다. 기존 source의 소비 참조가 있으면 모든 consumer의 정확한 owner/revision/reference identity와 선택 경로를 읽지 않는다는 외부 증거를 고정해야 한다. consumer 기록과 참조는 그대로 유지하며, 확인되지 않은 소비자와 target의 소비 참조는 차단한다. 새 target pending → 각 source의 분리 영수증 → target complete 순서로 쓰며 같은 요청만 재개한다. 일반 writer의 분리 경로 재주장을 막고, 삭제된 target은 되살리지 않는다. 이 절차도 파일을 이동·삭제하지 않으며 기존 lifecycle-source 검사와 native 등록·검토·삭제 경계를 유지한다.

물리 묶음 이관은 별도 `relocateCustody` writer가 담당한다. 같은 생성/소유/참조 증거와 신규 `destination_root`를 요구하며, 같은 볼륨의 정확한 로그 경계만 ordinary rename으로 새 전용 폴더에 모은다. 새 폴더 생성 전에 pending intent와 원래 경계별 파일시스템 식별자·mapping을 기록한다. 이동 전후 식별자를 확인하고 모든 이동이 확정될 때까지 원래 custody claim을 유지한다. 중간 실패는 source와 pending target의 보호를 유지하며, 양쪽 경로가 모두 있거나 없거나 identity가 바뀐 재개는 거절한다. 폴더 생성 후 identity 기록 이전의 중단은 자동 인수 근거가 없어 명시적 복구 증거를 요구한다. 이동은 삭제 성공이 아니며 새 단일 경계의 native 등록·검토·삭제를 별도로 수행한다. 적용 전 작은 inactive copy pilot과 reader/내용/권한 확인은 기존 lifecycle playbook을 따른다.

완료된 BL-01/AO-01 자료의 시험 이전은 task/run별 logs·reports·outputs에 배치하고 원본 해시와 reader 참조를 검증한다. AO Chromium 검증 writer는 기본 고유 실행 ID와 선택한 안전한 `--run-id`를 사용하며 `--describe-paths`는 생성 전 경로만 조회한다. 쓰기 전 pending/incomplete를 등록하고 충돌을 거부한다. fixture·프로필은 같은 run의 temporary, 로그·보고서·이미지는 해당 하위 경로에 두며 브라우저 종료와 프로세스 참조를 확인한 뒤 실제 결과를 기록한다. 통과한 run도 fixture를 자동 삭제하지 않고 전체 run의 모델 삭제/보류를 기다린다.

임시 deploy/account fixture는 retained version payload와 다른 run 소유다. 모든 producer의 종료와 필요한 검증 근거의 승격을 확인한 뒤 기존 성공 fixture 정리를 수행한다. 실패·미확인 fixture는 실패 상태로 보호한다. 설치 버전을 보존한다는 이유로 임시 프로필·패키지 복사본을 무기한 유지하지 않는다. legacy 정리도 삭제 직전 각 구성원의 최신 group 정의와 소비 참조를 다시 확인하고 변경되면 나머지 시도를 멈춘다.

내장 등록은 `group`의 ID, 종류(`work`, `run`, `version`), 소유자, 버전, 구성 완결 여부, 출처와 실제 항목을 원자적으로 저장한다. 중첩된 producer 경로는 서로 겹치지 않는 소유 루트로 투영한다. 등록된 live 구성원을 조용히 빠뜨리거나 다른 묶음으로 옮길 수 없다. producer record의 작은 제어 파일/디렉터리를 `membership_source`로 지정하면 구성원과 외부 소비자 변경까지 검토·적용 시 재확인한다. 기본 형식은 전체 경로 identity를 사용한다. Node 연결의 `membership_source_format:"producer_registry_v1"`은 목록의 JSON을 검증하되 해당 소유 기록과 들어오는 소비 참조만 identity에 반영한다. 관련 없는 정상 기록의 추가·변경으로 다른 작업을 무효화하지 않는다. 개별 JSON 기록의 부재·읽기 실패·잘못된 JSON 또는 정적 형식 오류는 해당 기록을 제외하며, 확인하지 못한 소비 참조만을 이유로 전체 삭제를 차단하지 않는다. 삭제 대상 자신의 유효한 소유 기록은 필수이며, 소유·버전·구성 범위·완결성 불일치와 정상 기록의 새 소비 참조는 계속 차단한다. catalog 루트·목록·잠금의 확인 실패, 중복 ID와 유효 기록의 관측 중 내용 변경도 차단한다. 이 누락 허용 정책은 native 관측에 적용하며 Node writer의 등록·소유 이관 검증은 유지한다. 이 형식은 Node에서 참조를 투영한 이후 새 소비자가 생기는 경우도 직접 보호한다. 해당 제어 근거와 상위 경로는 삭제 대상으로 삼지 않는다.

producer catalog의 JSON 파싱과 정적 계약은 요청 안에서 재사용할 수 있다. 재사용은 선택한 루트·기록 경로와 새로 읽은 전체 바이트가 같은 경우에만 허용하며, 매 관측의 목록·잠금·유효 기록의 전후 읽기는 반복한다. 잠금 반환은 파일시스템 snapshot을 무효화하며, 새 바이트 비교가 필요한 파싱 결과는 요청 안에 남길 수 있다. 검증된 snapshot은 불변 공유하고 그 기록에서 owner 및 들어오는 consumer의 역참조 색인을 도출한다. 관련 기록은 기존 전체 순회와 같은 ID 정렬·중복 제거·canonical 직렬화로 비교하므로 fence와 토큰 의미는 바뀌지 않는다. 색인은 디스크의 변경 감지 근거가 아니며 새 관측에 필요한 전체 바이트 읽기를 생략하지 않는다. 각 기록의 전후 경로 검사에서 얻은 metadata를 해당 검사 안에서 사용하고 별도 같은 경로 재조회만 제거한다. 조상·권한·링크 검사는 그대로 수행하며 metadata를 다음 읽기에 재사용하지 않는다. 하나의 예약 fence와 정확한 owner는 같은 catalog 관측에서 함께 도출한다. 실제 member 경로·권한 검사는 선택한 owner에 한정하며, 다른 producer의 산출물 경로는 검사하지 않는다. 정상 consumer의 참조 검사는 산출물 접근 가능 여부와 무관하게 유지한다. 파일시스템 증거나 consumer 관측은 cache하지 않고, 바뀐 기록과 신규 consumer는 기존 두 관측의 비교로 차단한다.

등록 후 사라진 구성원은 최신 관측에서 이미 없음으로 표시하며 묶음의 레거시 판단이나 나머지 구성원의 검토를 실패시키지 않는다. 경로·조상과 읽기 권한 검사를 통과한 실제 부재만 인정하고, 권한 거부·조회 오류는 확인 불가로 보호한다. 처음부터 존재하지 않은 신규 구성원은 등록하지 않는다. 갱신에서 빠진 기존 부재 구성원의 이력은 같은 묶음에 유지하며 새 검토와 명시적 결정으로 정리한다. 이미 없는 항목은 파일 삭제를 시도하지 않고 실제 부재와 결과를 기록한다. 재등장·내용·보호 상태 변경은 기존 토큰 검증을 적용하고 새 검토가 필요하다. 부재 관측만으로 pending 실행·참조·복구 보호를 해제하거나 실제 삭제를 수행했다고 보고하지 않는다. 이전 미해결 의도는 차단·보류 결정으로 해제하지 않는다. 이번 적용에서 새로 기록한 의도 이후 삭제 전 권한 검사가 거부된 경우는 파일 보존을 확인한 차단 결과로 남긴다.

하나의 구성원을 검토해도 전체 live 묶음으로 확장한다. 구성원마다 같은 삭제 또는 보류 결정을 제출해야 하며, 어느 하나의 보호·참조·불확실성도 전체 묶음에 적용한다. 삭제 전 전체 구성원을 재확인하고 payload부터 시도하며 로그·근거는 뒤에 둔다. 항목별 적용은 전체 구성원의 최신 근거·공통 토큰·보호 판정을 유지하면서 소비할 한 항목의 응답만 구성할 수 있다. 실패하면 해당 묶음의 나머지 시도를 중단하고 미시도 근거를 보존한다. 부분 삭제 상태와 실제 잔여를 남겨 재검토한다. 독립된 다른 묶음의 상태를 성공이나 실패로 바꾸지 않는다.

producer registry는 `artifacts/maintenance/lifecycles/`에 둔다. 구성원 전체의 실제 부재와 들어오는 소비 참조의 해제를 확인한 뒤 해당 record만 정리한다. 파일 본체를 지운 뒤 무한한 빈 버전 목록이나 원시 로그 보관소를 남기지 않는다. Rust의 결정·복구 상태는 별도로 보호하며 근거 없는 축약이나 잠금 제거를 하지 않는다. 기존 미등록 항목은 목록과 근거를 보완하기 전 destructive legacy cleanup을 차단한다. 공유 엔진 캐시는 기존 cache owner의 사용·잠금 보호 절차를 유지한다.

실패·미확인 producer를 성공으로 바꿔 빈 기록을 없애지 않는다. Node `finalize(root,id,retirement)`는 명시적으로 검증한 producer 전체 종료, 이유와 삭제 범위 밖의 읽을 수 있는 `evidence_ref`를 받을 수 있다. 실제 구성원이 전부 없고 들어오는 참조도 없을 때만 원래 상태·증거 SHA를 반환하며 해당 기록을 축약한다. 증거 없는 기본 finalize는 기존 complete/완결 조건을 유지한다. 이 절차는 native 실행의 unknown 결과나 exit를 바꾸는 recover가 아니다.

정리는 `등록 → 실행/사용 → 검토 → 삭제 또는 보류 → 실제 결과 확인`을 따른다. 모델은 항목 ID, 검토 토큰, 결정, 이유를 제출한다. 보류에는 다음 검토 조건을 남긴다. 기간 만료나 용량 초과, 테스트 통과만으로 삭제하지 않는다.

등록된 묶음의 기본 운영 근거는 관리 도구의 현재 기록과 검토 결과다. 모델은 범위와 삭제·보류를 결정하고 도구가 구현한 검사를 별도 셸 스캔으로 반복하지 않는다. 변경된 내용·구성·참조는 생산자가 지원되는 동작으로 갱신하고 새 검토를 받으며, 변경되지 않은 묶음은 재등록하지 않는다. 직접 조사는 미등록 경로·충돌·도구의 불확실성·확인 범위 밖의 구체적 공백으로 제한한다. 최초 편입 조사는 정상적인 그룹 정리 때 반복하지 않는다. 실제 [운영 흐름](../ops/project-maintenance.md#registered-group-cleanup)을 따른다.

묶음 검토·적용은 기본 `verification:"registered"`로 등록된 내용 identity·크기·측정 시각을 재사용한다. 새 관측은 구성원 루트의 물리 identity·종류·존재 여부, 현재 소유·보호·참조·실행·구성 및 외부 membership 제어 근거를 검사한다. payload 내용 재해시는 수행하지 않는다. 같은 소유 루트 안에서 생산자가 신고하지 않은 내용 변경은 감지하지 않는 계약이다. 내용 재측정이 필요한 경우 검토와 적용 모두 `verification:"full"`을 명시한다. 단독 항목은 기존 전체 검증을 유지한다. 확인 불가를 전체 스캔으로 자동 대체하지 않는다. 백업의 복구 근거도 등록 모드에서 숨은 payload 재측정을 일으키지 않으며 충분한 기존 영수증이 없으면 전체 검증을 요구하며 차단한다.

검토 토큰은 검증 모드·해당 관측·설정·관련 실행과 보호 참조에 묶인다. 검토 이후 이 근거가 바뀌면 이전 결정은 적용하지 않는다. 삭제 전 전체 묶음을 검증하고, 각 대상의 쓰기 권한 확인 후 의도 기록 전후에 각각 새 관측을 원래 모델 토큰과 비교한다. 등록 모드는 대상별 삭제 경로를 한 번 열거하고 의도 기록 후 같은 경로의 쓰기 권한을 다시 확인한다. 실제 삭제 시의 경로·링크·잔여 검사는 유지한다. 프로젝트/관리 루트 자체, `.git`, 사용자 상태, 경로 탈출, symlink/junction/reparse 우회와 다른 작업의 잠금 제거를 금지한다. 재귀 삭제는 모든 하위 경로에 대한 접근 권한을 확인한다.

전체 검증 모드의 한 관리 호출 안에서 Unix는 device/inode/ctime 등 같은 파일 버전의 내용 SHA를 재사용한다. 각 관측의 경로 열거·권한 콜백·보호 조건·구성원 검사는 그대로 수행한다. Windows의 USN은 열린 핸들이 있는 동안 쓰기 기록이 합쳐질 수 있어 덮어쓰기마다 달라진다는 보장이 없다. 따라서 Windows 전체 검증은 내용 SHA 캐시를 재사용하지 않고 다시 읽는다. 등록 모드는 이 캐시와 무관하게 payload 내용을 읽지 않는다. 내용 캐시는 호출 종료 시 버리고 다음 호출에는 새로 측정한다. 수정 시각만으로 재사용하거나 전체 검토 결과를 캐시하지 않는다.

모델이 삭제를 선택한 확인된 생성물에 한해 ReadOnly·Hidden 속성을 해제한 뒤 일반 삭제할 수 있다. 생성 이력·소유권·원본과의 구분 및 사용/보호 상태가 확인되어야 한다. 원본·사용자 파일의 속성, System 속성, ACL과 소유자는 변경하지 않는다. 강제 삭제나 실패 후 다른 API로의 우회는 없다. Windows는 한 PowerShell 실행에서 정확한 절대 경로에 `Remove-Item -LiteralPath`를 사용한다. 긴 경로도 같은 cmdlet 경계의 확장 literal 경로로 처리하며 승인 경로와 열거 결과를 동일하게 비교한다. 속성 audit는 실제 바뀐 항목의 원래 승인 경로와 전후 값만 남긴다. 프로젝트의 기본 `artifact-lifecycle.ps1` 정리 경로에도 같은 원칙을 적용한다. 생성 묶음의 숨김 `.git` 디렉터리와 읽기 전용 하위 파일을 포함한다. 잔여 조회가 실패하면 부재로 단정하지 않는다.

Windows 소유 정리 경로의 하드링크·테스트 junction 확장은 `scripts/artifact-lifecycle.ps1`의 현재 구현이다. Windows x64/PowerShell 7.4.21 로컬 회귀로 확인했으며, 설치된 native 유지보수 엔진의 기능 확장을 뜻하지 않는다. 속성 변경이 필요한 하드링크는 모든 연결 이름·파일 identity·연결 수를 확인하고, 모든 연결이 같은 삭제 묶음의 확인된 생성 구성원 안에 있을 때만 정규화한다. 외부 연결이나 조회 불확실성은 변경 전에 전체 묶음을 차단한다. 전체 구성원을 사전 확인하고 속성 변경 직전에도 연결과 identity를 재확인한다. 정확한 링크 경로와 대상이 별도로 검증된 테스트 junction만 명시적으로 허용한다. 구성원 루트·상위 reparse 및 그 밖의 링크는 거부한다. 허용된 junction은 대상을 순회하거나 속성을 변경하지 않고 링크 자체만 일반 삭제한다. 재지정·종류 변경·확인 실패는 중단한다. 경로 확인과 변경을 원자적으로 잠그는 기능은 없으므로 작업 중 입력을 고정해야 한다.

결과는 항목별 삭제·보류·차단·실패·불확실 상태, 속성 변경 전후와 실제 잔여를 기록한다. 요청 묶음의 모든 ID와 결정을 변경 전에 검사하고, 파괴적 시도 전 의도와 이후 결과를 항목별로 영속 기록한다. 중단 시 확인되지 않은 결과는 pending/unknown으로 남기며 실제 잔여를 다시 확인한다. 등록된 하위 항목이나 원본의 보호도 상위 폴더 삭제에 적용한다. 일부 삭제나 조회 완료를 전체 정리 완료로 표시하지 않는다. 재시도는 남은 항목의 identity와 보호 상태를 다시 확인한다.

Windows 내부 정션의 독립 폐기는 `artifact-lifecycle.ps1`의 `Remove-ArtifactInternalJunction`이 소유한다. 기존 cleanup 권한과 maintenance/catalog custody 아래 같은 작업의 물리 경계·정지 상태·참조 해제·링크/대상 identity·mount-point 종류를 확인한 후 비재귀 ordinary link-only 제거를 수행한다. System 속성을 변경하거나 일반 System 항목의 보호를 완화하지 않는다. 연결 대상을 통해 순회하지 않으며 물리 대상 경로의 전후 identity·속성·파일 해시를 비교한다(최대 4096항목·깊이32·64MiB). 이는 보존 확인의 한계이며 경합을 원자적으로 차단하는 OS handle 삭제를 주장하지 않는다. `test-clean-verification-artifacts.ps1`의 내부 정션 선택 검사는 대상 보존과 identity·범위·권한 거절을 유지하고, 기존 기본 검사에도 포함된다. 보존 항목 `tool.project-maintenance`가 두 구현·검사 파일을 이미 소유한다.

### 반복 검증과 관리 잠금

상태: `current` (Windows x64의 고정 구현 입력에서 release crate 177개 통과). `tool.project-maintenance`의 library 검사와 실제 standalone 경계가 이 최적화의 보존 범위이며, 설치 실행기의 교체와 다른 OS 실기 수용은 별도다. 검증 후 추가된 다른 작업의 primary 변경까지 수용한 결과는 아니다. 입력·실제 exit·성능 표본은 [삭제 최적화 검증 결과](../../work/EC-01-unused-file-archive/34-delete-opt-result.json)에 보존한다.

그룹의 순수 검토 구간에서는 각 구성원의 예약 파일·신원·권한·소유를 새로 검사하고, 구간 끝의 두 producer catalog 관측을 서로 비교하면서 저장된 source fence와도 비교한다. 같은 관측을 위해 구성원마다 전체 catalog를 반복 읽지 않는다. 이 경로는 최종 소스 관측이 있는 그룹 검토에만 적용하며, 단독 항목·등록 예약·다른 source binding은 기존 전체 검증을 유지한다. 관련 없는 레코드의 변화는 해당 그룹을 무효화하지 않지만 새 소비자·소유 변경·복구 근거 변경은 차단한다. payload metadata나 전체 검토 결과를 전역 캐시하지 않는다.

그룹의 반복 재검토는 순수 경로 관계 계획과 토큰 해시만 재사용한다. 관계 계획은 현재 root, 항목 map의 구성과 id/path/source_path, 그룹 map의 구성과 membership_source가 같을 때만 유지한다. 구성할 때 현재 경로를 한 번 정규화한 component prefix 색인에서 대상의 조상·후손만 조회하며, 기존 control 중복·항목 순서·자기 ID 제외·source/target 겹침 의미를 보존한다. 잘못된 경로나 구성이 있으면 원래 순회로 돌아가 최초 오류와 부분 관계를 유지한다. Windows/macOS의 보수적 대소문자 처리와 Unix 원래 경로 의미를 그대로 적용하며 파일 내용·metadata·권한을 이 색인에 저장하지 않는다. 참조·cleanup·run 보호는 현재 상태로 다시 판단한다. 토큰은 전체 item, verification, 최신 observation/measurement/recovery, config와 preference revision, retirement 정책과 매번 새로 읽은 증거 identity가 모두 같을 때만 재사용한다. runs 전체 값도 관측마다 비교하며 State.revision만으로 판단하지 않는다. 객체 순서와 숫자 표현을 포함한 원래 json!/hash 입력을 보존한다. 파일·권한·부재·source 및 소비자 관측 결과는 다음 재검토에 캐시하지 않는다. 구현 소유자는 review_relations.rs, review_reuse.rs와 lib.rs/groups.rs이며 [그룹 재검토 작업](../../work/FF-01-maintenance-contention-timing/05-plan.md)과 [경로 색인 작업](../../work/GI-01-deletion-catalog-vhdx/01-plan.md)이 각 검증·수용 상태를 기록한다.

의도 기록 전후의 검증 구간은 별개다. 쓰기 권한 callback 이후 전체 그룹의 현재 관측을 원래 토큰과 비교하고, 물리 삭제 직전의 예약·source fence 검사를 유지한다. 의도와 결과는 각각 내구성 있게 저장한다. Windows는 leaf부터 볼륨 루트까지의 fresh 조상 순회를 기존 컴파일된 helper에서 실행하며, 세 번의 트리 검사·정규화 사전검사·hardlink pin·junction 대상 검증과 일반 Remove-Item 경계를 유지한다. 한 worker 요청 안에서 루트와 조상 경로의 문자열만 재사용한다. 첫 순회는 각 최신 관측과 링크 callback 뒤에 다음 부모 문자열을 구성하고, 이후 순회도 같은 leaf→root 순서로 모든 metadata와 링크 callback을 새로 실행한다. 조상 metadata를 다음 항목이나 다음 검사 구간까지 캐시하지 않는다.

로컬 예약 확인은 바로 이어지는 예약 읽기에 직전 metadata를 전달해, I/O나 callback 사이 경계가 없는 중복 초기 순회 한 번을 합친다. 전달된 metadata는 그 읽기에만 소비하며 다음 멤버·다음 검증 구간에 저장하지 않는다. 읽기 직전 권한 확인·크기/파일 종류 제한, 두 번의 bounded 읽기 비교, 읽기 사이 fresh 경로 검사, 마지막 fresh identity·길이 비교와 예약 소유 검증을 유지한다. 일반 예약 읽기는 자체 초기 관측을 계속 수행한다. 수용 범위와 실제 검증 상태는 [현재 작업 기록](../../work/FF-01-maintenance-contention-timing/05-plan.md)이 소유한다.

register/apply 시작과 중단된 상태 트랜잭션의 재획득은 기존 OS 잠금 helper로 최대5초간 Busy 획득만 기다린다. 부분 획득한 잠금은 재시도 전에 해제하고, 성공 뒤 현재 상태와 정책을 새로 확인한다. 병합·저장·commit·삭제·복구 동작 자체를 재실행하거나 권한·손상·CAS 오류를 Busy로 바꾸지 않는다. 긴 payload 처리는 전역 상태 잠금 밖에서 계속 수행한다.

## 보호의 종료와 참조 해제

실행 결과와 생산자 종료, 구성 완결은 독립 사실이다. producer record의 `producer`는 종료 상태·성공/실패/미확인 결과·실제 exit code와 종료 근거 identity를 보존한다. 소유자가 정확한 revision과 읽을 수 있는 근거를 제출한 `closeLifecycle`은 확인된 종료와 구성 완결을 기록하고 명시한 `execution` 참조만 해제한다. 종료된 실패도 `failed`를 유지한 채 정리 검토가 가능하다. 미확인 종료와 남은 자식 작업은 보호하며 완료로 바꾸지 않는다. 새 run writer는 자신이 배타적으로 생성한 경로에만 generated/protection_known을 명시한다. 기존 미확정 자료를 종료했다는 이유로 소유 확인된 자료로 승격하지 않는다.

`recoverCleanup`은 종료를 독립적으로 검증했지만 원래 결과를 알 수 없는 producer의 정리 자격을 별도로 기록한다. 원래 pending 상태·producer·nullable exit·generation과 모든 참조를 유지하며, 구성 완결만 별도 근거로 확인한다. 정확한 owner/revision·원래 상태·구성원에 결합된 `cleanup_recovery`와 SHA 고정 JSON 및 별도의 살아남는 producer 증거가 필요하다. 명시적으로 generated/protection_known인 기존 구성원만 허용하며 새 소유권을 추정하지 않는다. 현재 소비자나 정리 예약이 있으면 복구와 재시도를 거부한다. Node와 native 관측은 증거 파일의 경계·identity·hash와 구성 결합을 다시 확인한다. 이후 새 소비자는 기존 native 참조 보호로 차단한다. 복구 기록은 실행 성공이나 캐시 재사용 자격을 만들지 않으며, 새 generation 시작을 허용하지 않는다. 실제 삭제에는 별도의 fresh native review와 명시적 결정이 계속 필요하다. 경과 시간과 PID 부재는 종료 근거를 대체하지 않는다.

참조의 종류는 `execution`, `installation`, `recovery`, `evidence`, `dependency`다. 종류 없는 기존 참조는 지속 의존성으로 남긴다. `member_paths`는 실제 투영 member 루트에 대한 선택 범위이고 생략하면 기존 전체 그룹 보호다. 선택적인 `target_revision`·`target_version`은 대상 binding을 고정한다. 이후 불일치나 member 소실은 참조를 무시하는 근거가 아니며 보호·차단으로 남는다. 묶음 전체의 동일 fate 규칙도 유지한다. `releaseReferences`는 소비자 소유자·revision·선택한 reference ID·이유와 근거 identity를 검증하여 지정한 참조만 해제한다. 설치 교체·복구 종료·증거 인계는 새 보호를 먼저 확립하고 기존 보호를 해제한다. 파일 보존과 일시 참조 해제를 분리하며 소비자 묶음을 삭제해야만 참조를 풀 수 있는 제약을 없앤다. 종료·해제는 같은 요청의 재시도를 구분하고 다른 근거·소유자·generation의 재시도를 거부한다. 공유 Cargo 출력의 재사용은 알려진 종료 뒤 명시적인 새 generation으로만 시작한다.

Cargo owner는 준비 시작, 마지막 단계 진행, spawn 호출 시도, 결과 관측 시각과 단계를 구분한다. Cargo 호출 전 실패 또는 실행 파일 부재처럼 미실행이 확인되면 자신의 target·pending·shared generation만 실패로 종료하고 Cargo exit code는 null로 보존한다. 공유 claim 이후 초기화·target 획득 실패도 이 경로에 포함한다. spawn 호출 뒤 일반 예외·signal·timeout은 PID 부재만으로 미실행으로 취급하지 않는다. 각 소유 기록의 종료 실패는 다른 소유 기록 종료와 별도로 보고하고 원래 실행 결과를 보존한다. 종료 증거는 세대별 불변 파일로 보존한다. 명시적인 경과 시간은 오래된 미종료 기록을 조사 목록으로 올리는 조건이며 삭제·복구 근거가 아니다. 읽기 전용 조사는 시각 누락·잘못된 시각·링크·조회 실패와 현재 소비자를 함께 드러내며, 삭제는 별도의 검증된 종료와 현재 정리 검토를 요구한다.

Node writer·참조 해제·finalize의 실제 JSON commit은 standalone native lease의 CAS 쓰기 경계가 소유한다. producer ledger는 소유권의 기준이며 producer-backed native inventory는 측정·결정의 파생 기록이다. PowerShell 정리도 같은 owner의 그룹 예약을 사용하며 물리 삭제 중에는 catalog 잠금을 반환한다. 결과를 payload 밖의 증거에 동기 저장하고 정확한 fence와 실제 잔여를 검증한 뒤 예약을 해제한다. 모든 member의 부재와 참조 해제 후 기존 finalize로 ledger를 축약한다. 비협조적인 직접 파일 변경을 잠금으로 막는다고 가정하지 않으며 기존 identity·내용·보호 재확인을 유지한다.

Node lease 호출은 원래 action 오류를 유지하고 후속 해제 오류를 `release_error`로 별도 연결한다. 일반 명령의 응답 예산은60초이며 producer 완료 요청은 잠금 획득 예산에60초를 더한다. 잠금 획득의 명시적0·기존 capability 경계와 구분한다. 응답 기한 전에는 같은 요청의 최종 응답을 기다리고 재전송하지 않는다. 기한 초과·transport 실패 후에는 stdin EOF로 종료를 요청하고10초간 배출한 뒤, 아직 종료되지 않은 해당 자식에 종료를 요청하고 최대5초간 실제 close를 관측한다. 정상 release도 최종 응답과 stdout 배출·실제 종료를 확인한 후 observer를 정리한다. 진단은 요청 operation/ID·native PID·실제 종료 관측 여부와 code/signal 및 늦은 응답 관측을 구분한다. 실제 child 종료 callback만 종료 관측을 확정하며 kill/worker 종료 요청은 결과가 확인되지 않으면 unknown으로 남긴다. 시간 초과 뒤 관측된 응답은 최초 오류를 성공으로 바꾸거나 자동 재실행하는 근거가 아니다. 이 동작은 권한·CAS·durability·예약·보호를 완화하지 않으며 독립적인 전체 process-tree 종료 근거를 대체하지 않는다.

`project_inventory`의 `register`에 `refresh_group:{id}`를 전달하면 `producer_registry_v1` 그룹의 현재 보호 메타데이터만 조정한다. 등록 소유자·종류·버전·전체 투영 경로·role이 같아야 하며, 내용 identity·측정 시각·크기는 보존한다. 참조·보호 확인·구성 완결과 관련 source identity를 갱신하되 pending 의도와 보존 이유는 유지하고 명시된 비생성물을 생성물로 승격하지 않는다. 구성이나 소유 경계가 바뀌면 전체 재등록이 필요하다. 갱신 이후 새 검토 토큰으로 명시적인 삭제·보류 결정을 적용한다. 보호 해제·갱신은 삭제 승인이 아니다.

검증 후보의 `register.retire_group_source`는 삭제가 끝난 legacy 그룹의 오래된 membership source 참조를 한 번만 폐기한다. 정확한 소유자와 현재 state revision·config·그룹·역방향 구성원·관련 결정의 snapshot, SHA로 고정한 정식 근거를 요구한다. source는 형식 필드가 없는 현재 lifecycle catalog로 제한하며, 모든 구성원의 native 삭제 완료 영수증과 실제 부재, canonical/pending producer 기록 부재, 참조·예약·실행 보호 및 전체 catalog의 해석 가능성을 다시 검사한다. 불확실하거나 재등장한 대상은 거절한다. 성공하면 source 세 필드만 제거하고 감사 이력을 남기며 항목·결정·과거 결과·provenance는 유지한다. 감사 이력은 재등록으로 지울 수 없고 같은 그룹의 반복 폐기는 거절한다. payload나 catalog 파일을 지우거나 과거 producer의 종료를 새로 인증하는 기능은 아니다. 실제 설치본 전환과 이 기능의 운영 적용은 별도다.

갱신 전 maintenance/catalog OS 잠금의 일시 경합은 기존 lease와 같은 최대 5초·10ms 간격으로 대기한다. catalog 획득에 실패한 시도는 이미 얻은 잠금을 모두 놓고, 다음 시도에서 manifest·junction 허용 정보·권한과 producer 보호를 다시 확인한다. 재시도 범위는 갱신 전 잠금 획득뿐이며 갱신·저장·보호 검사 실패를 재실행하지 않는다. 계속 점유되면 정확한 잠금 경로와 대기 한도를 포함한 오류를 반환한다. 권한 실패, 구형/알 수 없는 잠금 및 활성 예약은 기존 차단을 유지한다. 이 대기 동작은 Windows x64 기본 standalone에서 실제 검증했다. [현재 실행기](../ops/project-maintenance.md#이-체크아웃의-정리-실행기)의 version 영수증이 입력·실행파일 identity와 수용 범위를 소유하며 앱 내장 엔진은 아직 교체하지 않았다.

## 지침과 적용 환경

공통 지침은 도구와 무관하게 묶음 분류·결과 검토·삭제/보류·빌드 분리 원칙을 설명한다. 내장 도구의 실제 이름과 사용법은 가용성에 따른 developer 문안이 소유한다. 도구군이나 권한이 바뀌면 문안을 갱신하거나 철회한다. 소스 수정은 실행 중인 엔진이나 설치본의 도구 가용성을 바꾸지 않는다.

공통 의미의 대상은 Windows x64, Linux x64, macOS ARM64이며 경로·권한·프로세스 처리는 플랫폼 경계가 담당한다. macOS 경로 비교는 대소문자를 접어 보호 범위를 보수적으로 판단하므로 대소문자를 구별하는 볼륨의 서로 다른 경로까지 보호할 수 있다. 이번 기능의 실제 수용은 Windows x64에서 수행한다. 원격 실행·앱 전체 빌드·일반 프로필 설치·공개 배포와 다른 OS의 실기기 수용은 별도 범위다. [운영 절차](../ops/project-maintenance.md)는 등록과 검증 방법을 소유한다.

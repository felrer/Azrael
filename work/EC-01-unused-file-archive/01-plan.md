상태: 부분 완료. pending 차단 복구·실행기 교체·실패 갱신 25건 재처리와 추가 1개 그룹 이관을 완료했다. 이번 임시 실행 묶음 2개도 삭제·부재·producer 정합화를 확인했다. 활성 참조·소유 불명확 항목은 보존한다.

# 미사용 파일 조사와 archive 이관

## 요구사항과 권한
- 현재 프로젝트 전체에서 미사용 파일을 찾아 archive/로 이동한다. 보호/조건도 조사하되 활성 실행·설치·복구·잠금과 소유권 불확실성을 우회하지 않는다.
- 기존 수정사항 및 동시 작업을 보존한다. Windows x64 로컬 파일 정리이며 공통 제품 기능과 타 OS 지원은 변경하지 않는다.

## 계획과 검증

### 승인된 pending 복구와 실행기 교체

- 사용자가 안전한 상태 복구 구현·검증, Windows x64 standalone 빌드·교체 후 archive 정리 재개를 승인했다. 전체 앱 빌드·설치와 내장 엔진 교체는 제외한다.
- 현재 pending은 보호 revision만 추가한 미커밋 갱신이다. 정상 manifest를 보존하며 정확한 두 상태 SHA·그룹·종료 증거·배타 잠금과 별도 영수증을 검증한 명시적 `recover_refresh_pending`으로 이 좁은 미커밋 상태만 폐기한다. 삭제/실행 결과나 다른 필드가 바뀐 pending은 복구하지 않는다.
- 공통 native 계약을 보완하되 실기 검증·배포는 Windows x64 로컬 standalone에 한정한다. Linux/macOS 실기 수용은 미검증으로 남긴다. 기존 native 회귀와 실제 standalone의 성공·거부·무변경 경계를 확인한다.
- root는 계약·상태 조사·입력 고정·검증·설치·archive·정리를 담당한다. bounded worker는 native 복구 구현/기존 테스트만 수정한다. 고정 입력과 소유 target을 사용하며 동시 EB 작업을 보존한다.
- 이전 standalone은 EB 실행 소비자가 참조 중이므로 교체 후에도 해당 owner가 해제하기 전에는 이동하거나 삭제하지 않는다.

### 기존 이관 절차
1. native/producer/cache 등록부와 실제 경로, Git 상태, 설치·실행 참조를 대조한다.
2. 파일/묶음별 사용 근거, 보호 사유, 미사용 판단, 원본/이관 경로를 기록한다. 등록 외 경로는 추가 조사한다.
3. 해소 가능한 보호는 기존 소유 절차로 해제한다. 불확실한 항목은 보존하고 필요한 증거/결정을 명시한다.
4. 확정된 비활성 자료는 고유 archive 목적지로 이동하고 원본 부재, 내용/identity, 필요한 reader 참조를 검증한다.
5. 결과와 미해결 범위를 기록한다. archive는 요청한 산출물이며 디스크 회수로 보고하지 않는다.

## 재사용과 보존
- docs/ops/project-maintenance.md의 standalone maintenance_owner와 scripts/artifact-lifecycle.cjs를 우선 사용한다. 실행파일 SHA256이 설치 영수증과 일치함을 확인했다.
- 현재 등록부: producer/observation 522개, native 정리 그룹 496개. 실제 경로가 남은 native 항목 221개이며 등록 크기 합계는 중복 가능성이 있어 전체 사용량으로 해석하지 않는다.
- 현행 제품 동작 변경을 계획하지 않아 architecture/기능 계약 수정은 필요하지 않다. 기능/유효 테스트 퇴역이 필요해지면 별도로 범위와 근거를 확정한다.
- 작업 전 git status의 기존 수정 8개 및 upstream/, work/EB-01-latest-windows-profile-install/를 보존한다.

## 성공 기준
- 조사 범위와 미확인 항목을 구분한 목록을 제공한다.
- 이관한 자료의 mapping과 무결성/원본 부재를 검증한다.
- 활성 설치·실행과 현행 소스·테스트·문서 기능을 보존한다. 추가 승인 범위인 Windows x64 standalone만 빌드·교체하며 전체 앱과 내장 엔진은 제외한다.

## 조사 결과와 이관

- native의 실제 경로가 있는 149개 그룹을 5개 묶음으로 검토했으며 실제 exit는 모두 0이었다. 보호 메타데이터 갱신 80회 중 41회는 exit 0, 39회는 잠금 거부로 exit 1이었다. 실패를 갱신 성공으로 간주하지 않았다.
- 이관: 25개 그룹, 35개 원래 경로, 파일 1,362개, 논리 크기 157,704,772바이트. 같은 볼륨 이동으로 디스크 회수량은 0이다.
- 이어진 [잠금 경합 수정](02-plan.md)에서 새 standalone 설치·참조 전환을 마친 뒤, 이전 실행기 1개 version/1개 경로/10개 파일(7,339,896바이트)을 `archive/EC-01-retired-maintenance-owner-20261028/`로 별도 이관했다. identity·원본 부재·보관 등록/보류·원래 producer finalize를 확인했다. 위 25개 그룹의 원래 영수증은 수정하지 않았다.
- 보관 위치: `archive/EC-01-unused-file-archive-20261028/`. 이동 전후 dev/ino·size·mtime·mode inventory 일치와 원래 경로 부재를 확인했다. archive 등록·검토·defer는 모두 exit 0이며 실제 결과가 deferred/remaining:true임을 확인했다.
- 문서 5개의 링크 25개를 갱신하고 목적지 존재를 확인했다. 원래 producer 16개의 JSON과 SHA256을 archive의 original-producers.json에 보존했다.
- 원래 관리 기록의 일괄 정합화는 exit 1로 실패했다. 남은 예약 25개는 정확한 실패 실행 종료 근거로 공식 복구했고, 이후 그룹별 검토/정합화를 진행했다. 최종 결과는 감사 보고서와 archive 제어 기록에 기록한다.
- 최종적으로 25개 그룹/35개 항목 모두 실제 defer 결과와 원래 native 기록의 remaining:false를 확인했다. 원래 producer 16개는 저장된 원본 SHA256과 일치함을 확인한 뒤 공식 finalize로 종료하고 등록 파일 부재를 검증했다. 실패 시도는 archive/source-reconciliation.json에 보존했다.

## 남은 범위

- 현재 결과: 새 standalone에서 native 172개 및 실제 실행파일 경계를 검증하고 실제 pending 복구·기본 실행기 교체를 마쳤다. 재시도 25개 모두 exit 0, 잔여 125개 묶음/192개 항목 review 6회 모두 exit 0이다. 추가 CR 그룹 1개/919개 파일/4,322,283바이트를 rchive/EC-01-lock-retry-20261028-r1/로 이관하고 native archive 보관·원본 부재·producer finalize·reader 경로 갱신을 확인했다. 아래 이전 실패 수치는 당시 결과로 보존하며 현재 감사는 [04-review-summary.json](04-review-summary.json), 수용은 [04-verification.json](04-verification.json)에 둔다.

- 2026-10-28 재시도: 보호 갱신 77개 중 실제 exit 0은 49개, exit 1은 28개였다. 구성 불일치 1개, 소유 기록 누락 1개, manifest 교체 액세스 거부 1개, 이후 pending 파일 존재로 저장 거부 25개다. 동일 잠금 경합의 재발로 분류하지 않는다.
- 읽기 전용 fresh review 6회는 모두 실제 exit 0으로 종료했다. 125개 묶음/192개 항목 중 present 185개, absent 7개였다. native blocker가 없는 16개 묶음도 별도 참조·소유 검증과 결과 저장이 필요하므로 이동 승인으로 해석하지 않는다.
- 새 `artifacts/maintenance/manifest.pending`은 revision 3654이고 정상 manifest는 3653이다. 읽기 전용 비교에서 변경은 `run:instruction-yazl-a` 그룹과 그 구성원 1개뿐이었다. 당시 native API는 pending manifest 복구를 지원하지 않아 archive 이동과 관리 상태 변경을 보류했다. 승인된 좁은 복구 구현 후 새 standalone으로 해당 pending만 폐기했으며 정상 manifest의 바이트 일치와 문제 그룹 재갱신을 확인했다. 기존 lock/reservation 복구의 범위는 넓히지 않았다.
- 재시도 실행 및 진단 산출물은 `artifacts/tasks/EC-01-unused-file-archive/runs/archive-lock-retry-r1/`에 있으며, 실행은 종료했다. 관리 상태 복구 조사에 필요한 활성 자료로 유지하고 복구/재검증 종료 후 공식 정리한다. 이번 재개에서 payload 이동·삭제는 0개다.
- CF/CG/CT/DC 참조의 추가 읽기 전용 조사에서도 대체 수용/설치/증거 인계가 확인되지 않았다. CL native-1과 CM types의 생성 provenance는 확인했으나 증거 보존 해제 근거는 부족하다. 기존 보존 조건을 유지한다.

- 재개 범위: 이전 보고서의 125개 남은 항목 중 producer registry 방식 77개 그룹의 현재 보호 메타데이터를 새 standalone으로 순차 갱신하고 전체 잔여 등록 범위를 fresh review한다. 원래 39회 잠금 거부의 개별 목록이 남아 있지 않아, 잔여 producer 그룹을 모두 대조해 누락을 막는다. 내용 재측정은 하지 않는다. 이전 보관물과 삭제 payload가 없는 pending 제어 기록은 이번 이동 후보에서 제외한다.
- 관리 작업은 동시에 실행하지 않는다. 갱신 → 검토 → 현재 사용·참조 보완 조사 → 안전한 archive 이관 → 결과 확정 순서로 진행한다. 활성/불확실한 소유·설치·실행·복구 조건을 우회하지 않는다. Windows x64 로컬 파일 운영이며 추가 승인된 pending 복구 코드와 standalone 빌드·교체를 포함한다. 전체 앱 빌드·설치와 내장 엔진은 제외한다. 원본 부재·동일 볼륨 identity·archive native 등록/보류 및 원래 기록 정합화를 검증한다.

- 실행 중인 설치 경로는 `artifacts/workspaces/h/artifacts/releases/w13r-99afefb1/`이다. 실행·설치·복구 참조가 남은 파일을 미사용으로 단정하지 않았다.
- 남은 등록 항목은 최초 검토 기준 125개 항목(그룹 124개와 단독 항목 1개)이다. 감사 보고서에는 당시의 경로·보호·참조 근거를 보존했다. 현재 사용 여부의 확정 또는 이동 승인을 뜻하지 않는다.
- CX shutdown은 native 3개와 producer 4개 멤버가 달라 기존 선택 갱신으로 해소되지 않는다. PD13 및 legacy 항목에도 후속 검증·소비자 참조·소유 증거가 남아 있다.
- CF/CH/CT/CG/DC의 기록은 실행 종료와 참조 해제가 다르다. 대체 설치/검증 근거와 정확한 참조 해제 없이 보관하지 않았다.
- 소스·테스트 감사에서 퇴역 근거가 확정된 파일은 없었다. scripts/test-macos-signing.cjs는 직접 selector가 없어도 Mac 서명 계약을 검증한다. 모든 plugin/provider와 engine/upstream 내부를 개별적으로 전수 검증한 것은 아니다.
- 전체 미사용 파일 이관은 아직 완료되지 않았다. 추가 이관에는 남은 항목의 사용·참조 해소 또는 소유 관리 절차의 변경 범위를 확정해야 한다.

## 사용자 홈 외부 잔여물 이관

- 사용자가 사진의 사용자 홈 외부 잔여물 조사와 프로젝트 archive 이관을 추가 요청했다. Windows x64 로컬의 C:/Users/felre 바로 아래 Azrael 관련 짧은 검증 경로와 확인된 테스트 잔여물을 대상으로 한다. 앱 상태/인증/일반 도구 설정, 개인 자료, 사용자 소스 저장소는 임의 이관하지 않는다. 전체 홈/AppData/Drive 내용 전수 스캔은 하지 않는다.
- 조사 경계: azr-r3-3dd11733, azr-r4-e660efa1, av17, av18, av30, .tmppazXs2. azrael-environment-share는 현재 문서가 참조하는 소스 저장소이며 별도 보존한다. 외부 경로는 원래 owner/native 관리 기록과 현재 프로세스·설치·독자 참조를 확인한다. 홈 전체를 primary 관리 allowlist에 추가하지 않는다.
- root는 .tmppazXs2의 생성자·현재 사용·이관 실행과 전체 결과를 담당한다. 읽기 전용 조사자 두 명은 짧은 legacy 경로와 av17/av18의 남은 관리 기록/실제 자료를 분담한다. 다른 작업의 catalog 잠금은 점유를 보존하며 선행 획득 실패는 변경 없음으로 기록한다.
- 확정된 미사용 자료만 고유 archive/EC-01-external-home-20261028-r1/payload/user-home/<original-name>로 같은 볼륨 일반 rename한다. 생성자 근거·참조·제외 사유와 원래 경로 mapping을 독립 제어 기록에 남기고, 전후 dev/ino/size/mtime/mode 및 원본 부재를 확인한 뒤 archive 관리 등록/보류를 확인한다. 보관은 삭제/디스크 회수로 보고하지 않는다.
- 실행 자료 owner: run:EC-01:external-home-r1, 경로 artifacts/tasks/EC-01-unused-file-archive/runs/external-home-r1. 최초 catalog 획득은 5초 busy로 실패했고 변경/출력 생성 없이 종료했다. 점유가 해제된 뒤 재등록이 성공했다. 조사 대상의 소유권을 이 실행 묶음에 흡수하지 않는다.

### 외부 홈 이관과 사용자 삭제 후 처리 (2026-10-28)

- 최초로 `azr-r3-3dd11733`, `azr-r4-e660efa1`, `.tmppazXs2`를 `archive/EC-01-external-home-20261028-r1/`로 이관했다. 4개 파일/398바이트의 파일 식별자와 SHA256 일치, 원래 경로 부재를 확인했다. archive 등록 3회와 review/defer는 모두 실제 exit 0이었다. 당시 증거인 `05-home-archive.json`은 과거 시점의 검증이며 현재 보관물 존재를 뜻하지 않는다.
- 실행용 임시 폴더는 native register/review/delete 모두 exit 0, producer finalize 후 실제 부재를 확인했다. `05-cleanup.json`에 결과를 보존했다.
- 사용자가 직접 삭제했고 사후 처리만 요청했다. 추가 조사·이관·삭제는 중지했다. 읽기 전용 확인에서 홈의 `av17`, `av18`, `av30`, 위 3개 폴더와 새 archive 경로 모두 부재였다. 사용자 삭제의 명령, exit code, 정확한 시각과 회수 용량은 확인하지 못했으며 관리 도구가 삭제했다고 기록하지 않는다.
- primary producer/native 항목에서 해당 경로 참조는 없고, 현재 엔진의 등록 프로젝트 별칭도 없었다. 삭제된 별도 관리 루트의 manifest를 재생성하거나 과거 삭제 결과를 조작하지 않았다.
- 현재 운영 문서의 av18/u22c 활성 프로필 설명과 그 프로필에만 근거한 u21a 복구 보관 요구를 퇴역 상태로 정정했다. 별도 runtime/Git 의존성은 일괄 해제하지 않는다. CF/DS 등 과거 기록과 `05-home-archive.json`은 원래 사실을 보존한다.
- 외부 홈의 이번 삭제 범위 사후 처리는 완료했다. 프로젝트 전체의 다른 보호 항목까지 삭제 가능성이 입증된 것은 아니다. 세부 결과: [06-user-deletion-reconciliation.json](06-user-deletion-reconciliation.json).

### CUA 가상 머신 준비 자료 삭제 확인 (2026-10-28)

- 사용자 질문에 따라 `C:/Users/felre/Virtual Machines/Azrael-CUA-Test`를 읽기 전용 조사했다. 실제 자료는 설치 ISO와 준비 설정 JSON의 2개 파일, 논리 크기 8,225,407,088바이트였다. 가상 디스크나 VM 구성 파일은 없고, 설정은 미설치 상태였으며 ISO 미마운트·현재 실행/관리 참조 없음이 확인됐다.
- 사용자가 직접 삭제했다고 알린 후 해당 폴더의 실제 부재를 확인했다. 추가 삭제는 수행하지 않았다. 삭제 명령·exit·물리 공간 회수량은 알 수 없다. 상세 결과: [07-cua-preparation-deletion.json](07-cua-preparation-deletion.json). DN-01의 용량 조사는 과거 시점의 기록으로 유지한다.


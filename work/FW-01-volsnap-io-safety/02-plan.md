상태: 실제 설치된 삭제 도구로 VSS 복사본을 유지한32개 디렉터리·16,384개 파일·1GiB 삭제를 완료했다. native register/review/apply 모두 exit0이며 새 Volsnap25는0건이었다. 최소 결과를 보존하고 두 실행의 임시 파일 삭제·부재·소유 기록 종료를 확인했다.

# Volsnap 이벤트 25 제한 재현

## 목표·허용 범위

- 사용자가 지정한 목표는 실제 Windows System 로그의 `Volsnap / Event ID 25` 재현이다. Windows bugcheck·블루스크린 재현 및 GPU/하이퍼바이저 원인 추적은 제외한다.
- 기존 FW-01 소스 개선·258개 검증·커밋 `6f9e8e62`는 완료된 선행 작업이다. 이 재현은 별도 검증이며 이벤트 재현이 곧 Azrael 원인 입증을 뜻하지 않는다.
- 사용자가 현재 PC에서 제한 시험을 승인했다. 물리 디스크를 공유하는 VHDX는 데이터 영역을 분리하지만 호스트 I/O를 격리하지 못한다. 승인된 용량·시간·쓰기량·writer 상한을 자동으로 늘리지 않는다.

## 현재 확인한 사실

- Windows x64 로컬 환경. `vssadmin`, `diskpart`, Storage 모듈의 Get-Disk/Get-Volume/Initialize-Disk/New-Partition/Format-Volume/Mount-DiskImage/Dismount-DiskImage가 있다. `diskshadow`, New-VHD/Get-VM, diskspd 명령은 현재 발견되지 않았다.
- 조회 시 C: 여유 약179.9GB, D: 약1.42GB, E: 약12.17GB. 다른 실사용 디스크는 시험 저장소로 선택하지 않는다.
- 기존 이벤트25는 2026-11-05 18:17:31 KST RecordId44901, 14:01:45 RecordId43687, 11-03 07:20:37 RecordId41123. 과거 이벤트를 새 시험의 성공으로 세지 않는다.
- Win32_ShadowCopy.Create와 Win32_ShadowStorage.Create의 공식 WMI 경로가 있으나 문서의 client 지원 표기와 현재 Windows 환경의 실제 기능은 구분한다. 시험 볼륨에서 생성·조회·삭제를 실제 확인하기 전 부하를 시작하지 않는다.
- 저장소/스크립트 검색에서 해당 VHDX/VSS 재현 harness를 찾지 못했다. 표준 Windows API·Storage cmdlet·WMI를 먼저 재사용하며 드라이버 설치·Driver Verifier·global registry 튜닝은 하지 않는다.

## 현재 PC를 선택할 경우 제안한 상한

- workspace의 task-owned run 아래 최대8GiB 임시 VHDX 하나를 사용한다. 기존 파일 덮어쓰기 없이 새 경로·run ID로 생성하며 정확한 image path→새 disk identity→시험 partition/volume GUID 연결을 확인한다.
- 기존 C: 섀도 복사본/저장소 정책·서비스 설정·MinDiffAreaFileSize는 바꾸지 않는다. 시험 볼륨의 diff area도 시험 볼륨이어야 하며 실제 association을 확인한다. VHD의 차등 저장소는 같은 VHD 볼륨이어야 한다는 플랫폼 제약을 이용해 작은 shadow를 먼저 생성하는 경로도 허용하며, 다른 볼륨으로 배치되면 부하 전에 중단한다.
- 시험 부하는 최대3분, 총 요청 쓰기16GiB 이내, 동시 writer 최대2개로 제한한다. 이는 workload의 상한이며 초기 VHDX/파일 준비 시간과 VSS 호출 대기 시간은 별도로 기록한다.
- 초기 작은 파일·shadow 생성/조회/삭제 preflight를 먼저 수행한다. 그 다음 고정 seed와 명시적 block/queue 조건의 단계를 실행한다. 작은 quota를 채워 이벤트36을 만드는 것을 목표로 하지 않는다.
- 시작 전 C: 여유100GiB 및 가용 RAM8GiB 이상을 확인한다. 부족·관측 실패·외부 볼륨 VSS 이벤트·시험 shadow 손실·사용자 취소가 발생하면 추가 부하를 중지하고 결과를 보존한다. 이 제한은 OS 오류나 host 지연의 부재를 보장하지 않는다.

## 성공·실패 판정

1. 시험 전에 정상 생성되고 조회되는 시험 shadow ID, volume GUID/device mapping, provider, storage association을 기록한다.
2. 시작 EventRecordID 이후의 실제 provider Volsnap/ID25가 시험 volume identity와 일치해야 재현으로 인정한다. XML·RecordID·시각·메시지를 보존한다.
3. 이벤트 전후 shadow 존재·diff area 할당/사용·부하 단계/쓰기량·실제 종료 결과를 함께 기록한다. 정리 과정의 의도적 snapshot 삭제를 재현으로 세지 않는다.
4. ID36·다른 VSS 이벤트·타임아웃·호스트 다른 볼륨의 ID25는 별도로 보고한다. 정해진 한도에서 ID25가 없으면 제한 조건 내 미재현으로 보고하고 자동으로 용량/부하/시간을 늘리지 않는다.
5. 재현되면 같은 조건에서 반복성 및 기존/개선 Azrael 작업과의 인과 검증을 다음 단계로 결정한다. 인위적 일반 I/O 재현만으로 Azrael 결함이나 개선 효과를 확정하지 않는다.

## 소유·복구·정리

- 실행 전 task run에 VHDX·worker·로그·evidence·예정 출력과 active refs를 등록한다. elevated 제어기는 선택 실행 권한 및 요청한 UAC 범위로만 동작한다.
- 원래 디스크 번호나 drive letter만을 근거로 초기화/format하지 않는다. exact new image path에 연결된 RAW disk인지 매 단계 확인하고 식별 불일치·기존 partition이면 중단한다.
- snapshot 정리는 이 run에서 생성한 정확한 ID와 volume 연결만 확인해 수행한다. 기존/다른 작업의 shadow와 설정은 보존한다.
- 작업 전용 writer의 실제 종료를 확인한 뒤 VHDX를 정상 dismount하고 Attached=false를 검증한다. mounted/unknown 파일은 삭제하지 않는다. 최소 결과를 work에 남긴 뒤 기존 owner 절차로 task run을 삭제하고 부재를 확인한다.
- 실패로 필요한 복구 자료가 남으면 실제 경로·크기·보호 사유를 보고하고 implementation의 보존/정리 규칙을 따른다. force delete·ACL 변경·다른 shell로 우회하지 않는다.

## 실행 기록

- 작업 owner `root/fw02-volsnap-reproduction`, run `run:fw02:vss-35233693-59a0-4bc8-8eb4-4e2614e94272`. 생성 전 pending/incomplete로 등록한 경계는 `artifacts/tasks/fw02/runs/vss-35233693-59a0-4bc8-8eb4-4e2614e94272`이며 inputs/temporary/logs/reports/outputs 및 VHDX 전체가 이 소유 범위다.
- root는 관리자 실행·실제 결과·cleanup을 담당한다. bounded executor는 이 run의 일회용 PowerShell/C# 제어기와 구문/컴파일 확인만 담당하며 디스크/VSS 명령은 실행하지 않는다.
- 관리자 읽기 전용 전제 확인 exit0. Win32_ShadowCopy의 Create/Revert 및 Win32_ShadowStorage.Create가 현재 provider에 노출되어 있다. 기존 shadow0개, C→C association 최대39,952,842,752바이트(기존37.2GiB)이며 변경하지 않았다. 이는 실제 시험 shadow 생성 성공을 뜻하지 않는다.
- 단계1은 작고 정상적인 shadow 생성·조회·정확한ID 삭제·detach만 수행한다. 단계2의 workload는 단계1 결과와 VHDX identity가 확인된 뒤 별도로 시작한다. phase1 mutation 최대2GiB 또는30초 뒤 phase2를 실행하되 전체180초/16GiB 한도를 공유한다.

## 실제 결과와 다음 조건

- 독립 근거는 [제한 재현 결과](03-reproduction-result.json)에 보존했다. Windows 11 Home 10.0.26200 x64에서 2026-11-05 19:35:03~19:35:13 KST 사전 점검을 수행했고 실제 프로세스 exit1을 관측했다.
- 첫 실행은 stage 진입 전에 exit1로 끝났다. 당시 유효 PowerShell 정책은 Restricted였으나 최초 stderr가 없어 원인을 확정하지 않는다. 두 번째 실행은 해당 프로세스에만 RemoteSigned를 지정했고 전역 실행 정책은 변경하지 않았다.
- 새 8GiB VHDX 생성·연결·NTFS 포맷·1MiB 파일 기록은 성공했다. `Win32_ShadowStorage.Create`에 시험 볼륨을 원본과 diff volume으로 명시하고 MaxSpace 4GiB를 지정했으나 ReturnValue10(공식 의미: Unknown error)으로 실패했다. 실제 backing file 크기는 100MiB였다.
- shadow 생성은 호출되지 않았고 부하 worker도 시작되지 않았다. 이 결과는 제한 부하에서의 미재현이나 Azrael 개선 효과의 검증이 아니다. 현재 API 경로의 환경 구성 실패이며 다른 경로에서도 VSS 사용이 불가능하다는 증거는 아니다.
- 종료 제어기는 정상 Dismount 후 `Attached=false`, 기존 shadow/association 보존, cleanup 오류0개를 확인했다. 원래 C→C 최대39,952,842,752바이트 설정은 동일했다. 해당 시간대 Application/System 로그의 VSS·Volsnap 관련 추가 진단 이벤트는 없었다.
- 다음 재현에는 시험 볼륨의 shadow 생성·조회·삭제가 먼저 성공하는 환경 또는 검증된 API 경로가 필요하다. 실제 C: 부하·VSS 설정 변경, 용량/시간/쓰기량 상한 확대는 승인 범위에 없으므로 실행하지 않는다. 이 원인을 알아내기 위한 무제한 반복이나 부하 증가는 하지 않는다.
- 일회용 harness는 환경 구성을 위한 시험이며 제품의 지속 테스트로 유지하지 않는다. 최소 결과와 입력 SHA256만 남기고 VHDX·스크립트·컴파일 산출물·raw 로그를 전체 run 소유자 절차로 정리한다.
- 검증된 standalone owner의 등록·검토·명시적 삭제는 모두 exit0이었다. [정리 결과](04-cleanup-result.json)는 전체 run의 `deleted`, `remaining:false`, 오류 없음과 논리 크기105,402,913바이트를 기록한다. lifecycle finalize도 `remaining:[]`, `references:[]`, `blockers:[]`로 완료했다. 물리 회수 바이트는 측정하지 않았다.

## 공식 근거

- [Vssadmin 지원 명령](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/vssadmin)
- [Win32_ShadowCopy.Create](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/vsswmi/create-method-in-class-win32-shadowcopy)
- [Win32_ShadowStorage.Create](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/vsswmi/create-method-in-class-win32-shadowstorage)
- [VSS provider 볼륨 지원 검사](https://learn.microsoft.com/en-us/windows/win32/api/vsprov/nf-vsprov-ivsssoftwaresnapshotprovider-isvolumesupported)
- [VHD와 diff area 동일 볼륨 제약](https://learn.microsoft.com/en-us/windows/win32/api/vsmgmt/nf-vsmgmt-ivssdifferentialsoftwaresnapshotmgmt-adddiffarea)
- [Windows 11의 shadowstorage resize 지원](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/vssadmin-resize-shadowstorage)

## 두 번째 시도

- 새 pending owner 경계는 `run:fw02:vss2-0f21bc14-0bed-407a-b389-094212031d97`, `artifacts/tasks/fw02/runs/vss2-0f21bc14-0bed-407a-b389-094212031d97`다. 이전 실행은 재사용하거나 실패 결과를 덮어쓰지 않는다.
- `ShadowStorage.Create` 및 COM `AddDiffArea`는 문서상 클라이언트 지원이 명시되지 않았다. 이는 첫 Return10의 확정 원인은 아니다. 이번에는 시험 VHD의 작은 파일을 대상으로 `ShadowCopy.Create`를 직접 호출한 뒤 실제 Volume/DiffVolume을 검증하고, 동일 시험 GUID 대상으로만 `vssadmin resize shadowstorage`를 실행해4GiB를 확인한다. ShadowCopy WMI의 문서도 client 지원을 명시하지 않으므로 성공 여부는 실측으로 판단한다.
- 현재 설치된 `vssadmin resize shadowstorage /?`가 정상 출력됐고, Microsoft 문서도 Windows11을 지원 대상으로 명시한다. 명령 존재나 도움말은 실제 resize 성공의 근거로 삼지 않는다. resize로 shadow가 사라지면 preflight 실패이며 부하로 넘어가지 않는다.
- root는 관리자 실행·결과 검토·정리, 기존 harness executor는 이 run의 일회용 제어기 및 compile-only 검증을 담당한다. 8GiB/180초/16GiB/writer2 한도와 C: 여유100GiB/RAM8GiB, 원래 VSS 보존·worker종료·정상 detach·정리 조건은 유지한다.
- vss2 실행은 native 종료 코드 수집 함수의 지역 `$LASTEXITCODE`가 전역 갱신을 가리는 harness 오류로 mount 전에 exit1로 중단됐다. 동기 diskpart는 반환했으나 기록된 exit는 null이며 성공으로 바꾸지 않는다. 정확한 image 조회는 `Attached=false`였다. [실패 근거](05-harness-failure.json)를 보존했다.
- 수정은 새 run `run:fw02:vss3-7e65f579-52c5-4d0e-8cbd-3c91731eb99c`에서만 수행했다. 실제 native helper를 AST로 추출하고 로그만 대체해 child PowerShell exit0/exit7을 실행하여 정상 반환·실패 거절과 실제 종료 코드 수집을 검증했다(exit0). controller SHA256 `faaf617668830594368631293ff8e441e492fdf48a07d7104c03beba7f6f0014`, worker SHA256 `07103b1b6cc5a23d0b8927afb917b4275ded6a6f3a71d6dfbda6df2efb455ddd`로 고정했다.
- vss3 사전 점검은 2026-11-05 19:52:57~19:53:07 KST에 실제 exit0. ShadowCopy.Create Return0, GUID `9e8c561d-dc52-4bc1-8ddb-d9cebde3c738`의 동일 source/diff association, resize exit0 및 MaxSpace4GiB를 확인했다. 반환 shadow ID `{968B8A55-5715-4772-927D-AA029B8371A1}` 삭제 후 부재, image detach, 원래 VSS 보존도 확인했다. 따라서 현재 Windows Home에서 이 직접 생성 경로는 실제 동작한다.
- [제한 부하 결과](06-bounded-trial.json): 19:53:40~19:54:23 KST 단계 실행 exit0. worker 구간38.8086614초에 쓰기예산에 도달했다. worker requested/completed 모두17,178,820,608바이트이며 preflight1MiB를 더한 총량은 정확히16GiB다. 준비 파일은1GiB 두 개이고 이후64KiB 정렬 random overwrite를 writer1→2로 실행했다. 각 writer queue depth1, WriteThrough 및 최종 Flush(true)를 사용했다. 180초는 상한이며 총량이 먼저 소진돼 종료했다.
- 시험 shadow `{8F0E9EBB-C543-403A-8F0E-5BA4BDC74065}`는 생성·관측됐고 의도적 정리 전에 손실되지 않았다. 새 시험-volume Event25=0, 다른 Volsnap 이벤트=0. diff area 최대 관측 사용량2,089,447,424바이트, 할당량2,617,245,696바이트(상한4GiB). 샘플 최소 C여유175,130,497,024바이트, 가용RAM11,320,590,336바이트였다.
- 두 foreground worker Join 성공, exact-ID shadow 삭제 후 부재와 image detach 검증, 기존 VSS 보존, cleanup 오류0개를 확인했다. 시험 종료 시 VHDX 파일 크기는4,366,270,464바이트였다.
- 해석 범위: 한 차례 합성 I/O 시험이다. 쓰기 총량16GiB와 별개로 변경 대상 파일의 합계는2GiB여서 계속 새로운 영역을 수정하는 작업과 차등 저장소 성장 양상이 다르다. Azrael의 실제 기존/개선 binary를 비교하지 않았으므로 인과관계·개선 효과·최대 처리량·향후 재발 불가를 입증하지 않는다. 재현을 위해 자동으로 한도나 실사용 볼륨 변경 범위를 넓히지 않았다.
- [후속 정리 결과](07-followup-cleanup.json): vss2/vss3 등록·fresh review·명시적 삭제 모두 exit0, 두 group `deleted`, 두 member `remaining:false`, 오류 없음. 논리 크기 합계4,370,571,452바이트를 삭제했으며 물리 회수량은 측정하지 않았다. 두 lifecycle finalize도 `remaining:[]`, `references:[]`, `blockers:[]`로 확인했다. 입력 hash는 실행 후에도 동일했다. 별도 상주 harness·제품 코드·설치는 추가하지 않았고, 근거 JSON 및 이 작업 기록만 보존했다.

## 실제 삭제 도구 실험

- 사용자가 다음 단계로 삭제 도구 실험을 요청했다. 현재 실제 정리에 사용하는 Windows x64 standalone `maintenance_owner.exe`(SHA256 `c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680`)를 대상으로 한다. FW-01의 미설치 개선 버전이나 앱 내장 도구를 시험했다고 보고하지 않는다. 제품 코드·설치 변경은 포함하지 않는다.
- 새 run은 `run:fw02:delete-vss-d538f667-b5a3-4ed1-a17b-5845936cbecc`이며, outputs/test.vhdx와 입력·로그·보고서·컴파일 임시물 전체를 생성 전에 root/fw02-volsnap-reproduction 소유로 등록했다. 실제 fixture는 새 VHDX의 독립 projectRoot 안에만 생성한다.
- 데이터는64KiB 파일16,384개(1GiB)를512개씩32개 disjoint 디렉터리에 배치한다. VSS 복사본을 만든 뒤 실제 owner의 register/review/apply를 호출한다. 32개 디렉터리를 하나의 완결된 그룹으로 등록하고 fresh token에 대한 명시적 삭제만 실행한다. 임의 PowerShell 재귀 삭제로 대체하지 않는다.
- 기존8GiB VHDX·4GiB 동일 볼륨 diff area·총 요청쓰기16GiB·180초 부하 상한 및 자원/이벤트/복사본/기존VSS 보존 조건을 유지한다. 실제 native 작업의 취소·프로세스 종료 계약을 확인한 뒤 실행한다. 종료가 불확실한 삭제 프로세스를 남긴 채 shadow 삭제나 VHD detach를 하지 않는다.
- root는 native adapter·관리자 실행·통합 검토·정리, harness executor는 VHD/fixture/관측 제어기, deletion reviewer는 설치 기능과 native 요청·종료 계약의 읽기 전용 확인을 담당한다. Controller와 adapter 고정 입력이 준비되면 작은 preflight부터 실행한다.
- 설치 CLI는 취소 callback을 false로 전달하고 Windows worker 응답을 시간 제한 없이 기다린다. `lock_wait_ms:0`은 잠금 대기만 제한한다. 사용자는 180초/관측 실패/사용자 중지 이후 새 단계 금지 및 진행 중 native 종료 대기 조건을 승인했다. 강제 종료를 사용하지 않으며 unknown/active 상태에서는 shadow 삭제·detach를 금지한다.
- Preflight는 2026-11-05 20:32:24~20:32:35 KST에 actual exit0. shadow 생성·동일VHD association·4GiB quota·정확한 shadow 삭제·detach·기존 VSS 보존을 확인했다. Native adapter의 실제 함수로 새 작은 프로젝트의 inventory를 호출해 actual exit0과 프로세스 종료를 확인했다. 실제 삭제는 수행하지 않았다.
- 실행 입력 고정값: controller `96c3e24253b15abc1ffda28b4258532b4c9e603061004c2490224c24e3ed67e1`, fixture `db6c6ede095a98bc3ec65bce1a8f137f114c6f02a39cfe314ce948488dcdba04`, adapter `40bfd1ad86e1dcaf7a26d930e83eb0e22606fdd426815ce72a664c61cf31a195`. 성공 Preflight의 원본 controller `d70124db3f0290e34256da9e980eacbe3d9cea5f3c457d46460fd74d90168c56`도 실행 묶음 안에 보존했다. AST·fixture C# compile-only·native helper exit0/exit7 검증은 모두 exit0이다.
- 첫 Delete 단계는 20:56:29~20:57:31 KST에 exit1로 종료됐다. 파일16,384개/1GiB와 shadow 준비는 성공했으나 native Register가 `missing nonempty provenance_ref`로 exit1을 반환했다. 실제 삭제는 시작하지 않았다. 이는 harness의 group 요청 구성 오류이며 [독립 실패 근거](08-deletion-registration-failure.json)에 원래 실패와 종료·shadow 부재·detach·기존 VSS 보존을 남겼다.
- 새 run `run:fw02:delete-vss2-e82e1c78-88a9-460c-b489-c43406dababf`에서만 요청을 수정했다. Prepare가 fixture 소유·완결 구성을 `fixture-provenance.json`에 기록하고 Register group의 필수 `provenance_ref`가 이를 참조한다. adapter의 실제 phase 본문과 native 실행 함수를 AST에서 추출해32개 디렉터리/각1바이트 파일로 Prepare→Register→Review→Apply를 실행했다. native 호출 모두 exit0, 32개 경로 실제 부재를 확인했다. 이 작은 시험은 요청 계약 검증이며 VSS 부하 결과에 포함하지 않는다.
- 수정 입력: controller `ae63f74905a284e30689463d6a60236823a82bc9db4104862cd25f596cb9e3b1`, adapter `8c44c6455f3763da1cb75058d4c75ec66f1bcb03303c125005c714becc9df868`, fixture는 동일하다. AST와 실제 phase 계약 검증 exit0. 같은 승인 범위의 VSS 사전 점검·삭제를 새 identity로 수행한다.
- [실제 삭제 시험 결과](09-deletion-trial.json): 2026-11-05 21:02:23~21:03:55 KST, 단계 전체92.380초(파일 준비·VSS·호출·관측·정리 포함), actual controller exit0. Register10.216초, Review1.648초, Apply15.793초는 각 adapter의 호출·응답 검증을 포함한 시간이며 순수 디스크 처리시간이나 최대 처리량으로 해석하지 않는다. 총 요청 fixture쓰기1GiB, preflight1MiB이며180초 신규 단계 제한에 도달하지 않았다.
- 네이티브 apply는32개 member 모두 `deleted`, `remaining:false`, 삭제 오류 없음으로 반환했고32개 디렉터리의 실제 부재도 확인했다. 원래 파일 생성·완료 수는16,384개다. 삭제 후21:03:55.168 KST에도 같은 시험 shadow `{A7DD84C2-9CDB-4BEA-84F1-3FA67FA614C5}`가 존재했다. 이후 의도적 정리로만 삭제했다.
- 시험 중 새 Volsnap25=0, 다른 Volsnap 이벤트=0. diff area 최대 관측 사용량38,191,104바이트, 할당량301,989,888바이트(상한4GiB)였다. 가용RAM 최저9,994,719,232바이트, C여유 최저176,271,822,848바이트였다. native/adapter/controller 실제 종료·fixture Join·shadow 부재·정상 detach·기존 VSS 보존을 확인했다.
- 이 결과는 현재 설치된 standalone 삭제 도구의 한 차례 제한 시험이다. 삭제와 동시에 별도 합성 쓰기 부하는 주지 않았으며, FW-01의 미설치 개선 후보와의 비교나 실제 대규모 운영 환경에서의 재발 불가를 입증하지 않는다.
- [삭제 실험 정리 결과](10-deletion-cleanup.json): 실패·성공 실행 두 group을 기존 owner로 fresh review 후 명시적으로 삭제했다. actual exit0, group 모두 `deleted`, member 모두 `remaining:false`, 삭제 오류 없음. 논리 크기 합계2,592,656,035바이트이며 물리 회수량은 측정하지 않았다. 두 lifecycle finalize의 `remaining/references/blockers`는 빈 배열이다. VHDX·일회용 제어기·fixture·probe·raw 로그 등 실행물 전체가 정리됐고, 독립 결과와 작업 기록만 보존했다.

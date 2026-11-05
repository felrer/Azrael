상태: 재현 환경 선택 대기. 읽기 전용 사전조사 완료; VHDX 생성·VSS 변경·부하 실행은 아직 하지 않았다.

# Volsnap 이벤트 25 제한 재현

## 목표·허용 범위

- 사용자가 지정한 목표는 실제 Windows System 로그의 `Volsnap / Event ID 25` 재현이다. Windows bugcheck·블루스크린 재현 및 GPU/하이퍼바이저 원인 추적은 제외한다.
- 기존 FW-01 소스 개선·258개 검증·커밋 `6f9e8e62`는 완료된 선행 작업이다. 이 재현은 별도 검증이며 이벤트 재현이 곧 Azrael 원인 입증을 뜻하지 않는다.
- 현재 PC의 제한 시험과 별도 시험 PC/VM 중 실행 환경을 사용자에게 질문했다. 물리 디스크를 공유하는 VHDX는 데이터 영역을 분리하지만 호스트 I/O를 격리하지 못한다. 답변 전에 환경 종속 변경·부하를 시작하지 않는다.

## 현재 확인한 사실

- Windows x64 로컬 환경. `vssadmin`, `diskpart`, Storage 모듈의 Get-Disk/Get-Volume/Initialize-Disk/New-Partition/Format-Volume/Mount-DiskImage/Dismount-DiskImage가 있다. `diskshadow`, New-VHD/Get-VM, diskspd 명령은 현재 발견되지 않았다.
- 조회 시 C: 여유 약179.9GB, D: 약1.42GB, E: 약12.17GB. 다른 실사용 디스크는 시험 저장소로 선택하지 않는다.
- 기존 이벤트25는 2026-11-05 18:17:31 KST RecordId44901, 14:01:45 RecordId43687, 11-03 07:20:37 RecordId41123. 과거 이벤트를 새 시험의 성공으로 세지 않는다.
- Win32_ShadowCopy.Create와 Win32_ShadowStorage.Create의 공식 WMI 경로가 있으나 문서의 client 지원 표기와 현재 Windows 환경의 실제 기능은 구분한다. 시험 볼륨에서 생성·조회·삭제를 실제 확인하기 전 부하를 시작하지 않는다.
- 저장소/스크립트 검색에서 해당 VHDX/VSS 재현 harness를 찾지 못했다. 표준 Windows API·Storage cmdlet·WMI를 먼저 재사용하며 드라이버 설치·Driver Verifier·global registry 튜닝은 하지 않는다.

## 현재 PC를 선택할 경우 제안한 상한

- workspace의 task-owned run 아래 최대8GiB 임시 VHDX 하나를 사용한다. 기존 파일 덮어쓰기 없이 새 경로·run ID로 생성하며 정확한 image path→새 disk identity→시험 partition/volume GUID 연결을 확인한다.
- 기존 C: 섀도 복사본/저장소 정책·서비스 설정·MinDiffAreaFileSize는 바꾸지 않는다. 시험 볼륨의 diff area도 시험 볼륨으로 명시하고 실제 association을 확인한다. 다른 볼륨으로 배치되면 부하 전에 중단한다.
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

## 공식 근거

- [Vssadmin 지원 명령](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/vssadmin)
- [Win32_ShadowCopy.Create](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/vsswmi/create-method-in-class-win32-shadowcopy)
- [Win32_ShadowStorage.Create](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/vsswmi/create-method-in-class-win32-shadowstorage)
- [VSS provider 볼륨 지원 검사](https://learn.microsoft.com/en-us/windows/win32/api/vsprov/nf-vsprov-ivsssoftwaresnapshotprovider-isvolumesupported)

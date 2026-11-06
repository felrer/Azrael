상태: GUI 없는 자체 모니터와 독립 끊김 감시 실행 중 — CPUID 드라이버 정적 분석·직접 MSR 수집기 구현 완료. 드라이버 시작 관리자 요청이 Windows에서 사용자 취소되어 실제 온도 측정은 미검증이며 재시도하지 않음.

## 실시간 모니터 구현 범위
- 사용자가 드라이버 리버스 엔지니어링을 통한 자체 구현을 승인했다. 설치된 CPUID 165 원본을 읽기 전용으로 분석하고 `cpuid-sensors.py`를 추가했다. 기존 모니터·독립 감시의 고정 입력/실행은 유지한다. 새 커널 드라이버 설치나 서명/보안 정책 변경은 수행하지 않는다.
- CPUID 바이너리 `C:\ProgramData\CPUID Software\hwmonitor\GqDY411JCgKAzW`, SHA-256 `981c06bb03cc01ec0f85e8c4bb53f5c89d24c93af3f927290f24f149ee438385`, Microsoft Windows Hardware Compatibility Publisher Authenticode Valid. 원본 전후 SHA 동일. 서비스 cpuz165=Stopped, 장치 심볼릭 이름 CPUZ165 확인.
- Visual Studio dumpbin 정적 분석 exit 0. PE switch table 직접 해석으로 MSR 읽기 IOCTL `0x9C402440` → RVA `0x1DC3` 확인. input 4 bytes, output 8 bytes, 실제 `rdmsr`는 RVA `0x1E00`; MSR 쓰기 분기와 분리되어 있으며 자체 코드에서 쓰기 요청을 구현하지 않음. 최소 독립 근거는 같은 폴더 `driver-interface.json`, 사용법은 README에 기록했다.
- 자체 MSR 수집기는 CPU 모델/드라이버 SHA를 확인하고 0x19C/0x1A2/0x1B1/0x606/0x611만 읽는다. 온도 validity bit와 Tj target 유효 범위를 검사하며, 잘못된 MSR 인덱스는 OS 호출 전에 거부한다. 논리 프로세서 스레드 affinity는 복원한다. IOCTL 매핑·85°C 계산·invalid DTS 거부·allowlist 및 실제 관측 온도 로그 앞뒤 대조 변환은 인라인 검증 exit 0. 팬·펌프 직접 포트 읽기는 아직 구현하지 않았고 기존 LibreHardwareMonitorLib 경로도 실제 값 미검증이다.
- 사용자 승인 범위에서 기존 서명 서비스 시작을 관리자 권한으로 요청한 시각 23:25:50.728 KST. Windows가 `The operation was canceled by the user`로 종료했고 서비스 Stopped를 확인했다. 취소 후 재시작/권한 우회/다른 드라이버 로드는 시도하지 않음. 현재 SDK에는 WDK km 헤더/라이브러리가 없지만 기존 서명 드라이버 호출을 택했으므로 새 커널 빌드와 개발 서명은 하지 않았다.
- 정적 분석의 전체 disassembly/raw 출력 386,025 bytes는 최소 독립 근거를 `driver-interface.json`으로 옮긴 뒤 검증된 standalone owner review/apply로 삭제했다. remaining=false와 실제 부재 확인, lifecycle finalize 완료. 실제 장치 열기 probe는 WinError 2로 실패했으며 드라이버 로드/온도 값 조회는 미수행이다.
- 다음 실행용 monitor 소스에 단계별 조회 시간·수집 종료 시각·직전 로그 저장 시간을 추가했다. Python syntax 검증 exit 0이며 이 새 필드의 실제 실행 검증은 다음 승인된 실행에 남아 있다. 현재 실행 중인 동결 monitor 복사본은 바꾸지 않았고 기존 기록의 디스크 값 시각을 정확한 동시 측정으로 확대 해석하지 않는다.
- Windows 11 x64 현재 PC만 대상. 제품 엔진·빌드 입력은 변경하지 않고 이 작업 폴더에 재사용 가능한 진단 프로그램을 둔다. Python 표준 라이브러리와 Windows 메모리/CPU/PDH API를 재사용한다.
- 2초 간격 CPU 사용률, 물리 메모리 available, commit/limit, 상위 프로세스 메모리/CPU, 물리 디스크 지연/queue를 수집한다. 각 JSONL 레코드를 flush/fsync하여 재부팅 후 남은 마지막 기록을 분석할 수 있게 한다. 디스크 쓰기 자체가 멈추면 마지막 레코드 손실 가능성은 남는다.
- 사용자의 앱 미사용 지시에 따라 HWiNFO/HWMonitor 공유 메모리 경로를 제거했다. 자체 C# 콘솔 수집기에 LibreHardwareMonitorLib 0.9.6을 통합해 CPU·보드 센서를 직접 조회한다. 현재 PawnIO 장치 열기는 WinError 2이며 라이브러리도 드라이버 미설치를 확인한다. 드라이버/보안 설정은 변경하지 않았고, CPU 온도·팬·펌프 실제 값은 미수집이다.
- 관찰 경보 기준: CPU 90°C 이상, available RAM 2GiB 미만, commit 90% 이상, 디스크 지연 1초 이상, 수집 공백 6초 이상. 경보는 원인 확정이나 자동 프로세스 종료 지시가 아니다. 원래 요청대로 30분 실행하고 중지 파일로 조기 종료 가능하게 한다.
- 모니터의 실제 샘플/값/중지/시간 제한과 파서의 손상 데이터 처리를 검증한 뒤 빌드 요청을 전달한다. 데이터는 현재 진단 산출물이며 활성 수집·분석 중 유지한다. 임시 다운로드/검증 자료는 사용 종료 후 소유 절차로 정리한다.
- 구현: `monitor.py`, `hardware-sensors.cs`, `start-monitor.cjs`, `watchdog.py`, `analyze.py`; 운영 설명은 같은 폴더 `README.md`. 원래 Azrael 제품·동결 빌드 입력 변경 없음. Windows x64 실제 8초/4샘플 수집·시간 제한 종료 exit 0, STOP 파일 조기 종료 exit 0. 초기 공유 메모리 파서 검증은 해당 경로 제거로 현 구현 증거에 쓰지 않는다. 현재 95°C 경보, RAM/commit/disk/gap 경보, 정상 무경보, 직접 센서 unavailable 사유 보존은 인라인 검증 exit 0. 일회성 테스트 소스 파일은 생성하지 않음.
- 현재 30분 실행 work ID `7ea66e38-4d0d-425f-80ef-9ea941c11cef`, native session 9337, Python PID 16812. 실행 그룹 `run:FU-01-live-monitor:20261104T141217603Z-ff0ff5f8-2910-4b64-a218-152dc1c7d950`, JSONL은 `artifacts/tasks/FU-01-live-monitor/runs/20261104T141217603Z-ff0ff5f8-2910-4b64-a218-152dc1c7d950/logs`. 23:13:19 KST 25샘플째 CPU 29.25%, available RAM 12.63GiB, commit 26.93%, 경보 없음. 온도는 unavailable/PawnIO_driver_not_installed. 이전 전환용 기록 2개는 정상 중지 exit 0, 중간 PowerShell 센서 worker는 실행 정책으로 exit 1이었다. 정책 변경 없이 C# 콘솔 프로그램으로 대체했다.
- 센서 프로그램은 Windows 기본 C# 컴파일러로 별도 동결 소스에서 compile exit 0, 실행 probe exit 2로 드라이버 미설치 상태를 정확히 반환함. 실제 온도/팬 조회 경로는 드라이버 승인·설치 후 검증해야 한다. 실행물 그룹 `run:FU-01-direct-sensor-build:20261104T141121431Z-d6701bb7-2e40-4b3e-814a-818808443992`; 라이브러리 그룹 `run:FU-01-direct-sensor-runtime:20261104T140723998Z-6dadb152-b6ac-402e-8c8e-42d3e910a1ae`. CPU/보드 읽기만 활성화하며 fan control/MSR 쓰기 호출을 추가하지 않는다.
- 앱 미사용 전 실행한 HWiNFO PID 29232(23:01:33 KST)는 정확한 process identity를 확인하고 종료를 시도했지만 Access is denied. 종료·정리 미완료이며 이 앱의 데이터를 사용하지 않는다. 런타임 그룹 `run:FU-01-hwinfo-runtime:20261104T140051726Z-b0402fb4-d35c-44fa-a6bc-dcf82ed6f851`은 활성/권한 미해결 프로세스 때문에 보호한다(실행파일 11,484,648 bytes). 관리자 종료 또는 사용자 종료 확인 후 참조를 해제하고 기존 owner로 정리해야 한다.
- 사용자 승인한 빌드 세션 연락을 기존 관리 bridge로 시도: 실제 선택 엔진 endpoint를 조회하여 연결 성공했으나 thread/read에 -32601 `method is not allowed by the azrael bridge` 거부. 메시지 전송 완료 아님. Window Use context도 connection_error로 사용할 수 없음. 거부를 우회하지 않고 사용자에게 지정 스레드에서 재개 요청을 보내도록 요청함. 새 엔진이나 경쟁 턴을 시작하지 않음.
- 사용자가 빌드 세션에 요청을 보냈다고 확인했다. 다른 세션의 실제 재개 완료는 아직 독립 확인하지 않음.
- 독립 끊김 감시 work ID `0c5a48ef-45a4-4c32-9442-e7c9b84fd776`, native session 59011, PID 31860, 그룹 `run:FU-01-live-watchdog:20261104T141610953Z-5f042832-2a80-4af0-9097-74685d784418`. 로그는 해당 run의 `logs/heartbeat.jsonl`. 0.25초 검사/1초 durable heartbeat, 1초 이상 공백 경보. sleep 가능성과 이전 fsync 지연을 별도 표시한다. 기존 monitor 종료 시간에 맞춘 잔여 구간을 수집한다.
- 끊김 검증: 소유 테스트 프로세스의 sleep에만 1.4초 지연을 주입, 실제 1.4004358초 gap을 검출. 분석기가 실제 앞 sample 1/뒤 sample 2를 연결하고 NUL 손상 행 1개를 별도 집계함. 테스트 실제 exit 0. 독립 감시까지 공백이어도 OS 전체 정지 확정이 아니며, 전체 정지 중 수치는 측정 불가. 강제 재부팅 후 stop 부재·마지막 생존 시각·Windows 부팅 기록으로 사후 대조한다.
- 8초 수집·STOP 검증 disposable 그룹 2개는 검증된 standalone owner review/apply로 삭제, remaining=false 및 실제 부재 확인 후 lifecycle finalize 완료. watchdog 검증 그룹도 같은 owner review/apply로 삭제 remaining=false, lifecycle finalize 완료. 활성 진단 JSONL과 실행 의존성은 수집·분석을 위해 유지한다.
- 23:30:10 KST까지 실제 monitor 516샘플. CPU 최대 74.80%, available RAM 최소 12.46GiB, commit 최대 29.49%. 수집기 6초 이상 공백 2개(23:26:40.105→23:26:57.584, 17.479초; 23:28:31.396→23:28:42.154, 10.758초), 독립 감시 1초 이상 지연 12개를 발견했다. 독립 감시 시작은 약 23:16:21이다.
- 위 두 수집 공백 안에는 독립 heartbeat가 각각 18개/11개 남아 있고, 해당 heartbeat의 직전 loop 간격 최대 0.251초였다. 따라서 두 공백을 전체 OS 정지로 분류하지 않는다. 당시 직전/직후 CPU 약 9~11%, available RAM 약 13.8~14.2GiB, commit 약 27.1~27.5%로 RAM 고갈 근거가 없다. CPU 온도는 여전히 미측정이다.
- 23:24:54→23:25:12의 독립 감시 지연 11개는 각각 직전 write/flush/fsync 소요와 거의 동일한 1.004~1.813초였다. 이는 로그 영구 저장 호출의 실제 지연 증거이며, 시스템 전체 정지나 SSD 물리 고장 증거는 아니다. 23:28:13.191→23:28:15.391 2.200초 지연은 직전 저장 소요가 0이어서 별도 미확정 스케줄링/시스템 지연으로 남긴다. 초기 11개는 관리자 드라이버 시작 요청(23:25:50)보다 앞선다. 서비스는 시작되지 않았고 IOCTL 센서 읽기도 실행되지 않았다.
- 해당 시간대 Application/ESENT warning/error 조회 결과 새 이벤트는 0개. 앞선 22:26:45의 16초 쓰기 지연과 함께 저장 경로 조사 단서로 보되 원인을 합쳐 확정하지 않는다. 소스·자료 수집은 계속 실행 중이고 30분 완료 결과가 아니다.

# CPU 냉각 진단
- 요청 구성: Intel Core i7-10700K / MSI MPG Z490 GAMING EDGE WIFI (MS-7C79) / DEEPCOOL LS720 ARGB. Windows 11 x64 로컬 진단. Azrael 제품 기능 변경 없음.
- 현재 진행 방식: 사용자가 나중에 제공하는 HWMonitor CSV 또는 센서 결과에서 온도·사용률·패키지 전력·클럭·팬/펌프 회전수를 함께 분석한다. 단순 RPM 존재나 짧은 기록만으로 정상/고장을 단정하지 않는다.
- 확보된 원본: C:\Program Files\CPUID\HWMonitor\logs\FELRER_2026_NOV_04_21h13.csv. 사용자 파일이며 삭제하지 않음. 약 172초 기록에서 CPU 최고 65°C, 최대 사용률 83.285%, 펌프 3133~3157 RPM. 실시간 갱신 중인 CSV로 검증되지 않았으므로 현재 상태나 30분 관찰의 근거가 아님.
- LS720 공식 사양: 펌프 3100 RPM ±10%, 팬 500~2250 RPM ±10%. 공식 LS 시리즈 보증은 5년이나 실제 판매자·국내 유통 여부·구매일·시리얼에 따른 적용 확인 필요. 구매 영수증 보관. 공식 제조사/브라보텍 보증 링크와 쿨러 후보 조사는 대화에 제공.

## 현재 멈춤 증상과 시간 대조
- 사용자 증상: 화면과 마우스 모두 멈춰 전원을 껐다 켬. 큰 물리적 충격 이력은 있으나 시점·관련성 미확인. 허용 범위는 로컬 기록 읽기와 분석이며 재현 빌드, 부하 테스트, 설정 변경, 수리·업데이트는 수행하지 않음.
- 최신 HWMonitor 원본 `C:\Program Files\CPUID\HWMonitor\logs\FELRER_2026_NOV_04_22h27.csv`: 145측정, 121→122번째 76.5→96.5초 사이 20초 공백. 전체 CPU 최고 68°C, 펌프 3133~3149 RPM. 공백 내부 상태와 이후 재부팅 직전 온도는 알 수 없음. 정상 RPM이 정상 유량을 입증하지 않음.
- 모든 아래 시간은 2026-11-04 KST. Application ESENT 508은 22:26:45.330에 C:의 qmgr.db 16KB 쓰기에 16초가 걸렸음을 기록. 이 시각은 아래 G 실행 시작 전이므로 G 실행으로 인한 경고라고 해석하지 않음. C:는 Samsung SSD 980 PRO 2TB. I/O 지연 원인이나 SSD 자체 고장은 미확정.
- 지정 스레드 `01a1a4c7-8e51-70f3-8a35-2a05ffb6186c`의 로컬 rollout과 실제 실행 기록 대조: G 빌드/VerifyOnly 프로세스 시작 22:31:08.175, 소스 검증 단계 시작 22:32:56.767. 설정은 CARGO_BUILD_JOBS=1, SourceTestConcurrency=1. 마지막 소스 검증 로그는 22:34:58.867이며 Bun OAuth 테스트 도중 끝남. 남은 receipt는 running/전체 종료 코드 없음, source invocation 19개, native/Cargo 실행 0개. Rust 컴파일 도달 기록 없음. 마지막 테스트가 원인이라는 증거도 없음.
- 실행 원본: `artifacts/tasks/FT-02-deployment/runs/20261104T133030730Z-0d657a76-f154-4df2-b546-e3ce59c0386b/reports/execution.json`; 파이프라인 원본: `artifacts/g/artifacts/logs/deploy-win017-ft02g-20261104/pipeline-state.json`; 검증 원본: 같은 로그 루트의 `engine-source-preflight/preservation-6NtfNe/receipt.json`.
- 디스크 관찰 원본: 위 실행 run의 `logs/disk-samples.jsonl`. 정상 JSON 8개, 마지막 22:34:42.990. C: 샘플 busy 0~3%, queue 0~3. 뒤 691 NUL bytes는 유효 샘플이 아니며 22:35:29 파일 수정 시각을 정상 측정 시각으로 사용하지 않음. 기록된 구간의 지속적인 디스크 포화 증거는 없으나 30초 간격이며 이후 상태는 알 수 없음.
- OS LastBootUpTime 22:41:39.500. Kernel-Power 41은 22:41:43.118, BugcheckCode=0, PowerButtonTimestamp=0, WHEABootErrorCount=0. 강제 종료/재부팅과 일치하지만 원인 판정 자료는 아님. EventLog 6008이 제시하는 22:16:00은 이후 실제 활동 기록과 맞지 않으므로 정확한 멈춤 시각으로 사용하지 않음.
- 20:00 이후 System에서 Resource-Exhaustion-Detector, WHEA-Logger, disk, stornvme, storahci, Display, WER-SystemErrorReporting 이벤트는 조회 결과 0개. 메모리 부족·하드웨어 오류 배제의 근거는 아님. 당시 CPU/RAM/commit 기록은 확보되지 않음. 현재 pagefile 47,104MB는 재부팅 후 상태이며 당시 여유 증거로 쓰지 않음.
- 결론: G 빌드/검증 진행 중 기록 단절 후 비정상 재부팅이라는 시간적 연관은 있음. RAM 용량 부족, RAM 불안정, CPU 냉각, 저장장치/드라이버, 기타 하드웨어 중 원인을 확정할 자료는 부족. 다음 재현 전에 CPU 온도·메모리 available/commit·프로세스 사용량·디스크 지연을 함께 기록하는 방식 권고. 다른 스레드 작업/보호된 원본은 수정·정리하지 않음.

## 실행·검증·정리 결과
- HWiNFO 8.54-6090 포터블은 공식 다운로드 페이지의 SAC 미러에서 받았으며 REALiX Authenticode Valid를 확인했음.
- 임시 읽기 전용 공유 메모리 수집기는 7개 파싱/유효성 검사에 통과(종료 코드 0). 실제 공유 메모리 조회는 WinError 2(종료 코드 1). 센서 데이터 갱신 검증과 30분 본 측정은 미실행.
- HWiNFO 설정 입력은 효과를 확인하지 못했으며 관리자 권한이 없는 작업 프로세스에서 소유 HWiNFO PID 32820 종료는 Access is denied로 거부됨. 권한 우회 없음.
- 사용자 요청에 따라 HWMonitor 사후 분석으로 전환. 정리 직전 HWiNFO 실행 프로세스가 없는 것을 확인했음. 이전 CSV 감시 프로세스는 종료 코드 1로 종료됐으며 별도 감시 실행 없음.
- 정리 그룹 hwinfo-monitor-20261104-01은 현재 membership과 참조를 재등록하고, 설치 identity를 검증한 maintenance_owner(c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680)로 review/apply 수행. 52,752,503 bytes 임시 ZIP·포터블·수집기·INI 그룹 삭제 결과 status=deleted, remaining=false, 종료 코드 0. artifacts/tasks/hwinfo-monitor-20261104-01/temporary와 빈 상위 작업 폴더의 실제 부재 확인. 보존할 임시 도구 없음.
- 제품 코드 변경·빌드·설치·커밋 없음. 이 문서는 진단 작업 기록이며 기존 HWMonitor 로그와 사용자 설정은 유지.

## 2026-11-04 23:55 KST 직접 센서 검증 및 재개
- 사용자 요청: 관리자 확인 재표시, 방금 부하와 대조. cpuz165는 23:49:26 서비스 시작 exit 0, 기존 Manual/Stopped에서 Running으로 변경. 원상 복구는 센서 수집 종료 후 필요. 드라이버 바이너리 변경 없음.
- 이전 30분 run 141217603Z와 별도 watchdog은 실제 종료 코드 0. CPU 최대 74.8043%, available RAM 최소 6.42465GiB, commit 최대 36.9935%, 시스템 수집 공백 2개. 23:42 종료 이후 사용자 보고 부하는 해당 기록에 없음.
- 관리자 실행에서도 첫 장치 열기는 WinError 5. 정적 분석으로 IRP_MJ_CREATE의 SeSinglePrivilegeCheck(LUID 10)를 확인. Windows LookupPrivilegeValue로 SeLoadDriverPrivilege 일치를 검증하고 이미 부여된 특권만 활성화, CreateFileW 직후 원래 상태로 복원하도록 수정. 계정 권한/ACL/보안 설정 변경 없음.
- 23:52 run 20261104T145233605Z-0a6d1733-fc22-4cf3-839c-dd4977f98967은 STOP으로 정상 종료 exit 0, 센서 exit 2. RAM/CPU/디스크 기록은 보존.
- 새 run 20261104T145512556Z-2b8613a9-4509-4798-bb66-e33e4b00180c; managed work 38d2945b-df9f-4554-8022-bec4c05f7e9e, native session 50471. 시작 약 23:55:22, 1800초. hardware.jsonl / system.jsonl / heartbeat.jsonl / alerts.jsonl을 같은 logs 폴더에 기록. CPU 직접 센서 및 시스템 통합 스냅샷 freshness/status 검증 성공, 실제 오류 없음. 23:55:29 CPU 패키지 53도, 전력 56.0868W. 팬/펌프 RPM 미구현.
- 구문 검사, DTS validity/70도 계산/허용 MSR 제한 테스트 exit 0. 실제 신규 수집에서 phase/end/write 계측 필드와 독립 heartbeat 존재 확인. 23:42 이후 Windows System warning/error 조회 0건; Application 해당 이벤트 조회 결과 없음(exit 1), 하드웨어 정상 판정 근거로 사용하지 않음.
- 아직 진행 중: 30분 결과 분석, 기존 불필요 런타임 정리 및 HWiNFO 종료 권한 문제, cpuz165 원상 복구. 진단 원본은 현재 분석에 필요한 자료로 유지.
- 23:55:58 실제 부하 대조: CPU 94.8242%, 패키지 온도 69도, available RAM 10.8890GiB, commit 33.7333%, alerts 없음. 부하 자체를 고장으로 해석하지 않음.
- 임계 경보/수집 종료를 기다리는 읽기 전용 watcher를 실행: work 55071b37-f52e-42ee-ab77-ff163a3d3d6f, native session 23769. alerts.jsonl에 경보가 기록되거나 status가 running에서 변경될 때 실제 종료 신호를 반환. 최대 1860초. 메인 실행 session 50471은 별도로 실제 종료 확인 필요. 경보 시 현재/직전 수치와 독립 heartbeat를 대조하고, 경보 없이 종료 시 전체 30분을 분석한다.
- Windows API 근거: https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-adjusttokenprivileges (이미 존재하는 특권의 활성/비활성만 조정).

## 2026-11-05 00:10 KST 경보 조사와 수정
- watcher 실제 exit 0으로 자동 재개. 원인은 00:08:40 hardware_sensor_data_stale. 00:08:35 센서 원본 오류는 sensors.json.tmp -> sensors.json os.replace WinError 5이며 장치 IOCTL 오류가 아님. Windows 읽기 핸들과 교체의 경합 가능성을 처리. 파일 권한/속성 변경 없이 보통 rename을 최대 10회/20ms 간격으로 재시도, 지속 실패는 snapshot_unavailable 이벤트로 기록하고 원본 hardware.jsonl 수집은 유지하도록 수정.
- 첫 센서 run 145512556Z는 STOP 후 실제 종료 exit 0 (sensor worker는 오류 exit 2). 422 시스템/396 하드웨어 샘플, 온도 최대 76도(00:03:12), 마지막 실제 온도 72도(00:08:32). CPU 최대 98.9855%, RAM 최소 5.0060GiB, commit 최대 44.0530%. 시스템 6초 이상 공백 0개. 독립 heartbeat 1초 이상 지연 22개, 최대 2.6532초, 모두 previous_flush로 설명 가능. OS 전체 정지 확정 근거 없음.
- 새 run 20261104T150953322Z-3f6fa343-0d11-4a01-be9f-29c9beb79217, work 74ca24bc-ffd2-45db-b973-6dadbf3dd2a7, native session 44672. 960초 남은 기록. 00:10:20 CPU 95.5392%, 온도 71도, 전력 138.465W, available RAM 8.60795GiB, 센서 status ok / errors 없음 / alerts 없음.
- test_cpuid_sensors.py에 DTS validity, 허용 MSR, 일시적 파일 경합 재시도, 지속 실패 재시도 상한 회귀 검사 유지. 실제 4개 통과 exit 0, 실행 0.003초. 새로운 수집이 이미 진행 중이라 frozen input은 수정하지 않음.
- 새 경보/종료 watcher work b8cea1d5-96a6-4d05-acb8-5988841c0730, native session 2364. 현재 임계 경보가 없으므로 경보 또는 남은 960초 종료 후 분석 재개. 원래 30분 수집은 수정 재시작 때문에 두 구간이며 공백을 보간하지 않는다.
- 쿨러·보증 독립 조사 결과는 README 소유 섹션에 기록: DeepCool LS 공식 5년, 구매 증빙/시리얼/정식 유통 여부 미확인. NH-U12A LGA1200/158mm 공식 사양 확인, 케이스 높이와 보드 간섭 및 이 PC 장시간 성능은 미검증. CPU별 Noctua 호환성 사이트는 웹 접근 오류. 관측만으로 쿨러 교체 필요를 확정하지 않음.

## 2026-11-05 00:26 이후 최종 결과·정리 상태
- 새 960초 수집 정상 종료: main/sensor/watchdog 실제 exit 0, watchdog watcher exit 0. 시스템과 센서 각 477샘플, temp 38~77도, free RAM 최소 4.71708GiB, commit 최대 43.8438%, system gap>=6초 0, alerts 0, snapshot/하드웨어 오류 0. 독립 감시 gap 106개 모두 이전 flush 시간으로 설명, 최대 3.30268초. 첫 구간과 합친 최고 CPU 98.9855%, 온도 77도, package power 152.2239W.
- 정리용 관리자 실행(native session 48668)은 사용자 취소. shell 출력 RestoreExitCode 공란이므로 복원 성공으로 취급하지 않음. cpuz165 Running/Manual, HWiNFO 29232 활성으로 마지막 확인. 취소 후 재요청·우회 없음.
- 결과 확인 원본 4그룹, 합계 10,575,764 bytes의 정확한 그룹/경로/목적/확인 후 삭제를 README에 안내. 현재 사용자 확인 및 환경 복원·정리 대기. 유지 소스와 사용자 HWMonitor 원본은 정리 대상 아님.
- 이전 불필요 trial 3개와 LHM 런타임/빌드는 cleanup-disposable.cjs로 소유 확인·참조 해제·기존 native owner register/review 진행. run 20261104T152932964Z-fa31ecdd-3a86-490d-b10b-77431ab60fce, native session 78053. 검토 토큰을 확인한 뒤 명시 적용하며, 보호된 HWiNFO는 삭제 대상에서 제외.
- cleanup native review blockers 0, root가 reviewHash bd5ea27ba5cf227036bd285562c2b0fa7ed47d680decce0d89e95bd556008add 및 5개 현재 토큰에 명시 삭제 결정. apply 실제 5개 모두 deleted/remaining=false, 파일 경로 부재 확인과 lifecycle finalize 완료, controller exit 0. 총 7,607,232 bytes. native apply 약 3분대 소요로 1회 단계 확인했으며 중복 실행 없음. 일회성 cleanup-disposable.cjs와 사용하지 않는 hardware-sensors.cs 소스도 제거 확인(False/False).
- 환경 복원 취소 이후 HWiNFO runtime 보호를 위한 별도 consumer 그룹 run:FU-01-environment-hold:20261104T153808422Z-ecbeeea2-0232-458d-ab6f-5495394b63e8 생성. proof generator exit 0, 활성 사용 dependency는 유지(실제 앱 종료와 별개). pending-restoration.json에 정확한 PID/생성 시각 및 cpuz165 원래/현재 상태를 기록.
- 확인용 원본 4그룹 + 정리 증거/보호 런타임/복원 상태 3그룹 합계 22,150,503 bytes(약 21.12MiB); 목적·정확한 그룹/경로·크기·사용자 확인 및 실제 프로세스 종료 후 삭제 조건을 README에 안내. 최종 단계는 awaiting user confirmation with cleanup pending. 진단 구현·실제 수집/분석은 수행했으나 멈춤 원인 확정과 팬/펌프 RPM은 미달성. 환경 복원용 관리자 실행 재승인은 사용자 취소 이후 아직 없음.

## 85도 초과 시험 중지 설정
- 사용자 승인 범위는 시험 중지 온도를 85도 초과로 설정하는 것. 실제 부하 실행과 취소됐던 관리자 실행은 이번 설정 작업에서 재요청/재시도하지 않음. 대상은 기존 Windows x64/i7-10700K/16논리 CPU이며 Azrael 제품 기능은 변경하지 않음.
- 기존 CPUID Reader, sensor snapshot, 시스템/독립 감시 및 artifact-run launcher를 재사용. 일반 모니터 경보도 CPU >85도로 변경하고 --stress 명시 선택 시에만 새 감독기를 사용. 기본 모니터는 부하 생성 없음. 기존 90도 기준 frozen 기록은 변경하지 않음.
- guarded-stress.py: 패키지/논리 CPU 어느 값이든 >85면 자기 작업자만 먼저 종료, 센서 오류/유효 온도 누락/1초 이상 읽기 지연도 중지. 0.25초 목표 읽기와 1초 공유 유효기한으로 감독기가 정지해도 CPU 작업자가 실행 가능한 동안 스스로 종료. 전원/팬/다른 앱/다른 빌드에는 개입 없음. 정지 증거가 없으면 launcher lifecycle은 미완료 보호 상태로 유지.
- test_guarded_stress.py 5개 검사 실제 통과(exit 0, 최종 0.846초): 85/85.1 경계와 모니터 경보 일치, 논리 CPU 고온, 센서 실패, 실제 유휴 작업자의 중지 및 감독 갱신 만료. 실제 부하와 하드웨어 읽기를 만들지 않는 검사. 잘못 >=85 또는 과거90도로 되돌리거나 센서 실패 시 계속 돌리는 실수를 방지하기 위해 유지. JS syntax exit 0, 최종 Windows x64 범위 검사 수정 후 Python AST 검사 통과.
- 새 시험용 실행 산출물은 만들지 않았으며 생성한 파일은 유지 소스/회귀 검사/문서뿐. 기존 원본 확인 묶음과 환경 복원 대기 상태는 유지. 고온 실제 종료·CPU 부하 생성·새 launcher 실행 통합은 아직 미검증이며 실제 시험 승인 및 관리자 확인이 다음 조건.

## 2026-11-05 C: 저장 경로 지연 조사
- 사용자의 관리자 읽기 전용 SSD/필터 조회 승인(“네”)으로 `collect-storage.cjs` 실행. 기존 artifact-run 소유자 재사용, 입력 고정, native UAC, 정책 우회 없음. node 구문 검사 exit 0; 실제 managed work 9b4f1056-863c-49f3-bc50-972d624a33c1 / native session 60218 exit 0, producerStopped 정상 종료. 상세 결과와 한계는 README의 C: 조사 섹션 소유.
- 출력 run 20261105T002456001Z-108624e1-ee1c-45b7-9222-88b160727582, 관리자 수집 09:26:05~09:26:07 KST. C: disk2 980 PRO 5B2QGXA7, 36°C, 오류 카운터 null, flush 최대 2,576ms(시각 없음). TemperatureMax 82는 과거 최고 온도가 아닌 정상 작동 한계 항목으로 해석.
- 실제 C:에 cbfltfs4 인스턴스 확인. 드라이버 Valid EldoS 서명 / CallbackFilter 4.1.105.114 / Boot / altitude380710. 제한된 앱·서비스 조회에서 설치 주체 미확인. 서비스 중지·필터 해제·재부팅·드라이버 업데이트·부하 시험 없음. CldFlt는 0 instances이므로 C: 연결 추정을 철회.
- SSD의 오류 0건 또는 고장 확정 모두 불가. ESENT 파일 열기/경로 36초 지연은 물리 섹터 I/O 지연과 구분해야 하며, 다음 증거는 재발 시 Disk/File I/O와 DPC/ISR 동시 ETW 대조. 원인 확정과 기존 환경 복원·사용자 확인/정리 대기는 남음.
- 새 확인 자료 12,332 bytes/8 files, 정확한 그룹/경로/목적/확인 후 삭제를 README에 추가. 확인 묶음 전체 8그룹 22,162,835 bytes. 현재 필요한 진단 증거이므로 삭제하지 않음. 기존 취소된 복원 작업을 이번 읽기 동의로 재실행하지 않음.

## 2026-11-05 10:00 KST 직접 검사 실행
- 사용자가 지연 중이던 검사를 종료하고 필요한 검사를 직접 실행하도록 승인. Windows x64 C:에 한정하여 NVMe SMART 표준 IOCTL 조회, 최근 이벤트, read-only `chkdsk C:`를 선택. `/f`, `/r`, `/scan`, 디스크 쓰기·수리·최적화·self-test·재부팅은 요청하지 않음. 기존 취소된 환경 복원은 별개로 유지.
- 기존 collector에 `--diagnose` 추가, 기본 조회 경로 유지. `nvme-health.py`는 Windows SDK의 STORAGE_PROTOCOL_DATA_DESCRIPTOR와 NVME_HEALTH_INFO_LOG를 사용, CreateFile desiredAccess=0, IOCTL_STORAGE_QUERY_PROPERTY/log02만 호출. 디스크 번호는 실행 시 C: 매핑에서 받음. raw SMART 경고가 있으면 파일시스템 검사를 보류. 활성 chkdsk/defrag가 있으면 중복 실행 거부.
- 최소 검증: Node syntax exit 0, Python 실제 parser fixture에서 Kelvin/128bit media error/percentage used 검증과 잘린 응답·잘못된 descriptor 거부 모두 통과. 일회성 stdin 검사로 별도 임시 테스트 파일 없음. 새 소스는 실행 입력에 고정 복사. 실제 하드웨어 결과는 별도 확인 필요.
- 실행 run `20261105T010106205Z-99eff1e8-b52e-424e-991f-4a7617d2c137`, managed work `369ea7e2-29ae-4faf-88ec-b6c6b4095535`, native session 71444. 10:01 시작, 현재 관리자 wrapper 대기 중이며 수집 결과/CHKDSK 시작 증거는 아직 없음. 중복 실행하지 않음.
- 독립 PDH 10:01:39~49 6개 샘플은 C: read 0.108~0.179ms, write 0.027~0.044ms, queue0~1; 수집 exit0. 이 짧은 구간은 지연을 재현하지 않았으며 과거 지연을 배제하지 않음.
- 10:03:22 종료 증거: managed work failed / 실제 exit1, stderr `Start-Process ... The operation was canceled by the user`, outputExists=false. consent.exe 대기 후 사용자 취소가 반환되어 관리자 수집과 CHKDSK는 시작되지 않음. 자동 재요청/다른 권한 경로로 재시도하지 않음. 다음 관리자 검사는 재승인 필요.
- 별도 일반 권한 이벤트 조회 exit0: 09:58:26 Chkdsk26226의 기존 검사 부분 결과는 파일 레코드17,862,144개, 1단계2.10분, 잘못된 파일 레코드0개, 2단계 진입 이후 전체 완료 결과 없음. 09:48:16 및09:51:36 C: retrim 성공258. 09:44:39 C: defrag 취소264는 사용자가 취소함0x89000006. 최근1시간 System storage/WHEA 대상 이벤트 없음. 현재 chkdsk/defrag 프로세스 없음. 파일 레코드가 많다는 점은 검사 시간이 길어질 설명 후보이지 멈춤 원인 확정은 아님.
- 실패 run 16,765bytes/8files는 재승인·결과 확인에 필요한 실행 미시작 증거이며 README 확인 묶음에 추가. 원본 미생성으로 SMART 실측 검증과 파일시스템 전체 검사는 여전히 미완료. 전체 확인 묶음9그룹22,179,600bytes, 정리 대기.

## 2026-11-05 10:53 KST 재승인된 검사
- 사용자 “네”로 UAC 재요청 승인. 기존 검사 소스를 변경 없이 재사용한 새 실행: run `20261105T015258758Z-6cf2ebdf-cb15-469f-97e5-688aee074786`, managed work `19c19408-94da-44e4-9646-16f1859aa099`, native session40449. 관리자 수집 시작10:53:17, SMART 직접 조회10:53:20 exit0, read-only CHKDSK 시작10:53:21. 기존 실패 결과를 성공으로 바꾸지 않음.
- 실제 NVMe 응답 검증 성공: C: disk2, criticalWarning0, availableSpare100%, percentageUsed3%, powerOnHours1820, unsafeShutdowns100, mediaAndDataIntegrityErrors0, errorInformationLogEntries0, warning/critical temperature minutes0, composite37.85°C, 센서37.85/47.85°C. 직접 SMART 수명 사용률3%는 이전 Windows reliability Wear0과 다른 보고값이며 직접 NVMe 값을 우선 표시. 비정상 종료100회는 원인/결과 구분 불가.
- CHKDSK 완료 대기. 최초 체크포인트 output JSON은 검사 시작 전 중간 상태이므로 전체 완료 판정에 사용하지 않음. 기존 1,786만 파일 레코드 규모를 고려하여 중복 검사 없이 종료 신호를 기다리고, 10분 후에도 미완료면 진행 로그와 실제 프로세스 상태를 확인.

## 2026-11-05 12:07 KST 멈춤 후 재부팅 조사
- 사용자 확인: 화면 멈춤 뒤 직접 재부팅. 관리 실행 관측 unknown/exitCode 없음, 현재 CHKDSK 프로세스 및 최종 result.json 없음. 검사 성공 처리·재실행 없음. 원본 run은 interrupted/unknown 진단 증거로 보호 유지; producer 복구/참조 해제는 별도 소유자 절차 전까지 하지 않음.
- LastBootUpTime11:49:44.500, Kernel-Power41 기록11:49:46.552 KST, BugcheckCode0/PowerButtonTimestamp0/WHEABootErrorCount0. 수동 재부팅 결과이므로 자동 크래시·전원 고장 증거로 쓰지 않음. 6008 메시지10:42:10은 검사 시작 전 시각과 불일치하여 이번 멈춤 시각으로 사용하지 않음.
- CHKDSK 로그 최종 쓰기11:01:59.494, 마지막2단계81%/전체63%,19,349,325/23,700,038 처리. 파일 레코드17,948,672개,1단계2.27분, 잘못된 레코드0개. 마지막 기록은 실제 freeze 시각 확정이 아님. 전체 검사 결론/exit 미제공.
- 10:57:07.040 Application WER1001 RADAR_PRE_LEAK_64/chkdsk.exe 보고. RAM 고갈을 입증할 사용량이 없고 Resource-Exhaustion-Detector 이벤트도 발견되지 않음. 현재 재부팅 후 pagefile47,104MB는 크래시 직전 사용량으로 취급하지 않음.
- 10:53~11:49:40 System 경고/오류 조회0건. MEMORY.DMP 없음, Minidump 열거 파일 없음. 재부팅 후 LiveKernelEvent1cc/1a8/1b8 보고는20261029/20260826 덤프를 참조하므로 이번 원인에서 제외. NTFS98 Healthy는 전체 CHKDSK 완료를 대신하지 못함.
- SMART 매체오류/오류로그0이지만 파일시스템·필터/드라이버·SSD컨트롤러/연결·RAM 가능성은 남음. 백업 후 Windows 복구환경에서 수정 없는 검사로 활성 Windows 필터 영향을 분리하는 것이 다음 제안이며 재부팅/오프라인 검사는 실행하지 않음.

## 12:09 재시도와 빌드 읽기 범위 검사
- 사용자 CHKDSK 재시도 승인으로 run20261105T030906909Z-80f304e1-1944-4a57-98a5-a3e0245542c9 시작. managed work bb9837bf-d713-4ad3-b08f-f828d3aeb0f4, native64610, monitor18356(12:09:33 시작), CHKDSK2164(12:09:38 시작). monitor.py 재사용, --monitor 자식 종료는 검사 종료 후 STOP/close 실제 확인으로 묶음. CPU/RAM/디스크 기록이며 CPU 온도 센서는 이번 경로에 없음.
- 실제12:09:53~12:10:11 약18초,12:10:15~12:10:44 약28.8초 gap. 각 previous_write17.985/28.761초로 로그 쓰기/flush/fsync 내부 시간이 대부분. OS 전체 멈춤과 저장 경로 정지 중 어느 쪽인지 단독 판별 불가. 해당 전후 available RAM14.6~20.6GiB, capacity exhaustion 관측 안됨. 12:13 여유2.51GiB/commit43.6%, 검사 진행 중.
- 후속 사용자 요청은 빌드가 읽는 부분 집중 검사. 현재 조회된 컴파일/Robocopy 프로세스 없음. 활성 CHKDSK와 새 읽기 검사 중복은 피함. 이전 K 입력 준비 manifest를 재사용하여 범위 고정: FT-02-k-inputs/run20261105T001605110Z-1f65e40b-a129-4267-96bf-d798291a90cc/reports/deployment-workspace.json, immutableInventory26,997파일. 복사964.76초,최종hash9.57초로 쓰기/생성/필터 가능성도 남음.
- probe-build-reads.py/start-build-read-probe.cjs 준비. 각 컴포넌트 최대20개 표본, .git제외, 실제 immutable input만 읽기. recursive탐색 없이 manifest선택, 링크거부/프로젝트 containment, 파일32MiB/총256MiB/120초 한도, 작업2초 지연 또는오류/해시불일치시중지. OS캐시를 비우지 않고 read+hash 시간 포함, 물리 섹터/전체 파일 검증 주장 금지. 실제 테스트 입력 dependency 유지.
- Python AST 및 Node 구문검사 exit0. 실제 표본검사는 CHKDSK 종료 후 실행 대기. 제품 소스/다른 빌드/보안설정 변경 없음.

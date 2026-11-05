# GrowKick 작업공간 멈춤: 커널 덤프 분석

상태: 진단 결과 확보. 원인과 해결은 미확정이며 설정·드라이버 변경은 아직 승인·실행하지 않았다.

## 범위와 보존

- Windows x64에서만 조사했다. `C:\Users\felre\Desktop\GrowKick`은 열거나 열거하지 않았다.
- 사용자는 GitHub에서 복원한 `D:\Recovery\GrowKick`을 VS Code로 열어 정상 동작한다고 확인했다. 원격 소스 자체의 손상보다 원본의 로컬 상태·저장 영역·작업공간별 동작을 구분해야 한다.
- 설치된 Azrael은 `2026.0.16`이다. 현재 체크아웃의 미설치 변경과 구분했다.
- WinDbg `1.2610.1001.0` 설치는 성공했다. 최초 관리자 실행 요청은 도구 정책으로 거부되어 실행되지 않았다. 사용자가 복사한 덤프를 일반 권한으로 분석했다.

## 실제 입력과 결과

- 사용자 제공 입력: `D:\Recovery\110526-9703-01.dmp`, 4,271,428바이트.
- SHA256: `01d24ed116d35a599244e15feab70e1656c6f5481aa8c6d66bc581f06718ee03`.
- 덤프 시각: 2026-11-05 16:16:28.487 KST. 시스템 가동 시간: 11분 16.450초.
- Windows System 이벤트 1001은 16:17:44 KST에 이 덤프와 `HYPERVISOR_ERROR (0x20001)` 재부팅을 기록했다.
- CDB의 `.bugcheck; !analyze -v; kv; lm; !sysinfo cpuinfo; q` 실행 종료 코드 0. 입력 크기·수정시각 불변을 확인했다. 별도 `lmvm nvlddmkm; q` 조회도 종료 코드 0.
- `PROCESS_NAME`: `Taskmgr.exe`. 현재 프로세스 이름만으로 해당 프로그램을 원인으로 볼 수 없다.
- `MODULE_NAME`: `nvlddmkm`; `IMAGE_NAME`: `nvlddmkm.sys`.
- `SYMBOL_NAME`: `nvlddmkm+6babd2`.
- `FAILURE_BUCKET_ID`: `0x20001_11_1003b3240_nvlddmkm!unknown_function`.
- 스택은 `nt!KeBugCheckEx`, `nt!HvlSkCrashdumpCallbackRoutine`, NMI 처리 경로, `nvlddmkm` 위치를 포함한다. 비동기 NMI 시점의 실행 위치는 근본 원인의 확정 증거가 아니다.
- NVIDIA 모듈 덤프 타임스탬프: 2026-10-01 06:34:24, `0x6ABD8060`; 이미지 크기 `0x06D45000`.
- 현재 장치 조회: NVIDIA GeForce RTX 2070 SUPER, 드라이버 `32.0.16.1742`, 하이퍼바이저 존재. VBS 상태 2, 실행 중 보안 서비스 `[2]`를 관측했다.

## 분석 한계

- 덤프 데이터 확장 읽기 및 NVIDIA 타임스탬프 검증 경고가 있었다. `!sysinfo cpuinfo`는 필요한 인터페이스가 없어 CPU 정보를 얻지 못했다. 종료 코드 0을 모든 하위 조회 성공으로 해석하지 않는다.
- 한 덤프에서 NVIDIA 드라이버가 식별됐다는 사실은 GPU 하드웨어 고장, 드라이버 결함, 하이퍼바이저 결함 또는 Azrael의 무관함을 확정하지 않는다.
- WER의 같은 ReportId 반복 등록은 새로운 충돌 횟수로 세지 않았다. `0x1CC` 보고서는 최소 2026-10-29부터 존재해 이번 충돌의 신규 증거에서 제외했다.

## Azrael 작업공간 조사

- 실제 설치본의 초기화에는 프로젝트 루트 전체 순회가 확인되지 않았다. 로컬 이력 가져오기와 Window Use 검증은 해당 설치 설정에서 비활성 상태다.
- C 작업공간에 남은 재개 영수증 35개는 모두 `finished`다. 실행 대기 35건으로 해석하지 않는다.
- 설치본 `out/extension.js`의 Git watcher는 시작 시 `git status --ignored=matching --untracked-files=all --porcelain=v1 -z`와 `git ls-files --cached -z`를 저장소 전체에 실행하는 경로가 있다. status 기본 제한시간은 60초이며 해당 호출에 출력량 제한은 확인되지 않았다.
- 로컬 watcher는 `RelativePattern(root, "**")`로 재귀 감시한다. 계산된 ignored-directory 목록이 인수로 전달되지만 수신 함수 `fKe(host, options)`에서는 소비되지 않는다. VS Code 자체 제외 규칙의 적용 및 이 경로가 원본에서 유발한 실제 부하는 미확인이다.
- Git watcher 정적 조사는 저장소 규모에 따른 부하 후보다. 위 커널 충돌과의 인과관계는 입증되지 않았다.
- GitHub 접근 403은 정상 D 작업공간에서도 발생해 단독 원인으로 보지 않았다.

## 다음 조치 제안 — 미실행

1. D 복구본에서 작업을 계속하고 C 원본 재현은 피한다.
2. 사용자 승인 후 VS Code 하드웨어 가속만 끄는 되돌릴 수 있는 시험을 우선 검토한다. VS Code 재시작이 필요하며 성공을 미리 보장하지 않는다.
3. NVIDIA 드라이버 교체 및 VBS/하이퍼바이저 설정 변경은 별도 영향 검토·승인 대상으로 둔다.
4. Azrael watcher의 제외 목록 전달과 초기 Git 탐색 비용 개선은 커널 진단과 별도의 코드 수정으로 제안한다.

공식 근거: [HYPERVISOR_ERROR](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/bug-check-0x20001--hypervisor-error), [VS Code GPU 비활성화 옵션](https://code.visualstudio.com/docs/configure/command-line), [VBS 상태 조회](https://learn.microsoft.com/en-us/windows/security/hardware-security/enable-virtualization-based-protection-of-code-integrity).

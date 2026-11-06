상태: 승인된 캐시 재사용 개선 구현·Windows 검증·임시 산출물 정리 완료. 선행 미커밋 작업과의 분리 문제로 커밋은 하지 않았으며, 실사용 성능과 컴퓨터 멈춤 해소는 미확인.

# 주기적 컴퓨터 멈춤 조사

## 범위와 권한

CPU/RAM 이외의 Azrael 관련 부하 및 Windows 지연 원인을 읽기 전용 시스템·프로세스·로그·소스 조사로 좁힌다. 제품 수정, 종료, 서비스 변경, 빌드 실행은 승인되지 않았다. 현재 Windows x64 로컬 데스크톱에 한정하며 Linux/macOS는 미검증이다. 스트레스 테스트나 전역 파일 스캔은 하지 않는다. 관측 부하, 코드상 비용, 실제 멈춤의 인과관계를 구분한다.

## 관측 결과 (2026-11-04 KST)

- 활성 공유 엔진 PID 7004: win016-ez01-paint-r8-20261102, 08:03:42 시작. build-info의 engineSourceRoot는 artifacts/x/ez01i16short/project/engine, engineVersion 0.162.0. 문서의 이전 설치 버전 대신 실제 프로세스 경로를 사용했다.
- 13:17 전후 성능 표본: PID 64520 이미지 첨부 검증 약 133 MB/s 프로세스 I/O, PID 36780 패키징 검증 약 18.8 MB/s. 프로세스 I/O에는 캐시 등도 포함되어 물리 디스크 전송량과 같지 않다.
- `scripts/check-agent-image-attachments.cjs:51`은 seed Cargo target 전체를 `copyTree`로 복사. `scripts/freeze-platform-inputs.cjs:40`은 파일별 원본 해시→복사→대상 해시→원본 해시를 수행한다. I/O 증폭 경로는 확인했지만 멈춤의 직접 원인은 미확인.
- 13:19:51~13:19:59, 2초 간격 5개 표본: C: 27.1~82.3 MB/s, 평균 전송 지연 0.087~0.130ms, 순간 대기열 0~2. 전체 CPU 기준 DPC 0.44~1.02%, interrupt 0.58~1.31%. 이 구간은 지속적 디스크 포화 증거가 없다. 순간 멈춤이나 개별 코어 지연은 배제할 수 없다.
- Windows BcastDVRUserService_112c91은 Stop Pending, PID 54164. DCOM 10029가 약 4분 간격으로 AppCaptureShell/AppCaptureManager 활성화 시간 초과를 기록하며 24시간 275회. 사용자 증상과 시간 일치 및 Azrael과의 관계는 미확인.
- audiodg PID 3772: 핸들 40,797개, private 약 41 MB. 두 관측에서 핸들 수 동일. 높은 수치만으로 누수나 멈춤 원인이라고 판단하지 않는다.
- 시스템 부팅 10월 31일 15:25. 최근 24시간 System 경고·오류 중 DCOM 외 Google Drive 드라이버 버전 불일치 2회, Windows 업데이트 서비스 시작 시간 초과 2회. 최근 12시간 Application error 조회는 이벤트를 반환하지 않았다.
- C: 여유 181.8 GiB, D: 3.0 GiB, E: 11.3 GiB. 표본에서 D: I/O는 없었으므로 D: 여유 부족과 증상 관계는 미확인.
- maintenance_owner PID 42780은 작업대 lease 보유용이며 정리 스캔으로 단정할 근거가 없다.
- native 로그 검사 13:21 실행 종료 코드 0: 15분 8,467행 중 상한 5,000행만 검사되어 전체 오류 분포로 사용하지 않는다. 로그 본문/인증 데이터는 노출하지 않았다. DB 약 85.5 MB, WAL 약 48.7 MB.
- 이미지 검증 기존 로그는 13:20:06 protocol 단계 결과까지 생성. 패키징 검증 기존 로그는 node.exe hardlink EPERM 실패를 기록하고 이후 PID 36780은 관측되지 않음. 다른 작업의 종료·재실행·정리는 수행하지 않았다.

## 다음 판정

사용자의 최근 멈춤 시각, 마우스/소리 중단 여부와 주기를 받으면 DCOM 반복과 비교한다. 부하성 작업 중단 전후 비교나 서비스 재시작은 별도 동의를 받아 진행한다. 현재 자료만으로 Azrael의 심각한 런타임 버그 또는 Windows 서비스가 원인이라고 확정하지 않는다.

## 기록 관리

조사 보고서는 이 파일에 유지한다. 임시 계획 본문은 생성 직후 일반 삭제하고 부재를 확인한다. 별도의 추적 파일, 덤프, 빌드 산출물은 생성하지 않았다.

추가 관측: GPU Engine 단일 표본 최대 약 1.75%(Code PID 44328), 최근 4일 System/Display 이벤트 조회는 반환 이벤트 없음. GPU 드라이버 순간 정지를 배제하는 검사는 아니다. 명령 exit 1은 마지막 Get-WinEvent의 이벤트 없음으로 발생했으며 GPU 표본 수집은 성공했다.

## 사용자 요청에 따른 녹화 서비스 종료

사용자가 BcastDVRUserService 종료를 명시적으로 요청했다. 대상은 BcastDVRUserService_112c91. PID 54164의 svchost.exe가 이 서비스만 보유함과 정확한 명령행을 종료 직전 재확인했다. sc stop은 1061(제어 메시지 수신 불가)로 실패. Stop-Process는 exit 0이며 기존 PID 부재를 확인했다. 그러나 2초 뒤 서비스 PID 65288, 후속 관측 PID 43192로 바뀌며 Stop Pending이 계속됐다. sc qfailure는 실패 시 3000ms 후 RESTART 두 항목을 반환했다. 기존 프로세스 종료는 성공했지만 서비스 정지 상태 유지에는 실패했다. 반복 종료는 하지 않았다. 시작 유형 Manual과 복구 설정은 변경하지 않았다. 자동 재시작 차단/서비스 비활성화는 별도 사용자 결정을 기다린다. 이 재시작 현상은 최초 멈춤 원인의 확정 증거가 아니다.

## 비활성화 요청 결과

사용자가 서비스 비활성화를 승인했다. sc.exe config BcastDVRUserService_112c91 start= disabled는 OpenService FAILED 5 / Access is denied로 거부됐다. 이어진 읽기 확인에서 StartMode Manual, State Running, PID 11668. 설정 변경 성공으로 보고하지 않으며 권한 경계를 우회하거나 반복 종료하지 않았다. 관리자 권한에서 서비스 비활성화가 필요하다.

## UAC 승인 실행 결과

{
    "utc":  "2026-11-04T04:51:50.8014176Z",
    "action":  "administrator-disable-bcastdvr",
    "results":  [
                    {
                        "name":  "BcastDVRUserService",
                        "exitCode":  0,
                        "output":  "[SC] ChangeServiceConfig 성공"
                    },
                    {
                        "name":  "BcastDVRUserService_112c91",
                        "exitCode":  87,
                        "output":  "[SC] ChangeServiceConfig 실패 87:  매개 변수가 틀립니다. "
                    },
                    {
                        "name":  "BcastDVRUserService_137366e8f",
                        "exitCode":  87,
                        "output":  "[SC] ChangeServiceConfig 실패 87:  매개 변수가 틀립니다. "
                    }
                ]
}


## 현재 결론

관리자 UAC 승인 후 서비스 템플릿 BcastDVRUserService는 sc config exit 0으로 비활성화됐고, 독립 조회에서 START_TYPE 4 DISABLED 및 레지스트리 Start=4를 확인했다. 기존 사용자별 두 인스턴스의 직접 변경은 오류 87로 거부됐다. 기존 인스턴스는 모두 Stopped/PID 0이며 추가 지연 확인에서도 중지 상태다. 따라서 영구 템플릿 설정 변경은 완료했으나 현재 로그인 인스턴스에는 Manual 표기가 남아 있다. Microsoft의 사용자별 서비스 계약에 따라 다음 로그인 시 생성되는 인스턴스가 비활성화 상태를 받는다. 사용자 작업 보존을 위해 자동 로그아웃/재부팅은 하지 않았다. Windows 멈춤 해소와 Win+Shift+S 실사용은 미검증이다. 되돌리려면 관리자 권한으로 sc.exe config BcastDVRUserService start= demand 후 다시 로그인한다. 임시 실행 파일·백업·별도 로그는 생성하지 않았고 UAC 실행 결과는 이 작업 기록에 직접 보존했다.

## 승인된 개선: 검증 Cargo 캐시의 실행 간 재사용

상태: 구현 준비. 사용자가 캐시 복사/반복 해시 I/O 개선을 승인했다. 기존 development-workflow/implementation/testing 지침을 적용한다.

목표는 이미지 검증용 독립 캐시를 실행별 산출물에서 분리하고 기존 Cargo cache owner의 호환성 identity·실제 종료 증거·단일 target lease로 같은 경로를 재사용하는 것이다. 기본 공유 캐시의 unresolved producer 보호는 그대로 두며 자동 복구, 기존 타깃 강제 점유, 테스트 생략, 제품 빌드·설치는 하지 않는다. 소스 고정/전후 검증과 실제 비영 테스트 수 검사는 유지한다.

공통 Node 검증 도구 변경으로 Windows/Linux/macOS에 같은 의미를 적용하지만 이번 실행 검증은 Windows x64에 한정한다. root가 checker/선택 옵션/문서/통합 검증을 소유한다. cache_contract 조사 에이전트는 기존 소유 API와 환경 전달 경로만 읽고 보고하며 수정하지 않는다.

검증은 작은 fixture에서 동일 경로 재사용·서로 다른 scope 분리·호환성 변경 분리·미종료 producer 거부·실제 checker의 캐시 복사 없는 호출을 확인한다. 대용량 실 캐시 복사나 전체 Rust 컴파일은 이번 개선을 검증하기 위해 반복하지 않는다. 기존 파일과 인덱스에는 다수의 동시 작업 변경이 있어 이를 보존하고 작업 변경만 분리 가능한지 확인한다.

## 캐시 재사용 검증 근거

```json
{
  "platform": "win32",
  "arch": "x64",
  "node": "v26.7.0",
  "runs": [
    {
      "id": "20261104T050213257Z-e5cd39e5-0a43-4c19-94a0-968f0467cad8",
      "tests": 88,
      "passed": 88,
      "failed": 0,
      "exitCode": 0,
      "testDurationMs": 24784.2199
    },
    {
      "id": "20261104T050344378Z-080480b1-46e5-475b-b009-db01db84973d",
      "tests": 117,
      "passed": 117,
      "failed": 0,
      "exitCode": 0,
      "testDurationMs": 65281.1042
    }
  ],
  "files": {
    "scripts/check-agent-image-attachments.cjs": "8da8099f30e09c60125b16020fe72fa5d42eb65731d96d2154affc230157e0ec",
    "scripts/cargo-shared-cache.cjs": "728fd52b86fbf8cbc610569d4dfcb6f3bcdfb78954e8568b535a98f9ed8b4775",
    "scripts/cargo-verification.cjs": "be2dcc1584bfc260fa9d483ed08556eb6e022731f61c460ac94cc1d86b97fb87",
    "scripts/test-cargo-shared-cache.cjs": "777578127737aaeb847dae9464a843d3a51e0bca72176729563a5cc5615829fd",
    "scripts/test-cargo-verification.cjs": "31e12c634a3209234b01adf1959f8b11c26a80cb4f6f74a6fb4c28590c1d30c2",
    "scripts/azrael-feature-contracts.json": "eb46caa7761300491e0666f964290a926e0ebc10b6967931adbaa1b0a9b14244"
  }
}
```

## 개선 결과와 검증 범위

- 기본 공유 캐시의 기존 key/경로를 유지하고, 선택 scope를 호환성 identity에 포함하는 재사용 경로를 추가했다. scoped 경로는 Windows 경로 길이를 고려해 짧게 만들되 전체 identity marker와 lifecycle key로 검증한다.
- 이미지 checker의 --private-target은 고정 agent-image-attachments scope 및 debug=0 설정을 사용한다. run 간 전체 target 복사·반복 해시를 없앴고, --seed-run은 생성 전에 명확한 전환 안내와 함께 거부한다. 이전 run-owned 캐시는 자동 변경하지 않아 첫 실행은 cold compilation일 수 있다.
- 실행 참조는 필터 전체를 보호하고 확인된 종료 후 해제한다. 결과 유실 시 exit hook까지 producerStopped=false를 보존하도록 보완했다.
- testing 스킬 기준으로 기존 cache/verification 테스트를 확장했다. 이후 준비 코드 수정으로 seed 복사를 되살리거나 scope 전달·참조 보호를 누락하는 실수를 막기 위한 소규모 보존 검사다. 실제 checker 스크립트를 작은 filesystem fixture에서 두 번 호출하며 compiler 경계만 모의한다. 12개 필터 호출, 같은 target 재사용, source만 2회 복사, cacheCopyBytes=0, 종료 후 참조 해제, 미확인 결과의 pending·참조 보존을 확인했다.
- 첫 관련 88개 검사 exit 0, 미확인 종료 보완 및 feature inventory 검사 추가 후 최종 117개 검사 exit 0. 실행 시간은 위 JSON의 testDurationMs이며 도구/관리 잠금 대기를 포함한 전체 경과 시간과 다르다. 실제 feature manifest 검증과 변경 파일 git diff --check도 exit 0이다.
- Windows x64 Node 26.7.0에서 확인했다. 실제 대규모 Rust 컴파일·사용자 머신 멈춤 해소·Linux/macOS 실행·제품 빌드/설치는 미검증이다. source 고정 및 실제 native 테스트 통과 정책은 유지했다. 준비 시간/전체 I/O의 실사용 절감량은 측정하지 않았다.
- 현재 checkout과 인덱스에는 선행 작업 변경이 다수 있으며, 이미지 checker 자체도 FS-01의 미추적 구현이다. 변경 파일 전체를 커밋하면 다른 작업을 포함하므로 기존 인덱스를 보존했다. 독립 검증된 task commit을 안전하게 분리하지 못해 커밋하지 않았다.
- 테스트의 원시 stdout/stderr와 fixture는 FT-01-cargo-cache-reuse 두 run에서 관리하며, 검증 요약을 이 문서에 옮긴 후 standalone maintenance owner로 정리 중이다. test-feature-preservation의 자체 fixture teardown도 확인했다(mock-* 잔존 0).

정리 완료: 두 검증 run(565,557 / 572,471 logical bytes)을 설치 identity가 검증된 maintenance_owner로 registered review 후 delete했다. 두 그룹 모두 deleted/remaining=false, 실제 경로 부재와 lifecycle.finalize finalized를 확인했다. 비어 있는 FT-01 테스트 전용 상위 디렉터리도 일반 삭제했다. 보존 요약은 이 문서이며 원시 로그/fixture 잔존은 없다.

최종 검토에서 기존 identity marker의 링크 검사 누락을 발견했다. generation을 잡기 전에 링크·일반 파일 여부를 검사하도록 보완하고 짧은 경로의 key 충돌 거부 검사를 추가했다. 영향받는 cache/verification/target-owner 검사만 재실행했으며 이전 feature manifest 검증은 그대로 유효하다. 대용량 Cargo 캐시는 복사하지 않았다.

## 식별 파일 보호 최종 검증

```json
{
  "run": "run:FT-01-cargo-cache-reuse:20261104T051301198Z-84683659-c211-4711-af93-1d9c2ea8fcf5",
  "tests": 89,
  "passed": 89,
  "failed": 0,
  "exitCode": 0,
  "testDurationMs": 22913.4902,
  "files": {
    "scripts/cargo-shared-cache.cjs": "dc7305aa88da05f14210ded30960db86dab5aaebe3a926689a2a742d877badbe",
    "scripts/test-cargo-shared-cache.cjs": "0d794bc9087c6d5c5f52e86c761c3dbbff4d4dd0f2b4402bc04c84bb646ebe86"
  }
}
```

최종 정리 완료: 마지막 566,225-byte 검증 묶음은 첫 apply에서 stale token으로 삭제 전 차단됐다. 같은 revision=2/종료 exit=0/참조 없음/identity를 새 review로 확인하고 다시 apply하여 deleted/remaining=false와 실제 경로 부재를 확인했다. lifecycle.finalize도 finalized다. 세 검증 run의 임시 파일과 원시 로그, 비어 있는 task 상위 디렉터리가 모두 제거됐으며 사용자 보존 승인을 기다리는 임시물은 없다. 최종 source 변경은 marker 보호를 포함해 89개 영향 검사 exit 0이며, 앞선 feature-preservation 29개와 manifest 검증 근거는 유지한다.

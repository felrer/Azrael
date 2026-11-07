상태: 사용자 결정 대기. 2026.0.16 정상 시작 검증 실패로 GitHub 게시하지 않았다. 사전 릴리스 공개 여부를 질문했으며 임시 환경 정리도 보호 검사로 미완료다.

# Azrael 2026.0.16 배포

## 목표와 승인

기존 public `felrer/Azrael`에 Windows x64 `2026.0.16`을 배포한다. 제품 바이너리 수정·새 버전·사용자 설치 교체·브랜치 push는 제외한다. 사용자는 이 구버전에 없는 내장 `maintenance` CLI 요구사항만 예외 승인했다. 정상 시작 검증 실패를 명시한 사전 릴리스 공개는 별도 승인 대기다. 아직 remote tag/release/asset을 생성하지 않았다.

## 패키지

- 기존 빌드: `artifacts/p/artifacts/releases/win016-ez01-paint-r8-20261102`.
- 호스트: `artifacts/p/artifacts/deployments/deploy-win016-ez01-paint-r8-20261102/package-r3/independent-prepared.json`.
- 원본 VSIX SHA256: `31f709fe57d95083f04395903fb624a6c4fee8f213ad583b3b957c781d52f7da` — 실제 파일 대조 일치.
- 공개 ZIP: `artifacts/app-releases/2026.0.16-public-20261107/assets/Azrael-2026.0.16-windows-x64.zip`, 980,790,238 bytes, SHA256 `413ba36af53e44301fea339ce0898f36f49f30a0d207f781f3982edeb51155fc`.
- Engine source SHA256: `fd6d670d37970763b140b1a7a7ebda297e56b9451796b329ccea8f1ff283f7fe`.
- 버전 소유권: `version:azrael-public:2026.0.16:20261107`, assets를 배포 결정/복구 입력으로 보호한다.
- Tag 예정 대상: 기존 remote commit `e9bbdc4441abbf1975a6c8019240a96c5e88b4eb`. 바이너리 소스 provenance와 별개임을 notes에 표시한다. 기존 게시본을 덮어쓰지 않는다.

## 검증 결과

기존 source/engine/원본 exact-host 수용은 EZ-01 기록을 재사용했다. 새 공개 ZIP의 패키징과 inventory/relocation 준비, 격리 VSIX 설치는 통과했다. 실제 호스트 시작은 통과하지 못했다.

- r1: Windows 소켓 경로 140 bytes로 host 실행 전 실패(exit1). 검증 도구를 짧은 기본 경로와 h/s 내부 경로로 보완하고 압축해제 전 기존 socket-budget 검사를 적용했다. parser, 기본 경로 허용, 실제 긴 경로 호출의 조기 거부 및 출력 미생성 검사는 exit0. 코드 커밋 `3a39f003b`. 제품 바이너리 변경 없음. 기존 공통 helper를 재사용하므로 새 영구 테스트는 추가하지 않았다.
- r2: primary의 최신 검증기가 구버전에 없는 `azrael.instructionsLegacy`를 요구해 실패(exit1). initialInventory/hostInstall/finalInventory는 각각0이며 정확한 설치된 VSIX hash를 확인했다.
- r3: 동결 `artifacts/p/scripts/independent-vscode-host-check.cjs`와 새 상태로 해당 설치를 재사용했다. VS Code1.145.2에서 계정 서비스 시작 연결30초 timeout(exit1).
- r4: 같은 동결 검증 기준과 새 상태, 기존 VS Code1.138.0으로 실행. 엔진 endpoint discovery timeout(exit1).
- 해당 공개 패키지 엔진의 endpoint 명령은 직접 두 번 실행해 exit0이었으나37,392ms/37,280ms가 걸렸다. 호스트의10,000ms 제한을 넘는다. 시간 초과 기준을 완화하거나 실패 영수증을 통과로 고치지 않았다.

최소 독립 근거: `artifacts/logs/release-016-public-20261107/acceptance-failure.json`. 각 단계 raw/상세 결과도 같은 로그 루트에 있다. 정상 배포 verification receipt는 생성하지 않았다. Linux/macOS, clean-machine, live-provider 수용은 이번 범위가 아니다. Modern Paint virtual input 미수용도 notes에 표시한다.

## 정리와 남은 작업

- r1 fixture `artifacts/p/artifacts/verification/r016pub`: 소유권·실제 종료·실패 outcome을 기록한 뒤 owner cleanup-r4로 삭제하고 실제 부재 확인.
- r2–r4 fixture `artifacts/verification/r016` 및 연결 검사 run `artifacts/tasks/check-independent-vscode/runs/547e5935b87e4632b1bf2af8953a99d7`: producer 종료 확인, 실패/exit1 보존. 소유 그룹 `run:check-independent-vscode:547e5935b87e4632b1bf2af8953a99d7`.
- 최종 cleanup owner가 `h/s/ipc/tsgas34ryinyciqmuymq.sock`의 미검증 reparse path를 거부했다. 우회 삭제하지 않았다. 현재 총 잔여 크기는 미측정이며, fixture와 연결 run은 정리 미완료다. 결과는 `artifacts/logs/release-016-public-20261107/cleanup-final/report.json`.
- 소규모 정리 제어/근거는 `artifacts/p/artifacts/logs/pub016-cleanup-r1`부터 `r4`, 그리고 주 로그 루트에 있다. 최종 완료 전 필요한 최소 증거를 남기고 owner별 정리/참조 해제를 마쳐야 한다.
- 사전 릴리스 승인 시 정상 수용을 주장하지 않는 별도 publication evidence로 게시해야 한다. 정상 publisher의 passed gate를 위조하지 않는다. 게시 후 원격 파일 size/SHA256, prerelease 상태, tag 대상 및 기존 latest 보존을 확인한다.
- 배포 중단 시 사용자 확인 후 필요 없어진 후보 assets도 소유 owner로 정리한다. 보호된 잔여의 장기 보존은 별도 scoped 승인 없이는 완료 예외로 취급하지 않는다.

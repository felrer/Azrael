상태: 선택한 hotfix 묶음 삭제 완료, VHDX 축소 검토 완료. 축소 실행은 승인·실행하지 않았음. 권장: 백업/복구 범위와 관리자 실행 조건을 정한 뒤 대상 VHDX에 한정한 오프라인 compaction.

# 범위와 권한

- 사용자 요청: WSL 가상 디스크에서 무엇을 정리할 수 있는지 후보 조사.
- 대상: Windows WSL2 `ktcloud-ubuntu-24.04`. 레지스트리 Lxss의 BasePath로 `C:/Users/felre/AppData/Local/ktcloud-ai-nexus/wsl/ubuntu-24.04/ext4.vhdx` 연결을 확인. `docker-desktop` 제외.
- 허용: 배포판 실행과 읽기 조사, 보고서 작성. 삭제·패키지 제거·VHDX 축소·클라우드 세션 작업·인증 변경 없음. 조사 당시 배포판은 Stopped였으며 내부 조회를 위해 실행했다. 종료 명령은 실행하지 않았다.
- 이전 조사와 같은 development-workflow 경로를 유지. ktcloud-ai-nexus 스킬과 G:의 felrer02@gmail.com 라벨로 확인된 canonical 원본의 Windows/Ubuntu runtime 계약 적용. 클라우드 세션에 연결하지 않았으므로 세션 기록을 생성하지 않음.
- 제품 기능·지원 플랫폼 변경 없음. 이 컴퓨터의 Ubuntu 24.04 WSL2만 조사.

# 실제 사용량 — 삭제 전 조사

| 관측 | bytes | GiB |
|---|---:|---:|
| Windows VHDX 파일 길이 | 82,746,277,888 | 77.06 |
| Windows 실제 할당량(GetCompressedFileSizeW) | 82,746,277,888 | 77.06 |
| Linux `df -B1 /` Used | 25,144,717,312 | 23.42 |
| Linux `du -x -B1 /` 합계 | 25,142,493,184 | 23.42 |

약 53.65GiB 차이가 있다. 이는 삭제할 파일 크기가 아니라, 과거에 커진 VHDX와 현재 내부 사용량의 차이다. Windows 실제 할당량도 파일 길이와 같으므로 이미 sparse 처리되어 겉으로만 큰 상태는 아니다. 파일을 많이 지우기 전에, 기존 빈 블록을 회수하는 디스크 compaction 검토의 효과가 클 것으로 판단한다. 파일시스템 메타데이터·블록 배치·지원 기능 차이로 이 차이 전체를 회수한다고 보장하지 않는다.

Microsoft는 동적 VHD가 파일 삭제만으로 자동 축소되지 않을 수 있고, `compact vdisk`는 분리되었거나 읽기 전용으로 연결된 동적 VHD에 적용한다고 설명한다. 실행 단계에서는 WSL 버전·VHD 상태·배포판 종료 영향·복구 방법을 확인한 뒤 적합한 절차를 선택한다. 이번 조사에서는 trim, zero-fill, shutdown, compact, sparse 설정 변경을 하지 않았다.

공식 근거: [WSL disk space](https://learn.microsoft.com/en-us/windows/wsl/disk-space), [compact vdisk](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/compact-vdisk).

# 1. 우선 정리 후보: 약 4.46GiB

아래 항목은 서로 다른 경로이며 합계 약 4.46GiB. 로그는 최신분을 남기면 실제 삭제량이 줄고, 캐시는 재사용 시 다시 생성되므로 확정 회수량은 아니다. ktcloud runtime 캐시는 클라우드 인증이 아니라 추출된 Python/PEX 실행 캐시이며, 계정 HOME 전체는 삭제하지 않는다.

| 후보 경로 | GiB | 내용과 조건 |
|---|---:|---|
| `/var/cache/apt/archives` | 0.57 | 내려받은 패키지 파일. apt 작업 종료 후 패키지 관리자 방식으로 정리. `/var/cache/apt` 전체는 0.68GiB. |
| `/root/.cache` | 0.76 | pip 약 0.46GiB, PEX 약 0.16GiB, nce 약 0.14GiB. 관련 실행 종료 확인 후 재생성 가능한 하위 캐시만 정리. |
| `/root/.npm/_cacache` | 0.11 | npm 콘텐츠 캐시. 설치 작업 종료 후 소유 도구로 정리. |
| `/var/lib/ktcloud-ai-nexus/{abydos,arius1,arius2,arius3,trinity}/.cache` | 1.49 | 각 약 0.30GiB. PEX 및 nce의 Python runtime 추출/다운로드 캐시가 중심. Backend.AI 호출 종료 확인 후 `.cache`만 선택. 다음 호출 초기화 비용 발생 가능. |
| `/var/log/journal` | 0.77 | systemd journal. `journalctl --disk-usage`에서도 약 792MiB 확인. 보존할 최근 로그 범위를 정하고 journal 소유 도구로 정리. 현재 활성 로그 포함 크기이므로 전량 회수량 아님. |
| `/root/.local/share/eden-re-tooling-pilot/downloads` | 0.76 | Ghidra ZIP 544MiB, JDK tar.gz 198MiB, Node tar.xz 32MiB. 해당 도구의 풀린 설치 디렉터리가 별도로 존재한다. 재설치 원본을 보존할 필요가 없다면 유력 후보. 설치본 무결성/복구 필요는 아직 검사하지 않음. |

# 2. 빌드 삭제 완료 및 남은 조건부 후보

| 후보 경로 | GiB | 내용과 조건 |
|---|---:|---|
| `/root/azrael-linux-context-hotfix-20261012` 전체 — 삭제 완료 | 9.31 | 오래된 Linux hotfix 빌드 묶음. `release-r5` 4.54GiB, `release-r5.inputs` 2.40GiB, `tools` 2.37GiB. source/provenance·패키지·도구가 함께 있다. 현재 프로세스 목록에서 해당 빌드 실행은 관측하지 못했지만, 설치/복구/보존 참조가 없다는 증명은 아님. 빌드가 대체되었는지 확인한 뒤 전체 묶음으로 정리. |
| `/var/tmp/vanitas-enhance-venv` | 1.52 | Python 3.12 site-packages 중심의 독립 가상환경. 2026-10-02 디렉터리. Vanitas 후속 처리에서 더 쓰지 않거나 재구성이 가능하면 후보. 이름·날짜만으로 불필요함을 확정하지 않음. |

hotfix 빌드의 `build-info.json`은 `engineSourceRoot`로 `release-r5.inputs/engine`을 명시한다. `engineVersion`은 0.162.0이고 이 receipt에는 Azrael app version이 없다. 따라서 날짜/이름으로 Azrael 2026.0.10 이하를 확정하지 않는다. 산출물만 지우고 필수 source/provenance를 남기거나 반대로 분리 삭제하기 전에 전체 사용·보존 계약을 확인해야 한다.

# 3. 분석 작업 폐기 여부를 먼저 결정할 후보

| 경로 | GiB | 판단 |
|---|---:|---|
| `/root/.local/share/eden-re-tooling-pilot` | 2.51 | Ghidra 0.86GiB, JDK 0.34GiB, Node 0.22GiB, downloads 0.76GiB, persistent 0.24GiB 등. 위 downloads와 중복이므로 합산 금지. 분석 작업을 유지한다면 도구와 persistent 보존. |
| `/root/eden-re-tooling-pilot` | 1.97 | 대부분 persistent 분석 자료. `projects/EdenPilotFixed.rep` 0.97GiB, `projects/EdenPilot.rep` 0.76GiB, `GameAssembly.dll` 약 0.24GiB. 캐시가 아니라 분석 프로젝트/입력 데이터로 분류. 필요 없다는 확인 후에만 삭제. |

두 persistent 경로에 같은 이름과 크기의 `GameAssembly.dll`이 있지만 내용 해시는 비교하지 않아 중복 확정은 아니다. Ghidra project의 중간본/최종본 관계와 재생성 비용도 미확인이다.

# 보존 대상과 검증 한계

- ktcloud 계정 디렉터리 전체, 인증 state 연결, Windows 원본 DPAPI credential/cookie, 공식 v2 client binary/manifest는 보존. canonical 지침상 계정별 Linux HOME의 state는 Windows 원본을 가리키므로 디렉터리 전체 삭제로 관리 계약을 깨지 않도록 한다.
- `/usr` 약 3.80GiB, `/etc`, dpkg 패키지 DB 등 배포판 기반 시스템은 삭제 후보에서 제외. `/tmp`는 약 56KiB여서 효과가 거의 없음.
- root 합계 조사와 타깃별 du/df, Windows 할당량 검사는 정상 종료(exit 0). CRLF로 마지막 `head` 명령이 실패한 읽기 probe는 부분 결과만 사용하고 필요한 manifest 조회를 UTF-8/LF python probe로 재실행(exit 0)했다. 잘못된 du 출력 범위를 좁혀 계정별 `.cache` 총계를 재조회(exit 0). verbose 출력의 잘린 하위 목록은 결론 근거로 쓰지 않음.
- 프로세스 이름 목록은 systemd 등 기본 서비스와 조사 셸 중심이었다. 단순 프로세스 부재로 작업·설치·복구 참조 해제를 확정하지 않음. 열린 파일 추가 확인용 lsof probe는 출력 없이 exit 1로 종료했다. 오류 출력을 억제한 probe이므로 열린 파일이 없다는 확정 증거로 쓰지 않음.
- 실제 삭제, 패키지 재설치, ktcloud 인증/CLI 동작 검사, 앱 빌드·설치 참조의 완전한 검증은 하지 않았다. 후보 선정 범위에서는 삭제 승인·사용자 데이터 포기를 가정하지 않는다.

# 추천 다음 순서

1. 캐시·압축본·오래된 로그 약 4.46GiB를 우선 선택.
2. hotfix 빌드 9.31GiB는 삭제 완료. Vanitas 환경 1.52GiB만 사용 종료 확인 후 추가 선택 가능. 우선 캐시 후보와 남은 Vanitas 환경 합계 약 5.98GiB.
3. 분석 프로젝트는 유지 여부를 별도 결정. 현재는 보존 추천.
4. 필요한 파일 정리 후, 실제 Windows 공간 회수를 위한 VHDX compaction을 별도 실행·검증. 현재 약 53.65GiB의 격차는 위 내부 삭제 후보와 다른 의미이며, 최종 회수량을 합산하여 보장하지 않음.

# 선택한 빌드 묶음 삭제

- 사용자 권한: 오래된 Azrael Linux hotfix 묶음 전체 삭제 명시 승인. 정확한 범위는 ktcloud-ubuntu-24.04의 /root/azrael-linux-context-hotfix-20261012 한 경로.
- 실행 소유자: /root. 입력: 기존 후보 조사와 현재 경로/사용/참조 재확인. 산출물: 이 작업 기록의 preflight/실제 삭제/공간 변화 영수증. 추가 빌드·캐시 삭제·프로세스 종료·VHDX 축소·클라우드 변경 없음.
- 성공 조건: 실제 경로와 하위 링크/마운트 경계 확인, 현재 소비 참조 확인, 일반 삭제 exit 0과 경로 부재 확인, 전후 WSL df 비교. 불확실한 보호나 삭제 오류가 발견되면 중단.
- 환경: 로컬 Windows에서 WSL2 Ubuntu 24.04 내부 작업. native project maintenance는 WSL/원격 root를 지원하지 않아 이 경로에 적용하지 않음. 기존 등록 거부/가드를 우회한 것이 아님. 본 묶음은 Windows 현재 artifacts/maintenance에서 참조가 검색되지 않음.

## 삭제 전 검토 결과

- 대상 실제 경로 일치, device/inode 2096:18084. 일반 파일 149,132개, symlink 23개. 외부 symlink 없음, 하위 mount 없음, special file 없음, 참조 검사 읽기 오류 없음.
- 활성 exe/cwd/cmdline/mapped-file/open-file 참조 없음. /root·/etc·/usr/local·/opt의 외부 symlink 및 주요 config/설치 디렉터리 검사에서 Codex 임시 arg0 링크 4개만 발견.
- arg0 소유 코드(engine/codex-rs/arg0/src/lib.rs)는 실행 수명 동안 .lock을 잡고, 잠금 해제된 디렉터리를 잔여물로 정리한다. 실제 .lock 독점 잠금 획득 성공, 해당 임시 경로를 사용하는 프로세스 없음, Codex/Azrael config.toml의 대상 참조 없음. 따라서 이 링크를 종료된 작업의 inert reference로 판정. 임시 디렉터리는 변경하지 않고 선택된 빌드만 삭제한다.
- Windows 현재 설치 extension·azrael-remote-work·운영 scripts/docs 및 artifacts/maintenance에서 대상 경로 참조 없음. imported-snapshot 및 원본 Linux archive 출처는 target metadata로 확인. 기존 설치·진행 작업·활성 복구용 소비를 발견하지 못함.
- 실행 선택: WSL 내부 native rm -r -- <exact target> 일반 삭제, force 옵션·권한/소유/속성 변경 없음. inode·mount·활성 참조 및 arg0 lock을 실행 직전 다시 확인하고, 실패 시 대체 삭제 경로를 쓰지 않는다.

## 실제 삭제·검증 결과

- 실행: 2026-10-24 11:45:44~11:45:50 KST(약 6초). ktcloud-ubuntu-24.04 내부에서 rm -r -- /root/azrael-linux-context-hotfix-20261012 실행. exit 0, stderr 없음, stdout 없음. force·chmod·chown·VHD 조작 없음.
- 삭제 직전 identity 2096:18084, top membership 일치, mount 없음, 활성 cmdline/exe/cwd/maps/fd 참조 없음, 임시 arg0 lock 독점 획득 후 삭제. 명령 결과 absent=true이고, 별도 test -e 및 test -L 확인도 경로 부재 확인(exit 0).
- WSL filesystem free bytes: 1,055,963,594,752 → 1,065,961,689,088. 차이 9,998,094,336 bytes(약 9.31GiB). 최종 df Used 15,139,614,720 bytes(약 14.10GiB). 동시 시스템 활동으로 du 9,998,368,768 bytes와 소폭 차이 있음.
- Windows VHDX 파일은 82,746,277,888 bytes(77.06GiB) 유지. Windows 실제 공간 회수를 위한 compaction은 요청 범위 밖이어서 실행하지 않음.
- ktcloud 계정 루트, Eden 분석 프로젝트, Vanitas venv 존재 확인. 대상 밖 Codex tmp/arg0 디렉터리와 링크4개는 변경하지 않음. 링크는 잠금 해제된 종료 작업 잔여물로 확인되어 active reference로 취급하지 않았으며, 삭제된 target을 향하는 임시 링크로 남음. 해당 temp owner의 다음 janitor 또는 별도 승인 정리 대상.
- 남은 target 경로 없음, 부분 삭제/실패 없음. 사용자 데이터·클라우드 인증·설정 변경 없음. 빌드/앱 테스트는 실행하지 않았으며 이 작업은 선택된 과거 산출물 삭제만 수행함. 작업 기록만 갱신했으므로 제품 코드/기능/아키텍처 변경 및 개발 커밋 없음.
- 보존 식별 근거: native snapshot sourceSha256 1f52d1e49cd0e223eff0717adb400e60b9d2c857ce4146ed91788117b14c7814, engineVersion 0.162.0, inputSha256 2991fb1a201a78d93316f77f99cdc34cf9a726e0dad352b4ce9233f6be47bf63. 전체 파일별 hash 출력은 과대하여 일부 잘렸지만 삭제 exit/absent/free-delta는 완전한 끝부분에서 확보했고 실제 경로 부재를 독립 검증함. 삭제 재실행 없음.

# 가상 디스크 축소 검토 결과

사용자 요청은 축소 검토이며 실행이 아니다. 이번 단계에서는 실제 fstrim, WSL 종료, diskpart 실행, VHD 연결/분리/축소, sparse 설정 변경, 기능 설치, 배포판 export/unregister를 하지 않았다. `fstrim --dry-run --verbose /`만 실행하여 exit 0, `0 B (dry run) trimmed`를 확인했다. 이는 trim이 수행되지 않았다는 뜻이며 실제 회수량이나 discard 성공 검증이 아니다.

## 최신 상태와 효과

- WSL 2.7.12.0 / Linux kernel 6.18.33.2-2 / Windows 10.0.26200.9711. 현재 PowerShell 5.1은 비관리자 세션.
- `Get-DiskImage` 정상 조회(exit 0): StorageType 3(VHDX), FileSize 82,746,277,888 bytes = 77.06GiB, 가상 Size 1,099,511,627,776 bytes = 1TiB. 조회 시 Attached=false.
- `GetCompressedFileSizeW` 실제 할당량도 82,746,277,888 bytes. 파일 Attributes=Archive이며 SparseFile 속성 없음.
- 삭제 후 최신 `df -B1 /` Used 15,139,594,240 bytes = 14.10GiB. backing file과의 차이는 약 62.96GiB. 이는 공간 회수 가능성을 보여 주지만 회수 보장량이 아니다. 메타데이터, zero/trim 상태, 블록 배치에 따라 축소 후 크기가 달라진다. 최종 VHDX 크기를 내부 Used와 같다고 예측하지 않는다.
- 배포판 sdd는 DISC-GRAN 1MiB, DISC-MAX 약 4GiB의 discard capability를 광고함. fstrim 실행 파일 존재. timer는 enabled/inactive로 관측. 실제 trim·compact 경로가 성공했음을 검증한 것은 아님.
- 실행 준비를 위한 설치·업데이트는 필요하지 않은 것으로 보임: diskpart.exe 존재. Optimize-VHD는 현재 세션에서 발견되지 않았다. 도구 존재와 실제 작업 성공은 구분하며, 대상 형식/부모 디스크 여부는 실행 직전 detail 검증 필요.

## 방법 비교

| 방법 | 판단 |
|---|---|
| WSL 내부 trim 후 기본 제공 diskpart의 compact vdisk | 권장. 도구가 이미 있으며 선택한 VHDX만 대상으로 한정 가능. 실제 trim 후 배포판 종료·파일 분리 상태, 관리자 권한을 확인하고 수행. ext4에는 NTFS 파일시스템 인식 축소를 그대로 기대하지 않으며 discard/zero 상태가 중요. |
| Optimize-VHD | 현재 cmdlet 미발견. 이 작업만을 위해 Hyper-V 구성요소를 설치하는 선택은 권장하지 않음. |
| WSL 자동 sparse 회수 설정 | CLI help에는 set-sparse가 있으나 실제 이 설치에서 안전하게 허용/동작하는지 미검증. Microsoft WSL issue #13075에서 unsafe opt-in과 손상 우려가 확인되므로 이번 1회 회수의 기본 경로로 선택하지 않음. help 노출만으로 작동한다고 판정하지 않으며 allow-unsafe를 사용하지 않음. |
| export/import로 재생성 | 대안으로만 보류. 별도 저장 공간·검증·등록/경로 이전과 복구 계획이 추가로 필요하므로 첫 선택 아님. |

기본 제공 compact는 동적 디스크가 분리되어 있거나 read-only로 연결되어 있어야 한다. 가상 최대 용량 1TiB와 현재 Windows에서 차지하는 크기는 다른 값이므로, 이 요청을 위해 resize/shrink/파일시스템 크기 변경을 선택하지 않는다.

## 실행 조건과 범위

1. 백업 또는 복구 가능한 데이터 범위를 먼저 결정한다. 읽기 조사에서 ktcloud 계정 state는 Windows 원본으로 연결되고, 분석 프로젝트는 Linux 내부에 존재하므로 원본 VHDX 삭제·재생성은 범위 밖이다.
2. 현재 C: 6.61GiB, D: 2.99GiB, E: 11.34GiB 여유. 어느 드라이브에도 원본 VHDX 77.06GiB를 그대로 복사할 공간이 없다. 압축 export 크기는 측정하지 않아 들어간다고 가정하지 않는다. 외장/다른 검증된 저장소에 전체 백업을 둘지, 필수 데이터만 따로 보존할지는 실행 전 선택이 필요하다.
3. 대상 배포판의 ktcloud v2 CLI 호출·SSH/백그라운드 작업이 없는지 바로 직전 확인한다. 이번 관측은 기본 시스템 서비스 위주였고 한 list 조회 시 두 배포판 모두 Stopped였다. 후속 Linux 조회로 상태가 바뀔 수 있으므로 현재 상태를 재사용해 종료 안전성을 단정하지 않는다.
4. 대상 배포판에서 실제 trim 실행 후, 필요한 쓰기를 마무리하고 배포판을 종료한다. 가능하면 `wsl --terminate ktcloud-ubuntu-24.04`로 범위를 제한하고 파일이 분리됐는지 확인. 전역 shutdown이 실제 필요할 경우 Docker 등 모든 WSL 작업에 영향이 있으므로 별도로 확인한다. 활성 프로세스가 남으면 진행하지 않는다.
5. 관리자 Windows 단계에서 정확한 경로의 VHDX를 선택하고 detail로 형식/상태를 확인한 뒤 compact만 수행한다. disk/partition clean, format, unregister, 강제 detach 등은 사용하지 않는다. 사용자 UAC 승인 또는 별도 관리자 세션이 필요하다. 이 단계는 현재 비관리자 세션에서 실제 실행해 검증하지 않았다.
6. 실제 파일 길이와 할당량, C: 여유를 전후 비교하고 배포판 부팅·df·필수 분석 데이터와 ktcloud state link를 확인한다. compact가 정상 종료해도 크기 변화가 없을 수 있으므로 실제 결과로 판단한다. 내용에 접근하지 않고 인증 연결·관리 runtime을 검증하며, 인증/클라우드 동작 변경은 범위 밖이다.

## 근거와 미실행 사항

- [compact vdisk](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/compact-vdisk): 동적 VHD의 물리 크기 축소, detached/read-only 조건.
- [diskpart](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/diskpart): 관리자 권한 요구와 선택된 대상에만 명령 적용.
- [CompactVirtualDisk API](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/nf-virtdisk-compactvirtualdisk): NTFS-aware와 zero-block 기반 축소 구분, CPU/I/O 비용, 최적화 조건.
- [Optimize-VHD](https://learn.microsoft.com/en-us/powershell/module/hyper-v/optimize-vhd): 지원 조건, 축소량 0 가능성.
- [Microsoft WSL sparse issue #13075](https://github.com/microsoft/WSL/issues/13075): unsafe 설정과 손상 우려가 있는 경로의 근거. 과거 보고를 이 설치의 실제 실패로 일반화하지 않음.
- `wsl --help`는 옵션 설명을 반환했으나 프로세스 exit는 4294967295였다. 반환된 help는 문법 참고만 사용했으며 상태 변경 옵션의 성공 증거로 쓰지 않음. 다른 조회·dry run은 정상 종료.

현재 결론: 수십 GiB 회수 여지가 있어 compaction을 권장한다. 다만 약 63GiB 차이 전체의 회수와 완료 시간을 보장할 수 없다. 실행 준비에서 남은 결정은 백업/복구 범위와 관리자 권한의 실제 실행 경로이며, 검토 요청만으로 해당 작업을 시작하지 않는다.
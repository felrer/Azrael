상태: 사전 준비 완료·최종 소스 확정 대기 — 병행 개선 작업 완료가 확인되면 이미 승인된 Linux 빌드를 이어간다.

# Linux 2026.0.15 빌드 준비

## 목표와 승인 범위
Linux x64/glibc Azrael 2026.0.15를 빌드하되 병행 개선 작업과 독립적인 준비부터 수행한다. 최종 소스 고정 전 임의 중간 소스를 제품으로 컴파일하지 않는다. 배포·설치·게시와 사용자 상태 변경은 이번 요청에 포함하지 않는다. Window Use·데스크톱 제어는 Linux 미지원 상태를 유지한다.

## 입력과 의존성
- 앱 버전 소유 파일은 이미 2026.0.15다. 지침 패키지 본체 통합(FA-01), 잠금 가용성 수정(FC-01) 등 병행 변경은 그 소유자의 완료·고정 입력 준비가 필요하다.
- 실행 환경은 로컬 WSL2 `ktcloud-ubuntu-24.04`, Ubuntu 24.04/glibc 2.39/x86_64다. 실제 배포판 데스크톱 수용 및 WSL 제품 지원을 주장하지 않는다. 준비·빌드는 ubuntu 사용자로 실행한다.
- 기존 Linux Node/Bun/Rust와 제품 캐시는 확인한 경로에 없다. gcc/g++/clang/cmake/pkg-config, OpenSSL·Secret Service·D-Bus 개발 패키지는 설치되어 있다. WSL 메모리 약15GiB·CPU16, C 볼륨 여유 약289GiB다.
- 공통 producer의 Bun1.4.2, Rust toolchain1.95.0, CI의 Node22.18.0과 일치하는 native 도구를 준비한다. 공식 출처·체크섬/manifest로 선택하고 다른 버전으로 조용히 대체하지 않는다.

## 실행 순서와 소유권
루트가 준비·검증·후속 빌드를 소유한다. 독립 단계는 실행 환경·네이티브 도구·캐시 경로 준비, 실행 신원과 최소 의존성 확인이다. 최종 소스 capture·소스 검사·Cargo 컴파일·host 준비는 개선 결과를 받는 다음 경계다. Windows Cargo cache/실행기·소스·설정은 수정하지 않는다.
생성 전 기존 lifecycle owner로 shared 도구와 run 로그·다운로드·캐시 경로를 기록한다. 도구와 다운로드 캐시는 `artifacts/tools/multi-platform/linux-x64`, `artifacts/cache/linux-x64`, 실행 근거는 `artifacts/tasks/linux-2026.0.15-preparation`이 소유한다. 최종 Linux 소스·컴파일·검증의 활성 작업공간은 WSL ext4 `/home/ubuntu/azrael-linux-build`로 분리하고 그 안의 `artifacts/`에서 캐시·임시 자료를 관리한다. 이 경로의 준비 소유자는 FD-01이며 최종 입력이 준비될 때 같은 Linux 프로젝트의 native 관리 기록에 연결한다. Windows 관리 catalog·절대 경로·OS 잠금 상태를 Linux 프로젝트에서 재사용하지 않는다. 공통 UI content cache와 이미 준비한 읽기 전용 도구는 명시 경로로 재사용한다. 설치 도구·재사용 캐시는 이 빌드의 후속 소비자용으로 유지하며 실패·진단·종료 미확인 상태를 구분한다. 불필요한 다운로드와 일회성 자료는 사용 후 기존 owner로 정리한다.

## 사전 준비에서 확인한 환경 경계
- WSL C 드라이브는 uid/gid 0의 DrvFS/9p다. ubuntu 계정의 Node/Bun 추출은 파일 바이트와 실행은 정상이지만 metadata 복원에서 각각 exit2/exit1, Rust는 chmod에서 exit1이었다. 실패를 성공으로 재분류하지 않는다. 시스템 ACL·마운트·파일 소유권을 바꾸지 않고 기본 root 계정으로 작업공간 내 Rust 도구 설치만 재시도한다. 이후 ubuntu 계정의 실제 실행으로 준비를 검증한다.
- Windows 관리 실행기 receipt는 Windows 경로와 `.exe`를 선택하므로 Linux resolver의 실제 읽기에서 ENOENT였다. Windows 설정을 변경하지 않는다. 최종 입력 확정 후 Linux native 관리 실행기를 같은 선택 소스로 준비하는 bootstrap이 필요하다.
- 별도 ext4 작업공간은 Unix 실행 권한·소켓·의존성 추출·상태 격리와 native 캐시 성능을 위한 것이다. 제품 소스·Git worktree는 아직 만들거나 복사하지 않는다. 실제 준비 대상은 `/home/ubuntu/azrael-linux-build/artifacts/{cache,tmp}`뿐이다.

## 검증과 수용
실제 Linux node/bun/rustc/cargo/Python 실행과 OS·CPU·libc, effective cache 경로, 시스템 링크/빌드 의존성을 확인한다. 준비 결과는 최종 제품 통과와 구분한다. 최종 빌드 성공은 이후 같은 불변 입력으로 네이티브·패키지 신원·선택된 공통 검사·Linux 실제 host 검증을 충족해야 한다. 현재 단계에서 그 결과를 주장하지 않는다.

## 실제 준비 결과
- Node22.18.0, Bun1.4.2 Linux x64 baseline, Rust/cargo1.95.0과 clippy/rustfmt/rust-src를 공식 자료로 준비했다. 다운로드 자료는 공식 SHA-256 manifest와 일치한다. 실제 ubuntu 실행에서 Linux/x64/glibc2.39를 확인했다. Rust는 native ext4 임시 경로에서 작은 metadata 컴파일을 수행하고 probe 파일의 일반 삭제·부재를 확인했다.
- Node/Bun 최초 압축 해제는 metadata 복원 실패를 그대로 기록했으며, 추출된 Node 실행·버전 일치 헤더·Bun 실행과 effective npm/Bun cache 경로는 별도 성공 확인했다. Rust 설치 재시도는 실제 exit0이고 root profile·Windows ACL·mount·파일 소유권은 변경하지 않았다.
- `cargo fetch --locked --target x86_64-unknown-linux-gnu`가 2026-11-02 10:12:58~10:13:44 KST에 exit0으로 완료됐다. 제품 컴파일은 없다. 입력 관찰 대상 의존성 파일166개가 다운로드 전후 동일했다. native Cargo cache는 약1.7GiB, crate archive1127개와 Git 의존성을 포함하며 향후 최종 lockfile과 일치할 때 재사용한다. [02-dependency-seed-inputs.json](02-dependency-seed-inputs.json)은 준비용 관찰이며 최종 고정 입력 영수증이 아니다.
- 실제 Linux에서 `test-platform-runtime.cjs`와 `test-build-platform.cjs`가21개 통과·0skip·exit0, 약21.2초였다. Unix 실행 권한 검사를 포함하지만 최종 변경 소스의 전체 검사나 제품 실행 수용은 아니다.
- pinned UI26.1007.21434의 공식 package/host/webview/menu4개 바이트 해시와 기존 Linux ripgrep15.2.0의 실행·ELF x64를 확인했다. WSLg X11/Wayland 소켓이 존재한다. 새 GUI·VS Code host를 실행하지 않았다.
- shared tool 기록 revision2는 complete와 pending build 소비 참조를 가진다. 준비 run revision2는 전체 빌드를 기다리는 pending과 소비 참조를 유지한다. native workspace의 캐시는 위 작업 기록이 소유하며 Linux native owner bootstrap 이후 해당 프로젝트 기록에 연결한다. 종료 미확인 producer는 없다.
- 필요한 도구·검증된 다운로드 캐시·native dependency cache·환경 recipe와 실행 근거는 후속 빌드가 소비하므로 보존한다. 임시 plan 본문과 Rust probe는 부재다. Native TMPDIR에는 반복 Node 실행이 사용하는 compile cache만 남아 있으며 최종 작업 종료 때 검토한다. 소스·사용자 설정·계정·현재 설치본과 다른 작업의 index는 변경하지 않았다.

## 다음 경계
1. FA-01 등 병행 개선의 완료와 최종 포함 소스를 확인한다. 현재 중간 소스의 freeze·제품 Cargo build·VSIX/package·설치·공개 배포는 수행하지 않았다.
2. 같은 선택 입력에서 Linux 관리 실행기를 bootstrap하고 native 프로젝트의 소유·잠금·캐시 경계를 준비한다. Windows 관리 receipt를 Linux에서 재사용하거나 잠금 보호를 우회하지 않는다.
3. 최종 불변 입력·필수 검사 범위·compatible engine/bridge/code-mode host를 묶어2026.0.15 제품 빌드와 패키지 검증을 진행한다. 설치·게시가 필요하면 그 권한은 별도다.

상세 버전·경로·실제 exit·진단 보정·미검증 범위는 [03-preparation.json](03-preparation.json), raw 실행 로그와 환경 recipe는 `artifacts/tasks/linux-2026.0.15-preparation/`에 있다. 작업 전체는 대기 상태라 task commit과 최종 cleanup은 아직 수행하지 않는다.

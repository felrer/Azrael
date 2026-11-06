# Unix 삭제의 승인 구성·마운트 경계 보존

상태: 구현·필수 검증·산출물 정리 완료. 사용자 요청에 따라 Linux x64/glibc와 macOS ARM64의 삭제 어댑터를 구현하고 Windows 회귀를 검증했다. 기존 미커밋 변경과의 분리 문제로 commit은 보류했다. 앱 빌드·설치 또는 기본 standalone 교체는 범위에 포함하지 않는다.

## 계약과 소유권

- 열린 디렉터리에 상대적인 no-follow 연산으로 승인된 정확한 구성만 삭제한다. 새 항목, 누락, 교체, 링크, 특수 파일과 확인 불가 상태는 중단한다.
- 선택된 프로젝트 루트의 마운트 identity를 고정하고 대상까지의 중간 경로와 모든 하위 항목을 검사한다. Linux의 같은 device bind mount도 구분한다. 권한·소유권·ACL을 바꾸지 않는다.
- durable intent 이후 모델 권한 callback을 추가하지 않는다. 실패 시 기존 그룹 중단 및 부분 결과 기록을 유지한다.
- root는 계약·호출 통합·문서·최종 수용을 소유한다. unix_adapter는 새 Unix 어댑터와 집중 테스트, catalog_prepare는 Linux 환경 준비를 소유한다. 공유 입력의 컴파일은 동결 후 실행한다.

## 검증과 실행 조건

1. 기존 no-follow primitive와 workspace rustix/libc를 재사용한다. 정적·포맷 검사 후 집중 회귀와 전체 maintenance 패키지 검사를 실행한다.
2. Linux는 WSL2의 Linux 파일시스템과 비특권 사용자에서 실제 실행한다. 마운트 fixture는 별도 namespace가 가능한 경우만 실행하고 전역 마운트는 변경하지 않는다.
3. macOS는 승인된 SSH 경로의 프로젝트 위치를 사용자에게 요청했다. 해당 위치 확인 후 원본을 보존한 입력으로 실제 검증한다. 미검증 플랫폼을 통과로 보고하지 않는다.
4. Windows는 기존 기능과 승인 callback·intent·부분 실패 계약의 회귀 검사를 실행한다.

## 산출물과 정리

출력 전에 run:ff1:unix8을 pending run-root로 등록했다. 로컬 임시 산출물은 artifacts/tasks/ff1/runs/unix8에 둔다. Linux·macOS 출력은 생성 전 정확한 소유 루트와 정리 절차를 기록하며 원본 체크아웃을 변경하지 않는다. 최소 검증 근거를 work에 보존한 뒤 사용이 끝난 산출물은 기존 owner 절차로 삭제하고 실제 부재를 확인한다. 이전 사용 승인된 구형 실행기의 보호는 유지한다.

## 진행 기록

- 2026-11-03: 구현 시작. WSL2 Linux x86_64와 ubuntu 사용자를 확인했다. Rust toolchain은 아직 확인되지 않았다. macOS 원격 프로젝트 절대 경로 답변을 기다리며 독립 작업을 진행한다.
- Linux 작업 전용 도구·정확한 의존성 준비 후 첫 집중 6개, 전체 231개, 별도 namespace의 같은 device 디렉터리·파일 bind mount 1개가 실제 exit0으로 통과했다. macOS ARM64 cross-check도 exit0이지만 실기기 실행과 구분한다. Windows 회귀 254개가 실제 exit0으로 통과했다. 소스 동결 전후 identity는 각 owner가 확인했다.
- 코드 검토에서 Unix 성공 응답의 기존 attributes·physical_bytes_reclaimed 필드 누락을 발견해 복원했다. 먼저 실행한 동결 입력은 보존하고 Unix 입력을 새로 동결해 Linux 검사를 재실행한다. Windows 코드는 이 cfg(unix) 출력 보정의 영향을 받지 않는다. 기능 보존 목록의 기존 cli.rs 소유자 중복도 제거하고 실제 목록 검증을 통과했다.
- 사용자는 Mac 체크아웃 절대 경로를 모른다고 답했다. laio-dev-mac의 felrer/Darwin ARM64/macOS 26.7.2를 확인했고, 프로젝트 이름의 제한된 후보 경로는 없었다. 홈 전체나 다른 저장소는 검색하지 않는다. /Users/felrer/azrael-ff1-unix8을 새 작업 전용 검증 입력 루트로 지정하며 원격 원본 저장소는 수정하지 않는다. 생성 전에 별도 소유 receipt를 기록하고 적용 가능한 조상 지침을 확인한다. 로컬 제어 기록은 같은 run-root 아래 mac이 소유한다.
- 최종 Unix 소스는 ba2203f31f4cc48cac301f88c2eaf0d782bfd0da01dbb7b7184b3fdafd1ce5ee다. 응답 필드 복원 뒤 포맷 보정과 APFS fixture 보정으로 입력을 다시 동결했으며, 각 시도와 실제 실패를 별도로 보존했다. APFS가 invalid UTF-8 이름 생성을 EILSEQ로 거절하는 경우를 정확히 인정하되 프로토콜 경로 거절을 직접 검사하고 다른 생성 오류는 실패로 유지한다. 제품의 거절 규칙은 완화하지 않았다.
- 최종 Linux 집중 6개·전체 231개(exit0, 특권 fixture 1개는 기본 실행에서 ignored), macOS 집중 5개·전체 231개(exit0), Windows 전체 254개(exit0)를 확인했다. Linux의 별도 namespace에서 같은 device 디렉터리·일반 파일 bind mount, 실제 CLI 성공 응답·외부 hardlink 내용/0444 모드 보존·부모 0555 권한 거부 후 보존을 확인했다. 테스트 코드만 바뀐 최종 Linux 입력은 전체 검사를 새로 실행했고, 제품 코드 prefix·다른 모든 입력의 동일성을 확인해 직전 경계 fixture 근거를 재사용했다. Windows의 후속 변경은 cfg(unix) 내부뿐이므로 검증한 Windows 실행 코드의 회귀 근거를 재사용했다.
- Mac의 작업 전용 128MiB APFS 이미지에서 등록·검토 후 삭제가 mount boundary crossed로 실패하고 모든 marker와 뒤의 그룹 로그가 보존됐다. 정확한 장치의 일반 detach와 실제 연결 부재를 확인했다. 원격 새 검증 입력은 Git 체크아웃으로 꾸미지 않고 Windows 고정 입력을 출처로 기록했다. 시스템 도구·프로필·서비스는 변경하지 않았다.
- 독립 검증 근거는 79-unix-verification.json에 승격했다. Linux /home/ubuntu/azrael-ff1-unix8과 Mac /Users/felrer/azrael-ff1-unix8은 정확한 소유·token·producer 종료·lease와 mount 부재를 재확인해 각각 일반 삭제하고 별도 부재 확인까지 완료했다. 로컬 run-root는 검증한 기존 standalone의 등록→검토→적용 절차로 정리 중이며 결과는 80-unix-cleanup.json과 불변 81-unix-retirement-evidence.json에 기록한다.
- 소스와 관련 문서·기능 소유자 연결, rustfmt 검사, diff 공백 검사와 기능 목록 검증을 확인했다. 기능 목록의 기존 cli.rs 중복만 정리했다. 현재 작업 파일에는 앞선 최적화 및 다른 미커밋 변경이 함께 있고 저장소 index에도 다른 작업의 staged 변경이 있어, 이번 결과를 독립적으로 검증 가능한 완전한 commit으로 분리할 수 없었다. 이를 함께 commit하거나 index를 재구성하지 않고 보존한다. 앱·standalone 설치 교체는 하지 않았다.
- 로컬 정리의 inventory/register/review/apply는 모두 실제 close·exit0이었다. 등록 63.159초, 검토 6.136초, 삭제 159.030초는 이 임시 산출물 묶음의 관측값이며 통제된 성능 비교가 아니다. 모든 확장 항목이 deleted이고 artifacts/tasks/ff1/runs/unix8의 실제 부재와 producer catalog의 run:ff1:unix8 부재를 확인했다. 불변 81 근거를 사용한 최종화도 완료했다. Linux·Mac·로컬 Windows의 이번 작업용 disposable payload는 남아 있지 않다. 검증 요약 79의 cleanup-pending 표시는 당시의 불변 승격 시점이며, 최종 정리 상태는 80이 소유한다. 이전 사용 승인된 구형 group 실행기는 이번 정리 범위에 포함하지 않았다.

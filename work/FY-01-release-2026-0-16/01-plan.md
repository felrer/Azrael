상태: 2026.0.16 Windows x64 GitHub 공개 배포 준비 중. 사용자 추가 결정 없음.

# Azrael 2026.0.16 배포

사용자 승인: 기존 public felrer/Azrael에 2026.0.16 게시. Windows x64만 대상이며 새 제품 컴파일·다른 버전·사용자 설치 변경·브랜치 push는 제외한다.

입력: artifacts/p/artifacts/releases/win016-ez01-paint-r8-20261102 및 deployments/deploy-win016-ez01-paint-r8-20261102/package-r3/independent-prepared.json. VSIX SHA256 31f709fe57d95083f04395903fb624a6c4fee8f213ad583b3b957c781d52f7da. 동결 p 프로젝트 스크립트와 버전 설정 사용. 기존 source/engine/fresh-host 검증은 EZ-01 근거 재사용. Modern Paint virtual input 미수용은 notes에 표시.

절차: 입력 identity → 공개 ZIP → relocation/isolated host 검증 → publisher preflight → 게시 및 remote size/SHA 확인 → 임시 fixture/log 정리 → 기록 커밋. 제품 계약·설계 변경 없음.

예정 소유: artifacts/app-releases/2026.0.16-public-20261107은 버전 assets/provenance, artifacts/logs/release-016-public-20261107은 compact acceptance/publication evidence, artifacts/p/artifacts/verification/r016pub는 disposable fixture. 작업 소유자 release-016-public-20261107. fixture는 종료·참조 확인 후 clean-verification-artifacts로 삭제한다. raw logs는 최소 근거 보존 후 정리한다. 기존 빌드/설치 외부 입력은 보존한다.

Tag는 기존 remote commit e9bbdc4441abbf1975a6c8019240a96c5e88b4eb를 사용하며 binary provenance와 별도임을 표시한다. published bytes를 덮어쓰지 않는다.


배포 gate: 현재 app-release.md는 2026.0.14 이후 내장 maintenance CLI를 요구한다. 실제 2026.0.16 zrael.exe maintenance capabilities는 unexpected argument로 exit1이다. 기존 제품을 변경하지 않는 이번 재배포에 한정한 예외를 사용자에게 요청했다. 승인 전 원격 게시는 보류하며 독립 패키지 검증만 진행한다.

공개 패키징 actual exit0. ZIP 980,790,238 bytes / SHA256 413ba36af53e44301fea339ce0898f36f49f30a0d207f781f3982edeb51155fc. engine source fd6d670d37970763b140b1a7a7ebda297e56b9451796b329ccea8f1ff283f7fe. 별도 재배치/공존/standalone 검증 진행 중. CLI 예외 승인 대기.

사용자가 2026.0.16의 내장 maintenance CLI 요구사항 예외 배포를 명시 승인했다. 해당 제한은 릴리스 노트에 표시하며 나머지 무결성/재배치/호스트 gate는 유지한다. 원격 게시 승인 충족.

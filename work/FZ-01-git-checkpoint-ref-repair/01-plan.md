# Git 체크포인트 참조 복구

상태: 복구 및 Git 명령 검증 완료. 작업 기록만 별도 커밋하며 실제 push는 수행하지 않음.

## 범위와 계획
- Windows 로컬 체크아웃의 Git 메타데이터 복구. 제품 기능 및 다른 플랫폼 변경 없음.
- 오류 참조: `refs/codex/turn-diffs/checkpoints/08538312f18e9a085028d4abbe019241/76e57db2d28e4d650ba38b9a2a0ef259/1793866605160/fb120012-63f6-4802-bfd5-7aec27bf80c1`.
- 파일은 41바이트 전체가 NUL. reflog와 packed-refs에 복원 정보 없음. 최초 손상 원인은 미확인.
- 정확한 손상 참조만 Git 소유 명령으로 제거하고 전체 ref 해석 및 fetch를 검증한다. 일반 삭제가 필요하면 정확한 파일 정체성과 NUL 내용을 재확인한다. 다른 참조나 객체를 정리하지 않는다.
- HEAD, 인덱스 및 기존 사용자 변경을 보존한다. reset, gc, prune, 실제 push는 수행하지 않는다.
- 기존 HEAD: `8757a470c60922a6d2fd7aeb62950b5c22a6e534`, origin/master: `9af5a792a8b2ec4db82c2178c918c9a6323807d2`.
- 기존 index SHA256: `AABAFDBD59CF1216AECB946DF6049E726A2DFB6356B186B29BDE738A97632BFC`.
- 기존 변경: `work/FW-01-volsnap-io-safety/69-build-continuation.md`, untracked `upstream/`. 다른 작업 소유이므로 보존.
- 검증: 참조 해석, fetch, push dry-run, 보존 확인. 전체 객체의 exhaustive 검증은 별도이며 이번 성공 범위를 확대하지 않는다.
- 제품 계약 변경이 없어 아키텍처/기능 inventory 변경 및 제품 빌드는 불필요. 영구 테스트도 추가하지 않는다.
- 작업 기록만 별도 커밋한다. 임시 plan 입력은 할당 직후 삭제한다. NUL 원본은 위 내용으로 정확히 재현 가능하므로 별도 백업을 만들지 않는다.

## 결과
- `git update-ref --no-deref -d`: exit 1, `reference broken`으로 해석 실패. 실제 잠금 충돌 아님.
- 경로의 reparse point 부재를 확인하고 `.lock`을 CreateNew/exclusive로 확보한 후 41바이트 NUL 내용 재확인. 정확한 참조 파일 하나를 PowerShell 일반 삭제로 제거. 획득한 잠금만 해제 및 삭제.
- `git for-each-ref`: exit 0, broken-ref 경고 없음.
- `git -c gc.auto=0 -c maintenance.auto=false fetch --no-recurse-submodules origin`: exit 0. 실제 원격 fetch 성공.
- `git -c gc.auto=0 -c maintenance.auto=false push --dry-run origin master`: exit 0. 실제 push 없음.
- 복구 직후 HEAD와 index SHA256은 위 시작 값과 동일. origin/master도 동일. 기존 수정 파일의 diff numstat는 전후 모두 5 additions / 1 deletion, upstream/도 그대로 남음.
- 임시 plan 입력과 복구용 lock의 실제 부재 확인. 별도 백업/테스트/빌드/원시 로그를 생성하지 않음. 실행 증거는 이 문서와 대화 도구 결과에 보존.
- 최초 NUL 손상 원인은 미확인. exhaustive 객체 무결성 및 GitHub Desktop UI 직접 조작은 수행하지 않음. 현재 fetch 실패에 대한 명령 수준 복구 검증은 통과.
- 작업 기록을 위한 최초 Python 호출은 PATH에 python이 없어 실패했으며, 설치된 Python312의 절대 경로로 할당 완료. 임시 입력 삭제 확인.

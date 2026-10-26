상태: 설치·검증·정리 완료. 최적화된 별도 실행기를 앞으로 이 체크아웃의 Windows 정리에 사용한다.

# 최적화 관리 실행기 설치

- 사용자 승인: 전체 앱 대신 최적화된 관리 실행기만 컴파일하여 앞으로 정리에 사용한다.
- 범위: Windows x64/MSVC standalone maintenance_owner. 내장 project_* 교체·앱 재빌드·Linux/macOS 배포는 제외한다.
- 기존 고정 archive after-v2의 195개 입력과 실제 최신 compiled source가 일치함을 확인했다. 기존 Windows 137개 native 회귀와 DX-04 실제 삭제 결과를 재사용한다. archive는 읽기 전용으로 소비하고 새 target/TEMP는 C:\Users\felre\Desktop\pi-harness-init\artifacts\tasks\dx05-owner-20261026에 둔다.
- 실행 순서: 관리 실행기 release 컴파일 → 별도 version 경로 설치·SHA 확인 → 실제 프로젝트 inventory 및 fixture 등록/review/apply·경계 거부 확인 → 운용 문서/프로젝트 지침 반영 → build/fixture 생성물 정리·실제 부재 확인 → 작업 commit.
- run: run:DX-05:owner-20261026, 경계 artifacts/tasks/dx05-owner-20261026. version: version:maintenance-owner:dx05, 경계 artifacts/versions/maintenance-owner-6f6f874e-win-x64-dx05. 지속 사용 실행기와 최소 검증 receipt는 승인된 납품물이며 교체·폐기 시 사용 참조를 재검토한다. 새 cache는 보존하지 않는다.
- root가 컴파일/설치/검증/정리를 소유한다. 다른 소스/설치본/index를 보존한다.

## 실행 결과

- 고정 입력은 DX-04 `inputs/after-v2`를 읽기 전용으로 사용했다. 195개 closure hash, 실제 유지관리/프로세스 소스, `maintenance_owner.rs` 포함 여부를 확인했다. 별도 fresh target을 사용해 이전 example binary 재사용을 배제했다.
- Rust 1.95.0, `cargo build -p azrael-project-maintenance --bin maintenance_owner --locked --offline --release --target x86_64-pc-windows-msvc`, exit 0, 컴파일 38.086초. 입력은 컴파일 전후 동일했다. 전체 앱 빌드는 수행하지 않았다.
- 설치: `artifacts/versions/maintenance-owner-6f6f874e-win-x64-dx05/payload/maintenance_owner.exe`, 1,597,440 bytes, SHA256 `6ffd3d7e5787439381740a8bb3a32a7f4d4ab0d91beba4ee145c954287a06a96`. 복사 전후 및 smoke 전후 hash가 같다.
- 설치된 실제 실행기로 primary inventory, fixture register/review/apply 모두 exit 0. 파일 3개를 포함한 등록 디렉터리 실제 부재와 비선택 sibling 내용 보존을 확인했다. 지원하지 않는 실행 operation·외부 request·상대 project 경계는 각각 예상한 exit 1/구체적 오류로 거부했다. 최신 동일 library의 기존 Windows 137개 회귀 근거를 재사용했다. Linux/macOS는 미검증이다.
- 운용 문서와 프로젝트 AGENTS에 앞으로 Windows 정리에 사용할 실행기 경로를 연결했다. 내장 도구 및 전역 설치 지침은 변경하지 않았다. executable 자체는 OS/프로젝트 경계를 적용하며 내장 turn sandbox/grant를 재현하지 않으므로 실행 환경 권한과 삭제 guard를 보존한다.
- 첫 close 요청은 필수 `producer_stopped_verified` 누락으로 거부되었다. 삭제는 시작되지 않았으며, 관측한 모든 자식 프로세스 종료를 정확히 명시해 같은 소유자 절차로 재요청했다.
- 설치물의 최소 build/smoke/cleanup 영수증을 version `verification/`으로 보존하고 run의 모든 생성물을 native register/review/apply로 삭제했다. 정리 apply exit 0, 22.710초, deleted/remaining=false/error=null/attributes=[] 및 실제 run 경로 부재를 확인했다. 원래 lifecycle은 finalized, remaining/references/blockers=[]이다. 기존 archive는 변경하지 않았다.
- 지속 사용 version은 lifecycle `version:maintenance-owner:dx05`의 retained/complete-membership 설치물로 등록하고 마지막 receipt까지 전체 재등록했다. 실행기와 최소 검증 근거만 남겼다. 교체 또는 사용 종료 시 현재 참조를 검토하여 폐기한다. 남은 일회성 cache·fixture·raw log·source copy는 없다. 제어 파일 `.git/dx05-plan-body.md`, `.git/dx05-cleanup-request.json`도 일반 삭제 후 부재를 확인했다.
- 최종 문서 diff 검사는 exit 0이다. 작업 commit은 `AGENTS.md`, `docs/ops/project-maintenance.md`, 본 계획에 한정하며 기존 index 항목과 작업 소스를 보존한다. 추가 앱 빌드나 재시작은 필요하지 않다.

상태: 삭제 미완료 — 실행 중인 다른 Azrael 프로세스의 관리 잠금으로 차단. 실제 삭제 0건.

# 오래된 로그 정리

- 요청/권한: 프로젝트의 최근 24시간 생성 로그를 제외한 로그 삭제. 코드·제품 동작·설치본 변경 없음.
- 범위: Windows x64 로컬 프로젝트 파일. 다른 OS/원격은 제외.
- 고정 기준: 2026-10-24 13:16:32 UTC (한국 2026-10-24 22:16:32). 파일 생성 시각 기준. 최근 로그와 쓰이는 로그는 보존.
- 절차: 기존 소유·정리 기록 재사용, 시각 확인, fresh review, 안전한 로그 그룹 delete 및 보호·혼합 그룹 defer, 실제 잔여 확인.
- 기존 DN-01 정리에서 남긴 소유 미확정/복구/검증 자료는 생성 시각만으로 보호 해제하지 않는다.
- 성공 기준: 삭제 가능한 오래된 로그 삭제와 부재 확인, 최근 로그 보존, 실패/보호/미확정 범위 명시.
- 설계 문서 및 제품 테스트: 제품 변경이 없어 불필요. 파일 상태와 관리 결과로 확인.
- 보고서 예정 소유: 이번 작업 폴더 reports. 삭제·보류 증거로 보존.

## 확인된 정리 경계

- `run:module-cache-management-r1`: 2026-10-19 생성된 순수 로그 6개, 3,673바이트. 기존 producer는 complete/revision 2/membership_complete이며 참조가 없다. 실제 파일도 로그 6개로 일치한다.
- 생성 근거: 원래 producer record의 owner `module-cache-tests`, role `logs`, 생성·갱신 시각과 실제 로그 내용. `module-cache-r2.log`는 module cache 회귀 exit=0, `registry-final.log`는 registration 회귀 exit=0, `cleanup.log`는 production cleanup 회귀 exit=0을 기록한다. 이 세 결과를 본 문서에 독립적으로 남겨 원시 로그 삭제 후에도 읽을 수 있다. 실패한 첫 실행 기록을 성공으로 바꾸지 않는다.
- 해당 6파일은 모두 CreationTimeUtc 2026-10-19 12:19–12:22 UTC이며 고정 24시간 기준보다 오래됐다. 소스·사용자 데이터·설치 바이너리 없이 종료된 검사 출력만 포함한다. 원래 생략된 generated/protection 메타데이터를 이 근거로 supported record API에서 보완하고 native 보호 정보 갱신 후 재검토한다.
- CN/CO 검증 evidence 그룹은 logs와 reports/스크린샷이 같은 그룹이므로 로그만 지우려는 범위를 넘기지 않고 보류한다. 실패 그룹은 불완전 membership 보호도 유지한다.
- BM-01 번역 로그 6개는 순수 로그이지만 `work`가 native protected_paths라서 이번 삭제에서 제외한다. 등록 시도는 기존 검토 잠금으로 거절됐으며 등록/삭제를 수행하지 않았다. 보호 경로를 변경하거나 우회하지 않는다.
- `artifacts/logs`의 생성 시각 메타데이터 조회: 파일 73,578개 중 73,575개가 오래됐지만 다수는 소스·설정·복구 자료다. 디렉터리 전체를 로그로 분류하지 않는다. 내용 전수 해시는 수행하지 않았다.


## 실제 결과와 재개

- 실제 삭제: 0파일·0바이트. 파일 삭제 명령은 실행하지 않았다. 최근 24시간 로그를 포함해 기존 로그 파일은 모두 유지됐다.
- native review는 15그룹/26항목을 반환했다. 관리 검토가 삭제 완료를 뜻하지 않는다. fresh 토큰과 항목별 blocker는 [현재 결과](reports/cleanup-state.json)에 보존했다.
- native 쓰기 작업은 `exclusive maintenance lock unavailable`로 두 차례 거절됐다. 정확한 잠금 `artifacts/maintenance/maintenance.lock`은 2026-10-25 13:14:21 UTC에 생성됐고 `pid=73132`다. PID 73132는 실제 실행 중인 Azrael 프로세스이며 부모는 70636이다. 다른 실행의 점유 잠금이나 프로세스를 종료·삭제하지 않았다.
- metadata 한 건만 변경: supported lifecycle record API로 `run:module-cache-management-r1` revision 2→3, 기존 단일 logs member의 생략된 generated/protection_known을 true로 보완했다. 상태 complete·기존 경로·구성·참조는 유지됐다. native refresh는 잠금 때문에 적용되지 않았다. 원시 manifest를 편집하지 않았다.
- 재개 조건: 잠금 소유 작업의 실제 종료와 정상 잠금 해제를 확인한 뒤 native `refresh_group` → 해당 로그 전부가 고정 기준보다 오래됐는지 재확인 → fresh review → 명시적 delete → actual remaining:false → supported finalize. 이전 토큰을 재사용하지 않는다.
- 나머지 보호/혼합 그룹은 로그만 분리하는 supported 소유 절차 또는 필요한 대체 증거와 참조 전환을 확인한 후 재검토한다. `work`의 protected_paths와 설치·실행·복구 보호는 변경하지 않는다.
- 제품 코드/설계/설치 변경 및 제품 테스트·빌드는 없다. 실행 증거: 파일 메타데이터·기존 producer 기록·원시 로그의 회귀 종료 요약·native review·실제 잠금과 실행 프로세스 확인. 보고서와 본 계획은 후속 정리의 근거로 보호된 작업 경계에 보존한다.

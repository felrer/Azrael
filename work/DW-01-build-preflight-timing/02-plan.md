상태: moduleCachePreflight 격리 소유 루트 2회 측정·검증·임시 자료 정리 완료. 기존 기본 캐시는 미검증이며 사용자 추가 조치 없음.

# 모듈 캐시 사전 검사 시간 측정

- 요청/권한: 이전 단계 다음 한 단계를 실행하고 동일하게 캐시를 고려해 2회 시간을 비교한다. 전체 빌드·검증·설치·기능 수정은 범위 밖이다.
- 실제 순서: deploy-azrael.ps1의 environment-preflight 다음은 모듈 캐시 helper 로드 → Open-BuildModuleCache → Get-BuildCacheProjects -RequireExisting → lease Dispose이다. 그 다음 verification-dependencies와 engine-source-preflight는 실행하지 않는다.
- 사전 조건: PowerShell 7.6.7 실제 버전 실행을 확인했다. 현재 artifacts/cache/modules는 부재이나 기존 producer catalog에 companion/providers 및 .lock/.projects.json custody 소유 기록이 남아 있다. 기존 기록/경로를 덮거나 주 소유 루트를 새로 점유하지 않는다.
- 실행 범위: root 단독으로 전용 run의 temporary/execution-project를 ProjectRoot/CacheProjectRoot로 선택한다. 현재 저장소의 실제 helper를 변경·모방하지 않고 그대로 호출한다. 이 단계는 제품 소스를 읽지 않고 캐시 경계·잠금·프로젝트 registry만 다루므로 전체 프로젝트 복사는 필요 없다. 기존 기본 캐시의 정상 여부나 실제 배포 가능성을 검증했다고 주장하지 않는다. 격리 선택과 그 한계를 대화에서 알렸다.
- 측정: Windows x64, 새 PowerShell 프로세스로 같은 단계 코드를 정확히 2회 실행한다. 1회차 cache root/registry 초기 생성, 2회차 같은 상태 재사용. 단계 본체 Stopwatch(ms)는 helper dot-source부터 Open/registry 조회/lease Dispose까지 포함한다. 별도로 전체 CLI wall time도 기록해 PowerShell 시작/보고 비용과 구분한다. 평균·두 회차 차이·감소율을 산출한다. OS 캐시는 초기화하지 않는다.
- 입력/검증: build-module-cache.ps1과 artifact-lifecycle.ps1 원본 hash 전후 일치, 두 회차 실제 exit0, 등록 프로젝트의 정확한 임시 실행 루트 일치, lease 해제, 생성파일 목록과 registry 동작을 확인한다. 2회 표본으로 일반 성능 분포/순수 캐시 효과를 단정하지 않는다.
- 소유/정리: 기존 artifact-run helper로 생성 전 신규 run 전체를 등록하고, 임시 실행 루트·config/스크립트·원시 보고서는 전부 그 내부에 둔다. 결과는 이 문서에 보존하고 현재 관리 도구의 group review/apply로 run 전체를 삭제하고 finalize한다. 신규 빈 부모 폴더도 제거한다. 정리 실패 시 보존 허락 없이 완료를 선언하지 않는다.
- 예상: 두 실행 자체는 수초 내외이며 60초를 첫 확인점으로 한다. 소유 등록/정리 대기는 측정값과 분리한다. 제품/지침 코드 변경이 없어 설계 변경·제품 빌드는 불필요하다. 작업 단위 커밋은 이 결과 문서만 포함한다.

## 실제 측정 결과

- UTC 2026-10-26T04:13:39.081Z → 2026-10-26T04:13:41.681Z. 결과 성공, 선택 입력 전후 해시 일치 true.
- lifecycle run:DW-01:module-cache-two-20261026T041333698Z, 전용 실행 루트 C:\Users\felre\Desktop\pi-harness-init\artifacts\tasks\DW-01\runs\module-cache-two-20261026T041333698Z\temporary\execution-project. 기존 기본 캐시 경로는 변경하지 않았다.

| 회차 | 단계 본체(ms) | 전체 CLI wall(ms) | 캐시 루트 사전 존재 | 실제 exit |
| --- | ---: | ---: | --- | ---: |
| 1 | 616.217 | 1329.373 | false | 0 |
| 2 | 542.771 | 1265.940 | true | 0 |

- 단계 본체 평균 579.494ms, 차이 73.446ms, 2회차 감소율 11.919%.
- 단계 본체는 실제 helper 로드/캐시 Open/registry 조회/lease Dispose까지다. 전체 CLI wall은 PowerShell 시작/결과 직렬화/별도 잠금 해제 확인도 포함하며 앞 단계의 전체 CLI 측정과 비교하려면 이 열을 사용해야 한다.
- 두 회차 모두 같은 owner/root 및 등록 프로젝트 1개를 사용했으며, 두 registry SHA가 같고 lease 해제 후 별도 exclusive Open이 성공한지 검사했다.
- OS 캐시를 비우지 않았고 별도 PowerShell 프로세스별 JIT/시작 비용도 다르므로 2회 차이를 순수 캐시 효과로 단정하지 않는다. 기존 기본 캐시 검증이나 제품 빌드는 수행하지 않았다.

### 입력/실행 identity

- scripts/build-module-cache.ps1: 1a7c775f35382cb0c1f566ea41724b60f19fb47dad72f8cdd9f215cf7884bf3a
- scripts/artifact-lifecycle.ps1: eda298ddfd021807248ffdbd87008cfcb09fc3cb4f29adc2e03bb453b5e87479
- scripts/deploy-azrael.ps1: a9d58d19e0071d9167532b0b807b3d10c906d2e8bd744b4c7a832e8a6fb4b66a
- 회차 1: {"stage":"moduleCachePreflight","stageMs":616.217,"rootExistedBefore":false,"registrySha256":"f7596573641386bc7a3ddb977e74e593df5066c75d4164538674482010a03c29","cache":{"owner":"C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\DW-01\\runs\\module-cache-two-20261026T041333698Z\\temporary\\execution-project","root":"C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\DW-01\\runs\\module-cache-two-20261026T041333698Z\\temporary\\execution-project\\artifacts\\cache\\modules","registeredProjects":["C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\DW-01\\runs\\module-cache-two-20261026T041333698Z\\temporary\\execution-project"]},"lockReleased":true,"powerShellVersion":"7.6.7","processPath":"C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.7.0_x64__8wekyb3d8bbwe\\pwsh.exe"}
- 회차 2: {"stage":"moduleCachePreflight","stageMs":542.771,"rootExistedBefore":true,"registrySha256":"f7596573641386bc7a3ddb977e74e593df5066c75d4164538674482010a03c29","cache":{"owner":"C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\DW-01\\runs\\module-cache-two-20261026T041333698Z\\temporary\\execution-project","root":"C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\DW-01\\runs\\module-cache-two-20261026T041333698Z\\temporary\\execution-project\\artifacts\\cache\\modules","registeredProjects":["C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\tasks\\DW-01\\runs\\module-cache-two-20261026T041333698Z\\temporary\\execution-project"]},"lockReleased":true,"powerShellVersion":"7.6.7","processPath":"C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.7.0_x64__8wekyb3d8bbwe\\pwsh.exe"}

## 정리와 최종 검증

- 컨트롤러와 두 PowerShell CLI 모두 actual exit0이다. 두 registry SHA가 동일하고 rootExistedBefore는 false → true로 바뀌었으며 registeredProjects는 전용 임시 실행 루트 1개였다. 매 실행마다 lease Dispose 후 exclusive Open으로 잠금이 해제됐음을 검증했다. 선택한 3개 스크립트 해시는 전후 일치했다.
- 결과와 입력 identity를 이 문서에 보존한 뒤 native 등록/registered-mode review: member 1개, 6,845 logical bytes, membership_complete=true, producer stopped/success/exit_code=0, references=[], blockers=[]를 확인했다.
- native cleanup_apply의 명시적 delete 결과: group/item status=deleted, remaining=false, error=null, aborted=false. 측정용 script·원시 로그·결과 JSON·격리 캐시의 .lock/.projects.json까지 전용 run 전체가 제거됐다. 물리 회수 용량은 미측정이다.
- supported lifecycle finalize actual exit0/status=finalized, remaining/references/blockers=[]를 확인했다. 전용 run과 신규 빈 부모 폴더 및 계획 body 파일의 실제 부재를 확인했다. 기존 artifacts/cache/modules도 여전히 부재이며 기존 소유 기록은 변경하지 않았다.
- 측정은 정확히 2회이며 실패/재측정은 없었다. PowerShell 버전 확인은 환경 준비이며 측정 횟수에 포함하지 않는다. 별도의 native 등록·검토·삭제 대기는 본체 및 CLI wall 시간에 포함하지 않는다.
- 빈 부모 폴더 삭제와 문서 갱신을 묶은 복합 명령 1회는 실행 전 blocked by policy로 거부됐다. 빈 상태를 각각 확인한 뒤 정확한 절대 경로 1개씩 비재귀 일반 삭제를 실행했고 모두 actual exit0이었다. 문서 갱신도 별도로 수행했다. 강제 삭제나 다른 API로의 우회는 없었다.
- 통계 재계산 및 작업 diff/문서 공백 검사로 결과를 확인했다. 제품 코드 변경·컴파일·설치 없이 요청한 결과 기록만 유지한다. 실제 기본 캐시 소유권 복구/주 프로젝트 배포 수용은 범위 밖이다.

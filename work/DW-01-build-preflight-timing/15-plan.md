상태: 근거가 확인된 테스트 정리 3건·집중 검증 4개·검증 생성물 삭제와 실제 부재·임시 관리 설정의 정확한 복원을 완료했다. 이번 테스트 변경과 기록만 작업 커밋으로 마감한다. 빌드·설치는 실행하지 않았다.

# 전체 빌드 테스트 정리

## 목표와 승인 범위

- 사용자가 `docs/playbooks/test-cleanup.md`를 적용해 전체 빌드 과정의 테스트 정리만 먼저 수행하도록 승인했다. `development-workflow`와 `implementation`을 같은 작업에 적용한다.
- 대상은 `deploy-azrael.ps1` → `test-project.cjs`의 full current/standalone 소스 검사, feature inventory가 연결한 source/native 검사, 준비·패키지·최종 host 검사의 테스트 소스와 테스트 전용 fixture/setup이다. `--FullRegression`과 조건부 선택의 차이를 구분하고 현재 선택된 17 engine feature만을 전체 지원 기능으로 혼동하지 않는다.
- 허용 작업은 보호 가치 없는 검사 제거, 동일 경계·입력·조건을 검증하는 중복 통합, 불필요해진 테스트 전용 setup/참조 정리다. 제품 동작·소스 선택 정책·성공 기준·필수 게이트·지원 플랫폼은 축소하지 않는다. 특히 여섯 final host gate와 보안·권한·소유·프로토콜·동시성·출처 검사는 유지한다.
- 공통 계약의 영향은 Windows x64/Linux x64/macOS ARM64이며 실제 실행 가능한 검증 환경은 Windows x64다. 플랫폼 고유 보호를 대체할 증거가 없으면 보존한다. 기존 실행 실패나 환경 제한은 삭제 근거가 아니다.
- 이전 생성물 전체 정리나 이전 빌드 재시도는 이번 변경에 포함하지 않는다. 새로 만드는 검증 생성물만 현재 소유 아래 선언하고 즉시 정리한다.

## 기준과 역할

- 시작 기준 HEAD `74df098938038ef019e6faddb656afb42b20ba31`. 기존 working tree와 unrelated staged 4파일은 보존한다. 다수 테스트에 기존 수정이 있으므로 파일 단위가 아니라 소유한 변경 범위만 커밋한다.
- root는 호출 경계·필수 의무·PowerShell 배포/cache/metrics 검사, 삭제·통합 결정, 변경 및 최종 검증을 소유한다. 세 read-only auditor가 Node source, UI/extension, native/preservation의 독립 경계를 조사한다. 자식 위임·제품 코드 변경·빌드·외부 설치는 허용하지 않는다.
- 각 후보는 제거 대상 assertion/case, 잡는 결함, 존속 검사와 동등한 경계·입력·실행 조건 또는 보호 계약 부재, runner/manifest 소비자 확인을 근거로 결정한다. unchanged 검사 전수 목록이나 삭제 할당량은 만들지 않는다.

## 실행과 수용

1. 실제 full build 호출과 테스트 선택/feature 의무를 확인한다.
2. assertion과 제품 경로를 읽어 keep/consolidate/rewrite/retire/remove/defer를 판단한다. 불확실한 검사는 유지한다.
3. 증거가 충분한 테스트 소스와 불필요한 test-only setup만 정리하고 관련 명시적 참조를 맞춘다.
4. 변경한 경계의 가장 작은 실제 검증과 필수 검사로 존속 보호를 확인한다. 새 테스트 파일·coverage 도구·전면 빌드를 추가하지 않는다. 실행한 실제 test 수/exit와 미검증 환경을 구분한다.
5. 새 disposable 자료의 실제 부재, staged diff의 소유 경계, 필수 게이트 유지를 확인하고 task commit 후 결과·남은 불확실성을 보고한다. 테스트 수 감소를 측정된 속도 개선으로 표현하지 않는다.

## 결정과 검증 결과

- full current/standalone 선택은 현재 policy 기준 159 소스 파일, exhaustive는 160 파일이며 extension-all이 별도다. 이 수는 삭제 목표가 아니며 유지할 검사 전수 목록을 새로 만들지 않는다.
- 통합: `test-deploy-azrael.ps1`의 `temporary references preserved`는 `full install`과 동일한 성공 설치 인자·경로를 실행하고 다른 temporary 소비자 참조만 추가했다. 그 참조 생성과 모든 참조 보존 assertion을 `full install`로 옮겨 동일 워크플로를 한 번만 실행한다. 기타 정상 설치·검증·필수 여섯 host 결과와 실패 게이트는 그대로다. 이름 소비자는 해당 fixture뿐임을 확인했다. 이 사례는 실패를 이유로 없앤 것이 아니며 이전 r8에서 실패한 참조 보존 검사는 존속한다. `verify only`/`parallel prepare`는 스케줄 조건과 명시적 mandatory 소비자가 달라 유지했다.
- 제거: `test-ui-input-diagnostics.cjs`의 `loaded-turn scan timing is bounded and recorded`는 1,000회 같은 결과를 확인하고 시간을 출력할 뿐 시간 임계값이 없다. 같은 snapshot 기능은 `identity remains while representations change...`가 검증하고, 실제 500 ID/10,000 항목 상한과 rate/repeat/render 캐시 한도는 해당 기능 검사에 남긴다.
- 개선: `test-asset-transform-cache.cjs`의 generic descriptor case는 두 경로가 같은 `runProviderContext`를 호출해 동일 no-op도 통과했다. 입력의 settings descriptor는 `Azrael settings`로 바뀌고 RPC/URL 문자열은 원래대로 남는 독립 expected text를 두 공개 경로에 확인한다. marker idempotence와 cache fingerprint invalidate/hit assertion은 유지한다.
- 보존/미결정: Node source 선택기·fixture·task-time 직렬화와 UI 경계는 서로 다른 결함을 잡으므로 삭제하지 않는다. provider-context의 pipeline parse는 cache 행렬과 경계가 달라 유지하며 조건부 실행되는 행렬만을 근거로 cache 검사를 없애지 않는다. Native feature별 wrapper의 동일 Cargo selector는 실제 중복이 있지만 단독 feature 선택과 check ID별 의무가 있으므로 이번 테스트 소스 정리에서 삭제하지 않는다. 교차 check 실행 결과 공유는 별도 설계 범위다. PowerShell의 출처/배포 wiring 검사는 스타일만으로 제거하지 않는다.
- 깊은 검토는 위 후보와 존속 검사·호출 경계를 중심으로 수행했다. 나머지 큰 queue/recovery/student-design 및 upstream Rust assertion을 모두 줄 단위로 검토했다는 뜻은 아니다. 추가 후보는 증거가 충분할 때 후속 정리한다.
- 이번 Node 검증의 cache fixture는 기존 `test-asset-transform-cache.cjs` 소유 `artifacts/cache-scope-test-<mkdtemp>`에서 생성돼 existing after hook의 ordinary 제거로 종료됐다. 실행 전 해당 생성 경로와 cleanup owner를 선언했으며 새로운 유지 fixture나 테스트 파일은 추가하지 않았다. 결과 로그·독립 요약은 기존 빌드 작업 소유 `artifacts/tasks/dw13-build/test-cleanup-*`에 둔다. PS fixture는 `run:deploy-checks:9ca1f9da00444db490e5c1afb2f59c86`이 `artifacts/tasks/deploy-checks/runs/tc15-r1`과 정확한 shortTemporary를 소유했으며 실제 exit 0/1 case 확인 뒤 supported close/native review/apply로 삭제·finalize했다.

- 검증 실제 결과: 통합 `full install` workflow 1개(PS7, session 17823) exit 0; generic label contract 1개(Node26.7) exit 0; diagnostics snapshot/한도 2개 exit 0. 새로운 cache-scope-test prefix 경로는 existing after hook 종료 후 0개임을 확인했다. `test-cleanup-verification.json`(SHA `b41e182ab126c3cbf22365ed379bc1a9d6df3a1fa9bf0d116e745d54d03a9aae`)에 현재 test hashes·모의 설치 metrics·선택한 version 참조 해제/다른 version 참조 보존 증거를 독립 보존했다. PS producer supported close success/exit0/revision3/ref[] 완료.
- 정리 차단: dx05 SHA를 다시 확인하고 register 실제 exit 0/6.352초, fresh registered review exit 0/5.335초였다. `C:/Users/felre/Desktop/pi-harness-init/artifacts/t-9ca1`은 0바이트 빈 디렉터리지만 PRIMARY managed_roots 밖이라 `outside configured managed roots`로 차단됐다. 같은 그룹의 `C:/Users/felre/Desktop/pi-harness-init/artifacts/tasks/deploy-checks/runs/tc15-r1`(408,859 logical bytes)도 그룹 보호로 함께 차단됐다. 삭제·archive·직접 API 우회는 수행하지 않았다. 이전 r7의 shortTemporary는 PRIMARY의 `artifacts/workspaces` 아래라 삭제 가능했던 것으로, 현재 위치에 적용 가능한 예외 절차는 없었다.
- 승인된 추가 범위: `project-maintenance.json`의 다른 현재 변경은 보존한 채 정확한 빈 `artifacts/t-9ca1`만 임시 관리 경계로 추가하고 native `retire_managed_roots`의 현재 증거·fresh review/apply로 이 그룹을 정리한 뒤 그 임시 경계만 제거한다. 상위 `artifacts` 전체 경계 확장이나 다른 폴더 삭제 권한을 뜻하지 않는다. 사전 config SHA `bb5cb61aa3b117feb46099407b7bb8fd355a0df394e032a7a905e8e699e0654a`, 임시 config SHA `f85e9848a8ea39be615188c192526aa60327c3f776caccde4359ac40a2e5b464`로 기록했다. 보호된 관리 근거는 `artifacts/maintenance/evidence/test-cleanup-tc15-r1-retirement.json`이며 정확한 item 하나의 경계 폐기와 승인·검증 identity를 포함한다. 새 retirement review actual exit 0/5.949초, 두 expanded 멤버 blockers[]를 확인한 fresh token으로 delete를 한 번 시작했다.
- 승인 범위의 정리 실제 결과: retirement apply(session 13703) actual exit 0, aborted false, 두 native 항목 모두 deleted/remaining false/error 없음. 원래 producer의 5개 멤버 경로는 전부 lstat ENOENT이며 supported finalize 결과 remaining[]/references[]/blockers[]다. 임시 `artifacts/t-9ca1` 설정 한 줄만 제거한 config SHA가 작업 전 `bb5cb61aa3b117feb46099407b7bb8fd355a0df394e032a7a905e8e699e0654a`와 같아 다른 현재 설정을 정확히 보존했다. archive·cleanup 잔여물 없음. 독립 결과는 `artifacts/tasks/dw13-build/test-cleanup-cleanup-result.json`, 경계 폐기 근거는 보호된 bounded management evidence 아래 보존한다.
- Git stage는 이번 3파일의 정확한 부분 7추가/10삭제와 이 작업 문서만 포함한다. 기존 다른 작업의 staged 4파일 및 각 파일의 사전 수정은 보존한다. 실제 정리 완료 후 일반 task commit을 수행하며 push/빌드/설치는 하지 않는다.

원래 빌드·설치는 여전히 미완료이며 이번 정리 통과가 제품 빌드 통과를 뜻하지 않는다.

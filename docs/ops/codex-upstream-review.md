# Codex upstream PR review

상태: `current` — Node 개발 도구. Windows x64에서 상태 검사, 실제 GitHub 고정 소범위 preview와 원장 조회·판단·적용 기록을 검증했다. Linux x64/macOS ARM64 실행은 미검증이다. PR 자동 적용·제품 빌드·설치는 하지 않는다.

## Records and checkpoints

`scripts/codex-upstream-review.json`은 Git으로 유지하는 원장이고 `scripts/codex-upstream-review.cjs`가 읽기·쓰기 owner다. Node와 GitHub CLI `gh`를 사용한다. 네트워크 동작에는 github.com 읽기 권한이 필요하다. Git evidence에 참조된 Azrael 커밋이 로컬에 없으면 검사에 실패한다.

- `ranges`: 고정 base/head SHA 사이 전체 commit과 PR/직접 commit 분류. 첫 수집에는 명시적 base가 필요하고 이후는 마지막 **수집** head부터 이어진다.
- `entries`: PR/직접 commit의 판단과 적용 상태. selected/equivalent/excluded/deferred 판단에는 이유·근거가 필요하다. deferred에는 재검토 조건이 필요하다. 의존성은 먼저 add/collect한 entry ID로 연결하며 순환을 거절한다.
- `implementation`: none/applied/verified를 판단과 별도로 기록한다. applied는 Azrael 커밋·feature ID·근거, verified는 추가로 검증 scope/platform/실제 exit 0/source identity/요약을 요구한다. 도구는 근거의 hash를 검사하며 실제 테스트나 서술의 참/거짓 판정을 대신하지 않는다.
- `reviewedThrough`: 모든 항목의 판단이 있는 연속 범위 끝. 보류가 있어도 검토는 완료할 수 있다.
- `acceptedThrough`: reviewed이고 선택 항목이 모두 verified인 연속 범위 끝. selected/equivalent 항목의 의존성도 verified 또는 equivalent여야 한다. 제외·보류 항목이 적용됐다는 뜻은 아니다. 각 entry의 scope를 확인하며 source 검사를 package/installed 수용으로 확대하지 않는다.
- `baseline.priorCoverage: unknown`: 첫 수집 base 이전 전체 검토 여부는 알 수 없다. 마지막 적용 PR이나 과거 PR 개수만으로 완료 기준점을 만들지 않는다.

compare의 전체 pagination·total·중복·base/merge-base를 검사한다. diverged/behind 비교는 거절한다. 고정 commit별 연결 PR을 모두 조회하며 선택 저장소/브랜치에 병합되고 merge commit이 해당 범위에 있는 PR만 연결한다. 나머지 commit은 직접 commit으로 남긴다. API 실패·불완전 수집 시 원장에는 쓰지 않는다. 상세 body/diff는 저장된 URL과 기존 GitHub 도구로 검토한다.

## Commands

프로젝트 루트에서 실행한다. JSON 출력의 revision은 원장 바이트의 SHA-256이다. 모든 쓰기는 직전에 확인한 revision을 요구한다. placeholder는 실제 값으로 바꾼다.

```powershell
node scripts/codex-upstream-review.cjs status
node scripts/codex-upstream-review.cjs check
node scripts/codex-upstream-review.cjs show --id pr:58404
node scripts/codex-upstream-review.cjs collect --preview --base BASE_SHA --head HEAD_SHA
node scripts/codex-upstream-review.cjs collect --expect REVISION --base BASE_SHA --head main
```

이후 collect --expect REVISION은 마지막 수집 head부터 현재 main을 고정해 수집한다. 새 commit이 없으면 쓰기를 거절한다. 초기 base는 확인 가능한 실제 upstream 커밋을 선택한다. SOURCE의 head가 공개 저장소에서 조회되지 않으면 버전 tag를 같은 ancestry라고 간주하지 말고 이전 coverage를 unknown으로 남긴다.

```powershell
node scripts/codex-upstream-review.cjs add --expect REVISION --pr 57839
node scripts/codex-upstream-review.cjs review --expect REVISION --id pr:57839 --decision selected --reason "재개 후 토큰 계산 보완" --evidence work/SESSION/PLAN.md
node scripts/codex-upstream-review.cjs review --expect REVISION --id pr:57819 --decision deferred --reason "먼저 시작 지연을 측정" --retry-when "플러그인 시작 지연 조사 시" --evidence work/SESSION/PLAN.md
```

진행 중인 plan은 바뀔 수 있다. 근거가 커밋됐다면 --evidence-commit AZRAEL_SHA로 Git blob을 고정한다. 생략하면 현재 파일 hash를 저장하고 파일 변경 시 check가 실패한다. 과거 근거를 묵시적으로 새 파일로 바꾸지 말고 확인 후 재기록한다. 자기 커밋을 참조할 수 없으므로 이미 존재하는 커밋을 사용한다.

```powershell
node scripts/codex-upstream-review.cjs record --expect REVISION --id pr:57839 --state applied --commits AZRAEL_SHA --features engine.selected-upstream --evidence work/SESSION/VERIFICATION.json
node scripts/codex-upstream-review.cjs record --expect REVISION --id pr:57839 --state verified --commits AZRAEL_SHA --features engine.selected-upstream --evidence work/SESSION/VERIFICATION.json --platform windows-x64 --scope native --exit-code 0 --source "검증한 source identity" --summary "실제 선택 검사와 결과"
node scripts/codex-upstream-review.cjs close --expect REVISION --range HEAD_SHA --stage reviewed
node scripts/codex-upstream-review.cjs close --expect REVISION --range HEAD_SHA --stage accepted
node scripts/codex-upstream-review.cjs check --complete
```

check는 구조·의존성·근거 hash·로컬 커밋·feature 등록을 검사한다. --complete는 추가로 미검토/선택 후 미검증 항목과 미수용 범위를 거절한다. 보류는 허용하되 backlog에 계속 표시된다. 새 review는 해당 항목의 적용 증빙과 관련 범위 완료를 무효화한다. 동일 판단의 증빙 갱신에는 record를 쓴다.

## Source and preservation integration

원장은 SOURCE나 검증 receipt를 대체하지 않는다. 실제 이식은 기존 source recorder와 영향받는 feature의 mandatory check를 따른다. 작업 완료 전에 원장을 검사하고 소스·검증·원장·작업 문서를 정합한다. 증빙을 자기 커밋으로 고정해야 하면 코드·검증 커밋 뒤에 원장 연결을 마무리하는 커밋을 둘 수 있다.

쓰기는 sibling exclusive lock, revision 재확인, 같은 디렉터리 temporary file의 atomic rename을 사용한다. 기존 lock을 제거·탈취하지 않는다. 중단으로 protocol 파일이 남으면 정확한 실행 종료와 소유권을 조사한 뒤 기존 owner 절차로 처리한다.

반복 작업의 pagination 누락, 보류 손실, 완료 gate 단순화를 막는 작은 메모리 검사를 유지한다.

```powershell
node --test scripts/test-codex-upstream-review.cjs
```

초기 이관과 실제 결과는 [작업 기록](../../work/DO-01-codex-version-comparison/04-plan.md)을 따른다. 초기 #55991은 적용 기록을 유지하지만 기존 검증의 정확한 source binding을 원장으로 복구하지 않았으므로 applied다. PR 재이식이 필요하다는 뜻은 아니다.

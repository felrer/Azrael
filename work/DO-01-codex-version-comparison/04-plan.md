상태: 구현·Windows 검증·protocol 파일 정리 완료. 작업 소유 변경만 분리해 커밋한다. 전체 PR 검토·추가 이식·제품 빌드·설치·push는 범위 밖이다.

# Codex PR 검토 자동화

## 승인 범위와 구현

사용자가 PR 검토 도구 구현을 승인했다. 기존 대화의 설계에 따라 Git 관리 원장으로 고정 upstream 범위, PR/직접 commit 판단, 적용·검증을 분리했다. Node 표준 라이브러리와 gh 읽기 전용 REST를 재사용하며 dependency는 추가하지 않았다. Windows x64/Linux x64/macOS ARM64 공통 개발 도구이며 실제 검증은 Windows x64다. 제품 UI·engine 코드는 변경하지 않는다.

- scripts/codex-upstream-review.cjs: status/show/check/collect(--preview)/add/review/record/close. root가 구현·통합·최종 수용을 소유했다. 독립 worker는 scripts/test-codex-upstream-review.cjs만 소유했고 위임하지 않았다.
- 완전한 ancestor compare의 페이지·total·중복을 확인하고 고정 SHA commit→PR 연결을 최대 4개 병렬 조회한다. 직접 commit도 남기며 전체 성공 전에는 쓰지 않는다.
- 판단 unreviewed/selected/equivalent/excluded/deferred와 적용 none/applied/verified는 독립이다. 판단 근거·보류 조건·의존성·Azrael commit·feature ID·검증 scope/platform/exit/source identity를 연결한다.
- 검토와 수용 완료는 연속 범위 gate다. 미검토 항목 또는 미완료 이전 범위를 건너뛰지 않는다. 수용은 선택 항목의 검증과 selected/equivalent의 전이 의존성 충족을 요구한다.
- evidence는 현재 파일 hash 또는 immutable Git blob에 고정한다. exclusive lock과 기대 revision, atomic rename으로 충돌을 거절하고 lock을 탈취하지 않는다.
- SOURCE 출처 검증을 재구현하지 않는다. 기존 feature inventory의 engine.selected-upstream owner/source check와 전용 maintenance test bundle을 확장했다. 기존 work playbook과 보존 설계, 새 운영 문서를 연결했다.

## 초기 이관과 coverage

- #55991은 applied다. 기존 102개 Windows 통과는 immutable Git plan에서 확인했지만 정확한 원래 source binding을 이번 원장으로 복구하지 않아 verified로 승격하지 않았다. 재이식이 필요하다는 뜻이 아니다.
- #54654/#58404는 기존 증빙에 따라 verified(native/windows-x64)다. 실제 GitHub merge metadata와 local integration commit, immutable verification blob을 연결했다.
- 과거 전체 검토는 unknown이다. collected/reviewed/accepted 범위를 만들어내지 않았다. 최초 collect에는 확인 가능한 실제 upstream base SHA를 지정해야 한다. 전체 PR 전수 검토는 이번 작업이 아니다.

## 검증 결과와 제한

- retained Node 9개: pagination/PR 중복/직접 commit, incomplete/diverged/API 실패, 오래된 보류 보존, 미검토 순서 gate, review/acceptance 분리, 근거/보류 조건, dependency/cycle/동등 구현 의존성, 원장 변조, immutable transition. 반복 업데이트에서 gate를 단순화해 누락시키는 실수를 막기 위해 유지한다. 임시 fixture는 메모리만 사용한다.
- 최종 project_tests run-17084-4851-1793586655887099600 / plan-2dcd4a9352b697210e9be52342d3925f6447e5ff75b40610f7adbc814cb1cedd: 실제 exit 0, 9 passed/0 failed/0 skipped, before/after input integrity valid, producer_completed=true.
- 최소 log reference: tool-call:exec-049c1dd5-a11a-402b-8822-2421e97fb025:step-8b7bb9819b0cb6f8e96466f4502339719de23a743c81560dd934cdbe5c8fa98c. 시작/종료 UTC 2026-11-02T02:30:55.887Z / 2026-11-02T02:30:57.863Z. 첫 9개 성공 후 전이 의존성 보완으로 재실행했다. 긴 빌드나 자원 대기는 없었다.
- 실제 GitHub readonly preview exit 0: e7b8d3a36db7ca5c05428b95a0099dd2f6d37eb7..7a030b97699b9fc7f997dd322a3926c03faaeb6c → commit 1개 / pr:58404. 원장 범위에는 쓰지 않았다. 실네트워크 대규모 pagination은 실행하지 않았고 여러 페이지는 fixture로 확인했다.
- 실제 CLI 초기 세 건 review/record와 status/check/show/help exit 0. check --complete는 #55991 증빙 이관 미완료로 기대한 exit 1이며 원장 무변경을 확인했다.
- 실제 writer one-off exit 0: stale revision/기존 lock 거절, test lock 내용과 원장 보존, 동일 원장 atomic write 성공. 정확히 이 실행이 만든 protocol lock만 finally에서 ordinary unlink했고 sibling tmp/lock 부재를 확인했다. 외부 lock·ACL·속성 변경 없음.
- selected feature subset validateManifest exit 0. 전체 validateManifest는 기존 tool.project-maintenance의 area 규칙에서 실패했다. 이번 owners/check 추가를 제거한 메모리 manifest도 같은 오류였다. 선행 문제를 이번 범위에서 고치지 않았다.
- Windows x64 / Node v26.7.0 / gh 검증. Linux x64/macOS ARM64 및 설치 제품은 미검증이다. 도구는 증빙의 내용이 참인지나 모든 기능 보존을 보장하지 않는다.

## 정리·완료

유지 소스·원장·문서·retained test 외 disposable 파일이 없다. raw 로그·clone·빌드·fixture 폴더를 만들지 않았다. 원장 writer가 소유한 protocol lock/tmp는 실제 부재를 확인했다. project test의 최소 control receipt는 기존 관리 owner가 소유한다. 작업 변경만 commit하고 unrelated working tree/index는 보존한다.

## 최종 소스 identity

- scripts/codex-upstream-review.cjs: SHA-256 a18b2ab49cb7b8a74b6aec2faa1f1f078ab68b4f0fe9037783f3454b3a06c491
- scripts/test-codex-upstream-review.cjs: SHA-256 c73c55dd1cf09b068c8a4c7f556ed7207963c7c26397e8af07580c797048563b
- scripts/codex-upstream-review.json: SHA-256 17417641803b1ff7b367d7111a4118a73f63fdae610b5339600bdf3383e3ec34

상태: source-tests 1회 실행·입력 변경 진단·이번 생성물 정리 완료. 2회차와 후속 단계는 입력 변경 때문에 미실행이다.

# 최적화 후 source-tests 단계 재개

- 사용자 승인: 기존 빌드를 한 단계씩 진행한다. 10초 이하 단계는 이어가고, 첫 10초 초과 성공 단계는 같은 설정으로 총 2회 측정해 보고한다. 실패는 후속 실행과 두 번째 측정을 차단한다.
- 다음 실제 단계는 source-tests이다. engine-source-preflight 이후 source-tests는 아직 성공하지 않았고 extension-build는 미실행이다. DW-08~10의 축소·선택·캐시·중복 검사 개선을 현재 소스 그대로 사용한다. 삭제된 과거 receipt를 재사용했다고 주장하지 않는다.
- Windows x64/Node 26.7.0, concurrency 4. 주 프로젝트에서 변경 기반 selection을 기존 args-file/SHA parser로 얻고 공개 runSelection API에 source command만 전달한다. 전체 selection·연기한 후속 command·coverageStatus를 기록하며 승격하지 않는다. 타 OS·제품 빌드·설치는 이번 검증 범위가 아니다.
- 준비: 실제 원본 computer runtime과 instruction engine 경로/fixture readiness를 검사한다. 현재 instruction library fixture helper를 사용하고 폐기된 1.0.0 자료는 생성하지 않는다. Python 3.12와 PowerShell 7.6.7을 자식 PATH에 고정한다. TEMP·instruction catalog/migration/packaging·UI cache를 소유 경계에 지정한다. 중복된 instructionService 실제 사전 실행은 하지 않는다.
- root 소유 run:DW-11:source-tests와 artifacts/tasks/dw11-tests, artifacts/tasks/tw11을 출력 생성 전에 lifecycle 등록한다. .git/dw11-*는 root 제어 파일이다. 테스트가 자체 생성하는 lifecycle/추가 경로는 전후 catalog 차이로 조정한다. 기존 runtime·설치본·archive·사용자 정리 예정 자료는 건드리지 않는다.
- 두 실행 동안 프로젝트 입력/환경/선택을 고정한다. 실행 전후 complete snapshot SHA와 inventory를 모두 비교한다. 기존 compareSnapshots의 gitlink trailing slash 진단 오류가 이미 확인됐으므로 실제 입력 inventory 동등성으로 검증하고 관측한 실제 exit를 먼저 기록한다. 실행 중 기록·소스 변경과 cleanup을 병행하지 않는다. 완료 신호 또는 예상 20분 확인점까지 중복 producer를 시작하지 않는다.
- 이번 생성물은 결과 검토 후 독립 검증 요약을 본 기록에 보존하고 최적화된 maintenance_owner로 register/review/apply, 실제 부재 확인·finalize한다. 새 보존 예외는 없다. 이전 자료는 사용자가 따로 삭제한다고 명시했다: artifacts/tasks/dw09-checks, artifacts/tasks/tw09, artifacts/t-b7c4, .git/dw09-*. 이 범위는 사용자가 정리할 때까지 보존하며 DW-09의 설정 변경이나 직접 삭제는 수행하지 않는다.
- 설계/제품 코드 수정 없이 기존 검증 owner를 실행한다. 입력 drift·실패 시 원인과 실제 시간을 기록하고 후속 단계를 차단한다.

## 실제 결과와 다음 경계

- 준비: 실제 source fixture readiness의 26개 요구가 모두 ready였다. 변경 목록 926개로 총 131파일이 선택되었고, 이번 source 명령은 그중 Node 검사 129파일·동시성 4다. 전체 selection은 `test-deploy-azrael`, `test-verification-state`, `extension-build`, `extension-changed`도 포함하지만 아직 실행하지 않았다. 공통 policy owner 변경이 있어 per-case omission은 0이었다. 과거 engine-source-preflight receipt는 재사용하지 않았다.
- Windows x64, Node 26.7.0. 사용자 시간 2026-10-27 00:07:14→00:21:14(KST). source-tests 공개 runSelection 경계 시간 **839.7350552초(13분 59.735초)**, 내부 source command 838.980초, Node test runner 자체 838.912764초다. 이 시간들은 서로 포함되며 더하지 않는다.
- 실제 Node 명령은 exit 0/signal null, tests 1,946 / pass 1,939 / fail 0 / skip 7 / cancel 0, stderr 0바이트다. 완전한 현재 입력에 묶인 passing receipt로 인정하지 않는다.
- 실행 전 complete input SHA `9f19c4ba9a402f4d1ed71ca96228834adfd0e2958844db33ef5e85d48c67171a`, 후 `68aa6e5d83807512e94b561c0f52a1c60cbc8d71454a5262ec34c7f5c8ee3259`로 달랐다. 실제 전체 inventory 비교에서 변경 파일은 정확히 세 개였다: `docs/architecture/root-resume.md`(수정), `scripts/inject-question-queue.cjs`(수정), `work/DY-01-deferred-input-queue/01-plan.md`(추가). root는 실행 동안 이 파일들을 수정하지 않았다. 수정 소유 작업을 되돌리거나 진행 중 입력에 맞춰 결과를 승격하지 않았다.
- 실제 source exit 0과 별개로 입력 검증 controller는 exit 1이다. 완료 신호도 failed/exit 1이며 실제 실행 session의 종료를 확인했다. 2회차와 후속 빌드는 실행하지 않았고, 표본 1개이므로 평균·캐시 개선율을 산출하지 않는다. 기존 약 15분 실패 결과와도 입력·검증 범위가 달라 성능 개선율로 비교하지 않는다.
- skip 7개: Unix 실행 모드/권한, pinned headless journal, Windows native viewer preflight, exact native typed config, native failure rollback, 대소문자 충돌 filesystem, owned config snapshot transaction이다. 필요한 native fixture/다른 OS의 통과 근거로 삼지 않는다. coverageStatus는 `requires-separate-checks`다.
- catalog 전후 새 외부 producer group은 없었다. source 경계가 끝난 뒤에만 진단·문서·정리를 재개했다. 다음 source-tests 시도는 변경이 정리된 새 입력 identity가 필요하며, 입력을 보존한 상태에서 다시 측정해야 한다. 이번 작업은 실패 원인에 맞춰 제품 코드를 변경하지 않는다.

## 정리

독립 검증 근거는 위 기록에 남겼다. 최적화 owner SHA-256 `6ffd3d7e5787439381740a8bb3a32a7f4d4ab0d91beba4ee145c954287a06a96`를 확인하고 기존 424개 그룹을 조회했다. 이번 두 root를 지원 close로 실패 outcome/exit 1과 complete membership으로 마감했다. 최초 등록은 migration fixture junction 때문에 exit 1로 중단되어 삭제되지 않았다. fixture 소유 코드와 실제 링크·대상을 확인한 9개 junction만 `verified_junctions`로 정확하게 선언했다. 모두 같은 소유 migration 경계 안의 target이었다. 일반 셸/API로 삭제하거나 link guard를 우회하지 않았다.

수정 등록은 actual exit 0(16.086초)이었다. 등록이 아직 진행 중일 때 앞선 review 1회는 unknown lifecycle group/exit 1로 종료됐다. 실제 등록 종료를 확인한 다음 fresh review를 다시 수행해 exit 0(7.859초), 두 멤버 blockers 빈 배열을 확인했다. 명시 delete apply actual exit 0(37.404초), aborted false, 두 멤버 deleted/remaining false/error null이었다. `artifacts/tasks/tw11` 41,711,155바이트와 `artifacts/tasks/dw11-tests` 115,435,193바이트를 삭제했고 실제 부재를 확인했다. 물리 회수량은 측정하지 않았다. lifecycle finalize도 finalized/remaining·references·blockers 빈 배열이다. 이번 제어 파일 `.git/dw11-*`는 기록 커밋 후 보통 삭제·부재 확인한다.

이전 DW-09 자료는 사용자가 별도 정리하겠다고 명시했으므로 수정·삭제하지 않았다. 이번 task commit은 본 실행 기록만 포함하고, 기존 변경과 다른 작업의 동시 변경·Git index를 보존한다.

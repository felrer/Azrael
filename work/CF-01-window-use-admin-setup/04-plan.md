# 검증·모듈 캐시 점유와 소비 참조 관리

상태: 사용자 승인으로 캐시 관리 개선을 구현 중이다. 기존 빌드·패키지·설치·Window Use 검사는 중지 상태를 유지하며, 캐시 관리의 집중 검증만 수행한다.

## 목표·권한·범위

검증 결과 캐시의 점유 반환·복구, 종료된 프로젝트의 모듈 캐시 소비 참조 정리, 실제 삭제와 보류를 구분하는 보고를 개선한다. 기존 점유 12개와 u19b catalog 누락은 근거가 확인되는 대상만 복구하며, 나머지는 필요한 복구 근거와 함께 보류한다. 현재 설치 f/u22c, u23h 빌드·실패 기록·rollback 및 Windows 세션은 보존한다. 전체 재빌드·배포·실사용 시험은 이번 작업에 포함하지 않는다.

공통 Node 캐시 의미와 PowerShell 모듈 캐시가 대상이다. 실제 검증 환경은 Windows x64다. 다른 OS는 기존 경로·소유·실행 의미를 보존하며 네이티브 실행 수용으로 확대하지 않는다. 단순 PID 부재·시간 경과·누락된 catalog로 점유나 참조를 삭제하지 않는다.

## 구현과 의존 관계

1. 검증 캐시 owner는 새 점유에 실행·체크·획득 신원을 추가하고 정확한 token/owner hash와 독립적인 producer tree 종료 근거에 묶인 inspect/recover API를 제공한다. 현재 실행 중·신원 미확정·변경된 점유·연결 경로는 차단하며 실제 삭제 결과와 보존 영수증을 남긴다.
2. 모듈 캐시 owner는 등록 프로젝트 inspect/retire 흐름과 삭제 수·바이트·보류·후속 조건을 제공한다. 실제 비어 있는 canonical catalog와 종료·소비자 부재 근거를 검증하며 catalog 누락은 복원할 진짜 근거가 없으면 보류한다.
3. root는 feature-preservation의 오류 경로에서 점유 반환과 실행 증거를 보강하고, 기존 canonical lifecycle retirement를 정식 CLI로 연결한다. 점유 API가 준비되면 소비 코드·집중 통합 검증을 연결한다. 캐시 키 입력 축소·Cargo 검사 조합 공유·전체 배포 DAG 변경은 이번 점유/수명 관리 안정화 후 별도 영향 검토 대상으로 남긴다.

검증 캐시와 모듈 캐시 작업은 독립 소유자가 병행한다. root는 공유 계약·통합·최종 인수·기존 실제 기록 복구 판단을 소유한다. 기존 미커밋 작업과 불변 입력·영수증을 보존하며 임의 커밋하지 않는다.

## 성공 기준과 검증

- 정상·실패 종료에서 실제 점유 반환, 살아 있는 점유 보호, token/PID 재사용·경로·증거 변경·복구 경쟁 거부를 집중 테스트한다.
- 진짜 종료된 빈 프로젝트는 등록에서 제거되고 사용·pending·누락된 catalog는 보류됨을 검증한다. 현재 설치·rollback·compiler·참조 보호와 ordinary deletion 실패 보존을 유지한다.
- cache hit·pass-only·내용 hash 검증·검증 실패 상태는 유지한다. 이전 실행 실패를 성공으로 바꾸지 않는다.
- 새 테스트 산출물은 담당 run에 먼저 귀속하고 실제 종료·exit·cleanup/defer를 기록한다. 전체 스크립트/네이티브 제품 회귀는 재개하지 않는다.

설계·운영 owner는 docs/ops/development.md의 캐시 절차와 docs/playbooks/build.md, 기능 목록의 기존 캐시/보존 owner다. 상세 명령은 운영 문서에, 이번 결과와 한계는 이 기록에 둔다.

## 구현 및 집중 검증 기록 (2026-10-19)

- 저장소 owner에 체크·실행 경로·획득 시각·프로세스 시작 식별자를 추가했다. token/owner 바이트 해시를 확인하는 반환·저장·증거 기반 복구와, 중단된 복구 claim을 재개하는 경로를 구현했다. 종료 증거 없는 PID 부재·시간 경과로는 회수하지 않는다.
- 완료한 검사는 즉시 lease를 반환하며, 기존 최종 입력 검증 이후 동일 키 lease를 다시 얻어 결과를 저장한다. 전체 실패/드리프트와 pass-only 의미는 유지한다.
- 모듈 프로젝트 inspect/retire 명령, genuine empty catalog·종료·소비자/설치/rollback 해제 증거 검사, 실제 삭제 파일/바이트/잔여 경로 및 복구 조건을 구현했다. canonical lifecycle retirement CLI에는 증거 SHA256 고정을 추가했다.
- 저장소 테스트 최종 18개, lifecycle 재검증 15개, 모듈 RegistryOnly/CleanupOnly/전체 집중 suite와 CLI parser가 Windows x64에서 exit 0이다. 최초 lifecycle 테스트는 CLI가 인수 배열을 소비하는데 테스트가 재사용한 문제로 실패하여 복사 인수를 사용하도록 수정했고 재검증했다. 모듈 첫 전체 실행의 링크 오류 문구 호환 문제도 기존 tree guard 재사용으로 고친 뒤 통과했다. 원본 실패 로그는 유지한다.
- 실제 Cargo 잠금 12개 중 cancellation.json에 producer 50608(부모 31972)와 자식 트리 종료가 포착된 정확한 1개를 inspect/recover로 반환했고 경로 부재를 확인했다. evidence/decision/result JSON을 root run에 유지했다. PID 52716의 나머지 11개는 독립 종료 증거 부족으로 보존한다. u19b catalog 누락은 실제 inspect에서도 blocked이며 원본 provenance 복원 전까지 등록을 유지한다.
- 보존/파이프라인 통합 테스트가 실행 중이다. 빌드·패키징·설치·Window Use 시험은 재개하지 않았다. 캐시 키 축소·Cargo 그룹 조정은 이번 변경에 포함하지 않았다.
- 저장소 agent의 native maintenance 등록은 기존 exclusive maintenance lock(OS error 80) 때문에 보류됐으며 우회하지 않았다. producer lifecycle와 테스트 로그/보고서는 보존하고, 통합 인수 후 잠금의 소유 producer 종료를 증명하여 유지보수 등록/검토가 가능해질 때 재검토한다.

최종 상태: 캐시 관리 구현과 집중 검증을 완료했다. 통합 실행의 보존 13개·파이프라인 8개 기능 assertion은 통과했다. lifecycle의 테스트 인수 재사용 오류는 수정 후 전체 15개 exit 0으로 확인했다. 보존 suite after-hook은 PATH에 pwsh가 없어 실패했고, 남은 13개 소유 fixture는 Windows PowerShell의 357자 경로 제한을 확인한 뒤 같은 Remove-Item에 extended-length 경로를 사용해 ordinary deletion으로 제거했다. pwsh 7 경로를 설정한 신규 동작/정리 재시험은 exit 0이며 잔여 fixture 0개다. 배치 최초 exit 1과 원인·재시험을 verification.json에 구분했다.

후속 native maintenance 등록/검토는 성공했다(초기 lock 오류는 더 이상 재현되지 않음). 세 run 전체를 명시적으로 defer하여 검증/실패/복구 증거를 보존했다. storage의 retained 상태에 따른 incomplete projection, module log의 protection 미확정은 삭제 우회 없이 보호 상태로 둔다. 원본 source 변경이 기존 미커밋 작업과 섞여 있어 임의 stage/commit하지 않았다. 제품 빌드·설치·실사용 검증은 수행하지 않았다.

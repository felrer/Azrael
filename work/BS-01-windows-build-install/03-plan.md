상태: 빌드 지침 수정과 사용자가 추가 승인한 지침 정리 1번 완료·검증. 2–6번은 제안이며 아직 실행하지 않았다.

목표는 이번 Windows 빌드에서 확인한 실패 발견 지연·재실행·검증용 컴파일 비용을 지침에 반영하는 것이다. 사용자가 권장 수정안을 실행하도록 승인했다. 불필요한 지침의 제거는 구체적인 정리 계획만 요청했으므로 실제 삭제 범위는 이번 실행에 포함하지 않는다. 현재 w31b 빌드 입력과 실행은 바꾸지 않는다.

공통 규칙은 instructions/skills/implementation/references/build-inputs.md와 설치된 동일 스킬 사본에 반영하고 출처 metadata를 유지한다. Azrael의 구체적인 사전 검사 선택·적용 순서는 docs/playbooks/build.md, 지원되는 명령은 docs/ops/development.md가 소유한다. root는 공통 계약·프로젝트 문서·통합 검증을 소유하고 common worker는 공통 reference/설치 사본/SKILLS-SOURCE.json만 변경한다. read-only auditor는 main AGENTS·5개 SKILL·work/build playbook에서 중복·불필요 내용 후보와 보존 owner를 조사한다. 구현 코드의 자동 선행 gate·추가 계측·더 세밀한 증거 재사용은 별도 후속 구현 항목이며 문서 수정으로 구현됐다고 주장하지 않는다.

적용 규칙: 긴 빌드 전 작은 실패 검사를 실제 대상/도구/캐시와 맞춰 실행, 전체 입력과 검사 범위의 구분, 실패 집중 통과 후 영향받은 후속 부분만 재생성, 테스트 준비 컴파일·실행·잠금/자원 대기와 전체 경과 시간의 구분, 메모리/CPU/디스크/lease 기반 동시 실행, 최종 package identity·fresh host6단계 유지, 폐기된 사본·로그·소비 참조의 연결 정리. 공통 의미는 지원 대상 공통이며 구체적인 PTY 사전 검사는 Windows x64/MSVC에 한정한다. 타 OS의 검증 통과를 주장하지 않는다. 신규 승인 단계나 임의 시간 제한을 만들지 않는다.

검증은 유지 library importer --check, 변경된 설치 사본 내용 일치, 문서 간 routing/명령과 현재 API의 대응, 필요한 instruction source 검사로 제한한다. 이미 통과한 Windows PTY9개와 실제 w31b 병목 기록을 재사용하고 문서 변경 때문에 제품 전체 빌드를 반복하지 않는다. 계획 산출물은 이 문서에 중복·유지 owner·조치·위험을 묶어 제시하며 보안/권한/출처/필수 최종 검증/사용자 데이터 보호는 줄이지 않는다. 과거 SOURCE-* provenance는 불필요한 live instruction으로 취급하지 않는다.

실제 반영: 공통 build-inputs reference의 기존 절을 정리·보완하고 설치 사본과 SKILLS-SOURCE.json을 맞췄다. 프로젝트 Build playbook에 변경 경계별 조기 검사, 실패 집중 재현, 검사 범위 선택 및 자원별 동시 실행 판단을 반영했다. Development operations에 기존 native owner를 호출하는 Windows PTY 사전 검사 예제를 추가했다. 새 runner 자동 단계나 실제 성능 개선 수치를 구현했다고 주장하지 않는다. 공통 reference는 7,937→9,777 bytes로 늘었다. 이번 변경은 불필요 지침 축소 작업 자체가 아니다.

검증: `python -B scripts/import-instructions.py --check` exit 0 (24 skill files, 10 components, 60 links), 설치 reference와 유지본 byte 일치. 로그는 `artifacts/tasks/windows-latest/runs/w31b/guidance-common/import-instructions-check.log`. PowerShell 예제 구문 분석 exit 0, `runWindowsNativeTests` export/호출 인수 대응 확인, scoped `git -c core.whitespace=cr-at-eol diff --check` exit 0. `SourceTestConcurrency`는 실제 `scripts/deploy-azrael.ps1:30,196`에서 default 4/range 1–16 및 test runner 전달을 확인했다. 이 옵션의 운영 설명을 옮길 때 해당 선언을 기준으로 한다.

불필요 지침 정리 — 1번은 후속 요청으로 실행했다. 나머지는 아래 순서의 제안이다. 각 행의 소유 문서가 현재 규칙을 충분히 보존하는지 먼저 확인하고, 중복 본문을 짧은 조건부 링크로 바꾼다. 독립 설치되는 각 스킬에서도 필수 진입 경로가 유지되어야 한다.

| 순서 | 후보·현재 근거 | 유지할 소유 문서 / 제안 조치 | 완료 조건·위험 |
| --- | --- | --- | --- |
| 1 완료 | 플랫폼 범위 체크리스트가 project AGENTS, global snippet, workflow Requirements, implementation Scope, Work에 반복 | 공통 분류 원칙은 global Platform Scope, Azrael 지원 계약은 `docs/architecture/multi-platform.md`; 스킬별 책임과 짧은 진입 경로만 유지 | 요청 대상·제외 환경·실제 검증 환경 구분을 보존. 지원 상태는 현재 계약 owner의 플랫폼별 제한된 증거를 참조 |
| 2 | 작업 진입·동일 기록·권한 설명이 global snippet:7–17와 workflow:10,34–36, collaboration:20–23, implementation:10–12에 반복 | global router에서 공통 경계를 소유하고 각 스킬에는 고유 절차만 유지 | 5개 스킬 routing, 기존 실행 권한 승계, 스킬을 읽어도 권한이 늘지 않는다는 규칙 유지 |
| 3 | 상시 주입 global snippet:29–43의 도구 출력·로그 보고 세부와 implementation:20,102,123 중복 | global에는 증거·불확실성의 짧은 공통 원칙; 코드 조사·실행 보고 상세는 implementation 소유 | 비개발 작업에도 증거 원칙이 남고 실제 범위·종료 코드·첫 원인·로그 위치가 유지되는지 확인; Windows 검색 예제도 실제 유효성 확인 후 제거/이동 |
| 4 | worktree 안내가 global snippet:49–51, project AGENTS:15–17, Work:96–111에 반복 | 공통 절차는 implementation worktrees reference, 프로젝트 commit/publish 조건은 Work; 진입부는 조건+링크로 축약 | 통합·검증·작업트리 삭제·삭제 확인 및 원격 게시 별도 권한을 보존 |
| 5 | 공유 지침 유지 안내가 project AGENTS:21, global snippet:43와 instructions README:45–61,77–81에 반복 | `instructions/README.md`를 유지 절차 owner로 두고 진입부 설명 축약 | 유지 library·활성 설치 사본·metadata 동기화와 원래 출처 보존. SOURCE-* 이력은 삭제 대상에서 제외 |
| 6 | Build playbook의 실행 옵션/예제가 operations의 명령 소유 원칙과 겹침 (Build:4,42,50,55–57,64,66,88–101) | 정책·최종 패키지 수용 조건은 Build, 확인된 명령/기본값은 `docs/ops/development.md`에 모은 뒤 링크로 대체 | 실제 script 인수와 비교; 고정 입력·출처·실행 runtime/사용자 데이터 보호·필수 최종 검증은 축소하지 않음 |

정리 검증은 링크·진입 경로·유지 owner의 의미 보존, importer --check, 활성 설치본 동기화로 진행한다. 제품 동작을 바꾸지 않는 문서 정리 때문에 전체 앱 빌드를 다시 돌리지 않는다. 대략적인 현재 영문 단어 수는 global snippet 900, 5개 스킬 합계 8,544, project AGENTS 473, Work 1,535, Build 3,082이다. 이는 거친 텍스트 규모이며 토큰 수나 절감 실측치가 아니다. 삭제량 목표를 먼저 정하지 않고 중복이 사라졌는지와 필수 규칙이 남았는지로 판단한다.

1번 실행 결과: 공통 분류·범위 구분·미검증 환경 처리·기존 권한 승계를 global Platform Scope에 보존하고 workflow/implementation의 반복 열거를 해당 절과 프로젝트 계약으로 연결했다. project AGENTS와 Work는 계약으로 직접 진입하며, multi-platform의 Requirement applicability는 프로젝트 대상/acceptance owner와 검증 gate를 연결한다. design-collaboration/project-bootstrap에는 같은 플랫폼 체크리스트가 없어 수정하지 않았다. 기존 project AGENTS/Work의 Windows-only 문구는 현재 multi-platform owner에 이미 기록된 제한적 Linux/macOS 증거와 달라 반복 상태 문구를 제거하고 owner 참조로 바꿨다. 새 플랫폼 통과나 제품 지원 확대를 주장하지 않는다.

유지 library 6개 본문 파일 합계 8,726→8,311 words(공백 분리 기준, 415 words 감소). 배포용 전역 절과 활성 CODEX_HOME 전역 절의 내용 일치, 변경한 스킬 2개 byte 일치, 관련 owner 링크 유효 확인. 기존 활성 전역 파일에는 플랫폼 절이 없었으므로 그 절만 추가하고 개인화 경로와 다른 지침은 보존했다. SKILLS-SOURCE.json의 original 출처는 유지하고 현재 hash/size와 adaptation만 갱신했다. importer --check exit 0, diff --check exit 0. 검증 결과는 `artifacts/tasks/windows-latest/runs/w31b/guidance-platform/validation.json`. 실행 중 w31b의 고정 입력은 수정하지 않았다.

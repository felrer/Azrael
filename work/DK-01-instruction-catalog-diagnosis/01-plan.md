상태: 추가 스킬 이전·공용 활성 경로 정리 및 이번 검증 fixture 정리 완료 — 개인 원본은 Git·배포 제외, 기존 스킬 포함 상태 유지. 이전 회차 산출물 보류는 아래 별도 기록과 구분합니다.

# 지침 문서 가져오기 오류 분석

## 남은 스킬 이전 승인 및 실행

- 사용자 확정: brainstorming·obsidian-skill-manager 삭제, internal-visualization 이전, liam-mac-mini-ssh 개인용 이전, ktcloud 코드·지침 및 개인 설정·기록을 Azrael로 이전하고 Git에서 제외할 자료를 구분한다. 권고한 Azrael 배포 계약 보완도 승인됐다. 삭제는 기존 논의대로 활성 설치 링크 제거이며 Vault 원본은 보존한다. 실 계정 접속·GitHub 게시·전체 앱 빌드/설치는 포함하지 않는다.
- 추가 확정: 사용자 승인에 따라 공용 `C:/Users/felre/.agents/skills`의 같은 대상도 함께 정리한다. 앞서 옮긴 core 스킬의 공용 Vault 링크도 Azrael 원본으로 바꾸고 삭제 두 대상은 공용/전용 경로 모두에서 해제한다. 공용 경로의 다른 Codex 환경에 영향을 줄 수 있음을 안내했다. 원본 5개 비교의 파일 동일성은 맞았으나 이전 설치 검증은 공용 Vault 링크 잔존을 누락했으며 이번에 보완한다.
- 공개 소스: `instructions/skills/internal-visualization`, `instructions/skills/ktcloud-ai-nexus`. 기존 기본 5개와 구분해 선택 설치(default=false)로 추가한다. 개인 SSH 스킬은 `instructions/.private/skills/liam-mac-mini-ssh`, ktcloud 개인 기록은 `instructions/.private/ktcloud-ai-nexus/state`에 둔다. `.private` 전체를 Git과 지침 배포 ZIP·문서 색인·manifest에서 제외한다. 실제 인증 자료는 기존 기기별 저장소에 유지하고 읽거나 복사하지 않는다.
- root는 공개/개인 디렉터리 경계, 시각화·개인 SSH 복사, 설치 링크/네이티브 최종 검증, 설계·provenance·매핑·통합·커밋을 소유한다. ktcloud 담당은 해당 공개/개인 두 폴더만, 배포 담당은 importer/release builder/관련 package 테스트만 소유한다. 공유 레지스트리 잠금 경합을 피하도록 검증 실행은 root가 조정한다. 플랫폼 의미는 공통이며 현재 실제 이전·회귀는 Windows, SSH·클라우드 실동작과 Linux/macOS 수용은 별도다.
- ktcloud 문서·코드 원본과 개인 상태 원본을 분리한다. 저장소 실행의 기본 기록은 `.private` 아래이며 배포 설치는 격리된 CODEX_HOME의 `azrael/skills/ktcloud-ai-nexus/state`를 사용한다. 명시적 상태 루트 선택은 절대경로만 허용하고 임의 대체하지 않는다. 기존 계정 선택·권한·SSH 키/프록시/동시성·비밀정보 금지 조건은 유지한다.
- 검증: 공개 스킬 provenance 및 상대 참조 완전성, 개인 복사본/기록의 원본 해시 일치, Git 무시 여부, 실제 패키지의 private 제외와 제외 경로 매핑 거부, ktcloud 코드/상태 루트 분리와 기존 관련 테스트, native 신규 경로 로딩·포함 상태 보존·삭제 두 스킬 미발견을 확인한다. 확인한 원본 링크 대상으로 복구 가능하며 실제 Vault 문서는 삭제하지 않는다.
- 이번 검증 생성물의 소유자는 DK-01이며 사전 선택 경계는 `artifacts/tasks/DK-01-instruction-catalog-diagnosis/runs/private-skills-20261025-b1b49cd2/`이다. logs와 reports는 실제 종료코드/요약, temporary는 패키지·코드 검증 fixture만 소유한다. 비어 있는 temporary의 최초 native 등록은 tree entry disappeared로 실패해 payload를 생성하지 않았다. 빈 경계 생성 후 재등록하고 실제 실행 뒤 현재 측정과 참조를 갱신해 정리한다. 사용자 개인 자료와는 별개다.
- 최초 패키지 회귀 33 통과/0 실패/2 환경 조건 생략, 실제 public-tree 테스트 패키지 88개 파일 생성 성공이다. 실제 생성물 native apply 검증은 깊은 임시 경로의 SQLite 초기화 실패로 중단했다. 별도 strict-config 검증은 통과했다. Windows 경로 길이 영향을 분리하기 위해 같은 소유의 짧은 fixture 경계 `artifacts/tasks/DK-t20261025-a/`를 추가로 사전 선택하며, 기존 긴 경계와 같은 정리 그룹으로 관리한다. 초기 Python313에는 psutil이 없어 기존 설치된 관리형 Python312/psutil6.1.1을 재사용한다. psutil 종료 반환값과 pwsh 전제의 기존 테스트를 실제 종료 검증 및 설치된 Windows PowerShell 선택으로 보완하고 제품 동작은 유지한다.

### 이번 이전의 최종 결과

- 시각화 11개 공개 파일, ktcloud 공개 27개(기존 25개+상태 루트 resolver 및 회귀 테스트)로 총 공개 skill 파일 62개, 구성요소 12개이다. 추가 두 공개 스킬의 기본 설치는 꺼짐이고 기존 5개 core 기본값은 유지한다. 시각화 예제의 개인 절대경로는 일반 예제 경로로 바꿨다. 공개 복사본은 LF로 정규화하고 PowerShell은 UTF8 BOM을 유지하며 원래/현재 해시와 변환 이유를 출처 기록에 보존했다.
- 개인 SSH 문서 3개와 ktcloud 기존 기록 62개는 원본 해시 일치로 복사했다. ktcloud 개인 경로 기본값은 추가한 private profile.json에 분리했다. `.private`의 Git 추적 파일은 0개이며 개인 SSH와 프로필의 ignore를 확인했다. 인증·쿠키·SSH 키 저장소는 읽거나 옮기지 않았다.
- 활성화: 사용자 승인된 공용/전용 링크 10개를 Azrael 원본으로 변경하고 brainstorming/obsidian-skill-manager 활성 링크 4개를 제거했다. 실제 Vault 원본은 보존했다. 새 네이티브 프로세스에서 core 5개+이전 3개가 각각 한 번씩 새 경로로 로드됐으며 모두 기존 enabled=true이다. 설정 파일 변경 없이 로딩 오류는 2건에서 0건이 됐다. 현재 앱의 장기 실행 연결은 창 재로드/새 대화 후 적용 상태를 확인한다. 링크 기반 설치에 대한 카탈로그 안내 자체는 별개 정책으로 남는다.
- 검증 실행은 Windows에서 전체 package 35/35, ktcloud runner 28/28, query guard 12/12, state root 5/5 통과(exit 0)다. 12개 PowerShell 구문과 7개 Python AST도 통과했다. 코드·개인 상태 resolver를 직접 실행하고 전용/공용 활성 경로가 동일한 private 상태를 선택함을 확인했다. Windows의 C:. 같은 드라이브 상대 경로를 절대경로로 오인하지 않도록 보완하고 실제 거부를 검증했다.
- 실제 source-tree 검증 패키지는 88개 파일/82개 문서/12개 구성요소이며 private 자료가 ZIP·문서 색인·manifest에 포함되지 않았다. 실제 네이티브 격리 apply에서 67개 대상과 재적용 차이 없음까지 검증했다. 마지막 상태 경로 guard 수정 후 최종 byte identity로 다시 생성·검증한 native 2/2도 exit 0이다. 최종 sourceContentSha256은 `571bbdbdb4e6d9b18e580963704109ed5944c6e8dcf6c3a824e0cc1eaf8ff578`이다. 이는 sourceDirty=true인 로컬 검증 패키지이며 게시·앱 빌드·확장 재설치가 아니다.
- 실패와 재실행: Python313의 psutil 누락은 기존 관리형 Python312를 재사용해 해소했다. runner의 이미 종료된 psutil 프로세스 반환값 판정, query 테스트의 pwsh 고정과 fixture BOM 제거/PowerShell 파싱 오류 은폐를 테스트에서 교정했다. 종료 확인·실제 wrapper 실행·오류코드 검증을 약화하지 않았으며 제품 runner는 변경하지 않았다. query 테스트의 WSL 하위 프로세스 정리 검증은 일반 Linux 데스크톱 수용을 의미하지 않는다. 실제 클라우드/SSH 연결은 수행하지 않았다.
- 정리: 잠금으로 최초 재등록이 실패했으나 이후 지원 API로 현재 두 fixture 경계를 전체 재등록하고 실행 참조를 해제했다. native review blockers=[] 확인 후 delete 결정을 적용해 `temporary/`와 짧은 `artifacts/tasks/DK-t20261025-a/` 모두 remaining=false, group deleted를 확인했다. 잠금 파일은 변경하지 않았다. 필요 증거 약 45KB의 logs/reports는 `work:DK-01:private-skills-evidence-20261025`로 별도 등록하고 defer를 적용했다. 재검토 조건은 후속 수용 검증이 이 증거를 대체하고 이 문서의 참조를 해제할 때이다. 이전 회차 보존 18개 run 그룹은 이번 삭제 대상이 아니다.
- 증거 위치: `artifacts/tasks/DK-01-instruction-catalog-diagnosis/runs/private-skills-20261025-b1b49cd2/`의 logs/package-accepted.log, package-verified.log, ktcloud-runner-final.log, ktcloud-query-accepted.log, query-debug.log 및 reports/activation.json, package-accepted-summary.json, package-verified-summary.json. 테스트 패키지·fixture 원본 경로는 위 지원 정리로 제거됐다. 신규 state-root 테스트는 코드/개인 상태 분리의 지속 회귀 계약을 보호하므로 유지한다.
- 최종 Git 검사에서 새로 가져온 파일 4개의 여분 EOF 빈 줄을 제거했다(기능 변화 없음). 이 바이트 정리 후 별도 새 fixture 세대 `artifacts/tasks/DK-t20261025-b/`에서 실제 패키지/native 2/2(exit 0)를 검증했다. `package-format-final.log`와 `package-format-final-summary.json` 및 `public-release-format-final.json`에 최종 신원을 남기고, 새 세대도 native full registration·review·delete로 remaining=false를 확인했다. 기존 삭제 경계를 재사용하지 않았다. 기능 인벤토리 스키마/소유 파일 참조 검증과 격리된 Git index의 diff-check도 통과했다.

## 남은 개인 스킬의 Azrael 관리 이전 조사

- 범위: `brainstorming`, `internal-visualization`, `ktcloud-ai-nexus`, `liam-mac-mini-ssh`, `obsidian-skill-manager`의 현재 원본·지원 파일과 Azrael 배포 계약을 읽기 전용 조사한다. 파일 복사·원본 수정·게시·클라우드/SSH 접속은 수행하지 않는다. Drive 경로 검증 후 대상 폴더만 확인했다. 세션 기록은 파일 구성과 개수만 확인했으며 내용이나 인증 저장소는 읽지 않았다.
- `brainstorming`: 현재 48바이트, `name`과 빈 `description`만 있는 frontmatter이며 본문이 없다. 과거 엔진 조회의 description 누락과 별개로 현재도 유효한 스킬 요건을 충족하지 않는다. description만 채워도 실제 작업 지침은 생기지 않는다. 복구할 원본을 찾거나 역할·내용을 정의해야 하며 design-collaboration과 구분이 필요하다.
- `internal-visualization`: 문서·스크립트·템플릿 등 11개 파일, 상대 Markdown 참조 누락 없음, 확인한 범위에서 Vault 고정 경로 없음. Python, Chromium 및 pdftoppm 외부 실행 환경이 필요하다. DOCENTO 예제에는 사용자 관련 문자열이 있으므로 공개 배포 전에 예제 데이터를 검토한다. 런타임/렌더 동작은 실행 검증하지 않았다. 이전 우선순위가 가장 높다.
- `ktcloud-ai-nexus`: 문서·코드 25개와 `state/` 기록 62개가 함께 있다. SKILL과 참조는 Vault를 원본으로 강제하고 resolver는 특정 Drive 계정/경로를 고정한다. portable exporter도 그 원본을 다시 참조하므로 Vault 의존 제거 수단으로는 충분하지 않다. 전체 폴더 복사는 개인 세션 이력까지 Git/릴리스에 포함할 수 있다. 일반 지침·코드, 기기별 계정 설정, 개인 세션 기록, 인증 저장소를 분리하고 기존 DPAPI/쿠키 저장 위치와 보안 경계를 유지해야 한다. 기록 검증기는 기본 위치를 스킬 폴더의 state/sessions로 계산하므로 함께 바꿔야 한다. Windows 중심 인증/도구와 제한된 Linux CLI 선택을 공통 플랫폼 지원으로 오인하지 않는다.
- `liam-mac-mini-ssh`: 문서 3개, Vault 고정 경로는 확인되지 않았다. 특정 Windows SSH 별칭·사용자·Mac 홈 경로·Tailscale 경로를 전제로 한다. 현재 사용자 전용 소스로 가져오기는 가능하지만 공용 배포에는 호스트 프로필을 외부 개인 설정으로 분리하는 설계가 필요하다. 기존 SSH 키와 known-host 설정은 이전 대상이 아니다. 접속을 실행하지 않았다.
- `obsidian-skill-manager`: 문서·메타데이터 2개. Vault 원본 유지, 누락 스킬의 Vault 검색 강제, .agents/skills 활성화 규칙이 Azrael 원본과 .azrael-ex 설치 방향에 충돌한다. 단순 복사하면 이후 작업을 다시 Vault로 보낸다. Azrael을 기본 조회·관리 대상으로 삼고 기존 skill-creator/skill-installer와 책임을 나누되 Obsidian 검색과 snippet 기능은 명시 요청형 선택 기능으로 보존할 것을 권고한다. 이름 변경 시 기존 참조와 활성화 중복도 처리해야 한다.
- 공통 통합 문제: import-instructions.py의 ACTIVE_SKILLS는 기존 5개 이름으로 고정되어 있고 구성요소 생성은 전부 default=True이다. 새 폴더만 추가하면 Unexpected skill contract 또는 영수증/매핑 검증 실패가 발생한다. SKILLS-SOURCE.json, 구성요소 매핑, 문서와 검증을 함께 갱신하고 선택 스킬을 기본 설치하지 않는 정책이 필요하다. 지침 배포는 전체 트리를 포장하므로 default=False나 개인 라이브러리 sharing=local만으로 Git/릴리스 내 개인 파일 제외가 보장되지는 않는다. 배포 입력의 명시적 허용 범위와 별도 개인 저장소 경계를 정해야 한다.
- 5개 원본 폴더에 독립 LICENSE/NOTICE 파일은 발견되지 않았다. 이것이 재배포 권한 부재를 입증하지는 않으며 공개 배포 전 작성 출처·제3자 자료 권한을 확인해야 한다. 전체 비밀정보 감사나 실제 실행 검증을 수행한 결과는 아니다.
- 권고 순서: 시각화 스킬을 먼저 이전하고, SSH 스킬은 개인 프로필 분리 후 이전한다. ktcloud는 코드와 개인 상태 분리·Vault 역참조 제거 후 이전한다. 관리 스킬은 Azrael 기본 동선과 Obsidian 선택 기능을 재설계한다. brainstorming은 내용을 복구/정의하기 전까지 비활성 자료로 보존하며 기능 스킬로 배포하지 않는다. 공개 배포 여부와 개인 상태 저장 위치는 구현 전에 사용자와 확정한다.

## 동일 내용 스킬 5개 링크 대상 변경

- 사용자 승인: 비교 결과가 동일한 `design-collaboration`, `design-documentation`, `development-workflow`, `implementation`, `project-bootstrap`의 기존 링크를 즉시 Azrael 문서로 변경한다. Windows 사용자 설치 변경에 한정하며 제품 코드·배포·나머지 5개 스킬·Vault 원본은 변경하지 않는다.
- 대상은 `C:/Users/felre/.azrael-ex/skills/<name>`에서 `C:/Users/felre/Desktop/pi-harness-init/instructions/skills/<name>`으로 연결한다. 원래 대상은 `G:/내 드라이브/ObsidianVault/PARA/00 Agents/shared-skills/<name>`이며 `project-bootstrap`만 `other-skills/<name>`이다.
- 사전 비교 결과는 본문·지원 파일 총 24개가 바이트 단위로 동일하다. 변경 직전 다시 확인하고 실제 링크임과 대상 경계를 검사한다. 링크 자체만 해제·재생성하고 실패 시 확인된 원래 대상으로 복원한다. 생성물 백업이나 임시 테스트 파일은 만들지 않는다.
- 검증은 실제 엔진의 변경 전후 대상별 스킬 로딩과 enabled 상태, 5개 링크의 실제 대상·파일 동일성이다. 경로 이동으로 포함 상태가 바뀌면 네이티브 경로별 설정으로 원래 상태를 유지한다. 기존 brainstorming 형식 오류와 전체 링크 안내는 이 변경의 해결 범위가 아니다. 실행 결과는 아래에 기록한다.
- 실행 결과: Windows에서 5개 Junction을 지정한 Azrael 프로젝트 대상으로 변경했다. 변경 직전 24개 파일 동일성과 기존 enabled=true를 확인했다. 첫 시도는 같은 엔진 연결에서 재조회 시 매칭 항목 2개가 반환되어 exit 1로 중단하고 5개 모두 기존 대상으로 복원했다. 중복의 내부 원인은 확정하지 않았다. 재시도는 변경 후 새 엔진 프로세스로 검증했고 exit 0이다. 각 Azrael `SKILL.md`가 scope=user, enabled=true로 정확히 1건씩 로드됐다. 실제 링크 대상도 모두 일치하며 설정 파일 변경은 없었다. 두 진단 프로세스 모두 종료를 관측했다. Vault 원본과 나머지 링크는 변경하지 않았다. 기존 brainstorming 오류 2건은 남아 있다. 제품 코드는 변경하지 않았으며 현재 앱의 장기 실행 연결에 대해서는 창 재로드 후 확인이 필요하다.

## 개선판 재발 오류 진단

- 요청 범위: 새 화면의 연결 설치 안내와 실제 오류를 구분하고 원인·해결안을 제시한다. 이번 진단은 제품 코드, 설치 상태, Vault 원본을 수정하지 않는다.
- Windows 설치본 `azrael-ex-local.azrael-2026.0.12`의 runtime manifest가 지정한 엔진으로 `skills/list(cwds=[현재 프로젝트], forceReload=true)`를 조회했다. 정상 스킬 56개와 동일한 `brainstorming/SKILL.md`에 대한 `missing field description` 오류 2건이 반환됐다. 오류 경로는 기존 Vault 원본이다. 동일 오류가 두 건인 이유까지는 확인하지 않았다. 진단 프로세스는 응답 후 종료했다.
- `InstructionSkillSettings.readList()`는 `errors`가 하나라도 있으면 정상 `skills`까지 폐기하고 일반 오류를 던진다. 화면의 사용 설정 오류는 이 분기와 일치한다. 정확한 파일과 사유가 화면에 전달되지 않아 사용자가 복구할 수 없다. 전환 준비도 같은 `list()`를 호출하므로 이 오류가 전환을 막을 수 있다.
- 연결 설치 10개 안내는 카탈로그가 기존 링크 폴더를 자동 탐색하지 않고 관리 복사본으로 전환하도록 알리는 별도 상태이다. 10개가 전부 손상됐다는 의미가 아니다. 엔진은 링크를 따라 스킬을 읽으며 카탈로그와 발견 정책이 다르다.
- 설치본 카탈로그의 읽기 전용 실행은 exit 0으로 105개(스킬 102, 역할 2, 지침 1)와 연결 설치 전환 안내 1건(count 10)을 반환했다. 공식 원본 캐시 부재와 전체 카탈로그 실패는 구분한다. 설치본 `instruction-catalog.cjs`, `instruction-migration.cjs`는 현재 소스와 바이트가 동일하다.
- 화면의 공식 원본은 검증된 릴리스이다. 현재 사용자 상태에 `azrael/instructions/state.json`과 `versions/`가 모두 없다. 따라서 이 선택에서 공식 원본을 제공할 캐시가 없다. 아래의 일반 프로젝트 선택은 공식 소스 선택과 별개다. 스크린샷은 목록 아래까지 보이지 않으므로 전체 목록이 비었다고 단정하지 않는다.
- 권고: 네이티브 응답을 정상 스킬과 경로별 오류로 분리하고 오류를 중복 제거해 표시한다. 정상 스킬은 표시·조회하되 변경 대상에 오류나 불확실성이 있으면 그 작업만 차단하고, 쓰기 후 해당 경로의 유효 상태를 재확인한다. 전체 상태 검증을 단순 제거하는 수정은 피한다.
- 권고: 공식 원본 미설정/캐시 없음 상태를 명시하고 개발 프로젝트 선택 또는 검증 릴리스 가져오기 동작을 바로 제공한다. 자동 네트워크 연결이나 프로젝트 원본 자동 전환은 하지 않는다. 연결 설치 안내는 링크 의미·미전환 목록·다음 동작을 제공하고 공식 항목과 매칭되지 않는 이전 설치도 누락 없이 보여준다.
- 원본 데이터 수정 대안: Vault의 오류 파일에 유효한 description을 추가하면 해당 파싱 오류는 해소될 수 있지만 이번 요청으로 원본을 수정하지 않는다. Vault 의존 제거 목적에는 Azrael 프로젝트 원본을 명시 선택하고 검토형 전환에서 기존 내용 차이를 보존하는 방식을 우선 권한다. 오류 스킬의 상태가 불명확하면 상태 보존 방식을 검토 없이 임의 결정하지 않는다.
- 후속 수정 검증: 정상+불량 혼합 응답, 동일 오류 중복, 오류 대상 변경 차단과 정상 대상 변경, 캐시 없는 최초 실행, 프로젝트 원본 명시 선택, 전환 전후 기존 포함 상태와 개인 수정 보존을 Windows에서 확인한다. 공통 코드 수정이며 Linux/macOS 실행은 별도 검증 범위다. 기존 소스 테스트 통과는 실제 사용자 설치 상태의 수용 검증을 대체하지 않는다.

## 승인된 개편과 실행 기록

### 실행 범위와 검증 소유

- 구현 권한: 사용자가 합의된 계획의 구현을 요청했다. 원본/개인 사본/설치/게시 연결, 스킬 제외, 삭제와 전환 절차를 구현하고 관련 검증을 수행한다. 실제 개인 데이터 삭제·Vault 원본 변경·배포·설치·GitHub 게시는 이번 실행에 포함하지 않는다.
- 병렬 소유: root는 프로토콜·호스트 통합·최종 검증을 소유한다. `library_lifecycle`은 라이브러리 삭제/출처, `catalog_sources`는 원본 발견 및 후속 호스트 회귀, `instruction_ui`는 화면과 렌더 검증, `native_skill_settings`는 기존 네이티브 설정 어댑터, `instruction_migration`은 검토형 링크 설치 전환을 담당한다. 자식은 위임하지 않는다. 산출 API가 고정된 뒤 root가 연결한다.
- 검증 생성물: 각 JS producer는 `artifacts/tasks/DK-01-instruction-catalog-diagnosis/runs/<unique>/`를 사전 등록했다. 공용 `catalog.lock`의 소유가 확인되지 않아 해당 레지스트리의 재실행/종료 조정은 보류한다. 잠금은 삭제하거나 우회해 그 레지스트리를 수정하지 않는다.
- 독립 검증 경로: 내장 `project_tests`가 자체 기록으로 소유하는 직접 실행 묶음을 사용한다. 원래 테스트 타깃과 검사를 유지하고, 공용 JS 레지스트리에 쓰는 wrapper 대신 내장 실행 경계가 로그·입력·종료를 기록한다. 별도 fixture 생성 경계 `artifacts/tasks/DK-01-instruction-catalog-diagnosis/native-backend/`를 생성 전에 이 기록에 선언하고 native inventory에 등록한다. 기존 레지스트리/잠금의 복구와 새 검증의 성공은 구분한다.
- 테스트는 Windows 실제 실행을 기본으로 공통 코드/지원 플랫폼 의미를 보존한다. 제품 전체 빌드/패키지 설치는 명시 요청 없으므로 수행하지 않는다. UI는 기존 독립 렌더러의 실제 light/dark 상호작용을 검증하며 호스트/API 실제 계정 검증과 구분한다.

다음 논의 항목과 최초 분석은 당시 상태를 보존한 기록이다. 후속 구현 승인이 조사 전용 권한과 미결정 표시를 대체한다. 최종 결정은 개인 파생본의 최초 스킬 포함 기본 꺼짐, 삭제 기본은 개인 작업본만 제거, 설치본 제거는 별도 선택이다. 포함 변경은 새 대화에 적용하며 필수 프로필 의존성을 조용히 재활성화하지 않는다.

- 후속 요청: 프로젝트/GitHub 원본 및 Vault 의존 제거, 공식·개인 스킬 병존, 스킬 포함 여부 제어, 개인 항목 삭제. 사용자가 계획 구현을 승인했으며 위 실행 범위에 따라 구현·관련 검증·정리를 수행한다.
- 완료 기준: 승인된 설계를 구현하고 관련 회귀·렌더 검증과 정리를 마친다. 실제 사용자 데이터 변경·설치·배포·게시는 별도 범위다.
- 합의: Azrael과 지침 문서 개발 환경은 프로젝트에 저장된 지침 문서를 원본으로 사용한다. 배포 사용자는 GitHub의 지침 문서를 원본으로 사용한다. 관리 시스템의 Vault 의존을 제거한다. 조회·복사·설치·개인 버전 게시를 지원하며 게시에는 해당 GitHub 저장소의 실제 쓰기 권한이 필요하다.
- 보존: 원본 소유권, 시스템/플러그인 관리 주체, 전체 지원 파일, 설치·게시·활성화의 독립성, 고정 버전, 설치 충돌 검사, 로컬 전용 배포 제외, 복구 절차.
- 제안 구조: 출처 연결 → 읽기 전용 카탈로그 → 내용이 고정된 스냅샷 → 설치/게시/작업 활성화. 화면은 통합해서 제공하되 각 단계의 권한·상태를 구분한다.
- 출처: 개발자 프로젝트 원본, 사용자 GitHub 원본, 개인 작업 사본, 설치본을 구분한다. 원본 편집 권한과 설치/게시 권한을 별도로 유지한다. 설치본이나 캐시를 원본으로 자동 승격하지 않는다.
- 카탈로그: 출처 가독성과 설치·게시·활성화 상태를 분리한다. 한 출처의 오류는 해당 항목과 요약 영역에 표시하고 정상 목록을 사용할 수 있게 한다. 정보성 알림과 실행을 막는 충돌/복구 오류를 같은 접기 정책으로 처리하지 않는다.
- 스냅샷: 설치/공유 시점에 선택한 전체 파일과 digest를 고정하고 기존 버전 저장소·검증·잠금·복구를 재사용한다. 외부 원본 변경이 실행 중 작업이나 승인된 설치 계획을 조용히 바꾸지 않게 한다.
- 합의된 추가 원칙: 배포 사용자의 기본 취득 단위는 검증된 호환 정식 릴리스/고정 버전으로 하고 GitHub의 이동하는 브랜치와 설치 버전을 구분한다. 공식 원본과 개인 게시 목적지를 별도로 선택한다. 개인 파생본에는 원본 출처·ID·버전·내용 식별값을 남기고 독립 ID를 부여한다. 원본 업데이트는 비교 후 명시적으로 반영하며 개인 수정본을 자동 덮어쓰지 않는다. 개발자 원본 모드와 프로젝트 경로는 명시적으로 선택한다. 기존 Vault 연결 대상과 프로젝트 원본의 차이·지원 파일을 확인하고 개인 수정분을 보존한 뒤 전환한다.
- 제안 순서: 프로젝트 원본과 현 설치본/연결 대상의 차이 조사 → 원본 선택·개인 작업 사본·게시 목적지 계약 확정 → Vault 의존 없는 설치 전환과 오류 표시 정비 → 해당 플랫폼과 배포 호스트 검증. 아직 실행 계획으로 승인된 단계가 아니다.
- 플랫폼: 의미와 데이터 계약은 Windows/Linux/macOS 공통으로 제안하되 Windows 정션과 Unix 심볼릭 링크의 구현·검증은 구분한다. 원격 출처 지원 확장은 별도 범위다.
- 합의된 병존/선택: 공식·개인 버전을 함께 보존한다. 지침 설정에서 각 스킬을 모델의 사용 가능한 스킬 목록에 넣을지 설정한다. 제외해도 관리 목록과 파일·버전은 보존한다. 기존 한 설치 이름/한 소유자 계약과 별도 설치 이름을 유지한다. 전역 `AGENTS.md` 등 단일 목적지 지침에는 스킬 병존 방식을 일괄 적용하지 않는다.
- 합의된 삭제 기능: 직접 만든 개인 항목 및 개인 파생본에 삭제 동작을 제공한다. 개인 작업본, 설치본, GitHub 원본/게시 이력의 소유권과 영향을 구분한다. 사용자 요청은 기능 설계이며 현 데이터 삭제 권한이 아니다.
- 미결정/권고: 삭제 확인에서 `개인 작업본 삭제`를 기본으로 하고 `설치본도 제거`를 명시적으로 선택하도록 권한다. 설치본 유지 시 출처와 설치 영수증은 독립적으로 보존해 고아 상태를 만들지 않는다. 프로필·실행 중 작업·복구가 참조하는 버전은 필요 범위만 보존하거나 참조 해소까지 차단하는 설계가 필요하다. GitHub 게시물 제거는 별도 권한·검토를 가진 동작으로 유지한다. 삭제 복구 방식/보존 기간은 아직 정하지 않았다.
- 미결정/권고: 포함 설정은 사용자 로컬 범위에서 새 대화에 적용하고 현재 대화의 이미 로드된 지침을 제거했다고 표시하지 않는 방식을 권한다. 작업 프로필이 제외된 스킬을 필수로 요구하면 조용히 다시 활성화하지 않고 충돌과 필요한 선택을 안내한다. 설치된 새 파생본의 최초 활성 상태도 구현 전에 확정해야 한다.
- 합의된 원본·기능·권한·추가 원칙은 `docs/architecture/instructions.md#canonical-sources-and-personal-versions`에 target으로 반영했다. 합의는 구현·게시·설치 실행 권한을 추가하지 않는다.

### 추가 코드 근거와 한계

- 운영 문서가 기본 엔진 소스로 지정한 `engine/`의 `codex-rs/ext/skills/src/loader/host.rs:164`는 사용자·저장소·관리자 범위에서 디렉터리 링크를 Follow하고 시스템 범위에서는 Ignore한다. 관리 카탈로그의 일괄 거부와 정책이 다르다. 실행 중 설치 엔진을 새로 검증한 것은 아니다. 네이티브 탐색 공유가 배포용 전체 지원 파일 검증을 대체할 수는 없다.
- `instructionLibraryService.ts:299`의 로컬 카탈로그 가져오기는 `library.create()`로 파일 사본을 만든다. 현재 '내 라이브러리에 추가'는 외부 원본과의 지속 동기화 등록을 뜻하지 않는다.
- `instruction-library.cjs:272`의 수동 폴더 가져오기 역시 `safe()`와 내부 링크 검사로 차단한다. 자동 발견만 고치고 가져오기 경로를 조사하지 않으면 일관성 문제가 남을 수 있다. 수동 동작의 실제 UI 실행 검증은 수행하지 않았다.
- 카탈로그 ID는 현재 `sourceKind`, 경로, 종류에서 만들어진다. 출처 연결과 사본/버전/설치 관계를 표현하려면 이 정체성 계약을 검토해야 한다. 같은 이름이나 실경로만으로 독립 리소스를 자동 병합해서는 안 된다.
- 현재 탐색은 목록 구성 중 전체 지원 파일을 읽어 inventory와 digest를 생성한다. 규모가 커질 때 목록 메타데이터와 선택 시점 검증을 분리할 여지가 있다. 실제 성능 장애나 개선량은 측정하지 않았다.
- `instructions/README.md`는 이미 프로젝트의 `instructions/`를 유지관리 소유자로 정하고 개인 Vault 파일이 배포에 필요하지 않다고 명시한다. 이번 방향은 이 계약과 정렬되며, 실제 설치의 Vault 정션은 별도 이관 대상이다.
- 현재 `InstructionLibraryService.connections()`는 sharing별 연결의 유일성을 검사해 공개/협업자 저장소를 각각 하나씩만 허용한다. 공식 조회 출처를 유지하면서 별도 개인 저장소에 게시하려면 출처와 게시 목적지 모델을 검토해야 한다.
- 게시 호스트의 `connection(..., write)`는 쓰기 capability를 검사하고 publisher도 게시/재개 시점에 다시 검사한다. 권한 검사는 재사용 후보이며 실계정 GitHub 검증은 수행하지 않았다.
- `app-server-protocol/src/protocol/v2/plugin.rs`의 `SkillsConfigWriteParams`와 `app-server/src/request_processors/catalog_processor.rs`는 `skills/config/write`에 path/name 중 하나와 enabled를 받고 설정 저장 후 스킬/플러그인 캐시를 비운다. `config/src/skills_config.rs`의 이름 선택은 같은 이름의 여러 경로에 영향을 줄 수 있어 개별 설치 제어에는 경로 선택과 안정적인 리소스 연결이 적합하다. 현재 실행 중 앱의 실효 동작은 미검증이다.
- `InstructionAction`, `InstructionLibraryService` 및 `InstructionLibrary`의 현재 경로에는 사용자용 삭제 동작이 없다. `_closure`는 프로필 의존성을 따라가므로 삭제/활성화 변경 시 의존 리소스와 고정 버전 소비자 검사가 필요하다.
- 후속 검토는 코드와 기존 계약을 읽은 범위다. 제품 테스트·빌드·설치·네트워크 작업은 실행하지 않았다.

## 요청과 범위

- 요청: 설정 화면의 `Linked skill source skipped` 원인과 영향 분석.
- 허용: 코드·설치 메타데이터 읽기, 제한된 읽기 전용 재현, 조사 기록 작성. 제품 코드 수정·빌드·설치·배포 제외.
- 플랫폼: 카탈로그와 표시 로직은 공통 코드. 검증은 Windows 로컬 환경 및 정션에 한정하며 Linux/macOS를 검증하지 않았다.
- root가 탐색 → 실제 경로 분류 → 설치본 일치 → 재현 → 표시 영향 확인을 수행했다. 위임 및 별도 빌드 없음.

## 확인 결과

1. `scripts/instruction-catalog.cjs:125`는 `Dirent.isDirectory()`가 false이며 `isSymbolicLink()`가 true인 스킬을 `Linked skill source skipped`와 함께 제외한다.
2. 실제 `C:/Users/felre/.azrael-ex/skills`의 링크 항목은 10개다. Node에서 전부 `directory:false,symbolicLink:true`로 분류됐다. `design-collaboration`은 외부 Obsidian Vault의 shared-skills 폴더를 가리키는 Windows Junction이다. `development-workflow/SKILL.md`는 이번 조사에서 실제 읽기에 성공했다. 모든 링크 대상의 무결성까지 조사한 것은 아니다.
3. 같은 카탈로그를 실제 installedRoot에 대해 읽기 전용 실행했다. 종료 코드 0, 약 1.1초. 11개 리소스(스킬 8, 에이전트 역할 2, 전역 지침 1)를 반환하고, 화면과 같은 경로 및 문구의 경고 10개를 반환했다. baselineRoot 및 pluginRoots는 이 제한 재현에 포함하지 않았다.
4. 설치된 `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.11/account-ui/instruction-catalog.cjs`는 현재 소스와 바이트 단위 동일하다. SHA-256: `e31672a2e8e5b1b51b09426a678473d72ba5334159bcc8cabfca1d7085aeae73`. 실행 중인 VS Code 프로세스의 활성 확장 버전까지 식별한 것은 아니다.
5. `extensions/azrael-ex/src/instructionLibraryService.ts:139`는 이 정책적 제외를 일반적인 `출처를 확인할 수 없습니다` 메시지로 변환한다. 실제 연결 확인 실패와 링크 정책 거부를 구분하지 않는다.
6. `extensions/azrael-ex/src/instructionView.ts`는 모든 notice를 프로젝트 선택과 목록 앞에 펼쳐 렌더링한다. 따라서 10개 경고가 먼저 화면을 채운다. 소스 구조 확인이며 이번 조사에서 브라우저 렌더링을 새로 실행하지 않았다.

## 원인과 영향

- 직접 원인: 개인 스킬의 정션 설치 구조와, 링크를 거부하는 지침 카탈로그의 탐색 정책이 충돌한다.
- 방어 의도: `safe()`는 경로 구성요소의 링크를 거부하며, 패키지 내부 링크도 거부한다. 단순히 125행의 분기만 제거하면 이후 `safe()`에서 다시 차단된다. 기존 테스트에는 패키지 내부 링크의 대상 파일을 읽지 않고 거부하는 사례가 있다.
- 영향: 해당 로컬 설치본 리소스가 카탈로그에 들어오지 않아 그 항목의 열람 및 내 라이브러리 추가 흐름에 사용할 수 없다. 다른 소스에 같은 스킬이 따로 존재할 가능성은 배제하지 않는다. 일반 폴더 리소스는 제한 재현에서 정상 반환됐다.
- 이 결과만으로 GitHub 다운로드, 수동 폴더 가져오기 또는 엔진의 스킬 사용 자체가 모두 실패했다고 판단할 수 없다. 모든 대상 파일이 없거나 Drive 연결이 끊겼다는 증거도 아니다.

## 수정 권고와 보존 조건

- 프로젝트/GitHub 원본 구조에 맞춰 기존 설치 연결을 이관하는 방향을 설계한다. Vault 최상위 링크의 상시 허용을 주 해결책으로 삼지 않는다. 파일 차이를 확인하고 프로젝트에 없는 개인 수정분과 지원 파일을 보존하며, 대상별 설치 영수증과 소유권을 검토한다. 이관은 아직 실행하지 않았다.
- 경고는 원인을 구분해 안내하고 요약·접기 방식으로 목록 접근을 보존한다. 경고 숨김만으로 제외 문제가 해결되지는 않는다.
- 향후 수정 검증: Vault 없는 개발/사용자 환경, 기존 정션 설치의 이관, 개인 수정·지원 파일 보존, 출처별 버전 정체성, 패키지 내부 링크 거부, 읽기/쓰기 권한 분리, 경고 다수 화면과 정상 목록 접근. Windows 회귀와 다른 OS 범위는 구현 계획에서 구분한다.
- 합의된 방향은 아키텍처에 target으로 반영했다. 제품 코드·기능 인벤토리·설치본은 변경하지 않았다. 권고 세부안은 미구현 제안이다.

## 검증 한계와 작업 상태

- 읽기 전용 경로 분류, 실제 카탈로그 재현, 설치본 해시 비교는 각각 종료 코드 0이었다. 설치·네트워크 가져오기·활성 VS Code 호스트 조작은 수행하지 않았다.
- 초기 `node -e` 호출은 PowerShell의 인용 처리로 구문 오류가 났고, 표준입력으로 전달한 재실행에서 성공했다.
- 최초 계획 할당은 PATH에 Python이 없어 실행되지 않았다. 등록된 Python의 절대 경로를 사용해 할당했다.
- 제품 코드나 기존 사용자 변경은 수정하지 않았다. 조사 기록만 추가했으며 임시 본문 파일은 보통 삭제로 제거했다.

### 실행 결과와 남은 수락

- Windows 라이브러리 최종 단독 회귀: 26/26 통과, exit 0, 약 114초. `runs/backend-delete-8462e8b4-0345-41d6-8aae-a9594fb72846/logs/library.log`.
- UI 단위 검사 8/8 및 light/dark 1100/420 렌더 상호작용 131개 통과, exit 0. 최종 증거 `runs/20261022T185038635Z-9386fadc-65bd-4861-8fa0-1242970ca135/`. 브라우저 종료와 임시 fixture 제거 확인.
- 초기 native 직접 실행은 10초 제한으로 exit 124. 성공으로 간주하지 않는다. 첫 호스트 실행은 74 통과/3 실패/2 생략: 기존 테스트 엔진 경로 누락, native/standalone 직렬화 불일치, 네이티브 설정 대역 누락. 원인을 보완하고 backend/host 새 실행을 시작했다.
- 설치된 앱, 실계정 GitHub 게시, Linux/macOS 실행은 검증하지 않는다. 실제 Vault 링크와 외부 원본은 변경하지 않는다.
- 최종 backend 자식 실행은 76 통과/0 실패/1 생략, exit 0. wrapper는 공용 catalog 잠금 충돌로 종료 기록 마무리에 실패했으므로 wrapper 성공으로 보고하지 않는다. 이후 변경된 rollback 복구는 별도 migration 실행에서 10/10, exit 0을 확인했다.
- 신규 회귀 검사는 새 제품 계약(삭제 소유권/영수증, 출처 정체성, 네이티브 포함 설정, 링크 전환 복구)을 지속 보호하므로 유지한다. 일회성 산출물은 lifecycle 검토 후 삭제 또는 구체적인 재검토 조건으로 보존한다.
- 최종 호스트 `host-0cabdc6d`: 79 통과/0 실패/1 생략, exit 0, 약 172초. Windows 실제 정션과 네이티브 경로 별칭의 제외 상태 유지, 보존한 원문/지원 파일, 삭제 후 설치 영수증·출처를 포함한다. 생성된 최신 릴리스 자산 검사는 해당 산출물이 없어 생략했으며, 기존 엔진으로 격리된 strict-config 검사는 통과했다.
- TypeScript noEmit exit 0 (`types-27c20dfc`), 최종 migration 10/10 exit 0 (`migration-d6e294f8`). 이전 호스트의 테스트가 네이티브 목록 조회용 프로세스를 닫지 않아 정확한 부모·자식 PID/명령을 확인하고 그 테스트 프로세스만 종료했다. 목록 어댑터를 대역으로 분리한 최종 재실행은 정상 종료했다.
- 산출물 정리는 native inventory의 최초 그룹 측정이 소요 시간을 지배한다. 동일 경로의 별도 재귀 스캔·해싱이나 강제 삭제는 수행하지 않는다. 임시 Git 제어 파일 `.git/index-DK-01-instructions`와 `.git/index-DK-01-instructions.patch`는 이번 변경만 선택한 인덱스이며 커밋 후 보통 삭제한다.
- 등록 중 `migration-d6e294f8`의 테스트 정션이 native 경로 검사에 거부되었다. 이 guard를 우회하지 않고 해당 그룹과 정션 fixture를 포함한 `backend-06e4d646`, `run:DK-01:native-backend-fixtures`는 보존한다. 재검토 조건: 생성자 소유의 fixture 링크 해제 절차와 영수증을 마련한 뒤 전체 재등록·새 검토를 수행한다. 실제 Vault 링크와 무관한 격리된 테스트 경로다.
- 전환 보존본의 provenance는 공식 원본 digest를 유지하고, 보존한 개인 수정 내용은 별도의 패키지 digest로 식별하도록 최종 보완했다. 이 변경 뒤 noEmit은 exit 0이며, `migration-host` 좁은 재검증으로 보존본 출처를 다시 확인한다.
- 최종 보완 검증 `migration-host-77f713da`: 3/3 통과, 자식 exit 0, 약 77초. wrapper는 catalog 잠금 때문에 종료 기록에 실패해 exit 1이므로 두 결과를 구분한다. 현재 소스에 대한 noEmit 직접 실행은 exit 0이다.
- 정리 최종 결정은 모든 DK-01 실행 자료 보존(defer)이다. native에 등록된 9개 그룹의 fresh review는 모두 `producer catalog writer is active`로 membership 검증을 차단했다. 이 토큰으로 defer-only apply를 시도했으나 `exclusive maintenance lock unavailable`로 거부되었다. native 결정 적용·삭제 성공으로 보고하지 않는다. 잠금을 지우거나 우회하지 않았으며 원인은 미확인이다. v1은 해당 잠금 자체의 복구 API를 제공하지 않는다.
- 보존 대상은 이 작업의 `runs/` 아래 생성된 18개 고유 실행 그룹과 `run:DK-01:native-backend-fixtures`다. 재검토 조건: 실제 catalog/maintenance writer의 종료·소유를 검증하고 지원되는 절차로 잠금 상태가 해소된 뒤, 변경 없는 producer 메타데이터는 refresh, 바뀐 payload는 전체 재등록하여 fresh review를 받는다. 최종 host/render/backend/추가 migration 증거를 유지하고 중복 중간 실행은 그때 삭제한다. 정션 fixture 그룹은 앞서 적은 생성자 링크 해제 근거도 필요하다.
- 기능 소스·문서·지속 회귀 검사를 하나의 작업 커밋으로 분리한다. 실제 설치 수락 및 보류한 산출물 정리는 이 소스 검증 완료와 구분하며, 전체 운영 수락 완료를 주장하지 않는다.

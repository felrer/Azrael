상태: 빌드 전체 간소화 코드·Windows 관련 회귀·임시 검증 자료 정리 완료, 기존 미커밋 변경과의 커밋 분리 미완료. 이전 2026.0.17 빌드는 컴파일·독립 IPC만 통과했고 최종 패키지·설치는 미완료다.

# 지침 패키지 개발 탭과 Azrael 통합 계획

## 빌드 전체 간소화

- 구현: Windows와 portable 생산자는 같은 작업의 단계 상태와 명시적 resume를 사용한다. source-preflight는 유효한 단일 concurrency 옵션을 정규화하고 unfiltered 다중 파일 성공을 선택된 부분집합에 재사용한다. 해당 기존 회귀 29개가 Windows에서 통과했다(exit 0).
- 완료된 검증 정리: `run:FA-01-build-simplification:dedup-1793765367079`의 4,342바이트 로그/보고서는 결과 인계 후 검증된 standalone maintenance owner의 register→review→apply를 거쳐 삭제했다(exit 0, remaining false). 관련 회귀 명령은 `node --test --test-concurrency=1 scripts/test-feature-preservation.cjs`, 29 passed / 0 skipped, 약 38.5초다.
- 통합 확인: Windows portable packaging/install 회귀 33개 및 build-platform 13 passed / Unix 1 skipped가 exit 0. Windows 실제 deploy 진입점을 사용하는 `full install`, `resume after prepare failure` 모의 회귀도 exit 0이며 prepare exit 29 이후 source/preflight/build 재실행 없이 준비·설치 단계로 이어졌다. 실제 user-profile 설치나 전체 native 빌드를 수행한 결과는 아니다. source/tool 변동, output 훼손, live/unknown 보호와 동기 실패의 null exit 보존을 확인했다.
- 상태 테스트 연결: `check-artifact-lifecycle.cjs --stage pipeline`이 기존 등록 run 안에서 공통 helper 회귀를 실행하며 첫 통합 실행 exit 0 (`run:lifecycle-check:4c7a7572-9b5e-4792-800d-3e7e7e69e521`). feature manifest 92개 검증도 exit 0. 최종 atomic 임시파일 소유 범위 보완 후 helper 검사를 다시 실행해 exit 0을 확인했다.
- 시간 해석: 소스 검사와 engine/IPC의 자원 경합을 피하는 순서는 재실패 비용을 줄이기 위한 선택이다. cold build에서 compile/source 중첩이 줄어드는 비용이 있으며 전체 wall-time 개선은 아직 실측하지 않았다. 필수 검사 범위와 full-regression 의미는 유지한다.
- 커밋 분리: worker가 작업 전 내용을 기준으로 6개 portable task-only patch를 만들었고 현재 작업 트리 역적용 검사는 통과했다. 다만 index/HEAD에 대한 적용 검사는 기존 미커밋 선행 변경과 겹치는 `build-platform.cjs:99`에서 실패했다. 기존 변경을 함께 임의 커밋하지 않았으며 소스/작업별 패치의 분리 검토가 남아 있다.
- 정리 경로 수정: 기존 `test-deploy-azrael.ps1`의 `artifacts/t-<4자리>`는 configured managed roots 밖이어서 native review가 차단했다. 앞으로 기존 관리 루트인 `artifacts/dt/<4자리>`를 사용한다. 이번 9개 legacy 짧은 경로는 정확한 임시 관리 선언과 지원되는 `retire_managed_roots`의 fresh review/apply로 삭제하고 임시 선언을 제거했다. `check-artifact-lifecycle.cjs`도 직접 만든 run member의 generated/protection-known 정보를 선언하도록 보완했다.
- 포터블 검증 묶음 정리: `run:FA-01-build-simplification:20261104T041555928Z-1984db91-5e48-4254-b0d2-340991500d39`의 논리 크기 477,529,025바이트는 native apply exit 0, remaining false와 lifecycle finalize로 정리됐다. Windows failed/success 9개 묶음도 실패 결과를 유지한 채 producer 종료와 완결 membership을 확인하고 정리했다.
- 최종 정리: Windows 9개, portable 1개, 공통 helper 1개, dedup 1개의 총 12개 검증 묶음을 native apply의 실제 `deleted / remaining=false`와 owner finalize로 확인했다. 논리 크기 합계 509,418,443바이트이며 물리 회수량으로 해석하지 않는다. 이번에 추가했던 9개 임시 managed-root 선언은 제거했다. 관리 경계 폐기에 필요한 최소 독립 근거 5,725바이트는 `artifacts/maintenance/evidence/FA-01-build-simplification-root-retirement.json`에 유지한다.
- 확인된 정리 비용: Windows 8개 묶음과 helper의 17개 경로를 삭제하는 native apply가 10분을 넘겼고, 중간 진단에서 해당 실행기의 누적 CPU 658.86초와 14개 경로 부재를 관측했다. 이후 전 항목이 정상 삭제됐지만 이 비용의 내부 원인을 프로파일링하거나 실행기를 최적화하지는 않았다. 전체 빌드 시간 개선으로 계산하지 않는다.
- 최종 검증 범위: Windows 배포 모의 사례 2개, resource admission 3개, source-preflight 29개, portable packaging/install 33개, build-platform 13개 통과(Unix 1개 제외), helper의 고정 임시파일 보존·동시 기록·실패 재개 검사 통과. 각 실제 명령 exit 0. 마지막 정리 경로/소유 정보 수정은 PowerShell parser와 Node syntax 검사를 통과했다. 실제 제품 빌드/설치, native Linux/macOS 및 전체 wall-time 실측은 수행하지 않았다.
- 환경 재사용의 확인된 한계: 현재 source 검사에 전체 inherited 환경이 전달되므로 hash에서 임의로 변수를 빼면 소비 입력을 놓친다. 이번에는 실제 환경을 보수적으로 바인딩하고 안정적인 작업 경로를 사용한다. 완전한 명시적 실행 환경 계약 없이 전체 환경 hash 제거를 완료했다고 주장하지 않는다.
- 실패 재개 경계: 실제 terminal 실패는 재시도하지만 running/unknown producer나 standalone 설치의 crash 잔여 lease는 자동 해제하지 않는다. 기존 실패 run에 새 단계 상태가 소급 생성되지는 않는다. 이전 빌드 산출물은 기존 provenance 경로로 재사용한다.

- 목표: 전체 파이프라인에서 성공한 작업을 다시 하지 않으며, 형식적 영수증·환경 경로 변경 때문에 전체 재시작하지 않는다. 기존 승인된 빌드 재개의 선행 개선으로 수행한다.
- 범위/권한: 실제 실행 코드와 프로젝트 문서 수정, 관련한 최소 검증과 정리. 원격 배포·게시, 제품 기능 축소, 사용자 데이터 변경은 추가하지 않는다. 개발 빌드만의 예외가 아니라 패키징·설치 경로에도 동일 원칙을 적용한다.
- 공통 의미: 하나의 작업 상태가 명령·실제 종료값·사용 입력·출력을 보관한다. 동일 입력의 성공 단계는 재사용하며 실패/미확정 단계와 그 의존 단계만 실행한다. 별도 handoff 영수증 조립을 사용자의 재개 조건으로 요구하지 않는다.
- 최소 조건: 실제 성공과 출력 존재/필요한 내용 신원, 의미 있는 입력·도구·설정 일치, 실행 중인 producer 보호, 설치 직전 실제 패키지와 플랫폼 확인은 유지한다. 전체 환경변수·실행별 임시 경로·로그 위치를 일률적인 무효화 조건으로 삼지 않는다.
- 정리: producer가 종료되고 현재 사용이 끝난 임시 자료는 기존 소유자 절차로 정리한다. 정리 기록의 미완료만으로 무관한 후속 실행을 막지 않는다. 사용 중인 경로/잠금/불확실한 이전 실행의 출력에 새 writer를 겹치거나 강제 삭제하지 않는다. 작업 완료에는 정리 또는 기존 절차의 명시적 보관 결정이 여전히 필요하다.
- 플랫폼: 공통 정책은 Windows x64/Linux x64/macOS ARM64 대상. PowerShell Windows 배포와 Node 다중 플랫폼 빌드의 구현 소유자는 분리한다. 현재 실제 검증 환경은 Windows x64이며 Unix native·설치 검증 범위는 별도 기록한다.
- 재사용 대상: 기존 deployment metrics/checkpoint, source-preflight reuse, module/Cargo/namespace cache, artifact-run와 관리 owner를 우선 확장한다. 동일 목적의 새 영수증 체계를 추가하지 않는다.
- 구현 순서: 기존 실행/재개 경계 및 환경 identity 조사 → 성공 단계 재개·환경 identity·중복 검사 개선 → 최종 package/install/cleanup 연결 → 좁은 실패·재개 검증 → 원 빌드 재개에 적용. UI·컴파일 최적화 설정 변경은 이번 절차 단순화의 필수 조건이 아니므로 별도로 확장하지 않는다.
- 검증: 동일 입력 재개에서 성공 명령이 재실행되지 않고 실패 명령만 다시 실행됨, 입력/출력 변경의 영향 단계만 무효화됨, 실제 실패/미확정 결과가 성공이 되지 않음, 활성 producer/파일 보호, 최종 패키지 확인, 필터와 실제 테스트 선택 보존. 전체 회귀를 이 변경의 첫 검증으로 반복하지 않는다.
- 역할: root는 공통 계약·Windows 통합·문서·최종 수용을 소유한다. read-only resume_paths는 Windows/다중 플랫폼 단계 경계, identity_scope는 환경 identity/중복 검사 경계를 조사한다. 각 결과가 준비되면 독립 구현만 배정한다. 기존 변경은 보존한다.

## 목표와 범위

Azrael 전체 빌드 없이 로컬 브라우저 탭에서 패키지 관리 화면과 실제 저장·조회 기능을 먼저 완성한다. UI와 도메인 로직은 Azrael 통합 시 그대로 사용한다. 개발 탭 완성과 설치본에서의 엔진 적용 완료를 구분한다.

- 사용자 요청: 이미지·제목·설명 카드, 단일/복합 패키지, GitHub·로컬 통합 목록, 출처·다운로드 상태 아이콘, 구성요소 상세, 새 패키지 제작, 프로필 생성과 슬롯 드래그 적용.
- 패키지 목록·다운로드 자료는 공통 라이브러리에서 관리하고, 장착 대상은 패키지가 아닌 프로필이다. 여러 프로필을 보관하되 프로젝트마다 활성 프로필 하나를 독립적으로 관리한다. 진행 중인 실행은 유지하고 해당 프로젝트의 다음 요청부터 적용한다.
- 제외: 여러 다운로드 패키지를 실행 시 합치는 기능, 실제 Azrael 마켓 서비스·검색·결제·게시, 이번 계획 단계의 앱 빌드·설치·배포.
- 기존 라이브러리 조회·관리 기능은 페이지 하단으로 옮겨 보존한다. 공식 소스의 모드/소스 프로젝트 선택은 제거한다. 장착 대상 프로젝트는 Azrael의 현재 프로젝트 문맥과 연결하고 화면에 표시하며, 예전의 플레이북 배포 대상 프로젝트 선택 UI를 복원하지 않는다.
- 이 계획은 기존의 새 대화 전용 프로필 및 프로젝트 플레이북 계약을 변경하는 제안이다. 승인 전에는 기존 아키텍처를 구현된 것으로 고치지 않는다.

## 확정된 결정

| 결정 | 확정 내용 | 영향 |
| --- | --- | --- |
| 슬롯의 의미（확정） | 여러 프로필을 보관하고 프로젝트마다 활성 프로필 하나를 선택한다. 슬롯에 장착하거나 다른 프로필로 전환하면 현재 프로젝트의 선택만 변경한다. 복수 프로필을 합성하지 않는다. | 프로젝트 A/B가 각각 다른 프로필을 유지한다. 공통 패키지 보관 상태와 프로젝트별 장착 상태를 분리한다. 초기 슬롯 수·추가 방식은 화면에서 확정한다. |
| 프로젝트 없는 대화 | 프로필을 자동 장착하지 않고 Azrael 기본 설정을 사용한다. | 다른 프로젝트의 활성 선택을 대신 적용하지 않는다. |
| 다음 요청의 경계 | 변경 저장 후 해당 프로젝트에서 새로 전송되는 사용자 요청부터 기존/새 대화에 적용한다. 이미 실행·접수된 요청과 그 내부 모델 호출·하위 에이전트는 당시 스냅샷을 끝까지 쓴다. 대기열에 들어간 요청도 접수 당시 프로필을 유지한다. | 실행 중 중간 변경을 피한다. 다른 프로젝트의 활성 상태와 요청은 영향을 받지 않는다. |
| 프로필 생성 직후 | `저장하고 장착`을 기본 완료 동작으로 하고 `초안 저장`도 제공한다. 패키지의 프로필을 가져오거나 새 프로필을 만들어 현재 프로젝트에 장착한다. 프로필이 없는 패키지는 직접 장착하지 않고 프로필 제작에 사용한다. | 작성 중인 불완전 프로필의 자동 활성화를 막으며, 패키지의 저장·다운로드와 프로필 활성화를 구분한다. |
| 업데이트 확인 | 탭을 열면 캐시를 즉시 표시하고 GitHub 버전 확인은 명시적인 `업데이트 확인`으로 실행한다. 조회는 백그라운드로 진행하고 화면 구석에 작은 `GitHub 조회 중` 상태만 표시한다. | 전체 화면 로딩·모달·목록 잠금을 사용하지 않는다. 다운로드·적용은 별도 실행이며, 확인하지 않은 상태를 최신으로 표시하지 않는다. |

핵심 동작의 추가 결정은 없다. 카드 치수·간격과 슬롯 수·추가 방식은 개발 탭에서 실제 화면을 보며 조정한다. 카드/목록/상세/메타데이터 개발은 슬롯 엔진 연동과 분리 가능하다. 이번 실행 권한은 별도 개발 탭 구현과 검증이며 앱 빌드·설치·원격 게시를 포함하지 않는다.

## 현재 구조와 재사용 근거

### 공유

- `scripts/instruction-publisher.cjs`는 연결된 GitHub 저장소에 `packages/<id>/<digest>/package.json`, 지원 파일과 `index.json`을 유지한다. 배포는 `azrael-resources-v<semver>` Release의 ZIP·manifest를 이용한다. 공개·협업자 공유는 서로 다른 저장소, 로컬 전용은 원격 배포 제외다.
- 기본 지침 전체 배포는 `instructions-v<semver>` 프로토콜로 별도다. 기본 배포 저장소 설정 기본값은 `felrer/Azrael`이며, 개별 리소스 연결은 등록된 저장소 목록을 쓴다. 모든 사용자가 사용하는 단일 배포 전용 레포가 강제되는 구조는 아니다. 이번 조사는 실제 계정의 연결/원격 게시 상태를 확인하지 않았다.
- 초기 화면은 원격 캐시를 복원하며 GitHub 확인은 명시적인 요청이다. 저장·다운로드·설치·게시·활성화는 다른 상태이며 기존 기록과 원격 권한을 보존한다.

### 화면과 로딩

- `extensions/azrael-ex/src/instructionView.ts`의 렌더러/클라이언트와 `instructionService.ts`, `instructionLibraryService.ts`가 현재 소유자다. mount는 snapshot 전체가 완료된 뒤 HTML을 전달한다.
- `scripts/verify-instruction-library-render.mjs`는 실제 렌더러를 Chrome에서 실행하지만 데이터와 호스트 동작은 fixture다. 이를 그대로 실제 기능 검증으로 간주하지 않는다.
- `scripts/instruction-catalog.cjs::scanInstalled`는 지원 파일까지 읽고 해시한다. 파일별 안전성 확인도 경로 디렉터리를 반복 탐색한다. 최초 목록 표시와 이 작업을 분리할 필요가 있다. 실제 병목 시간은 아직 측정하지 않았다.
- `소스 알림`은 버전 경고 전용이 아니다. 소스 부재·권한·형식·용량 오류, 링크 설치 전환 필요, 스킬 상태 조회 실패 등을 담는다. 일반 알림 묶음 UI는 없애되 오류와 복구 기능을 없애지 않는다.

### 패키지와 프로필

- `scripts/instruction-library.cjs`의 immutable 리소스/버전/내용 digest, 지원 파일 inventory, provenance, 충돌 감지, 설치 잠금·저널·복구를 재사용한다. 현재 image 필드와 일반 복합 패키지 envelope는 없다. 현재 UI의 description도 완전한 저장·배포 메타데이터로 보장되어 있지 않아 영속 스키마와 배포 인덱스에 포함해야 한다.
- 기존 task-profile은 고정 버전 의존성과 모델·provider·reasoning·지침을 묶는다. `task-profile-runtime.cjs`와 `inject-task-profile.cjs`는 선택한 새 로컬 대화와 첫 요청 중심이다.
- 현재 `turn/start`에는 model/effort 변경이 있지만, 임의의 패키지 전체(지침·스킬·역할·provider)를 기존 대화에서 교체하는 일반 API는 확인되지 않았다. 다음 요청 전체 교체는 별도 통합 설계와 검증이 필요하며, 개발 탭의 성공으로 엔진 수용을 주장하지 않는다.

## 제안 화면

1. **프로필 슬롯**: 현재 대상 프로젝트와 생성/저장한 프로필, 그 프로젝트의 활성 표시, 다음 요청 적용 표시. 드래그 외에 키보드·클릭 `슬롯에 장착`을 제공한다. 프로젝트 전환 시 해당 프로젝트의 장착 상태를 복원한다. 패키지 카드를 슬롯에 직접 장착하지 않는다.
2. **검색과 필터**: 제목·설명 검색, 출처(GitHub/로컬), 다운로드 상태, 구성 종류. 마켓은 데이터 계약의 출처 종류로만 남기며 실제 연결과 빈 마켓 화면은 만들지 않는다.
3. **카드 목록**: 그림처럼 왼쪽 이미지, 오른쪽 제목·설명인 가로 카드. 권고 시작 치수는 약 400×144px, 이미지 96px, 설명 2~3줄 제한이다. 카드 폭·높이는 일정하게 유지하고 공간에 따라 1열→2열→N열로 늘린다. 카드 최소 폭보다 작은 화면에서는 가로 넘침 없이 가용 폭에 맞춘다. 최종 치수는 별도 탭의 실제 화면 검토로 조정한다.
4. **상세 카드**: 선택 카드의 확대 상세 패널/대화상자에서 이미지·제목·전체 설명·출처·버전·다운로드/적용 상태와 구성 트리를 보여준다. 구성 클릭으로 지침 본문, SKILL.md, 플레이북, 지원 파일, 모델·추론 설정을 확인한다. 뒤로/닫기 시 검색·스크롤·선택을 보존한다. 좁은 폭에서는 상세가 화면 폭을 사용한다.
5. **패키지 만들기**: 제목·설명·이미지, 구성요소와 선택적 프로필을 편집한다. 다운로드한 원본을 수정하지 않고 `요소 가져오기`로 새로운 로컬 패키지를 만든다. 여러 원본 요소를 사용할 수 있으나 결과는 독립된 단일 패키지다. 원본 provenance와 선택한 버전을 남긴다. 작성자는 실제 provider/model 목록에서 프로필을 만들며 인증 정보는 포함하지 않는다.
6. **하단 기존 라이브러리**: 기존 조회·고급 관리 진입을 보존하고 접기 가능한 하단 구역으로 이동한다. 새 UI의 전체 상태 조회를 막지 않도록 열 때 필요한 데이터를 읽는다. 기존 데이터·게시·비교·복구는 새 계약으로 옮길 때까지 제거하지 않는다.

OpenAI 스타일의 중립 색, 간격·타이포·테마 토큰을 적용한다. 아이콘에는 툴팁과 접근 가능한 이름을 제공하며 색만으로 상태를 구별하지 않는다.

### 카드 상태

- 출처 아이콘: GitHub / 로컬 (향후 마켓). 상세에서 저장소와 게시자를 확인한다.
- 가용성 아이콘: 외부·미다운로드 / 다운로드 중 / 로컬 사용 가능 / 검증 실패. 로컬 원본은 원격에서 다운로드한 것으로 표시하지 않는다.
- 활성 상태: 다운로드와 별도로 현재 프로젝트의 활성 프로필에서 사용하는 패키지에 `사용 중` 표시. 다운로드만으로 적용하지 않는다. 패키지가 제공하는 프로필은 상세에서 확인·장착한다.
- 업데이트: 현재 로컬 버전과 같은 출처의 확인된 최신 버전을 비교하여 `새 버전` 배지를 표시한다. 확인 시각과 `확인 전`/`확인 실패`도 구별한다. 업데이트를 자동 적용하지 않는다.
- GitHub 조회 진행은 화면 구석의 작은 공통 상태로 표시한다. 조회 중에도 기존 카드 목록의 검색·상세 확인·로컬 작업을 계속할 수 있다. 결과가 도착하면 해당 카드의 버전/상태만 갱신한다. 실패 시 기존 목록을 유지하고 작은 실패 상태와 재시도를 제공한다.
- 소스 오류: 해당 카드/저장소 연결 상태에 재시도·진단 표시. 전체 소스가 실패해 카드가 없을 때에는 목록 위에 짧은 오류와 재시도를 제공한다. `소스 알림` disclosure는 제거한다.

## 데이터와 동작 계약

### 패키지

- 패키지는 표시·배포·선택 단위다. 안정 ID, schemaVersion, 버전/내용 digest, 제목, 설명, 이미지 asset, 구성요소 inventory와 선택적 프로필을 가진다. 구성은 1개 또는 여러 스킬/플레이북/참고지침/역할/모델 프로필일 수 있다.
- 이미지·제목·설명은 저장·내보내기·GitHub 배포·캐시 복원에서 보존한다. 이미지 없는 기존 패키지는 기본 아이콘으로 표시한다. 이미지 경로/형식/용량을 검증하고 임의 파일 경로를 브라우저에 노출하지 않는다. 이미지도 버전별 asset으로 취급한다.
- 다운로드하면 선택 버전과 필요한 전체 구성 파일을 검증하여 로컬에서 재사용할 수 있게 한다. 작성한 패키지는 독립적인 구성 스냅샷을 보유하고 실행 시 다른 설치 패키지를 합성하거나 최신 의존성을 따라가지 않는다. 중복 스킬 이름·순환/누락 의존성은 검증 오류다.
- 식별자는 출처 ID + 패키지 ID를 사용한다. 이름이 같다는 이유로 다른 저장소 패키지를 합치지 않는다. 같은 출처에서 받은 로컬 사본은 하나의 카드에 다운로드·버전 상태를 합친다. 사용자가 파생 제작한 패키지는 새 ID와 원본 이력을 갖는다.
- 기존 단일 리소스와 task-profile은 읽기 어댑터로 패키지 카드에 노출한다. 새 envelope는 버전 구분을 하며 기존 포맷을 제자리에서 파괴적으로 바꾸지 않는다. 새 패키지와 기존 GitHub 프로토콜의 수용 범위는 승인한 스키마로 테스트한다.

### 프로젝트별 프로필 적용과 슬롯

- 프로젝트마다 한 활성 프로필 스냅샷이 선택된 모델·추론 설정·지침·사용 가능한 스킬/역할을 정의한다. 프로필은 패키지에서 제공받거나 사용자가 만들 수 있다. 슬롯 교체는 해당 프로젝트의 이전 프로필 기여를 교체하며 누적 결합하지 않는다. 원래 Azrael 기본/사용자/프로젝트 지침의 소유권·권한은 유지한다.
- 플레이북은 Azrael 관리 저장소에 보관하고 활성 프로필이 선택한 패키지 참조로 읽는다. 이 화면의 적용에 `docs/playbooks` 프로젝트 쓰기를 요구하지 않는다. 과거에 배포된 프로젝트 파일은 자동으로 이동·삭제하지 않는다. 공통 저장소에 파일이 있다는 사실만으로 다른 프로젝트의 프로필 기여를 활성화하지 않는다.
- 짧은 활성 규칙은 출처가 있는 지침으로 전달하고 긴 스킬/지원 파일은 필요할 때 읽게 한다. 파일 전체를 매 요청 본문에 주입하지 않는다.
- 장착은 로컬에서 필요한 구성이 준비·검증된 프로필에 대해 현재 프로젝트의 활성 선택을 즉시 저장한다. 미다운로드 패키지는 먼저 다운로드, 필요한 모델/로그인이 없으면 사용자 선택/오류를 표시하며 그 프로젝트의 이전 활성 상태를 유지한다. 권한 승인이나 비용 있는 모델 전환을 숨기지 않는다.
- 활성 선택은 프로젝트 ID를 키로 revision·프로필 ID·digest와 함께 저장한다. 같은 프로젝트를 연 Azrael 창들은 일관된 선택을 읽고 다른 프로젝트는 독립적이다. 요청 접수 시 소속 프로젝트와 프로필 revision·구성 패키지 digest를 고정한다. 작업 중 적용 상태와 다음 요청 기본 상태를 구별한다. 활성 해제는 해당 프로젝트의 프로필 기여만 제거하고 기본 상태로 돌아간다.
- 프로젝트 식별은 기존 Azrael 프로젝트/대화 연결의 안정 ID를 재사용하며 임의의 첫 workspace 폴더로 추정하지 않는다. 프로젝트에 소속되지 않은 대화는 프로필을 자동 장착하지 않고 Azrael 기본 설정을 사용한다. 다른 프로젝트의 선택을 대신 적용하지 않는다.
- 엔진 연동은 모델뿐 아니라 지침 교체·스킬 카탈로그·역할·provider handoff·compaction/replay까지 동일 스냅샷을 사용해야 완료다. 기존 대화 내 동적 적용에 엔진 변경이 필요하면 통합 단계에서 빌드하며 개발 탭 단계에는 전체 빌드를 요구하지 않는다.

## 구현 구조와 순서

담당은 root이며 별도 에이전트 할당은 현재 계획에 필요하지 않다. 기존 동시 작업 파일을 보존하고 이 범위만 수정한다.

| 단계 | 입력/선행 조건 | 작업과 소유자 | 산출물과 다음 소비자 |
| --- | --- | --- | --- |
| 1. 계약 확정 | 본 계획 검토; 프로젝트별 단일 활성 프로필은 확정 | instructions/UI 계약의 target 부분과 패키지 schema·요청 상태·프로젝트별 선택 계약 정리 | 개발 UI·서비스가 공유할 타입과 수용 조건 |
| 2. 개발 탭 실행기와 카드 | 표시 계약 확정 | 기존 실제 렌더러/클라이언트 분리·재사용, Node 로컬 서버와 browser transport, 개발용 갱신 경로 추가 | Azrael 빌드 없이 열리는 실제 UI; 카드·상세·테마를 사용자 검토 가능 |
| 3. 패키지 저장·출처 | schema 확정; 2와 독립 준비 가능 | instruction-library/catalog/publisher를 재사용해 로컬 저장·기존 포맷 읽기·GitHub adapter·이미지 asset·상태 캐시 구현 | 실제 로컬/GitHub 목록, 다운로드, 새 패키지 제작; 2의 UI와 연결 |
| 4. 슬롯·다음 요청 모델 | 프로젝트별 슬롯 계약과 3의 고정된 패키지 | 프로젝트별 활성 프로필 저장·revision·오류/전환 로직, 요청 스냅샷 미리보기·비용 없는 요청 경계 검증 | 프로젝트 A/B의 독립적인 장착/교체/해제와 다음 요청 상태를 개발 탭에서 검증. 가상 요청 검증임을 명시 |
| 5. 실제 기능·성능 검토 | 2~4 통합 | Windows 로컬 실사용, 느린 조회·오프라인·오류·카드 수/폭 변화 확인 | 별도 탭 기능 수용과 남은 엔진 연동 목록 |
| 6. Azrael 통합 | 개발 탭 UI/데이터 계약 안정화와 통합 실행 권한 | 같은 화면에 Webview transport 연결; task runtime/필요 native 계약 확장; 보존 inventory와 owning docs 갱신 | 빌드·설치 후 기존/새 대화의 다음 요청 수용. 앱 빌드·설치는 이 단계에서 별도 범위 확인 |

기존 의존성과 Node HTTP/파일 API, CSS Grid, 브라우저 드래그/파일 API를 먼저 재사용한다. 독립 UI의 새 프레임워크나 별도 패키지 관리 도메인을 만들지 않는다. 브라우저와 Webview는 transport만 달리하고 카드·편집·저장·검증 로직은 공유한다. GitHub 인증은 호스트에 남기고 브라우저에 토큰을 전달하지 않는다. 로컬 서버는 loopback 제한과 세션별 요청 검증을 적용한다.

### 개발 환경의 실제 기능 범위

- 첫 화면의 fixture는 시각 상태 재현에만 사용한다. 실제 목록·저장·다운로드는 기존 backend를 쓰는 개발 transport로 검증한다.
- 기본 개발 저장소와 적용 대상은 프로젝트 `artifacts/` 아래 task-owned sandbox로 둔다. 현재 사용 중인 Azrael 상태와 설치를 바꾸지 않는다. 기존 로컬 패키지/캐시의 읽기 연동과 sandbox 쓰기를 구분한다.
- GitHub는 사용자가 연결한 저장소를 읽는다. 실제 원격 확인에는 현재 인증을 재사용할 수 있는지 구현 시 확인한다. 읽기 테스트와 게시/쓰기 권한은 분리하며 이번 목록 작업이 원격 게시를 허가하지 않는다.
- 개발 서버와 브라우저에서의 장착은 sandbox의 프로젝트별 실제 활성 프로필 선택을 갱신한다. 개발 탭에서는 테스트 프로젝트 A/B를 전환해 독립 상태를 검증한다. 설치본의 요청에 영향을 주는 것은 6단계 연동 뒤이며, 4단계에서 적용 완료로 표시하지 않는다.
- 전체 앱 빌드는 하지 않지만 변경 TypeScript/UI 모듈의 변환·타입 검사·개발 서버 갱신은 수행한다.

## 초기 표시 성능

- 빈 화면 대신 검색/슬롯/캐시 카드 뼈대를 먼저 표시한다. 원격·엔진 응답은 최초 표시의 선행 조건이 아니다.
- 목록은 이름·설명·이미지·출처·버전 등 인덱스만 읽는다. 구성 파일 읽기와 해시 검증은 상세/다운로드/적용에 필요한 시점으로 옮기되 적용 전 검증을 생략하지 않는다.
- 파일 스캔·네이티브 스킬 상태·원격 조회를 분리하여 각 상태를 갱신한다. 카드 전체가 바뀌어 검색·스크롤·드래그 상태를 잃지 않게 한다. 늦은 응답은 revision으로 구별한다.
- 수동 GitHub 조회는 초기 snapshot과 분리된 비차단 작업으로 실행한다. 조회 요청의 접수/진행 상태를 먼저 반환하고 결과는 후속 갱신으로 전달한다. 기존 화면 전체 busy 상태로 카드 탐색과 독립적인 로컬 작업을 막지 않는다. 조회 중 중복 실행은 합쳐 처리하며 소스가 바뀐 뒤 도착한 오래된 결과는 현재 목록을 덮어쓰지 않는다.
- 먼저 캐시 첫 표시와 소스별 소요 시간/파일 수를 측정한다. 네트워크/엔진이 지연되어도 로컬 목록을 탐색할 수 있는지를 수용 기준으로 삼는다. 측정 전 임의의 속도 향상을 보장하지 않는다.

## 검증과 수용 기준

플랫폼 분류: 카드·패키지 의미·프로젝트별 프로필 적용은 Windows x64/Linux x64/macOS ARM64 공통. 로컬 경로·인증·엔진 실행·브라우저 기동은 플랫폼 adapter 책임이다. 먼저 Windows x64 로컬 개발 탭에서 확인하며 Linux/macOS·Remote SSH·컨테이너 수용을 주장하지 않는다. 공통 변경의 Windows 회귀를 필수로 포함한다.

| 기준 | 최소 검증 |
| --- | --- |
| 카드·상세 | 실제 browser light/dark, 360/800/1440px 폭에서 1/N열·고정 높이·말줄임·기본 이미지·전체 설명·구성 트리 확인 |
| 입력 접근성 | 마우스 드래그와 클릭/키보드 장착, 상세 focus/닫기/목록 복귀·스크롤 보존 확인 |
| 메타데이터·패키지 | 실제 저장→재시작→읽기 roundtrip에서 이미지/제목/설명/전체 구성·고정 버전·provenance 보존; 기존 포맷 읽기 |
| 출처·다운로드 | 같은 이름의 다른 저장소 구분, 원격 사본 중복 카드 방지, 다운로드/활성 상태 분리, checksum 실패·오프라인·부분 실패 |
| 업데이트·오류 | 명시 확인 후 새 버전 배지, 미확인/실패 구분, 개별 재시도, 링크 설치·권한·복구 경고를 제거 없이 새 위치에 표시. 지연된 GitHub 응답 중 구석 상태 표시만 바뀌고 기존 검색·상세·로컬 작업은 가능하며 실패 후 목록 보존과 재시도 확인 |
| 새 패키지 | 다운로드한 패키지 요소를 복사해 새 ID 패키지 저장/사용, 원본 불변, 지원 파일과 모델 설정 포함, 이름 충돌·누락 오류 |
| 슬롯 | 프로젝트별 장착/교체/해제·재시작 복원·revision 경쟁, 실패 시 기존 활성 유지, 프로젝트마다 활성 프로필 하나, A/B 프로젝트 전환·동일 프로젝트의 여러 창 동기화·다른 프로젝트에 영향 없음 |
| 요청 시점 | 개발 탭에서는 실제 resolver의 프로젝트 ID·고정 스냅샷과 다음 요청 상태 검증. Azrael 통합 후 해당 프로젝트의 기존/새 대화에서 실제 모델 요청의 모델·지침·스킬·역할·provider 변경/해제 및 이미 진행·대기 중 요청의 접수 당시 프로필 보존, 다른 프로젝트로 프로필 기여가 유출되지 않음, 프로젝트 없는 대화의 기본 설정 사용 확인 |
| 성능 | 느린 엔진·원격·지원 파일이 최초 카드 표시를 막지 않는지 실제 계측; 상세 파일은 선택 후 읽는지 확인 |
| 보존 | 기존 로컬 자료·출판/버전 비교·복구·원격 권한·비공개 제외·프로젝트 기존 파일 보존; feature inventory의 변경된 계약과 필수 검사 일치 |

기존 `test-instruction-library-host.cjs`, instruction backend/publisher/package 검사, `verify-instruction-library-render.mjs`, task profile 검사를 영향 범위에 맞게 확장/재사용한다. 검사 선택과 결과는 설치된 testing/implementation 및 프로젝트 maintenance 절차를 따른다. source tests/가상 응답을 실제 GitHub 인증·설치본·모델 호출의 증거로 사용하지 않는다. 영구 테스트 추가는 앞으로 반복할 수 있는 구체적 누락에 한정한다.

## 문서·생성물·완료 경계

- 승인 후 enduring target 계약은 `docs/architecture/instructions.md`, `ui-presentation.md`, 필요한 `model-harness-profiles.md` 부분에 반영한다. feature `ui.instruction-settings`, `engine.task-profile-skills`와 필요한 runtime 계약의 구현 소유자/필수 검사를 연결한다. 프로필 UI와 provider harness를 같은 개념으로 뭉개지 않는다.
- 개발 실행기는 유지할 제품 개발 도구다. 실행 서버·로그·browser profile·sandbox 설치/패키지는 task/run owner를 기록한 생성물이며 즉시 필요가 끝난 자료는 기존 owner로 삭제하고 확인한다. 사용자 확인용 최소 실행/복구 묶음만 정확한 경로·크기·용도와 함께 고지하며, 확인 전 cleanup pending으로 둔다.
- 실행 결과는 아래 구현·검증 기록과 `03-standalone-verification.json`이 소유한다. 전체 Azrael 빌드·설치·모델 호출과 최종 엔진 수용은 별도다.

## 참조

- [지침 계약](../../docs/architecture/instructions.md)
- [모델 harness 계약](../../docs/architecture/model-harness-profiles.md)
- [UI 계약](../../docs/architecture/ui-presentation.md)
- [플랫폼 계약](../../docs/architecture/multi-platform.md)
- [지침 운영·검사](../../docs/ops/instruction-distribution.md)
- [기존 렌더링 실행기](../../scripts/verify-instruction-library-render.mjs)

## 구현·검증 기록 (2026-11-02)

- 소유: backend/domain·영구 테스트는 workbench_backend, UI는 workbench_ui, HTTP adapter·통합·feature/docs·최종 검증은 root. 기존 library/publisher를 재사용했다. 두 하위 담당자는 완료했다.
- 실행기: `node scripts/serve-instruction-workbench.cjs --port 4318 --repository felrer/Azrael --project <절대 프로젝트 경로>`. 실행마다 별도 sandbox이며 reload는 상태를 보존한다. 설치본에는 적용하지 않는다.
- 기능: 400×144 카드·반응형 목록·상세 파일 preview·새 패키지/요소 복사/폴더·이미지 입력·제공 프로필/직접 프로필·프로젝트별 단일 활성 슬롯·드래그/클릭·고정 요청 snapshot·하단 기존 조회. GitHub는 명시적 비차단 조회와 캐시 보존, checksum 검증·다운로드 상태를 제공한다.
- 자동 검증: 최종 backend/HTTP 9개 통과, 실제 exit 0. 첫 managed 실행은 10초 제한 exit124 실패로 보존하며, 이후 완료 관측된 전용 runner로 검증했다. `03-standalone-verification.json`에 독립적인 결과·source SHA를 남겼다.
- 실제 Chrome: 패키지 생성/상세·제공 프로필·A/B 분리/복원·요청 snapshot·마우스 핸들 드래그·클릭 장착·360/800/1440 CSS 폭·light/dark·조회 중 검색 가능 확인. 최초 UI 상태 로딩 null 접근과 같은 인스턴스 lock 경쟁을 발견해 수정하고 해당 검사를 재실행했다.
- 계측: warm local 단일 page34ms/state244ms; 설치본의 성능 개선이나 cold-start 보장을 의미하지 않는다.
- 범위: Windows x64 Node26.7/Chrome만 실제 검증. Linux/macOS·Remote·실제 모델/provider·실행 중 세션 적용은 미검증.
- 통합 다음 단계: 이 개발 탭 UX를 사용자가 확인한 뒤 같은 domain/UI를 Webview adapter와 실제 request admission에 연결한다. Azrael 빌드/설치는 별도 승인 범위다.

### 최종 인계·정리 상태

- 개발 탭: http://127.0.0.1:4318/ (서버 PID39252). 공개 `felrer/Azrael` 실제 인증 조회 성공, 해당 배포 형식의 원격 패키지 0개. 실제 원격 패키지 다운로드는 아직 미검증이다.
- 사용자 확인 묶음: `artifacts/tasks/FA-01-instruction-package-dev-tab/runs/20261101T173353779Z-f4cb0634-6178-45ff-ba92-70f003789f48`, group `run:FA-01-instruction-package-dev-tab:20261101T173353779Z-f4cb0634-6178-45ff-ba92-70f003789f48`. 개발 sandbox·샘플 패키지/프로필·최소 HTTP 로그·화면 이미지이며 측정 시 44,930bytes/7files(로그 증가 가능), 백업 없음. 정상 확인 후 서버를 graceful stop하고 보호/참조를 재확인해 owner로 삭제한다. 실제 보존할 작성 자료가 생기면 삭제 전에 별도 식별한다.
- 과거 종료 실행 8개: 검토 보호 충돌 0 → explicit delete → native 실제 결과 deleted8/remaining0/error0 → lifecycle finalized8. 최소 독립 결과는 02/03/04 문서에 보존. 처리 종료 2026-11-02 KST; 등록/검토/순차 삭제 관리 비용이 최종 인계를 지연했고 중복 producer는 시작하지 않았다. 생성한 maintenance 제어 JSON 20개도 일반 삭제 후 잔여0 확인.
- 다음 사용자 확인: 카드·상세·구성요소 복사와 새 패키지, 제공/직접 프로필의 드래그·클릭 장착 흐름. 정상 확인까지 작업 상태는 awaiting user confirmation / cleanup pending이며 완료로 닫지 않는다. 본체 통합은 다음 단계다.

### 사용자 UI 문구 수정 (2026-11-02)

- 승인 범위: 페이지·탭 제목을 `Agent 프로필`로 변경, 소개 문장·`슬롯에 장착`/`끌어 장착` 버튼·요청 시점 설명 삭제. 설명 card 추가는 이번 요청에서 수행하지 않는다.
- 버튼 제거 뒤 저장 프로필 카드 자체를 pointer/native drag와 클릭/Enter/Space 대상으로 연결하고 프로젝트 로딩·pending·disabled 보호와 접근성 이름을 유지했다.
- 검증: node --check 및 git diff --check exit0. 실제 Windows Chrome에서 삭제 문구 0개·제목·키보드 장착·카드 전체 드래그 장착 확인. 본체 빌드 없음. 기존 확인 묶음 안의 preview.jpg를 교체했으며 새 disposable 실행 자료는 만들지 않았다. 정상 확인 대기와 cleanup pending은 유지한다. 03의 source SHA는 이전 검증 revision에 해당하며 이번 UI 변경의 증거는 이 항목이다.

### Provider·Model·Reasoning 선택기 수정 (2026-11-02)

- Provider 체크 해제는 전체 범위(provider/providerAccount 저장 안 함), 체크 시에만 연결된 계정 select를 표시한다. Model/Reasoning도 dropdown이며 선택 계정의 캐시 모델과 모델 지원 effort만 제공한다. 계정 scope는 native provider ID와 별도로 보존한다.
- 기존 계정 metadata·검증된 provider helper·모델 cache 파서를 재사용했고 credential/stock model fallback/새 daemon/전체 빌드는 없다. 캐시는 현재 계정별 사용 자격을 새로 검증한 결과가 아니다. Devin 모델 cache 연결은 아직 없다.
- 기존 개발 서버는 정상 종료(exit0) 후 --seed-run으로 새 owned run에 library/profile/cache만 복사했다. 원본과 기존 글로벌 프로필/패키지 보존을 확인했다. 이전 종료 묶음은 새 기능 정상 확인 전의 최소 복구 사본이다.
- 자동 검사 11 pass/0 fail, 실제 exit0. 계정별 필터·체크 on/off·native/managed effort·계정 지정 저장·기존 데이터 보존을 Chrome에서 확인. 05-profile-options-verification.json이 해당 revision 증거를 소유한다. 새 영구 검사는 dropdown scope/account normalization과 cache whitelist 연결 누락 재발을 좁게 막는다.
- 테스트 payload는 새 설치 owner identity 3b1f9bf4...로 검토/삭제해 remaining0/error0을 확인했고 제어 JSON6개도 삭제했다. 이전 owner 경로가 교체되어 최초 등록 시도는 시작 실패했고 현재 설치 영수증/hash 검증 후 재실행했다. 삭제 후 lifecycle finalize는 공용 owner의 동시 변경 구문 오류로 처음 실패했다. 다른 owner의 복구 후 빈 lifecycle을 finalize 완료했으며 06-profile-options-cleanup.json에 실제 결과를 기록했다. 공용 owner 코드는 이 작업에서 수정하지 않았다.
- 사용자 확인 묶음(정상 확인까지 awaiting user confirmation/cleanup pending):

- `C:\Users\felre\Desktop\pi-harness-init\artifacts\tasks\FA-01-instruction-package-dev-tab\runs\20261101T185715674Z-dcb82c00-2c0b-43de-9c46-7c441d79bdce` / group `run:FA-01-instruction-package-dev-tab:20261101T185715674Z-dcb82c00-2c0b-43de-9c46-7c441d79bdce`: 43339bytes, 8files, 현재 개발 탭·보존된 패키지/프로필·최소 로그·화면. 새 선택기 정상 확인 후 두 묶음을 서버 종료/참조 재확인하여 owner로 삭제.
- `C:\Users\felre\Desktop\pi-harness-init\artifacts\tasks\FA-01-instruction-package-dev-tab\runs\20261101T173353779Z-f4cb0634-6178-45ff-ba92-70f003789f48` / group `run:FA-01-instruction-package-dev-tab:20261101T173353779Z-f4cb0634-6178-45ff-ba92-70f003789f48`: 43320bytes, 9files, 정상 종료된 이전 개발 데이터 복구 사본. 새 선택기 정상 확인 후 두 묶음을 서버 종료/참조 재확인하여 owner로 삭제.

## 본체 통합 실행 범위

- 현재 목표/권한: 개발 탭을 계속 독립 사용 가능하게 보존하고 같은 domain/UI를 본체에 연결한다. 본체의 기존 지침 화면, 실제 계정/모델 정보, 프로젝트별 단일 활성 프로필, 요청 접수 시점의 불변 snapshot을 포함한다. 개발탭의 모델 cache-only adapter를 실제 host live catalog와 혼동하지 않는다. 설치는 기존 창 종료/강제 reload 없이 검증된 package를 선택한다. 원격 공개/업로드 권한은 없다.
- 보존 정정: 사용자 요청으로 현재 개발 탭과 그 데이터는 계속 사용할 전달물이다. 정상 확인 직후 해당 활성 개발 실행을 삭제한다는 이전 문구는 철회한다. 제품 저장소와 개발 탭 저장소는 분리하고 기존 authoring library·로그인·대화·프로젝트 파일은 보존한다. 이전 정상 종료 복구 사본은 통합 정상 확인까지의 최소 복구 묶음으로 유지한다.
- 플랫폼: UI·profile domain·request 의미는 Windows x64/Linux x64/macOS ARM64 공통, 관리 IPC/계정/backend 실행은 기존 플랫폼 adapter 재사용. 이번 실제 통합·설치 검증은 Windows x64이며 다른 OS 수용을 주장하지 않는다.
- 의존/소유: root는 공통 데이터·transport·activation contract/통합/검증/빌드·설치를 소유한다. profile_host_integration은 기존 지침 host/settings/live catalog와 packaging seam 읽기, profile_runtime_integration은 admission/queue/task-profile snapshot seam 읽기. 두 조사 결과에서 인터페이스를 고정한 뒤 파일별 구현 소유자를 나눈다. root는 그동안 빌드·검증 선행조건과 기존 workbench 보존을 준비한다.
- 빌드 입력은 통합 소스가 준비된 시점에 owner 절차로 freeze한다. 공유 checkout에 많은 동시 변경이 있으므로 별도 소유 입력·검증 artifact와 기존 lock/cache 경계를 존중하고 런타임/설치 경로를 확인한다.

### 통합 구현과 수용 준비

- 기존 라이브러리에서 시작한 고정 프로필 대화는 유지하고 일반·새 대화에 프로젝트 프로필을 적용한다는 사용자 결정을 반영했다. 질문 응답은 원래 작업의 snapshot을 유지한다.
- native settings·공유 renderer·호스트 admission 구현 완료. production state는 `CODEX_HOME/azrael/instruction-workbench`로 개발 탭 데이터와 분리한다. 기존 library 관리 진입점도 유지한다. 새 CJS 모듈의 배포 복사·VSIX 필수 항목·namespace 캐시 의존성과 source 없는 패키지 dependency smoke를 연결했다.
- 중간 통합 검사 40개 exit0(Windows): domain·HTTP·host·패키지 closure·legacy runtime. 07-integration-source-verification.json에 독립 증거 보존. 이후 questionReply 보정 때문에 최종 검사 재실행이 필요하다. 검사 disposable 등록은 다른 작업이 점유한 maintenance OS lock 때문에 maintenance_busy로 거절되어 정리 대기이며 잠금을 우회하지 않았다.
- 실제 설치는 동시 작업으로 2026.0.14가 됐음을 설치 runtime·receipt에서 확인했다. 이번 후속 배포는 2026.0.15로 선택한다. official·audio 실제 설치 버전26.1021.22027과 pinned UI26.1007.21434를 구분한다.
- shared Cargo target은 다른 codex-core 검사 producer가 사용 중이므로 아직 컴파일을 시작하지 않았다. 계정 지정 profile의 대기열 접수 후 계정 변경 경계를 보완한 뒤 immutable inputs를 고정한다.
- 계정 scope 보완 완료: snapshot integrity에 optional `providerAccount`를 포함하고 native OpenAI·managed·Devin의 실제 선택 계정과 대조한다. 대기열 접수 후 계정이 달라지면 실행을 거절하며 자동 전환하거나 다른 snapshot으로 바꾸지 않는다. 일반 입력·compaction은 새 admission, 질문 reply는 기존 작업 snapshot을 유지한다.
- 보완 뒤 통합 검사42개 exit0, managed 계정 owner focused 검사6개·24assertions exit0. provider 전체 TS5.9 noEmit은 기존 dependency graph 오류76개로 exit2이며 변경3파일 diagnostics0이다. 실패한 준비·검사 실행3개와 최종 성공 실행1개는 `artifacts/tasks/FA-01-profile-account-scope/runs/` 아래 실제 outcome으로 보존해 정리한다. source 타입 검사 성공과 전체 graph 성공을 혼동하지 않는다.
- 현재 shared Cargo cache의 live Cargo·rustc 및 active target lease가 없음을 확인했다(정리/기존 결과 성공의 증거로 사용하지 않음). 공개 protocol의 cfg(test) schema writer가 stable·experimental precomputed bundle을 재생성해야 하므로, 중간 고정 입력에서 외부 artifact root로 생성한 결과를 검토·반영하고 최종 입력을 고정한다. 일반 generate-ts CLI는 기존 precomputed를 재수출하므로 생성기로 쓰지 않는다.
- 출처 대조: 기존 ordinary content delta71개, 새 profile Rust파일2개. adapted delta·새 migration0개. `scripts/workspace-status.cmd`는 Node mode 추측과 달리 실제 Python3.13 `stat.S_IMODE`가 0777로 receipt와 같으므로 추가 delta가 아니다. Python 실행기는 `C:/Users/felre/AppData/Local/Programs/Python/Python313/python.exe`이다. 다른 동시 작업의 미추적 `engine/codex-rs/core/tests/suite/code_mode_dynamic_tools_tests.rs`가 기존 code_mode.rs에서 참조된다. 내용을 보존해 빌드 출처에 포함하려면 recorder가 Git 추적을 요구하므로, 이 파일만 추적 등록하고 이번 task commit에서는 분리하는 승인을 사용자에게 요청했다. 응답 전에는 해당 파일이나 Git index를 바꾸지 않는다. 본 작업의 두 새 profile Rust 파일만 출처 기록 선행조건으로 staged했다.
- 추가 legacy host smoke는 `DK-01-instruction-catalog-diagnosis/host-14c7093a`: tests exit1(기존 fixture의 `artifacts/latest.json` 부재 및 Python PATH 미설정). caller lifecycle close도 catalog.lock busy로 실패해 wrapper exit1이며 passing으로 보지 않는다. 다음 실행은 실제 설치 engine의 명시 override와 Python 절대 경로를 사용한다. 동시에 시도한 types runner는 .run-claim.lock busy로 검사 시작 전 exit1이었다. 기존 host owner의 tsc noEmit exit0 증거는 별도이며 이 실패를 대체 성공으로 기록하지 않는다.
- 최초 통합검사40 run의 등록 r2가 남긴 pre-intent reservation은 해당 고유 등록의 spawnSync 실제 exit1과 in-process 등록 경로를 독립 확인한 뒤 supported recover_reservation으로 해제했다(exit0, execution_outcome_changed=false). 종료 근거를 PID 부재로 대체하지 않았다. 증거는 `artifacts/maintenance/evidence/fa01-register-r2-stop-676b0c220cd820fc.json`이며 raw source request/result는 최종 정리까지 유지한다.
- account-scope 검증4run의 cleanup은 독립08 evidence를 고정한 뒤 첫 register exit0, 둘째 register exit1(`maintenance_busy`, maintenance.lock, 5000ms)로 중단했다. review·delete·finalize는 미수행이며 대상4run 모두 남아 있다. controller `run:FA-01-account-scope-cleanup:20261101T201918333Z-a154a8e9-da15-4dbb-950f-0316586ac125`도 actual exit1, producer terminal·membership complete로 인계받았다. 잠금 조작이나 중복 producer 없이 root가 이후 동일 owner 절차를 재개한다. 현재 전체 작업은 구현/중간검증 상태이며 빌드·설치와 cleanup 완료를 주장하지 않는다.
- 사용자 요청에 따라 개선된 fc02 stdin standalone로 정리를 재시도한다. 설치 pin과 실행파일 SHA-256 `2e30f1bbfb248688d350547298f7120262322fc207b542635e229952225fb861` 일치를 확인했다. 같은 cleanup owner가 account-scope4run·종료된 controller·root 통합검사2run을 직렬 처리한다. 새 controller는 만들지 않고 stdin 요청과 독립 `10-cleanup-retry.json`으로 결과를 보존한다. 최종42개 source 검사의 독립 근거는 `09-integration-source-verification.json`이다. 개발 탭·복구 묶음·실패한 DK host 진단 실행은 이번 삭제 범위에서 제외한다. 빌드 입력용 동시 작업 파일의 Git 추적 등록은 기존 사용자 확인 대기 상태를 유지한다.
- fc02 재시도 결과: 최초 catalog 관찰은 ancestor identity guard exit1로 중단했다. root read-only 진단은 catalog 745records·identity변경0·exit0이었고 이에 근거해 지원 경로를 한 번 재개했다. 첫 stdin register exit0, 둘째 register는 catalog.lock check_available `maintenance_busy`·wait5000ms·owner:null·exit1이었다. review/apply/delete/finalize는 0회이며 대상7root와 일회용 work5파일이 남아 있다. 독립 결과 `10-cleanup-retry.json` SHA-256 `a10fe0295d5b7eab5bc72f04d64686db4bcc8dc3893b429c262db18b334b98d2`에 실제 요청/응답/실패를 보존했다. 반복 실행·잠금 삭제 없이 보호를 유지하며 실제 점유 작업 종료 확인 또는 유지관리 owner 진단으로 지원 경로가 확정되면 재개한다. 전체 작업은 cleanup pending이며 빌드·설치는 미수행이다.
- 개발 화면 재개: 사용자 ERR_CONNECTION_REFUSED 보고로 이전의 남아 있던 브라우저 화면 확인이 서버 가용성 확인을 대신하지 못했음을 정정했다. 4318 listener와 해당 server command 프로세스가 없음을 확인하고 기존 데이터 owner를 참조하는 새 HTTP adapter run `20261102T050931182Z-9d52ac3e-ec51-4eeb-ba9c-089c9d5c939d`를 시작했다(PID45724). 기존185715 run의 알 수 없는 종료 결과/보호는 변경하지 않고 그 outputs/library를 그대로 사용한다. 새 run은 로그·임시 설치를 소유하고 기존 데이터에 consumer reference를 둔다. HTTP GET 실제200, 브라우저 reload 후 저장 프로필2개·패키지14개 표시를 확인했다. 새 live adapter는 사용자가 유지 요청한 개발 탭 실행물이다.
- 개발 UI 후속 변경: Provider 지정 하나가 provider/model/reasoning 세 설정 전체를 제어하며 미선택 시 세 override를 저장하지 않는다. 체크하면 다음 입력란 앞에 inline으로 펼치고 바깥 카드·배경·테두리·padding을 없앴다. 같은 선택기를 쓰는 새 패키지 내 제공 프로필에도 적용한다. Windows Chrome 밝은/어두운 테마·접힘·펼침·필수입력 비활성화를 확인했고 source 검사43개 exit0이다(`11-provider-inline-verification.json`). 기존 프로필의 model-only 자료는 보존한다. 이는 개발 탭 변경이며 모델 설정 없는 프로필의 native 요청 상속 구현/수용은 본체 통합 전 남은 일이다.
- HTTP adapter050931는 지원 stop API200 및 관리 session56141 실제exit0으로 종료했다. 새 live adapter `20261102T051451201Z-f2987b1b-35f4-41be-9b4a-a6d42945a6e8`(PID53808/session16911)가 같은 기존185715 데이터를 사용한다. 사용자 유지 요청 개발 실행물이며 스크린샷은 그 reports의 provider-inline-light.png/provider-inline-dark.png/provider-inline-collapsed.png다. 종료된 adapter050931와 검사051406 실행물의 필요 근거는11에 넘겼고 정리 대상이다.
- 이번 후속 변경의 disposable2run 정리는 완료했다. supported release로050931의 종료 data dependency1개만 해제했고 fc02 register2회/review/apply 모두exit0·deleted/remaining:false·실제부재·finalize2개를 확인했다. 결과 `12-provider-inline-cleanup.json` SHA-256 `91be155b11d7b868e8a748167f45a246dc7586d2e425c94ba415f9eb34b889cf`. live051451·기존185715 데이터는 유지되며173353 복구/기존7blocked는 미변경이다. 개발 폼 후속 요청은 구현·검증·관련 정리를 마쳤고 본체통합 전체는 앞선 확인/검증이 남는다.
- 프로필 조립기 설계: 좌측 세로 슬롯/우측 카테고리 요소 목록, 고정 Azrael 핵심 지침과 순서 있는 복수 추가 지침, 복수 스킬·MCP 활성 집합, 기본 프로필 읽기 전용/나머지 편집, 패키지 선택란 제거, 저장 버튼 하나와 별도 활성화로 정리한다. 사용자 답변으로 사용자 프로필은 선택한 스킬·MCP만 활성화하고 기본 프로필은 기존 설정을 유지하는 의미가 확정됐다. 필수 Azrael 기능은 독립 유지하며 optional 빈 선택은 optional 활성0개다. architecture Profile composer target에 반영했으며 아직 코드 구현·native 강제 수용은 아니다. 필수 기능의 정확한 목록과 패키지 제공 프로필의 자동 목록 노출/개인 사본 편집 권고는 별도 설계 확인이 남아 있다.
- 조립기 설계에 프로필 복제와 구성 오류 표시를 포함한다. 기본 프로필도 개인 편집 사본으로 복제할 수 있으며 원본/고정 핵심 지침은 보존하고 복제 자체로 활성화하지 않는다. 오류는 해당 슬롯과 프로필 목록에 표시하고 리소스 부재·MCP 사용 불가·모델 설정 부적합·중복 identity를 다룬다. 자연어 지침 충돌을 확실히 자동 감지한다고 약속하지 않는다. 저장/활성화/요청의 차단 여부와 optional 누락 정책은 미확정이다. 현재는 설계 반영이며 코드 구현은 시작하지 않았다.
- 구성 오류 처리: 저장은 허용하고 적용은 차단한다. 활성 프로필의 오류 수정본 저장은 마지막 정상 적용 revision을 바꾸지 않으며 저장본과 적용본을 구분한다. 정상 수정본 저장 시 다음 접수부터 갱신한다. 외부 MCP/인증의 사후 사용 가능성을 정상 revision 보존만으로 보장하지 않으며 접수 시 검증 실패를 기본 프로필 자동대체로 숨기지 않는다. 이 결정으로 앞 항목의 저장/활성화 차단 정책은 확정됐고 실제 조립기·진단·native enforcement 구현은 남아 있다.
- 후속 잠금 진단에서 root가 지원 catalog lease를 실제 획득·반환했다(exit0, released:true). 잔존 schema2 파일 자체는 잠금 점유 증거가 아니며 삭제하지 않았다. 이어 재개한11은 register1개 성공 후 maintenance.lock 경합으로 중단했다. 경쟁 native 프로세스가 없는 시점에 추가1회 재개한12는 기존 등록 재사용·새 등록1개 성공 후 catalog.lock 경합으로 중단했다. 실패 직후 활동 중인 fc02 PID45100/부모14064(node.exe)가 관찰됐지만 보유자 동일 여부는 확정하지 않았다. 11/12에 실제 결과를 보존했으며 삭제·finalize0,7group 잔존이다. 잠금이 영구 해소 불가능하다는 결론은 없으며 동시 관리 작업과의 반복 경합이 확인된 상태다. 자동 반복 실행은 중단했고 전체 cleanup pending은 유지한다.

### 프로필 조립기 개발 탭 구현·검증

- 승인 범위: 고정 Azrael 지침, 순서 있는 추가 지침, 스킬/MCP 선택 활성화, 기본 프로필 읽기 전용, 개인 사본 편집/복제, 저장만 제공, 오류 저장 허용·적용 차단과 마지막 정상 구성 보존. 기존 domain/UI/계정 선택기를 재사용하고 설치 스킬·MCP는 읽기 전용 metadata로 조회한다. 지침 지원 파일은 선택 시 읽어 초기 전량 스캔을 줄인다.
- Windows Chrome 실제 UI에서 클릭/드래그 추가, 지침 순서, 복제, 기본 읽기 전용, 오류 저장 후 정상 snapshot 유지, 단일 열 반응형과 테마를 확인했다. 최종 자동49/49 및 extension tsc --noEmit 실제exit0. 최초 복제의 template flag 오류를 수정 후 재검증했다. 독립 증거는 13-composer-verification.json.
- 실행은 06:23Z~06:46Z에 걸쳐 수행했다. domain/UI 병렬 소유 후 root 통합; 중간 리소스 스캔과 template 복제 결함으로 좁은 검사를 재실행했다. 전체 elapsed와 겹치는 검사 시간을 합산하지 않는다.
- 당시 live 개발 adapter064601과 사용자 data185715는 사용자 요청에 따라 유지했다. 격리 fixture063532와 이전adapter063436은 supported stop 및 실제exit0. 설치본 변경/전체 빌드는 하지 않았다. Native selected-only 강제는 미구현이며 admission guard로 부적절한 실행을 차단한다. 공통 의미의 Windows 회귀만 검증했고 macOS/Linux는 실행하지 않았다.
- 조립기 검증 정리 완료: current ff01 owner로 지정 disposable9group register/review/apply actual exit0, deleted/remaining:false9건·실제부재9건·finalize9건 확인. 등록 논리 크기1,730,522bytes(물리 회수량 미제공). 종료adapter2개의185715 참조만 supported release했다. 독립 증거14-composer-cleanup.json SHA256 8df105c0b133edb24796de410cd98787b733dd4018426cfa29f242bddb2eabf8;13은 불변. 기존 blocked/uncertain 자료와 recovery는 미변경이며 원래 본체 통합 작업의 cleanup pending 상태는 계속된다.

### 패키지 단위 하단 검색·상세

- 사용자 요청: 하단 라이브러리는 개별 요소 대신 패키지 단위로 표시하며 클릭하면 정보와 내부 구성을 확인한다. 기존 manifest 기반 baseline 개별 discovery를 한 기본 패키지 summary로 묶고 상세에서만 원문을 읽는다. 개인/GitHub 패키지 정체성은 유지한다. 조립기 리소스 선택 ID와 저장 프로필은 유지한다.
- 실행 계획: 기존 domain/catalog/detail과 UI 확장 → 기존 baseline 검사를 패키지 집계/지연읽기/선택ID 보존으로 보강 → Windows Node 검사와 실제 Chrome light/dark/narrow·검색/상세/파일 보기 확인 → 기존 데이터 owner를 유지해 개발 adapter 재시작 → 독립 증거 보존 후 disposable 정리. 공통 브라우저 기능이며 실제 검증은 Windows x64, 다른 OS/native 설치는 미포함이다.
- 중간 검사49/49 actual exit0 후 브라우저에서 새 문자열의 한글 인코딩 손상을 발견했다. PowerShell에서 Node로 보낸 텍스트 파이프가 원인이며, Unicode patch로 수정하고 실제 화면을 다시 검증한다. 같은 파이프로 손상됐던 이 작업 기록의 해당 구간도 복원했다.
- 최종 소스에서 자동49/49 actual exit0 재확인. 실제 Windows Chrome에서 13요소 기본 패키지·기존 개인 패키지, 요소 이름 검색, 포함종류 필터, 펼친 파일 원문, 개인 패키지의 제공 프로필/구성 참조, 밝은·어두운 테마, 좁은 화면 단일 열·가로 넘침 없음 확인. 근거15-package-catalog-verification.json. 검사는 기존 baseline 테스트를 확장했으며, 후속 catalog 변경이 조립기 선택 ID를 바꾸거나 전체 지원 파일을 초기 로딩하는 실수를 막기 위해 유지한다.
- 개발 adapter064601은 supported stop200 및 managed session49086 실제exit0으로 종료했다. 새 live072620(PID51840/session63716)은 기존 사용자 data185715를 그대로 참조하고 상세 화면을 열어둔다. 본체 빌드·설치와 기존 프로필 변경은 하지 않았다. 이번2test+종료adapter1개의 임시 자료 정리는 supported owner에 맡겼고 결과를16에 보존한다. 기존 불확실/보호 자료는 별도 기존 상태 그대로 유지한다.
- 이번 범위의 정리 완료: current perf owner의 실행파일·수용 근거를 확인한 뒤 지정3group register/review/apply actual exit0, deleted/remaining:false·실제부재·finalize 각3건 확인. 논리206,497bytes, 물리 회수량 미제공. 종료064601의185715 참조1개만 해제했고 live072620/data185715/기존 보호 자료는 보존했다. 새 pin의 receipt가 acceptance.json이라는 가정과 달리 work11-performance.json 및 version native-acceptance.json으로 분리돼 있어 최초 조회가 실패했으며, 정확한 SHA 확인 후 같은 범위를 재개했다. 증거16-package-catalog-cleanup.json SHA256 0ff43ee26c374cfe8b3327f274d96395a8ae1e5a72452f1c13a33faf0696a988. 상세 증거15는 불변이다. 패키지 목록 변경의 구현·검증·disposable 정리는 완료했고 원래 본체 통합/보호 자료의 미완료 상태는 별도로 유지한다.

### 통합 프로필·카드 작업

- Team 저장 오류 후속 수정: 실제 개발 API에는 관리형 모델만 보였고 OpenAI 선택 상태가 requiresRecovery여서 nativeAccounts가 연결 계정 목록 전체를 거절하고 있었다. 복구 상태는 selected=false로만 반영하고 정상 연결 계정·인증된 모델 캐시의 읽기 전용 목록은 유지한다. reauth/removed 표시와 malformed metadata 차단은 보존하고 계정 전환·자격 증명·native 실행 권한은 변경하지 않는다. 기존 options 경계 테스트를 실제 metadata 파일·복구 전환·제거/재인증 필터로 확장하여 이후 activation과 inventory를 다시 결합하는 실수를 방지한다. 공통 JS 의미, Windows에서 검증하며 제품 빌드/설치는 수행하지 않는다.
- 후속 결과: 기존 자동76/76 actualexit0, 실제 연결 metadata/cache를 사용한 선택 프로필의 production availability 검증과 새 live API의 gpt-6.1-sol/gpt-6-luna 조회를 확인했다(21 근거). 브라우저 debugger 연결 실패로 작성 중 기존 화면을 새로고침하거나 저장하지 않았으며 사용자에게 이름을 보존한 뒤 reload/retry하도록 안내했다. 실제 사용자 Team 저장 재시도는 미확인이다. test232618·종료server135405 두 group은 supported owner 삭제·부재·finalize 각2 확인(22 근거, 논리4,275,811bytes). 현재 live232737/PID22048과 원본data185715, 기존 승인된 uncertain2는 보존했다. 처음 runner는 외부 catalog ancestor 변경 관찰로 write 전에 실패했고 fresh catalog 정합 확인 후 재실행했으며 guard를 우회하지 않았다.

- 개발 탭 후속 검증: 일반 대화 Root 활성화·lastgood·Team role 격리·snapshot 전송을 포함한 기존 9개 테스트 파일 76/76 actual exit0, extension TypeScript noEmit exit0. Windows Chrome에서 Root-only 장착, 공통 목록의 Team 역할 선택, Direct 설정 제거와 light/dark·좁은 화면을 확인했다. native 변경 26 Rust 파일은 syntax exit0이며 compile/schema/installed acceptance는 미실행이다. 독립 근거는 17/17-delta/19, 화면은 20-root-profile-ui.png.
- 검증·종료 실행 10group은 supported owner로 삭제·실제 부재·finalize를 확인했다(18 근거, 논리25,519,946bytes, 물리 회수량 미제공). 설정 변경과 owner pin 교체 guard는 각각 중단·진단 후 현재 identity로 승인된 범위만 재개했으며 원래 부분 실패 결과를 보존한다. 현재 개발 탭은 hidden background official CLI의 135405 실행과 기존 data185715를 사용한다. 사용자는 이전132246/133358 두 실행 자료를 종료 근거가 복구되어 안전한 정리가 가능할 때까지 보관하도록 명시 승인했다(정확한 경로·질문 ID·재검토 조건은19 근거, 크기 미확정). 종료 결과는 unknown으로 유지하며 삭제 권한으로 해석하지 않는다. 개발 탭 변경의 정리 범위는 이 승인된 보관 예외로 처리하고, 전체 native 반영·실행 수용과 이전 별도 보호 자료는 여전히 미완료다.

- 후속 합의: 프로필 종류를 일반/역할로 나누지 않는다. 일반 대화는 프로젝트별 활성 Root 허용 프로필 하나를 다음 요청부터 사용하고, Team은 같은 목록에서 각 역할에 맞는 프로필을 선택한다. 별도 Direct 공통 설정 화면과 mutation은 제거한다. 기존 Direct child 허용 목록과 저장 원본은 보존하되 과거 Direct root 설정을 프로젝트 구성에 합성하지 않는다. Team/고정 역할 child에는 프로젝트 활성 프로필을 덧붙이지 않는다.
- 실행 분담과 순서: repository owner는 Root admission/lastgood 전환과 기존 Direct 저장 데이터 보존, native owner는 신뢰된 thread/read 모드 projection 및 Team/child의 project ref 차단, root는 공통 UI·host transport·최종 검증을 담당한다. 프로필 내용·권한·수동 모델 선택을 보존하며 이전 provenance gate를 우회하지 않는다. 일반 대화 기존 저장 모델은 출처를 구분할 수 없어 유지하고, 모델을 명시한 프로젝트 프로필만 요청별로 override한다. Windows 검증과 다른 OS/native 미검증을 구분한다.

- 현재 목표/권한: 개발 탭의 일반/역할 프로필을 한 목록과 편집기로 합친다. 사용자 확인으로 같은 구성(지침·스킬·MCP)을 Team/Direct에서도 사용하도록 실행 경로까지 연결한다. 카드 클릭 상세·편집, 더보기 복제/삭제와 삭제 재확인, 원형 프로필 이미지와 4:3 팀 이미지, 기본 프로필 보호를 구현한다. 제품 전체 빌드·설치·게시 권한은 추가되지 않는다.
- 공통 브라우저/프로필 의미이며 Windows x64에서 소스·UI를 확인한다. 지원 대상 Linux/macOS의 실행·설치 수용은 별도다. 기존 일반 프로필/역할 ID, Team/Direct 참조, 고정 팀 복사본과 프로젝트별 활성 snapshot을 보존한다.
- 소유 분할: UI agent는 카드·이미지·삭제 확인만 수행 후 종료, root가 공통 목록/편집과 host 연결을 통합한다. repository agent는 기존 RoleProfileStore를 master로 만들고 Workbench repository CAS/migration을 담당한다. native owner는 optional model 상속과 immutable resource snapshot·selected-only 실행을 담당한다. source 준비 전 비싼 검사를 시작하지 않는다.
- canonical repo는 snapshotLibrary/replaceLibrary CAS를 제공하고 Workbench metadata와 프로필 master를 분리한다. 최초 legacy 원본은 수정 없이 보존하고 새 metadata 파일로 전환한다. profile_extension은 core role identity를 덮어쓰지 않는 resource metadata이며 host-generated snapshot ref를 사용한다. 미선택 model은 caller 설정을 상속한다. 이미지와 저장소 검증은 기존 raster/핀 검증을 재사용한다.
- 완료 조건: 한 프로필 생성·복제·편집 결과가 공통 목록 및 팀 선택지에 일치, 참조 중 삭제 보호, 삭제 취소/확인, 이미지 저장·재조회·fallback, 기본 readonly, 실제 밝은/어두운/좁은 UI 및 관련 Node/TS 검사. Native source enforcement와 실제 native 수용은 구분하며 원래 provenance 결정을 우회하지 않는다. 검사/fixture는 owned run에만 생성하고 현재 사용 종료 즉시 supported owner로 정리한다.
# Direct 공통 설정 복구

## 개발 탭 최신 구현의 Azrael 설치 준비

사용자가 개발 탭 구현의 Azrael 반영을 요청했다. 개발 탭과 기존 사용자 데이터는 유지하고 Windows x64 일반 프로필 설치를 대상으로 한다. 현재 실제 등록 버전은 2026.0.16이며 후보는 2026.0.17로 선택한다. 공통 소스의 다른 플랫폼 실행 수용은 이번 Windows 설치 검증과 구분한다. UI뿐 아니라 native 프로필 실행 계약이 변경되어 기존 엔진 번들 재사용은 미확정이며 정규 빌드·필수 검사·exact-package 수용 후 설치해야 한다.

사전 provenance 관찰은 exit 1: 현재 receipt에 없는 10경로와 별도 작업 변경이 남아 있다. 사용자는 task-memory·잠금 관리 등을 포함한 현재 변경 전체의 포함을 승인했다. 신규 파일의 Git 추적과 명시적 출처 기록을 진행하며 기존 staged 변경은 보존한다. task-memory README를 포함하기 위한 recorder 변경은 직접 crate README 경계만 허용하고 기존 tracking/mode/identity/baseline/exact-delta 검증을 유지한다. 과거 code_mode_dynamic_tools_tests.rs 미추적 문제는 현재 추적된 수정 파일이므로 같은 차단으로 취급하지 않는다. PowerShell WindowsApps 실행기의 7.6.9 실행과 Python3.13, Cargo 경로, 현재 설치의 code-mode host 존재를 확인했으며 최종 호환성 검증은 별도다. 출처 기록과 schema 선행조건을 해결한 후 immutable inputs를 고정해 기존 deployment owner로 실행한다. Native owner는 delta 검토·출처 기록, backend owner는 README 허용 범위·집중 검증, root는 입력 고정·schema 실행 연결·최종 build/install을 담당한다. 새 배포 버전은 2026.0.17로 반영했다.

사용자 정정에 따라 기존 Direct 공통 설정 제거만 복구한다. Root 슬롯은 Root 허용 프로필 하나, Subagent 슬롯은 Subagent 허용 프로필 여러 개를 선택한다. 프로필 통합·이미지·카드·Team 구성은 유지한다. UI, 저장 API와 store, 요청 캡처·적용 및 native Direct 적용 경로를 복구했다. 기존 테스트의 잘못된 Direct 무시 기대값을 수정하고 역할 불일치 거부를 유지하여 향후 통합 과정에서 같은 제거를 반복하지 않도록 한다.

Windows 로컬 개발 탭에서 역할별 선택 목록과 화면을 확인했다. 기존 사용자 탭의 입력은 건드리지 않고 별도 확인 탭을 열었다. 자동 테스트 76개 및 TypeScript noEmit 검사는 exit 0. 개발 서버는 기존 사용자 데이터를 유지하며 재시작했다. 상세 근거는 `23-direct-settings-restoration-verification.json`, 일회성 실행 자료 정리는 후속 `24` 근거가 소유한다. 공통 소스 변경이며 실제 검증 환경은 Windows x64이다.

출처 기록과 정규 protocol/config schema 및 Python SDK 생성물을 반영했다. 고정 엔진 SOURCE SHA는 `3af6c8560eabb1d7b94305f141ad38770124eb376875161ff053e94b5fcf7c7a`이며 상세 실제 종료 결과와 실패 보존은 `26-build-source-preparation-verification.json`이 소유한다. 최종 복사 caller의 동시 HEAD 변경 실패와 별개로 정규 입력 owner 및 독립 입력 검증은 성공했다. 현재 설치본과의 비교에도 미분류 native 변경이 있어 등록된 전체 source/native 회귀 검사를 선택했다. 이는 upstream 전체 테스트 실행을 의미하지 않는다.

첫 배포 `deploy17r1`은 사전 검사에서 `Unregistered UI injector: inject-maintenance-preferences.cjs`로 exit 1이며 제품 빌드·설치 전 중단됐다. 기존 UI injector의 등록 누락만 수정했고 기존 집중 검사 3개가 통과했다. 엔진 변경 없이 정규 script-delta 입력 `artifacts/i17b`와 working `artifacts/w17b`를 발행했다(project SHA `4ce1d251515c84095f13a7b2d6b6a1149f9b40bdb3f167a811a2e8a83e3cc686`). 추가 wrapper 검사는 다음 단계의 UI fixture 준비 전에 실행되어 실패했으므로 그 실패를 보존하고 입력 자체를 독립 검증한다. Native owner는 입력 검증, backend owner는 호환 의존성·UI fixture·maintenance bootstrap 및 최종 사전 검사를 병행하고 root가 후속 배포를 실행한다. 고정 입력의 늦은 다른 작업 변경은 포함하지 않는다.

아직 제품 빌드·native 실행 수용·설치 검증은 완료되지 않았다. 소스 준비 중 종료된 일회성 자료 8그룹 정리는 `27-source-preparation-cleanup.json` 및 diagnostic의 잠금/예약 불확실성 때문에 보존 중이며 우회하지 않는다. 기존 두 실행 자료 보관 승인과 개발 탭·사용자 데이터 유지 결정도 계속 적용한다. 전체 완료는 필수 검증·설치 및 소유자 절차의 정리 또는 필요한 한정 보관 승인 이후다.

사용자의 빌드 중단 요청에 따라 준비 실행의 actual failed/stopped 및 소유 child 부재를 확인했고 제품 빌드·설치는 시작하지 않았다. 이후 사용자가 최신 커밋을 반영하지 않는 고정 소스 빌드에 동의하고 계속 진행하도록 승인했다. 추가 pull·커밋 반영·엔진 재freeze는 하지 않는다. `ready17b2`의 Git discovery `ENOBUFS` 실패는 보존했으며 동일 입력의 `ready17b3` 실제 --list/--check-fixtures는 exit 0(181 files, 62/62 fixtures)이다. 원 transient 원인은 미확정이다.

재개 배포 `deploy17r2`는 actual exit 1로 종료했고 제품 빌드·설치는 시작되지 않았다. 원인은 `engine.shared-engine.fixture-guards`의 Cargo 선택 테스트 기대값 두 곳이 이미 등록된 `azrael_storage::tests::` 첫 검사를 누락한 것이다. 검사 축소 없이 기대목록/첫 실패 후 중단 기대값만 수정한 기존 테스트 파일 전체 56개가 owned fixture에서 통과했다(actual exit 0). 등록 목록 및 이 test-only 수정 2개 override만 포함한 `i17c`/`w17c`를 정규 파생 입력으로 준비하며 엔진 SOURCE는 유지한다. 상세 producer 근거는 `FA-01-cargo-selection-expectations` run이 소유한다.

`i17c`/`w17c`의 정규 입력·독립 검증 및 `ready17c2` 실제 목록/fixture 검증은 통과했다. Manifest SHA `288c5927315cc943836fccd34b121622568478860135e7fa2ad7705ca321eee3`. 배포 `deploy17r3`의 최초 parent wrapper는 중복 참조 ID로 child 시작 전 실패했으며 dedup 후 재실행했다. 그 실행 work `f5b28902-83b5-49fb-9f74-dfccee5767cc`는 실행 관리자에서 cancelled/actual exit 1로 종료됐다. 정확 host-terminal 영수증 SHA `2ec9b3fa1ae7f5edb54d8a91db419718ff514caf06890aafe3a1d63b90afd38b`이며 parent result는 없다. Metrics는 source fixture/environment/dependencies exit 0, source-preflight 종료 미확정이며 제품 build/install은 미시작이다.

취소 영수증은 executor 종료만 증명한다. 실제 installed16 소유 코드와 실행파일 identity를 대조했으나 descendant 보존/root-only fallback 경로 때문에 전체 하위 프로세스 종료를 보장하지 않는다. 현재 matching process 부재만으로 복구하지 않는다. Windows Sysmon 로그는 없고 Security 로그 읽기는 권한 거부되어 역사적 tree 종료 근거도 확보하지 못했다. 따라서 해당 실행/하위 작업을 unknown 보호하고 재빌드·강제 정리·lifecycle 상태 덮어쓰기를 하지 않는다. 취소 원인은 미확정이며 정확 tree 종료 근거 또는 호스트 재시작 등 외부 상태 변경 후 재개한다.

사용자가 이번 배포 소유 프로세스만 식별·종료하고 새로 실행하도록 승인했다. 현재 전체 프로세스의 실행파일·명령줄·생성 시각 및 배포 시작 이후 process/parent identity를 대조했다. 이번 working source/launcher 및 Node·PowerShell·Python·Cargo 실행은 남아 있지 않으며, 살아 있는 Node는 기존 개발 탭/설치된 window-control owner로 식별했다. 종료 대상이 없어 다른 작업은 종료하지 않았다. 이는 취소 실행의 과거 하위 exit code를 복원한 근거는 아니므로 r3 결과와 lifecycle은 그대로 보존한다. 현재 실행 부재를 확인해 동일 `w17c`/manifest/SOURCE로 새 `deploy17r4`를 시작한다. 실행 시작 PID를 독립 `execution-start.json`에 즉시 남기며 최신 커밋 반영·소스 재복사·재freeze는 하지 않는다.

`deploy17r4`는 r3가 소유한 검증 폴더와 충돌해 시작 전 actual exit 1로 종료됐다. 새 검증 폴더 `w17c/artifacts/v-r5`(IPC 경로 100 bytes)를 지정한 `deploy17r5`는 actual exit 1, child PID23344 close 및 parent 종료를 확인했다. 엔진 소스 사전 검사 33개 중 30개가 통과하고 maintenance 관련 3개가 실패했다. 원인은 packaging-workspace의 reviewed closure와 portable packaging fixture에 기존 maintenance-preferences 의존성이 누락된 두 곳 및 fail-fast fixture가 expected rejection을 만들지 못한 한 곳이다. `r5` receipt/로그를 보존하고 backend가 해당 scripts-only 수정과 실제 집중 검증, native owner가 이후 정확 override를 고정 입력에 반영한다. 제품 build/install은 미시작이며 엔진 SOURCE/기존 고정 소스는 유지한다.

관련 packaging fixture 한 곳도 같은 의존성을 제공해야 하므로 수정은 4파일이며 기존 registry/Cargo expectation 2파일과 합쳐 총6개 scripts override다. `fix07` 실제 platform26pass, failfast22pass, packaging-workspace exit0을 수용했고 필요한 준비 실패 근거도 보존했다. 정규 `i17d`/`w17d` 입력과 독립 검증 actual0, manifest SHA `b98b3bd6ae190270c9064b092ba77451ca7ed5032866ef4f5bd98d75df2696be`. `ready17d` 실제 모든 child exit0 및 목록181/fixture62 ready를 확인했다. 첫 streaming Git 출력은 stdout486824/stderr604881 bytes의 대량 LF→CRLF 경고로 1MiB를 넘었으며 이전 ENOBUFS와 부합한다. 이후 정상CLI는 exit0으로 검사 축소 없이 실행됐다. fresh `v-r6`와 같은 엔진 SOURCE로 `deploy17r6` 실행을 시작했다. 새 커밋 반영은 하지 않는다.

종료된 fix01~06 최소 증거는 `28-packaging-fixture-cleanup.json`에 독립 이관했다. 정확 참조 해제 후 첫 등록은 exit0, 다음 등록은 catalog.lock busy/exit1로 중단했다. review/delete/finalize는 실행하지 않았고6그룹을 보호한다. 실제 PID/close 및 결과는 `28-packaging-fixture-cleanup-results.json`에 있으며 옛27 예약과 별도로 보존한다.

`deploy17r6`는 actual exit 1, child PID14204 close를 확인했다. 33검사 중31개 통과, lifecycle source/writers 두 단계에서 synthetic project의 기본관리설정 누락과 native write 응답 timeout이 발생했다. `FA-LE`의 fresh 직렬 source는 actual0이며 제품 timeout은 변경하지 않았다. 두 packaging test와 artifact-check-ownership test의 fixture에 동일 검증된 standalone pin/binary/acceptance를 제공했고, executable만 짧은 contained `m.exe`로 도출해 hash/version/max600000을 보존했다. Windows 긴 Git 경로는 소유 child의 core.longpaths와 짧은 등록 temporary 역할로 해결했으며 전역 설정은 바꾸지 않았다. `FA-LE:w5`는 source 전체0(동일 bytes w3 재사용), writers6명령 전체0, 최종 producer actual0/stopped다. 보고서 SHA `bf081efdafc48ee02e67b95036031ab37bf772f58dc3d7db1207d7e5b6c934f0`. 정확3파일을 primary에 CAS했고 기존6override 중2교체+새1파일, 총7override로 `i17e`/`w17e` 정규입력을 준비한다. 엔진 SOURCE/생산 config/timeout/최신커밋은 변경하지 않는다. 제품 빌드·설치는 아직 미시작이다.

`i17e`/`w17e` 정규입력·독립 검증 actual0, manifest SHA `44921bbb27d8969fbcbdc7e0a81fdc73c19bf8352b660e597e288f1c4805e3fe` 및 `ready17e` 모든 명령 actual0/목록181/fixture62 ready를 수용했다. 소비 환경은 child Git longpaths/Python313/WindowsApps를 실제 확인했고 기본 maintenance max600000을 유지한다. `deploy17r7`은 fresh `v-r7`로 같은 고정 엔진 및 검증된7override를 사용하며 새 커밋은 반영하지 않는다. 실행 기록은 해당 ownrun이 소유한다.

`deploy17r7`은 actual exit 1/child5744 close로 종료됐다. 33개 중32개 통과, 유일 실패는 source 단계의 platform fixture에서 native write 응답 timeout 및 stale revision이다. 동일 source 전체와 writers6명령의 직렬 검증은 이미 통과했으므로 제품 timeout이나 검사 목록을 바꾸지 않고 기존 feature-preservation의 sourceConcurrency를 배포명령에서 선택하게 했다. PS1의 추가3줄 `SourceCheckConcurrency`(1..4/default4)와 두 config 전달을 PS7 실제 parser/binder/config 실행 및 기존3검사 actual0으로 확인했다. PS1 SHA `bc394c496992762be8bffead3271e8da163a2b9619e4db55a75ee50ad5e2e196`. 다음 배포는 SourceCheckConcurrency=1, SourceTestConcurrency=2이며, 기존7+PS1의8override만 정규 `i17f`/`w17f`에 반영한다. 운영문서의 옵션 설명은 primary에 유지하되 고정 빌드 입력에 추가 선택하지 않는다. 새 커밋/엔진/SOURCE 변경은 없다.

`i17f`/`w17f` 정규 입력·독립 검증 actual0, manifest SHA `0114ce9f85546a746beedb099af30bc3357b9ef15c2801a25e9f3987d5536c23`와 `ready17f` 실제 모든 명령0/목록181/fixture62를 수용했다. `deploy17r8`을 fresh `v-r8`, SourceCheckConcurrency=1/SourceTestConcurrency=2로 시작했다. 정확한 source selection과 child 실행 identity는 해당 ownrun의 selection/execution-start에 보존한다.

`deploy17r8`도 actual exit 1/child21260 close로 종료됐다. 직렬 25개 통과 후 lifecycle source의 destination-missing fixture가 native write_record 응답 timeout으로 실패했다. 병렬 실행만의 문제라는 가설을 정정한다. 실제 installed owner source identity를 대조했으나 기존 로그는 요청 native 도달·commit·응답 및 종료 단계 시각이 없어 원인을 판정하지 못했다. 실패 fixture는 기존 테스트 t.after가 제거했고 작업자가 별도 삭제하지 않았다. 원본 실행/fixture의 불확실한 종료를 성공으로 바꾸지 않는다. 새 짧은 owned 진단 복사본에서 해당1case의 parent/worker/stdin/stdout/nativeexit/workerexit 시각과 실패fixture를 보존해1회관찰하도록 승인했다. 생산 소스/timeout/실행기는 변경하지 않으며 제품 빌드·설치는 계속 미시작이다.

`FA-IPC:d1` singlecase는 actual0/미재현(write_record6건34~47ms)이며 해결 근거로 쓰지 않는다. 원래 Node219의 연속 맥락을 계측한 `d2`는 actual1로 같은 timeout을 재현했다. 해당 native PID32404 생성세대의 요청 stdin 쓰기 완료는11:48:25.136Z, timeout은35.150Z이며 요청 reader revision1은54.641Z에 완전히 publish돼 요청 약29.5초 뒤의 late commit을 확인했다. 메시지 미전달 가설은 해당 사례에서 배제되지만 정확 syscall 지연 위치는 미확인이다. 전체219의214pass/4fail/1skip에는 timeout관련2fail 외 진단 fixture 준비누락2건이 있어 전체 통과 근거로 쓰지 않는다. d1/d2 raw IPC/fixture는 현재 원인조사에 필요해 보존하며 조사 종료 후 supported 정리 대상이다. 현재권한의 PID 한정 OS I/O 관측 가능성과 별도계측 native 대안만 읽기 조사한다. trace/관리자승격/실행기 교체/timeout변경은 아직 승인하지 않았다.

현재 토큰에는 관리자/Performance Log Users/SeSystemProfilePrivilege가 없고 설치된 CLI의 file/pipe I/O 수집 전 PID 한정 기능을 확인하지 못해 OS trace를 시작하지 않았다. 대신 원 f17의 owned 진단입력에서 pinned 원본과 동일 lease.rs의 단계별 stderr begin/end timing만 추가하는 별도 maintenance_owner 컴파일을 승인했다. 기존 Cargo owner/단일 shared target/jobs2와 실제 identity를 사용하며 생산pin/원본/timeout은 바꾸지 않는다. 진단binary는 명시된 진단fixture에만 hash-bound 사용하고 제품 배포에는 선택하지 않는다. 컴파일 후 준비 누락을 보완한 원래219 맥락을1회만 관찰해 실제 지연 단계를 확인하며 성공만으로 원인 해결을 주장하지 않는다.


## 잠금 응답 지연 수정

사용자 요청에 따라 r9 재시도 실패 후 잠금 transport를 수정한다. r9 actual exit 1, source checks 24 pass/1 fail/8 blocked이며 실제 제품 빌드·설치는 미시작이다. 실패는 write_record 요청 응답 10초 만료이고 이전 진단에서는 약29초 뒤 publish를 관측했다. 공통 JS 경로 수정, Windows x64 실검증 대상이며 Unix 실검증은 별도다. native wire·CAS·권한·durability·예약·복구 보호는 유지한다. 일반 응답 예산을 기존 예약 요청과 동일한60초로 두고, 한도 초과 시 stdin EOF 후 bounded grace/실제 child close를 관측한다. 늦은 응답을 자동 재실행하지 않고 원래 오류·실제 종료·불명확한 결과를 구분한다. 검증은 기존 real-process lease regression에 10초 초과 응답 및 timeout 종료 관측을 최소 추가하고, 실제 lifecycle source/adapter를 재실행한다. frozen f17/i17f/w17f는 변경하지 않으며 검증된 script delta만 후속 고정 입력에 별도로 선택한다. root는 계약·통합·문서, workbench_backend는 transport 조사·할당 후 구현을 소유한다. 추가 native build는 필요성이 확인될 때만 수행한다.


검증된 transport 변경은 owner c3ac05…19bf2, worker eed516…ebf54, test b940ff…0241의 3파일이다. FA-LR:r1은 실제 exit 1(306 pass/1 fail)이며 lease 실제 프로세스 14검사와 lifecycle 검사는 통과했다. 유일한 primary selection 실패는 이후 고정 w17h에서 재현되지 않았다. FA-LR:r2는 실제 exit 0으로 61초 늦은 ACK의 단일 commit/실제 close 0 및 EOF를 무시하는 소유 child의 제한된 종료/실제 SIGTERM close를 관측했다. timeout 결과를 성공으로 바꾸거나 요청을 재전송하지 않았다. r1/r2 결과 SHA는 각각 3905f5bb1b0c8b91481e7c5846ed3482838cc65ca2c5d760b22c29102482d582, 232dbfaa0844ca793a729ac47a431dc447906f5b8733217e7792531fac56f032이다.

이전 i17g/w17g 생성은 manifest/종료 결과가 끊겨 unknown 보호를 유지했다. controller47264 및 source-copy 하위 실행의 현재 종료 근거를 따로 보존하고, 원 f17의 동일 11개 override를 새 retry17h에서 준비했다. retry17h 정규 입력/독립 검증 실제 0, manifest SHA764bdb6b414869eb853a1a7a311e1af924d07836193373fd2633ee4cd9925f15이며 엔진 SOURCE3af6c8560eabb1d7b94305f141ad38770124eb376875161ff053e94b5fcf7c7a는 불변이다. ready17h 실제 0: 호환 deps2/UI40/pin4 복사, TS5.9.3, 기본 maintenance max600000, fixture62 및 정상 목록/fixture CLI를 확인했다.

deploy17r10의 engine-source-preflight는 실제 exit 0/33개 모두 통과했다. receipt는 artifacts/w17h/artifacts/logs/deploy-fa17-20261103-r10/engine-source-preflight/preservation-SZTwLO/receipt.json, SHA bc183aeea6937f45adf97ba241592d0426fad05981ba295dfd2822edc7702088이다. adapter309개와 lifecycle source/writers가 모두 통과했으며 잠금 timeout은 재현되지 않았다. 이후 전체 source-tests는 2527개 중2499 pass/19 fail/9 skip, 실제 exit 1(2026-11-03T14:54:13Z)로 종료됐다. 병행 제품 컴파일은 취소되었고 package/install은 실행하지 않았다.

19개 실패는 선택된 Cargo wrapper/recipe 기대값, task-memory root binding, 5초 contention fixture, stable fixture의 실제 의존성/pin, VM queueMicrotask, UI asset 하나, workbench fixture 환경변수 및 UI cache-owner metadata 누락으로 분류했다. run:FA-LR:r10-regression-inputs의 정확12개 수정은 원 w17h 기준이며, storage 검사 유지와 registration 검사 추가를 포함한다. 문법/manifest 검증은 실제0, 동작 검증은 아직 미완료다. selection SHA38670b9b1edae11f814b9960f39bee005e43064ad893a55cc0ac2e468d78aa95. 원 f17 + 종전11개와 합친 정확20개 override를 retry17i(work0dd5e6e2-38aa-421d-8772-4e226c051f29/session84134)에서 준비 중이다. 최신 primary commit은 선택하지 않는다.

통합: baseline과 일치하는 primary9개 파일에는 정확 patch를 반영했다. source-test-fixtures/test-source-test-fixtures 및 feature manifest3개는 다른 작업의 현재 변경을 유지하며 필요한 행/필드만 병합했다. primary CJS10개 syntax 실제0. 고정 candidate의 집중 동작 검증과 전체 필수 검증은 계속 필요하다. 다음 readiness는 w17h의 호환 closure를 재사용하고 pinned virtualized-turn-list asset1개 및 fresh AZRAEL_WORKBENCH_TEST_ROOT를 추가한다.

r10 Cargo 실제 종료코드는 복구되지 않았고 shared96 lifecycle/target owner는 pending 보호다. 현재 cargo/rustc/link 부재만으로 결과를 바꾸거나 캐시를 재사용하지 않는다. 다음 제품 빌드는 별도의 소유된 fresh Cargo target/verification cache를 선택하며 ch17의 검증된 offline dependency home만 소비한다. 설치된2026.0.16과 개발 탭/프로필 데이터는 유지한다. 최종 빌드/정확 package 검증/설치/사용자 확인/소유자 기반 정리는 미완료다.

ready17i는 executor cancelled/actual1이며 준비 report는 copies1/calls0/readyfalse에서 멈췄다. source-before20개와 manifest는 그대로다. controller47084 및 direct-child 부재와 copyTree의 동기 fs-only 구현을 확인했으며 이전 종료 결과는 성공으로 바꾸지 않는다. ready17i2는 새 소유 run에서 정확한 기존 경로를 확인하고, 완료된 extension 복사를 재사용하며 partial provider 복사만 정상 copyTree로 완성한다. 다른 기존 목적지는 거부하고 기존 취소 run의 근거를 별도 reports/prior-stop-observation.json에 보존한다. workde222a05-6a71-4061-9943-67f81a0f513b/session34597. 제품 빌드·설치는 아직 재개하지 않았다.

ready17i2는 실제 exit0/stopped로 완료됐다. 47개 복사(deps2/UI41/pin4), 모든 실제 도구·기본 resolver·manifest·목록/fixture 명령0, sourceUnchanged true다. 사용자 렉/VS Code 종료 질문에 따라 새 고부하 실행 전 host를 읽기 진단했다. 2026-11-04 00:43 KST 순간값: RAM31.92GiB/free12.48GiB, commit29.44/79.92GiB, CPU23%, C드라이브 약20MB/s. 이 순간값은 이전 부하 정점의 근거가 아니다. Crashpad f2daed9e-3739-4034-97c3-007ce4bc908e.dmp(11-03 16:02KST)의 exception0xe0000008은 Chromium OOM 코드다. f39ab856-b884-4fc5-9b55-0ae31ce953ae.dmp(11-02 16:33KST)는 exception0xc0000005/VS Code 내 @parcel/watcher의 watcher.node offset0xeff6이다. 원본 사용자 덤프는 읽기만 했고 복사/변경하지 않았다. 여러 창의 extension-host unresponsive 로그도 확인했다. 빌드의 대량 파일 I/O/파일감시/병행 컴파일과 연결 가능성이 있지만 직접 인과관계·최종 allocation stack은 미확인이다. 프로젝트 .vscode/settings.json은 없으며 사용자 settings에서 관련 watcherExclude 키를 찾지 못했다. 설정은 변경하지 않았다. 집중11파일 및 제품 재빌드는 아직 미시작이다.

사용자 승인: 빌드 중 가용 RAM4GiB를 새 작업 시작 조건으로만 추가한다. 경고 단계/커밋 한도/기존 작업 중단은 추가하지 않는다. 공통 Node os.freemem 기반 helper를 배포/빌드 명령, platform build, feature 검사, project runner 및 managed Cargo(소유권 취득 전과 소스 준비 후)에 연결했다. 2초 polling, 4GiB 이상 시작, 측정 실패는 시작 차단, 대기/회복 stderr 기록이다. 공통 소스지만 실제 검증은 Windows x64, Linux/macOS는 미검증이다. 기존 worker/thread 내부 scheduling 및 메모리 예약은 범위 밖이다. retention: 시작 조건을 timeout으로 바꾸거나 경계값을 잘못 처리하는 추후 수정 방지를 위해 helper 단위3검사 및 기존 runner/PowerShell 실제 명령 차단 경계 검사를 최소 유지한다. helper가 새 파일이므로 기존 script-delta가 아닌 원 f17에 정확 변경을 적용한 전체 입력 준비가 후속 빌드에 필요하며 최신 primary commit은 선택하지 않는다. 현 기존고정후보 i17i/w17i와 엔진은 변경하지 않는다.

RAM 조건 검증: FA-RAM-01:r1은 입력 불변/실제1, Node104개 중91pass/12fail/1skip이며 실패12개는 새 helper가 빠진 cache fixture 준비누락이었다. r2는 helper3개와 cache중20개가 통과하고 primary cargo-verification의 check-find-names 등록(ce6657…)이 기존 audit allowlist에 없어1개 실패했다. 이 다른 작업의 등록을 새 빌드에 채택하거나 guard를 완화하지 않았다. r3는 선택된 i17i의 cargo-verification a734dae…를 유지한 집중 사본으로24개 모두pass, PowerShell metrics/새 명령 차단19개 모두pass, manifest검증0/producer actual0/sourceUnchanged true다. 결과 artifacts/tasks/FA-RAM-01/runs/r3/reports/result.json. 임시 집중 사본은 full source/deployment 증거가 아니며 캐시 단위검사에 사용했다. 실제 제품 입력의 feature-preservation/build-platform은 원 i17i에서 메모리 행만 적용해 다른 작업의 window settings/find-names 변경을 제외한다.
새 helper/test 추가는 기존 파일 교체 전용 delta API 범위를 넘으므로 정상 full prepare를 선택했다. 기존 원본 f17/project에 정확31개 override(앞선20개와 승인된 메모리 변경·최소 fixture/owner contract)를 적용한 retry17j는 실제 exit0으로 완료됐다. engine/SOURCE SHA3af6…f7c7a는 불변이며 최신 primary HEAD를 가져오지 않았다. manifest SHA97fdac38450d48563f885ce091f1802660f04224322977a5fedbb840a8b6208f, input/workspace:7abef720ae1ec9ed9e4c55ed다. workcece9ad4-6e36-4b34-8a85-ffefdbc3cfeb/session21175. 준비 자체도4GiB 시작 조건을 사용했다. 검증 raw자료는 이 입력/검증 handoff 소비 중이며 완료 후 최소 근거 이관과 지원 owner 정리가 필요하다.

ready17j는 실제 exit0으로 완료됐다(worke1dcc0c9-1b8e-4628-9fa8-9e338817ba41/session53350). 호환 deps2/UI41/pin4 복사, 실제 도구·resolver·manifest·정상 목록/fixture CLI가 모두0이며 fixture64 ready/sourceUnchanged true다. environment SHA221780762e45bf10771cd37302b7838addf40ac683eba0ec30516791f91cc400. 전체 source group에 포함되지 않는 ignored UI/pin/fixture 경로는 work:FA-01-final-source-readiness:ready17j-overlays에 별도 등록하고 실제 종료로 닫았다. downstream 소비 참조는 유지한다. 집중11파일 runner 첫 준비는 reference reason 누락으로 등록 전에 actual1로 중단됐으며 테스트/출력은 생성되지 않았다(work93b01f7f-ff69-4eb5-901d-4241ffb15c3c). 정규 reference shape로 바로잡은 focused17j(work917e7b55-db04-4e54-9edd-00eda0b77063/session41652)는 짧은 소유 temporary artifacts/frJ에서 실행 중이다. 통과 후 deploy17r11은 이전96c960 unknown target을 재사용하지 않고 w17j에 새 Cargo build/verification owner를 선택한다. 실제 필수 제품 빌드·설치·정리는 계속 남아 있다.

focused17j actual1/stopped/sourceUnchanged: 162개 중155pass/7fail, 54.6초다. 다섯 recovery 실패는 새 launcher의 artifacts/frJ 임시 경로가 선택 helper의 w17j/artifacts 외부여서 생긴 준비 오류다. guard를 바꾸지 않고 다음 임시 소유 경로를 선택 workspace/artifacts/frK로 제한한다. 다른 두 실패는 추가된 virtualized-turn-list UI closure의 테스트 예상값 누락이다. primary의 다른 변경은 보존하면서 해당 기대값 두 군데만 갱신했고, 고정 J의 동일 테스트 한 파일에 같은 두 수정을 적용한 supported script-delta retry17k를 시작했다(work00864249-97bf-4655-9396-aeb02537b5a6/session62655). J source/엔진을 수정하거나 전체 원본을 다시 동결하지 않는다. 새 i17k/w17k가 실제 독립검증0으로 준비되면 J의 호환 deps/UI/pin을 연결하고 이 두 파일의 실패 경계를 우선 재검증한다. 아직 제품 컴파일/설치는 시작하지 않았다.

retry17k 정규 준비와 독립검증은 actual0으로 완료됐다. manifest SHAb1272713a13cd1337094ee04554319ad05dde3c78fdc307cf3f13a2acb62d4ba, project SHA ddd45e34a0536dfff520b37a4ee1528a485018f83dfc514d8b9c3e69dd9def41, input/workspace:b504dcf4b7cb6d63e3949506. J에서 scripts/test-source-test-fixtures.cjs 한 파일만 바뀌었으며 SHA919e2039a7b6c2873830ddd779dad39a5876ef3bbdfe123a63b0dff2300fe05d다. ready17k는 실제0의 J closure를 원본으로 사용해 준비 중이다(work29b5112c-966b-49cd-9bd4-dab3eee15593/session31922). 이후 이미155개 통과한 무변경 경계는 재사용하고 target-owner/source-test-fixtures 두 파일을 올바른 workspace 내부 임시 경로로 다시 실행한다. 그 결과가0일 때 deploy17r11의 새 Cargo owner/필수 전체 gate를 시작한다.

ready17k actual0/sourceUnchanged/fixture64 ready, environment SHA071abddda0926f1655c509be1d6114e56ebdde114e81c18071ee7c2d628055c1. focused17k(work9351c3e2-034b-4471-a24f-288654f5b106/session78585)는38개 중37pass/1fail: 이전7개는 모두 통과했고 real contention case만31.5초 뒤 빈 stderr로 실패했다. 해당 case의 second spawnSync 제한20초가 의심되지만 실제 raw timeout metadata를 테스트가 보존하지 않아 원인은 미확정이다. 관련 실행 프로세스 부재를 관측한 뒤 조건/제한/소스 변경 없이 fresh frK2에서 이 case만 재실행했다. focused17k2(work9eac9766-2654-4690-835d-8029765bb723/session85304)는 actual0/1pass/0fail/351ms, sourceUnchanged다. 앞선 실패는 보존하고 새 결과와37개 및 무변경155개 결과를 함께 다음 build 입력으로 사용한다. 필수 전체 source gate는 생략하지 않는다.

deploy17r11 시작: work111a611c-050e-4f07-948f-e1cb21d9d485/session23880, controller11560/pwsh25208, 2026-11-03T17:47:10Z. 선택은 K manifest b127…d4ba, release fa17-20261104-r11/HostVersion2026.0.17/FullRegression=true/SourceCheckConcurrency1/SourceTestConcurrency2/Cargo jobs2다. Cargo build와 verification owner는 w17k, module/namespace owner는 원 primary다. 이전96c960 target은 불명 보호 유지하며 선택하지 않았다. 명령 시작4GiB admission이 실행되고 현재 입력은 실행 중 불변이다. focused raw/temporary 묶음은 실제 active deploy caller 및 K source 입력의 evidence 참조로 보호되어 있으며, caller 종료 후 필요한 최소 결과를 독립 이관하고 정확 참조를 해제한 뒤 정리한다. 실행 중 caller lifecycle revision을 외부에서 변경해 종료 CAS를 깨뜨리지 않는다. 제품 전체 결과와 설치는 아직 미확정이다.

r11 첫 체크포인트: source-fixtures/environment-preflight/verification-dependencies actual0, engine-source-preflight31개 모두 actual0. receipt는 w17k/artifacts/logs/deploy-fa17-20261104-r11/engine-source-preflight/preservation-7SezbW/receipt.json이다. source-tests와 build는 2026-11-03T18:00:03Z에 시작됐으며 아직 terminal이 아니다. 새 물리 target은 w17k/artifacts/cache/cargo/96c960…/target으로, 같은 내용 키이지만 primary의 보호된 이전 target과 다른 경로/소유다. 순간 가용RAM11.85GiB. 활성 build/source 외부 로그 두 개는 writer가 공유 읽기를 허용하지 않아 읽기에 실패했으며 검사 결과를 추측하지 않았다. 현재 metrics의 실제 관측만 사용한다.

r11 actual wrapper1, 제품 Cargo는 실제101/observed-terminal(18:15:10Z)이다. 원인은 blake3-1.8.2의 ml64.exe MASM A1009 line too long이며 출력경로264자다. source-tests는 Kill(true)/실제 close 후 -1/terminated로 기록됐으며 passing 근거가 아니다. package/install은 미실행이다. 현재 관련 w17k/r11 명령을 가진 프로세스는 관측되지 않았지만 불명인 내부 outcome은 원래 보호대로 보존한다. 기존 primary96cache는 여전히 건드리지 않았다.

Windows path 준비: 기존 build/deploy의 명시 EngineTargetDirectory 옵션은 shared-cache 선택을 생략하고 frozen source를 직접 사용하면서 같은 managed target lease·4GiB admission·full source 전후 검증을 유지한다. 따라서 root/artifacts/t17을 새 r12 outputs 역할로 선등록하여 사용한다. 내용키를 임의 변경하거나 컴파일 옵션을 바꾸지 않는다. CargoVerificationCacheProjectRoot는 K에 유지하고 target만 짧게 선택한다. source 모드 변경은 existing explicit legacy target의 지원 경로이며 SOURCE provenance를 우회하지 않는다. 짧은 경로 실제 사전검사 run:FA-01-windows-build-path:masm17(workf212b4cd-3e5b-4bad-a74c-b02af5736ab8/session60518)는 동일 ml64.exe/-Zi/-c/blake3_sse41 파일로170자 출력 .o 생성/actual0을 확인했다. 원 r11 실패는 보존한다. r12는 동일 K source와 필수 전체 gate를 유지한다.

r12 실행: work4364d4f6-dc4d-4f16-aecf-b45a4e53bf5e/session55803, controller56288/pwsh41024, 2026-11-03T18:20:23Z. 새 primary artifacts/t17은 r12 outputs로 선등록하고 생성/보호 metadata를 같은 live run handle에서 갱신했다. 긴 shared target 대신 explicit frozen mode를 사용하며 old96/r11 target은 선택하지 않는다.

masm17 사용 종료 정리: 최소 결과를 35-short-path-probe.json(SHA84ca2dda1d8ac0f731d9e5995c331f0150c3f1eb166df5432ad97f26a4ca60f3)에 독립 이관했다. 현재 c0cf7… standalone/acceptance hash 검증 후 정규 등록/review actual0. 그룹은2멤버/33,345바이트이며 artifacts/ma17이 configured roots 밖이어서 보호됐다. ma17만 허용목록에 추가한 fresh review도 관리 root 자체 보호로 차단됐다(work1c00f1bf-7f1a-4494-b2b3-077c848786cf actual1). apply/delete/finalize는0회다. 추가했던 config 한 항목은 되돌렸고 guard를 우회하지 않았다. 두 경로 artifacts/ma17 및 artifacts/tasks/FA-01-windows-build-path/runs/masm17은 보존, 정리 미완료다. 36-short-path-cleanup.json에 실패를 보존했다. 완료 전 지원 owner 처리 또는 정확한 사용자 보관 승인이 필요하다. 다른 caller/source group은 active r12 소비로 계속 보호된다.

r12 체크포인트(18:39Z 부근): source-fixtures/environment/dependency actual0, engine-source-preflight31 actual0(18:32:24Z). source-tests와 build는18:32:25Z 시작해 실행 중이며 target은 정확 primary/artifacts/t17이다. 실제 engine.log에 Rust dependency compilation 진행이 확인됐고 현재 순간 가용RAM8.38GiB다. final source/native/product/package/install 결과는 아직 없다.

r12 actual wrapper1: source Node 그룹2532개 중2522pass/1fail/9skip, 실제1(18:54:18Z)이며 이후 다른 command groups는 fail-fast로 미실행됐다. 유일한 실패는 scripts/test-pipeline-preservation.cjs:103의 synthetic helper 목록에 build-resource-admission.cjs가 없어 realpath ENOENT가 생긴 fixture 누락이다. 제품 컴파일은 그 시점 Kill(true)/actual -1/terminated로 취소됐고 마지막 로그는 의존성 컴파일이다. 짧은 경로에서 이전 MASM 에러는 관측되지 않았으나 제품 build pass로 주장하지 않는다. t17의 불명 owner 결과는 보호하며 다음 컴파일에 재사용하지 않는다.

수정은 primary pipeline fixture helper 목록 한 항목만 추가했다. 명시적 Cargo helper fixture 목록도 좁게 대조했다. retry17l은 정규 complete J baseline에서 K의 UI 예상 목록 수정과 pipeline helper 추가 두 기존 script override를 재구성한다. script-delta를 또다른 delta에 연결하지 않으며 엔진/최신 primary commit은 변경하지 않는다. work9f224764-fe61-4d37-8810-2a27a11659e6/session7858. 새 컴파일 전에 고정 L의 pipeline 집중검증과 실제 full source 실행을 먼저 끝내 불필요한 compile 취소를 줄인다. 필수 최종 deployment gate는 유지한다. 다음 explicit target은 관리 루트 artifacts/cache의 하위 artifacts/cache/t18처럼 짧으면서 정리 가능한 기존 경계를 선택한다.

retry17l actual0/독립검증 완료. manifest SHA3ca3238e892367ad1655f79017794621dc48863a02dd0406e9cfe8c7a51f07c6, project66b9629256cbbaa655fb4fbd0ee2dbdd3652c34c90184ba08145f60437cfd4a2, input/workspace:cabea57a7d758fa0739e2580. pipeline test SHA0af57382a0efc67dc90253bf515f825a8fb5c4012e6ff6df9db363855a709af7. 복사/검증 중 write_record 지연 진단이 있었지만 실패 없이 끝났다. ready17l은 work45423fd0-b403-4874-b8d9-d166d81c2936/session84015로 시작했다. sourceOnly17l 실행기는 환경/입력 guard·4GiB admission·짧은 소유 temporary를 준비하고 pipeline 파일 집중검증 후 정상 test-project current/standalone 전체실행, 마지막 전체 working/immutable 검증을 하도록 준비했다. readiness 전에는 실행하지 않는다. 기존 canceled t17/96 target을 재사용하는 env는 명시 제거한다.

ready17l actual0/fixture64 ready/sourceUnchanged, environment SHAd6c976de7e08b18367b8e87b5e519119fb1a12ea462cd09c7ab1ba005d99c57a. source17l은 work46b18958-a344-436f-97b5-8677ecf0e315/session38384로 시작했다(19:39:17Z). 짧은 temporary w17l/artifacts/vs를 같은 run의 생성·보호가 확인된 role로 선등록했다. pipeline test를 먼저 실행하고 통과할 때 정상 CLI --area current --area standalone --defer-preservation-cache-owner --test-concurrency 2를 실행한다. 모든 command actual close와 최종 정규 input verification이0이어야 다음 deploy17r13을 시작한다. r13 준비 recipe는 source17l의 실제 결과 경로/상태/입력 SHA를 검증하며, 짧은 artifacts/cache/t18을 기존 managed root의 하위 outputs로 선택한다. 아직 새 제품 컴파일은 시작하지 않았다.

source17l actual1/stopped: pipeline9개 모두pass, normal source Node2531개 중2517pass/5fail/9skip다. 네 실패는 직접 source-only launcher가 readiness의 부분 UI41 사본을 AZRAEL_PRESERVATION_UI_ROOT로 사용해 생긴 누락(card/query/rolldown-runtime/index.html)이다. 기존 정상 deployment는 primary의 고정26.1007.21434 UI 전체 원본을 사용했으므로 이 환경 차이를 바로잡는다. 나머지 native instructionService1개는 accepted16 app-server --strict-config 실행 실패/remote-control shutdown warning이며 정확한 signal/timeout 원인은 아직 미확정이다. 원 실패와 로그를 유지하고 조건·제한·코드 변경 없이 affected files를 한 번 재검증한다.

source17l2(workdd0f6cba-dbed-4b09-8d4b-4a1f5c98f9e4)는 동일 L 소스와 정상 배포의 primary 고정 UI 경로를 사용한다. 누락됐던 네 UI 파일은 실제 byte SHA를 시작/종료에 고정하며 source 전체도 정규 verifyDeploymentWorkspace로 실행 전후 확인한다. 새로운 코드/다운로드/최신 commit은 없다. 임시 경로는 새 w17l/artifacts/v2. 네 관련 파일이 통과한 뒤 정상 full source를 실행하고, 이 결과가 통과하기 전 제품 컴파일은 하지 않는다.

후속 경계 준비 대조: scripts/test-deploy-azrael.ps1은 실제 deploy script를 synthetic scripts에 복사하지만 새 Start-OwnedCommand의 build-resource-admission.cjs를 복사하지 않는 것이 확인됐다. Node source 그룹 실패로 이전 전체 실행에서는 이 PowerShell command group에 도달하지 않았다. primary 해당 fixture의 Copy-Item 한 행을 추가했고 build-module-cache/build-platform 및 packaging 관련 명시 목록도 좁게 대조했다. 실행 중 L 입력은 변경하지 않는다. 기존 J complete baseline의 UI 예상 목록/pipeline helper/deploy helper 세 기존 테스트 override로 구성할 retry17m recipe를 준비만 했다. source17l2를 실행 중인 호스트의 대량 복사와 겹치지 않도록 아직 시작하지 않았다. 남은 실제 검증 결과를 먼저 확인하고 영향받지 않는 결과를 재사용할 범위를 결정한다.

source17l2 첫 체크포인트: 정규 L 전체 입력 시작 검증 verified. affected-fixtures 네 파일42개 모두pass/0fail(actual0/68.9초), 이전 instructionService native 설정 검증도 같은 코드·제한으로 통과했다. 일시적 지연이라고 확정하지 않고 원 실패를 보존한다. 정상 full source는20:03:48Z에 시작해 실행 중이며 컴파일은 없다.

source17l2 actual0/stopped/실행 전후 정규 입력 검증 verified 및 추가 UI4 byte 불변이다. 정상 current+standalone 선택은 Node2531개(2522pass/9skip/0fail,977초)와 extension274개(274pass/0fail,37초)로 두 command group 모두0이다. 원 배포 r12의 source runner는 이에 더해 --changed 인자로 build area의7개 명령을 선택했으나 이전 Node 실패로 모두 미실행됐다. 따라서 이 차이를 명확히 구분하며 Node/extension 통과를 전체 배포 수용 완료로 주장하지 않는다. 다음 M 입력은 테스트 세 파일 override이며 L에 비해 test-deploy-azrael.ps1의 helper 복사 한 행만 추가한다. 같은 J baseline와 나머지 두 override SHA가 같음을 확인해 영향 없는 Node/extension 결과는 재사용하고, M에서 정상 --area build의7개 command group을 실제 실행한 뒤 제품 컴파일을 시작한다. 최종 배포의 원래 전체9개 source command 및 native/package/install gate는 유지한다.

retry17m 시작: workf46a31fc-72af-4d6e-b140-24ce3a988023/session98441. ready17m 및 build17m 실행 recipe를 준비했다. build17m은 동일 J baseline/engine/이전 두 override hash, L 대비 PS helper Copy-Item 한 행만 다름을 확인하고 기존 Node+extension 결과를 precompiler 근거로 재사용한다. 정규 CLI --area build --collect-failures --test-concurrency 2로 나머지7개 명령을 검사하며 raw 전체 배포 gate를 대체하는 캐시 영수증을 만들지 않는다. 실제 M 소스 준비 완료/환경 readiness 전에는 실행하지 않는다. 제품 컴파일은 여전히 미시작이다.

retry17m actual0/독립검증 완료. manifest SHA844cdd12b4deef5585b3c8380c19cd06db9f2d6c7016b477a589dc8399beca2c, projectcd3d4fe92659ae2c00ab17428696143a5dcd62aeeaf41a28fcec1f0dc9f6579a, input/workspace:c2b952303837c2d3be6fe749. test-deploy-azrael.ps1 SHA f55389143d4863772e243218ec5c16dbb49b4c20ce0c4ec18dbf31655a29d696, 나머지 두 fixture SHA는 L과 같다. ready17m 시작 work6d623b34-d3af-4a35-af1b-a7a700f68b20/session71192. 다음 build-area acceptance 실제7개가0이어야 준비된 deploy17r13M을 시작한다. 기존 Node/extension 결과와 이 결과를 연결하지만 최종 deployment의 전체 명령 선택/실행은 바꾸지 않는다.

ready17m actual0/stopped/sourceUnchanged/fixture64 ready, environment SHA25e3480137e66dfaaab037759c048b70ad05460481b8206ab55080355df3c100. build17m은 work90d59634-78ed-45ba-ba1c-802c81d8a376/session54342로 시작했다. M 정규 입력과 기존 L 결과의 재사용 범위를 확인한 뒤 build area 7개를 실행한다. 실행 전 4GiB admission을 유지하며 제품 컴파일은 아직 시작하지 않는다. 완료 이벤트 또는 10분 체크포인트에서 실제 결과를 확인하고, 통과 시 정확 M 기반 deploy17r13M으로 인계한다.

build17m actual1/stopped: 7개 중 metrics/input-snapshot/incremental-extension/ordered-asset/verification-state 5개 actual0, module-cache/deploy 2개 actual1이다. module-cache는 선택 시 이전 unused key 삭제 assertion 실패이며 cleanup reason이 출력되지 않아 실제 보존 원인은 미확정이다. deploy는 AST로 추출한 함수에 파일 기반 PSScriptRoot가 없어 새 admission helper 경로를 잃고 capacity assertion 전에 실패했다. 기존 metrics fixture의 root 바인딩 방식을 재사용해 추출 함수의 PSScriptRoot를 원래 scripts 절대 경로로 바인딩한다. cache assertion 기대값은 유지하고 CleanupResults만 실패 메시지에 추가한다. 두 primary 테스트 파일의 해당 행만 수정했으며 제품/기준/시간 제한 변경은 없다. N은 J complete baseline에 기존 세 fixture 수정과 cache 진단 한 파일을 적용한 정규 delta다. 준비 work45374d01-9ad6-45a5-a13f-338979a6f431/session82216. 완료 시 기존 호환 환경을 연결하고 새 입력에서 실제 7개를 검사한다. 최신 primary commit/제품 소스는 채택하지 않으며 제품 컴파일은 보류한다.

retry17n actual0/독립 검증 verified. manifest SHA9be1a2b94d8edf139146a77aad89f4aef7a56c9eeda2e5e31953bc1d5a9e6790, project83dd7292ff1e5c5d52aba89a6dd85340ce4d4977def89a59e2239962f1aebfe4, input/workspace:1529de3eecbd98935ca9b988. 총4개 기존 테스트 override이며 UI/pipeline 두 hash는 M/L과 동일, deploy9eca5db3…/module6814bfe1…만 위 준비/진단 변경이다. 복사 과정은 약33분으로 지연됐으나 정상 종료했으며 중복 producer는 없었다. ready17n worke1f3ca27-269d-426d-a987-9b648a3ceed4/session26276 시작. 제품 컴파일 전 정규 7개 검사는 계속 필수다.

ready17n actual0/stopped/sourceUnchanged, 실제 도구/resolver/manifest/목록/fixture 명령 모두0이다. environment SHA39f87d67f8abd1bf0b94414a28f299facd113edd949d3f82a92b03c7049aec31. build17n work2b851fd3-1f7a-4751-9dab-1d92223c65cb 시작. 입력 차이는 두 PS fixture의 준비/진단으로 제한하고 정상 build area 7개 actual exit를 다시 확인한다. 기존 L Node/extension 증거의 재사용 조건은 동일하게 확인한다.

build17n actual1/stopped: module-cache 포함6개 actual0, deploy만 actual1이다. 앞선 capacity assertion은 통과했고 다음 environment preflight fixture가 metrics 생성 전 실패했다. child stderr 최초 원인은 copied synthetic project의 artifacts/maintenance/owner-installation.json ENOENT다. 기존 platform-packaging fixture의 정상 pin/동일 binary/acceptance copy 및 resolver capability 검증 방식을 PS fixture에 적용한다. product timeout/config/기대값은 변경하지 않는다. source 전체 재복사를 먼저 반복하지 않고 fixture17o의 scripts-only 소유 사본(artifacts/cache/fd17)에서 해당 case와 기존 deployment suite를 실행한다. copied test는 N 대비 bootstrap block만 달라야 하며 real selected N scripts를 소비하고 원 N은 불변이다. work2fee4f00-7234-43e1-9188-a306ca7bbbe4 시작. 성공 후에만 다음 고정 입력에 해당 test delta를 반영한다. module-cache의 이전 보존 assertion은 같은 의미/guard로 재실행 시 통과했으며 최초 보존 사유는 여전히 미확정이다.

fixture17o actual1/stopped: affected environment-preflight case actual0, 전체 suite는5개 사례를 통과한 뒤 large args-file 경계가 copied scripts-only root에 TypeScript가 없어 실패했다. 이는 새 probe 환경 준비 누락이며 원 N은 이미 TS5.9.3을 보유한다. patch SHA965b1012c5d3779f180cf73ff46b9ec9702fbeaa9f6d296150b9f131f8c7f5d1/제품 소스는 변경하지 않고 새 fixture17o2(artifacts/cache/fd18)에 동일 N TypeScript package를 copyTree로 추가해 검증한다. workf5923460-080d-4ce1-9b61-ec97b8abad52. 검사/시간 제한 변경 및 새 source 전체 복사는 없다.

fixture17o2 actual1/stopped: affected case0, suite40개 통과 후 account-success에서 source stub가 prepare-end를 제한 시간 내 관측하지 못해 actual9다. native/prepare는 약32초 후 실제0이지만 source stub는 실패했으므로 성공으로 바꾸지 않는다. 부모 cleanup guard stderr도 보존한다. 새로 bootstrap한 m.exe가 fixture root에 있어 git add 및 production source snapshot의 입력에 들어가는 불필요한 준비 부하를 확인했다. 이 바이너리는 generated artifacts/m.exe로 옮겨 pin의 상대경로만 그에 맞추고 동일 byte/hash/capability 검증을 유지한다. fixture17o3(artifacts/cache/fd19), work5ac1d094-db13-4f93-8a4c-e143683404aa에서 동일 조건/timeout으로 검증한다. 이전 지연의 단일 원인이라고 확정하지 않으며 제품 소스는 변경하지 않는다.

fixture17o3 actual1/stopped: affected case0, suite는 이전 account-success 경계를 지나71개 통과했다. missing-stage의 real metrics는 기대된 'Host acceptance did not pass the selected stages.'를 기록했지만 outer45초 안에 프로세스 종료를 마치지 못해 tree kill/실제 실패로 남겼다. 해당 실행 중 별도 cleanup의 파일 삭제가 겹쳤으며 인과관계는 미확정이다. product/fixture timeout을 늘리거나 검사를 생략하지 않는다. 먼저 cleanup이 끝난 후 동일 bytes/조건으로 missing-stage 및 전체 suite를 fresh runtime에서 직렬 재검증한다.

fixture17o/fixture17o2의 종료 실패/원인/producer·로그 hash는 37-deployment-fixture-cleanup.json에 독립 보존했다(SHA7bc3718f7accf1cfeecc045552ce636842e4cf9dfca26fd82de311c209b092d2). 현 standalone c0 pin/acceptance 확인, fresh registered review 보호/참조 없음 후 두 그룹/4경로 삭제 actual0 및 실제 부재/지원 finalize 완료다(work79eb5ffb-1ff7-4638-bdd8-8b907ce752ba review; worka0cada64-e83b-4da2-9757-db6b6a1dfa61 apply). 38-deployment-fixture-cleanup-result.json에 실제4 deleted/remainingfalse와 finalize2를 보존했다. 삭제된 자료 약234.6MB(logical)이며 physical reclaimed는 native 미측정이다.

fixture17o4 workb339eb3b-ab31-48d3-b91d-f3b16a3bdd46 시작. fd19의 검증된 scripts/TypeScript는 읽기 dependency로 재사용하고 새 generated runtime은 artifacts/cache/fd20에 소유 등록했다. 바이너리/메타데이터만 정상 copy하며 source 전체/dep 사본을 다시 만들지 않는다. direct test hash가 동일해야 하며 source/timeout 변경 없이 missing-stage 하나를 먼저, 통과하면 전체 suite를 실행한다. 이 동안 다른 대량 복사·정리·제품 컴파일은 하지 않는다.

fixture17o4 actual1/stopped/calls0: root 실행기가 fd19의 재사용 모듈 대신 fd20/scripts/maintenance-owner-config.cjs를 require해 테스트 시작 전에 실패했다. require 경로만 prepared fd19로 바로잡았으며 destination root 검증은 새 fd21 그대로 유지한다. fixture17o5 work0c1ee8d4-e182-4f2e-8aff-6901797431b6로 동일 원 테스트를 직렬 실행한다. 제품/검사 source hash 및 제한은 불변이며 이전 실패를 성공으로 바꾸지 않는다.

fixture17o5 actual1/stopped: missing-stage 단독 actual0으로45초 종료 경계가 같은 제한 안에 통과했다. 전체 suite는 large args-file case가 ArtifactProjectRoot/scripts/test-project.cjs를 직접 참조하므로 재사용 scripts-root 분리가 맞지 않아 실패했다. 제품 코드 결함 근거가 아닌 root의 준비 오류다. 지원하지 않는 partial fixture 재사용을 중단하고 이미71case를 통과한 complete scripts+TS 준비 recipe를 그대로 사용한다. fixture17o6(artifacts/cache/fd22), work940dfb65-ff72-47e8-bcff-a7770ef3c4c1로 missing-stage 및 전체 suite를 직렬 실행한다. 기존 N scripts/TS copy와 동일 patch6f2e661d…/pin은 그대로이며 다른 파일 producer를 실행하지 않는다.

fixture17o6 actual0/stopped: missing-stage 단독0 및 기존 배포 suite84개 모두pass/0fail이다(22:22:19Z~22:37:39Z,15분20초). patch SHA6f2e661dfe72e3a300fed7ae5cc671e376c4a9deccc631ecbbb791ad2fac81d6, 원 N production/scripts/TS 및 테스트 제한은 불변이다. 이 결과 전용 소형 사본을 full source 통과로 주장하지 않으며 corrected PS fixture bytes의 준비 근거로 사용한다. retry17o workba320fbc-2962-41e0-815f-928e8db26b65 시작. 원 complete J와 기존4개 테스트 override 구조를 유지하면서 deploy fixture만 실제 통과한 O6 patch로 교체하고 독립 검증한다. 최신 primary commit/제품 engine는 선택하지 않는다. 후속 ready17o와 build17o/최종 deploy17r13O recipe는 이 source-ready에 의존한다.

retry17o actual0/독립 검증 verified. manifest SHAb741e4e4447e3108ba412a937582d2b0e22a63eac22c6b8b3695afead89ae187, projectac4c4b5df2c138eb0f3e136f4a15ea95b3b1ddc2c1b68b2a2536551c5873cafb, input/workspace:170194424dfc5cb88012bb02. 기존 테스트 override4개뿐이며 production engine/SOURCE와 J baseline은 불변이다. ready17o workae6ec05b-fd4c-4008-9cf6-52f5085b65d9 시작. 의존성/fixture 연결이 실제0이면 정규 build area7개의 종료 결과를 확인한 뒤 제품 컴파일을 시작한다.

컴파일 전 결과 재사용을 좁게 정리했다. N의 나머지6개 build-tool actual0와 O6의 수정된 배포 fixture84 actual0가 이미 있으므로 O에서 같은84+6개를 예비 검사로 다시 실행하지 않는다. build17o는 별도 composite-precompiler-readiness 보고서로 baseline/engine/나머지3개 override 동일성, 수정 PS SHA와 suite84 실제 pass, N의6개 실제 결과 및 L Node/extension 실제0, O 정규 input verification을 대조한다. 실패한 N 전체 runner는 실패로 유지하고 성공 command/receipt를 새로 만들어내지 않는다. 최종 deployment의 원래 전체9개 source command와 native/package/install gate는 생략 없이 그대로 실행한다. 이 변경은 예비 중복 실행만 줄이며 제품 수용 기준을 낮추지 않는다.

08:03 KST VS Code 전체 창 종료 후 사용자가 원인 분석을 요청해 빌드를 재개하지 않고 로그/DB를 읽기 조사했다. 세 extension-host가08:03:17 renderer MessagePort close로 동시 종료했고08:03:23 main 재실행이다. 새 Crashpad dump/Application1000·1001·1002/System2004/Security4688·4689 해당 근거는 없었다. 사용자도 조작 없이 모든 창이 사라졌다고 확인했다. 이전 watcher/OOM dump는 이번 시각의 원인 근거가 아니다. 설치16의 persisted state 약1.3MB 전체 재저장 및 반복 경고는 확인됐지만 실행 초기부터 있어 직접 원인 미확정이다. 설정/제품 소스는 변경하지 않았다.

사용자가 빌드 재개를 요청했다. ready17o는 executor cancelled/exit1, 첫 extension dependency 부분 복사·calls0/copies0이며 성공으로 바꾸지 않는다. controller57780의 실행 identity와 executor cancellation/exit, pre-command 동기 copyTree 단계 및 다른 deps/UI/pin 부재로 exact producer stop을 확인한 뒤 supported close unknown/null로 보존한다. ready17o2는 같은 O 입력/원래 overlay owner를 소비하고 호환 N dependency와 부분 파일의 inventory를 대조해 누락분만 copyTree로 채운다. 새로운 소스 동결/최신 commit 채택/의존성 다운로드는 없다. work1be20f82-0489-436c-94a2-0f80890100d1 시작. controller 전체 recipe를 자신의 inputs/controller.cjs에 보존해 다음 중단 시 복원 가능하게 했다. actual environment/fixture checks0 및 O 정규 verification 전에는 제품 컴파일을 시작하지 않는다.

ready17o2 actual0/stopped/readytrue/sourceUnchanged 및 O 정규 verification verified. environment SHA04993891b5f000505c1f70f60adaefc729ce4562e765bc8690d210503c0dc586. extension dependency13325개 중9254개 재사용/4071개 추가, provider4915개 복사, 총47 copy 항목을 기록했다. 13개 실제 tool/resolver/manifest/Git/list/fixture 명령 모두0, fixture64 ready다. 기존 ready17o는 39-ready17o-interruption.json의 executor/단계/stop 근거로 close unknown/null 상태를 유지한다. build17o의 읽기 전용 composite 검증은 work3f9123a5-d3bc-4259-8fb2-885f42fb11c1로 시작했다. 통과 시 준비된 deploy17r13은 O/짧은 새 artifacts/cache/t18/frozen Cargo 모드를 사용하며 원 전체 배포 gate를 유지한다.

build17o actual0/stopped/acceptedtrue/sourceUnchanged/정규 O verification verified. N의6개 actual0 그룹, L2 affected+normal source actual0, O6 suite84 actual0와 정확한 input hash가 연결됐다. precompiler readiness일 뿐 final deployment receipt는 아니다. deploy17r13 workee2b6fd0-3a39-4244-b9a5-3407fb75d83d 시작. releasefa17-20261104-r13/HostVersion2026.0.17/FullRegressiontrue/SourceCheckConcurrency1/SourceTestConcurrency2, exact O SHA b741e4…89ae187, explicit short target artifacts/cache/t18, CARGO_HOME ch17/jobs2, supported frozen 모드이며 이전 unknown96/t17/K cache는 선택하지 않는다. imported16 code-mode host의 실제 path/SHA를 selection에 기록하고 selected engine과 최종 IPC 검증을 요구한다. 원 전체 소스/native/package/install gate를 유지한다. controller와 parameter/environment/selection은 run inputs에 보존하며 15분을 초기 검사/컴파일 진입 체크포인트로 사용하고 완료 시간은 미확정이다.

r13 초기 체크포인트: controller와 pwsh20684가 실행 중이다. source-fixtures/environment-preflight/verification-dependencies 실제0, engine-source-preflight31개 모두 actual0/passed(23:42:04Z 완료)다. source-tests와 build는23:42:04Z 시작했다. engine.log에서 새 짧은 target의 dependency compile 진행을 확인했다. parent stderr는 비어 있다. final source/native/product/package/install 완료 근거는 아직 없으며 다음20분 체크포인트까지 다른 대량 파일 producer를 겹치지 않는다.

## 현재 빌드 재개 상태

r13의 정확 executor terminal은 cancelled/actual1이다. 제품·source/native 종료값은 unknown/null로 보존한다. r14의 `reports/r13-stop-evidence.json`에 executor identity와 관련 worker 종료 관측을 보존했고, supported Cargo owner 복구가 성공했다(`reports/t18-recovery.json`, 이전 결과 unknown/null 유지).

2026-11-04 09:35 KST에 `deploy17r14`를 시작했다. 고정 O manifest `b741e4e4447e3108ba412a937582d2b0e22a63eac22c6b8b3695afead89ae187`, HostVersion2026.0.17, FullRegression, source concurrency1/worker2, Cargo jobs2 및 4GiB admission을 유지한다. t18은 r13의 소유권을 유지하고 r14가 명시적으로 참조한다. 최신 primary 변경은 채택하지 않는다. 원 전체 source/native/package/host/install gate를 유지한다.

실행: work9871405b-177c-4bdf-8e52-1a33d17879d8 / session92829 / controller54100 / pwsh30152. 앞선 두 launcher는 구문·인자 해석 단계에서 actual1로 끝났으며 제품 명령을 실행하지 않았다. 현재 15분 체크포인트에서 terminal evidence와 첫 causal error를 확인한다. 새 실행 자료는 consumer·진단 용도 종료 후 기존 소유자 정리 절차로 제거한다. 최종 설치·정리·사용자 확인은 미완료다.

검증 결과: source-fixtures/environment-preflight/verification-dependencies 모두 actual0. engine-source-preflight는 실제 receipt 기준 34개 모두 actual0/passed이며 09:52:36 KST에 완료됐다. 전체 source-tests 9개 command group이 10:33:58 KST에 모두 actual0/passed로 끝났다. Rust 제품 컴파일은 10:53:34 KST에 actual0, release profile 59분36초로 끝났으며 t18에 engine/bridge/host 및 전체 source provenance가 기록됐다.

r14 전체 실행은 10:57 KST actual1로 끝났다. 최초 원인은 `code-mode-host-compatibility.log`의 Windows AF_UNIX 경로 109bytes(요구 `<108`)이다. 컴파일 오류나 host protocol 불일치로 확대 해석하지 않는다. checker의 `verification.json`은 failed/fixtureRemoved로 보존하며 최종 package/install은 실행되지 않았다.

제품 코드를 바꾸지 않고 동일한 완전 baseline J와 O의 정확한 override4개를 더 짧은 `artifacts/q`에 준비한다. `prepare17p`는 기존 API로 같은 project/engine fingerprint를 검증한다(workd087eee8-a14b-4935-9dcb-5fed0d412d55 / session37178). 이후 provenance 검증을 통과한 t18 engine bundle을 기존 SkipEngineBuild 경로로 재사용하고 모든 원 배포 gate를 유지한다. 새 clone은 고정 source와 ignored tool/fixture 준비만 소비하며 최신 primary 변경을 채택하지 않는다. 이 경로 변경은 Windows x64 검사 환경 수정이고 제품/다른 플랫폼의 동작은 바꾸지 않는다.

11:12 KST 체크포인트에서 prepare17p는 실제 파일 읽기 약5.97GB/쓰기약0.58GB, CPU누적565.7초로 source/Git 준비 중이다. source 준비와 독립적인 t18 전체 host IPC 검사를 `host17p`에서 시작했다(work54545944-4297-4c5f-bef4-fd75fc72a95e / session42328). 원 O checker와 실제 새 engine/bridge/host를 그대로 사용하고 `--fixture-root artifacts/h17p --extended --code-mode-child`만 명시한다. host checker가 자기 소유 임시 fixture의 종료·정리를 수행한다. 이 결과는 제품 호환성 검사이며 최종 패키지/설치 수용과 구분한다.

prepare17p actual0/verified: q의 project SHA는 O와 동일한 `ac4c4b5df2c138eb0f3e136f4a15ea95b3b1ddc2c1b68b2a2536551c5873cafb`이며 전체 engine fingerprint도 같다. host17p는 results를 O 실행 프로젝트 밖에 지정해 `result_directory_must_be_under_project_artifacts`로 시작 전 actual1이었다. 생성 fixture는 없으며 protocol 검증 실패로 해석하지 않는다.

ready17p(work888f9cd5-8694-4622-9324-4051c9b4ce40/session26432)는 q 안의 의존성2개와 고정 UI/native pin을 검증 복사한다. ignored overlay 소유자를 별도 등록했고 source 준비 시 등록한 workspace 소유권은 유지한다. 기존13개 실제 도구·fixture 검사와 새 provenance/host-ipc 검사를 수행한다. host 결과와 fixture는 소유된 q/artifacts/h17p 안에 두며 기존 검사 경계와 전체 `--extended --code-mode-child`를 유지한다.

ready17p는 executor cancelled/actual1로 끝났다. 복사47개와 도구·fixture·provenance14개 실제 명령은 모두 actual0이며 마지막 host-ipc(pid38900) 실행 중 결과가 끊겼다. checker가 저장한 `q/artifacts/h17p/acceptance/process-tree-child-started.json`에 실제 daemon/host/owned exec/자손 identity가 남았다. 관련 프로세스와 선택 fixture worker 부재를 확인했으며 incomplete IPC를 성공으로 바꾸지 않는다. ready17p2(workaceebc53-9703-4a93-ac81-7a9169d410fa/session29592)는 exact executor cancellation와 저장된 tree를 증거로 이전 lifecycle을 unknown/null로 닫고, 원 checker의 `removeOwnedFixture`로 중단된 fixture를 제거·부재 확인한다. 성공하면 동일한14개 준비 결과를 재사용하고 정규 input verification 후 실제 배포의 기존 IPC gate를 수행한다. 복사·native compilation을 반복하지 않는다.

ready17p2 actual1: 기존 owner의 reparse guard가 중단된 Unix socket `q/artifacts/h17p/f/h/ipc/grnmcspit7qdmigb7fma.sock`을 링크와 구분하지 못해 정리를 거부했다. fsutil 조회는 정확 tag0x80000023/data length0이며 다른 reparse 항목은 없었다. 원 primary checker의 unrelated 변경을 보존하면서 `removeOwnedFixture`만 수정했다. 종료 확인된 fixture의 h/ipc 바로 아래 `.sock` 일반 reparse leaf이며 fsutil의 AF_UNIX tag를 확인한 경우만 기존 ordinary deletion을 허용한다. directory/link/다른 tag 보호는 유지한다. JS 구문검사 actual0. 새 코드의 초기 구문 오류는 구문검사에서 바로 고쳤고 삭제를 실행하지 않았다. q의 고정 source는 수정하지 않는다.

ready17p3(work2a99171c-1327-4461-ad19-105cd21afa06/session76466)는 새 정리 owner로 실제 중단 socket fixture의 일반 삭제와 부재, 정규 input 재검증을 수행한다. 기존 stopped/unknown lifecycle은 변경하지 않는다. 이 실제 정리로 수정 경계를 검증하며 제품 빌드 입력이나 native 기능은 바꾸지 않는다.

ready17p3 actual0/readytrue/sourceUnchanged/정규verified이며 cancelledFixtureRemovedtrue와 실제 부재를 확인했다. 원 checker의 같은 owner-based ordinary deletion이 이제 stopped AF_UNIX leaf를 처리했고 다른 guard는 유지했다. 이 내부 진단·정리 수정은 제품 계약 변경이 없어 아키텍처를 바꾸지 않는다.

deploy17r15(work7adf1744-370d-4e7c-88f1-4d9cd9e559da/session38105)는 검증된 q input과 t18 binary provenance로 SkipEngineBuild를 명시했다. 앱버전2026.0.17/FullRegression/source worker2/invocation1/4GiB admission 및 원 전체 package/native/host/install gate를 유지한다. q의 기본 compatibility socket 길이는106bytes로 기존108미만 guard를 만족한다. engine/bridge/host는 교체하지 않고 실제 호환성 gate를 다시 수행한다. source/native compilation 재생성이 아닌 source-provenance 검증 후 재사용이다. 최종 검증·설치·사용자 확인·정리는 아직 미완료다.

r15는 deploy의 첫 fixture 이름 검사에서 actual1로 거부됐다. `artifacts/vr15`는 지원 형식이 아니며, 제품·검증 명령을 시작하지 않았다. 원 문서의 `artifacts/v-<name>` 형식으로 바로잡은 r16(work13f1ae42-3efd-44e1-a407-c36dca6e7b31)이 `artifacts/v-r16`을 선택한다. 다른 input/engine/검증 gate는 r15와 동일하고 q 고정 소스는 변경하지 않는다.

r16 11:50 KST 체크포인트: source-fixtures/environment/dependency 준비 actual0, engine-source-preflight34개 모두 actual0/passed. 11:50:31부터 source-tests와 기존 엔진 재사용 build가 병행한다. pid7672, session66392. parent stderr는 비어 있고 inner build stderr는 사용 중 공유 제한으로 읽을 수 없다. 전체 실행은 아직 running이며 package/native/host/install 완료 근거는 없다.

r16 actual1: engine provenance 재사용은 통과했지만 compatibility의 `second.endpoint`(새 복사 generation-b 엔진) native discovery가 기존10초 제한에 도달했다. 원본 endpoint는 성공했고 소켓 길이 guard도 통과했다. checker `fixtureRemoved:true`; source-tests는 빌드 실패로 runner가 취소해 actual-1이며 r14의 actual0와 구분한다. timeout이나 기능·검증 기준은 변경하지 않았다. 독립 `host17r`(work607b9202-dba7-4b1a-9adc-1eb970174fa3)은 동일 q checker/t18 binary/원 timeout/전체 extended+code-mode-child 조건을 독립 실행해 일시 지연 여부를 확인한다. 준비 복사나 제품 compile은 반복하지 않는다. 최종 package/install은 아직 없다.

host17r actual0/passed/fixtureRemovedtrue, 실제26개 경계를 통과했다. engine SHA1a6b611a…2b550, host SHAf6574f97…15fc5로 원 t18과 동일하다. engine/host completed text·native delegate 응답과 bounded exec/host final-close를 포함한 전체 검사는 같은 timeout에서 성공했다. 앞선 일시 지연의 정확 원인은 미확정이며 실패는 보존한다.

r17(work50eb979d-3ebb-4d4f-ac17-974f84de1183)은 q/t18/FullRegression/2026.0.17을 유지한다. r16의 실제34개 source preflight 영수증을 지원되는 SourcePreflightReceipt로 선택해 owner의 내용·scope 검증을 거쳐 재사용한다. 나머지 전체 source9/native/package/host/install은 생략하지 않는다. host17r와 r16 evidence에 명시적 참조를 추가했다. 제품·검사 코드/제한시간 변경은 없다.

r17 actual1: 원 source-preflight owner가 새 실행의 fixture/env 경로를 `Source execution environment changed`로 거부했다. raw source가 같아도 환경-bound receipt를 재사용할 수 없음을 확인했다. 원 보호·scope를 바꾸지 않고 r18(work98ec4078-8027-4a0b-ac3d-57b5cc7ecc9d)이 SourcePreflightReceipt를 제거해 새 실행 환경에서 사전 검사를 다시 수행한다. r14 compile/r16 preflight/host17r 각각의 실제 성공은 해당 입력·환경의 증거로 보존하며 새 실행 통과로 대체하지 않는다. 제품 재컴파일은 계속 생략하고 기존 recorded bundle을 검증 재사용한다.

r18 체크포인트: 실행 running/pid32504/session22748. source-fixture/environment/dependency 및 engine-source-preflight actual0(12:20:49 KST 완료). source-tests/build는 이후 실행 중이며 현재 완료 package/host/install 근거는 없다. parent stderr는 비어 있다. 다음20분 체크포인트 또는 terminal에서 결과를 확인한다.

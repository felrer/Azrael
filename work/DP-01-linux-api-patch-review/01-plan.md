상태: 조사 완료 — 확인한 로컬·원격 브랜치에서 추가로 가져올 Linux API 오류 수정 후보 없음. 병합·제품 변경 없음.

# Linux API 모델 경로 패치 조사

## 결론과 권고
Linux API 경로의 유효한 수정은 이미 기본 브랜치에 통합되어 있다. 추가 cherry-pick을 권하지 않는다. 사용자가 말한 main에 해당하는 이 저장소의 기본 브랜치는 master이다. 설치 환경에서 문제가 지속된다면 패치 수집보다 해당 Linux 설치본의 engine/helper/host 출처와 실제 오류를 대조하는 후속 진단이 적절하다.

## 목적·권한·범위
- 요청: 다른 브랜치에 누적된 Linux API 모델 경로 수정 중 기본 브랜치 반영 가치 조사.
- 허용된 작업: 브랜치·커밋·소스·기존 검증 기록 조사 및 이 결과 기록. 병합, cherry-pick, 제품 수정, 빌드, 설치, 실 API 호출은 수행하지 않았다.
- 기준: 로컬 master 10d41b44, 원격 origin/master 0f062144. git ls-remote --heads origin(exit 0)으로 원격 기본 브랜치 해시 일치를 확인했다.
- 원격 head: master, design-settings-20261006, releases/2026.0.3. 로컬 추가 브랜치 fix/pr-1-review도 조사했다. engine은 engine/이 현재 소스이며 upstream/codex의 과거 azrael-ex/runtime 브랜치는 현재 엔진과 별개다.
- Linux 전용 Unix 브리지·호스트 실행 수정과 OS 공통 API/provider 컨텍스트·도구 변환 수정을 구분했다. Windows/macOS 새 회귀 시험은 수행하지 않았다.

## 이미 반영된 주요 수정

| 커밋 | 수정 가치와 범위 | 기본 브랜치 상태 |
| --- | --- | --- |
| 1d0843bc → 985103a2 | 커스텀 API에서 host tool_search를 활성화하고 검색한 도구를 후속 요청에 제공. Linux 통합 UI·감시 복구·브리지 처리도 포함하는 큰 통합이므로 일부만 재적용하기 부적절 | 로컬·원격 master에 원본과 병합 커밋 모두 포함 |
| 45911284 | API 도구 검색 컨텍스트 제한, desktop runtime 제외, 큰 catalog의 POST 전 차단 | 로컬·원격 master 포함 |
| fc1a30d6, 915e411d | 검색 이력 스키마 중복 축소, deferred 도구와 타입 지침 재사용·컨텍스트 투영 | 로컬·원격 master 포함. 915e411d는 Linux 2026.0.6 context hotfix의 선택 소스 |
| 70ed53ec | 현재 선언된 도구의 wire alias·원래 이름·namespace 이름을 유일하게 해석하고 비어 있지 않은 reasoning replay 검증 강화. 미선언·모호한 이름은 거부 | 로컬·원격 master 포함 |
| fb237f0f | 최종 전송 요청의 컨텍스트 예산·진단 개선 | 로컬·원격 master 포함. 주로 managed/Devin 경로이며 당시 custom API의 prepareOnly는 unsupported_input_budget으로 거부하므로 모든 API 경로에 같은 개선이라고 일반화하지 않음 |
| 314099c7, 4900aece | DNS/TLS/reset 등 연결 오류 및 제공자 거절 근거를 native 오류까지 보존 | 로컬·원격 master 포함 |

현재 소스에서도 supports_client_tool_search, IncludeLimited, api_tool_context_limit, resolveToolName, provider_connection_* 처리를 확인했다. 현재 소유 문서 docs/architecture/custom-api-models.md는 source 요약 4 KiB, 검색 최대 8개/64 KiB, catalog 128 KiB 초과 POST 전 거부를 명시한다. 바이트 제한을 원격 모델의 토큰 한도 보장으로 해석하면 안 된다.

## 별도 브랜치에 남아 보이는 후보
- origin/design-settings-20261006의 a8fc2f11은 연결 오류 분류라는 유효한 수정이나 master의 314099c7과 전체 git patch-id --stable이 동일하다: ab9d9940dda1ed7415eaa80164723c2486ef3069. providers/opencodex/inference.ts 단일 파일 패치 ID도 c2e932d19578c44aa60b991290809629ebf0cc18로 같다. 추가 반영 불필요.
- 관련 provider 경로에서 master 밖에 남은 다른 커밋은 save 및 모델별 compaction 설정/UI 작업이다. Linux API 경로 오류 수정으로 가져올 근거가 없으며 통째로 병합할 후보로 권하지 않는다.

## 검증 근거와 한계
- git merge-base --is-ancestor로 1d0843bc, 985103a2, 45911284, 70ed53ec, fb237f0f, 4900aece, 314099c7의 로컬 10d41b44·원격 0f062144 포함을 확인했다. 모두 exit 0. 915e411d의 원격 포함도 exit 0이며 fc1a30d6은 그 조상이다.
- 브랜치별 이력, 패치, 현 소스 및 유지 테스트를 정적으로 비교했다. 관련 provider/managed_runtime/managed_catalog/devin 경로는 조사 당시 기준 커밋 대비 작업 디렉터리 차이가 없었다.
- docs/ops/app-release.md의 Linux 2026.0.6 기존 기록: Ubuntu 24.04/glibc 2.39, WSL의 VS Code 1.138.0에서 live API ToolSearch → 검색한 도구 → Linux 파일 결과 → 최종 응답을 확인하고 HTTP 200 3회를 기록. 반복 schema 2,809,034 bytes를 834 bytes로 투영한 시험도 기록. 긴급 검증은 context/tool 범위이며 전체 계정·큐·UI 회귀나 다른 Linux 배포판을 포함하지 않는다. 이번 조사에서 영수증·바이너리·실 API를 다시 실행한 것은 아니다.
- work/AK-01-heretic2-api-validation/01-plan.md는 Windows 격리 확장 경유 Heretic2 기본 도구·deferred 검색 성공과 별도 UI 오류, 컨텍스트 낭비, 장시간 생성 미검증을 구분한다. 이 후속 과제는 미병합 Linux 패치가 있다는 증거가 아니다.
- 설치된 Linux 앱이 현재 master의 모든 후속 수정을 포함하는지는 확인하지 않았다. 원격에 공개된 head와 이 체크아웃에 있는 ref 범위의 결론이며 다른 PC의 미푸시 브랜치·작업 디렉터리는 조사 범위 밖이다.

## 실행·보존
root가 조사했다. 위임·task worktree·제품 빌드·새 테스트·커밋·push 없음. 기존 변경을 보존했다. 조사 중 다른 작업의 README 커밋 및 reset이 관찰되어 결론은 고정 커밋 기준으로 기록했다. 계획 할당의 첫 시도는 python이 PATH에 없어 실패했으며 명시적 Python312 경로로 해결했다. 임시 문서 입력 파일은 할당 후 일반 삭제한다. 이 문서는 조사 결과로 보존하며 제품 동작 변경이 없어 architecture/feature inventory 수정은 필요 없다.

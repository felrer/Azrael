상태: 목록 작성 완료. #56278을 selected/none으로 기록하고 원장 무결성·기존 항목 보존을 검증했다. 후속 PR 선택과 실제 이식은 별도 진행한다.

# 선별 PR 반영 목록

## 현재 선택

| PR | 내용 | 원장 판단 | 적용 상태 | 이식 준비 시 확인 |
| --- | --- | --- | --- | --- |
| [#56278](https://github.com/openai/codex/pull/56278) | MCP 호출에 협상된 네트워크 정책 metadata 지원 | selected | none — 미적용 | 정책 provider 연결, 신뢰된 서버와 capability 협상, 기존 MCP·연결 복구·권한 경로 보존 |

## 범위와 운영

- 사용자는 #56278을 다른 PR과 함께 반영할 목록에 추가하도록 요청했다. 이번 권한은 목록 작성·원장 선택 기록이며 코드 이식·빌드·설치·push는 포함하지 않는다.
- 추가로 반영할 PR을 선택하면 이 목록에 합친다. 전체 반영 범위와 순서·의존성·검증을 정한 뒤 이식한다. 확인되지 않은 의존 PR을 임의로 selected 처리하지 않는다.
- 이 목록은 이번 묶음의 selected/none 대상이다. 이전에 적용한 #56081·#56163과 과거 증빙 연결이 남은 #55991을 새 이식 대상으로 다시 추가하지 않는다.
- #56278은 optional provider와 metadata 전달 기반을 추가한다. 기존 upstream caller는 provider를 None으로 두므로 단독 이식만으로 일반 MCP 호출의 정책 전달·서버 측 강제가 활성화된다고 간주하지 않는다.
- 기존 설명·패치 확인과 [다음 20개 metadata](review-decisions-07.json)를 재사용한다. 선택 이유는 [고정 판단 근거](review-selection-08.json)가 소유하며 이후 목록 확장으로 과거 evidence hash가 깨지지 않게 분리한다.
- 플랫폼: 선택 상태의 의미는 Windows x64/Linux x64/macOS ARM64 공통이다. 이번 기록 검증은 Windows x64의 Node·Git에 한정한다. 제품 동작·플랫폼 지원을 변경하지 않으므로 architecture/feature inventory 변경은 필요하지 않다.
- root가 이 목록·선택 근거·원장만 소유한다. 기존 newEntry/setDecision/writeLedger owner의 revision·lock·atomic publication을 재사용하고 다른 작업의 변경을 보존한다.

## 완료 기준과 검증

- #56278만 selected/none 추가, 기존 43개 entry·baseline·range 보존, CLI 원장 check exit 0, 정확한 작업 파일만 커밋한다.
- testing 스킬에 따라 데이터 정합 검사만 수행한다. 제품 코드·실행기 무변경이므로 테스트 스위트나 제품 빌드는 실행하지 않는다.
- 원장 owner의 protocol lock/tmp 부재를 확인한다. 별도 disposable 생성물·백업·raw log는 만들지 않는다.

## 기록 결과

- Windows x64에서 owner 쓰기와 CLI check 모두 exit 0. entries 44, #56278 selected/none, 기존 #55991 증빙 미완료는 그대로 유지한다.
- 독립 데이터 검사 exit 0: #56278만 신규 추가, 기존 43개 entry·baseline·range 보존, protocol lock/tmp 0개를 확인했다.
- 제품 코드 이식·실행·빌드·설치 및 다른 OS 실행은 수행하지 않았다. 정리 대기 생성물은 없다.

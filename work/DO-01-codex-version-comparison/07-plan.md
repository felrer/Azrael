상태: 완료. 19개 제외 결정과 다음 미검토 20개를 기록하고 Windows 원장 무결성·기존 항목 보존 검증을 마쳤다. 다음 목록의 반영 여부는 사용자의 후속 선택 대상이다.

# 두 번째 PR 목록 제외와 다음 미검토 20개

## 범위와 결정

- 사용자 요청: 두 번째 목록 20개 중 #56163 외 19개를 excluded로 기록하고 다음 미검토 20개를 오래된 병합 순서로 제시한다.
- 제외 대상: #55993, #56001, #56003, #56006, #56022, #56049, #56097, #56124, #56127, #56132, #56133, #56139, #56153, #56154, #56182, #56210, #56211, #56214, #56220.
- 제외 이유는 사용자의 반영 범위 결정이다. 기술적 부적합·이미 동등 구현이라는 판정은 포함하지 않는다.
- #56163 selected/verified 및 다른 기존 항목을 보존한다. 제품 코드·설정·빌드·설치·push는 범위 밖이다.
- 플랫폼: 원장 데이터의 의미는 Windows x64/Linux x64/macOS ARM64에 공통이다. 이번 실행 검증은 Windows x64의 Node owner·GitHub API·Git에 한정한다.
- 기존 원장 owner의 newEntry/setDecision/writeLedger와 revision·exclusive lock·atomic publication을 재사용한다. 새 도구·의존성·영구 테스트는 추가하지 않는다. 제품 계약이 바뀌지 않아 architecture/feature inventory 갱신은 필요하지 않다.

## 근거와 검증

- root가 원장·이 문서·[판단 및 다음 목록 근거](review-decisions-07.json)를 소유한다. 공유 자원은 원장 writer lock과 Git index다. 다른 진행 중 변경은 보존한다.
- GitHub 검색 `repo:openai/codex is:pr is:merged merged:2026-10-21..2026-10-24`의 145개 결과를 전체 pagination·중복 수로 확인했다. #55991 병합 이후 main 병합 PR만 대상으로 기존 원장과 이번 19개를 제외하고 mergedAt 오름차순(동률은 번호)으로 다음 20개를 골랐다.
- 다음 목록은 #56222부터 #56286까지다. 제목·병합 metadata 조회이며 Azrael 적용 적합성 검토는 아니다. 이 20개는 원장에 신규 등록하거나 검토 완료 처리하지 않는다.
- 전체 commit ancestry 범위를 수집한 것은 아니므로 priorCoverage unknown과 기존 range/checkpoint를 보존한다.
- 독립 메모리 검사는 HEAD의 기존 24개 entry·baseline/ranges 동일성, 정확한 19개 신규 ID·excluded/none·merge SHA, #56163 selected/verified 보존, 다음 20개의 미등록·정렬을 확인했다. exit 0.
- 최초 `node scripts/codex-upstream-review.cjs check` exit 0, valid true, entries 43. 기존 #55991 source binding 미완료는 유지한다. `check --complete` 통과를 주장하지 않는다.
- 한국어 텍스트가 PowerShell의 Node stdin ASCII 인코딩으로 손상된 것을 커밋 전 발견했다. UTF-8 문서·근거를 복원하고 owner API로 19개의 reason과 evidence hash를 함께 갱신했다. 최종 CLI check와 독립 보존·제외·정렬·UTF-8·protocol 잔여 검사가 모두 exit 0으로 통과했다.
- testing 스킬에 따라 원장 데이터 변경의 최소 검사를 선택했다. 도구 소스·제품 코드 무변경이므로 테스트 스위트·제품 빌드는 실행하지 않는다.
- 산출물은 원장, 유지되는 판단 근거와 작업 기록이다. 일회성 소스 복사본·빌드·raw log는 만들지 않았다. owner protocol lock/tmp 잔여 0개를 확인했다.
- 다른 OS 실행, 설치본·실제 모델 호출, 다음 20개 패치의 Azrael 적용 적합성은 미검증이다.

상태: 150명 HTML 전달 준비 완료 — 사용자의 개별 이미지 검토 대기. 생성용 임시 자료 정리 완료.

# 과학자 이미지 수정 및 150명 검토판

## 승인 범위와 입력

사용자가 저장한 Downloads/scientists-risograph-50-review.json을 확인했다. schema1/setId 일치, 50명 해시 전부 일치. 승인26/수정22/제외2. 원본은 보존하고 review-input.json으로 복사했다. 수정 메모를 반영해22장을 별도 v2 파일로 생성한다. 기존과 중복되지 않는100명을 추가해 전체150명을 같은HTML에서 제시한다. 앱 설치·등록은 포함하지 않는다.

## 책임과 입력 준비

- Root: 요구사항·100명 선정·수정22명 실제 초상 참조 준비·image_gen 호출·최종 catalog/baseline/HTML 통합·검증·임시 입력 정리.
- new_scientist_references: 새100명 메타데이터와 실제 초상 입력, 출처 수집. populated reference와 파일은 게시 후 고정한다.
- review150_ui: 이전판 재사용 HTML template/builder/README/상태 로직 검증. root가 최종 이미지 준비 후 빌드한다.
- 사용자 AGENTS의 유용한 독립 작업 위임 지침에 따라 두 bounded owner를 사용한다. children 재위임은 금지했다.

## 구현 계약

산출물 경계는 artifacts/visualizations/scientists-risograph-150/다. images의 기존50 PNG는 보존용이며, 수정22명은 -v2.png 별도 생성, 신규100명은 별도 ID로 생성한다. catalog150의 현재 이미지는150장이고 전후비교를 포함하면 PNG172장이다. 기존 승인26/제외2 상태는 유지하고, 수정본22/신규100은 미검토122로 시작한다. 이전 사용자 메모는 revisionRequest로 보인다. 새setId/storage key를 사용하고 실제 이미지 SHA-256에 승인을 결합한다. 판단 저장 후 다음 미검토 인물로 순환 이동한다. JSON 저장·복구와 메모를 유지한다.

기본 image_gen 사용. 첫 이미지=리소그래프 STYLE ONLY, 두번째 이미지=실제 인물 IDENTITY. 기존 얼굴을 재활용한 일반화된 캐리커처 대신 실제 얼굴·머리·안경·표정과 수정 요청을 따른다. 보스/호퍼/호지킨/플레밍의 나이 요청을 별도 적용한다.

## 파일 소유와 정리

유지할 사용자 산출물: images/, catalog, baseline-review, 입력 승인기록, 생성별 출처/프롬프트/검증, HTML template와builder, README. identity-references/는 실제 사진 generation-input 전용 임시 묶음이다. 이미지 생성과 참조 검토가 끝나고 모든 producer/consumer가 종료된 뒤 기존 owner 절차로 삭제하며 실제 부재를 확인한다. 출처URL·원본 해시·관찰은 별도 metadata에 보존한다. 에이전트 contact sheet도 같은 임시 입력묶음이다. 기존50판과 사용자 Downloads원본은 삭제하지 않는다. renderer의 marked 임시 출력은 소유 cleanup으로 삭제한다.

## 검증과 환경

Windows에서 파일 수·PNG 읽기·크기·고유해시·원본승인해시 보존·baseline상태·실제HTML 상태함수·전후비교 렌더링을 확인한다. 이전 브라우저 도구 file: URL 정책 거부는 우회하지 않는다. 실제 Chrome 클릭/다운로드검증과 다른OS는 미검증으로 구분한다. UI owner는 Node vm의 실제 상태/불러오기/저장실패/자동이동과 문법 검증을 담당한다.

## 실행 결과와 인계

- 수정22/신규100 생성 완료. 생성 호출 실패 없음. 완료 시각은 개별 generation-records에 UTC로 보존되며 범위는 2026-11-03T06:43:53.178Z~07:16:58.956Z다. 시작 시각은 기록되지 않았으므로 이를 전체 소요시간으로 주장하지 않는다. 첫 신규60, 수정21, 나머지 신규40, 새 루빈 참조1 묶음으로 진행했고 생성 재시도는 없었다.
- 루빈은 처음 준비한 사진의 매끈한 짧은 머리가 사용자 요청과 맞지 않아, 생성 전에 AIP의 실제 곱슬 웨이브 사진으로 교체했다. 다른 수정19명 참조도 별도 소유자가 실제 이미지로 검사했다. 호퍼·호지킨·플레밍은 root가 직접 확인했다.
- assemble-review.py exit0: PNG172개 전부 decode·정사각형 크기 검사, 현재150개 고유해시, 기존50개 해시 보존, 생성기록122개 ID집합/원본 생성파일 해시 대조 통과. 기본 상태 승인26/제외2/미검토122. 원본 Downloads JSON과 기존50명판 변경 없음.
- build-review.cjs exit0: catalog/baseline 검증·안전한 JSON 삽입·실제 JS 문법 확인. UI owner의 Node vm 상태검사는 자동 이동, 메모, 저장실패, 불러오기 검증, 해시 변경 무효화를 포함한다. 갤러리의 우발적 물음표 구분자를 가운데점으로 고쳐12개 origin/status 표시조합도 재검증했다.
- 생성122장 전부 임시 contact sheet7장으로 시각 확인했다. 최종 HTML의 print-only 검사용 사본으로 전후비교·한국어·24/32/40/64px 밝은/어두운 샘플과 목록20개를 렌더링해 총4페이지 확인했다. 개별 인물 닮음은 사용자 승인 대상이다.
- 전체 미검토122개 일괄 PDF 렌더링은 2000/3000/10000ms에서 PDF가 생성되지 않았다. 진단 실행의 Chrome exit0과 별개로 renderer helper exit1이며 stderr에 Abnormal renderer termination이 확인됐다. 근본 원인은 미확인이다. 작은 목록·비교화면은 통과했다. 실제 브라우저 클릭/다운로드와 다른OS는 미검증이다. 웹 서버나 대체 브라우저 제어로 file: 제한을 우회하지 않았다.
- 공유 project-maintenance.json은 변경하지 않았다. 검토판 내부에 임시 입력만 허용하는 별도 관리 경계를 두고 pinned maintenance_owner의 SHA-256을 확인했다. 원래 프로젝트 native inventory 전체 페이지에서 관련 기존 소유항목이 없음을 확인했다. 일반 검토는 관리 루트 자체를 보호해 차단했고, 추가 검사용 파일을 재등록한 뒤 문서화된 retire_managed_roots 절차로 동일 owner/정확한 ID/별도 증거/fresh token을 검토했다. 최종 apply는 deleted/remaining false, Python exit0, identity-references 실제 부재 확인. renderer marked 임시 경계2개도 owner cleanup exit0/exists false. 실패 renderer 입력은 helper 예외 정리로 제거됐다.
- 유지물은 요청한 HTML/PNG/검토기록과 재현용 소스·출처·최소 검증·보호된 정리 영수증이다. 추가 임시 자료나 정리 대기는 없다. 앱 등록·설치·배포는 수행하지 않았다.

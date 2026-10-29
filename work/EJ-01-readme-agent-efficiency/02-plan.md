상태: 완료 — HTML 원본과 언어별 SVG 도식을 반영하고 렌더링·정합성 검증 및 임시 자원 정리를 마쳤다.

# HTML 기반 README 도식

## 목표와 범위

- 사용자가 지적한 Mermaid의 배치와 시각적 완성도를 개선한다. 한국어와 영어의 역할 분담·대기 재개 도식을 HTML로 구성하고 README에 같은 모습의 SVG를 연결한다.
- 기존 본문, 세 가지 소통 표, root/subagent/향후 lead의 의미와 재개 조건을 유지한다. 제품 기능과 플랫폼 지원은 바꾸지 않는다.
- 흰색·회색 중심의 OpenAI 스타일, 제한된 녹색 강조, 정렬된 카드와 짧은 레이블을 사용한다. architecture는 공통 설계 영역으로 분리한다.
- Windows 작업공간에서 문서와 브라우저 렌더링을 검증한다. 다른 OS의 제품 동작 검증을 주장하지 않는다.

## 실행과 소유권

- root가 기존 README 두 언어, docs/images/README.md, 새 docs/images/agent-diagrams.html, 네 SVG와 scripts/export-readme-agent-diagrams.cjs를 소유한다. 다른 작업의 변경은 보존한다.
- 새 의존성 없이 HTML 안의 SVG와 CSS를 사용한다. 기존 브라우저 도구로 실제 배치를 확인한다. HTML이 수정 원본이며 내보내기 스크립트가 공통 스타일을 포함한 독립 SVG를 생성한다.
- SVG는 요청된 README용 결과물이며 HTML 및 내보내기 스크립트와 함께 유지한다. 임시 스크립트·프로필·스크린샷 파일은 만들지 않는다.
- 루프백 미리보기 서버와 검증용 탭만 임시로 열고 작업 종료 전에 닫는다. 이 임시 계획 입력 파일은 할당 후 일반 삭제하고 부재를 확인한다.

## 검증

- 두 언어의 의미, 참조 경로, SVG XML·접근성 제목, HTML 원본과 내보낸 SVG의 일치, 본문·표 보존을 확인한다.
- 브라우저에서 네 도식의 렌더링·텍스트 잘림·선 겹침을 확인한다. 좁은 HTML 화면에서는 도식 영역 안에서 탐색할 수 있고 페이지 전체가 넘치지 않아야 한다.
- git diff --check, 임시 서버·탭 종료, 이번 변경만의 작업별 커밋으로 마무리한다.

## 결과

- HTML 원본에 1120×640 역할 분담·재개 조건 도식을 한국어/영어로 작성했다. architecture 공통 영역, 정렬된 카드, 제한된 녹색 강조, 교차하지 않는 연결선으로 구성했다.
- scripts/export-readme-agent-diagrams.cjs로 공통 스타일과 접근성 설명을 포함한 독립 SVG 4개를 내보냈다. 두 README에는 해당 언어 SVG를 연결했다. docs/images/README.md에 HTML 소유권과 재생성·검사 명령을 기록했다.
- `node scripts/export-readme-agent-diagrams.cjs --check`: 네 SVG와 HTML 원본의 일치 확인, exit 0.
- Windows 체크아웃의 CRLF를 정규화한다. 파일 읽기만 CRLF로 투영한 메모리 검사에서도 `--check`가 통과했다(exit 0).
- Python 메모리 검사: SVG XML·접근성 제목·설명·marker 참조, 외부 의존성 없음, README의 본문·표가 도식 교체 외에는 그대로 보존됨을 확인, exit 0.
- 연결된 Chrome에서 SVG 4개의 텍스트·배치·연결선을 확인했다. HTML 원본의 SVG 4개 모두 텍스트가 canvas 안에 있으며 페이지 폭 1202px에서 넘침이 없었다.
- 320px viewport에서 세로 스크롤바를 제외한 페이지 폭과 콘텐츠 폭은 모두 305px였다. 도식 영역만 가로 스크롤되며 실제 이동을 확인했다. viewport를 원복했다. 다른 OS·GitHub 호스팅에서의 렌더링이나 제품 동작을 검증한 결과는 아니다.
- 임시 계획 입력 파일의 삭제·부재를 확인했다. 검증 탭과 루프백 서버를 정상 종료했다(exec session 81512, exit 0). 임시 파일·프로필·스크린샷·추가 정리 대기 항목은 없다.

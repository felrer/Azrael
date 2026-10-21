# 디자인 보드 해석 지침

이 자료는 범용 HTML/CSS 정적 디자인 시안이다. 기본 디자인은 합성이며 GrowKick 게임 자산이 아니다.
items는 안정 ID로 연결한 디자인안이며 title/description은 설명, html/css는 미리보기 원본, note는 사용자의 판단 근거다.
devices는 CSS px의 가상 화면 크기와 사용자가 입력한 안전 여백이다. 실제 기기·DPR·OS 글꼴·노치나 게임 엔진을 측정한 값이 아니다.
states의 ID는 미리보기 html/body의 data-preview-state로 전달한다. CSS 선택자로 상태별 표시를 작성한다.
settings.selectedId는 검토 중인 시안이며 최종 승인·구현 지시를 뜻하지 않는다. 다른 안을 삭제할 권한을 주지 않는다.
sample은 비교 표본의 CSS px 크기다. backgrounds는 비교 배경 색상이다. 안전 여백 변수는 --preview-safe-top/right/bottom/left다.
미리보기는 HTML 본문 조각과 CSS를 격리해 정적으로 표시한다. 입력 폼은 디자인으로 표시한다. 스크립트·외부 네트워크·폼 전송·다른 화면 탐색은 제공하지 않는다.
HTML 내보내기는 현재 편집 시안의 정적 화면이며 파일 저장이나 고정 전달본 생성과 다르다.
작업 반영 시 메모와 명시적 대화 지시를 함께 확인하고, 실제 제품·기기에서 확인해야 할 사항을 구분한다.

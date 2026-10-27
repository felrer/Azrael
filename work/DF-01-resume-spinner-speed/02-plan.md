상태: 구현 중. 승인된 파란색 정지 원 디자인 적용. 추가 사용자 결정 없음.

범위: 재개 대기 세션의 팝업/사이드바 원을 파란색으로 표시하고 정지한다. 끊어진 부분의 방향을 지정하지 않으며 크기·선 두께·위치와 실행 중 회전을 보존한다. 공통 UI로 Windows x64/Linux x64/macOS ARM64에 적용하고 실제 검증은 Windows Chrome에서 수행한다. 빌드·설치는 별도다.

구현: 기존 Gjr/BZ/fkr/azraelResumeSpinner 경로를 재사용한다. native info 색상 토큰으로 테마에 맞는 파란색을 적용하고 animation:none만 지정한다. 기존 renderer 검사를 정지·파란색·시간 경과 중 transform 불변·실행 복귀 검사로 갱신하여 계속 회귀를 보호한다.

검증: 기존 deferred 소스 검사, 실제 native React/CSS light/dark 팝업·사이드바, 실행 중 복원과 대기 종료, 관련 탐색 상호작용. owning root-resume 문서 갱신. 생성물은 run lifecycle로 기록 후 검토한다. 담당 root 단독.

현재 검증 대기: 별도 작업의 old-copy-apply 프로세스(PID 73596)가 공용 lifecycle catalog 잠금을 사용 중이다. 잠금 및 프로세스를 변경하지 않는다. 실행 시도는 테스트 시작 전 EEXIST로 종료되어 제품 검증 결과가 아니다. 변경된 helper의 소스 수준 검사(기존 props 보존, animation:none, 테마 색상, transform 미지정)와 JS 문법 검사는 exit 0이다. 별도 프로세스 종료 관찰 후 잠금 해제 상태를 다시 확인하고 실제 renderer와 deferred 소스 검사를 진행한다. 승인된 색상은 밝은 테마 #2563EB, 어두운 테마 #60A5FA다.

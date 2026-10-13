상태: 구현·검증·정리 완료. 설치본 적용은 별도 빌드·설치 작업이다.

기본 Subagent 이미지 셋의 표시 이름을 Blue Archive에서 Students로 변경한다. 영속 식별자 blue-archive와 기존 사진·배정은 유지한다. 기존 작업의 UI/implementation 지침과 실행 권한을 이어받는다. 공통 Windows x64/Linux x64/macOS ARM64 웹뷰·호스트 표시 변경이며 실제 검증 환경은 Windows이다. 전체 빌드·설치·배포는 범위 밖이다.

호스트 photoSets()의 표시 이름과 해당 테스트·렌더링 fixture·UI 계약을 갱신한다. 기존 기능 ui.student-design 검사를 재사용한다. 관련 UI 선택·가져오기 호스트 테스트와 밝은/어두운 렌더링으로 Students 표시와 선택을 확인한다. 이전 검증의 저장·배정 보존 근거는 식별자와 로직에 변경이 없어 재사용한다. 이번 변경만 커밋한다.

검증: UI 선택 테스트 1개, 호스트 테스트 15개, 호스트 증분 컴파일, 밝은/어두운 테마 및 좁은 화면 렌더링 모두 종료 코드 0. Students 표시를 실제 캡처로 확인했다. 로그와 화면은 ../../artifacts/logs/subagent-students-label-20261013/에 보존한다. 검증 fixture 삭제와 browser 종료는 summary.json에서 확인했다. ID와 배정 로직은 유지되어 이전 저장 데이터의 보존 계약이 같다. 설치된 앱과 다른 OS의 실제 실행은 미검증이다.

상태: 구현·검증·정리 완료. 사용자 추가 조치 없음. 설치본 적용은 별도 빌드·설치 작업이다.

## 목표와 범위
Subagent 사진 설정의 저장·가져오기·배정 경로를 검토하고 사진 미리보기의 이미지 셋을 펼침 목록에서 선택하도록 수정한다. 기존 사진과 꺼짐 결정, 글꼴 선택, 가져오기 제한을 유지한다. 코드 수정과 관련 검증이 승인된 범위이며 전체 빌드·설치·배포는 포함하지 않는다.

## 적용 환경과 소유권
공통 요구: Windows x64, Linux x64, macOS ARM64의 공유 웹뷰와 호스트 계약. 실제 검증은 Windows의 소스/호스트 테스트와 격리 Chrome 화면이며 다른 OS·설치된 VS Code·실제 파일 대화상자는 별도 미검증이다. UI 소유자는 scripts/inject-student-design.cjs, 저장과 배정은 extensions/azrael-ex/src/studentDesign.ts, 계약은 docs/architecture/ui-presentation.md의 Student design settings 절이다. 기존 엔진/provider 작업 변경은 보존한다.

## 조사와 실행
기존 setPhotoSet 저장, 선택 셋 미리보기, 새 스레드 배정, 영속 결정 보존 경로를 재사용한다. 이미지 셋 분할 버튼을 pinned UI의 Menu/RadioGroup/RadioItem과 기존 버튼으로 교체한다. 현재 선택 이름과 펼침 표시, 저장 중 비활성화, 네이티브 키보드 접근성을 제공한다. 새로운 라이브러리는 필요 없다. root가 수정·통합·검증을 수행한다.

## 완료 기준
전체 셋 목록과 현재 선택이 표시되고 변경은 호스트 확인 뒤 반영된다. 가져온 셋 자동 선택, 저장 실패 시 이전 선택 유지, 기존 배정 유지, 새 배정의 선택 셋 사용은 기존 관련 테스트로 검증한다. 밝은/어두운 테마와 좁은 화면에서 메뉴 열기·선택·키보드·다시 뽑기를 실제 렌더링으로 검증하고 fixture를 정리한다. 해당 변경만 커밋한다.

## 결과와 검증
- 이미지 셋 UI를 native Menu/RadioGroup/RadioItem으로 변경했다. 현재 이름과 체크 표시, 키보드 Enter/Escape, 저장 중 잠금, 기본·가져온 셋 선택을 확인했다.
- node --test scripts/test-student-design.cjs scripts/test-student-avatar-assets.cjs: 종료 코드 0, 25/25 통과, 158.94초. source-tests.log에 상세 근거 보존.
- extensions/azrael-ex의 node scripts/build-incremental.cjs: 종료 코드 0. node --test dist/test/studentDesign.test.js: 종료 코드 0, 15/15 통과. host-compile.log와 host-tests.log 보존. 선택 셋 배정·중복 생성·재시작·저장 실패·가져오기 제한과 복구를 검증했다.
- node scripts/verify-design-photos-render.mjs: 최종 종료 코드 0. 밝은/어두운 테마, 실제 네이티브 메뉴 렌더링과 키보드 선택, 좁은 화면, 다시 뽑기, synthetic import 응답과 기존 배정 유지 통과. 최초 캡처 단계의 DOM click을 실제 키보드 입력으로 교정했고 native Menu CSS를 fixture에 추가해 다시 검증했다. 제품 코드 재실행 수정은 없었다.
- 검증 로그와 light/dark(-menu).png: ../../artifacts/logs/subagent-photo-dropdown-20261013/. summary.json의 browserExit.confirmed=true, cleanupExitCode=0. artifacts/verification/subagent-photo-dropdown-20261013 부재 확인.
- Windows 격리 Chrome의 production 컴포넌트·store·pinned UI 검증이다. 설치된 VS Code, 실제 OS 파일 대화상자, Linux/macOS는 미검증이다. 전체 앱 빌드와 설치는 수행하지 않았다.
- 기능 ui.student-design의 기존 보존 검사를 확장하고 소유 UI 계약을 갱신했다. 다른 작업의 엔진/provider 변경은 커밋에서 제외한다.

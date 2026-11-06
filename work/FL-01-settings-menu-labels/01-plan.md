상태: 소스 수정 및 대상 테스트 통과 — 기존 Design 통합 오류로 전체 화면 검증과 작업 커밋 보류.

# 설정 메뉴 이름 변경

## 범위와 승인

- Instruction Documents → Presets, 한국어는 프리셋.
- Computer use → Window use. 메뉴, 접근성 이름, native 페이지 제목에 적용한다.
- 기존 경로, 기능, 설정 데이터, 승인 정책과 레이아웃을 유지한다.
- 공통 UI 변경이다. Windows에서 테스트했으며 macOS/Linux 실환경은 미검증이다.
- 별도 제품 빌드와 설치는 수행하지 않았다.

## 구현과 보존

기존 scripts/inject-instruction-settings.cjs의 세 native navigation 주입 경계를 재사용했다. 새 의존성은 없다. feature ui.instruction-settings의 기존 source check를 확장해 descriptors, row labels, collapsed headings를 영어 및 한국어 변형 locale에서 검증한다. 기존 Design locale 기대값도 맞췄다. 소유 UI 계약은 docs/architecture/ui-presentation.md이다.

## 검증 결과

- node --test scripts/test-instruction-settings.cjs scripts/test-use-settings-ui.cjs: 15개 통과, 실제 exit 0.
- 초기 전체 검사: node --test scripts/test-instruction-settings.cjs scripts/test-student-design.cjs scripts/test-use-settings-ui.cjs: 32개 통과, 4개 실패, exit 1. 실패 원인은 inject-student-design.cjs가 AzraelInstructionSettings anchor를 기대하지만 현재 instruction injector는 AzraelWorkbenchSettings를 주입하는 기존 불일치다.
- 메뉴명 변경을 원래 값으로 되돌린 메모리 내 입력으로도 같은 anchor 오류가 재현됐다. 이 작업은 기존 통합 수정으로 범위를 확대하지 않았다.
- 실제 light/dark 렌더링, 최종 패키지, 설치된 앱 반영은 미검증이다. 작업 완료로 보고하지 않는다.
- 체크아웃에 기존 수정 및 staged 변경이 다수 있고 필수 통합 검사도 실패하므로 작업 단위 커밋은 보류했다.
- 새 일회성 파일이나 빌드/브라우저 산출물을 만들지 않았다. 이 계획은 유지할 작업 기록이다.

## 다음 단계

기존 Design 주입 연결 오류 해결 후 전체 native 설정 렌더링 및 패키지 반영 검증을 이어가야 한다.

상태: 완료 — 한글 README와 시각자료를 작성하고 문서·렌더·상호작용 검증 및 임시 자료 정리를 마쳤다. 영어 README는 유지했다.

# 한글 README 완성

## 요청과 범위
- 1장 제목은 사용자가 지정한 `Harness Architecutre`를 그대로 사용한다. Codex 기반과 Azrael의 독자 확장을 소개하고, 컨텍스트 조합 → 지침/작업 기억 → Profile/Direct/Team → 공유 패키지 → 협업/관리 → Window Use 순으로 기초와 응용을 연결한다. 세부 편집 순서는 조사 결과에 맞춰 조정한다.
- 한국어 README만 완성한다. 영어 README와 기존 영어용 그림은 유지한다. README를 위한 HTML/SVG·커서 애니메이션과 재현 설명은 승인된 산출물이다. 제품 구현·설치·배포는 하지 않는다.
- 화려하되 명확한 시각자료, 짧은 포트폴리오 문장, 기존 중요 기능의 누락 방지. 사용자 주장도 소스·설계·검증 기록으로 확인하고 개발/검증 한계를 짧게 표시한다.
- Profile/Team 패키지 포함 범위, Git 기반 변경 저장, Window Use 입력 격리, 파일 삭제/잠금의 보호 경계를 사실에 맞게 보정한다.

## 소유와 실행
- root: 하네스/지침/작업 기억·기능 범위 조사, README 편집·통합·최종 검증.
- readme_profiles_audit: Profile/Team/패키지/변경 관리 읽기 전용 근거.
- readme_window_audit: Window Use·커서·오버레이·입력 경계 읽기 전용 근거.
- readme_maintenance_audit: 묶음·잠금·삭제 읽기 전용 근거.
- 시각자료 구현은 확정된 설명 계약에 맞춰 전용 파일을 배정한다. 조사 결과를 기다리는 동안 준비 가능한 시각자료·검증 환경을 진행한다. 자식의 추가 위임 금지.

## 검증과 정리
- 제품 공통 개념과 Windows 전용 Window Use를 구분한다. 문서/도식 검증은 Windows 로컬에서 수행하며 설치본 기능 실행 수용으로 확대하지 않는다.
- 한국어 목차/문서/이미지 링크, 시각자료 HTML·SVG 일치, 원래 영어 README 및 영어 그림 동일성, 변경 diff를 확인한다. 렌더링은 데스크톱/좁은 폭·테마·애니메이션 일시정지와 reduced-motion을 확인한다.
- task-owned 계획 입력·렌더 임시 출력·서버는 사용 종료 즉시 소유 절차로 정리하고 부재/실제 종료를 확인한다. 최종 시각자료와 재현 소스만 유지한다. 관련 파일만 커밋한다.

## 근거와 남은 작업
- 설계 소유자: docs/architecture/instructions.md, model-harness-profiles.md, work-orchestration.md, task-memory.md, project-maintenance.md, window-use.md, window-use-visualization.md.
- 작업 시작: 2026-11-03, 세 읽기 전용 조사를 병행. 구체 수용 결과와 재실행 사유는 아래에 통합한다.

## 사실 확인과 편집 결정

- Profile/Team: 통합 라이브러리·composer와 단일 Direct 전역 설정/복수 Team preset을 확인했다. Team preset 자체에는 추가 지침 필드가 없고 생성 요청의 기반 지침은 별도다. 패키지는 리소스·Profile 템플릿까지이며 Team/Direct 설정 전체 내보내기는 지원하지 않는다. 근거: role-profile-store.cjs, role-profile-runtime.cjs, instruction-workbench.cjs, instruction-library.cjs의 해당 생성·저장 경로. Agent Profile과 task-profile 배포 형식의 모델 지정 차이를 표시했다.
- Team 변경 서비스는 Git 커밋/객체와 별도 상태 원장을 사용한다. 자동 worktree 통합·checkpoint의 외부 커밋 변환을 구현 완료로 쓰지 않았다. 일상 작업에는 Direct를 권장했다.
- 작업 메모리는 root·직속 subagent의 명시적 ID/revision 읽기이며 Lead 자동 주입이 아니다. 프로필의 선택형 지침과 기존 협업 신호를 구분했다.
- Window Use는 관찰·창 제어·별도 세션·데스크톱 제어를 구분했다. Switched는 공유 SendInput/foreground 경로이고 virtual_input만 대상 프로세스/스레드 내부 입력 실험이다. A3 커서·모션은 디자인 시안이며 실제 native overlay의 정적 삼각형과 구분했다. 일반 앱의 비간섭·설치 수용은 주장하지 않았다. 현재 제품의 Windows 전용 정책을 반영했다.
- 산출물은 등록된 작업 소유 자료의 정리 범위다. 모든 파일 삭제·모든 충돌 방지·설치본의 standalone 최적화 통합을 주장하지 않았다. 잠금의 협력 실행기 경계, 보호/불확실성, 보존 승인과 실제 삭제 확인을 설명했다.
- 기존 소유 문서에 발견된 공개 범위 혼합 의존성 문구 및 다중 커서 숨김 상태의 상충은 README에서 검증된 좁은 의미로 작성했다. 제품/아키텍처 수정은 이번 범위 밖이다.

## 결과와 검증

- 356줄의 한글 README를 기초 하네스 → 구성과 공유 → 병렬 실행과 정리 → Window Use → 대화 기능 순으로 다시 작성했다. 문서·스킬·협업·대기·계정·모델·압축·플래그를 유지하면서 작업 메모리, /btw, 스케치, 사용량, Auto-Review를 추가했다. 설치는 변하는 고정 버전 대신 릴리스별 INSTALL.md와 운영 소유자에 연결했다.
- 읽기 전용 조사 3개와 시각자료 구현 2개를 병행했다. root는 조사 중 본문·검증 준비를 수행했고 완료된 자산부터 렌더했다. 별도 의존 대기나 중복 제품 빌드는 없었다.
- 하네스 HTML과 4개 SVG: exporter 및 --check exit 0, XML 파싱 통과. 지정 renderer의 4페이지를 모두 시각 확인했다. 좁은 화면은 그림 안 스크롤(760px 내용)을 유지하고 페이지 overflow가 없었다.
- 커서 HTML과 SVG: 기존 A3 geometry/사용자 화살표/모션 재사용, MIT 출처 보존. 최종 exporter는 HTML을 원본으로 쓰며 미추적 work 파일에 의존하지 않는다. 초기 생성기의 work 의존성은 수용 전에 제거했다.
- 커서 시각 검증: renderer 1페이지와 실제 Chrome의 밝은/어두운 화면, 요청 폭 320px에서의 레이아웃(관측 clientWidth 277px) 확인. 재생·일시정지·속도·클릭/드래그/순간이동 상태 선택·키보드 Home 타임라인 조작과 console error 없음 확인. 좁은 화면용 범례 추가 후 실제 렌더를 다시 확인했다.
- reduced-motion은 실제 HTML JS를 실행한 메모리 DOM/event fixture에서 초기 정지·설정 변경 시 정지·정지 상태의 7개 모드 선택을 검사해 exit 0. 첫 fixture는 PowerShell 파이프의 한글 기대값 인코딩 실패였고 Unicode escape로 수정했다. OS 설정을 변경한 실제 미디어 에뮬레이션은 하지 않았다.
- Python 문서 검사 exit 0: 92개 링크 참조 중 로컬 경로/앵커 확인, 새 SVG 5개의 title/desc와 XML 확인, 영어 README HEAD 동일성 확인. 외부 URL 접속이나 설치 앱의 기능 수용을 검사한 것은 아니다. git diff --check 통과.
- 계획 입력을 일반 삭제했다. renderer 소유의 두 preview 디렉터리는 제공 cleanup으로 제거하고 exists:false 및 Test-Path False를 확인했다. 브라우저 검사 탭 3개를 닫고 viewport를 복원했다. loopback 서버(session 27579, workId 53caa7bc-cf12-4bc2-bd61-500175ff20fb)는 종료 경로 호출 후 실제 exit 0을 확인했다. 테스트 파일·스크린샷·브라우저 프로필·서버 로그를 남기지 않았다.
- 실제 검증 환경은 Windows의 문서·시각자료다. 제품 빌드·설치·네이티브 입력은 실행하지 않았으며 다른 플랫폼 수용으로 확대하지 않는다. 영어 README 및 기존 영어 그림은 수정하지 않았다.

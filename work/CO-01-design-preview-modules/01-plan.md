상태: 검증·정리 완료, 커밋 보류 — Windows Chrome에서 두 모듈과 조합 페이지를 수용했다. 별도 목록·카드 수정이 공유 index에 스테이징되어 커밋을 섞지 않고 보존한다.

# 기기별 미리보기와 디자인안 보드

## 목표·범위

GrowKick의 기기별 HTML 디자인 미리보기와 디자인안 비교 UI를 참조해 `docs/boards/shared/modules/`에 재사용 모듈로 추출한다. `docs/boards/design/`에 조합 예제와 합성 디자인을 제공한다. 사용자 설정 크기·상태·배율·비교 배경, HTML/CSS 콘텐츠와 디자인안 설명·메모를 편집하고 기존 공통 파일 저장·백업과 연결한다. 모듈은 저장소와 게임 엔진에 의존하지 않는다. 원본 GrowKick은 읽기만 하며 게임/Studio·배포·설치·push는 범위 밖이다.

가벼운 vanilla ESM·브라우저 iframe/CSS·기존 BoardStorage를 재사용하며 패키지·제품 빌드는 추가하지 않는다. 지속 계약은 [디자인 보드 README](../../docs/boards/design/README.md)에서 관리한다. 이전 목록·카드 작업의 미커밋 변경과 사용자 자료를 보존한다.

## 플랫폼·검증

공통 대상: Windows x64/Linux x64/macOS ARM64의 로컬 Node 22+와 현대 브라우저. 실제 검증은 현재 Windows x64/Chrome으로 한정한다. iframe 가상 크기는 CSS px이며 실제 기기/OS 렌더러의 보장은 아니다. 기존 보드 서버 공통 변경의 Windows 저장·충돌·접근 경계 회귀를 검사한다.

수용 기준: 기기 전환·사용자 크기·화면 맞춤/100%·상태 전환, 반응형 HTML 격리 미리보기, 디자인안 비교와 선택·배경별 실제 크기, HTML/CSS/프리셋 사용자 수정·저장 후 재열기, 잘못된 입력·충돌·실패 시 편집본 보존, 밝음/어두움/좁은 화면 실제 조작, 두 모듈의 재사용 API와 커스텀 예제. PNG 등 원본 기능은 소스 조사 후 재사용 범위와 한계를 기록한다.

## 담당·의존성

- `/root/preview_source`: GrowKick 미리보기/디자인안 소스 읽기 조사. 먼저 기본 동작과 게임 결합 부분을 root에 인계한다. 변경·추가 위임 없음.
- `/root/preview_modules`: `shared/modules/{device-preview.mjs,design-gallery.mjs,design-preview.css}` 전용 구현 후 동결, 이어서 독립된 `tests/design.test.mjs`를 작성·동결했다. root가 통합과 실제 실행을 소유한다.
- root: 요구사항·공유 계약·저장/서버 통합·문서·조합 페이지·브라우저 검사·생성물 정리·작업 커밋. 모듈 소유자의 구현과 저장/조합/검사 준비를 병행했다.

검사 산출물은 작업 고유 run 경계에 생성 전 등록하고 임시 프로필·자료와 보존 결과를 분리한다. 사용자 자료는 `artifacts/board-data/design/`에 둔다. 의도 대상과 실제 확인 환경, 실행 exit·로그·정리 결과는 이 기록에서 갱신한다.

## 확정 계약과 근거

GrowKick `docs/work/CA-01-main-hud-html-design/prototype/hud.js:262-281`의 화면 맞춤·기기·상태 조작과 `review-kick-options-v2/index.html:14-21`의 확대·배경별 표본을 참조했다. 원본은 Roblox snapshot을 SVG로 렌더하며 HTML 프레임이 아니다. `hud.js:282-328` PNG 저장도 해당 SVG 전용이므로 범용 HTML 캡처로 옮기지 않고 정적 HTML 내보내기를 제공한다. 원본 safe-area metadata는 JS에서 읽지 않으므로 새 보드는 사용자 입력 여백을 명시적인 CSS px로 정의한다. 실제 기기 측정값이라는 표시는 하지 않는다.

기기/상태/배경/표본 크기와 각 디자인의 HTML/CSS·메모를 ID로 연결한 전용 codec을 기존 저장·백업·고정 전달본에 연결했다. 모듈은 저장을 소유하지 않으며 controlled props/callback으로 조합한다. 표준 srcdoc iframe·CSS 미디어 쿼리·ResizeObserver로 충분해 새 라이브러리를 추가하지 않았다. 정적 시안은 빈 sandbox와 CSP·활성 마크업 제거로 격리한다. 원격 URL/사용자 JavaScript와 실제 Roblox 터치/엔진 렌더링은 이 요청의 범용 정적 미리보기 범위에 포함하지 않는다. 독립 보드이므로 Azrael 엔진 feature inventory 변경은 없다.

## 검증·생성물 판단

Windows x64/Node 26.7.0/실제 Chrome에서 확인했다. `boards-design-unit` native `run-45928-1096-1792388012156047600`, actual exit 0·입력 무결성 유효, 신규 계약 6개와 기존 보드 회귀 26개를 합한 32개 통과. [단위 로그](../../artifacts/tasks/CO-01-design-preview-modules/runs/unit-1792388012948-f16db1b1/logs/command.log).

`boards-design-ui` native `run-45928-1096-1792388012156047600`, actual exit 0·입력 무결성 유효, 실제 조작 37개 통과. 05:33:36.950–05:33:41.895 UTC. [결과](../../artifacts/tasks/CO-01-design-preview-modules/runs/ui-1792388015827-e21688e9/reports/render-summary.json), [로그](../../artifacts/tasks/CO-01-design-preview-modules/runs/ui-1792388015827-e21688e9/logs/command.log). 실제 프레임 안에서 CSS viewport와 미디어 쿼리·상태/안전 여백·인라인 SVG를 확인했다. 프리셋 수정·입력 오류/선택 보존·카드 복제/삭제/이력·한글 저장 재열기·편집본을 버리지 않는 백업·복원·고정 전달본·실제 HTML 다운로드·충돌/저장 위치 오류·취소를 확인했다. 밝음/어두움/좁은 화면도 조작하고 대표 화면을 직접 확인했다. Linux/macOS와 물리 기기·게임 엔진은 미검증이다.

최초 UI 검사 두 번은 검증 코드가 opaque srcdoc의 Chrome 별도 target과 문서 교체 중 frame 전환을 처리하지 못해 exit 1이었다. 제품 코드는 바꾸지 않고 CDP에서 실제 소유 iframe ID를 찾아 대기하도록 수정한 뒤 최종 검사를 통과했다. 실패 run `ui-1792387628187-8f8756dc`(Chrome PID 35556 exit 0, 05:27:12.597 UTC 종료)와 `ui-1792387660852-6f41c6de`(PID 22108 exit 0, 05:27:43.523 UTC 종료)는 각각 wrapper actual exit 1과 시험 서버 종료를 확인했다. 최종 Chrome PID 60456 exit 0·시험 서버 종료도 확인했다. 단위/브라우저 로그는 run별로 독립 저장했다.

정리 결정: 완료된 단위·최종 UI 증거는 실사용 피드백 진단 종료 또는 새로운 근거로 대체될 때 재검토한다. 여섯 실행의 temporary와 이전 단위/36개 UI 및 두 실패 UI 증거는 중단 원인·종료·대체 검증을 이 기록 및 최종 증거에 보존했으므로 삭제 대상으로 검토한다. 실패 producer 상태를 성공으로 바꾸지 않는다. 이 두 실패 group의 실제 구성원/종료는 완전히 확인됐으므로 native group은 본 기록을 provenance로 membership_complete true로 명시 등록하고, 삭제 후에는 실제 종료 근거를 받는 finalize(retirement)로 정리한다. 기본 Node adapter가 실패 state를 membership 불완전으로 투영하는 것과 구분한다.

현재 최종 검사는 일반 입력 폼의 시각 요소를 유지하는 범용 HTML 계약을 추가 확인해 재실행했다. 이전 32개/36개 검사 증거는 이 최종 32개/37개 근거로 대체하고 상세 링크도 최종 run으로 전환했다. 실패 기록의 실제 exit 1은 유지한다.

실사용 서버는 port 4321에서 실행하며 기본 자료 위치는 artifacts/board-data/design/다. HTTP와 주요 제공 파일 여섯 개의 SHA가 소스와 일치함을 확인했다. 최초 합성 디자인 3개로 시작하며 이후 사용자 편집 파일은 시험 정리와 분리해 보존한다.

최종 지침과 실행 서버의 rules 일치도 확인했다. 첫 정리 적용에서 일부 검토 토큰이 만료되어 최종 두 temporary만 삭제됐다. 현재 입력을 고정한 뒤 나머지 열두 group을 재검토·적용했고 모두 삭제됐다. 두 작업을 합해 14개 group의 19개 구성원 경로가 실제로 없음을 확인했다. 정상 상태 producer record 10개와 원래 실패 상태를 보존한 record 4개의 finalize를 완료했다. 최종 단위/UI 증거는 각 작업에 2개 group씩 보존하며 실사용 피드백 진단 종료 또는 새 근거로 대체될 때 재검토한다. 목록·카드 묶음의 서버 공통 import 입력에도 design codec/model을 선언해 이후 검사의 범위를 맞췄다.

실패 producer 종료·대체 검증·실제 삭제 경로와 원래 registry 상태는 [독립 정리 근거](../../artifacts/tasks/CO-01-design-preview-modules/runs/cleanup-1792389201814-5b4f7900/reports/cleanup.json)로 보존했다. 이 파일은 별도 cleanup run에 생성 전 소유를 등록했고 immutable retirement evidence로 사용했다. 실사용 피드백·정리 진단 종료 또는 동등한 검증·정리 근거로 대체되고 참조가 해제될 때 재검토한다. API의 physical_bytes_reclaimed는 null이므로 물리 회수량을 주장하지 않는다. 정리는 프로필별 파일 검증과 토큰 갱신으로 구현·검사보다 오래 걸렸으며 삭제 완료 뒤 actual absence와 producer metadata를 별도로 대조했다.

## 공유 index와 남은 커밋

커밋 직전 목록·카드의 folder-list/card-browser 모듈, catalog-render 검사와 CN 작업 기록이 초기 동결본 이후 별도로 수정·스테이징된 것을 확인했다. CN 기록의 첫 상태도 드래그 정렬·우클릭 설정 후속 작업으로 바뀌었다. 본 작업은 해당 변경을 구현·검증하지 않았으므로 기존 19개 staged 파일을 커밋하거나 교체하지 않았다. 초기 세 실행의 정리 결과만 CN 기록의 해당 문단에 갱신하고 stage하지 않았다.

본 작업의 새 모듈·보드·검사와 공통 server/registry 변경은 working tree에 보존했다. 커밋은 목록·카드 담당이 선행 작업을 마무리한 후 분리한다. project-maintenance.json은 HEAD에 본 작업의 두 묶음을 추가하고 catalog 묶음의 공통 launcher/codec 입력만 갱신한 부분을 stage해야 하며 다른 작업의 working tree 설정을 함께 넣지 않는다. 공통 소스가 추가로 바뀌면 영향 검사를 다시 선택한다. 32개 검사 수용은 기록한 고정 입력 기준이며 이후 별도 변경된 목록·카드 UI의 수용까지 주장하지 않는다. 본 디자인 UI의 37개 검사 입력은 이후 변경하지 않았다.

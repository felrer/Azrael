# 디자인 보드

상태: `partial` — Windows Chrome에서 기기·상태·배율, HTML/CSS 편집·저장·복구와 디자인안 비교를 확인했다. Linux/macOS는 미검증이다. 수용 근거는 [작업 기록](../../../work/CO-01-design-preview-modules/01-plan.md)에 둔다.

프로젝트 루트에서 Node.js 22 이상으로 실행한다. 패키지 설치·번들 빌드가 필요 없다.

```powershell
node docs/boards/server.mjs --board design --port 4321
```

`http://127.0.0.1:4321/`에서 합성 디자인 세 개로 시작한다. 다른 보드와 별도 프로세스로 실행하며 Ctrl+C로 종료한다.
좌측에서 디자인안을 선택하고 기기별 보기 또는 비교 보기로 검토한다. 편집은 즉시 미리보기에 반영되며 **저장**을 눌러 파일에 보존한다.
이름·설명·검토 메모, HTML 본문 조각과 CSS를 수정한다. 추가·복제·삭제와 되돌리기를 제공한다.
입력 오류·파일 오류·버전 충돌은 편집 내용을 보존한다. 다시 열기·복원·저장 위치 변경은 편집본 폐기를 확인한다.
백업은 현재 저장본을 대상으로 하며 편집본을 버리지 않는다.

**기기·상태 설정**에서 선택한 기기의 이름·가로·세로·안전 여백을 수정하거나 새 기기로 추가한다.
전체 프리셋 JSON으로 devices·states·backgrounds·sample을 편집한다. ID는 이름과 별개로 연결에 사용한다.
기기·상태는 각각 16개, 배경은 6개, 디자인은 24개, HTML/CSS 각각 100,000자, 전체 자료 1.5 MiB 이하다.
기기 크기는 120–4096 CSS px, 비교 표본은 32–1024 CSS px다.

배율은 가상 화면을 시각적으로 줄이거나 확대하는 값이다. iframe의 레이아웃 크기와 미디어 쿼리 기준은 기기 크기를 유지한다.
100%에서는 표본의 1 CSS px를 호스트의 1 CSS px로 보여주며 화면을 넘으면 내부에서 스크롤한다. 물리 픽셀·DPR 일치를 뜻하지 않는다.
안전 영역은 사용자가 정한 검토 기준이며 실제 기기에서 측정하지 않는다. 기본 모바일 값도 예시다.

## 두 모듈과 커스텀

공통 `/shared/board.css` 테마 토큰과 `/shared/modules/design-preview.css`를 적용한다.
각 모듈은 `update(props)`와 `destroy()`를 반환한다. 문서·이력·저장·HTML 내보내기는 호출자가 소유하며 모듈은 저장 API를 호출하지 않는다.

```js
import { mountDevicePreview } from '/shared/modules/device-preview.mjs';
import { mountDesignGallery } from '/shared/modules/design-gallery.mjs';

const preview = mountDevicePreview(previewRoot, { onChange: patch => updateSettings(patch) });
preview.update({ devices, states, content: selectedDesign, settings });
const gallery = mountDesignGallery(galleryRoot, { onSelect: id => selectDesign(id) });
gallery.update({ items, selectedId, stateId, backgrounds, sample: { width: 320, height: 220 } });
```

`devices`: `{id,name,width,height,safeArea:{top,right,bottom,left}}[]`.
`states`: `{id,name}[]`. `content/items`: `{id,title,html,css,description?,note?}`.
`settings`: `{deviceId,stateId,zoom:'fit'|'100'|'50',background:'#rrggbb',showSafeArea}`.
`backgrounds`: `{id,name,color:'#rrggbb'}[]`. `onChange`는 변경한 설정만 전달한다.
비교 모듈은 대표 확대 화면과 배경별 1:1 표본을 보여주고, 디자인 선택은 `onSelect`로 전달한다.
호출자가 props를 바꾸면 새 콘텐츠·기기·상태·배경을 추가할 수 있다. [board.js](board.js)가 저장까지 연결한 조합 예제다.

HTML은 본문 조각, CSS는 별도 문자열이다. 상태는 미리보기의 html/body에 `data-preview-state`로 전달한다.

```css
.loading { display: none; }
[data-preview-state="loading"] .loading { display: block; }
.screen { padding-top: var(--preview-safe-top); }
@media (max-width: 480px) { .layout { display: block; } }
```

미리보기는 빈 sandbox 속성을 가진 srcdoc iframe이다. 콘텐츠 HTML에서 스크립트·프레임·외부 링크 등을 제거하고,
CSP로 스크립트와 외부 네트워크를 막는다. 인라인 SVG·data 이미지와 CSS로 정적 시안을 작성한다.
이 경계는 [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)와
[srcdoc의 정책 상속](https://www.w3.org/TR/CSP2/#processing-model)에 따른다.
입력 폼은 디자인으로 표시하며 전송은 차단한다. 사용자 JavaScript·외부 URL·외부 글꼴·외부 CSS 로딩은 이 정적 미리보기의 기능에 포함하지 않는다.

**HTML 내보내기**는 현재 편집본을 같은 정적 문서로 다운로드한다. 기기 설정은 보드의 가상 화면에 적용되며 내보낸 HTML은 열린 브라우저 크기에 반응한다.
**전달본**은 저장된 선택 디자인과 모든 프리셋·메모·해석 지침을 고정한다. 표시된 result.md 경로를 대화에 보낸다.
임의 HTML의 PNG 캡처는 제공하지 않는다. GrowKick의 PNG 내보내기는 전용 SVG 렌더러를 대상으로 하므로 재사용하지 않는다.

기본 자료는 `artifacts/board-data/design/`, 저장 위치 설정은 `artifacts/board-storage/design.json`에 둔다.
설정에서 위치를 바꾸면 해당 폴더의 자료를 열며 기존 파일을 옮기지 않는다. 저장·백업·복원·전달은 [공통 계약](../README.md)을 따른다.
서버 오류는 화면의 requestId와 자료 폴더의 board.log로 추적한다. HTML/CSS 본문을 진단 로그에 기록하지 않는다.

GrowKick `docs/work/CA-01-main-hud-html-design/prototype/hud.js`의 화면 맞춤·상태/기기 조작과
`review-kick-options-v2/index.html`의 확대·밝음/어두움 표본 표시를 참조했다. 게임 전용 객체·터치 컨트롤·실제 자산은 포함하지 않는다.
의도 대상은 Windows x64/Linux x64/macOS ARM64의 로컬 Node/현대 브라우저다. CSS 가상 화면은 실제 OS·엔진 렌더링 검증을 대신하지 않는다.

반복 검사는 프로젝트 관리 도구에서 `boards-design-unit`, `boards-design-ui`를 선택한다.
동일한 직접 진입점은 `node docs/boards/tests/design-verify.mjs unit|ui`다. UI 검사는 Chrome이 필요하며 `BOARD_CHROME_PATH`로 지정한다.
검사는 실행 전 작업 run 소유를 등록하고 시험 자료/프로필과 보존 증거를 분리한다. 정리는 관리 도구의 검토·명시적 결정으로 수행한다.

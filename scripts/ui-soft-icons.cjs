"use strict";

// Review palette only. Evidence identifies the owning action family, not an
// installed icon placement. Conditional variants and text-button proposals are
// explicitly distinguished so a preview cannot become an installation audit.
const GROUPS = [
  { key: "composer", title: "입력", note: "입력 도구와 선택 메뉴. 조건부 기능도 포함한 검토 시안입니다." },
  { key: "navigation", title: "탐색·창", note: "탐색, 창 배치와 보조 대화. 상태 변형은 같은 기호 계열을 사용합니다." },
  { key: "files", title: "파일·작업", note: "파일과 작업 공용 기호. 복사는 메시지·코드·선택·경로에 재사용합니다." },
  { key: "review", title: "메시지·검토·서식", note: "검토 메뉴와 조건부 변경 비교·서식 변형. 모든 기능이 현재 노출됨을 뜻하지 않습니다." },
  { key: "accounts", title: "계정·권한", note: "계정과 권한 기호. 기존 문자 버튼에 붙일 기호 제안도 포함합니다." },
  { key: "settings", title: "설정·연결", note: "설정과 연결 도구. 조건부 서비스·상태 변형을 함께 검토합니다." },
  { key: "scheduling", title: "예약·알림", note: "시간·예약·알림. 예약 문자 버튼용 제안과 조건부 알림 상태입니다." },
  { key: "states", title: "상태", note: "작업 및 메시지 상태의 공용 기호. 상태에 따라 조건부로 사용합니다." },
];

const p = d => `<path d="${d}"/>`;
const c = (x, y, radius) => `<circle cx="${x}" cy="${y}" r="${radius}"/>`;
const r = (x, y, w, h, radius = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}"/>`;
const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="1" fill="currentColor" stroke="none"/>`;
const slash = p("m3 3 18 18");
const document = p("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Zm0 0v5h5");
const bubble = p("M7 4h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H9l-5 3v-4.4A4 4 0 0 1 3 14V8a4 4 0 0 1 4-4Z");
const shield = p("M12 3c2 2 5 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6c3 0 6-1 8-3Z");
const check = p("m8.5 12 2.5 2.5 4.5-5");
const account = c(12, 8, 3.5) + p("M5 20c0-8 14-8 14 0");
const microphone = r(9, 3, 6, 12, 3) + p("M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M9 22h6");
const bell = p("M6 10a6 6 0 0 1 12 0v4l2 3H4l2-3ZM10 21h4");
const speaker = p("M10 4 5 8H3v8h2l5 4Z");
const monitor = r(3, 4, 18, 13) + p("M12 17v4M8 21h8");
const calendar = r(3, 5, 18, 16) + p("M7 3v4M17 3v4M3 10h18");
const branch = c(6, 5, 2) + c(6, 19, 2) + c(18, 5, 2) + p("M6 7v10M18 7v2a3 3 0 0 1-3 3H9a3 3 0 0 0-3 3");

const OWNERS = {
  composer: "artifacts/upstream-ui/26.928.31416/webview/assets/app-initial-9cbfb5c07b41.js (jXt/HMi/c9i/xYi/IHi/FHi/ecr composer and navigation families)",
  navigation: "artifacts/upstream-ui/26.928.31416/webview/assets/app-initial-9cbfb5c07b41.js (jXt/HMi/c9i/xYi/IHi/FHi/ecr navigation family)",
  files: "artifacts/upstream-ui/26.928.31416/webview/assets/app-initial-9f3b5ee5b1d6.js (fE/lE file-action family)",
  review: "artifacts/upstream-ui/26.928.31416/webview/assets/use-code-diff-context-menu-5c2c0fe349df.js (diff/action family; variant placement conditional)",
  accounts: "extensions/azrael-ex/src/usageView.ts (render/action controls); extensions/azrael-ex/src/accountView.ts (tree items)",
  settings: "artifacts/upstream-ui/26.928.31416/webview/assets/settings-page-94cbae2cfc9d.js (settings family)",
  scheduling: "extensions/azrael-ex/src/rootResumeView.ts (STATE_LABELS/reservationHtml)",
  states: "extensions/azrael-ex/src/rootResumeView.ts (STATE_LABELS); extensions/azrael-ex/src/usagePresentation.ts (quota state family)",
};
const ICONS = [];
function add(group, key, label, body, usage, coverage = "conditional", evidence = []) {
  ICONS.push({ id: `I${String(ICONS.length + 1).padStart(3, "0")}`, key, label, group,
    usage: `${usage}${coverage === "conditional" ? " · 조건부 기능/상태 시안" : coverage === "action-proposal" ? " · 문자 버튼용 기호 제안" : ""}`,
    body, evidence: [OWNERS[group], ...evidence], coverage });
}

add("composer", "add", "추가", p("M12 5v14M5 12h14"), "입력 도구 추가", "confirmed");
add("composer", "send", "전송", p("M12 20V5M6 11l4.6-5.4a1.8 1.8 0 0 1 2.8 0L18 11"), "메시지 전송", "confirmed");
add("composer", "stop", "중지", r(6, 6, 12, 12, 3), "응답 생성 중지", "confirmed");
add("composer", "microphone", "음성 입력", microphone, "음성 입력 시작");
add("composer", "microphone-off", "음성 입력 끄기", p("M9.5 4.3A3 3 0 0 1 15 6v4M9 9v3a3 3 0 0 0 4.7 2.5M5 11v1a7 7 0 0 0 11.9 5M19 11v1a7 7 0 0 1-.3 2M12 19v3M9 22h6") + slash, "음성 입력 비활성화");
add("composer", "paperclip", "파일 첨부", p("m21 11.5-8.7 8.7a5.7 5.7 0 0 1-8.1-8.1l8.4-8.4a3.8 3.8 0 0 1 5.4 5.4l-8.4 8.4a1.9 1.9 0 0 1-2.7-2.7L15 6.7"), "입력에 파일 첨부", "confirmed");
add("composer", "mention", "참조(@)", c(11, 12, 3.5) + p("M14.5 8.5v7c0 2 6 2 6-3.5a8.5 8.5 0 1 0-4 7.3"), "파일·도구 참조", "confirmed");
add("composer", "model", "모델 선택", p("m12 3 8 4.5v9L12 21l-8-4.5v-9ZM4 7.5l8 4.5 8-4.5M12 12v9"), "모델 선택 메뉴", "confirmed");
add("composer", "reasoning", "추론 수준", p("M12 6c0-3.4-5-3.9-5.8-.6-2.8.1-4 3.5-2.1 5.4-2.2 2.1-1.1 5.7 1.7 6.2.2 4.2 6.2 4.1 6.2.3Zm0 0c0-3.4 5-3.9 5.8-.6 2.8.1 4 3.5 2.1 5.4 2.2 2.1 1.1 5.7-1.7 6.2-.2 4.2-6.2 4.1-6.2.3M7 9c0 1.7 1.2 2.5 2.5 2.5M17 9c0 1.7-1.2 2.5-2.5 2.5"), "추론 강도 선택", "confirmed");
add("composer", "speed", "속도", p("M4.2 18.5a9 9 0 1 1 15.6 0M6 13h1M12 8v1M17 13h1M13.4 13.4 16.5 10") + c(12, 15, 2), "응답 속도 선택");
add("composer", "agent", "에이전트", r(4, 7, 16, 13, 4) + p("M12 3v4M2 12h2M20 12h2M9 16h6") + c(8, 11, 1) + c(16, 11, 1), "에이전트 선택·실행");
add("composer", "agent-stop", "에이전트 모두 중지", r(4, 7, 16, 13, 4) + p("M12 3v4M2 12h2M20 12h2") + r(9, 11, 6, 5, 1), "실행 중인 에이전트 모두 중지");
add("composer", "skill", "스킬", p("M12 3c1 5 3 7 8 9-5 2-7 4-8 9-1-5-3-7-8-9 5-2 7-4 8-9Z"), "스킬 선택", "confirmed");
add("composer", "plugin", "플러그인", p("M8.5 5H5a1 1 0 0 0-1 1v3.5a2.5 2.5 0 1 1 0 5V19a1 1 0 0 0 1 1h4.5a2.5 2.5 0 1 1 5 0H19a1 1 0 0 0 1-1v-4.5a2.5 2.5 0 1 1 0-5V6a1 1 0 0 0-1-1h-4.5a3 3 0 1 0-6 0Z"), "플러그인 도구 선택");
add("composer", "chat-reference", "대화 참조", bubble + p("M8 8v6M5 11h6M14 9h3M14 13h3"), "다른 대화 참조");

add("navigation", "search", "검색", c(10, 10, 6) + p("m15 15 5 5"), "대화·설정 검색", "confirmed");
add("navigation", "compose", "새 대화", p("M10 4H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3M9 12l8-8a2 2 0 0 1 3 3l-8 8-4 1Z"), "새 대화 작성", "confirmed");
add("navigation", "history", "기록", p("M3 4v5h5M3.6 9a9 9 0 1 1 1.1 9M12 7v5l3.5 2"), "대화·작업 기록", "confirmed");
add("navigation", "settings", "설정", p("M4 6h2M10 6h10M4 12h10M18 12h2M4 18h4M12 18h8") + c(8, 6, 2) + c(16, 12, 2) + c(10, 18, 2), "설정 메뉴", "confirmed");
add("navigation", "chevron-down", "펼치기", p("m6 9 4.6 5a2 2 0 0 0 2.8 0L18 9"), "메뉴·세부 정보 펼치기", "confirmed", ["extensions/azrael-ex/src/usagePresentation.ts (usageToggleHtml)"]);
add("navigation", "chevron-up", "접기", p("m6 15 4.6-5a2 2 0 0 1 2.8 0l4.6 5"), "메뉴·세부 정보 접기", "confirmed", ["extensions/azrael-ex/src/usagePresentation.ts (usageToggleHtml)"]);
add("navigation", "chevron-left", "이전", p("m15 6-5 4.6a2 2 0 0 0 0 2.8l5 4.6"), "이전 항목·대화 탐색 뒤로", "confirmed", ["artifacts/upstream-ui/26.928.31416/webview/assets/back-forward-navigation-buttons-62cc4c498be3.js (d)"]);
add("navigation", "chevron-right", "다음", p("m9 6 5 4.6a2 2 0 0 1 0 2.8L9 18"), "다음 항목·대화 탐색 앞으로", "confirmed", ["artifacts/upstream-ui/26.928.31416/webview/assets/back-forward-navigation-buttons-62cc4c498be3.js (d)"]);
add("navigation", "more", "더보기", c(5, 12, 1) + c(12, 12, 1) + c(19, 12, 1), "추가 동작 메뉴", "confirmed");
add("navigation", "close", "닫기·취소", p("m6 6 12 12M18 6 6 18"), "창 닫기·동작 취소·인라인 변경 거절", "confirmed", ["artifacts/upstream-ui/26.928.31416/webview/assets/inline-file-diff-review-147b3f79e451.js (O/A reject)"]);
add("navigation", "fullscreen", "화면 확대", p("M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4"), "창 최대화");
add("navigation", "fullscreen-exit", "화면 복원", p("M3 9h4a2 2 0 0 0 2-2V3M15 3v4a2 2 0 0 0 2 2h4M21 15h-4a2 2 0 0 0-2 2v4M9 21v-4a2 2 0 0 0-2-2H3"), "원래 창 크기 복원");
add("navigation", "sidebar-hide", "사이드바 접기", r(3, 4, 18, 16) + p("M9 4v16m7-11-3 3 3 3"), "왼쪽 사이드바 숨기기");
add("navigation", "sidebar-show", "사이드바 펼치기", r(3, 4, 18, 16) + p("M9 4v16m4-11 3 3-3 3"), "왼쪽 사이드바 표시");
add("navigation", "pane-left", "왼쪽 창", r(3, 4, 18, 16) + p("M9 4v16M6 9v6"), "왼쪽 보조 창 배치");
add("navigation", "pane-right", "오른쪽 창", r(3, 4, 18, 16) + p("M15 4v16M18 9v6"), "오른쪽 보조 창 배치");
add("navigation", "pane-bottom", "아래 창", r(3, 4, 18, 16) + p("M3 14h18M9 17h6"), "아래 보조 창 배치");
add("navigation", "side-chat", "보조 대화", p("M10 4H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h4M10 4v16M15 5h4a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-3l-3 3V8a3 3 0 0 1 2-3Z"), "보조 대화 창");

add("files", "file", "파일", document, "일반 파일", "confirmed");
add("files", "folder", "폴더", p("M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"), "폴더", "confirmed");
add("files", "folder-open", "폴더 열기", p("M3 17V7a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8L11 8h7a2 2 0 0 1 2 2M5.5 12h14.7a1 1 0 0 1 1 1.3l-1.8 6a2.4 2.4 0 0 1-2.3 1.7H5.4a2.4 2.4 0 0 1-2.3-3.1l1.4-4.5a2 2 0 0 1 1-1.4Z"), "폴더 열기");
add("files", "image", "이미지", r(3, 3, 18, 18, 3) + c(8, 8, 2) + p("m3 17 5-5 4 4 4-6 5 7"), "이미지 파일·첨부", "confirmed");
add("files", "download", "다운로드", p("M12 3v12m-5-5 5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"), "파일 내려받기", "confirmed");
add("files", "upload", "업로드", p("M12 15V3m-5 5 5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"), "파일 올리기");
add("files", "external-link", "외부에서 열기", p("M13 3h8v8M21 3 11 13M10 5H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-4"), "외부 앱·브라우저에서 열기", "confirmed");
add("files", "link", "링크", p("m9 15 6-6M8 11l-3 3a4.2 4.2 0 0 0 6 6l3-3M10 7l3-3a4.2 4.2 0 0 1 6 6l-3 3"), "링크 복사·삽입");
add("files", "file-search", "파일 검색", p("M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M12 3v5h5l-5-5") + c(15, 14, 4) + p("m18 17 3 3"), "파일 내용 검색");
add("files", "open-with", "연결 프로그램", r(3, 3, 8, 8) + r(13, 13, 8, 8) + p("M15 4h5v5M20 4l-6 6M4 15v5h5"), "연결 프로그램 선택");
add("files", "copy", "복사", r(8, 8, 13, 13, 3) + p("M16 8V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h2"), "메시지·코드·선택·경로 복사", "confirmed");
add("files", "edit", "편집·이름 변경", p("m5 15 11-11a2.8 2.8 0 0 1 4 4L9 19l-5 1Zm9-9 4 4M13 21h7"), "내용 편집·이름 변경·인라인 변경 편집", "confirmed", ["artifacts/upstream-ui/26.928.31416/webview/assets/inline-file-diff-review-147b3f79e451.js (O/A edit)"]);
add("files", "delete", "삭제", p("M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M10 10v7M14 10v7"), "파일·대화 삭제", "confirmed");
add("files", "archive", "보관", r(3, 3, 18, 5) + p("M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M9 12h6"), "대화·항목 보관");
add("files", "pin", "고정", p("M8 3h8M9 3v6l-4 5h14l-4-5V3M12 14v7"), "대화·항목 고정");
add("files", "unpin", "고정 해제", p("M8 3h8M15 3v6l4 5h-5M9 7v2l-4 5h5M12 17v4") + slash, "대화·항목 고정 해제");
add("files", "line-wrap", "줄바꿈", p("M3 5h18M3 11h14a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 17h4"), "긴 코드 줄바꿈");
add("files", "terminal", "터미널", r(3, 4, 18, 16, 3) + p("m6 9 3 3-3 3M12 16h5"), "명령·터미널 출력");
add("files", "code", "코드", p("m7 6-5 6 5 6M17 6l5 6-5 6M14 3l-4 18"), "코드 파일·코드 블록");

add("review", "diff", "변경 내용", p("M5 3v18M19 3v18M9 7h6M12 4v6M9 17h6"), "추가·삭제 변경 비교");
add("review", "split-view", "분할 보기", r(3, 3, 18, 18, 3) + p("M12 3v18M6 8h3M15 8h3M6 13h3M15 16h3"), "변경 전후 나란히 보기");
add("review", "unified-view", "통합 보기", r(3, 3, 18, 18, 3) + p("M7 7h10M7 12h10M7 17h10"), "변경 내용 한 창에서 보기");
add("review", "next-change", "다음 변경", p("M6 3h12M12 7v14m-5-5 5 5 5-5"), "다음 변경 위치");
add("review", "previous-change", "이전 변경", p("M6 21h12M12 17V3m-5 5 5-5 5 5"), "이전 변경 위치");
add("review", "apply-change", "변경 적용", document + p("m8 14 3 3 5-6"), "제안된 변경 적용·인라인 변경 수락", "confirmed", ["artifacts/upstream-ui/26.928.31416/webview/assets/inline-file-diff-review-147b3f79e451.js (O/A accept)"]);
add("review", "revert", "되돌리기", p("M8 4 3 9l5 5M3 9h10a6 6 0 0 1 0 12h-2"), "선택 변경 되돌리기");
add("review", "request-change", "수정 요청", bubble + p("m8 12.5 5.5-5.5a1.4 1.4 0 0 1 2 2L10 14.5l-2.5.5Z"), "검토 중 수정 요청");
add("review", "branch", "분기", branch, "대화·작업 분기");
add("review", "pull-request", "변경 요청", c(6, 5, 2) + c(6, 19, 2) + c(18, 19, 2) + p("M6 7v10M18 17V9a4 4 0 0 0-4-4h-2m3-3-3 3 3 3"), "변경 요청 열기");
add("review", "review", "검토", p("M12 5c5 0 8 4 10 7-2 3-5 7-10 7S4 15 2 12c2-3 5-7 10-7Z") + c(12, 12, 3), "변경·메시지 검토");
add("review", "message", "메시지", bubble + p("M7 9h10M7 13h7"), "메시지·대화");
add("review", "share", "공유", c(18, 5, 3) + c(5, 12, 3) + c(18, 19, 3) + p("m8 10 7-4M8 14l7 4"), "대화·메시지 공유");
add("review", "reply", "답장", p("m9 5-6 6 6 6M3 11h10a7 7 0 0 1 7 7v2"), "메시지 답장");
add("review", "bullet-list", "글머리 목록", c(4, 6, 1) + c(4, 12, 1) + c(4, 18, 1) + p("M9 6h12M9 12h12M9 18h12"), "글머리 목록 서식");
add("review", "numbered-list", "번호 목록", p("m3 4 2-1v6M3 9h4M3 15a2 2 0 0 1 4 0c0 2-4 3-4 5h4M11 6h10M11 12h10M11 18h10"), "번호 목록 서식");
add("review", "bold", "굵게", p("M6 3h7a4.5 4.5 0 0 1 0 9H6Zm0 9h8a4.5 4.5 0 0 1 0 9H6Z"), "굵게 서식");
add("review", "italic", "기울임", p("M10 3h10M4 21h10M15 3 9 21"), "기울임 서식");
add("review", "heading", "제목", p("M4 4v16M14 4v16M4 12h10M18 15l2-1v7"), "제목 서식");
add("review", "stage", "스테이징", p("M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4M12 3v10m-4-4 4 4 4-4M8 17h8"), "파일 스테이징·모든 파일 스테이징", "confirmed", ["artifacts/upstream-ui/26.928.31416/webview/assets/code-diff-a141e856ad2b.js (It: stage-file/stage-all)"]);
add("review", "unstage", "스테이징 해제", p("M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4M12 13V3m-4 4 4-4 4 4M8 17h8"), "파일 스테이징 해제·모든 파일 스테이징 해제", "confirmed", ["artifacts/upstream-ui/26.928.31416/webview/assets/code-diff-a141e856ad2b.js (It: unstage-file/unstage-all)"]);

add("accounts", "account", "계정", account, "현재 계정·계정 메뉴", "confirmed");
add("accounts", "users", "여러 계정", c(9, 8, 3) + p("M3 20c0-7 12-7 12 0M16 5a3 3 0 0 1 0 6M18 15c3 0 4 2 4 5"), "여러 계정 목록", "action-proposal");
add("accounts", "account-add", "계정 추가", c(9, 8, 3) + p("M3 20c0-7 12-7 12 0M18 5v8M14 9h8"), "계정 추가", "action-proposal");
add("accounts", "account-remove", "계정 제거", c(9, 8, 3) + p("M3 20c0-7 12-7 12 0M14 9h8"), "계정 제거", "action-proposal");
add("accounts", "account-switch", "계정 전환", c(7, 7, 3) + p("M2 19c0-6 10-6 10 0M15 6h6m-3-3 3 3-3 3M21 18h-6m3-3-3 3 3 3"), "사용할 계정 전환", "action-proposal");
add("accounts", "refresh", "새로고침·재시도", p("M20 4v6h-6M4 20v-6h6M20 10A8 8 0 0 0 5 6M4 14a8 8 0 0 0 15 4"), "사용량 갱신·실패 재시도", "action-proposal");
add("accounts", "login", "로그인·재인증", p("M14 3h4a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-4M3 12h12m-4-4 4 4-4 4"), "로그인·계정 재인증", "action-proposal");
add("accounts", "logout", "로그아웃", p("M10 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h4M9 12h12m-4-4 4 4-4 4"), "계정 로그아웃", "action-proposal");
add("accounts", "key", "인증 키", c(7, 8, 4) + p("m10 11 10 10M16 17l3-3M13 14l3-3"), "API 키·인증 자격");
add("accounts", "check", "선택·현재 계정", p("m5 12 4.5 4.5L19 7"), "선택됨·현재 계정 표시", "action-proposal");
add("accounts", "shield", "권한", shield, "권한 모드 공용", "confirmed", ["artifacts/upstream-ui/26.928.31416/webview/assets/permissions-mode-dropdown-81883922faea.js"]);
add("accounts", "shield-check", "전체 액세스", shield + check, "전체 액세스 권한", "confirmed", ["scripts/create-ui-design-preview.cjs (soft.permission); artifacts/upstream-ui/26.928.31416/webview/assets/permissions-mode-dropdown-81883922faea.js"]);
add("accounts", "shield-code", "사용자 지정 권한", shield + p("m9.5 9.5-2.5 3 2.5 3M14.5 9.5l2.5 3-2.5 3"), "사용자 지정 권한", "conditional", ["artifacts/upstream-ui/26.928.31416/webview/assets/permissions-mode-dropdown-81883922faea.js"]);
add("accounts", "approval", "승인 요청", p("M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 5.5v-2a1.5 1.5 0 0 1 3 0V11M14 5.5a1.5 1.5 0 0 1 3 0V12M17 8.5a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1c-2.3 0-4-1.3-5.2-3l-3.9-5.4a1.7 1.7 0 0 1 2.6-2.2L8 13"), "작업 실행 승인 요청", "confirmed", ["artifacts/upstream-ui/26.928.31416/webview/assets/permissions-mode-dropdown-81883922faea.js"]);
add("accounts", "lock", "잠금", r(4, 10, 16, 11, 3) + p("M7 10V7a5 5 0 0 1 10 0v3M12 14v3"), "보호된 권한·잠긴 항목");
add("accounts", "unlock", "잠금 해제", r(4, 10, 16, 11, 3) + p("M7 10V7a5 5 0 0 1 9-3M12 14v3"), "권한 잠금 해제");
add("accounts", "usage", "사용량", p("M4 21V12a2 2 0 0 1 4 0v9M10 21V6a2 2 0 0 1 4 0v15M16 21V9a2 2 0 0 1 4 0v12M3 21h18"), "계정 사용량·할당량", "action-proposal", ["extensions/azrael-ex/src/usagePresentation.ts (quota functions)"]);
add("accounts", "ticket", "리셋 티켓", p("M4 5h16a1 1 0 0 1 1 1v3a3 3 0 0 0 0 6v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 1 1-1ZM15 5v3M15 11v2M15 16v3"), "할당량 리셋 티켓 사용", "action-proposal");
add("accounts", "auto-switch", "자동 전환", p("M21 4v5h-5M3 20v-5h5M21 9A9 9 0 0 0 5 6M3 15a9 9 0 0 0 16 3M13 8l-3 5h4l-3 4"), "계정 자동 전환 허용", "action-proposal");

add("settings", "computer", "컴퓨터", monitor, "컴퓨터 사용 설정", "confirmed", ["artifacts/upstream-ui/26.928.31416/webview/assets/computer-use-settings-547466da95c7.js"]);
add("settings", "pointer", "컴퓨터 제어", p("M5 3v17l5-5 4 7 3-2-4-7h7Z"), "컴퓨터 제어 도구", "conditional", ["artifacts/upstream-ui/26.928.31416/webview/assets/computer-use-settings-547466da95c7.js"]);
add("settings", "permission-settings", "권한 관리", shield + p("M8 10h.5M11.5 10H16M8 15h4.5M15.5 15h.5") + c(10, 10, 1.5) + c(14, 15, 1.5), "컴퓨터·도구 권한 관리", "conditional", ["artifacts/upstream-ui/26.928.31416/webview/assets/computer-use-settings-547466da95c7.js"]);
add("settings", "instructions", "지침 문서", document + p("M8 12h7M8 16h7"), "지침 파일 설정", "action-proposal", ["scripts/inject-instruction-settings.cjs"]);
add("settings", "keyboard", "키보드 단축키", r(2, 5, 20, 14, 3) + p("M6 9h1M11.5 9h1M17 9h1M6 13h1M11.5 13h1M17 13h1M8 16h8"), "키보드 단축키", "confirmed");
add("settings", "globe", "브라우저·웹", c(12, 12, 9) + p("M3 12h18M12 3c-6 5-6 13 0 18 6-5 6-13 0-18Z"), "웹·브라우저 도구");
add("settings", "server", "서버", r(3, 3, 18, 7) + r(3, 14, 18, 7) + p("M7 6.5h1M7 17.5h1M13 6.5h4M13 17.5h4"), "서버 연결 설정");
add("settings", "apps", "앱", r(3, 3, 7, 7) + r(14, 3, 7, 7) + r(3, 14, 7, 7) + r(14, 14, 7, 7), "앱·연결 도구");
add("settings", "sound", "소리 켜기", speaker + p("M14 8a6 6 0 0 1 0 8M17 4a11 11 0 0 1 0 16"), "알림 소리 사용");
add("settings", "sound-off", "소리 끄기", speaker + p("m15 8 7 8M22 8l-7 8"), "알림 소리 끄기");
add("settings", "sun", "밝은 화면", c(12, 12, 4) + p("M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"), "밝은 테마", "confirmed");
add("settings", "moon", "어두운 화면", p("M20 15A9 9 0 1 1 9 3a7 7 0 0 0 11 12Z"), "어두운 테마", "confirmed");
add("settings", "connection", "연결", p("M8 3v5M16 3v5M6 8h12v4a6 6 0 0 1-12 0ZM12 18v4"), "도구·서버 연결");
add("settings", "connection-off", "연결 해제", p("M8 3v2M16 3v5M13 8h5v4a6 6 0 0 1-1 3M6 8v4a6 6 0 0 0 6 6v4") + slash, "도구·서버 연결 끊기");
add("settings", "language", "언어", p("M3 5h11M8 3v2M5 5c1 5 4 8 8 10M12 5c-1 5-4 8-9 10M13 21l4-10 4 10M15 17h4"), "표시 언어 선택");

add("scheduling", "clock", "시간·대기", c(12, 12, 9) + p("M12 6v6l4 3"), "예약 시간·남은 대기", "action-proposal");
add("scheduling", "calendar", "예약", calendar + p("M8 14h3M8 17h7"), "루트 재개 예약", "action-proposal");
add("scheduling", "play", "재개", p("M7 5a1 1 0 0 1 1.5-1l12 7a1 1 0 0 1 0 2l-12 7A1 1 0 0 1 7 19Z"), "지금 재개", "action-proposal");
add("scheduling", "pause", "일시정지", r(5, 4, 4, 16, 1.5) + r(15, 4, 4, 16, 1.5), "작업 일시정지");
add("scheduling", "queue", "대기열", p("M4 5h16M4 11h16M4 17h9m4-2 4 3-4 3Z"), "예약·작업 대기열");
add("scheduling", "cancel-reservation", "예약 취소", calendar + p("m9.5 13.5 5 5M14.5 13.5l-5 5"), "재개 예약 취소", "action-proposal");
add("scheduling", "bell", "알림", bell, "알림 설정·새 알림");
add("scheduling", "bell-off", "알림 끄기", p("M9 4a6 6 0 0 1 9 6v2M6 8v6l-2 3h12M10 21h4") + slash, "알림 비활성화");

add("states", "spinner", "진행 중", p("M12 3a9 9 0 1 1-9 9"), "응답·조회·작업 진행 중");
add("states", "warning", "경고", p("M10.5 4a1.7 1.7 0 0 1 3 0l8 14a2 2 0 0 1-1.7 3H4.2a2 2 0 0 1-1.7-3ZM12 9v5") + dot(12, 17), "주의가 필요한 상태");
add("states", "info", "정보", c(12, 12, 9) + p("M12 11v6") + dot(12, 7), "정보 안내");
add("states", "error", "오류", c(12, 12, 9) + p("m8 8 8 8M16 8l-8 8"), "작업·조회 오류");
add("states", "success", "완료", c(12, 12, 9) + p("m7 12 3.5 3.5L17 9"), "작업 완료");
add("states", "unread", "읽지 않음", p("M13 4H7a4 4 0 0 0-4 4v6a4 4 0 0 0 1 2.6V21l5-3h8a4 4 0 0 0 4-4v-3") + '<circle cx="19" cy="5" r="2.5" fill="currentColor" stroke="none"/>', "읽지 않은 메시지");
add("states", "blocked", "차단", c(12, 12, 9) + p("m5.5 5.5 13 13"), "권한·작업 차단");

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function iconSvg(icon, size = 20, standalone = false) {
  const accessibility = standalone ? `role="img" aria-label="${escapeAttribute(icon.label)}"` : 'aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${accessibility}>${icon.body}</svg>`;
}

module.exports = { GROUPS, ICONS, iconSvg };

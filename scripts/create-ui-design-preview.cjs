"use strict";

// Local icon/static-label candidates with the agreed dynamic-content typography.
const fs = require("node:fs");
const path = require("node:path");
const { FONT_FAMILY, CONTENT_FONT_CSS, copyContentFontAssets } = require("./content-fonts.cjs");
const output = path.resolve(__dirname, "../artifacts/visualizations/azrael-ui-identity");
const names = { add: "추가", search: "검색", history: "기록", settings: "설정", compose: "새 채팅", account: "계정", permission: "권한", send: "전송" };
const styles = [
  { id: "standard", title: "A · 단순 선", note: "익숙한 형태, 둥근 선 끝", cap: "round", join: "round", width: 1.65,
    shapes: {
      add: '<path d="M12 5v14M5 12h14"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
      history: '<path d="M4 7v5h5M4 12a8 8 0 1 0 2.3-5.7M12 7v5l3 2"/>',
      settings: '<path d="m9 3-.6 2.5-2.2 1.3-2.5-.7-2 3.4L3.5 11v2l-1.8 1.5 2 3.4 2.5-.7 2.2 1.3L9 21h6l.6-2.5 2.2-1.3 2.5.7 2-3.4-1.8-1.5v-2l1.8-1.5-2-3.4-2.5.7-2.2-1.3L15 3Z"/><circle cx="12" cy="12" r="3"/>',
      compose: '<path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M14 4l3 3M9 12l8-8 3 3-8 8-4 1Z"/>',
      account: '<circle cx="12" cy="8" r="3"/><path d="M5 20v-2a7 7 0 0 1 14 0v2"/>',
      permission: '<path d="M12 3 20 6v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
      send: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
    } },
  { id: "geometric", title: "B · 각진 기하", note: "직선과 절제된 모서리", cap: "square", join: "miter", width: 1.6,
    shapes: {
      add: '<path d="M12 5v14M5 12h14"/>',
      search: '<path d="m7 4 7 0 4 4v6l-4 4H7l-4-4V8Zm10 13 4 4"/>',
      history: '<path d="M4 8v4h4M4 12V8l5-5h7l5 5v8l-5 5H9l-4-4M12 7v5h4"/>',
      settings: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6M16 9v6M10 15v6"/>',
      compose: '<path d="M10 4H4v16h16v-6M9 11l9-9 4 4-9 9H9Zm6-6 4 4"/>',
      account: '<path d="M8 3h8v8H8ZM4 21v-6h16v6"/>',
      permission: '<path d="m12 3 8 3v8l-8 7-8-7V6Zm-4 9 3 3 5-6"/>',
      send: '<path d="M12 20V4M5 11l7-7 7 7"/>',
    } },
  { id: "soft", title: "C · 부드러운 곡선", note: "곡선과 넓은 내부 여백", cap: "round", join: "round", width: 1.8,
    shapes: {
      add: '<path d="M12 5v14M5 12h14"/>',
      search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
      history: '<path d="M4 5v6h6M4 11a8 8 0 1 1 2 6M12 7v5l3 2"/>',
      settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--surface,white)"/><circle cx="16" cy="12" r="2" fill="var(--surface,white)"/><circle cx="10" cy="18" r="2" fill="var(--surface,white)"/>',
      compose: '<path d="M10 4H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3M9 12l8-8a2 2 0 0 1 3 3l-8 8-4 1Z"/>',
      account: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-8 14-8 14 0"/>',
      permission: '<path d="M12 3c2 2 5 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6c3 0 6-1 8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
      send: '<path d="M12 20V5M6 11l4.6-5.4a1.8 1.8 0 0 1 2.8 0L18 11"/>',
    } },
];
const svg = (style, name, size = 20) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${style.width}" stroke-linecap="${style.cap}" stroke-linejoin="${style.join}" aria-hidden="true">${style.shapes[name]}</svg>`;
fs.mkdirSync(output, { recursive: true });
copyContentFontAssets(output);
for (const style of styles) {
  const dir = path.join(output, style.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of Object.keys(names)) fs.writeFileSync(path.join(dir, `${name}.svg`), svg(style, name, 24));
}
const iconRows = styles.map(style => `<section class="icon-family"><h3>${style.title}</h3><p>${style.note}</p><div class="icon-grid">${Object.entries(names).map(([name, label]) => `<div class="glyph"><span>${label}</span><div>${[16, 20, 24].map(size => svg(style, name, size)).join("")}</div></div>`).join("")}</div><div class="dark"><span>어두운 배경 · 20px</span><div>${Object.keys(names).map(name => svg(style, name)).join("")}</div></div></section>`).join("");
const fonts = [
  { family: '"Noto Sans KR", "Malgun Gothic", sans-serif', title: "1 · Noto Sans KR", note: "고정 한글·영문 문구에 함께 적용" },
  { family: '"Malgun Gothic", sans-serif', title: "2 · 맑은 고딕", note: "Windows 기본 한글 서체" },
  { family: '"Segoe UI", "Malgun Gothic", sans-serif', title: "3 · Segoe UI + 맑은 고딕", note: "영문은 Segoe UI, 한글은 맑은 고딕" },
];
const fontRows = fonts.map(font => `<section class="font-sample"><h3>${font.title}</h3><p>${font.note}</p><div class="mock" style='--candidate-font:${font.family}'><header><strong class="fixed">Azrael</strong><div>${svg(styles[0], "history")}${svg(styles[0], "settings")}${svg(styles[0], "compose")}</div></header><div class="fixed muted">채팅</div><div class="dynamic chat-title"><span>Azrael 공개 배포 및 통합 검토</span> <small>12분</small></div><div class="dynamic chat-title"><span>자동 타이머 기능 및 UI 개선</span> <small>6시간</small></div><div class="menu"><div class="dynamic muted">user@example.com</div><div class="fixed">${svg(styles[0], "account")}계정 및 사용량</div><div class="fixed">${svg(styles[0], "history")}루트 재개 예약</div><div class="fixed">${svg(styles[0], "settings")}Azrael 설정</div><div class="fixed">키보드 단축키</div></div><div class="composer"><div class="placeholder fixed">-</div><div class="dynamic input">이 파일의 내용을 정리해주세요</div><footer><span>${svg(styles[0], "add")}</span><span class="fixed permission">${svg(styles[0], "permission", 16)}전체 액세스</span><span class="dynamic model">6.1 Sol Medium</span>${svg(styles[0], "send")}</footer></div><div class="permissions"><span class="fixed">승인 요청</span><span class="fixed">전체 액세스</span></div></div></section>`).join("");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Azrael 아이콘·폰트 비교</title><style>${CONTENT_FONT_CSS.replaceAll('./azrael-fonts/', './webview/assets/azrael-fonts/')}
*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#24272c;font-family:"Segoe UI","Malgun Gothic",sans-serif}#azrael-design{max-width:1180px;margin:auto;padding:28px 30px;background:white}#azrael-design h1{font-size:28px;font-weight:600;margin:12px 0}#azrael-design h2{font-size:20px;margin:24px 0 14px}#azrael-design h3{font-size:16px;margin:0 0 6px}#azrael-design p{font-size:13px;color:#555d66;line-height:1.6;margin:0 0 16px}.meta{font-size:12px;color:#69727b;letter-spacing:.04em}.compare{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.icon-family,.font-sample{min-width:0}.icon-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.glyph{border-bottom:1px solid #e7e9ed;padding:8px 0}.glyph span{font-size:12px;color:#636b75}.glyph div{height:40px;display:flex;align-items:center;gap:16px}.dark{--surface:#20242b;background:var(--surface);color:#edf0f5;border-radius:8px;padding:12px;margin-top:12px}.dark>span{font-size:11px;color:#b9c0c9}.dark>div{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}.policy{font-size:13px;line-height:1.65;padding:12px 0;margin-top:14px;border-block:1px solid #dce0e5}.mock{background:#f9f9fb;border:1px solid #e0e2e7;border-radius:10px;padding:14px;font-size:14px}.fixed{font-family:var(--candidate-font);font-weight:400}.dynamic{font-family:${FONT_FAMILY};font-weight:400}.mock header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.mock header strong{font-size:18px}.mock header>div{display:flex;gap:14px}.muted{color:#656d77}.chat-title{display:flex;gap:10px;align-items:center;margin-top:12px;font-size:13px}.chat-title>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-title small{font-size:10px;margin-left:auto;white-space:nowrap;color:#626a74}.menu{border:1px solid #e2e4e9;background:white;border-radius:10px;padding:10px;margin-top:20px}.menu>div{min-height:32px;display:flex;align-items:center;gap:10px}.menu>div:first-child{border-bottom:1px solid #eaecf0;margin-bottom:6px;padding-bottom:8px}.composer{background:white;border:1px solid #e0e2e7;border-radius:14px;padding:12px;margin-top:20px}.placeholder{color:#747c86;height:18px}.input{font-size:12px;margin-bottom:22px}.composer footer{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.composer footer>span{display:flex;align-items:center;gap:5px}.permission{font-size:11px;color:#414954;white-space:nowrap}.model{font-size:10px;margin-left:auto;white-space:nowrap;order:2;flex-basis:100%;justify-content:flex-end}.permissions{display:flex;gap:18px;margin-top:12px;font-size:12px;color:#414954}.legend{margin-top:14px;font-size:12px;color:#555d66}.font-sample h3{margin-top:10px}svg{flex-shrink:0}.footer{margin-top:20px;font-size:11px;color:#626b75;line-height:1.6}@media(max-width:740px){#azrael-design{padding:20px 16px}.compare{grid-template-columns:1fr}.icon-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.glyph div{gap:8px}.mock{max-width:500px}}@media(max-width:400px){.icon-grid{grid-template-columns:1fr 1fr}}@media print{body{background:white}#azrael-design{padding:0;max-width:none}h2{break-after:avoid}.compare{gap:16px}.icon-family,.font-sample{break-inside:avoid}.font-figure{break-before:page}.footer{break-inside:avoid}}
</style><main id="azrael-design"><div class="meta">AZRAEL / 디자인 후보 / 2026-10-04</div><h1>아이콘과 고정 UI 서체 비교</h1><p>아이콘과 고정 UI 서체는 후보입니다. 가변 텍스트는 Consolas + 경기천년바탕으로 확정했습니다.</p><h2>1. 아이콘 · 같은 기능을 세 가지 형태로</h2><p>각 칸은 16 / 20 / 24px 순서입니다. 동일한 크기에서 선, 여백, 인식성을 비교합니다.</p><div class="compare">${iconRows}</div><div class="policy">정책 초안 · SVG 24×24 좌표계 / 기본 20px, 보조 16px / currentColor / 기능별 형태는 밝은·어두운 테마에서 동일 / 클릭 영역은 표시 크기와 별도로 확보 / 상태는 색과 문구를 함께 사용 / 실제 승인 요청만 권한 승인 동작을 표시</div><section class="font-figure"><h2>2. 폰트 · 고정 문구만 변경</h2><p>제목·버튼·메뉴의 고정 문구는 후보 서체를 사용합니다. 이메일, 채팅 제목, 입력 내용, 모델 이름과 시간은 세 시안 모두 Consolas + 경기천년바탕입니다.</p><div class="compare">${fontRows}</div><div class="legend">승인 요청과 전체 액세스는 같은 전경색입니다. 입력 안내는 <code>-</code>만 표시합니다.</div></section><div class="footer">로컬 HTML + SVG + 경기천년바탕 웹폰트 · 실행 중 외부 네트워크·폰트 다운로드 없음. 세 서체는 제작 환경의 설치 상태를 확인했습니다. 다른 PC에서는 설치 상태에 따라 대체 서체가 사용됩니다. 그림은 제공된 화면의 구조를 참조한 후보이며, 실행 중인 제품 화면을 캡처한 것이 아닙니다.</div></main></html>`;
fs.writeFileSync(path.join(output, "index.html"), html);
console.log(JSON.stringify({ html: path.join(output, "index.html"), families: styles.map(s => s.id), svgCount: styles.length * Object.keys(names).length }));

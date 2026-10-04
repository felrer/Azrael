"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ICONS, GROUPS, iconSvg } = require("./ui-soft-icons.cjs");
const { FONT_FAMILY, CONTENT_FONT_CSS, copyContentFontAssets } = require("./content-fonts.cjs");
const output = path.resolve(__dirname, "../artifacts/visualizations/azrael-ui-icons");
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
if (new Set(ICONS.map(icon => icon.id)).size !== ICONS.length || new Set(ICONS.map(icon => icon.key)).size !== ICONS.length) {
  throw new Error("Icon review IDs and keys must be unique.");
}
const groupKeys = new Set(GROUPS.map(group => group.key));
if (ICONS.some(icon => !/^I\d{3}$/.test(icon.id) || !groupKeys.has(icon.group) || !icon.body || !icon.label)) {
  throw new Error("Icon review catalog has an invalid item or group.");
}
fs.mkdirSync(path.join(output, "svg"), { recursive: true });
copyContentFontAssets(output);

for (const icon of ICONS) {
  fs.writeFileSync(path.join(output, "svg", `${icon.id.toLowerCase()}-${icon.key}.svg`), iconSvg(icon, 24, true));
}
fs.writeFileSync(path.join(output, "catalog.json"), JSON.stringify({ style: "soft", stroke: 1.8, grid: 24, groups: GROUPS, icons: ICONS }, null, 2) + "\n");

const sections = GROUPS.map(group => {
  const icons = ICONS.filter(icon => icon.group === group.key);
  return `<section class="icon-section" id="${group.key}"><h2>${escape(group.title)} <small>${icons.length}개</small></h2><p class="section-note">${escape(group.note)}</p><div class="cards">${icons.map(icon => `<figure class="icon-card" id="${icon.id}"><figcaption><code>${icon.id}</code><span>${escape(icon.label)}</span></figcaption><div class="large">${iconSvg(icon, 40)}</div><div class="sizes" aria-label="16, 20, 24 픽셀">${[16, 20, 24].map(size => `<span>${iconSvg(icon, size)}<small>${size}</small></span>`).join("")}</div><div class="dark" aria-label="어두운 배경">${[16, 20, 24].map(size => iconSvg(icon, size)).join("")}</div><p class="usage">${escape(icon.usage)}</p></figure>`).join("")}</div></section>`;
}).join("");

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Azrael 전체 아이콘 시안 · 부드러운 곡선</title><style>
${CONTENT_FONT_CSS.replaceAll("./azrael-fonts/", "./webview/assets/azrael-fonts/")}
:root{color-scheme:light;--ink:#262b32;--muted:#69727b;--rule:#e1e5e9;--surface:white}*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:var(--ink);font-family:"Noto Sans KR","Malgun Gothic",sans-serif}#icon-review{max-width:1320px;margin:auto;padding:30px;background:white}.identity{font-size:12px;color:var(--muted);letter-spacing:.05em}h1{font-size:28px;font-weight:500;line-height:1.4;margin:10px 0 12px}.intro{font-size:14px;line-height:1.8;margin:0 0 18px}.policy{display:flex;flex-wrap:wrap;gap:8px 20px;border-block:1px solid var(--rule);padding:13px 0;font-size:13px}.policy strong{font-weight:500}nav{display:flex;flex-wrap:wrap;gap:8px 18px;margin:18px 0;font-size:13px}a{color:#325782;text-underline-offset:3px}a:focus-visible{outline:2px solid #466993;outline-offset:4px}.icon-section{margin:28px 0 36px}h2{font-size:18px;font-weight:500;margin:0 0 5px}h2 small{font-size:12px;font-weight:400;color:var(--muted);margin-left:8px}.section-note{font-size:12px;color:var(--muted);line-height:1.6;margin:0 0 14px}.cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}.icon-card{min-width:0;margin:0;border:1px solid var(--rule);border-radius:10px;padding:12px;background:var(--surface)}figcaption{display:flex;flex-direction:column;gap:4px;min-height:48px}code{font-family:Consolas,monospace;font-size:12px;color:var(--muted)}figcaption span{font-size:14px;line-height:1.5;overflow-wrap:anywhere}.large{height:64px;display:flex;align-items:center;justify-content:center}.sizes{display:flex;align-items:flex-end;justify-content:center;gap:18px}.sizes>span{display:flex;flex-direction:column;align-items:center;gap:6px}.sizes small{font-size:11px;color:var(--muted)}.dark{--surface:#222831;background:var(--surface);color:#f0f2f5;border-radius:6px;display:flex;align-items:center;justify-content:center;gap:18px;padding:10px;margin-top:10px}.usage{font-size:12px;line-height:1.6;margin:10px 0 0;color:var(--muted);min-height:38px;overflow-wrap:anywhere}svg{flex-shrink:0}.dynamic{font-family:${FONT_FAMILY};font-weight:400;font-synthesis-weight:none}.type-sample{font-size:14px;line-height:24px;margin:8px 0 0}.footnote{border-top:1px solid var(--rule);padding-top:15px;font-size:12px;color:var(--muted);line-height:1.8}.revision-example{font-size:13px;color:var(--ink)}@media(max-width:1050px){.cards{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:760px){#icon-review{padding:22px 16px}.cards{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}}@media(max-width:540px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.icon-card{padding:10px}h1{font-size:23px}.sizes,.dark{gap:13px}}@media(max-width:350px){#icon-review{padding:18px 12px}.icon-card{padding:8px}.sizes,.dark{gap:10px}}@media print{@page{size:A3 portrait;margin:15mm}body{background:white}#icon-review{padding:0;max-width:none}.cards{grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.icon-section{break-inside:avoid;margin:22px 0}nav{display:none}.icon-card{break-inside:avoid}.large{height:48px}.usage{min-height:0}.footnote{break-inside:avoid}}
</style></head><body><main id="icon-review"><header><div class="identity">AZRAEL / ICON REVIEW 01 / 2026-10-04</div><h1>부드러운 곡선 · 전체 아이콘 시안</h1><p class="intro">${ICONS.length}개 기능 아이콘을 ${GROUPS.length}개 영역으로 정리했습니다. 수정할 아이콘은 번호로 지정할 수 있습니다.<br>예: <span class="revision-example">“I001은 선을 조금 짧게”, “I003은 곡선을 더 크게”</span></p><div class="policy"><span><strong>형태</strong> 24×24 · 선 1.8 · 둥근 끝/연결</span><span><strong>실제 크기</strong> 16 / 20 / 24px</span><span><strong>고정 UI</strong> Noto Sans KR</span><span><strong>가변 텍스트</strong> 경기천년제목 Light + Consolas</span></div><p class="type-sample dynamic">Azrael 대화 목록 · 메시지 내용 · 입력 텍스트 0123456789</p></header><nav aria-label="아이콘 영역">${GROUPS.map(group => `<a href="#${group.key}">${escape(group.title)}</a>`).join("")}</nav>${sections}<footer class="footnote">현재 Azrael의 채팅·파일·계정·설정·검토·예약 UI에 필요한 기능 기호와 상태 변형을 대상으로 한 교체 시안입니다. 화면 조건이 있는 기호와 기존 텍스트 버튼의 아이콘 후보도 포함합니다. 서비스 브랜드 로고와 확장 프로그램 자체 이미지는 별도 식별 자산입니다. 선택한 스타일을 확장한 검토용 디자인이며, 제품 교체는 수정 지시를 반영한 뒤 진행합니다.<br>모든 아이콘의 개별 SVG와 용도 목록은 이 HTML 옆의 <code>svg/</code> 및 <code>catalog.json</code>에 있습니다. 로컬 SVG·HTML·폰트를 사용하며 외부 네트워크 요청은 없습니다.</footer></main></body></html>`;
fs.writeFileSync(path.join(output, "index.html"), html);

const width = 1440, columns = 6, cellWidth = 232, cellHeight = 136;
let y = 110;
const sheet = [];
for (const group of GROUPS) {
  const icons = ICONS.filter(icon => icon.group === group.key);
  sheet.push(`<text x="24" y="${y}" font-size="20" font-weight="500">${escape(group.title)}</text>`);
  y += 20;
  icons.forEach((icon, index) => {
    const x = 24 + (index % columns) * cellWidth, top = y + Math.floor(index / columns) * cellHeight;
    sheet.push(`<g transform="translate(${x} ${top})"><rect width="220" height="124" rx="9" fill="white" stroke="#e1e5e9"/><text x="12" y="22" font-family="Consolas,monospace" font-size="12" fill="#69727b">${icon.id}</text><svg x="88" y="24" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon.body}</svg><text x="110" y="100" text-anchor="middle" font-size="14">${escape(icon.label)}</text></g>`);
  });
  y += Math.ceil(icons.length / columns) * cellHeight + 30;
}
fs.writeFileSync(path.join(output, "overview.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y + 20}" viewBox="0 0 ${width} ${y + 20}" role="img" aria-label="Azrael 전체 아이콘 시안" style="font-family:'Noto Sans KR','Malgun Gothic',sans-serif;color:#262b32"><rect width="100%" height="100%" fill="#f8f9fb"/><text x="24" y="40" font-size="28" font-weight="500">Azrael · 부드러운 곡선 아이콘 ${ICONS.length}개</text><text x="24" y="70" font-size="14" fill="#69727b">번호로 수정 항목을 지정하세요 · 고정 UI Noto Sans KR · 가변 텍스트 경기천년제목 Light + Consolas</text>${sheet.join("")}</svg>`);
console.log(JSON.stringify({ html: path.join(output, "index.html"), overview: path.join(output, "overview.svg"), iconCount: ICONS.length, groups: GROUPS.length }));

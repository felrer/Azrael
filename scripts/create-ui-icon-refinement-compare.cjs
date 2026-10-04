"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ICONS, GROUPS, iconSvg } = require("./ui-soft-icons.cjs");
const output = path.resolve(__dirname, "../artifacts/visualizations/azrael-ui-icons");
const snapshotPath = process.argv[2];
if (!snapshotPath) throw new Error("Provide the initial icon catalog JSON path.");
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const initial = Array.isArray(snapshot) ? snapshot : snapshot.icons;
if (!Array.isArray(initial)) throw new Error("Initial snapshot must contain an icons array.");
const beforeById = new Map(initial.map(icon => [icon.id, icon]));
if (beforeById.size !== ICONS.length || ICONS.some(icon => beforeById.get(icon.id)?.key !== icon.key)) {
  throw new Error("Refinement comparison requires unchanged icon IDs and keys.");
}
const changed = ICONS.filter(icon => beforeById.get(icon.id).body !== icon.body);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sample = (icon, label) => `<div class="variant"><h3>${label}</h3><div class="large">${iconSvg(icon, 40)}</div><div class="sizes">${[16, 20, 24].map(size => `<span>${iconSvg(icon, size)}<small>${size}</small></span>`).join("")}</div><div class="dark">${[16, 20, 24].map(size => iconSvg(icon, size)).join("")}</div></div>`;
const sections = GROUPS.map(group => {
  const icons = changed.filter(icon => icon.group === group.key);
  if (!icons.length) return "";
  return `<section><h2>${escape(group.title)} <small>${icons.length}개 수정</small></h2><div class="cards">${icons.map(icon => `<article id="${icon.id}"><header><code>${icon.id}</code><span>${escape(icon.label)}</span></header><div class="comparison">${sample(beforeById.get(icon.id), "수정 전")}${sample(icon, "수정 후")}</div></article>`).join("")}</div></section>`;
}).join("");
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Azrael 아이콘 수정 전후</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:#262b32;font-family:"Noto Sans KR","Malgun Gothic",sans-serif}#icon-refinement{max-width:1320px;margin:auto;padding:30px;background:white}h1{font-size:28px;font-weight:500;margin:10px 0}p{font-size:14px;line-height:1.8;color:#69727b}a{color:#325782;text-underline-offset:3px}a:focus-visible{outline:2px solid #466993;outline-offset:4px}section{margin:28px 0}h2{font-size:18px;font-weight:500;margin:0 0 14px}h2 small{font-size:12px;color:#69727b;font-weight:400;margin-left:8px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}article{min-width:0;border:1px solid #e1e5e9;border-radius:10px;padding:12px;background:white}article header{display:flex;align-items:baseline;gap:12px;font-size:14px;line-height:1.6;overflow-wrap:anywhere}code{font-family:Consolas,monospace;font-size:12px;color:#69727b}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:12px}.variant{min-width:0}.variant+ .variant{border-left:1px solid #e1e5e9;padding-left:12px}h3{font-size:12px;color:#69727b;font-weight:400;margin:14px 0 0;text-align:center}.large{height:70px;display:flex;justify-content:center;align-items:center}.sizes{display:flex;align-items:flex-end;justify-content:center;gap:12px}.sizes>span{display:flex;flex-direction:column;align-items:center;gap:6px}.sizes small{font-size:11px;color:#69727b}.dark{--surface:#222831;background:var(--surface);color:#f0f2f5;border-radius:6px;display:flex;justify-content:center;align-items:center;gap:12px;padding:10px 4px;margin-top:10px}svg{flex-shrink:0}footer{border-top:1px solid #e1e5e9;margin-top:24px;padding-top:14px;font-size:12px;color:#69727b;line-height:1.8}@media(max-width:1050px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:680px){#icon-refinement{padding:20px 12px}.cards{grid-template-columns:1fr}.comparison{gap:10px}.variant+ .variant{padding-left:10px}h1{font-size:23px}}@media print{@page{size:A3 portrait;margin:15mm}body{background:white}#icon-refinement{padding:0;max-width:none}.cards{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}article{break-inside:avoid}h2{break-after:avoid}footer{break-inside:avoid}}
</style></head><body><main id="icon-refinement"><header><h1>아이콘 · 수정 전후 비교</h1><p>전체 ${ICONS.length}개 시안 중 경로를 수정한 ${changed.length}개를 같은 크기·선 두께·배경으로 나란히 보여드립니다.<br>각 번호와 용도는 유지했습니다. <a href="index.html">수정된 전체 아이콘 목록</a></p></header>${sections}<footer>원래 기호와 수정된 기호의 실제 SVG 경로를 사용합니다. 16 / 20 / 24px와 밝고 어두운 배경에서 차이를 비교할 수 있습니다.</footer></main></body></html>`;
// Each group fits on A3; keeping it together avoids fragmented Chromium grid cards.
const printableHtml = html.replace(
  ".cards{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}article{break-inside:avoid}",
  ".cards{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}section{break-inside:avoid}article{break-inside:avoid}"
);
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "refinement.html"), printableHtml);
console.log(JSON.stringify({ html: path.join(output, "refinement.html"), changed: changed.length, ids: changed.map(icon => icon.id) }));

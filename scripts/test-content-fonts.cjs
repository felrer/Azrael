"use strict";
const assert = require("node:assert/strict"), hs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), pm = require("node:vm");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const ts = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH ?? require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { CONTENT_FONT_ASSETS, injectContentFonts, MARKER } = require("./inject-content-fonts.cjs");
const { transformAsset, getTransformRules, getAssetTransformRules } = require("./namespace-azrael-host.cjs");
const { FONT_FAMILY, copyContentFontAssets } = require("./content-fonts.cjs");
const root = path.resolve(__dirname, ".."), output = path.join(root, "artifacts/verification/title-fonts");
hs.mkdirSync(output, { recursive: true });
const transformed = new Map();
const browserOnly = process.argv.includes("--browser-only");
const sourceOnly = process.argv.includes("--source-only");
assert.ok(!(browserOnly && sourceOnly), "--browser-only and --source-only are mutually exclusive");
for (const asset of browserOnly ? CONTENT_FONT_ASSETS.filter(asset => asset.endsWith(".css")) : CONTENT_FONT_ASSETS) {
  const filename = path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(root, "artifacts/upstream-ui/26.930.61225"), asset);
  const original = hs.readFileSync(filename, "utf8");
  const result = transformAsset(original, asset, filename, ts);
  assert.equal(result.asset.contentFontEdits, 1, asset);
  assert.equal(injectContentFonts(result.text, asset, ts).count, 0, asset);
  assert.equal(transformAsset(result.text, asset, filename, ts).asset, null, `production repeat ${asset}`);
  if (asset.endsWith(".js")) {
    const parsed = ts.createSourceFile(asset, result.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(parsed.parseDiagnostics.length, 0, asset);
    const before = ts.createSourceFile(asset, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(parsed.statements.filter(ts.isExportDeclaration).length, before.statements.filter(ts.isExportDeclaration).length);
    assert.throws(() => injectContentFonts(result.text + MARKER, asset, ts));
    const anchor = asset.includes("collapsible-user") ? "children:W" : asset.includes("app-initial") ? "className:f,children:u" : asset.includes("profile-dropdown") ? "children:n}),w]" : "className:`truncate`,children:o";
    assert.ok(original.includes(anchor), `changed-anchor fixture must alter ${asset}`);
    assert.throws(() => injectContentFonts(original.replace(anchor, "changedAnchor"), asset, ts));
  } else {
    assert.throws(() => injectContentFonts(original.replace(".font-content{", ".changed-font-content{"), asset, ts));
    assert.throws(() => injectContentFonts(original.replace("._Paragraph_176oq_2,._Heading_176oq_2,._ListItem_176oq_2,._Table_176oq_2{font-family:var(--font-content)}", "._ChangedParagraph_176oq_2{font-family:var(--font-content)}"), asset, ts));
  }
  transformed.set(asset, result.text);
  console.log(`PASS production transform, parse/exports, repeat and changed-anchor: ${asset}`);
}
// Execute the production composer leaf through React's memo cache, covering the
// named-model and localized fallback branches without reproducing the function.
if (!browserOnly) {
const composer = transformed.get(CONTENT_FONT_ASSETS.find(p => p.includes("app-initial") && p.endsWith(".js")));
const source = ts.createSourceFile("composer.js", composer, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "V8").getText(source);
const memo = Array(14).fill(Symbol.for("react.memo_cache_sentinel"));
const jsx = (type, props) => ({ type, props });
const renderModel = pm.runInNewContext(`(${fn})`, { qZi: { c: () => memo }, JZi: { jsx, jsxs: jsx }, Qd: () => false, Xh: {}, zp: x => x, J: (...x) => x.join(" "), UZi: "icon", Q: "translation" });
assert.equal(renderModel({ model: "custom", displayName: "모델 Astra 42" }).props.children[1].props["data-azrael-dynamic-text"], true);
assert.equal(renderModel({ model: "custom" }).props.children[1].props["data-azrael-dynamic-text"], undefined);
}
const copied = copyContentFontAssets(output);
for (const file of copied) assert.equal(crypto.createHash("sha256").update(hs.readFileSync(path.join(output, file.path))).digest("hex"), file.sha256);
const rules = getTransformRules();
for (const asset of CONTENT_FONT_ASSETS) {
  const scoped = getAssetTransformRules(asset, rules);
  assert.ok(scoped["inject-content-fonts.cjs"]);
  if (asset.endsWith(".css")) {
    assert.ok(scoped["content-fonts.cjs"]);
    assert.ok(scoped["content-font-resource:gyeonggi-title-light.woff"]);
  }
}
console.log(`PASS official asset copies/hash and CSS/tC cache dependencies: ${copied.length} resources`);

async function verifyBrowser() {
  const chrome = process.env.AZRAEL_TEST_CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(hs.existsSync);
  assert.ok(chrome, "installed headless Chromium required (or set AZRAEL_TEST_CHROME)");
  const presentation = require(path.join(root, "extensions/azrael-ex/dist/src/usagePresentation.js"));
  const html = `<!doctype html><meta charset="utf-8"><style>:root{--font-sans:Arial;--font-ui-family:Arial}body{font-family:Arial;font-size:16px;line-height:24px}.sample{font-size:16px;line-height:24px}.sample button{font-size:16px;line-height:24px}.font-content{font-family:var(--codex-content-font-family)}${transformed.get(CONTENT_FONT_ASSETS.find(asset => asset.endsWith(".css")))}</style><div id="fixed" class="sample">고정 메뉴 Copy 42</div><div id="korean" class="sample" data-azrael-dynamic-text>경기천년제목</div><div id="latin" class="sample" data-azrael-dynamic-text>Consolas 123</div><div id="bold" class="sample" data-azrael-dynamic-text style="font-weight:700">경기천년제목</div><div id="content" class="sample font-content">대화 Message 123<strong id="markdown-bold" style="font-weight:700">강조 제목</strong><button id="copy">Copy</button></div><div data-composer-body class="[&_.ProseMirror]:!font-sans"><div id="composer" class="sample ProseMirror" contenteditable>입력 composer 456</div></div><div id="shadow"></div><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(`<style>${presentation.usageStyles}</style><span id="identity" data-azrael-dynamic-text>계정 Account 123</span><button id="refresh">새로고침</button>`)};</script>`;
  const fixture = path.join(output, "webview/assets/fixture.html");
  const chatFixture = `<div class="_MarkdownRoot_176oq_2"><p id="chat-paragraph" class="sample _Paragraph_176oq_2">가 나</p><h2 id="chat-heading" class="sample _Heading_176oq_2">가 나</h2><ul><li id="chat-list" class="sample _ListItem_176oq_2">가 나</li></ul><table class="sample _Table_176oq_2"><tr><td id="chat-cell">가 나</td></tr></table><p class="_Paragraph_176oq_2"><code id="chat-code">a b</code><button id="chat-control">Copy code</button></p></div><div data-azrael-dynamic-text><p id="user-paragraph" class="sample _Paragraph_176oq_2">가 나</p></div>`;
  hs.writeFileSync(fixture, html.replace("</style>", `</style>${chatFixture}`));
  const profile = hs.mkdtempSync(path.join(output, "chromium-profile-"));
  const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    const deadline = Date.now() + 20000;
    let endpoint;
    while (!endpoint && Date.now() < deadline) {
      endpoint = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
      if (!endpoint) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(endpoint, `Chrome debugging endpoint unavailable: ${stderr.slice(-800)}`);
    const targets = await (await fetch(endpoint.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*/, "/json/list"))).json();
    const socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let next = 0; const pending = new Map();
    socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(message.error) : resolve(message.result); } };
    const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    await call("Page.enable"); await call("DOM.enable"); await call("CSS.enable");
    await call("Page.navigate", { url: pathToFileURL(fixture).href });
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) { ready = (await call("Runtime.evaluate", { expression: "!!document.querySelector('#composer')", returnByValue: true })).result.value; if (!ready) await new Promise(r => setTimeout(r, 50)); }
    assert.ok(ready, "fixture loaded");
    const evaluation = await call("Runtime.evaluate", { expression: `(async()=>{await document.fonts.load('16px "Azrael Gyeonggi Title"','경기');await document.fonts.load('700 16px "Azrael Gyeonggi Title"','경기');await document.fonts.ready;const metrics={};for(const id of ['fixed','korean','latin','bold','markdown-bold','content','copy','composer']){const c=getComputedStyle(document.getElementById(id));metrics[id]={fontFamily:c.fontFamily,fontSize:c.fontSize,lineHeight:c.lineHeight,fontWeight:c.fontWeight,fontSynthesisWeight:c.fontSynthesisWeight}}for(const id of ['identity','refresh']){const c=getComputedStyle(document.querySelector('#shadow').shadowRoot.getElementById(id));metrics[id]={fontFamily:c.fontFamily,fontSize:c.fontSize,lineHeight:c.lineHeight,fontWeight:c.fontWeight,fontSynthesisWeight:c.fontSynthesisWeight}}return {metrics,faces:[...document.fonts].map(d=>({family:d.family,weight:d.weight,status:d.status}))}})()`, awaitPromise: true, returnByValue: true });
    assert.ok(!evaluation.exceptionDetails, JSON.stringify(evaluation.exceptionDetails));
    const evidence = evaluation.result.value;
    const spacing = await call("Runtime.evaluate", { expression: `(()=>{const result={};for(const id of ['chat-paragraph','chat-heading','chat-list','chat-cell','user-paragraph','composer']){const el=document.getElementById(id),span=document.createElement('span');span.style.whiteSpace='pre';el.append(span);const width=(text,normal)=>{span.textContent=text;span.style.setProperty('word-spacing',normal?'normal':'inherit','important');const range=document.createRange();range.selectNodeContents(span);return range.getBoundingClientRect().width};const reduced=width('가 나',false)-width('가나',false),original=width('가 나',true)-width('가나',true);result[id]={reduced,original,ratio:reduced/original};span.remove()}for(const id of ['chat-code','chat-control','copy','fixed'])result[id]={wordSpacing:getComputedStyle(document.getElementById(id)).wordSpacing};return result})()`, returnByValue: true });
    assert.ok(!spacing.exceptionDetails, JSON.stringify(spacing.exceptionDetails));
    evidence.spacing = spacing.result.value;
    for (const id of ["chat-paragraph", "chat-heading", "chat-list", "chat-cell", "user-paragraph", "composer"]) {
      assert.ok(evidence.spacing[id].original > 0, `${id}: original space must have width`);
      assert.ok(Math.abs(evidence.spacing[id].ratio - 0.5) < 0.02, `${id}: space ratio ${evidence.spacing[id].ratio}`);
    }
    for (const id of ["chat-code", "chat-control", "copy", "fixed"]) assert.equal(evidence.spacing[id].wordSpacing, "0px", id);
    console.log("PASS chat and composer spaces: paragraph/heading/list/table/user text measured at half width; code and controls retain normal spacing");
    hs.writeFileSync(path.join(output, "render-evidence.json"), JSON.stringify(evidence, null, 2));
    const officialFaces = evidence.faces.filter(d => d.family === "Azrael Gyeonggi Title");
    assert.ok(officialFaces.length === 1 && officialFaces.every(d => d.status === "loaded"));
    for (const id of ["korean", "latin", "bold", "markdown-bold", "content", "composer", "identity"]) assert.equal(evidence.metrics[id].fontFamily, FONT_FAMILY);
    for (const id of ["fixed", "copy", "refresh"]) assert.ok(!evidence.metrics[id].fontFamily.includes("Azrael Gyeonggi Title"), id);
    for (const id of ["fixed", "korean", "latin", "bold", "markdown-bold", "content", "copy", "composer"]) { assert.equal(evidence.metrics[id].fontSize, "16px"); assert.equal(evidence.metrics[id].lineHeight, "24px"); }
    for (const id of ["korean", "latin", "bold", "content", "composer", "identity"]) {
      assert.equal(evidence.metrics[id].fontWeight, "400", id);
      assert.equal(evidence.metrics[id].fontSynthesisWeight, "none", id);
    }
    assert.equal(evidence.metrics["markdown-bold"].fontWeight, "700");
    assert.equal(evidence.metrics["markdown-bold"].fontSynthesisWeight, "none");
    assert.equal(evidence.metrics.identity.fontSize, "13px");
    assert.equal(evidence.metrics.identity.lineHeight, "19.5px");
    const document = await call("DOM.getDocument");
    evidence.platformFonts = {};
    for (const id of ["fixed", "korean", "latin", "bold", "markdown-bold", "copy", "composer"]) {
      const { nodeId } = await call("DOM.querySelector", { nodeId: document.root.nodeId, selector: `#${id}` });
      evidence.platformFonts[id] = (await call("CSS.getPlatformFontsForNode", { nodeId })).fonts;
    }
    assert.ok(evidence.platformFonts.korean.some(d => d.isCustomFont && d.postScriptName === "GyeonggiTitleL" && d.glyphCount > 0));
    for (const id of ["bold", "markdown-bold"]) assert.ok(evidence.platformFonts[id].some(d => d.isCustomFont && d.postScriptName === "GyeonggiTitleL" && d.glyphCount > 0));
    assert.ok(evidence.platformFonts.latin.some(d => /Consolas/.test(d.familyName) && d.glyphCount > 0));
    assert.ok(evidence.platformFonts.copy.every(d => !d.isCustomFont));
    hs.writeFileSync(path.join(output, "render-evidence.json"), JSON.stringify(evidence, null, 2));
    const screenshot = await call("Page.captureScreenshot", { format: "png" });
    hs.writeFileSync(path.join(output, "fixture.png"), Buffer.from(screenshot.data, "base64"));
    socket.close();
    console.log("PASS isolated Chromium: official GyeonggiTitleL glyphs with normal400/no synthesis and retained Markdown bold, Consolas Latin/numbers, UI Copy/fixed labels, shadow markers, unchanged 16px/24px metrics");
  } finally {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
    hs.writeFileSync(path.join(output, "chromium.log"), stderr);
    hs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
if (!sourceOnly) verifyBrowser().catch(error => { console.error(error); process.exitCode = 1; });

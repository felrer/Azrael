"use strict";
const assert = require("node:assert/strict"), hs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), pm = require("node:vm");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const ts = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH ?? require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { CONTENT_FONT_ASSETS, injectContentFonts, MARKER } = require("./inject-content-fonts.cjs");
const { transformAsset, getTransformRules, getAssetTransformRules } = require("./namespace-azrael-host.cjs");
const { FONT_FAMILY, NORMAL_FONT_FAMILY, DEFAULT_NORMAL_FONT_FAMILY, FONT_PLATFORM_SCRIPT, copyContentFontAssets } = require("./content-fonts.cjs");
const root = path.resolve(__dirname, "..");
function containedPath(base, candidate) {
  const resolved = path.resolve(candidate), relative = path.relative(path.resolve(base), resolved);
  assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `path must be inside ${base}: ${resolved}`);
  // Resolve existing ancestors too, so a junction cannot redirect fixture/log writes.
  let ancestor = resolved;
  while (!hs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realRelative = path.relative(hs.realpathSync(base), hs.realpathSync(ancestor));
  assert.ok(realRelative !== ".." && !realRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(realRelative), `path ancestor escapes ${base}: ${resolved}`);
  return resolved;
}
const fixtureBase = path.join(root, "artifacts/verification"), logBase = path.join(root, "artifacts/logs");
const output = containedPath(fixtureBase, process.env.AZRAEL_RENDER_FIXTURE_ROOT || path.join(fixtureBase, "title-fonts"));
const renderLogs = containedPath(logBase, process.env.AZRAEL_RENDER_LOG_ROOT || path.join(logBase, "title-fonts"));
hs.mkdirSync(output, { recursive: true });
hs.mkdirSync(renderLogs, { recursive: true });
const transformed = new Map();
const browserOnly = process.argv.includes("--browser-only");
const sourceOnly = process.argv.includes("--source-only");
assert.ok(!(browserOnly && sourceOnly), "--browser-only and --source-only are mutually exclusive");
for (const asset of browserOnly ? CONTENT_FONT_ASSETS.filter(asset => asset.endsWith(".css")) : CONTENT_FONT_ASSETS) {
  const filename = path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(root, "artifacts/upstream-ui/26.1007.21434"), asset);
  const original = hs.readFileSync(filename, "utf8");
  // The released Linux header already passed the full producer. Its pristine
  // platform variant differs at an unrelated deferred-turn anchor.
  const headerFontOnly = asset.includes("/header-");
  const fontResult = headerFontOnly ? injectContentFonts(original, asset, ts) : undefined;
  const result = headerFontOnly ? { text: fontResult.text, asset: { contentFontEdits: fontResult.count } } : transformAsset(original, asset, filename, ts);
  assert.equal(result.asset.contentFontEdits, 1, asset);
  assert.equal(injectContentFonts(result.text, asset, ts).count, 0, asset);
  if (!headerFontOnly) assert.equal(transformAsset(result.text, asset, filename, ts).asset, null, `production repeat ${asset}`);
  if (headerFontOnly && process.env.AZRAEL_TEST_RELEASED_HEADER_PATH) {
    const released = hs.readFileSync(process.env.AZRAEL_TEST_RELEASED_HEADER_PATH, "utf8");
    assert.equal(injectContentFonts(released, asset, ts).count, 0, "released Linux header retains exact font markers");
  }
  if (asset.endsWith(".js")) {
    const parsed = ts.createSourceFile(asset, result.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(parsed.parseDiagnostics.length, 0, asset);
    const before = ts.createSourceFile(asset, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(parsed.statements.filter(ts.isExportDeclaration).length, before.statements.filter(ts.isExportDeclaration).length);
    assert.throws(() => injectContentFonts(result.text + MARKER, asset, ts));
    const anchor = asset.includes("collapsible-user") ? "children:W" : asset.includes("app-initial") ? "className:f,children:u" : asset.includes("profile-dropdown") ? "children:n}),S]" : "className:`truncate`,children:o";
    assert.ok(original.includes(anchor), `changed-anchor fixture must alter ${asset}`);
    assert.throws(() => injectContentFonts(original.replace(anchor, "changedAnchor"), asset, ts));
  } else {
    assert.throws(() => injectContentFonts(original.replace(".font-content{", ".changed-font-content{"), asset, ts));
    assert.throws(() => injectContentFonts(original.replace("._Paragraph_63g8m_2,._Heading_63g8m_2,._ListItem_63g8m_2,._Table_63g8m_2{font-family:var(--font-content)}", "._ChangedParagraph_63g8m_2{font-family:var(--font-content)}"), asset, ts));
  }
  transformed.set(asset, result.text);
  console.log(`PASS ${headerFontOnly ? "header font injection" : "production transform"}, parse/exports, repeat and changed-anchor: ${asset}`);
}
// Execute the production composer leaf through React's memo cache, covering the
// named-model and localized fallback branches without reproducing the function.
if (!browserOnly) {
const composer = transformed.get(CONTENT_FONT_ASSETS.find(p => p.includes("app-initial") && p.endsWith(".js")));
const source = ts.createSourceFile("composer.js", composer, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "B8").getText(source);
const memo = Array(14).fill(Symbol.for("react.memo_cache_sentinel"));
const jsx = (type, props) => ({ type, props });
const renderModel = pm.runInNewContext(`(${fn})`, { Boa: { c: () => memo }, Voa: { jsx, jsxs: jsx }, Hu: () => false, sg: {}, c_: x => x, ru: (...x) => x.join(" "), Ioa: "icon", q: "translation" });
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
    assert.ok(scoped["content-font-resource:cascadia-mono.woff2"]);
    assert.ok(scoped["content-font-resource:cascadia-mono-italic.woff2"]);
  }
  if (asset.endsWith(".css") || asset.includes("app-initial")) assert.ok(scoped["content-font-policy"]);
  if (!browserOnly && asset.includes("app-initial") && asset.endsWith(".js")) assert.ok(transformed.get(asset).includes(FONT_PLATFORM_SCRIPT), "production bootstrap executes shared platform policy");
}
console.log(`PASS official asset copies/hash and CSS/tC cache dependencies: ${copied.length} resources`);

async function inspectOwnedBrowserProcesses(child, profilePath) {
  const command = "$ErrorActionPreference='Stop'; $owned=@(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and ($_.ProcessId -eq [int]$env:AZRAEL_RENDER_BROWSER_PID -or ($_.CommandLine -and $_.CommandLine.Contains($env:AZRAEL_RENDER_BROWSER_PROFILE))) } | Select-Object -ExpandProperty ProcessId); ConvertTo-Json -Compress -InputObject $owned";
  const query = spawn("pwsh", ["-NoProfile", "-Command", command], { windowsHide: true, timeout: 15000, env: { ...process.env, AZRAEL_RENDER_BROWSER_PID: String(child.pid), AZRAEL_RENDER_BROWSER_PROFILE: profilePath }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", error = "";
  query.stdout.on("data", chunk => { output += chunk; });
  query.stderr.on("data", chunk => { error += chunk; });
  const exitCode = await new Promise(resolve => { query.once("error", cause => { error += String(cause); resolve(null); }); query.once("exit", resolve); });
  assert.equal(exitCode, 0, `Owned browser process inspection failed; preserving profile: ${error}`);
  const processIds = JSON.parse(output);
  assert.ok(Array.isArray(processIds), "Owned browser process inspection was not an array; preserving profile");
  return { exitCode, processIds };
}

async function stopOwnedBrowser(child, graceful = false, profilePath) {
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  if (!exited()) {
    // Browser.close owns graceful shutdown. A Windows Chrome launcher can report
    // kill=false while its exit event remains stale after the process is gone.
    if (!graceful) child.kill();
    await new Promise(resolve => {
      const finished = () => { clearTimeout(timer); child.removeListener("exit", finished); resolve(); };
      const timer = setTimeout(finished, 5000);
      child.once("exit", finished);
      if (exited()) finished();
    });
  }
  let inspection;
  if (process.platform === "win32") {
    const deadline = Date.now() + 10000;
    do {
      inspection = await inspectOwnedBrowserProcesses(child, profilePath);
      if (!inspection.processIds.length) break;
      if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    assert.equal(inspection.processIds.length, 0, "Owned browser still references profile; preserving its profile");
  } else assert.ok(exited(), "Owned Chromium exit is uncertain; preserving its profile");
  child.unref();
  child.stderr?.destroy();
  return { exitCode: child.exitCode, signalCode: child.signalCode, processInspection: inspection ?? null };
}

async function verifyBrowser() {
  const chrome = process.env.AZRAEL_TEST_CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(hs.existsSync);
  assert.ok(chrome, "installed headless Chromium required (or set AZRAEL_TEST_CHROME)");
  const presentationPath = path.join(root, "extensions/azrael-ex/src/usagePresentation.ts");
  const presentation = process.env.AZRAEL_TEST_PRESENTATION_PATH ? require(process.env.AZRAEL_TEST_PRESENTATION_PATH) : (() => {
    const compiled = ts.transpileModule(hs.readFileSync(presentationPath, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
    const exports = {};
    pm.runInNewContext(compiled.outputText, { exports, require: require("node:module").createRequire(path.join(root, "extensions/azrael-ex/dist/src/usagePresentation.js")) }, { filename: presentationPath });
    return exports;
  })();
  const html = `<!doctype html><meta charset="utf-8"><script>${FONT_PLATFORM_SCRIPT}</script><style>:root{--font-sans:Arial;--font-ui-family:Arial}body{font-family:Arial;font-size:16px;line-height:24px}.sample{font-size:16px;line-height:24px}.sample button{font-size:16px;line-height:24px}.font-content{font-family:var(--codex-content-font-family)}${transformed.get(CONTENT_FONT_ASSETS.find(asset => asset.endsWith(".css")))}</style><div id="fixed" class="sample">고정 메뉴 Copy 42</div><div id="korean" class="sample" data-azrael-dynamic-text>경기천년제목</div><div id="latin" class="sample" data-azrael-dynamic-text>Consolas 123</div><div id="bold" class="sample" data-azrael-dynamic-text style="font-weight:700">경기천년제목</div><div id="content" class="sample font-content">대화 Message 123<strong id="markdown-bold" style="font-weight:700">강조 제목</strong><strong id="cascadia-bold" style="font-weight:700">Bold Latin 123</strong><em id="cascadia-italic">Italic Latin 123</em><button id="copy">Copy</button></div><div data-composer-body class="[&_.ProseMirror]:!font-sans"><div id="composer" class="sample ProseMirror" contenteditable>입력 composer 456</div></div><div id="shadow" style="display:block"></div><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(`<style>${presentation.usageStyles}</style><main><header><span id="identity" data-azrael-dynamic-text>계정 Account 123</span><div class="actions"><button id="refresh" data-action="refresh">새로고침</button></div></header></main>`)};</script>`;
  const fixture = path.join(output, "webview/assets/fixture.html");
  // Render the production B8 model-name leaf. Only the adjacent effort/button
  // shell is synthetic; no host/model requests or installed-app acceptance.
  const modelAsset = CONTENT_FONT_ASSETS.find(asset => asset.endsWith(".js") && asset.includes("app-initial"));
  const modelSource = ts.createSourceFile(modelAsset, injectContentFonts(hs.readFileSync(path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(root, "artifacts/upstream-ui/26.1007.21434"), modelAsset), "utf8"), modelAsset, ts).text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const modelFunction = modelSource.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "B8").getText(modelSource);
  const jsx = (type, props) => ({ type, props });
  const modelLeaf = name => pm.runInNewContext(`(${modelFunction})`, { Boa: { c: () => Array(14).fill(Symbol.for("react.memo_cache_sentinel")) }, Voa: { jsx, jsxs: jsx }, Hu: () => false, sg: {}, c_: x => x, ru: (...x) => x.filter(Boolean).join(" "), Ioa: "icon", q: "translation" })({ model: "custom", displayName: name });
  const escapeHtml = text => String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const renderLeaf = node => typeof node === "string" ? escapeHtml(node) : node.type === "icon" ? "" : `<span class="${escapeHtml(node.props.className)}"${node.props["data-azrael-dynamic-text"] ? ' data-azrael-dynamic-text="true"' : ""}>${(Array.isArray(node.props.children) ? node.props.children : [node.props.children]).map(renderLeaf).join("")}</span>`;
  const modelFixture = `<style>@font-face{font-family:"Legacy Half Space";src:local("Consolas");unicode-range:U+0020;size-adjust:50%}.model-fixture{display:flex;align-items:center;gap:4px;width:260px;max-width:260px;font:16px/24px Arial;padding:6px 12px;border-radius:24px;background:var(--color-background-primary-ghost-hover);color:inherit}.model-fixture>span:first-child{flex:1;min-width:0}.model-fixture [data-azrael-dynamic-text]{min-width:0}.model-fixture svg{width:14px;height:14px;flex-shrink:0}.baseline-marker{display:inline-block;width:0;height:0;vertical-align:baseline}.model-legacy [data-azrael-dynamic-text]{font-family:"Legacy Half Space",${NORMAL_FONT_FAMILY}!important}.model-reference [data-azrael-dynamic-text]{font-family:${NORMAL_FONT_FAMILY}!important}</style>${['reference','legacy','current'].map(mode => `<button type="button" id="model-${mode}" class="model-fixture model-${mode}">${renderLeaf(modelLeaf("GPT-6.1 Sol"))}<span class="effort">Medium</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor"/></svg></button>`).join("")}`;
  const chatFixture = `<div class="_MarkdownRoot_63g8m_2"><p id="chat-paragraph" class="sample _Paragraph_63g8m_2">가 나</p><h2 id="chat-heading" class="sample _Heading_63g8m_2">가 나</h2><ul><li id="chat-list" class="sample _ListItem_63g8m_2">가 나</li></ul><table class="sample _Table_63g8m_2"><tr><td id="chat-cell">가 나</td></tr></table><div id="chat-title" data-thread-title>가 나 hello world</div><div id="dynamic-value" data-azrael-dynamic-text>가 나 hello world</div><p class="_Paragraph_63g8m_2"><code id="chat-code">a b</code><pre id="chat-pre">a b</pre><button id="chat-control">Copy code</button></p></div><div data-azrael-dynamic-text><p id="user-paragraph" class="sample _Paragraph_63g8m_2">가 나</p></div>`;
  hs.writeFileSync(fixture, html.replace("</style>", `</style>${chatFixture}${modelFixture}`));
  const profile = hs.mkdtempSync(path.join(output, "chromium-profile-"));
  const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  let spawnError, socket, closeBrowser;
  child.on("error", error => { spawnError = error; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    const deadline = Date.now() + 20000;
    let endpoint;
    while (!endpoint && Date.now() < deadline) {
      if (spawnError) throw spawnError;
      assert.ok(child.exitCode === null && child.signalCode === null, `Owned Chromium exited before debugging was ready: ${stderr.slice(-800)}`);
      endpoint = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
      if (!endpoint) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(endpoint, `Chrome debugging endpoint unavailable: ${stderr.slice(-800)}`);
    const targets = await (await fetch(endpoint.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*/, "/json/list"))).json();
    socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Chromium debugging socket timed out")), 10000); socket.onopen = () => { clearTimeout(timer); resolve(); }; socket.onerror = error => { clearTimeout(timer); reject(error); }; });
    let next = 0; const pending = new Map();
    socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const { resolve, reject, timer } = pending.get(message.id); clearTimeout(timer); pending.delete(message.id); message.error ? reject(message.error) : resolve(message.result); } };
    socket.onclose = () => { for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error("Owned Chromium debugging socket closed")); } pending.clear(); };
    const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chromium ${method} timed out`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
    closeBrowser = () => call("Browser.close");
    await call("Page.enable"); await call("DOM.enable"); await call("CSS.enable");
    await call("Page.navigate", { url: pathToFileURL(fixture).href });
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) { ready = (await call("Runtime.evaluate", { expression: "!!document.querySelector('#composer')", returnByValue: true })).result.value; if (!ready) await new Promise(r => setTimeout(r, 50)); }
    assert.ok(ready, "fixture loaded");
    assert.equal((await call("Runtime.evaluate", { expression: "document.documentElement.dataset.azraelFontPlatform", returnByValue: true })).result.value, "win32", "Windows host executes production platform script before render");
    const platformFonts = async id => {
      await call("DOM.getDocument", { pierce: true });
      const expression = id === "identity" ? "document.querySelector('#shadow').shadowRoot.getElementById('identity')" : `document.getElementById(${JSON.stringify(id)})`;
      const { result } = await call("Runtime.evaluate", { expression });
      const { nodeId } = await call("DOM.requestNode", { objectId: result.objectId });
      const fonts = (await call("CSS.getPlatformFontsForNode", { nodeId })).fonts;
      await call("Runtime.releaseObject", { objectId: result.objectId });
      return fonts;
    };
    const measureSpacing = async (normalStack = NORMAL_FONT_FAMILY) => {
      const measured = await call("Runtime.evaluate", { expression: `(()=>{const result={};for(const id of ['chat-paragraph','chat-heading','chat-list','chat-cell','user-paragraph','content','composer','chat-title','dynamic-value','identity','chat-code','chat-pre','chat-control','copy','fixed']){const el=id==='identity'?document.getElementById('shadow').shadowRoot.getElementById(id):document.getElementById(id),span=document.createElement('span');span.style.whiteSpace='pre';el.append(span);const stack=getComputedStyle(el).fontFamily;const baseline=stack.includes(' Space')?${JSON.stringify(normalStack)}:stack;const width=(text,normal)=>{span.textContent=text;span.style.setProperty('font-family',normal?baseline:'inherit','important');const range=document.createRange();range.selectNodeContents(span);return range.getBoundingClientRect().width};result[id]={fontFamily:stack,fontSize:getComputedStyle(el).fontSize,lineHeight:getComputedStyle(el).lineHeight};for(const [language,spaced,joined] of [['korean','가 나','가나'],['latin','hello world','helloworld']]){const actual=width(spaced,false)-width(joined,false),original=width(spaced,true)-width(joined,true);result[id][language]={actual,original,ratio:actual/original,glyphWidth:width(joined,false),originalGlyphWidth:width(joined,true)}};span.remove()}return result})()`, returnByValue: true });
      assert.ok(!measured.exceptionDetails, JSON.stringify(measured.exceptionDetails));
      return measured.result.value;
    };
    const themes = {};
    const measureTypography = async () => {
      const evaluation = await call("Runtime.evaluate", { expression: `(async()=>{
        await document.fonts.load('16px "Azrael Consolas Space"',' ');await document.fonts.load('16px "Legacy Half Space"',' ');await document.fonts.ready;
        const result={models:{},caret:[]};
        for(const mode of ['reference','legacy'])document.querySelector('#model-'+mode+' [data-azrael-dynamic-text]').style.setProperty('font-family',(mode==='legacy'?'"Legacy Half Space",':'')+${JSON.stringify(NORMAL_FONT_FAMILY)},'important');
        for(const mode of ['reference','legacy','current']){const button=document.getElementById('model-'+mode),model=button.querySelector('[data-azrael-dynamic-text]'),effort=button.querySelector('.effort'),base=button.getBoundingClientRect();const position=el=>{const b=el.getBoundingClientRect();return {x:b.x-base.x,y:b.y-base.y,width:b.width,height:b.height}};const baseline=el=>{const marker=document.createElement('i');marker.className='baseline-marker';el.append(marker);const y=marker.getBoundingClientRect().y-base.y;marker.remove();return y};result.models[mode]={model:position(model),baseline:baseline(model),effort:position(effort),effortBaseline:baseline(effort),arrow:position(button.querySelector('svg'))}}
        const composer=document.getElementById('composer'),saved=composer.innerHTML,selection=getSelection();composer.focus();
        for(const text of ['a','a ','a  ','확인했습니다. ','a\\nb ']){composer.textContent=text;const node=composer.firstChild,range=document.createRange();range.setStart(node,node.length);range.collapse(true);selection.removeAllRanges();selection.addRange(range);const actual=range.getBoundingClientRect();composer.style.setProperty('font-family',${JSON.stringify(NORMAL_FONT_FAMILY)},'important');const normal=range.getBoundingClientRect();composer.style.removeProperty('font-family');result.caret.push({text,actual:actual.height,normal:normal.height})}composer.innerHTML=saved;selection.removeAllRanges();return result})()`, awaitPromise:true,returnByValue:true });
      assert.ok(!evaluation.exceptionDetails,JSON.stringify(evaluation.exceptionDetails));return evaluation.result.value;
    };
    for (const theme of ["light", "dark"]) {
    await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    const themed = await call("Runtime.evaluate", { expression: `(()=>{document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.className=${JSON.stringify(theme)};document.body.dataset.vscodeThemeKind=${JSON.stringify(theme)};document.querySelector('#shadow').dataset.theme=${JSON.stringify(theme)};document.body.style.background='var(--app-color-background-surface)';document.body.style.color='var(--color-text-primary)';const s=getComputedStyle(document.body);return {theme:document.documentElement.dataset.theme,colorScheme:getComputedStyle(document.documentElement).colorScheme,background:s.backgroundColor,color:s.color}})()`, returnByValue: true });
    assert.ok(!themed.exceptionDetails, JSON.stringify(themed.exceptionDetails));
    assert.equal(themed.result.value.theme, theme);
    assert.equal(themed.result.value.colorScheme, theme);
    const evaluation = await call("Runtime.evaluate", { expression: `(async()=>{await document.fonts.load('16px "Azrael Gyeonggi Title"','경기');await document.fonts.load('700 16px "Azrael Gyeonggi Title"','경기');await document.fonts.ready;const metrics={};for(const id of ['fixed','korean','latin','bold','markdown-bold','content','copy','composer']){const c=getComputedStyle(document.getElementById(id));metrics[id]={fontFamily:c.fontFamily,fontSize:c.fontSize,lineHeight:c.lineHeight,fontWeight:c.fontWeight,fontSynthesisWeight:c.fontSynthesisWeight}}for(const id of ['identity','refresh']){const c=getComputedStyle(document.querySelector('#shadow').shadowRoot.getElementById(id));metrics[id]={fontFamily:c.fontFamily,fontSize:c.fontSize,lineHeight:c.lineHeight,fontWeight:c.fontWeight,fontSynthesisWeight:c.fontSynthesisWeight}}return {metrics,faces:[...document.fonts].map(d=>({family:d.family,weight:d.weight,status:d.status}))}})()`, awaitPromise: true, returnByValue: true });
    assert.ok(!evaluation.exceptionDetails, JSON.stringify(evaluation.exceptionDetails));
    const evidence = evaluation.result.value;
    evidence.theme = themed.result.value;
    evidence.typography = await measureTypography();
    hs.writeFileSync(path.join(renderLogs, `composer-typography-${theme}.json`), JSON.stringify(evidence.typography, null, 2));
    for (const caret of evidence.typography.caret) assert.equal(caret.actual, caret.normal, `${theme}/${caret.text}: full-height collapsed caret range`);
    const { reference, legacy, current } = evidence.typography.models;
    assert.equal(current.baseline, reference.baseline, `${theme}: model-name baseline matches unscaled Consolas`);
    assert.equal(current.baseline, current.effortBaseline, `${theme}: model and effort baselines align`);
    assert.notEqual(legacy.baseline, reference.baseline, `${theme}: fixture reproduces raised model name`);
    assert.deepEqual(current.effort, legacy.effort, `${theme}: effort label stays in place`);
    assert.deepEqual(current.arrow, legacy.arrow, `${theme}: arrow stays in place`);
    assert.equal(current.model.width, legacy.model.width, `${theme}: half-space model width stays unchanged`);
    evidence.typographyVariants = [];
    for (const zoom of [1, 1.25, 1.5]) {
      for (const label of ["GPT-6.1 Sol", "한글 모델 GPT-6.1", "A very long model name with several spaces"]) {
        await call("Runtime.evaluate", { expression: `document.body.style.zoom=${zoom};for(const mode of ['reference','legacy','current'])document.querySelector('#model-'+mode+' [data-azrael-dynamic-text]').textContent=${JSON.stringify(label)}` });
        const measured = await measureTypography();
        hs.writeFileSync(path.join(renderLogs, 'typography-variant-last.json'), JSON.stringify({ theme, zoom, label, ...measured }, null, 2));
        for (const caret of measured.caret) assert.equal(caret.actual, caret.normal, `${theme}/${zoom}/${caret.text}: caret height`);
        const { current, reference, legacy } = measured.models;
        assert.ok(Math.abs(current.baseline-reference.baseline)<0.1, `${theme}/${zoom}/${label}: natural model baseline`);
        // Different faces round vertical metrics differently at fractional zoom.
        // Preserve the exact natural-font relationship, not an artificial offset.
        assert.equal(current.baseline-current.effortBaseline, reference.baseline-reference.effortBaseline, `${theme}/${zoom}/${label}: natural effort alignment`);
        assert.deepEqual(current.arrow, legacy.arrow, `${theme}/${zoom}/${label}: arrow geometry preserved`);
        assert.deepEqual(current.effort, legacy.effort, `${theme}/${zoom}/${label}: effort geometry preserved`);
        assert.equal(current.model.width, legacy.model.width, `${theme}/${zoom}/${label}: model width preserved`);
        evidence.typographyVariants.push({ zoom, label, ...measured });
      }
    }
    await call("Runtime.evaluate", { expression: "document.body.style.zoom='';for(const mode of ['reference','legacy','current'])document.querySelector('#model-'+mode+' [data-azrael-dynamic-text]').textContent='GPT-6.1 Sol'" });
    const shadow = await call("Runtime.evaluate", { expression: `(()=>{const host=document.querySelector('#shadow'),root=host.shadowRoot,result={};for(const [id,el] of [['host',host],['main',root.querySelector('main')],['identity',root.querySelector('#identity')],['refresh',root.querySelector('#refresh')]]){const s=getComputedStyle(el),rect=el.getBoundingClientRect();result[id]={background:s.backgroundColor,color:s.color,colorScheme:s.colorScheme,width:rect.width,height:rect.height}}return result})()`, returnByValue: true });
    assert.ok(!shadow.exceptionDetails, JSON.stringify(shadow.exceptionDetails));
    evidence.shadow = shadow.result.value;
    for (const [id, style] of Object.entries(evidence.shadow)) {
      assert.equal(style.colorScheme, theme, `${theme} shadow ${id} color scheme`);
      assert.ok(style.width > 0 && style.height > 0, `${theme} shadow ${id} has visible layout`);
    }
    assert.ok(evidence.shadow.host.height >= evidence.shadow.refresh.height, "shadow host contains control height");
    evidence.spacing = await measureSpacing();
    for (const [id, metrics] of Object.entries(evidence.spacing)) {
      const expected = ["chat-code", "chat-pre", "chat-control", "copy", "fixed"].includes(id) ? 1 : 0.5;
      for (const language of ["korean", "latin"]) {
        const measured = metrics[language];
        assert.ok(measured.actual > 1, `${id}/${language}: space must remain visible`);
        assert.ok(Math.abs(measured.glyphWidth - measured.originalGlyphWidth) < 0.02, `${id}/${language}: glyph widths unchanged`);
        assert.ok(Math.abs(measured.ratio - expected) < 0.02, `${id}/${language}: expected ${expected}, got ${measured.ratio}`);
      }
    }
    await call("Runtime.evaluate", { expression: "document.documentElement.dataset.azraelChatFont='openai'" });
    evidence.openai = await measureSpacing();
    for (const id of ["content", "composer", "chat-paragraph", "chat-heading", "chat-list", "chat-cell", "user-paragraph"]) {
      assert.ok(!evidence.openai[id].fontFamily.includes("Azrael"), `${id}: native OpenAI font`);
      assert.equal(evidence.openai[id].fontSize, evidence.spacing[id].fontSize);
      assert.equal(evidence.openai[id].lineHeight, evidence.spacing[id].lineHeight);
      for (const language of ["korean", "latin"]) assert.ok(Math.abs(evidence.openai[id][language].ratio - 1) < 0.02, `${id}: native space`);
    }
    evidence.openaiPlatformFonts = {};
    const openaiDocument = await call("DOM.getDocument");
    for (const id of ["composer", "chat-paragraph"]) {
      const { nodeId } = await call("DOM.querySelector", { nodeId: openaiDocument.root.nodeId, selector: `#${id}` });
      evidence.openaiPlatformFonts[id] = (await call("CSS.getPlatformFontsForNode", { nodeId })).fonts;
      assert.ok(evidence.openaiPlatformFonts[id].every(font => !font.isCustomFont), `${id}: actual native glyph fonts in OpenAI mode`);
    }
    for (const id of ["chat-title", "dynamic-value", "identity"]) assert.ok(Math.abs(evidence.openai[id].latin.ratio - 0.5) < 0.02, `${id}: dynamic typography independent of chat mode`);
    await call("Runtime.evaluate", { expression: "delete document.documentElement.dataset.azraelChatFont" });
    evidence.customRestored = await measureSpacing();
    assert.deepEqual(evidence.customRestored, evidence.spacing, "custom font restored after OpenAI toggle");
    console.log("PASS custom/OpenAI/custom Korean/Latin measured spacing; code and controls retain natural spaces");
    hs.writeFileSync(path.join(renderLogs, `render-evidence-${theme}.json`), JSON.stringify(evidence, null, 2));
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
    assert.ok(evidence.platformFonts.latin.some(d => !d.isCustomFont && /^Consolas/.test(d.postScriptName) && d.glyphCount > 0), "Windows Latin glyphs select actual local Consolas");
    assert.ok(evidence.platformFonts.copy.every(d => !d.isCustomFont));
    hs.writeFileSync(path.join(renderLogs, `render-evidence-${theme}.json`), JSON.stringify(evidence, null, 2));
    const screenshot = await call("Page.captureScreenshot", { format: "png" });
    hs.writeFileSync(path.join(renderLogs, `fixture-${theme}.png`), Buffer.from(screenshot.data, "base64"));
    themes[theme] = evidence;
    console.log(`PASS ${theme} isolated Chromium: official GyeonggiTitleL glyphs with normal400/no synthesis and retained Markdown bold, selected Latin/numbers face, UI Copy/fixed labels, shadow markers, unchanged 16px/24px metrics`);
    }
    assert.notEqual(themes.light.theme.background, themes.dark.theme.background, "native theme backgrounds must differ");
    assert.notEqual(themes.light.theme.color, themes.dark.theme.color, "native theme foregrounds must differ");
    for (const id of ["host", "main", "refresh"]) assert.notEqual(themes.light.shadow[id].background, themes.dark.shadow[id].background, `native shadow ${id} backgrounds must differ`);
    for (const id of ["identity", "refresh"]) assert.notEqual(themes.light.shadow[id].color, themes.dark.shadow[id].color, `native shadow ${id} foregrounds must differ`);
    const fallbackEvidence = {};
    // All branches run in Windows Chromium. Linux/macOS navigator values exercise
    // the production policy without claiming native environment verification.
    const variants = [
      { name: "missing-local", platform: "Win32", userAgentPlatform: "Windows", missingConsolas: true },
      { name: "linux", platform: "Linux x86_64", userAgentPlatform: undefined },
      { name: "macos", platform: "Win32", userAgentPlatform: "macOS" },
    ];
    for (const variant of variants) {
      const override = `Object.defineProperty(navigator,'platform',{value:${JSON.stringify(variant.platform)},configurable:true});Object.defineProperty(navigator,'userAgentData',{value:${variant.userAgentPlatform === undefined ? "undefined" : JSON.stringify({ platform: variant.userAgentPlatform })},configurable:true});`;
      let variantHtml = hs.readFileSync(fixture, "utf8").replace(`<script>${FONT_PLATFORM_SCRIPT}</script>`, `<script>${override}${FONT_PLATFORM_SCRIPT}</script>`);
      if (variant.missingConsolas) variantHtml = variantHtml.replaceAll('Consolas', 'AzraelUnavailableConsolas20261013');
      const variantFixture = path.join(output, `webview/assets/fixture-${variant.name}.html`);
      hs.writeFileSync(variantFixture, variantHtml);
      await call("Page.navigate", { url: pathToFileURL(variantFixture).href });
      let variantReady = false;
      for (let i = 0; i < 100 && !variantReady; i++) {
        variantReady = (await call("Runtime.evaluate", { expression: "!!document.querySelector('#composer') && !!document.querySelector('#shadow').shadowRoot", returnByValue: true })).result.value;
        if (!variantReady) await new Promise(r => setTimeout(r, 50));
      }
      assert.ok(variantReady, `${variant.name}: fixture loaded`);
      const loaded = await call("Runtime.evaluate", { expression: `(async()=>{await document.fonts.load('16px "Azrael Cascadia Mono"','Latin');await document.fonts.load('700 16px "Azrael Cascadia Mono"','Bold');await document.fonts.load('italic 16px "Azrael Cascadia Mono"','Italic');await document.fonts.load('16px "Azrael Gyeonggi Title"','경기');await document.fonts.ready;return {platform:document.documentElement.dataset.azraelFontPlatform,faces:[...document.fonts].map(f=>({family:f.family,style:f.style,weight:f.weight,status:f.status}))}})()`, awaitPromise: true, returnByValue: true });
      assert.ok(!loaded.exceptionDetails, JSON.stringify(loaded.exceptionDetails));
      assert.equal(loaded.result.value.platform, variant.missingConsolas ? "win32" : "other", `${variant.name}: production navigator policy`);
      const faces = loaded.result.value.faces.filter(f => f.family === "Azrael Cascadia Mono");
      assert.equal(faces.length, 2);
      for (const style of ["normal", "italic"]) assert.ok(faces.some(f => f.style === style && f.weight === "200 700" && f.status === "loaded"), `${variant.name}: loaded variable ${style} face`);
      fallbackEvidence[variant.name] = { environment: "Windows Chromium; navigator overrides", ...loaded.result.value, themes: {} };
      for (const theme of ["light", "dark"]) {
        await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
        await call("Runtime.evaluate", { expression: `document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.className=${JSON.stringify(theme)};document.body.dataset.vscodeThemeKind=${JSON.stringify(theme)};document.querySelector('#shadow').dataset.theme=${JSON.stringify(theme)}` });
        const spacing = await measureSpacing(variant.missingConsolas ? NORMAL_FONT_FAMILY.replaceAll('Consolas', 'AzraelUnavailableConsolas20261013') : DEFAULT_NORMAL_FONT_FAMILY);
        for (const [id, metrics] of Object.entries(spacing)) {
          if (!variant.missingConsolas) assert.ok(!metrics.fontFamily.includes("Consolas"), `${variant.name}/${id}: non-Windows stack excludes host Consolas`);
          for (const language of ["korean", "latin"]) {
            assert.ok(metrics[language].actual > 1, `${variant.name}/${id}/${language}: visible natural space`);
            assert.ok(Math.abs(metrics[language].ratio - 1) < 0.02, `${variant.name}/${id}/${language}: natural space advance`);
          }
        }
        const glyphs = {};
        for (const id of ["latin", "identity", "cascadia-bold", "cascadia-italic", "korean", "markdown-bold"]) glyphs[id] = await platformFonts(id);
        hs.writeFileSync(path.join(renderLogs, `glyph-evidence-${variant.name}-${theme}.json`), JSON.stringify({ spacing, glyphs, faces }, null, 2));
        for (const id of ["latin", "identity", "cascadia-bold", "cascadia-italic"]) {
          const expectedFace = id === "cascadia-bold" ? "CascadiaMonoRoman-Bold" : id === "cascadia-italic" ? "Cascadia-Mono-Italic" : "CascadiaMonoRoman";
          assert.ok(glyphs[id].some(f => f.isCustomFont && f.familyName === "Cascadia Mono" && f.postScriptName === expectedFace && f.glyphCount > 0), `${variant.name}/${id}: actual bundled Cascadia glyphs from ${expectedFace}`);
          assert.ok(glyphs[id].every(f => !/^Consolas/.test(f.postScriptName)), `${variant.name}/${id}: no host Consolas glyphs`);
        }
        assert.ok(glyphs['cascadia-italic'].some(f => f.isCustomFont && /Italic/.test(f.postScriptName) && f.glyphCount > 0), `${variant.name}: actual italic font`);
        for (const id of ["korean", "markdown-bold"]) assert.ok(glyphs[id].some(f => f.isCustomFont && f.postScriptName === "GyeonggiTitleL" && f.glyphCount > 0), `${variant.name}/${id}: official Korean Light glyphs`);
        const styles = (await call("Runtime.evaluate", { expression: `(()=>{const result={};for(const id of ['cascadia-bold','cascadia-italic']){const c=getComputedStyle(document.getElementById(id));result[id]={weight:c.fontWeight,style:c.fontStyle,synthesis:c.fontSynthesisWeight}}return result})()`, returnByValue: true })).result.value;
        assert.equal(styles['cascadia-bold'].weight, "700");
        assert.equal(styles['cascadia-bold'].synthesis, "none");
        assert.equal(styles['cascadia-italic'].style, "italic");
        await call("Runtime.evaluate", { expression: "document.documentElement.dataset.azraelChatFont='openai'" });
        const openai = await measureSpacing(variant.missingConsolas ? NORMAL_FONT_FAMILY.replaceAll('Consolas', 'AzraelUnavailableConsolas20261013') : DEFAULT_NORMAL_FONT_FAMILY);
        for (const id of ["content", "composer", "chat-paragraph", "chat-heading", "chat-list", "chat-cell", "user-paragraph"]) {
          assert.ok(!openai[id].fontFamily.includes("Azrael"), `${variant.name}/${id}: unchanged native OpenAI font`);
          assert.equal(openai[id].fontSize, spacing[id].fontSize);
          assert.equal(openai[id].lineHeight, spacing[id].lineHeight);
          for (const language of ["korean", "latin"]) assert.ok(Math.abs(openai[id][language].ratio - 1) < 0.02, `${variant.name}/${id}: native OpenAI spacing`);
        }
        for (const id of ["composer", "chat-paragraph"]) assert.ok((await platformFonts(id)).every(f => !f.isCustomFont), `${variant.name}/${id}: native OpenAI glyph fonts`);
        for (const id of ["chat-title", "dynamic-value", "identity"]) assert.deepEqual(openai[id], spacing[id], `${variant.name}/${id}: dynamic fonts independent of chat mode`);
        await call("Runtime.evaluate", { expression: "delete document.documentElement.dataset.azraelChatFont" });
        assert.deepEqual(await measureSpacing(variant.missingConsolas ? NORMAL_FONT_FAMILY.replaceAll('Consolas', 'AzraelUnavailableConsolas20261013') : DEFAULT_NORMAL_FONT_FAMILY), spacing, `${variant.name}: custom restored`);
        fallbackEvidence[variant.name].themes[theme] = { spacing, glyphs, styles, openai };
        const screenshot = await call("Page.captureScreenshot", { format: "png" });
        hs.writeFileSync(path.join(renderLogs, `fixture-${variant.name}-${theme}.png`), Buffer.from(screenshot.data, "base64"));
      }
      console.log(`PASS ${variant.name}: actual bundled normal/bold/italic Cascadia, Korean Light, natural light/dark/shadow spaces and native OpenAI mode (Windows host)`);
    }
    hs.writeFileSync(path.join(renderLogs, "missing-local-evidence.json"), JSON.stringify(fallbackEvidence['missing-local'], null, 2));
    hs.writeFileSync(path.join(renderLogs, "platform-fallback-evidence.json"), JSON.stringify(fallbackEvidence, null, 2));
    hs.writeFileSync(path.join(renderLogs, "render-evidence.json"), JSON.stringify({ themeCoverage: ["light", "dark"], themes }, null, 2));
  } finally {
    // CDP closes only this uniquely spawned browser/profile, including its children.
    // Closing the page socket or killing a Windows launcher alone can leave Chromium alive.
    if (closeBrowser && socket?.readyState === WebSocket.OPEN) {
      try { await closeBrowser(); } catch (error) { stderr += `\nOwned Browser.close: ${error.message ?? JSON.stringify(error)}\n`; }
    }
    socket?.close();
    hs.writeFileSync(path.join(renderLogs, "chromium.log"), stderr);
    const browserExit = !spawnError || child.pid ? await stopOwnedBrowser(child, !!closeBrowser, profile) : { spawnError: String(spawnError) };
    hs.writeFileSync(path.join(renderLogs, "browser-exit.json"), JSON.stringify(browserExit, null, 2));
    containedPath(output, profile);
    hs.rmSync(profile, { recursive: true, maxRetries: 5, retryDelay: 200 });
  }
}
if (!sourceOnly) verifyBrowser().catch(error => { console.error(error); process.exitCode = 1; });

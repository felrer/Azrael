import artifactRunTools from './artifact-run.cjs';
import Module, { createRequire } from 'node:module';
import { spawn as nativeSpawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, realpath, rm } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Source and fixture ownership are recorded before any generated file or browser exists.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = artifactRunTools.beginArtifactRun(root, {
  workId: 'DK-01-instruction-catalog-diagnosis', owner: 'scripts/verify-instruction-library-render.mjs',
});
const spawn = (...args) => artifactRunTools.trackArtifactChild(run, nativeSpawn(...args));
const profile = join(run.temporary, 'chrome-profile');
const summary = {
  scope: 'Production instructionView renderer and serialized client tools; isolated local Chrome with pinned app CSS when available. Host actions and catalog data are fixtures. No installed app, account, filesystem installation or remote repository is exercised.',
  platform: process.platform, runRoot: run.runRoot, lifecycleId: run.lifecycleId, checks: [], screenshots: [], themeSamples: {}, noticeContrast: {},
  fixtureRemoved: false, browserExit: { confirmed: true, processIds: [] },
};
let server, chrome, socket, session, sequence = 0;
const pending = new Map(), exceptions = [];
const inside = (parent, target) => { const rel = relative(parent, target); return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); };
const requests = [];
try {
  const require = createRequire(import.meta.url);
  const ts = require(require.resolve('typescript', { paths: [join(root, 'extensions/azrael-ex')] }));
  const sourcePath = join(root, 'extensions/azrael-ex/src/instructionView.ts');
  const compiled = ts.transpileModule(await readFile(sourcePath, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const viewModule = new Module(sourcePath);
  viewModule.filename = sourcePath; viewModule.paths = Module._nodeModulePaths(dirname(sourcePath));
  const originalLoad = Module._load;
  try {
    Module._load = function (name, parent, main) { return name === 'vscode' ? { env: { language: 'en' } } : originalLoad.call(this, name, parent, main); };
    viewModule._compile(compiled, sourcePath);
  } finally { Module._load = originalLoad; }
  const { renderInstructionMarkup, instructionClientTools } = viewModule.exports;
  assert.equal(typeof renderInstructionMarkup, 'function'); assert.equal(typeof instructionClientTools, 'function');
  const resource = (id, name, kind = 'context', extra = {}) => ({
    id, name, kind, sharing: 'local', digest: 'new', description: 'A readable description for ' + name,
    sourceKind: 'library', sourceLabel: 'My library', validationErrors: [], publications: [],
    versionLabel: '2.0', versions: [{ digest: 'old', label: '1.0' }, { digest: 'new', label: '2.0' }],
    files: [{ path: kind === 'skill' ? 'SKILL.md' : kind === 'playbook' ? 'PLAYBOOK.md' : 'CONTEXT.md', encoding: 'utf8', content: '# ' + name + '\n\nRead this resource before using it.\n' }],
    projectStatus: { state: 'missing', path: '' }, ...extra,
  });
  const entries = [resource('skill-one', 'Review skill', 'skill', { canToggleSkill: true, skillEnabled: false, canMigrate: true, sharing: 'public', provenance: { sourceKind: 'builtin', resourceId: 'official', digest: 'official-digest' } }), resource('playbook-one', 'Release playbook', 'playbook'),
    resource('remote-role', 'Remote role', 'agent-role', { catalogId: 'catalog-role', sourceKind: 'remote', sourceLabel: 'Team catalog', sharing: 'collaborators', readOnly: true }),
    ...Array.from({ length: 20 }, (_, index) => resource('context-' + index, 'Context resource ' + index))];
  const initial = {
    repository: 'fixture/isolated', currentVersion: null, pinnedVersion: null, selectedVersion: null,
    versions: [], downloadedVersions: [], components: [], documents: [], conflicts: [],
    error: { en: '<Existing source error>', ko: '<기존 소스 오류>' },
    library: { revision: 1, entries, connections: [{ sharing: 'public', repository: 'official/source', branch: 'main' }, { sharing: 'public', repository: 'personal/publish', branch: 'main' }], remoteVersions: [{ sharing: 'public', repository: 'official/source', version: 'official-version' }, { sharing: 'public', repository: 'personal/publish', version: 'personal-version' }], projects: [{ id: 'project-one', name: 'Fixture project' }], notices: Array.from({ length: 10 }, () => ({ en: 'Choose a project for playbooks.', ko: '플레이북에 사용할 프로젝트를 선택하세요.' })) },
  };
  let state = structuredClone(initial), locale = 'en';
  const markup = () => renderInstructionMarkup(state, undefined, locale);
  const assets = join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? join(root, 'artifacts/upstream-ui/26.1007.21434'), 'webview/assets');
  const styles = ['app-initial-aad627bd9dff.css', 'app-initial-49150e6a0951.css'].filter(name => existsSync(join(assets, name)));
  summary.nativeCss = styles.map(name => join(assets, name));
  const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@layer theme,base,components,utilities;</style>${styles.map(name => `<link rel="stylesheet" href="/assets/${name}">`).join('')}<style>
    html{color-scheme:light}html[data-theme=dark]{color-scheme:dark}html,body{margin:0;min-height:100%;background:var(--vscode-editor-background);color:var(--vscode-foreground)}
    body{--vscode-foreground:var(--color-text-primary,#202123);--vscode-descriptionForeground:var(--color-text-secondary,#666);--vscode-editor-background:var(--color-background-primary,#fff);--vscode-input-background:var(--color-background-primary,#fff);--vscode-input-foreground:var(--color-text-primary,#202123);--vscode-widget-border:var(--color-border-default,#ddd);--vscode-list-hoverBackground:var(--color-background-secondary,#f3f3f3);--vscode-textCodeBlock-background:var(--color-background-secondary,#f6f6f6);--vscode-focusBorder:#1677c8;--vscode-errorForeground:#b42318}
    html[data-theme=dark] body{--vscode-foreground:var(--color-text-primary,#ececec);--vscode-descriptionForeground:var(--color-text-secondary,#b4b4b4);--vscode-editor-background:var(--color-background-primary,#212121);--vscode-input-background:var(--color-background-primary,#212121);--vscode-input-foreground:var(--color-text-primary,#ececec);--vscode-widget-border:var(--color-border-default,#454545);--vscode-list-hoverBackground:var(--color-background-secondary,#303030);--vscode-textCodeBlock-background:var(--color-background-secondary,#2f2f2f);--vscode-errorForeground:#ff9696}
    body{--app-color-text-foreground:#202123;--app-color-text-secondary:#666;--app-color-background-surface:#fff;--app-color-background-editor-opaque:#fff;--vscode-foreground:var(--app-color-text-foreground);--vscode-input-foreground:var(--app-color-text-foreground);--vscode-editor-background:var(--app-color-background-surface);--vscode-input-background:var(--app-color-background-surface)}
    html[data-theme=dark] body{--app-color-text-foreground:#ececec;--app-color-text-secondary:#b4b4b4;--app-color-background-surface:#212121;--app-color-background-editor-opaque:#212121;--vscode-foreground:var(--app-color-text-foreground);--vscode-input-foreground:var(--app-color-text-foreground);--vscode-editor-background:var(--app-color-background-surface);--vscode-input-background:var(--app-color-background-surface)}
    #fixture-host{display:block;width:100%;min-width:0}
  </style></head><body data-vscode-theme-kind="vscode-light"><div id="fixture-host"></div><script src="/client.js"></script></body></html>`;
  const client = `window.fixtureErrors=[];window.fixtureRequests=[];window.fixturePending=0;
    addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));
    window.fixtureRoot=document.querySelector('#fixture-host').attachShadow({mode:'open'});
    const factory=${instructionClientTools.toString()};let tools=factory(fixtureRoot);
    const render=html=>{tools.capture();fixtureRoot.innerHTML=html;tools.restore()};
    window.resetFixture=async(language='en')=>{fixtureRoot.innerHTML='';tools=factory(fixtureRoot);render(await (await fetch('/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locale:language})})).text());};
    window.fixtureAction=async(button)=>{const action=button.dataset.action,payload=tools.payload(button);fixtureRequests.push({action,payload});fixturePending++;try{render(await(await fetch('/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})})).text())}finally{fixturePending--}};
    fixtureRoot.addEventListener('click',event=>{const b=event.target.closest('button[data-action]');if(b&&!b.disabled)fixtureAction(b).catch(e=>tools.error(e))});
    fixtureRoot.addEventListener('input',()=>tools.filter());fixtureRoot.addEventListener('change',e=>{tools.filter();tools.file(e.target)});
    window.setFilter=(name,value)=>{const e=fixtureRoot.querySelector('[data-filter="'+name+'"]');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};
    window.clickAction=(action,id)=>fixtureRoot.querySelector('button[data-action="'+action+'"]'+(id?'[data-id="'+id+'"]':'')).click();
    window.fixtureReady=false;resetFixture().then(()=>window.fixtureReady=true);
  `;
  await mkdir(profile, { recursive: true });
  await writeFile(join(run.temporary, 'index.html'), html); await writeFile(join(run.temporary, 'client.js'), client);
  const fixtureIdentity = await realpath(run.temporary);
  assert(inside(run.runRoot, fixtureIdentity)); assert(inside(fixtureIdentity, await realpath(profile)));
  server = createServer(async (req, res) => {
    try {
      if (req.url === '/reset' || req.url === '/action') {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1024 * 1024) throw Error('Fixture request too large'); }
        const request = JSON.parse(body);
        if (req.url === '/reset') { locale = request.locale === 'ko' ? 'ko' : 'en'; state = structuredClone(initial); }
        else {
          const { action, payload } = request; requests.push(request);
          const entry = state.library.entries.find(e => (e.catalogId ?? e.id) === payload.id);
          if (action === 'librarySelect' || action === 'libraryInspectVersion') state.library.selected = structuredClone(entry);
          if (action === 'librarySetSkillEnabled') { entry.skillEnabled = payload.enabled; if (state.library.selected?.id === entry.id) state.library.selected.skillEnabled = payload.enabled; }
          if (action === 'librarySetSource') { state.library.sourceMode = payload.sourceMode; state.library.sourceProject = payload.sourceProject; }
          if (action === 'libraryPlanDelete') state.library.plan = { token: 'delete-reviewed', kind: 'delete', summary: payload.removeInstallation ? 'Delete source and installation' : 'Delete personal source; retain installation', conflicts: [], diffs: [{ target: 'personal/source', current: 'source content', proposed: '' }] };
          if (action === 'libraryPlanMigrate') state.library.plan = { token: 'migrate-reviewed', kind: 'migrate', summary: 'Preserve differing legacy content as a personal derivative before migration', conflicts: [] };
          if (action === 'libraryMigrate') state.library.plan = undefined;
          if (action === 'libraryDelete') { state.library.entries = state.library.entries.filter(e => e.id !== state.library.selected.id); state.library.selected = undefined; state.library.plan = undefined; }
          if (action === 'libraryBack') state.library.selected = undefined;
          if (action === 'librarySetProject') state.library.selectedProject = payload.project;
          if (action === 'libraryCompare') state.library.comparison = { id: payload.id, from: payload.fromDigest, to: payload.toDigest, files: [
            { path: 'changed.md', current: 'Shared context\nOld instruction\nEnd', proposed: 'Shared context\nNew instruction\nEnd' },
            { path: 'added.md', proposed: 'Added guidance' }, { path: 'deleted.md', current: 'Deleted guidance' },
          ] };
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(markup()); return;
      }
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
      if (req.url === '/client.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(client); return; }
      const css = styles.find(name => req.url === '/assets/' + name);
      if (css) { res.setHeader('Content-Type', 'text/css'); res.end(await readFile(join(assets, css))); return; }
      res.statusCode = 404; res.end();
    } catch (error) { res.statusCode = 500; res.end(String(error.stack ?? error)); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const executable = process.env.AZRAEL_RENDER_CHROME ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync));
  if (!executable || !existsSync(executable)) throw Error('Isolated Chrome executable unavailable; set AZRAEL_RENDER_CHROME.');
  chrome = spawn(executable, ['--headless=new', '--disable-background-mode', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 20000);
    chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolveEndpoint(match[1]); } });
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
  });
  socket = new WebSocket(endpoint);
  await new Promise((open, reject) => { socket.addEventListener('open', open, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.id && pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result); }
  });
  const send = (method, params = {}, sid = session) => new Promise((resolveMessage, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 20000);
    pending.set(id, { resolve: resolveMessage, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
  });
  const evaluate = async expression => { const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value; };
  const wait = async expression => { for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await new Promise(resolveWait => setTimeout(resolveWait, 50)); } throw Error('Fixture wait failed: ' + expression); };
  const check = (name, value) => { assert.ok(value, name); summary.checks.push(name); };
  const shot = async name => { const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const target = join(run.outputs, name + '.png'); await writeFile(target, Buffer.from(result.data, 'base64')); summary.screenshots.push(target); };
  session = (await send('Target.attachToTarget', { targetId: (await send('Target.createTarget', { url: 'about:blank' }, null)).targetId, flatten: true }, null)).sessionId;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }); await wait('window.fixtureReady');
  for (const theme of ['light', 'dark']) for (const width of [1100, 420]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.body.dataset.vscodeThemeKind=${JSON.stringify('vscode-' + theme)};resetFixture()`);
    await wait('fixtureRoot.querySelectorAll(".library-entry").length===23');
    const label = `${theme}-${width}`;
    summary.themeSamples[label] = await evaluate(`({foreground:getComputedStyle(fixtureRoot.querySelector('main')).color,background:getComputedStyle(document.body).backgroundColor})`);
    summary.noticeContrast[label] = await evaluate(`(()=>{
      const notice=fixtureRoot.querySelector('[data-disclosure=notices] summary'),layers=[];
      for(let node=notice;node;node=node.parentElement??node.getRootNode()?.host)layers.unshift(node);
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='#fff';context.fillRect(0,0,1,1);
      for(const node of layers){context.fillStyle=getComputedStyle(node).backgroundColor;context.fillRect(0,0,1,1)}
      const background=[...context.getImageData(0,0,1,1).data].slice(0,3);
      context.fillStyle=getComputedStyle(notice).color;context.fillRect(0,0,1,1);
      const foreground=[...context.getImageData(0,0,1,1).data].slice(0,3);
      const luminance=rgb=>rgb.map(value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4}).reduce((total,value,index)=>total+value*[0.2126,0.7152,0.0722][index],0);
      const a=luminance(foreground),b=luminance(background);
      return {ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),foreground,background};
    })()`);
    check(label + ' notice normal text contrast at least 4.5:1', summary.noticeContrast[label].ratio >= 4.5);
    if (theme === 'dark') check(label + ' dark theme changes actual foreground and background', summary.themeSamples[label].foreground !== summary.themeSamples['light-' + width].foreground && summary.themeSamples[label].background !== summary.themeSamples['light-' + width].background);
    check(label + ' list default and no horizontal overflow', await evaluate(`getComputedStyle(fixtureRoot.querySelector('[data-catalog]')).display==='flex' && document.documentElement.scrollWidth<=innerWidth+1 && fixtureRoot.querySelector('main').scrollWidth<=fixtureRoot.querySelector('main').clientWidth+1`));
    check(label + ' theme token foreground/background differ', await evaluate(`getComputedStyle(fixtureRoot.querySelector('main')).color!==getComputedStyle(document.body).backgroundColor`));
    check(label + ' source errors escaped and visible', await evaluate(`fixtureRoot.querySelector('[role=alert]').textContent.includes('<Existing source error>') && !fixtureRoot.querySelector('main script')`));
    await shot(label + '-list');
    await evaluate(`setFilter('layout','cards')`);
    check(label + ' cards layout', await evaluate(`getComputedStyle(fixtureRoot.querySelector('[data-catalog]')).display==='grid'`));
    await shot(label + '-cards');
    await evaluate(`setFilter('search','does not exist')`);
    check(label + ' filtered count and no results', await evaluate(`fixtureRoot.querySelector('[data-result-count]').textContent==='0' && !fixtureRoot.querySelector('[data-no-results]').hidden`));
    await evaluate(`setFilter('search','Review');setFilter('kind','skill');setFilter('source','library');setFilter('sharing','public');setFilter('state','missing')`);
    check(label + ' combined filters and count', await evaluate(`fixtureRoot.querySelector('[data-result-count]').textContent==='1' && fixtureRoot.querySelector('[data-no-results]').hidden`));
    await evaluate(`setFilter('search','');setFilter('kind','');setFilter('source','');setFilter('sharing','');setFilter('state','');setFilter('layout','list');document.scrollingElement.scrollTop=500`);
    const scroll = await evaluate('document.scrollingElement.scrollTop');
    await evaluate(`clickAction('librarySelect','skill-one')`); await wait(`!!fixtureRoot.querySelector('.library-reading')`);
    check(label + ' skill install without project and full-width detail', await evaluate(`!fixtureRoot.querySelector('.library-reading [data-action=libraryPlanAcquire]').disabled && fixtureRoot.querySelector('.library-reading [data-action=libraryPlanAcquire]').textContent.includes('Install in Azrael') && fixtureRoot.querySelector('[data-library-browse]').hidden`));
    check(label + ' personal derivative install defaults excluded', await evaluate(`!fixtureRoot.querySelector('[data-field=install-enabled]').checked`));
    await evaluate(`fixtureRoot.querySelector('.library-reading [data-field=to-digest]').value='old';clickAction('libraryPlanAcquire','skill-one')`);
    await wait(`fixturePending===0 && fixtureRequests.some(r=>r.action==='libraryPlanAcquire'&&r.payload.digest==='old')`);
    check(label + ' historical install request uses active selector', requests.at(-1)?.payload.digest === 'old');
    check(label + ' historical install sends explicit exclusion', requests.at(-1)?.payload.enabled === false);
    await evaluate(`fixtureRoot.querySelector('[data-field=install-enabled]').checked=true;clickAction('libraryPlanAcquire','skill-one')`); await wait(`!fixturePending`);
    check(label + ' install inclusion requires explicit selection', requests.at(-1)?.payload.enabled === true);
    await evaluate(`clickAction('libraryBack')`); await wait(`!fixtureRoot.querySelector('[data-library-browse]').hidden`);
    check(label + ' back preserves list scroll and selected focus', await evaluate(`Math.abs(document.scrollingElement.scrollTop-${scroll})<3 && fixtureRoot.activeElement?.dataset.id==='skill-one'`));
    await evaluate(`setFilter('search','Review');setFilter('kind','skill');clickAction('librarySelect','skill-one')`); await wait(`!!fixtureRoot.querySelector('.library-reading')`);
    await evaluate(`clickAction('libraryBack')`); await wait(`!fixtureRoot.querySelector('[data-library-browse]').hidden`);
    check(label + ' back preserves search and kind', await evaluate(`fixtureRoot.querySelector('[data-filter=search]').value==='Review' && fixtureRoot.querySelector('[data-filter=kind]').value==='skill' && fixtureRoot.querySelector('[data-result-count]').textContent==='1'`));
    await evaluate(`(()=>{setFilter('search','');setFilter('kind','');const row=fixtureRoot.querySelector('.library-entry');row.querySelector('details').open=true;row.querySelector('[data-field=from-digest]').value='old';row.querySelector('[data-field=to-digest]').value='new';row.querySelector('[data-action=libraryCompare]').click()})()`);
    await wait(`!!fixtureRoot.querySelector('.library-entry .diff-added')`);
    check(label + ' inline comparison expands meaningful changed/added/deleted lines', await evaluate(`!fixtureRoot.querySelector('.library-reading') && fixtureRoot.querySelector('.library-entry details').open && fixtureRoot.querySelector('.library-entry .diff-added').textContent.includes('New instruction') && [...fixtureRoot.querySelectorAll('.library-entry .diff-deleted')].some(e=>e.textContent.includes('Deleted guidance')) && [...fixtureRoot.querySelectorAll('.library-entry .diff-added')].some(e=>e.textContent.includes('Added guidance'))`));
    check(label + ' comparison uses version labels instead of digests', await evaluate(`fixtureRoot.querySelector('.library-entry [data-comparison-label]').textContent==='1.0 → 2.0'`));
    await shot(label + '-comparison');
    await evaluate(`clickAction('librarySelect','playbook-one')`); await wait(`fixtureRoot.querySelector('.library-reading h2')?.textContent==='Release playbook'`);
    check(label + ' playbook requires explicit project', await evaluate(`fixtureRoot.querySelector('.library-reading [data-action=libraryPlanAcquire]').disabled`));
    await evaluate(`fixtureRoot.querySelector('[data-field=project]').value='project-one';clickAction('librarySetProject')`);
    await wait(`!fixtureRoot.querySelector('.library-reading [data-action=libraryPlanAcquire]').disabled`);
    check(label + ' playbook project download action', await evaluate(`fixtureRoot.querySelector('.library-reading [data-action=libraryPlanAcquire]').textContent.includes('Download to project')`));
    await shot(label + '-detail');
    await evaluate(`resetFixture()`); await wait(`fixtureRoot.querySelectorAll('.library-entry').length===23 && !fixturePending`);
    check(label + ' notices collapse to count', await evaluate(`!fixtureRoot.querySelector('[data-disclosure=notices]').open && fixtureRoot.querySelector('[data-disclosure=notices] summary').textContent.includes('10')`));
    await evaluate(`fixtureRoot.querySelector('[data-disclosure=notices] summary').click()`);
    check(label + ' source notice disclosure opens', await evaluate(`fixtureRoot.querySelector('[data-disclosure=notices]').open`));
    await evaluate(`fixtureRoot.querySelector('[data-disclosure=source-settings]').open=true;fixtureRoot.querySelector('[data-field=source-mode]').value='project';fixtureRoot.querySelector('[data-field=source-project]').value='project-one';clickAction('librarySetSource')`);
    await wait(`!fixturePending`);
    check(label + ' explicit developer source request', requests.at(-1)?.payload.sourceMode === 'project' && requests.at(-1)?.payload.sourceProject === 'project-one');
    await evaluate(`fixtureRoot.querySelector('[data-disclosure=connections]').open=true;fixtureRoot.querySelector('[data-connection=public-1] [data-action=libraryRemoteRefresh]').click()`); await wait(`!fixturePending`);
    check(label + ' second connection keeps repository identity', requests.at(-1)?.payload.repository === 'personal/publish');
    check(label + ' remote versions stay with their connection', await evaluate(`fixtureRoot.querySelector('[data-connection=public-0] [data-field=remote-version]').textContent.includes('official-version') && !fixtureRoot.querySelector('[data-connection=public-0] [data-field=remote-version]').textContent.includes('personal-version')`));
    await evaluate(`clickAction('librarySelect','skill-one')`); await wait(`!!fixtureRoot.querySelector('.library-reading') && !fixturePending`);
    await evaluate(`fixtureRoot.querySelector('.library-reading [role=switch]').click()`); await wait(`fixtureRoot.querySelector('.library-reading [role=switch]').getAttribute('aria-checked')==='true' && !fixturePending`);
    check(label + ' inclusion toggles only selected skill', requests.at(-1)?.payload.id === 'skill-one' && requests.at(-1)?.payload.enabled === true);
    await evaluate(`fixtureRoot.querySelector('[data-disclosure=notices]').open=false;fixtureRoot.querySelector('[data-disclosure=source-settings]').open=false;fixtureRoot.querySelector('.library-reading').scrollIntoView({block:'start'})`);
    await shot(label + '-inclusion');
    await evaluate(`clickAction('libraryPlanMigrate','skill-one')`); await wait(`!!fixtureRoot.querySelector('[data-action=libraryMigrate]') && !fixturePending`);
    check(label + ' migration review exposes preservation', await evaluate(`fixtureRoot.querySelector('[data-plan-token]').textContent.includes('Preserve differing legacy content')`));
    await evaluate(`clickAction('libraryMigrate')`); await wait(`!fixtureRoot.querySelector('[data-plan-token]') && !fixturePending`);
    check(label + ' migration confirms frozen token', requests.at(-1)?.payload.token === 'migrate-reviewed');
    await evaluate(`fixtureRoot.querySelector('[data-disclosure=manage]').open=true;fixtureRoot.querySelector('[data-field=publish-repository]').value='personal/publish';clickAction('libraryPlanPublish','skill-one')`); await wait(`!fixturePending`);
    check(label + ' publish uses separate explicit destination', requests.at(-1)?.payload.repository === 'personal/publish');
    await evaluate(`clickAction('libraryPlanDelete','skill-one')`); await wait(`!!fixtureRoot.querySelector('[data-plan-token]') && !fixturePending`);
    check(label + ' deletion defaults source only and shows effects', requests.at(-1)?.payload.removeInstallation === false && await evaluate(`fixtureRoot.querySelector('[data-plan-token]').textContent.includes('retain installation') && fixtureRoot.querySelector('[data-plan-token]').textContent.includes('personal/source')`));
    await evaluate(`fixtureRoot.querySelector('[data-delete-id]').scrollIntoView({block:'start'})`);
    await shot(label + '-management');
    await evaluate(`fixtureRoot.querySelector('[data-field=remove-installation]').checked=true;clickAction('libraryPlanDelete','skill-one')`); await wait(`!fixturePending`);
    check(label + ' installation removal requires explicit selection', requests.at(-1)?.payload.removeInstallation === true);
    await evaluate(`clickAction('libraryDelete')`); await wait(`!fixtureRoot.querySelector('.library-reading') && !fixturePending`);
    check(label + ' deletion confirms frozen token and updates catalog', requests.at(-1)?.payload.token === 'delete-reviewed' && await evaluate(`fixtureRoot.querySelectorAll('.library-entry').length===22`));
    check(label + ' detail no horizontal overflow', await evaluate(`document.documentElement.scrollWidth<=innerWidth+1 && fixtureRoot.querySelector('main').scrollWidth<=fixtureRoot.querySelector('main').clientWidth+1`));
  }
  await evaluate(`resetFixture('ko')`); await wait(`fixtureRoot.querySelector('main').lang==='ko'`);
  check('Korean source labels and reference document wording', await evaluate(`fixtureRoot.querySelector('.library-entry small').textContent.includes('내 라이브러리') && fixtureRoot.querySelector('[data-filter=kind]').textContent.includes('참고 문서')`));
  await evaluate(`(()=>{fixtureRoot.querySelector('[data-disclosure=create]').open=true;const name=fixtureRoot.querySelector('[data-field=create-name]');name.value='한국어 제목';name.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  check('Korean title suggests editable ASCII installation identifier', await evaluate(`/^skill-[a-f0-9]{12}$/.test(fixtureRoot.querySelector('[data-field=create-installation-name]').value) && fixtureRoot.querySelector('[data-field=create-name]').value==='한국어 제목'`));
  await evaluate(`fixtureRoot.querySelector('[data-field=create-installation-name]').value='custom-name';clickAction('libraryCreate')`);
  await wait(`fixturePending===0 && fixtureRequests.some(r=>r.action==='libraryCreate')`);
  check('Korean creation preserves display title and explicit installation name', requests.at(-1)?.payload.name === '한국어 제목' && /name: custom-name\n/.test(requests.at(-1)?.payload.files?.[0]?.content));
  check('localized existing errors remain visible', await evaluate(`fixtureRoot.querySelector('[role=alert]').textContent.includes('<기존 소스 오류>')`));
  check('browser exceptions absent', exceptions.length === 0 && (await evaluate('fixtureErrors')).length === 0);
  await shot('korean-create');
  summary.outcome = 'passed';
  await send('Browser.close', {}, null).catch(() => {});
} catch (error) {
  summary.outcome = 'failed'; summary.error = String(error.stack ?? error); summary.exceptions = exceptions; process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) { try { socket.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' })); } catch {} socket.close(); }
  for (const item of pending.values()) clearTimeout(item.timer);
  if (server) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
  try {
    summary.browserExit = await artifactRunTools.confirmOwnedBrowserExit(chrome, profile, spawn);
    run.producerStopped = summary.browserExit.confirmed;
    if (!summary.browserExit.confirmed) throw Error('Owned Chrome process tree stop unconfirmed; fixture retained.');
    const actualTemporary = await realpath(run.temporary);
    assert.equal(actualTemporary, resolve(run.temporary)); assert(inside(run.runRoot, actualTemporary));
    assert(inside(actualTemporary, resolve(profile)));
    // Ordinary deletion only, after exact owned-browser exit and absolute containment checks.
    await rm(actualTemporary, { recursive: true });
    summary.fixtureRemoved = !existsSync(actualTemporary);
    if (!summary.fixtureRemoved) throw Error('Fixture still exists after ordinary deletion.');
  } catch (error) { summary.cleanupError = String(error.stack ?? error); summary.outcome = 'failed'; process.exitCode = 1; }
  summary.requests = requests; summary.exitCode = process.exitCode ?? 0;
  await writeFile(join(run.reports, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ outcome: summary.outcome, checks: summary.checks.length, exitCode: summary.exitCode, report: join(run.reports, 'summary.json'), fixtureRemoved: summary.fixtureRemoved, browserStopped: summary.browserExit.confirmed }));
}

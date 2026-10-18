"use strict";
// Isolated Windows VS Code Webview experiment. No product build or user profile access.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto'), assert = require('node:assert/strict'), {spawn:nativeSpawn, spawnSync } = require('node:child_process');
const commandDrag = process.argv.includes('--command-drag');
const workId = commandDrag ? 'ce02-command-drag-r1' : 'ce01-gray-repro-r1';
const root = path.resolve(__dirname, '..');
const {beginArtifactRun,trackArtifactChild}=require('./artifact-run.cjs');
const artifactRun=beginArtifactRun(root,{workId:'verify-scroll-timeline-crash-host',owner:'scripts/verify-scroll-timeline-crash-host.cjs'});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const base=artifactRun.temporary,logs=artifactRun.logs;
const arg = n => process.argv.find(x => x.startsWith('--' + n + '='))?.slice(n.length + 3), mode = arg('mode') || 'baseline', runs = Number(arg('runs') || 1);
assert.ok(['baseline', 'control', 'patched'].includes(mode));
assert.ok(Number.isInteger(runs) && runs >= 1 && runs <= 3);
const production = process.argv.includes('--production') || mode === 'patched';
const { CSS_ASSET, injectScrollFade, RUNTIME } = require('./inject-scroll-fade.cjs');
const input = path.join(__dirname, commandDrag ? 'verify-command-drag-checks.cjs' : 'fixtures/scroll-timeline-selection.html'), source = fs.readFileSync(input, 'utf8'), sha = s => crypto.createHash('sha256').update(s).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function checkVisuals(evaluate, shot) {
    const rows = [];
    await evaluate(`getSelection().removeAllRanges();document.body.insertAdjacentHTML('beforeend','<div id="visual" style="display:flex;gap:16px"></div>');void 0`);
    for (const theme of ['light', 'dark']) {
        await evaluate(`document.body.style.background='${theme === 'dark' ? '#212121' : '#fff'}';document.body.style.color='${theme === 'dark' ? '#eee' : '#111'}';document.body.className='vscode-${theme}';void 0`);
        for (const variant of ['vertical-scroll-fade-mask', 'vertical-scroll-fade-mask-top', 'vertical-scroll-fade-mask-bottom', 'horizontal-scroll-fade-mask']) {
            await evaluate(`document.querySelector('#visual').innerHTML='<div id="sample" class="${variant}" style="overflow:auto;width:200px;height:100px;--edge-fade-distance:16px"><div style="width:600px;height:300px;background:repeating-linear-gradient(0deg,#777 0px,#777 8px,#bbb 8px,#bbb 16px)">Scroll fade sample</div></div>';void 0`);
            for (const progress of [0, .5, 1]) {
                await evaluate(`(()=>{const s=document.querySelector('#sample');s.scrollTop=(s.scrollHeight-s.clientHeight)*${progress};s.scrollLeft=(s.scrollWidth-s.clientWidth)*${progress};})()`);
                await sleep(90);
                const value = await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('#sample'));return {first:s.getPropertyValue('${variant.startsWith('horizontal') ? '--left-fade' : '--top-fade'}'),last:s.getPropertyValue('${variant.startsWith('horizontal') ? '--right-fade' : '--bottom-fade'}'),mask:s.maskImage}})()`);
                assert.ok(value.mask.includes('linear-gradient'), 'production mask remains active');
                rows.push({ theme, variant, progress, ...value });
            }
            await shot(theme + '-' + variant);
        }
    }
    await evaluate(`{document.querySelector('#visual').remove();const range=document.createRange();range.setStart(document.querySelector('#text').firstChild,0);range.setEnd(document.querySelector('#text').firstChild,15);getSelection().addRange(range);}void 0`);
    return rows;
}
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function targets(p) { try {
    return await (await fetch('http://127.0.0.1:' + p + '/json/list', { signal: AbortSignal.timeout(1000) })).json();
}
catch {
    return [];
} }
async function connect(url) { const ws = new WebSocket(url); await new Promise((r, j) => { const t = setTimeout(() => j(Error('WebSocket open timeout')), 5000); ws.addEventListener('open', () => { clearTimeout(t); r(); }, { once: true }); ws.addEventListener('error', j, { once: true }); }); let seq = 0; const pending = new Map(), contexts = [], events = []; ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.executionContextCreated')
    contexts.push(m.params.context); if (/crash|exception/i.test(m.method || ''))
    events.push(m); const p = pending.get(m.id); if (p) {
    pending.delete(m.id);
    clearTimeout(p.t);
    m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
} }); const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq, t = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 5000); pending.set(id, { resolve, reject, t }); ws.send(JSON.stringify({ id, method, params })); }); await send('Runtime.enable'); return { send, contexts, events, eval: async (expression, contextId) => { const r = await send('Runtime.evaluate', { expression, contextId, awaitPromise: false, returnByValue: true }); if (r.exceptionDetails)
        throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }, close() { ws.close(); for (const p of pending.values())
        clearTimeout(p.t); } }; }
async function one(index) {
    const id = mode + '-' + Date.now() + '-' + index, fixture = path.join(base, id), evidence = path.join(logs, id), extension = path.join(fixture, 'extension'), state = path.join(fixture, 'state');
    fs.mkdirSync(extension, { recursive: true });
    fs.mkdirSync(evidence, { recursive: true });
    fs.mkdirSync(state);
    const code = path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe');
    assert.ok(fs.existsSync(code));
    let html = source;
    if (!commandDrag && mode !== 'baseline')
        html = html.replace('animation-timeline: scroll(self y);', 'animation-timeline: auto;');
    if (!commandDrag && production) {
        const nativeCss = fs.readFileSync(path.join(root, 'artifacts/upstream-ui/26.1007.21434', CSS_ASSET), 'utf8');
        html = html.replace('animation: fade linear both; animation-timeline: ' + (mode === 'baseline' ? 'scroll(self y)' : 'auto') + ';', '').replaceAll('class="scroller"', 'class="scroller vertical-scroll-fade-mask"');
        html = html.replace('<style>', '<style>' + (mode === 'patched' ? injectScrollFade(nativeCss, CSS_ASSET).text : nativeCss));
        if (mode === 'patched')
            html = html.replace('<script>', '<script>' + RUNTIME);
    }
    html = commandDrag ? require('./verify-command-drag-checks.cjs').makeHtml() : html.replace('for (const scroller of', 'window.toggleCount=(window.toggleCount||0)+1; for (const scroller of');
    fs.writeFileSync(path.join(extension, 'fixture.html'), html);
    fs.writeFileSync(path.join(extension, 'package.json'), JSON.stringify({ name: 'scroll-timeline-fixture', publisher: 'azrael-test', version: '0.0.1', engines: { vscode: '^1.96.0' }, activationEvents: ['*'], main: 'extension.cjs' }));
    fs.writeFileSync(path.join(extension, 'extension.cjs'), `const vscode=require('vscode'),fs=require('fs'),path=require('path');exports.activate=()=>{globalThis.__scrollFixture={open(){const p=vscode.window.createWebviewPanel('scrollFixture','ScrollTimeline synthetic fixture',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true});p.webview.html=fs.readFileSync(path.join(__dirname,'fixture.html'),'utf8');},quit:()=>vscode.commands.executeCommand('workbench.action.quit')};};`);
    const inspector = await port(), renderer = await port(), env = { ...process.env };
    for (const k of Object.keys(env))
        if (/^(AZRAEL_|CODEX_|ELECTRON_|VSCODE_|DEVIN_|NODE_OPTIONS$|NODE_COMPILE_CACHE$)|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN|CREDENTIAL/i.test(k))
            delete env[k];
    env.CODEX_HOME = state;
    const args = ['--new-window', '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates', '--user-data-dir=' + path.join(fixture, 'profile'), '--shared-data-dir=' + path.join(fixture, 'shared-data'), '--extensions-dir=' + path.join(fixture, 'extensions'), '--extensionDevelopmentPath=' + extension, '--inspect-extensions=' + inspector, '--remote-debugging-port=' + renderer, '--crash-reporter-directory=' + path.join(fixture, 'crashes'), extension];
    const result = { id, mode, production, input, inputSha256: sha(source), fixtureHtmlSha256: sha(html), runtimeSha256: sha(RUNTIME), code, platform: process.platform, arch: process.arch, args, fixture, evidence, started: new Date().toISOString(), checks: [], limitations: [] };
    fs.writeFileSync(path.join(evidence, 'planned.json'), JSON.stringify(result, null, 2));
    const child = spawn(code, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', host, view, ctx, page;
    const connections = [];
    child.stdout.on('data', b => output += b);
    child.stderr.on('data', b => output += b);
    child.on('error', e => output += e);
    result.launchPid = child.pid;
    try {
        let t;
        for (let n = 0; n < 100 && !t; n++) {
            t = (await targets(inspector)).find(t => t.webSocketDebuggerUrl);
            if (!t)
                await sleep(300);
        }
        assert.ok(t, 'extension inspector ready');
        result.stage = 'connect-host';
        host = await connect(t.webSocketDebuggerUrl);
        connections.push(host);
        await host.send('Runtime.runIfWaitingForDebugger');
        for (let n = 0; n < 100; n++) {
            if (await host.eval('!!globalThis.__scrollFixture'))
                break;
            await sleep(200);
        }
        result.stage = 'open-panel';
        await host.eval('globalThis.__scrollFixture.open();void 0');
        result.stage = 'find-renderer';
        for (let n = 0; n < 25 && !view; n++) {
            for (const t of (await targets(renderer)).filter(t => ['page', 'iframe'].includes(t.type) && t.webSocketDebuggerUrl)) {
                const c = await connect(t.webSocketDebuggerUrl);
                connections.push(c);
                if (t.type === 'page')
                    page = c;
                await sleep(60);
                for (const x of c.contexts) {
                    try {
                        if (await c.eval("!!document.querySelector('#toggle')", x.id)) {
                            view = c;
                            ctx = x.id;
                            break;
                        }
                    }
                    catch { }
                }
                if (view)
                    break;
            }
            if (!view)
                await sleep(300);
        }
        assert.ok(view, 'synthetic Webview context ready');
        result.stage = 'exercise';
        const evaluate = s => view.eval(s, ctx);
        const shot = async (name) => { try {
            const s = await (page || view).send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from(s.data, 'base64'));
        }
        catch (e) {
            result.limitations.push(String(e));
        } };
        if (commandDrag) {
            await require('./verify-command-drag-checks.cjs').check({ evaluate, view, shot, result });
        } else {
        result.before = await evaluate("({ua:navigator.userAgent,timeline:getComputedStyle(document.querySelector('.scroller')).animationTimeline,selection:getSelection().toString(),rangeCount:getSelection().rangeCount})");
        assert.ok(result.before.selection.length > 0);
        assert.equal(result.before.timeline, mode === 'baseline' ? 'scroll(self y)' : 'auto');
        result.checks.push('Noncollapsed selection and requested timeline confirmed in actual native Webview');
        await shot('before');
        if (production)
            result.visuals = await checkVisuals(evaluate, shot);
        // OOPIF Input coordinates are local to its target. Workbench includes the child frame offset.
        const box = await evaluate("(()=>{const b=document.querySelector('#toggle').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()");
        result.clickCoordinates = box;
        result.interaction = 'CDP Input.dispatchMouseEvent mousePressed/mouseReleased (trusted browser input)';
        for (let i = 0; i < 6; i++) {
            try {
                await view.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...box });
                await view.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...box });
                await sleep(200);
                result.after = await evaluate("({selection:getSelection().toString(),toggleCount:window.toggleCount||0,displays:[...document.querySelectorAll('.scroller')].map(e=>getComputedStyle(e).display)})");
                result.clicksCompleted = i + 1;
            }
            catch (error) {
                result.interactionError = String(error);
                break;
            }
        }
        }
        await sleep(1200);
        result.events = connections.flatMap(c => c.events);
        result.crashed = result.events.some(e => /crash/i.test(e.method));
        result.responsive = false;
        try {
            result.responsive = await evaluate('1+1===2');
        }
        catch (e) {
            result.responsivenessError = String(e);
        }
        await shot('after');
        result.outcome = result.crashed ? 'renderer-crash' : result.responsive ? 'survived' : 'unresponsive';
        assert.equal(result.outcome, !commandDrag && mode === 'baseline' ? 'renderer-crash' : 'survived', 'expected experiment outcome');
        if (result.outcome === 'survived')
            assert.equal(result.after.toggleCount, 6, 'trusted clicks must invoke the handler');
    }
    catch (e) {
        result.error = String(e.stack || e);
        result.outcome = 'harness-error';
    }
    finally {
        if (host)
            try {
                await host.eval('globalThis.__scrollFixture.quit();void 0');
            }
            catch (e) {
                result.quitError = String(e);
            }
        for (const c of connections)
            c.close();
        for (let i = 0; i < 150 && child.exitCode === null; i++)
            await sleep(100);
        result.launchExitCode = child.exitCode;
        fs.writeFileSync(path.join(evidence, 'launch.log'), output);
        result.outputCrashLines = output.split(/\r?\n/).filter(l => /crash|exception|0xc0000005|renderer process/i.test(l));
        // Retain the whole fixture bundle after owned-process exit checks.
        const cleanup = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference='Stop'
$fixture=[IO.Path]::GetFullPath($env:SCROLL_FIXTURE)
$base=[IO.Path]::GetFullPath($env:SCROLL_BASE)
if(-not $fixture.StartsWith($base+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid fixture'}
# Quit was already requested through this fixture's own extension inspector.
# Stop only surviving Code processes carrying this exact disposable profile.
$owned=@(Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/','\\').Contains($fixture+[IO.Path]::DirectorySeparatorChar) })
foreach($process in $owned){$process | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress; Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue}
$live=@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/','\\').Contains($fixture) })
if($live.Count){$live | Select-Object ProcessId,Name | ConvertTo-Json; throw 'Owned fixture still referenced'}
'Owned fixture retained; no live references.'`], { env: { ...process.env, SCROLL_FIXTURE: fixture, SCROLL_BASE: base }, encoding: 'utf8', windowsHide: true, timeout: 30000 });
        result.cleanupExitCode = cleanup.status;
        if(cleanup.status!==0)artifactRun.producerStopped=false;
        result.runRoot=artifactRun.runRoot;result.lifecycleId=artifactRun.lifecycleId;result.retentionReason='Retained raw fixture, profile and crash evidence for lifecycle review';
        fs.writeFileSync(path.join(evidence, 'cleanup.log'), String(cleanup.stdout || '') + String(cleanup.stderr || '') + String(cleanup.error || ''));
        result.finished = new Date().toISOString();
        result.exitCode = result.outcome === 'harness-error' || cleanup.status !== 0 ? 1 : 0;
        fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
        console.log(JSON.stringify({runRoot:artifactRun.runRoot,lifecycleId:artifactRun.lifecycleId,id, outcome: result.outcome, exitCode: result.exitCode, evidence, fixture, error: result.error }));
    }
    return result;
}
(async () => { assert.equal(process.platform, 'win32'); fs.mkdirSync(base, { recursive: true }); fs.mkdirSync(logs, { recursive: true }); for (let i = 1; i <= runs; i++) {
    const r = await one(i);
    if (r.exitCode) {
        process.exitCode = r.exitCode;
        break;
    }
} })().catch(e => { console.error(e); process.exitCode = 1; });

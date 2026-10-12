import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createBoardServer } from '../server.mjs';
import { openBrowser } from './browser-driver.mjs';

const fixture = resolve('artifacts/verification/board-sketch-browser');
const logs = resolve('artifacts/logs/board-sketch');
await mkdir(fixture, { recursive: true }); await mkdir(logs, { recursive: true });
const build = JSON.parse(await readFile(resolve('artifacts/boards/sketch/current.json'), 'utf8'));
const run = String(Date.now());
const dataRoot = join(fixture, 'data-' + run);
const app = await createBoardServer({ board: 'sketch', dataRoot, configPath: join(fixture, 'settings-' + run + '.json'), publicRoot: build.publicRoot });
const browser = await openBrowser(join(fixture, 'chrome-profile-' + run));
const summary = { scope: 'Production Excalidraw/local bundle, actual Chrome input, real HTTP/files/backup/handoff on Windows; synthetic data.', startedAt: new Date().toISOString(), checks: [], network: [] };
const requests = new Map();
summary.build = { inputSha256: build.inputSha256, publicRoot: build.publicRoot, jsRawBytes: 0, jsGzipBytes: 0, cssRawBytes: 0, fontBytes: 0 };
const check = (name, truth) => { assert.ok(truth, name); summary.checks.push(name); };
browser.onEvent(message => {
  if (message.method === 'Network.requestWillBeSent') { summary.network.push(message.params.request.url); requests.set(message.params.requestId, { url: message.params.request.url }); }
  if (message.method === 'Network.responseReceived' && requests.has(message.params.requestId)) requests.get(message.params.requestId).response = { status: message.params.response.status, mimeType: message.params.response.mimeType };
  if (message.method === 'Network.loadingFailed' && requests.has(message.params.requestId)) requests.get(message.params.requestId).failure = { errorText: message.params.errorText, blockedReason: message.params.blockedReason };
});
await browser.send('Network.enable'); await browser.send('Performance.enable');
const state = async () => (await fetch(app.origin + '/api/state')).json();
const click = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = async (selector, value) => { await browser.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select(); })()`); await browser.send('Input.insertText', { text: value }); };
const key = async (name, code = name.toUpperCase().charCodeAt(0), modifiers = 0) => { await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name.length === 1 ? 'Key' + name.toUpperCase() : name, windowsVirtualKeyCode: code, modifiers }); await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, windowsVirtualKeyCode: code, modifiers }); };
const pointer = async (x, y, toX = x, toY = y) => { await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); if (toX !== x || toY !== y) { for (let n=1; n<=6; n++) await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x+(toX-x)*n/6, y: y+(toY-y)*n/6, buttons: 1 }); } await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', clickCount: 1 }); };
const settle = () => browser.wait(`document.querySelector('[data-testid="save-status"]')?.textContent !== '처리 중…'`);
const save = async () => { await click('[data-testid="save"]'); await settle(); check('save acknowledges persisted revision', await browser.evaluate(`document.querySelector('[data-testid="save-status"]').textContent.startsWith('저장됨') && !document.querySelector('[role="alert"]')`)); };
const button = label => browser.evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(label)});if(!el)throw Error('Missing button '+${JSON.stringify(label)});el.click();})()`);
try {
  for (const name of await readdir(build.publicRoot, { recursive: true })) {
    if (name.split(/[\\/]/)[0] === 'licenses' || !/\.(js|css|woff2)$/.test(name) || !(await stat(join(build.publicRoot, name))).isFile()) continue;
    const bytes = await readFile(join(build.publicRoot, name));
    if (name.endsWith('.js')) { summary.build.jsRawBytes += bytes.length; summary.build.jsGzipBytes += gzipSync(bytes).length; }
    if (name.endsWith('.css')) summary.build.cssRawBytes += bytes.length;
    if (name.endsWith('.woff2')) summary.build.fontBytes += bytes.length;
  }
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url: app.origin + '/' });
  await browser.wait(`document.querySelector('.excalidraw canvas') && document.querySelector('[data-testid="save"]')`);
  summary.firstReadyMs = Math.round(await browser.evaluate('performance.now()'));
  await browser.evaluate('document.fonts.ready.then(()=>true)');
  summary.fontReadyMs = Math.round(await browser.evaluate('performance.now()'));
  summary.initialLoadedResourceBytes = await browser.evaluate(`performance.getEntriesByType('resource').reduce((total,item)=>total+item.encodedBodySize,0)`);
  check('empty unsaved sketch loads', (await state()).document.scene.elements.length === 0 && await browser.evaluate(`document.querySelector('[data-testid="save-status"]').textContent.includes('아직 저장하지 않음')`));
  await pointer(1000, 720); await key('r'); await pointer(350, 320, 610, 470);
  await browser.wait(`!document.querySelector('[data-testid="save"]').disabled`);
  await save();
  let current = await state();
  check('actual pointer draws a rectangle with geometry', current.document.scene.elements.some(el => el.type === 'rectangle' && el.width > 200));
  const rectangle = current.document.scene.elements.find(el => el.type === 'rectangle');
  await key('v'); await pointer(350, 390);
  await browser.wait(`document.querySelector('[data-testid="element-note"]')`);
  await type('[data-testid="element-note"]', '입구를 넓히고 이 위치에 안내 표시');
  await browser.evaluate(`(() => {const el=document.querySelector('[data-testid="element-category"]');el.value='requirement';el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await save();
  current = await state(); check('selected rectangle stores explicit Korean note and category', current.document.scene.elements.find(el=>el.id===rectangle.id).customData.board.note.includes('입구를 넓히고'));
  await pointer(1020, 750); await key('t'); await pointer(720, 430); await browser.send('Input.insertText', { text: '출구로 연결' }); await key('Escape', 27);
  await save(); current = await state(); check('actual editor Korean text persists', current.document.scene.elements.some(el=>el.type==='text' && el.text==='출구로 연결'));
  await pointer(1010, 710); await key('a'); await pointer(625, 390, 715, 430); await save();
  current = await state(); check('actual arrow editor persists arrow', current.document.scene.elements.some(el=>el.type==='arrow'));
  await pointer(1050, 700); await key('p'); await pointer(700, 550, 880, 630);
  await key('z', 90, 2); await save(); current = await state(); check('undo removes free drawing from live elements', !current.document.scene.elements.some(el=>el.type==='freedraw'&&!el.isDeleted));
  await key('z', 90, 10); await save(); current=await state(); check('redo restores free drawing', current.document.scene.elements.some(el=>el.type==='freedraw'&&!el.isDeleted));
  // Add a real local raster through the production file input, using a CDP file chooser.
  const pngPath = join(fixture, 'pixel.png');
  const raster = await browser.evaluate(`(() => { const c=document.createElement('canvas');c.width=240;c.height=160;const x=c.getContext('2d');x.fillStyle='#dbeafe';x.fillRect(0,0,240,160);x.fillStyle='#2563eb';x.fillRect(20,20,85,90);x.fillRect(135,60,85,80);x.fillStyle='#111827';x.font='16px sans-serif';x.fillText('참고 지도',20,145);return c.toDataURL('image/png');})()`);
  await writeFile(pngPath, Buffer.from(raster.split(',')[1], 'base64'));
  const dom = await browser.send('DOM.getDocument');
  const input = await browser.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: 'input[type="file"]' });
  await browser.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [pngPath] });
  await browser.wait(`document.querySelector('[data-testid="save-status"]').textContent.includes('저장하지 않은 변경')`);
  await save(); current=await state(); check('raster file import persists native image and bytes', current.document.scene.elements.some(el=>el.type==='image') && Object.values(current.document.scene.files).some(file=>file.mimeType==='image/png'));
  const savedScene = current.document.scene;
  await browser.send('Page.reload'); await browser.wait(`performance.getEntriesByType('navigation')[0]?.type === 'reload' && document.querySelector('.excalidraw canvas') && document.querySelector('[data-testid="save-status"]')?.textContent.startsWith('저장됨')`);
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  check('reload hydration does not invent unsaved edits', await browser.evaluate(`document.querySelector('[data-testid="save"]').disabled && !document.querySelector('[data-testid="handoff"]').disabled`));
  check('reload restores scene and image from file', JSON.stringify((await state()).document.scene)===JSON.stringify(savedScene));
  await browser.evaluate(`document.documentElement.dataset.theme='light'`);
  if (await browser.evaluate(`document.querySelector('[data-testid="theme"]').textContent==='밝게'`)) await click('[data-testid="theme"]');
  await browser.screenshot(join(logs,'light.png'));
  await click('[data-testid="theme"]'); await browser.screenshot(join(logs,'dark.png'));
  check('theme switches host and Excalidraw together', await browser.evaluate(`document.documentElement.dataset.theme==='dark' && document.querySelector('.excalidraw.theme--dark')!==null`));
  // Deselect, then hand off the whole saved sketch. PNG is generated by the actual editor.
  await pointer(1060, 750); await key('Escape', 27); await click('[data-testid="handoff"]'); await settle();
  current=await state(); check('real editor handoff creates result paths', current.handoffs.length===1);
  const folder=dirname(current.handoffs[0].jsonPath);
  const handed=JSON.parse(await readFile(join(folder,'result.json'),'utf8'));
  check('actual PNG export is present with image and rules snapshot', (await readFile(join(folder,'preview.png'))).subarray(1,4).toString()==='PNG' && handed.document.scene.elements.some(el=>el.type==='image') && handed.rules.content.includes('スケ')===false && handed.rules.content.includes('스케치'));
  await button('닫기');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  check('narrow editor keeps a usable canvas height', await browser.evaluate(`document.querySelector('.excalidraw').getBoundingClientRect().height >= 300 && document.querySelector('.excalidraw canvas').getBoundingClientRect().height >= 300`));
  check('narrow editor exposes every drawing toolbar control inside canvas', await browser.evaluate(`(() => {
    const canvas=document.querySelector('.excalidraw').getBoundingClientRect();
    const controls=[...document.querySelectorAll('.excalidraw .App-toolbar button,.excalidraw .App-toolbar label')].filter(el=>el.getBoundingClientRect().width>0);
    return controls.length>=10 && controls.every(el=>{const r=el.getBoundingClientRect();return r.left>=canvas.left-1 && r.right<=canvas.right+1 && r.top>=canvas.top && r.bottom<=canvas.bottom && el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
  })()`));
  const extraTool=await browser.evaluate(`(() => {const r=document.querySelector('.excalidraw .App-toolbar__extra-tools-trigger').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await pointer(extraTool.x,extraTool.y);
  await browser.wait(`document.querySelector('.App-toolbar__extra-tools-dropdown [data-testid="toolbar-frame"]')`);
  check('narrow editor extra tools can be opened by pointer', await browser.evaluate(`(() => {const el=document.querySelector('.App-toolbar__extra-tools-dropdown [data-testid="toolbar-frame"]');const r=el.getBoundingClientRect();return r.width>0 && r.left>=0 && r.right<=innerWidth;})()`));
  await key('Escape',27);
  await browser.screenshot(join(logs,'narrow-dark.png'));
  check('narrow screen avoids horizontal document overflow', await browser.evaluate('document.documentElement.scrollWidth <= 391'));
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  // Simulate another tab saving, then keep the original editor draft on conflict.
  const token=(await (await fetch(app.origin+'/api/session')).json()).token;
  const external=structuredClone(current.document); external.title='다른 화면의 저장';
  const changed=await fetch(app.origin+'/api/save',{method:'POST',headers:{'Content-Type':'application/json','X-Board-Token':token,'X-Board-Storage':encodeURIComponent(current.storage.root)},body:JSON.stringify({document:external,expectedRevision:current.document.revision})}); assert.equal(changed.status,200);
  await type('[data-testid="title"]','현재 화면의 편집 유지'); await click('[data-testid="save"]'); await settle();
  check('stale save displays conflict and retains editor title', await browser.evaluate(`document.querySelector('[role="alert"]').textContent.includes('변경') && document.querySelector('[data-testid="title"]').value==='현재 화면의 편집 유지'`));
  await browser.screenshot(join(logs,'error.png'));
  await click('[data-testid="settings"]'); browser.setDialogDecision(false); await button('최신 내용 불러오기'); await settle();
  check('cancel discard keeps unsaved editor draft', await browser.evaluate(`document.querySelector('[data-testid="title"]').value==='현재 화면의 편집 유지'`));
  browser.setDialogDecision(true); await button('최신 내용 불러오기'); await settle();
  check('confirmed reload accepts saved revision', await browser.evaluate(`document.querySelector('[data-testid="title"]').value==='다른 화면의 저장'`));
  await button('현재 저장본 백업'); await settle(); current=await state(); const revision=current.document.revision;
  await button('복원'); await settle(); check('confirmed backup restore increments revision', (await state()).document.revision===revision+1);
  await type('[data-testid="root"]',join(fixture,'새 보드 위치-' + run)); await button('위치 변경'); await settle();
  check('Korean path switch opens fresh board and preserves original', (await state()).document.revision===0 && JSON.parse(await readFile(join(dataRoot,'document.json'),'utf8')).scene.elements.length>0);
  await browser.send('HeapProfiler.collectGarbage');
  const metrics=(await browser.send('Performance.getMetrics')).metrics; summary.jsHeapUsedBytesAfterGC=metrics.find(m=>m.name==='JSHeapUsedSize')?.value;
  summary.dom=await browser.send('Memory.getDOMCounters');
  summary.externalRequests = [...requests.values()].filter(item=>/^https?:/.test(item.url) && !item.url.startsWith(app.origin+'/'));
  summary.externalResponses = summary.externalRequests.filter(item=>item.response).length;
  summary.blockedFontFallbacks = summary.externalRequests.filter(item=>item.failure?.blockedReason === 'csp').length;
  check('all remote font alternatives are blocked by CSP before receiving data', summary.externalResponses===0 && summary.externalRequests.every(item=>item.url.startsWith('https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/fonts/') && item.failure?.blockedReason==='csp'));
  check('no uncaught exception or console error', browser.errors.length===0);
  summary.passed=true;
} catch (error) { summary.passed=false; summary.error=error.stack; summary.browserErrors=browser.errors; await browser.screenshot(join(logs,'failure.png')).catch(()=>{}); throw error; }
finally { summary.browserExit=await browser.close(); await app.close(); summary.endedAt=new Date().toISOString(); await writeFile(join(logs,'render-summary.json'),JSON.stringify(summary,null,2)); console.log(JSON.stringify({passed:summary.passed,checks:summary.checks.length,firstReadyMs:summary.firstReadyMs,jsHeapUsedBytes:summary.jsHeapUsedBytes,browserExit:summary.browserExit},null,2)); }

import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createBoardServer } from '../server.mjs';
import { openBrowser } from './browser-driver.mjs';
if(!process.env.DESIGN_RUN_ROOT)throw Error('Use design-verify.mjs ui to isolate and register browser state.');
const run=resolve(process.env.DESIGN_RUN_ROOT),temporary=join(run,'temporary'),reports=join(run,'reports');
const summary={scope:'Windows x64 Chrome, static HTML/CSS modules and common file storage',startedAt:new Date().toISOString(),checks:[]};
const app=await createBoardServer({board:'design',dataRoot:join(temporary,'자료'),configPath:join(temporary,'settings.json')});
const state=async()=>(await fetch(app.origin+'/api/state')).json();
const post=async(action,body)=>fetch(app.origin+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Board-Token':app.token,'X-Board-Storage':encodeURIComponent((await state()).storage.root)},body:JSON.stringify(body)});
const check=(name,condition)=>{assert.ok(condition,name);summary.checks.push(name);};
let browser;
try{
  browser=await openBrowser(join(temporary,'chrome-profile'));const evaluate=browser.evaluate;
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
  const pointer=async selector=>{const p=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await browser.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});};
  const field=async(selector,value)=>{await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select();})()`);await browser.send('Input.insertText',{text:value});};
  const select=async(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const saved=async()=>{await click('#save');await browser.wait(`document.querySelector('#save-status').textContent.startsWith('저장됨')`);};
  const frameSessions=new Map();
  const frameOnce=async expression=>{
    const root=(await browser.send('DOM.getDocument',{depth:0})).root;
    const {nodeId}=await browser.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.dp-iframe'});
    const {node}=await browser.send('DOM.describeNode',{nodeId});
    const tree=await browser.send('Page.getFrameTree');let frame=tree.frameTree.childFrames?.find(child=>child.frame.id===node.frameId)?.frame,session;
    // Chrome site isolation can place the opaque srcdoc in its own target.
    if(!frame){const targets=await browser.send('Target.getTargets',{},null);const target=targets.targetInfos.find(info=>info.type==='iframe'&&info.targetId===node.frameId);assert.ok(target,'device srcdoc frame exists');session=frameSessions.get(target.targetId);if(!session){session=(await browser.send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;frameSessions.set(target.targetId,session);await browser.send('Page.enable',{},session);}frame=(await browser.send('Page.getFrameTree',{},session)).frameTree.frame;}
    const {executionContextId}=await browser.send('Page.createIsolatedWorld',{frameId:frame.id,worldName:'board-verification'},session);
    const result=await browser.send('Runtime.evaluate',{expression,contextId:executionContextId,returnByValue:true,awaitPromise:true},session);
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;
  };
  const inFrame=async expression=>{let last;for(let attempt=0;attempt<50;attempt++){try{return await frameOnce(expression);}catch(error){last=error;await new Promise(done=>setTimeout(done,20));}}throw last;};
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1540,height:1050,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.navigate',{url:app.origin});await browser.wait(`document.querySelector('.dp-iframe')?.srcdoc.includes('작은 시작')`);
  // Frame load and layout are actual browser state, independent of source presence.
  for(let i=0;i<50;i++){try{if(await inFrame(`!!document.querySelector('.card')`))break;}catch{}await new Promise(done=>setTimeout(done,40));}
  check('two modules compose with three synthetic designs',await evaluate(`document.querySelectorAll('[data-design]').length===3 && document.querySelector('#storage-path').textContent.includes('자료')`));
  check('desktop CSS viewport remains 1280 despite fit scale',await inFrame('innerWidth')===1280);
  check('content actually renders and desktop typography applies',await inFrame(`getComputedStyle(document.querySelector('h1')).fontSize==='28px'`));
  check('iframe sandbox uses opaque origin with no script permission',await evaluate(`document.querySelector('.dp-iframe').getAttribute('sandbox')===''`)&&await inFrame(`(()=>{try{return !!parent.document}catch{return false}})()` )===false);
  await browser.screenshot(join(reports,'light.png'));
  await select('[data-setting=deviceId]','mobile');await browser.wait(`document.querySelector('.dp-frame').style.width==='390px'`);
  check('mobile preset changes real iframe viewport and media query',await inFrame(`innerWidth===390 && getComputedStyle(document.querySelector('h1')).fontSize==='24px'`));
  await select('[data-setting=zoom]','100');check('100 percent changes visual scale without changing viewport',await evaluate(`document.querySelector('.dp-frame').style.transform==='scale(1)'`)&&await inFrame('innerWidth')===390);
  await select('[data-setting=zoom]','50');check('50 percent keeps iframe media query width',await evaluate(`document.querySelector('.dp-frame').style.transform==='scale(0.5)'`)&&await inFrame('innerWidth')===390);
  await select('[data-setting=zoom]','fit');
  await pointer('[data-setting=showSafeArea]');check('safe-area overlay and CSS variables use explicit preset values',await evaluate(`!document.querySelector('.dp-safe-area').hidden && document.querySelector('.dp-safe-area').style.top==='44px'`)&&await inFrame(`getComputedStyle(document.documentElement).getPropertyValue('--preview-safe-top').trim()==='44px'`));
  await select('[data-setting=stateId]','loading');
  for(let i=0;i<50;i++){if(await inFrame(`document.body.dataset.previewState==='loading'`))break;await new Promise(done=>setTimeout(done,20));}
  check('state controls change actual content CSS',await inFrame(`getComputedStyle(document.querySelector('.loading')).display==='block' && getComputedStyle(document.querySelector('.normal')).display==='none'`));
  await field('#editor [name=title]','검토 카드 한글');await field('#editor [name=note]','둥근 모서리와 모바일 여백 검토');
  check('input immediately updates controlled document without losing focus',await evaluate(`document.activeElement.name==='note' && document.querySelector('[data-design=quiet]').textContent.includes('검토 카드 한글') && document.querySelector('#save-status').textContent.includes('변경')`));
  await field('#editor [name=title]','');check('invalid raw title stays visible and blocks save',await evaluate(`document.querySelector('#editor [name=title]').value==='' && document.querySelector('#save').disabled && document.querySelector('#edit-error').textContent.length>0`));
  await click('[data-design=contrast]');await click('[data-design=quiet]');check('selection preserves invalid raw editor values',await evaluate(`document.querySelector('#editor [name=title]').value==='' && document.querySelector('#save').disabled`));
  await field('#editor [name=title]','검토 카드 한글');await saved();
  check('manual save persists Korean copy and controlled settings',(await state()).document.items[0].title==='검토 카드 한글'&&(await state()).document.settings.stateId==='loading');
  await click('#presets');await field('#device-form [name=name]','나의 테스트 기기');await field('#device-form [name=width]','430');await field('#device-form [name=height]','932');await click('#copy-device');
  check('custom device can be added through visible fields',await evaluate(`document.querySelector('[data-setting=deviceId] option:checked').textContent==='나의 테스트 기기' && document.querySelector('.dp-frame').style.width==='430px'`));
  await click('#presets');await evaluate(`document.querySelector('.preset-source').open=true`);
  let config=JSON.parse(await evaluate(`document.querySelector('#preset-json').value`));config.states.push({id:'review',name:'검토 중'});config.backgrounds.push({id:'paper',name:'종이 배경',color:'#e9e3d0'});config.sample={width:240,height:180};
  await field('#preset-json',JSON.stringify(config));await click('#apply-presets');await select('[data-setting=stateId]','review');
  check('custom state and comparison backgrounds are controlled data',await evaluate(`document.querySelector('[data-setting=stateId] option:checked').textContent==='검토 중'`));
  await click('#presets');await evaluate(`document.querySelector('.preset-source').open=true`);await field('#preset-json','{bad');await click('#apply-presets');
  check('invalid preset JSON stays editable and does not replace document',await evaluate(`document.querySelector('#dialog-error').textContent.length>0 && document.querySelector('#preset-json').value==='{bad'`));await click('[data-close]');
  await click('[data-view=gallery]');await browser.wait(`document.querySelectorAll('.dg-card').length===3`);
  check('comparison renders representative and custom background samples',await evaluate(`document.querySelectorAll('.dg-card .dg-preview').length===3 && document.querySelectorAll('.dg-sample').length===12 && [...document.querySelectorAll('.dg-sample-label')].some(el=>el.textContent.includes('종이 배경'))`));
  check('actual-size gallery sample uses CSS px without scale',await evaluate(`document.querySelector('.dg-swatch-scroll iframe').style.width==='240px' && document.querySelector('.dg-swatch-scroll iframe').style.transform===''`));
  await pointer('.dg-card[data-item=contrast] button');check('gallery callback selects same editor document',await evaluate(`document.querySelector('.dg-card[data-item=contrast] button').getAttribute('aria-pressed')==='true' && document.querySelector('#editor [name=title]').value==='B · 선명한 대비'`));
  await browser.screenshot(join(reports,'comparison-light.png'));await click('#theme');await browser.screenshot(join(reports,'comparison-dark.png'));
  await click('[data-view=device]');await click('#duplicate');check('duplicate creates independently editable alternative',await evaluate(`document.querySelectorAll('[data-design]').length===4 && document.querySelector('#editor [name=title]').value.endsWith('복사')`));
  await click('#delete-design');check('delete can be undone without losing alternative',await evaluate(`document.querySelectorAll('[data-design]').length===3`));await click('#undo');check('undo restores deleted alternative',await evaluate(`document.querySelectorAll('[data-design]').length===4`));await click('#redo');check('redo reapplies delete',await evaluate(`document.querySelectorAll('[data-design]').length===3`));
  await click('[data-design=quiet]');await evaluate(`document.querySelector('.source-editor').open=true`);
  const customHTML=`<main class="custom"><h1>사용자 HTML</h1><p class="state">검토 상태</p><svg width="24" height="24"><circle cx="12" cy="12" r="10" fill="#6960a0"/></svg></main>`;
  const customCSS=`body{font-family:system-ui;color:#222}.custom{padding:var(--preview-safe-top) 16px}.state{display:none}[data-preview-state="review"] .state{display:block}@media(max-width:450px){h1{font-size:19px}}`;
  await field('#editor [name=html]',customHTML);await field('#editor [name=css]',customCSS);
  for(let i=0;i<50;i++){if(await inFrame(`document.body.textContent.includes('사용자 HTML')`))break;await new Promise(done=>setTimeout(done,20));}
  check('custom HTML CSS state and inline SVG render in real iframe',await inFrame(`!!document.querySelector('svg circle') && getComputedStyle(document.querySelector('h1')).fontSize==='19px' && getComputedStyle(document.querySelector('.state')).display==='block'`));
  const malicious=`<h1>격리 시험</h1><script>parent.document.body.dataset.escaped='yes'</script><img src="https://example.invalid/remote.png" onerror="parent.alert(1)"><iframe src="/api/state"></iframe><a href="https://example.invalid">이동</a><form action="https://example.invalid"><label>디자인 입력<input placeholder="입력해 보세요"></label></form>`;
  await field('#editor [name=html]',malicious);
  for(let i=0;i<50;i++){if(await inFrame(`document.body.textContent.includes('격리 시험')`))break;await new Promise(done=>setTimeout(done,20));}
  check('active markup and external URLs are removed before isolated render',await inFrame(`!document.querySelector('script,iframe,[onerror],[href],[src],[action]')`)&&await evaluate(`!document.body.dataset.escaped`));
  check('generic form controls remain visible as static design',await inFrame(`!!document.querySelector('form input[placeholder="입력해 보세요"]')`));
  await field('#editor [name=html]',customHTML);await saved();await click('#reload');await browser.wait(`document.querySelector('#editor [name=html]')?.value.includes('사용자 HTML')`);
  check('custom source presets and selected settings reopen from disk',await evaluate(`document.querySelector('[data-setting=deviceId] option:checked').textContent==='나의 테스트 기기' && document.querySelector('[data-setting=stateId]').value==='review'`));
  const beforeBackup=(await state()).document.items[0].note;await field('#editor [name=note]','백업 중에도 보존할 편집본');await click('#settings');await click('#backup');await browser.wait(`document.querySelector('#notice-text').textContent.includes('백업했습니다')`);
  check('manual backup preserves unsaved editor instead of adopting saved document',await evaluate(`document.querySelector('#editor [name=note]').value==='백업 중에도 보존할 편집본' && document.querySelector('#save-status').textContent.includes('변경')`)&&(await state()).document.items[0].note===beforeBackup);
  await click('#reload');await browser.wait(`document.querySelector('#editor [name=note]').value!== '백업 중에도 보존할 편집본'`);
  await click('#settings');await click('[data-restore]');await browser.wait(`document.querySelector('#notice-text').textContent.includes('복원했습니다')`);check('visible backup restore succeeds under a new revision',(await state()).document.revision>=3);
  // Reapply an explicitly useful state after testing historical restore.
  await select('[data-setting=deviceId]','mobile');await select('[data-setting=stateId]','normal');await saved();
  await click('#handoff');await browser.wait(`document.querySelector('#handoff-path')?.textContent.includes('result.md')`);const handoffPath=await evaluate(`document.querySelector('#handoff-path').textContent`);check('handoff UI gives readable immutable result path',(await readFile(handoffPath,'utf8')).includes('디자인 보드 전달 결과'));await click('[data-close]');
  await mkdir(join(temporary,'downloads'),{recursive:true});await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:join(temporary,'downloads')},null);await click('#download');
  for(let i=0;i<100;i++){if((await readdir(join(temporary,'downloads'))).some(name=>name.endsWith('.html')))break;await new Promise(done=>setTimeout(done,20));}
  const downloads=(await readdir(join(temporary,'downloads'))).filter(name=>name.endsWith('.html'));check('HTML export uses actual browser download and static CSP',downloads.length===1&&(await readFile(join(temporary,'downloads',downloads[0]),'utf8')).includes("script-src 'none'"));
  await field('#editor [name=note]','충돌해도 남아야 하는 편집');const current=(await state()).document;current.items[0].note='외부 저장';assert.equal((await post('save',{document:current,expectedRevision:current.revision})).status,200);await click('#save');await browser.wait(`document.querySelector('#notice-text').textContent.includes('다른 화면')`);
  check('stale save shows request id and preserves draft',await evaluate(`document.querySelector('#editor [name=note]').value==='충돌해도 남아야 하는 편집' && /\([a-f0-9-]{36}\)/.test(document.querySelector('#notice-text').textContent)`));
  browser.setDialogDecision(false);await click('#reload');check('cancelled reload preserves local edits',await evaluate(`document.querySelector('#editor [name=note]').value==='충돌해도 남아야 하는 편집'`));browser.setDialogDecision(true);await click('#reload');await browser.wait(`document.querySelector('#editor [name=note]').value==='외부 저장'`);
  await click('#settings');await field('#data-root',join(temporary,'wrong-file'));await writeFile(join(temporary,'wrong-file'),'not a directory');await click('#change-root');await browser.wait(`document.querySelector('#notice-text').textContent.includes('파일 작업')`);check('storage error retains selected document and old location',await evaluate(`document.querySelector('#editor [name=note]').value==='외부 저장' && document.querySelector('#storage-path').textContent.endsWith('자료')`));
  await browser.screenshot(join(reports,'error-dark.png'));
  await click('#dismiss');await browser.screenshot(join(reports,'dark.png'));
  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await browser.wait(`document.querySelector('.dp-viewport').clientWidth<390`);
  check('narrow host fits without outer horizontal overflow',await evaluate(`document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('.dp-frame').getBoundingClientRect().width<=document.querySelector('.dp-viewport').clientWidth`));await browser.screenshot(join(reports,'narrow-dark.png'));
  await pointer('[data-view=gallery]');check('narrow comparison remains selectable and scrolls internally',await evaluate(`!document.querySelector('#gallery-pane').hidden && document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('.dg-swatch-scroll').scrollWidth>=document.querySelector('.dg-swatch-scroll').clientWidth`));await browser.screenshot(join(reports,'comparison-narrow-dark.png'));
  check('no uncaught browser exceptions',browser.errors.length===0);
  summary.passed=true;console.log('Passed '+summary.checks.length+' browser checks');
}catch(error){summary.error=error.stack;await browser?.screenshot(join(reports,'failure.png')).catch(()=>{});throw error;}
finally{if(browser)summary.chrome=await browser.close();await new Promise(done=>app.server.close(done));summary.serverClosed=true;summary.endedAt=new Date().toISOString();await writeFile(join(reports,'render-summary.json'),JSON.stringify(summary,null,2));}

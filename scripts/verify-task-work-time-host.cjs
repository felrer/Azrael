"use strict";
// Native Windows host acceptance. All mutable state and instrumentation are fixture owned.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),task=path.join(root,'artifacts/verification/task-group-20261013'),mode=process.argv[2]||'baseline',runId=process.argv.find(x=>x.startsWith('--fixture-id='))?.slice(13)||'run-'+Date.now(),run=mode+'-'+runId,fixture=path.join(task,'vscode-'+run),extension=path.join(fixture,'host/extension'),logs=path.join(root,'artifacts/logs/task-group-20261013/host',run);
assert.match(runId,/^[a-z0-9-]*$/);
assert.ok(['baseline','patched'].includes(mode));fs.mkdirSync(logs,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function prepare(){
 assert.ok(!fs.existsSync(fixture),'Refuse to overwrite a previous fixture');
 fs.mkdirSync(fixture,{recursive:true});
 const receipt={createdAt:new Date().toISOString(),mode,fixture,inputs:[],assets:[]};
 const vsix=path.join(root,'artifacts/w13b/artifacts/deployments/deploy-w13e/package/azrael-host.vsix');
 receipt.inputs.push({path:vsix,sha256:sha(vsix),provenance:'accepted existing host VSIX'});
 const unpack=spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:TASK_GROUP_VSIX,$env:TASK_GROUP_HOST)"],{env:{...process.env,TASK_GROUP_VSIX:vsix,TASK_GROUP_HOST:path.join(fixture,'host')},windowsHide:true,encoding:'utf8'});
 fs.writeFileSync(path.join(logs,'prepare.log'),(unpack.stdout||'')+(unpack.stderr||''));assert.equal(unpack.status,0,'VSIX extraction failed');
 const native=fs.existsSync(path.join(task,'native-state'))?path.join(task,'native-state'):path.join(task,'vscode-baseline/state'),state=path.join(fixture,'state');assert.ok(fs.existsSync(native),'An own recorded seed state is required');fs.mkdirSync(state,{recursive:true});
 for(const name of fs.readdirSync(native))if(name==='sessions'||name==='config.toml'||/^((state_5|thread_history_1|queue_1|goals_1)\.sqlite)(-wal|-shm)?$/.test(name))fs.cpSync(path.join(native,name),path.join(state,name),{recursive:true});
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(state,'state_5.sqlite'));
 for(const row of db.prepare('SELECT id,rollout_path FROM threads').all()){assert.ok(row.rollout_path.startsWith(native+path.sep),'Only own native fixture history may be copied');db.prepare('UPDATE threads SET rollout_path=? WHERE id=?').run(state+row.rollout_path.slice(native.length),row.id)}db.close();
 const runtimePath=path.join(extension,'out/azrael-runtime.json'),runtime=JSON.parse(fs.readFileSync(runtimePath));runtime.codexHome=state;fs.writeFileSync(runtimePath,JSON.stringify(runtime,null,2));
 if(mode==='patched'){
  const frozen=path.join(fixture,'transform-inputs');fs.mkdirSync(frozen);for(const name of fs.readdirSync(path.join(root,'scripts')).filter(x=>x.endsWith('.cjs'))){const source=path.join(root,'scripts',name),dest=path.join(frozen,name);fs.copyFileSync(source,dest);receipt.inputs.push({path:source,sha256:sha(dest)})}
  const policySource=path.join(root,'extensions/azrael-ex/media/content-font-policy.cjs'),policyDest=path.join(fixture,'extensions/azrael-ex/media/content-font-policy.cjs');fs.mkdirSync(path.dirname(policyDest),{recursive:true});fs.copyFileSync(policySource,policyDest);receipt.inputs.push({path:policySource,sha256:sha(policyDest)});
  const fontsSource=path.join(root,'extensions/azrael-ex/media/fonts'),fontsDest=path.join(fixture,'extensions/azrael-ex/media/fonts');fs.cpSync(fontsSource,fontsDest,{recursive:true});for(const name of fs.readdirSync(fontsDest))if(fs.statSync(path.join(fontsDest,name)).isFile())receipt.inputs.push({path:path.join(fontsSource,name),sha256:sha(path.join(fontsDest,name))});
  const tsPath=require.resolve('typescript',{paths:[path.join(root,'extensions/azrael-ex')]});const ts=require(tsPath),pipeline=require(path.join(frozen,'namespace-azrael-host.cjs'));
  receipt.inputs.push({path:tsPath,sha256:sha(tsPath)});
  for(const relative of ['webview/assets/app-initial-97d3534ad35f.js','webview/assets/local-conversation-thread-2429c4b61076.js','webview/assets/virtualized-turn-list-c0fd56eabf08.js']){
   const source=path.join(root,'artifacts/upstream-ui/26.1007.21434',relative),snapshot=path.join(fixture,'pristine',relative);fs.mkdirSync(path.dirname(snapshot),{recursive:true});fs.copyFileSync(source,snapshot);const hash=sha(snapshot),transformed=pipeline.transformAsset(fs.readFileSync(snapshot,'utf8'),relative,snapshot,ts);assert.equal(sha(snapshot),hash);if(relative.includes('virtualized-turn-list'))assert.ok(transformed.text.includes('/*azrael-task-time-row-measure-v1*/'),'Namespace dispatcher must apply native RAF row observer');const dest=path.join(extension,relative);fs.writeFileSync(dest,transformed.text);receipt.assets.push({path:relative,inputSha256:hash,outputSha256:sha(dest)});
  }
 }
 fs.writeFileSync(path.join(logs,'input-receipt.json'),JSON.stringify(receipt,null,2));return receipt;
}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
async function connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map(),contexts=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.executionContextCreated')contexts.push(m.params.context);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});await send('Runtime.enable');return {ws,send,contexts,async eval(expression,contextId){const r=await send('Runtime.evaluate',{expression,contextId,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value},close(){ws.close();for(const p of pending.values())clearTimeout(p.timer)}}}
async function targets(p){try{return await(await fetch('http://127.0.0.1:'+p+'/json/list',{signal:AbortSignal.timeout(1500)})).json()}catch{return []}}
function seedSyntheticChain(){
 // Historical events authored from protocol serde declarations and store replay fixtures.
 // This is not evidence that a live automatic reservation was executed.
 const state=path.join(fixture,'state'),{DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(state,'state_5.sqlite'));
 const origin=db.prepare('SELECT * FROM threads WHERE id=?').get('01a133c0-bd56-7112-aafc-b0f529be0089');assert.ok(origin);
 const id='01900000-0000-7000-8000-000000000003',turns=Array.from({length:4},(_,i)=>'01900000-0000-7000-8000-'+String(100+i).padStart(12,'0'));
 const original=fs.readFileSync(origin.rollout_path,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x));
 const meta=structuredClone(original.find(x=>x.type==='session_meta').payload);meta.id=id;meta.session_id=id;meta.base_instructions={text:'Synthetic historical replay for native task grouping; no model requests.'};
 const context=original.find(x=>x.type==='turn_context')?.payload,started=original.find(x=>x.type==='event_msg'&&x.payload.type==='task_started').payload;
 const rows=[],epoch=1791869700;let ordinal=0;const push=(type,payload,seconds)=>rows.push({timestamp:new Date(seconds*1000).toISOString(),ordinal:ordinal++,type,payload});push('session_meta',meta,epoch);
 for(let i=0;i<4;i++){
  const start=epoch+i*10,turn=turns[i];push('event_msg',{...started,turn_id:turn,root_turn_id:turns[0],started_at:start,turn_attribution:{turn_id:turn,root_turn_id:turns[0],parent_turn_id:i?turns[i-1]:null,turn_trigger:i?'root_resume':'user',initiating_agent_path:null}},start);
  if(context)push('turn_context',{...context,turn_id:turn,root_turn_id:turns[0]},start);
  push('response_item',{type:'message',id:null,role:i?'assistant':'user',content:[{type:i?'output_text':'input_text',text:`Synthetic historical ${i?'automatic continuation':'user request'} ${i+1}. `+'Native recorded history geometry fixture. '.repeat(110)}]},start+1);
  if(i<3){const wait={reservationId:'synthetic-reservation-'+i,revision:1,waitStartedAtMs:(start+2)*1000,waitEndedAtMs:null,resumeAtMs:(start+10)*1000,state:'waiting',canWakeEarly:false};push('event_msg',{type:'turn_deferred',turn_id:turn,root_turn_id:turns[0],reservation_id:wait.reservationId,wait,started_at:start,deferred_at:start+2,duration_ms:2000},start+2);push('event_msg',{type:'root_resume_wait_updated',turn_id:turn,wait:{...wait,revision:2,state:'resumed',waitEndedAtMs:(start+10)*1000}},start+10)}
  else push('event_msg',{type:'task_complete',turn_id:turn,root_turn_id:turns[0],started_at:start,completed_at:start+2,duration_ms:2000,last_agent_message:'Synthetic chain completed'},start+2);
 }
 const rollout=path.join(state,'sessions/2026/10/13','rollout-2026-10-13T14-35-00-'+id+'.jsonl');fs.writeFileSync(rollout,rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
 if(!db.prepare('SELECT id FROM threads WHERE id=?').get(id)){const row={...origin,id,rollout_path:rollout,title:'Synthetic historical three-resume task group',first_user_message:'Synthetic native grouping fixture',preview:'Synthetic native grouping fixture'};const columns=Object.keys(row);db.prepare('INSERT INTO threads ('+columns.map(c=>'"'+c+'"').join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').run(...columns.map(c=>row[c]))}db.close();fs.writeFileSync(path.join(logs,'synthetic-chain.json'),JSON.stringify({threadId:id,turnIds:turns,rollout,sha256:sha(rollout),provenance:'Authored historical replay from protocol serde definitions; not live reservation execution'},null,2));return id;
}
async function assertNativeView(r,contextId,summary,label,expectedEligible){
 const evaluate=expression=>r.eval(expression,contextId);
 const wait=async(expression,name)=>{for(let i=0;i<100;i++){if(await evaluate(expression)){summary.checks.push(label+': '+name);return}await sleep(200)}throw Error(label+': timed out '+name)};
 await wait("document.querySelectorAll('[data-turn-key]').length>0",'native virtualized turn rows mounted');
 await wait(expectedEligible?"document.querySelectorAll('[data-azrael-task-work-time]').length===1":"document.querySelectorAll('[data-azrael-task-work-time]').length===0",expectedEligible?'three reservations expose one inline task group':'one turn has no task group');
 if(expectedEligible){
  await wait("document.querySelector('[data-azrael-task-work-time] details summary')?.innerText.match(/(?:4.*턴|4 turns)/)",'native three-resume chain has four turns');
  await evaluate("document.querySelector('[data-azrael-task-work-time] details').open=true");
  await wait("document.querySelectorAll('[data-azrael-time-turn]').length===4",'expanded native group has four turn time rows');
  await evaluate("document.querySelector('[data-azrael-task-work-time] details').open=false");
 }
 const geometry=await evaluate(`(async()=>{const row=document.querySelector('[data-turn-key]');let scroll=row;while(scroll&&!(scroll.scrollHeight>scroll.clientHeight+4&&/auto|scroll/.test(getComputedStyle(scroll).overflowY)))scroll=scroll.parentElement;if(!scroll)return {scrollable:false};const max=()=>scroll.scrollHeight-scroll.clientHeight;for(let i=0;i<20;i++){scroll.scrollTop=i%2?max():0;await new Promise(requestAnimationFrame)}scroll.scrollTop=0;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const rows=[...document.querySelectorAll('[data-turn-key]')].map(e=>{let r=e.getBoundingClientRect();return {key:e.dataset.turnKey,top:r.top,bottom:r.bottom,height:r.height}});return {scrollable:true,scrollTop:scroll.scrollTop,scrollHeight:scroll.scrollHeight,viewport:scroll.clientHeight,rows,finite:rows.every(r=>[r.top,r.bottom,r.height].every(Number.isFinite)),overlaps:rows.some((r,i)=>i&&r.top<rows[i-1].bottom-2)}})()`);
 summary.geometry??={};summary.geometry[label]=geometry;
 if(geometry.scrollable){assert.equal(geometry.finite,true);assert.equal(geometry.overlaps,false,'native rows must not overlap after fast scrolling');assert.ok(geometry.scrollTop<=1,'native list returns to top');summary.checks.push(label+': native list geometry valid after20 rapid top/bottom scrolls')}else summary.limitations.push(label+': fixture content does not overflow viewport; fast scrolling not exercised');
}
(async()=>{
 const phase=process.argv.includes('--prepare-only')?'prepare':process.argv.includes('--seed-chain-only')?'seed':'launch',attemptId=Date.now();
 const summary={mode,runId,phase,attemptId,platform:'Windows x64 native VS Code isolated profile',fixture,fixtureHistory:'Own native interrupted turn recorded against local-only unreachable provider; no real credentials',checks:[],limitations:[]};let host,renderers=[],child,output='';
 try{
  if(!fs.existsSync(extension))prepare();
  if(process.argv.includes('--prepare-only')){summary.outcome='prepared';summary.checks.push('Fresh accepted VSIX extracted; own native history paths relocated; patched assets transformed from frozen pristine inputs when requested');return}
  if(process.argv.includes('--seed-chain-only')){summary.syntheticChain=seedSyntheticChain();summary.outcome='seeded';return}
  assert.ok(!fs.existsSync(path.join(logs,'launch-receipt.json')),'Every native host launch requires a fresh fixture ID');fs.writeFileSync(path.join(logs,'launch-receipt.json'),JSON.stringify({attemptId,runId,startedAt:new Date().toISOString(),fixture}));
  assert.ok(fs.existsSync(extension));const entry=path.join(extension,'out/extension.js');let src=fs.readFileSync(entry,'utf8');const needle='let tt=new hB(Pe,wt);';if(!src.includes('globalThis.__azraelTaskGroupUri=')){assert.equal(src.split(needle).length-1,1);src=src.replace(needle,'let tt=globalThis.__azraelTaskGroupUri=new hB(Pe,wt);globalThis.__azraelTaskGroupVscode=Mt;');fs.writeFileSync(entry,src)}
  const state=path.join(fixture,'state');assert.ok(fs.existsSync(path.join(state,'config.toml')),'Prepared isolated offline state required');
  const runtimePath=path.join(extension,'out/azrael-runtime.json'),runtime=JSON.parse(fs.readFileSync(runtimePath)),override=process.argv.find(x=>x.startsWith('--engine='))?.slice(9);if(override){const binary=path.resolve(override);assert.ok(binary.startsWith(root+path.sep)&&fs.existsSync(binary),'Verification engine must be an existing workspace-owned binary');runtime.engine=binary}runtime.codexHome=state;fs.writeFileSync(runtimePath,JSON.stringify(runtime,null,2));summary.engine={path:runtime.engine,sha256:sha(runtime.engine),provenance:override?'verification-only engine override; source provenance requires supplying owner receipt':'existing accepted w13e release'};summary.instrumentedEntrySha256=sha(entry);
  const inspector=await port(),rendererPort=await port(),env={...process.env};for(const k of Object.keys(env))if(/^(AZRAEL_|CODEX_|ELECTRON_RUN_AS_NODE|VSCODE_IPC_HOOK_CLI|VSCODE_CLI|VSCODE_PID)/i.test(k))delete env[k];env.CODEX_HOME=state;
  for(const dir of ['user-data','extensions','workspace'])fs.mkdirSync(path.join(fixture,dir),{recursive:true});
  const codeOverride=process.argv.find(x=>x.startsWith('--code='))?.slice(7),code=codeOverride?path.resolve(codeOverride):path.join(process.env.LOCALAPPDATA,'Programs/Microsoft VS Code/Code.exe');if(codeOverride)assert.ok(code.startsWith(task+path.sep)&&fs.existsSync(code),'Alternate Code must be an existing task-owned executable');summary.code={path:code,sha256:sha(code),provenance:codeOverride?'official version-pinned Windows archive; archive receipt owns version/commit evidence':'installed VS Code'};
  child=spawn(code,['--new-window','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-updates','--user-data-dir='+path.join(fixture,'user-data'),'--extensions-dir='+path.join(fixture,'extensions'),'--extensionDevelopmentPath='+extension,'--inspect-extensions='+inspector,'--remote-debugging-port='+rendererPort,path.join(fixture,'workspace')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',e=>output+=e);
  let ht;for(let i=0;i<120&&!ht;i++){ht=(await targets(inspector)).find(x=>x.webSocketDebuggerUrl);if(child.exitCode!==null)throw Error('VS Code launch exited '+child.exitCode+': '+output.slice(-2500));if(!ht)await sleep(500)}assert.ok(ht,'extension host inspector usable');host=await connect(ht.webSocketDebuggerUrl);summary.checks.push('Actual extension host CDP connected');
  for(let i=0;i<100;i++){if(await host.eval('!!globalThis.__azraelTaskGroupUri'))break;await sleep(300)}assert.ok(await host.eval('!!globalThis.__azraelTaskGroupUri'),'native Azrael activated');summary.checks.push('Native Azrael URI handler captured in own fixture');
  await host.eval("globalThis.__azraelTaskGroupVscode.commands.executeCommand('azrael.openSidebar')");await sleep(2500);
  const id='01a133c0-bd56-7112-aafc-b0f529be0089';await host.eval(`globalThis.__azraelTaskGroupUri.handleUri(globalThis.__azraelTaskGroupVscode.Uri.parse('vscode://azrael-ex-local.azrael/local/${id}'))`);await sleep(4500);
  const rt=await targets(rendererPort);summary.rendererTargets=rt.map(({id,type,url,title})=>({id,type,url,title}));assert.ok(rt.some(x=>x.type==='page'),'renderer CDP page available');
  let view;
  for(const t of rt.filter(x=>x.webSocketDebuggerUrl)){try{const r=await connect(t.webSocketDebuggerUrl);renderers.push(r);for(const c of r.contexts){try{const snap=await r.eval("({url:location.href,title:document.title,text:document.body?.innerText?.slice(0,14000),nativeRows:document.querySelectorAll('[data-turn-key]').length,rules:document.querySelectorAll('[data-azrael-task-rule]').length,groups:document.querySelectorAll('[data-azrael-task-work-time]').length})",c.id);fs.writeFileSync(path.join(logs,'renderer-'+t.id+'-'+c.id+'.json'),JSON.stringify(snap,null,2));if(snap.nativeRows&&/webview/.test(snap.url))view={r,contextId:c.id};}catch{}}const shot=await r.send('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(shot)fs.writeFileSync(path.join(logs,'renderer-'+t.id+'.png'),Buffer.from(shot.data,'base64'))}catch(error){summary.limitations.push(String(error))}}
  summary.checks.push('Renderer CDP snapshots and screenshots recorded');assert.ok(view,'Native Azrael webview execution context with turn rows must be reachable');
  for(const theme of ['Default Light Modern','Default Dark Modern']){
   await host.eval(`globalThis.__azraelTaskGroupVscode.workspace.getConfiguration('workbench').update('colorTheme',${JSON.stringify(theme)},globalThis.__azraelTaskGroupVscode.ConfigurationTarget.Global)`);await sleep(500);
   if(mode==='patched')await assertNativeView(view.r,view.contextId,summary,theme+' one-turn',false);
   else{assert.ok(await view.r.eval("document.querySelectorAll('[data-azrael-task-work-time]').length>0",view.contextId),'Baseline one-turn group must reproduce');summary.checks.push(theme+': baseline incorrectly displays a one-turn task group')}
  }
  const chain=process.argv.find(x=>x.startsWith('--chain-thread='))?.slice(15);
  if(mode==='patched'&&chain){assert.match(chain,/^[0-9a-f-]{36}$/);await host.eval(`globalThis.__azraelTaskGroupUri.handleUri(globalThis.__azraelTaskGroupVscode.Uri.parse('vscode://azrael-ex-local.azrael/local/${chain}'))`);await assertNativeView(view.r,view.contextId,summary,'Synthetic recorded three-resume chain',true)}
  else summary.limitations.push('Native three-reservation chain acceptance needs a recorded fixture thread and engine exposing canonical parent/trigger metadata');
  summary.outcome=mode==='baseline'?'baseline-reproduced':chain?'passed':'partial';
 }catch(error){summary.outcome='failed';summary.error=String(error.stack||error);process.exitCode=1}
 finally{
  if(host){try{await host.eval("globalThis.__azraelTaskGroupVscode.commands.executeCommand('workbench.action.closeWindow')");summary.closeWindow='own inspector target closeWindow sent'}catch(error){summary.closeWindow=String(error)}}for(const r of renderers)r.close();host?.close();await sleep(1000);summary.launchExitCode=child?.exitCode;summary.exitCode=process.exitCode||0;if(phase==='launch')fs.writeFileSync(path.join(logs,'launch-'+attemptId+'.log'),output);fs.writeFileSync(path.join(logs,phase+'-summary-'+attemptId+'.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 }
})().catch(e=>{console.error(e);process.exitCode=1});

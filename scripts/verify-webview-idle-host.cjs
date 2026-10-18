"use strict";
// Actual Windows VS Code lifecycle, with synthetic native state and no inference.
const fs=require("node:fs"),path=require("node:path"),{spawn:nativeSpawn,spawnSync}=require("node:child_process"),net=require("node:net"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const {beginArtifactRun,trackArtifactChild}=require('./artifact-run.cjs');
const artifactRun=beginArtifactRun(root,{workId:'verify-webview-idle-host',owner:'scripts/verify-webview-idle-host.cjs'});
const spawn=(...args)=>trackArtifactChild(artifactRun,nativeSpawn(...args));
const fixture=path.join(artifactRun.temporary,'host'),logs=artifactRun.logs;
const {UI_HELPER}=require("./inject-webview-idle.cjs");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));const port=server.address().port;await new Promise(r=>server.close(r));return port}
const manifest={name:"azrael-idle-fixture",publisher:"azrael-test",version:"0.0.1",engines:{vscode:"^1.96.0"},activationEvents:["*"],main:"./extension.cjs",contributes:{customEditors:[{viewType:"azrael.testIdle",displayName:"Idle fixture",selector:[{filenamePattern:"*.azrael-idle"}],priority:"default"}]}};
const boot=`const vscode=require('vscode');const {createWebviewIdleManager}=require('./webview-idle.cjs');const path=require('path');let panel,lastState,history='initial-history',flags={},released=0,restored=0,ready=0,errors=[];
const savedDraft={prompt:'unsent draft',pullRequestChecks:[]};
function html(snapshot){return '<!doctype html><html><head><meta name="azrael-webview-idle-state" content="'+(snapshot?encodeURIComponent(JSON.stringify(snapshot)):'')+'"></head><body><p>'+history+'</p><div id="scroll" style="height:100px;overflow:auto"><div style="height:2000px">History</div></div><textarea>'+savedDraft.prompt+'</textarea><script>'+${JSON.stringify(`
const api=acquireVsCodeApi(),Dm={dispatchMessage:(type,data)=>api.postMessage({type,...data})};
const nativeConversation={id:'a',resumeState:'resumed',threadRuntimeStatus:{type:'idle'},requests:[]},nativeManager={hasPendingConversationResume:()=>false,requestClient:{getPendingRequestCount:()=>0},turnCoordinator:{readState:()=>({}),readMessages:()=>[]},getConversation:()=>nativeConversation,getCachedConversations:()=>[nativeConversation],getThreadSummaries:()=>[],stateReaders:{getListState:()=>({isConversationInProgress:false,isResponseInProgress:false,latestTurnStatus:'completed'})}};const zNt='zNt',nA='nA';const ZG='ZG',HG='HG',Kf='Kf',QG='QG',uK='uK',OW='OW',DW='DW',iW='iW',lW='lW',SW='SW',xW='xW';const RG={drafts$:'drafts'},g_=v=>v.conversationId,jnt=()=> 'a',PG=x=>x,Dyr=()=>{};
const draft={prompt:'unsent draft',pullRequestChecks:[]};const values={ZG:{fileAttachments:[{path:'fixture.txt'}],responseTextAnnotations:[]},uK:[],OW:[],DW:[],iW:[],SW:null,xW:0};
const scope={value:{kind:'local',conversationId:'a',hostId:'local'},get(a){return a===zNt?{status:'ready'}:a===nA?nativeManager:a==='drafts'?{a:draft}:a===QG?values.ZG:a===Kf?{pathname:'/local/a'}:a===HG?false:values[a]},set(a,v){values[a]=v}};
`+UI_HELPER+`
azraelIdleMount(scope);if(!azraelIdleReadSaved())document.querySelector('#scroll').scrollTop=420;
api.postMessage({type:'ready'});setInterval(()=>api.postMessage({type:'fixture-state',scroll:document.querySelector('#scroll').scrollTop,text:document.querySelector('textarea').value,attachments:values.ZG.fileAttachments,history:document.querySelector('p').textContent}),250);
`)}+'</script></body></html>'}
const manager=createWebviewIdleManager({send:(w,m)=>w.postMessage(m),preferences:async()=>({'azrael-session-flags':flags}),canRelease:async()=>true,hasPendingRequests:()=>false,suspended:()=>released++,content:async(w,s)=>{restored++;return html(s)},error:e=>errors.push(String(e))},globalThis,1500);
exports.activate=()=>{vscode.window.registerCustomEditorProvider('azrael.testIdle',{openCustomDocument:uri=>({uri,dispose(){}}),resolveCustomEditor(doc,p){panel=p;p.webview.options={enableScripts:true};p.webview.onDidReceiveMessage(m=>{if(manager.receive(p.webview,m))return;if(m.type==='ready'){ready++;manager.ready(p.webview)}if(m.type==='fixture-state')lastState=m});p.webview.html=html(null);manager.attach(p,p.webview)}},{webviewOptions:{retainContextWhenHidden:true}});globalThis.__azraelIdleFixture={async open(){await vscode.commands.executeCommand('vscode.openWith',vscode.Uri.file(path.join(__dirname,'a.azrael-idle')),'azrael.testIdle',{preview:false})},hide:()=>vscode.window.showTextDocument(vscode.Uri.file(path.join(__dirname,'scratch.txt')),{preview:false}),show:()=>panel.reveal(vscode.ViewColumn.One),flag:v=>flags={'["local","a"]':v},latest:()=>history='latest-model-result',stats:()=>({released,restored,ready,visible:panel?.visible,suspended:panel&&manager.isSuspended(panel.webview),tabCount:vscode.window.tabGroups.all.flatMap(g=>g.tabs).length,lastState,errors}),theme:id=>vscode.workspace.getConfiguration('workbench').update('colorTheme',id,vscode.ConfigurationTarget.Global),quit:()=>vscode.commands.executeCommand('workbench.action.quit')};};`;
(async()=>{
  fs.mkdirSync(logs,{recursive:true});assert.equal(fs.existsSync(fixture),false,"fixture must be fresh");fs.mkdirSync(path.join(fixture,"extension"),{recursive:true});
  const extension=path.join(fixture,"extension");fs.writeFileSync(path.join(extension,"package.json"),JSON.stringify(manifest));fs.writeFileSync(path.join(extension,"extension.cjs"),boot);fs.copyFileSync(path.join(__dirname,"webview-idle.cjs"),path.join(extension,"webview-idle.cjs"));fs.writeFileSync(path.join(extension,"a.azrael-idle"),"");fs.writeFileSync(path.join(extension,"scratch.txt"),"scratch");
  const port=await freePort(),code=path.join(process.env.LOCALAPPDATA,"Programs/Microsoft VS Code/Code.exe");assert.ok(fs.existsSync(code));
  const env={...process.env};for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|VSCODE_IPC_HOOK_CLI|VSCODE_CLI|VSCODE_PID)$/i.test(key))delete env[key];
  const child=spawn(code,["--new-window","--disable-extensions","--skip-welcome","--skip-release-notes","--disable-workspace-trust","--disable-updates","--user-data-dir="+path.join(fixture,"profile"),"--shared-data-dir="+path.join(fixture,"shared-data"),"--extensions-dir="+path.join(fixture,"extensions"),"--extensionDevelopmentPath="+extension,"--inspect-extensions="+port,extension],{windowsHide:true,env,stdio:["ignore","pipe","pipe"]});
  let launchOutput="";child.stdout.on("data",b=>launchOutput+=b);child.stderr.on("data",b=>launchOutput+=b);child.on("error",e=>launchOutput+=String(e));
  let socket,seq=0,pending=new Map(),checks=[],summary={environment:"Windows local VS Code; production lifetime manager and renderer snapshot helper; synthetic composer/host state; no model calls"};
  let quitting=false;
  try{
    let target;for(let i=0;i<120&&!target;i++){try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).find(t=>t.webSocketDebuggerUrl)}catch{}if(child.exitCode!=null&&child.exitCode!==0)throw Error('VS Code launch failed: '+launchOutput);if(!target)await sleep(500)}assert.ok(target,"extension inspector started");
    socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
    socket.addEventListener('message',event=>{let m=JSON.parse(event.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timeout);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});
    const send=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,timeout=setTimeout(()=>{pending.delete(id);reject(Error('Inspector timeout '+method))},10000);pending.set(id,{resolve,reject:error=>reject(Error('Inspector '+method+': '+error.message)),timeout});socket.send(JSON.stringify({id,method,params}))});
    const evaluate=async(expression,awaitPromise=false)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise,returnByValue:true});if(result.exceptionDetails)throw Error('Inspector evaluation '+expression+': '+JSON.stringify(result.exceptionDetails));return result.result.value};
    const api=expression=>evaluate('globalThis.__azraelIdleFixture.'+expression,true);
    await send('Runtime.enable',{});
    const wait=async(predicate,label)=>{for(let i=0;i<100;i++){if(await predicate()){checks.push(label);return}await sleep(200)}throw Error('Timed out: '+label)};
    await wait(()=>evaluate('!!globalThis.__azraelIdleFixture'),'test extension activated');
    await api('open()');await wait(async()=>{let s=await api('stats()');return s.ready===1&&s.lastState?.scroll===420},'native custom editor and production snapshot helper ready');
    for(const theme of ['Default Light Modern','Default Dark Modern']){
      await api('theme('+JSON.stringify(theme)+')');await api('flag(true)');await api('hide()');await sleep(2100);let s=await api('stats()');assert.equal(s.suspended,false);checks.push(theme+': flagged hidden view retained');
      await api('show()');await wait(async()=>(await api('stats()')).visible,theme+': visible again');await api('flag(false)');await api('hide()');
      await wait(async()=>(await api('stats()')).suspended,theme+': hidden document released');s=await api('stats()');assert.equal(s.tabCount,2,'editor tab retained');
      await api('latest()');await api('show()');await wait(async()=>{const s=await api('stats()');return !s.suspended&&s.lastState?.history==='latest-model-result'&&s.lastState?.scroll===420},theme+': latest host state and scroll restored');
      s=await api('stats()');assert.equal(s.lastState.text,'unsent draft');assert.equal(s.lastState.attachments[0].path,'fixture.txt');assert.equal(s.errors.length,0);checks.push(theme+': composer draft/attachment retained');
    }
    summary.outcome='passed';summary.final=await api('stats()');quitting=true;summary.quitRequested=await evaluate('void globalThis.__azraelIdleFixture.quit()').then(()=>true,()=>false);
  }catch(error){summary.outcome='failed';summary.error=String(error.stack||error);process.exitCode=1}
  finally{
    if(socket?.readyState===WebSocket.OPEN&&!quitting){socket.send(JSON.stringify({id:++seq,method:'Runtime.evaluate',params:{expression:'globalThis.__azraelIdleFixture?.quit()'}}));await sleep(500)}socket?.close();for(const p of pending.values())clearTimeout(p.timeout);

    const inspection=spawnSync(path.join(process.env.SystemRoot||process.env.WINDIR||path.join('C:',path.sep,'Windows'),'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $fixture=$env:AZRAEL_OWNED_HOST_FIXTURE; for($attempt=0;$attempt -lt 50;$attempt++){ $live=@(Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -and $_.CommandLine.Replace('/','\\').Contains($fixture)) -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($fixture,[StringComparison]::OrdinalIgnoreCase)) }); if($live.Count -eq 0){break}; Start-Sleep -Milliseconds 200 }; if($live.Count){$live | Select-Object ProcessId,Name | ConvertTo-Json -Compress; exit 1}; 'No owned fixture process references'"],{windowsHide:true,timeout:15000,encoding:'utf8',env:{...process.env,AZRAEL_OWNED_HOST_FIXTURE:fixture}});
    summary.processInspectionExitCode=inspection.status;
    if(inspection.status!==0){artifactRun.producerStopped=false;process.exitCode=1;}
    summary.runRoot=artifactRun.runRoot;summary.lifecycleId=artifactRun.lifecycleId;summary.retentionReason='Retained raw fixture and profile for lifecycle review';
    fs.writeFileSync(path.join(logs,'process-inspection.log'),String(inspection.stdout||'')+String(inspection.stderr||'')+String(inspection.error||''));
    summary.launchExitCode=child.exitCode;fs.writeFileSync(path.join(logs,"host-launch.log"),launchOutput);summary.checks=checks;summary.exitCode=process.exitCode||0;fs.writeFileSync(path.join(logs,'host-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
  }
})().catch(error=>{console.error(error);process.exitCode=1});

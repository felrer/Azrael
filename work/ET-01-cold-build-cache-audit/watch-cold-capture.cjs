'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const prep=JSON.parse(fs.readFileSync(path.join(__dirname,'44-capture-preparation.json'))),root=prep.runRoot;
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(sha(prep.manifestPath)!==prep.manifestSha256||sha(prep.launcher)!==prep.launcherSha256||sha(prep.helper)!==prep.helperSha256)throw Error('Capture inputs changed');
const m=JSON.parse(fs.readFileSync(prep.manifestPath)),nonce=m.nonce;
const resultPath=path.join(root,'reports/start-watcher-result.json'),startedUtc=new Date().toISOString();
if(fs.existsSync(resultPath))throw Error('Watcher output exists');
const read=n=>{const p=path.join(root,'reports',n+'.json');if(!fs.existsSync(p))return null;const value=JSON.parse(fs.readFileSync(p));if(value.nonce!==nonce)throw Error('Foreign capture result');return value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const deadline=Date.now()+3600000;let armed;
 while(!(armed=read('armed-ready'))){if(read('capture-result')||Date.now()>deadline)throw Error('Helper failed or did not arm within one hour');await wait(500);}
 const ps='C:/Users/felre/AppData/Local/Programs/PowerShell/7/pwsh.exe';
 if(!Number.isInteger(armed.helperPid)||armed.helperPid<=0||armed.instanceName!==m.instanceName)throw Error('Helper identity malformed');
 const check=cp.spawnSync(ps,['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; $p=Get-Process -Id ${armed.helperPid}; $p.StartTime.ToUniversalTime().ToString('o')`],{encoding:'utf8',windowsHide:true});
 if(check.status!==0||check.signal||Date.parse(check.stdout.trim())!==Date.parse(armed.helperStartedAt))throw Error('Exact helper process identity not observed');
 fs.writeFileSync(path.join(root,'inputs/start-request.json'),JSON.stringify({schema:1,nonce,command:'start'})+'\n',{flag:'wx'});
 const readyDeadline=Date.now()+650000;let ready;
 while(!(ready=read('recording-ready'))){if(read('capture-result')||Date.now()>readyDeadline)throw Error('Recording failed or readiness timed out');await wait(500);}
 if(ready.startExitCode!==0||ready.statusExitCode!==0||ready.helperPid!==armed.helperPid||ready.helperStartedAt!==armed.helperStartedAt||ready.instanceName!==m.instanceName)throw Error('Recording readiness identity/result mismatch');
 const result={schema:1,status:'recording-ready',startedUtc,readyObservedUtc:new Date().toISOString(),armed,ready,manifestSha256:prep.manifestSha256,helperProcessIdentityCheckExit:check.status};
 fs.writeFileSync(resultPath,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
})().catch(error=>{fs.writeFileSync(resultPath,JSON.stringify({schema:1,status:'failed',startedUtc,error:error.stack})+'\n',{flag:'wx'});console.error(error.stack);process.exitCode=1;});

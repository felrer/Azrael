'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),project=path.join(root,'artifacts/workspaces/r'),owner='EB-01-latest-windows-profile-install';
const {beginArtifactRun,finishArtifactRun}=require(path.join(root,'scripts/artifact-run.cjs'));
const {verifyDeploymentWorkspace}=require(path.join(root,'scripts/deployment-workspace.cjs'));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const maintenanceVerificationPath=path.join(root,'artifacts/tasks/eb01-cleanup-a/current-owner-verification.json');
const maintenanceVerification=JSON.parse(fs.readFileSync(maintenanceVerificationPath)),maintenanceOwner=maintenanceVerification.executable;
if(!maintenanceVerification.acceptancePassed||!maintenanceVerification.installationPassed||sha(maintenanceOwner)!==maintenanceVerification.receipt.sha256)throw Error('Selected standalone maintenance owner is not verified');
process.env.AZRAEL_MAINTENANCE_OWNER=maintenanceOwner;
async function main(){
 const reportPath=path.join(root,'artifacts/tasks/eb01-latest-install/runs/generation-d/reports/workspace.json');
 const manifest=JSON.parse(fs.readFileSync(reportPath));
 const beginOptions={workId:'eb01-latest-install',runId:'deploy-m',owner,references:[{id:maintenanceVerification.receipt.version_id,kind:'execution',target_version:maintenanceVerification.receipt.version,member_paths:[path.dirname(path.dirname(maintenanceOwner))],reason:'Exact verified standalone owner for this deployment'},{id:manifest.inputLifecycleId,kind:'execution',reason:'Build and acceptance consume these exact immutable inputs'},{id:manifest.workingLifecycleId,kind:'execution',reason:'Build and acceptance execute this exact working source'},{id:'run:eb01-latest-install:deploy-a',kind:'execution',reason:'Reuse exact PTY evidence and unchanged temporary environment'},...['bun','pinned-ui','legacy-ui','instruction-fixtures'].map(name=>({id:'work:eb01:'+name,kind:'execution',reason:'Deployment consumes this prepared build or verification input'}))]};let run;for(let attempt=0;attempt<4;attempt++){try{run=beginArtifactRun(root,beginOptions);break;}catch(error){if(error.code!=='EEXIST'||error.path!==path.join(root,'artifacts/maintenance/lifecycles/catalog.lock')||attempt===3)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);}}let exitCode=1;const commands=[];
 const env={...process.env};for(const k of Object.keys(env))if(k.toUpperCase()==='PATH')delete env[k];
 const pwsh=path.join(root,'artifacts/tasks/windows-committed-20261023-99afefb1/runs/deploy-r1/powershell/pwsh.exe');
 env.PATH=[path.dirname(process.execPath),path.dirname(pwsh),'C:/Users/felre/AppData/Local/Programs/Python/Python313','C:/Users/felre/.cargo/bin','C:/Users/felre/AppData/Local/Programs/Microsoft VS Code/bin',process.env.PATH||process.env.Path].join(';');
 env.AZRAEL_MAINTENANCE_OWNER=maintenanceOwner;
 env.AZRAEL_PYTHON_SDK=path.join(root,'engine/sdk/python/.venv/Scripts/python.exe');
 env.AZRAEL_TEST_COMPUTER_USE_RUNTIME=path.join(root,'artifacts/tasks/DU-01-window-use-stages/runs/20261017-skill-r1/inputs/sky074-pristine');
 env.AZRAEL_TEST_LEGACY_COMPUTER_USE_RUNTIME=path.join(root,'artifacts/releases/all_changes_20261007_r6/computer-use');
 env.AZRAEL_CATALOG_TEST_ROOT=path.join(project,'artifacts/i-b/catalog');env.AZRAEL_MIGRATION_TEST_ROOT=path.join(project,'artifacts/i-b/migration');env.AZRAEL_INSTRUCTION_TEST_ROOT=path.join(project,'artifacts/i-b/instructions');
 env.AZRAEL_INSTRUCTION_TEST_ENGINE=path.join(root,'artifacts/workspaces/h/artifacts/releases/w13r-99afefb1/engine/azrael.exe');
 env.CARGO_TARGET_DIR=path.join(root,'engine/codex-rs/target');env.AZRAEL_CARGO_TARGET='x86_64-pc-windows-msvc';
 env.TEMP=env.TMP=env.TMPDIR=path.join(root,'artifacts/tasks/eb01-latest-install/runs/deploy-a/temporary');
 for(const k of Object.keys(env))if(['NPM_CONFIG_CACHE','BUN_INSTALL_CACHE_DIR'].includes(k.toUpperCase()))delete env[k];
 env.npm_config_cache=path.join(run.runRoot,'temporary/npm-cache');env.BUN_INSTALL_CACHE_DIR=path.join(run.runRoot,'temporary/bun-cache');
 const gitCountKey=Object.keys(env).find(k=>k.toUpperCase()==='GIT_CONFIG_COUNT'),gitCount=Number(gitCountKey?env[gitCountKey]:0);
 if(!Number.isSafeInteger(gitCount)||gitCount<0||gitCount>100)throw Error('Uncertain inherited Git command config');
 for(const key of Object.keys(env))if(['GIT_CONFIG_COUNT','GIT_CONFIG_KEY_'+gitCount,'GIT_CONFIG_VALUE_'+gitCount].includes(key.toUpperCase()))delete env[key];
 env.GIT_CONFIG_COUNT=String(gitCount+1);env['GIT_CONFIG_KEY_'+gitCount]='core.longpaths';env['GIT_CONFIG_VALUE_'+gitCount]='true';
 function execute(name,command,args,cwd=project){const log=path.join(run.logs,name+'.log'),fd=fs.openSync(log,'wx');let r;const startedUtc=new Date().toISOString();try{r=spawnSync(command,args,{cwd,env,windowsHide:true,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}commands.push({name,command,args,cwd,startedUtc,endedUtc:new Date().toISOString(),exitCode:r.status,signal:r.signal,error:r.error?.message,log});fs.writeFileSync(path.join(run.reports,'commands.json'),JSON.stringify(commands,null,2));if(r.error||r.status!==0)throw Error(name+' failed: '+log);}
 try{
  const lifecycle=require(path.join(root,'scripts/artifact-lifecycle.cjs'));
  const retention=lifecycle.catalog(project).find(r=>r.id==='work:eb01:archive-only-j');
  if(!retention)throw Error('Archive-only protection owner missing');
  lifecycle.recordLifecycle(project,{...retention,expected_revision:retention.revision,references:[...retention.references,...['run:verification:w13m-20261028','run:account-controls:w13m-20261028'].map(id=>({id,kind:'evidence',reason:'User archive-only cleanup policy: preserve until stopped and official archive relocation'}))]});
  const temporary=lifecycle.catalog(project).find(r=>r.id.startsWith('work:deployment-temporary:')&&r.members.some(m=>m.path===path.join(project,'artifacts/t')));
  if(!temporary)throw Error('Existing selected source temporary owner missing');
  const retentionNow=lifecycle.catalog(project).find(r=>r.id===retention.id);
  if(!retentionNow.references.some(r=>r.id===temporary.id))lifecycle.recordLifecycle(project,{...retentionNow,expected_revision:retentionNow.revision,references:[...retentionNow.references,{id:temporary.id,kind:'execution',reason:'Serial preflight and deployment consume this exact temporary environment; archive-only cleanup after producer stop'}]});
  env.INSTA_PENDING_DIR=path.join(run.temporary,'cargo-pending');
  fs.copyFileSync(maintenanceVerificationPath,path.join(run.inputs,'maintenance-owner-verification.json'));
  for(const value of [env.npm_config_cache,env.BUN_INSTALL_CACHE_DIR])fs.mkdirSync(value,{recursive:true});
  execute('npm-cache-probe',process.execPath,[path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),'config','get','cache']);
  execute('bun-cache-probe',path.join(project,'artifacts/tools/bun-1.4.2/package/bin/bun.exe'),['pm','cache'],path.join(project,'providers/opencodex'));
  for(const [name,expected]of [['npm-cache-probe',env.npm_config_cache],['bun-cache-probe',env.BUN_INSTALL_CACHE_DIR]]){const actual=fs.readFileSync(path.join(run.logs,name+'.log'),'utf8').trim();if(path.resolve(actual).toLowerCase()!==path.resolve(expected).toLowerCase())throw Error(name+' did not select the owned cache');}
  fs.writeFileSync(path.join(run.reports,'cache-environment.json'),JSON.stringify({npm:env.npm_config_cache,bun:env.BUN_INSTALL_CACHE_DIR,probed:true},null,2));
  execute('git-longpaths-probe','git',['config','--show-origin','--get','core.longpaths']);
  if(!fs.readFileSync(path.join(run.logs,'git-longpaths-probe.log'),'utf8').trim().endsWith('true'))throw Error('Git did not consume the execution-scoped longpaths setting');
  const verified=await verifyDeploymentWorkspace({...manifest,reportPath,manifestSha256:sha(reportPath)});
  fs.writeFileSync(path.join(run.reports,'inputs-before.json'),JSON.stringify(verified,null,2));
  const old=JSON.parse(fs.readFileSync(path.join(root,'artifacts/workspaces/h/artifacts/logs/deploy-w13r-99afefb1/inputs-initial.json')));
  function flatten(snapshot){const base=snapshot.inventory[0].root,m=new Map();for(const tree of snapshot.inventory)for(const e of tree.entries)m.set(path.relative(base,path.join(tree.root,e.path)).replaceAll('\\','/'),e.sha256);return m;}
  const before=flatten(old),after=flatten(manifest.project.frozenSnapshot);
  const changed=[...new Set([...before.keys(),...after.keys()])].filter(p=>before.get(p)!==after.get(p)).sort();
  const inventory=JSON.parse(fs.readFileSync(path.join(project,'scripts/azrael-feature-contracts.json'))),features=inventory.features.filter(f=>f.area==='engine');
  const ids=new Set(),unmapped=[];
  for(const file of changed){const owners=features.filter(f=>f.owners.some(o=>file===o||file.startsWith(o.replace(/\/$/,'')+'/')));owners.forEach(f=>ids.add(f.id));if(!owners.length&&/^engine\/.*(\.rs|Cargo\.(toml|lock)|rust-toolchain(\.toml)?|\.cargo\/config(\.toml)?)$/.test(file))unmapped.push(file);}
  fs.writeFileSync(path.join(run.reports,'scope.json'),JSON.stringify({baseline:'installed 2026.0.12 exact input inventory',changed,engineFeatureIds:[...ids],unmapped},null,2));
  const reviewedUnmapped=['engine/codex-rs/codex-mcp/src/mcp/mod_tests.rs','engine/codex-rs/core/src/apply_patch_tests.rs','engine/codex-rs/core/src/exec_policy_tests.rs','engine/codex-rs/core/src/tools/approvals_tests.rs','engine/codex-rs/sandboxing/src/violation_tests.rs','engine/codex-rs/shell-command/src/bash.rs','engine/codex-rs/shell-command/src/command_safety/is_dangerous_command.rs','engine/codex-rs/shell-command/src/command_safety/mod.rs','engine/codex-rs/shell-command/src/command_safety/windows_dangerous_commands.rs','engine/codex-rs/shell-command/src/lib.rs'];
  if(unmapped.some(p=>!reviewedUnmapped.includes(p)))throw Error('Native scope requires review: '+unmapped.join(', '));
  if(!ids.has('runtime.deletion-approval'))throw Error('Changed shell literal parser requires mandatory deletion-approval native coverage');
  const requiredFreeBytes=2_000_000_000;
  const free=Number(fs.statfsSync(root).bavail)*Number(fs.statfsSync(root).bsize);if(free<requiredFreeBytes)throw Error('Less than user-requested 2GB free before native/build preparation');
  fs.writeFileSync(path.join(run.reports,'capacity-policy.json'),JSON.stringify({requiredFreeBytes,initialAvailableBytes:free,pollIntervalMs:1000,owner:'scripts/deploy-azrael.ps1 Wait-OwnedCommands',onThreshold:'Fail deployment and stop only owned active process trees',authority:'User requested resume while watching the 2GB threshold'},null,2));
  const ptyRoot=path.join(root,'artifacts/tasks/eb01-latest-install/runs/deploy-l');
  const ptyInput=JSON.parse(fs.readFileSync(path.join(ptyRoot,'reports/inputs-before.json')));
  const pty=JSON.parse(fs.readFileSync(path.join(ptyRoot,'reports/commands.json'))).find(c=>c.name==='windows-pty-preflight');
  if(JSON.stringify(ptyInput.engine)!==JSON.stringify(verified.engine)||pty?.exitCode!==0||pty.signal!==null)throw Error('Fresh D PTY evidence is not reusable');
  fs.writeFileSync(path.join(run.reports,'pty-reuse.json'),JSON.stringify({check:pty,logSha256:sha(pty.log),engine:verified.engine,reason:'L tested this exact fixed D engine with nine passing Windows PTY cases, unchanged helpers/toolchain/physical target and same runtime TEMP. Only caller-owned Cargo pending publication path differs; no runtime PTY environment change.'},null,2));
  const config={projectRoot:project,parameters:{ReleaseName:'w13m-20261028',SourceRoot:path.join(project,'engine'),RetainedSourceRoot:manifest.immutableEngineRoot,EngineTargetDirectory:env.CARGO_TARGET_DIR,CodeModeHostPath:'C:/Users/felre/.vscode/extensions/openai.chatgpt-26.1007.21434-win32-x64/bin/windows-x86_64/codex-code-mode-host.exe',OriginalExtensionPath:'C:/Users/felre/.vscode/extensions/openai.chatgpt-26.1007.21434-win32-x64',OriginalAudioPath:'C:/Users/felre/.vscode/extensions/openai.codex-audio-26.1007.21434',UiSourcePath:path.join(project,'artifacts/upstream-ui/26.1007.21434'),VerificationFixtureRoot:path.join(project,'artifacts/v-m'),CodePath:'C:/Users/felre/AppData/Local/Programs/Microsoft VS Code/bin/code.cmd',WorkspacePath:root,StateRoot:'C:/Users/felre/.azrael-ex',HostVersion:'2026.0.13',ChangedPath:changed,EngineFeatureId:[...ids],VerifyAccountControls:true,SourceTestConcurrency:1,RequiredFreeBytes:requiredFreeBytes,PreflightToolDirectory:[path.dirname(pwsh),'C:/Users/felre/AppData/Local/Programs/Python/Python313','C:/Users/felre/.cargo/bin']}};
  const serialConfig={...JSON.parse(fs.readFileSync(path.join(project,'artifacts/logs/deploy-w13l-20261028/engine-source-preflight-inputs.json'))),sourceConcurrency:1,outputDirectory:path.join(run.reports,'serial-source-receipts')};
  delete serialConfig.receiptPath;
  config.serialSourceConfig=path.join(run.inputs,'source-preflight-serial.json');
  config.serialSourceLogs=path.join(run.logs,'serial-source');
  fs.writeFileSync(config.serialSourceConfig,JSON.stringify(serialConfig,null,2));
  const configPath=path.join(run.inputs,'deploy.json');fs.writeFileSync(configPath,JSON.stringify(config,null,2));
  if(env.AZRAEL_DEPLOY_START_BARRIER){
   const signal=env.AZRAEL_DEPLOY_START_BARRIER,expected=env.AZRAEL_DEPLOY_START_BARRIER_WORK_ID,deadline=Date.now()+30*60*1000;
   if(!path.isAbsolute(signal)||!/^[a-f0-9-]{36}$/.test(expected||''))throw Error('Explicit owned barrier identity required');
   for(;;){
    if(fs.existsSync(signal)){const result=JSON.parse(fs.readFileSync(signal,'utf8'));if(result.workId!==expected)throw Error('Barrier work identity mismatch');if(['succeeded','failed','cancelled'].includes(result.state)){fs.writeFileSync(path.join(run.reports,'deployment-start-barrier.json'),JSON.stringify(result,null,2));if(result.state!=='succeeded'||result.exitCode!==0)throw Error('Catalog cleanup handoff did not succeed; do not start deployment');break;}}
    const stat=fs.statfsSync(root);if(Number(stat.bavail)*Number(stat.bsize)<requiredFreeBytes)throw Error('Capacity below 2GB while awaiting catalog handoff');
    if(Date.now()>=deadline)throw Error('Catalog cleanup handoff remains unresolved');await new Promise(resolve=>setTimeout(resolve,10000));
   }
  }
  execute('deployment',pwsh,['-NoProfile','-File',path.join(__dirname,'invoke-deploy-serial.ps1'),'-ConfigPath',configPath]);
  fs.writeFileSync(path.join(run.reports,'inputs-after.json'),JSON.stringify(await verifyDeploymentWorkspace({...manifest,reportPath,manifestSha256:sha(reportPath)}),null,2));
  exitCode=0;console.log(JSON.stringify({status:'passed',runRoot:run.runRoot,release:'w13m-20261028',commands}));
 }catch(e){console.error(e.stack);}finally{for(let attempt=0;attempt<4;attempt++){try{finishArtifactRun(run,{exitCode,producerStopped:true});break;}catch(error){if(error.code!=='EEXIST'||error.path!==path.join(root,'artifacts/maintenance/lifecycles/catalog.lock')||attempt===3)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);}}}process.exitCode=exitCode;
}main().catch(e=>{console.error(e.stack);process.exitCode=1;});

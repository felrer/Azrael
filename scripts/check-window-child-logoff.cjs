'use strict';
// Focused retained source checks. Does not inspect, recover or log off a live Windows session.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {beginArtifactRun,finishArtifactRun,trackArtifactChild}=require('./artifact-run.cjs');
async function main(){
  const root=path.resolve(__dirname,'..');
  const run=beginArtifactRun(root,{workId:'DB-01-window-child-logoff',owner:'scripts/check-window-child-logoff.cjs'});
  console.log(JSON.stringify({runRoot:run.runRoot,lifecycleId:run.lifecycleId}));
  const tests=['test-window-child-explicit-logoff.cjs','test-window-child-logoff.cjs','test-window-child-session.cjs','test-window-child-reconnect.cjs','test-window-use-host.cjs','test-window-control-policy.cjs','test-window-control-mcp.cjs','test-window-use-async-approvals.cjs','test-window-use-isolation.cjs','test-window-use-resources.cjs','test-window-control-runtime.cjs','test-window-use-stage-authority.cjs','test-window-use-staging.cjs'];
  const env={...process.env,TMP:run.temporary,TEMP:run.temporary,TMPDIR:run.temporary,
    WINDOW_USE_LOGOFF_TEST_OWNER_ROOT:run.temporary,WINDOW_USE_LOGOFF_TEST_ROOT:path.join(run.temporary,'logoff'),WINDOW_USE_HOST_TEST_ROOT:path.join(run.temporary,'host'),
    WINDOW_USE_ISOLATION_TEST_ROOT:path.join(run.temporary,'isolation'),WINDOW_USE_RESOURCE_TEST_ROOT:path.join(run.temporary,'resources'),WINDOW_CHILD_RECONNECT_TEST_ROOT:path.join(run.temporary,'reconnect')};
  if(env.AZRAEL_CHILD_HELPER_FIXTURE)env.AZRAEL_CHILD_JOURNAL_FIXTURE=path.join(run.temporary,'absent-native-journal.json');
  const log=path.join(run.logs,'tests.log'),errors=path.join(run.logs,'tests.stderr.log');
  const out=fs.openSync(log,'wx'),err=fs.openSync(errors,'wx');let exitCode=null;
  try{
    const child=trackArtifactChild(run,spawn(process.execPath,['--test',...tests.map(t=>path.join(__dirname,t))],{cwd:root,env,windowsHide:true,stdio:['ignore',out,err]}));
    exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    const text=fs.readFileSync(log,'utf8');
    const summary={exitCode,tests,log,errors,summary:text.split(/\r?\n/).filter(x=>/^(ℹ|#) (tests|pass|fail|cancelled|skipped|duration)/.test(x))};
    fs.writeFileSync(path.join(run.reports,'summary.json'),JSON.stringify(summary,null,2)+'\n');
    console.log(JSON.stringify(summary));
  }finally{fs.closeSync(out);fs.closeSync(err);finishArtifactRun(run,{exitCode,producerStopped:[...run.children].every(c=>c.artifactClosed)});}
  process.exitCode=exitCode===0?0:1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});

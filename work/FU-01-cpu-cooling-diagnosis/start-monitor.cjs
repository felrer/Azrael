'use strict';
// Bounded local diagnostic execution. Existing artifact owner controls cleanup.
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const owner = require('../../scripts/artifact-run.cjs');
const root = path.resolve(__dirname, '../..');
const stressMode = process.argv[2] === '--stress';
const duration = Number(stressMode ? 600 : (process.argv[2] ?? 1800));
if (!Number.isInteger(duration) || duration < 1 || duration > 43200) throw Error('Invalid monitor duration');
const run = owner.beginArtifactRun(root, {
  workId: 'FU-01-live-monitor', owner: 'FU-01-cpu-cooling-diagnosis',
  references: []
});
const python = 'C:/Users/felre/AppData/Local/Programs/Python/Python313/python.exe';
const script = path.join(__dirname, 'monitor.py');
fs.copyFileSync(script, path.join(run.inputs, 'monitor.py'), fs.constants.COPYFILE_EXCL);
const sensorScript = path.join(run.inputs,'cpuid-sensors.py');
fs.copyFileSync(path.join(__dirname,'cpuid-sensors.py'),sensorScript,fs.constants.COPYFILE_EXCL);
let sensorProgram = sensorScript;
if(stressMode) {
  sensorProgram = path.join(run.inputs,'guarded-stress.py');
  fs.copyFileSync(path.join(__dirname,'guarded-stress.py'),sensorProgram,fs.constants.COPYFILE_EXCL);
}
const sensorStderr = fs.openSync(path.join(run.logs,'sensors.stderr.log'),'wx');
const sensorStdout = fs.openSync(path.join(run.logs,'sensors.stdout.log'),'wx');
const sensorChild = owner.trackArtifactChild(run,spawn(
  python,['-B',sensorProgram,'--output',run.logs,'--duration',String(stressMode ? 570 : duration)],
  {cwd:root,windowsHide:true,stdio:['ignore',sensorStdout,sensorStderr]}));
sensorChild.once('error',error=>console.error(error));
const sensorDone = new Promise(resolve=>sensorChild.once('close',(exitCode,signal)=>{
  fs.closeSync(sensorStdout);fs.closeSync(sensorStderr);
  if(stressMode && !fs.existsSync(path.join(run.logs,'STOP'))) fs.writeFileSync(path.join(run.logs,'STOP'),'Guarded test ended');
  resolve({exitCode,signal});
}));
const watchdogScript=path.join(run.inputs,'watchdog.py');
fs.copyFileSync(path.join(__dirname,'watchdog.py'),watchdogScript,fs.constants.COPYFILE_EXCL);
const watchdogStderr=fs.openSync(path.join(run.logs,'watchdog.stderr.log'),'wx');
const watchdogChild=owner.trackArtifactChild(run,spawn(python,['-B',watchdogScript,'--output',run.logs,
  '--duration',String(duration),'--monitor-log',path.join(run.logs,'system.jsonl')],
  {cwd:root,windowsHide:true,stdio:['ignore','ignore',watchdogStderr]}));
watchdogChild.once('error',error=>console.error(error));
const watchdogDone=new Promise(resolve=>watchdogChild.once('close',(exitCode,signal)=>{
  fs.closeSync(watchdogStderr);resolve({exitCode,signal});
}));
const stdout = fs.openSync(path.join(run.logs, 'stdout.log'), 'wx');
const stderr = fs.openSync(path.join(run.logs, 'stderr.log'), 'wx');
const child = owner.trackArtifactChild(run, spawn(python, ['-B', path.join(run.inputs, 'monitor.py'),
  '--output', run.logs, '--duration', String(duration), '--interval', '2',
  '--sensor-file',path.join(run.logs,'sensors.json')],
  {cwd:root, windowsHide:true, stdio:['ignore', stdout, stderr]}));
fs.writeFileSync(path.join(run.reports, 'execution.json'), JSON.stringify({
  pid:child.pid, sensorPid:sensorChild.pid, watchdogPid:watchdogChild.pid, controllerPid:process.pid, startedUtc:new Date().toISOString(), durationSeconds:duration, stressMode, stopAboveC:stressMode ? 85 : null,
  program:script, output:run.logs, stopFile:path.join(run.logs,'STOP')}, null, 2));
console.log(JSON.stringify({runRoot:run.runRoot,lifecycleId:run.lifecycleId,pid:child.pid,logs:run.logs}));
child.once('error', error => console.error(error));
child.once('close', async (exitCode, signal) => {
  fs.closeSync(stdout); fs.closeSync(stderr);
  if(!fs.existsSync(path.join(run.logs,'STOP'))) fs.writeFileSync(path.join(run.logs,'STOP'),'Recorder finished');
  const sensorResult = await sensorDone;
  const watchdogResult = await watchdogDone;
  fs.writeFileSync(path.join(run.reports,'result.json'), JSON.stringify({exitCode,signal,sensorResult,watchdogResult,endedUtc:new Date().toISOString()}));
  const overallExitCode = exitCode || (stressMode ? (sensorResult.exitCode ?? 1) : 0);
  if(stressMode) {
    let stopProof;
    try {
      const rows=fs.readFileSync(path.join(run.logs,'hardware.jsonl'),'utf8').trim().split(/\r?\n/);
      stopProof=JSON.parse(rows.at(-1));
    } catch(error) { console.error('Stress worker stop proof unavailable:',String(error)); }
    if(stopProof?.event!=='stop' || stopProof.workers_stopped!==true) {
      console.error('Owned load termination is unverified; lifecycle stays protected:',run.runRoot);
      process.exitCode=1;
      return;
    }
  }
  owner.finishArtifactRun(run,{exitCode:overallExitCode,signal,producerStopped:true});
  console.log(JSON.stringify({exitCode,signal,sensorResult,watchdogResult,runRoot:run.runRoot}));
  process.exitCode = overallExitCode ?? 1;
});

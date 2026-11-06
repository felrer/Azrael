'use strict';
// Read-only Windows storage/volume diagnosis through native administrator consent.
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const owner=require('../../scripts/artifact-run.cjs');
const root=path.resolve(__dirname,'../..');
const diagnose=process.argv.includes('--diagnose');
const monitored=process.argv.includes('--monitor');
const run=owner.beginArtifactRun(root,{workId:'FU-01-storage-inspection',owner:'FU-01-cpu-cooling-diagnosis',references:[]});
fs.copyFileSync(__filename,path.join(run.inputs,'collect-storage.cjs'),fs.constants.COPYFILE_EXCL);
const healthScript=path.join(run.inputs,'nvme-health.py');
if(diagnose) fs.copyFileSync(path.join(__dirname,'nvme-health.py'),healthScript,fs.constants.COPYFILE_EXCL);
let monitorDone=null;
let monitorOutput=null;
if(monitored){
  const monitorScript=path.join(run.inputs,'monitor.py');
  fs.copyFileSync(path.join(__dirname,'monitor.py'),monitorScript,fs.constants.COPYFILE_EXCL);
  monitorOutput=path.join(run.outputs,'monitor');
  fs.mkdirSync(monitorOutput);
  const monitorLog=fs.openSync(path.join(run.logs,'monitor.log'),'wx');
  const monitorChild=owner.trackArtifactChild(run,spawn('C:/Users/felre/AppData/Local/Programs/Python/Python313/python.exe',
    ['-B',monitorScript,'--output',monitorOutput,'--duration','43200','--interval','2'],
    {cwd:root,windowsHide:true,stdio:['ignore',monitorLog,monitorLog]}));
  monitorDone=new Promise(resolve=>{
    monitorChild.once('error',error=>console.error(error));
    monitorChild.once('close',(exitCode,signal)=>{fs.closeSync(monitorLog);resolve({exitCode,signal});});
  });
}
const psQuote=s=>"'"+s.replace(/'/g,"''")+"'";
const output=path.join(run.outputs,'storage-inspection.json');
const diagnosticCommand=diagnose?String.raw`
try {
  if(-not $disk -or [string]$disk.BusType -ne 'NVMe'){throw 'Mapped C drive is not NVMe'}
  $healthText=& PYTHON_PATH -B HEALTH_PATH ([string]$disk.Number) 2>&1
  $report.nvmeExitCode=$LASTEXITCODE
  $report.nvmeHealth=($healthText | Out-String | ConvertFrom-Json)
  if($report.nvmeExitCode -ne 0){$report.errors+='NVMe SMART query failed'}
} catch {$report.errors+=('NVMe: '+$_.Exception.Message)}
try {
  $report.recentApplicationEvents=@(Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=(Get-Date).AddHours(-3)} -ErrorAction SilentlyContinue | Where-Object {$_.ProviderName -match 'ESENT|Chkdsk|Wininit|Defrag'} | Select-Object -First 40 TimeCreated,ProviderName,Id,LevelDisplayName,Message)
  $report.recentSystemEvents=@(Get-WinEvent -FilterHashtable @{LogName='System';StartTime=(Get-Date).AddHours(-3)} -ErrorAction SilentlyContinue | Where-Object {$_.ProviderName -match 'disk|stor|Ntfs|WHEA|volmgr'} | Select-Object -First 40 TimeCreated,ProviderName,Id,LevelDisplayName,Message)
} catch {$report.errors+=('events: '+$_.Exception.Message)}
try {
  if(Get-Process chkdsk,defrag -ErrorAction SilentlyContinue){throw 'Another disk check/optimization is active; not starting duplicate'}
  if($report.nvmeHealth.health.criticalWarning -gt 0){throw 'NVMe critical warning: skip filesystem scan pending backup review'}
  $report.chkdskStartedUtc=[datetime]::UtcNow.ToString('o')
  $report.chkdskMode='chkdsk C: (read-only, no /f /r /scan)'
  [IO.File]::WriteAllText(OUTPUT_PATH,($report | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
  & chkdsk.exe C: 2>&1 | Out-File -LiteralPath CHKDSK_PATH -Encoding utf8
  $report.chkdskExitCode=$LASTEXITCODE
  $report.chkdskEndedUtc=[datetime]::UtcNow.ToString('o')
  if($report.chkdskExitCode -ne 0){$report.errors+=('chkdsk exit '+$report.chkdskExitCode)}
} catch {$report.errors+=('chkdsk: '+$_.Exception.Message)}
`.replace('PYTHON_PATH',psQuote('C:/Users/felre/AppData/Local/Programs/Python/Python313/python.exe'))
.replace('HEALTH_PATH',psQuote(healthScript)).replace('CHKDSK_PATH',psQuote(path.join(run.logs,'chkdsk.log'))):'';
const command=String.raw`
$ErrorActionPreference='Stop'
$report=[ordered]@{startedUtc=[datetime]::UtcNow.ToString('o');pid=$PID;readOnly=$true;errors=@()}
try {
  $disk=Get-Partition -DriveLetter C | Get-Disk
  $report.disk=$disk | Select-Object Number,FriendlyName,FirmwareVersion,BusType,HealthStatus,OperationalStatus
  $physical=@(Get-PhysicalDisk | Where-Object { $_.DeviceId -eq [string]$disk.Number -and $_.FriendlyName -eq $disk.FriendlyName })
  if($physical.Count -ne 1){throw 'C drive physical disk identity is ambiguous'}
  $report.physicalDisk=$physical | Select-Object DeviceId,FriendlyName,MediaType,HealthStatus,OperationalStatus,Size
  try {
    $report.reliability=$physical[0] | Get-StorageReliabilityCounter | Select-Object DeviceId,Temperature,TemperatureMax,Wear,PowerOnHours,ReadErrorsTotal,ReadErrorsUncorrected,WriteErrorsTotal,WriteErrorsUncorrected,ReadLatencyMax,WriteLatencyMax,FlushLatencyMax,StartStopCycleCount,LoadUnloadCycleCount
  } catch {$report.errors+=('reliability: '+$_.Exception.Message)}
} catch {$report.errors+=('disk: '+$_.Exception.Message)}
try {
  $report.filters=@(& fltmc.exe filters 2>&1 | ForEach-Object {$_.ToString()})
  $report.filtersExitCode=$LASTEXITCODE
  $report.cVolumeInstances=@(& fltmc.exe instances -v C: 2>&1 | ForEach-Object {$_.ToString()})
  $report.instancesExitCode=$LASTEXITCODE
} catch {$report.errors+=('filters: '+$_.Exception.Message)}
try {
  $report.ntfsDirty=@(& fsutil.exe dirty query C: 2>&1 | ForEach-Object {$_.ToString()})
  $report.dirtyQueryExitCode=$LASTEXITCODE
} catch {$report.errors+=('ntfsDirty: '+$_.Exception.Message)}
DIAGNOSTIC_COMMAND
$report.endedUtc=[datetime]::UtcNow.ToString('o')
[IO.File]::WriteAllText(OUTPUT_PATH,($report | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
if($report.errors.Count -gt 0 -or $report.filtersExitCode -ne 0 -or $report.instancesExitCode -ne 0){exit 2}
exit 0
`.replace('DIAGNOSTIC_COMMAND',diagnosticCommand).replaceAll('OUTPUT_PATH',psQuote(output));
// Command text contains only single-quoted literals. No execution-policy override.
if(command.includes('"')) throw Error('Unexpected command quoting');
fs.writeFileSync(path.join(run.inputs,'read-only-command.txt'),command);
const outer="$ErrorActionPreference='Stop'; $inspectionProcess=Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-Command',('\"'+"+psQuote(command)+"+'\"')) -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $inspectionProcess.ExitCode";
const stdout=fs.openSync(path.join(run.logs,'stdout.log'),'wx');
const stderr=fs.openSync(path.join(run.logs,'stderr.log'),'wx');
const child=owner.trackArtifactChild(run,spawn('powershell.exe',['-NoProfile','-Command',outer],{cwd:root,windowsHide:true,stdio:['ignore',stdout,stderr]}));
console.log(JSON.stringify({runRoot:run.runRoot,output,pid:child.pid}));
child.once('error',error=>console.error(error));
child.once('close',async(exitCode,signal)=>{
  fs.closeSync(stdout);fs.closeSync(stderr);
  let monitorResult=null;
  if(monitorDone){
    fs.writeFileSync(path.join(monitorOutput,'STOP'),'inspection finished');
    monitorResult=await monitorDone;
  }
  fs.writeFileSync(path.join(run.reports,'result.json'),JSON.stringify({exitCode,signal,monitorResult,endedUtc:new Date().toISOString(),outputExists:fs.existsSync(output)}));
  owner.finishArtifactRun(run,{exitCode,signal,producerStopped:true});
  console.log(JSON.stringify({exitCode,signal,output}));
  process.exitCode=exitCode??1;
});

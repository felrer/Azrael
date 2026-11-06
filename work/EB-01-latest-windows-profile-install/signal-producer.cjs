'use strict';
const fs=require('node:fs'),{spawn}=require('node:child_process');
const [workId,signalPath,script,...args]=process.argv.slice(2);
const child=spawn(process.execPath,[script,...args],{stdio:'inherit',windowsHide:true});
child.on('error',e=>console.error(e));
child.on('close',exitCode=>{fs.writeFileSync(signalPath+'.tmp',JSON.stringify({workId,state:exitCode===0?'succeeded':'failed',exitCode,summary:'Owned producer terminated'}));fs.renameSync(signalPath+'.tmp',signalPath);process.exitCode=exitCode??1;});

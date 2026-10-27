'use strict';
// Task-local visibility only; preserve each child command's arguments, environment and stdio.
const cp=require('node:child_process');
for(const name of ['spawn','spawnSync']){
 const original=cp[name];
 cp[name]=function(command,args,options){
  if(!Array.isArray(args)){options=args;args=[];}
  return original.call(this,command,args,{...options,windowsHide:true});
 };
}


'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path');
const {createWindowOwner}=require('./window-control-policy.cjs');

// A future dispatch merge must not bypass image/permission/stop gates for the shared-input backend.
test('switched input preserves fresh-image authority, native result and stop cleanup',async t=>{
  const fixtureRoot=process.env.AZRAEL_WINDOW_SETTINGS_TEST_ROOT;
  assert.ok(fixtureRoot && path.isAbsolute(fixtureRoot),'Owned fixture root required');
  await fs.mkdir(fixtureRoot,{recursive:true});
  const home=await fs.mkdtemp(path.join(fixtureRoot,'switched-policy-'));
  t.after(()=>fs.rm(home,{recursive:true}));
  const w={hwnd:'101',pid:4,processCreated:'123',executable:'test.exe',title:'Selected',minimized:false,widthPx:800,heightPx:600,dpi:96};
  let allowed=true,seq=0,inputs=0,releases=0,stageArgs;
  const owner=createWindowOwner({codexHome:home,authorize:async(_w,_t,op)=>op.permission==='observation'||allowed,
    requestPermission:async(_t,args)=>{stageArgs=args;return {authorized:true};},
    backend:{async request(method){if(method==='listWindows')return [w];if(['observe','inspect'].includes(method))return {window:w,observationId:'s'+ ++seq,frameTimestamp:'now',widthPx:800,heightPx:600,dpi:96,elements:[],elementsTruncated:false,image:{mimeType:'image/png',data:'YQ=='}};return {window:w};}},
    switchedInput:{async input(thread,identity,input,guard){await guard();assert.equal(thread,'thread');assert.deepEqual(identity,w);assert.deepEqual(input,{action:'press',keys:[65],operationId:7,x:10,y:20});inputs++;return {operationId:7,collaboration:{enabled:true},appEffectVerified:false};},async release(){releases++;return {detached:true};}}
  });
  t.after(()=>owner.dispose());
  const selected=await owner.bind('thread',w),base={windowId:selected.windowId};
  await owner.requestPermission('thread',{targetId:selected.targetId,permission:'control',reason:'mouse collaboration',switchedInput:true});assert.equal(stageArgs.switchedInput,true);
  await assert.rejects(owner.requestPermission('thread',{...base,permission:'control',reason:'ambiguous',switchedInput:true,virtualInput:true}));
  const send=image=>owner.call('thread','switched_input',{...base,observationId:image.observationId,input:{action:'press',keys:[65],operationId:7,x:10,y:20}});
  const inspected=await owner.call('thread','inspect',base);await assert.rejects(send(inspected),/Fresh image/);assert.equal(inputs,0);
  const image=await owner.call('thread','capture',base),result=await send(image);assert.equal(result.delivery,'switchedInput');assert.equal(result.verified,false);assert.equal(result.inputResult.operationId,7);assert.equal(result.inputResult.collaboration.enabled,true);
  await assert.rejects(send(image),/Fresh image/);assert.equal(inputs,1);
  const next=await owner.call('thread','capture',base);allowed=false;await assert.rejects(send(next),{code:'permission_denied'});assert.equal(inputs,1);allowed=true;
  owner.stop('thread');const released=await owner.call('thread','release_switched_input',base);assert.equal(released.detached,true);assert.equal(released.pauseReason,'user_stopped');assert.ok(releases>0);
  await assert.rejects(owner.call('thread','release_switched_input',{windowId:'forged'}),/forged/);
});

test('desktop input uses a fresh whole-screen observation without a selected window and honors Stop',async t=>{
  const root=process.env.AZRAEL_WINDOW_SETTINGS_TEST_ROOT;
  assert.ok(root&&path.isAbsolute(root));await fs.mkdir(root,{recursive:true});
  const home=await fs.mkdtemp(path.join(root,'desktop-policy-'));
  let allowed=true,inputs=0,releases=0,requested;const checks=[];
  const owner=createWindowOwner({codexHome:home,authorize:async(_w,_t,op)=>{checks.push(op);return op.permission!=='desktop'||allowed;},
    backend:{request:async()=>[]},requestPermission:async(_t,args)=>{requested=args;return {authorized:true};},
    resolveDesktopWindow:async()=>({hwnd:'desktop-window',pid:7,processCreated:'desktop-created',executable:'C:/desktop-app.exe',title:'Desktop target',minimized:false,widthPx:800,heightPx:600,dpi:96}),
    desktopCapture:async()=>({originX:-100,originY:0,widthPx:800,heightPx:600,redacted:true,image:{mimeType:'image/png',data:'YQ=='}}),
    desktopInput:async(_thread,input,_image,guard)=>{await guard();inputs++;return {action:input.action};},
    releaseDesktopInput:async()=>{releases++;}
  });
  t.after(async()=>{await owner.dispose();await fs.rm(home,{recursive:true});});
  const grant=await owner.requestPermission('thread',{permission:'desktop',reason:'Whole-screen task'});
  assert.equal(grant.authorized,true);assert.equal(requested.permission,'desktop');
  await assert.rejects(owner.requestPermission('thread',{permission:'desktop',reason:'forged scope',targetId:'forged'}));
  const image=await owner.call('thread','capture_desktop',{});
  const args={observationId:image.observationId,input:{action:'click',button:'left',x:10,y:20}};
  assert.equal((await owner.call('thread','desktop_input',args)).delivery,'desktopInput');assert.equal(inputs,1);
  assert.equal(checks.filter(op=>op.requestApproval===true).length,1);assert.ok(checks.some(op=>op.permission==='desktop'&&!op.requestApproval));
  await assert.rejects(owner.call('thread','desktop_input',args),error=>error.code==='state_changed'&&error.actionExecuted===false);assert.equal(inputs,1);
  const next=await owner.call('thread','capture_desktop',{});allowed=false;
  await assert.rejects(owner.call('thread','desktop_input',{...args,observationId:next.observationId}),{code:'permission_denied'});
  allowed=true;owner.stop('thread');const stopped=await owner.call('thread','capture_desktop',{});
  await assert.rejects(owner.call('thread','desktop_input',{...args,observationId:stopped.observationId}),error=>error.pauseReason==='user_stopped'&&error.recovery==='user_resume');
  await owner.call('thread','release_desktop_input',{});assert.ok(releases>0);assert.equal(inputs,1);
});

test('individual semantic actions show and idle the model cursor without injecting duplicate input',async t=>{
  const root=process.env.AZRAEL_WINDOW_SETTINGS_TEST_ROOT;
  assert.ok(root&&path.isAbsolute(root));await fs.mkdir(root,{recursive:true});
  const home=await fs.mkdtemp(path.join(root,'semantic-cursor-'));
  const window={hwnd:'101',pid:4,processCreated:'123',executable:'test.exe',title:'Selected',minimized:false,widthPx:800,heightPx:600,dpi:96};
  const events=[];let sequence=0;
  const owner=createWindowOwner({codexHome:home,authorize:async()=>true,
    backend:{request:async method=>{if(method==='listWindows')return [window];if(method==='inspect')return {window,observationId:'o'+ ++sequence,frameTimestamp:'now',elements:[{id:'button',name:'Action',controlType:'Button'}],elementsTruncated:false};if(method==='act')events.push('semantic-act');return {window};}},
    visualizeAction:async(_thread,actual,args,tool,guard)=>{await guard();assert.deepEqual(actual,window);assert.equal(args.elementId,'button');assert.equal(tool,'invoke');events.push('cursor-active');return async()=>events.push('cursor-idle');}
  });
  t.after(async()=>{await owner.dispose();await fs.rm(home,{recursive:true});});
  const selected=await owner.bind('thread',window),base={windowId:selected.windowId};
  const image=await owner.call('thread','inspect',base);
  await owner.call('thread','invoke',{...base,observationId:image.observationId,elementId:'button'});
  assert.deepEqual(events,['cursor-active','semantic-act','cursor-idle']);
});

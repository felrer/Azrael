'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { isDeepStrictEqual } = require('node:util');
const ts = require('../extensions/azrael-ex/node_modules/typescript');
const injection = require('./inject-image-sketch.cjs');
const upstream = process.env.AZRAEL_PRESERVATION_UI_ROOT || path.resolve(__dirname, '../artifacts/upstream-ui/26.1007.21434');
function source(asset) { return fs.readFileSync(path.join(upstream, asset), 'utf8'); }
function transformed(asset) { return injection.injectImageSketch(source(asset), asset).text; }
function declaration(text, name) {
  const ast = ts.createSourceFile('native.js', text, 99, true, 1);
  return ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === name).getText(ast);
}

test('all six pinned boundaries transform, parse and reapply; damaged inputs fail closed', () => {
  for (const asset of injection.IMAGE_SKETCH_ASSETS) {
    const native = source(asset), result = injection.injectImageSketch(native, asset);
    assert.equal(result.count, 1, asset);
    assert.equal(ts.createSourceFile(asset, result.text, 99, true, 1).parseDiagnostics.length, 0, asset);
    assert.deepEqual(injection.injectImageSketch(result.text, asset), {text:result.text,count:0});
    assert.throws(()=>injection.injectImageSketch(result.text.replace(injection.MARKER, injection.MARKER+injection.MARKER),asset));
    assert.throws(()=>injection.injectImageSketch('',asset),/pinned contract/);
  }
});

test('complete namespace pipeline preserves native image editing and counts all sketch owners', () => {
  const namespace = require('./namespace-azrael-host.cjs');
  for (const asset of injection.IMAGE_SKETCH_ASSETS) {
    const result = namespace.transformAsset(source(asset), asset, path.join(upstream,asset), ts);
    assert.equal(result.asset.imageSketchEdits,1,asset);
    assert.equal(ts.createSourceFile(asset,result.text,99,true,1).parseDiagnostics.length,0,asset);
  }
  const attachments=transformed(injection.ATTACHMENT_ASSET);
  assert.ok(attachments.includes('q(`lightbox_edit_button`)&&F(!1)'));
  assert.ok(transformed(injection.COMPOSER_ASSET).includes('L.onOpenEditor?.(`edit_button`)&&z(!1)'));
  assert.ok(namespace.getAssetTransformRules(injection.EDITOR_ASSET)['inject-image-sketch.cjs']);
});

function stateFixture(initialIds=[]) {
  const exported=[], editors=[], attachments=[];
  let notify, ids=[...initialIds];
  const env={composerId:'a',canOpenSketch:true,canEditSketch:true,isDarkMode:false};
  const factory=vm.runInNewContext('('+declaration(transformed(injection.STATE_ASSET),'a')+')',{
    crypto,AbortController,File,URL,Image:class{},o:{default:isDeepStrictEqual},r:()=>{
      let document={objects:[{id:'stroke'}]};const editor={pointerCancel(){},discardPendingTextEdit(){},commitPendingTextEdit(){},replaceDocument(d){document=d},getSnapshot:()=>({document,effectiveDocument:document,hasActiveGesture:false}),export:async options=>{exported.push(options);return{kind:'success',blob:new Blob(['png'],{type:'image/png'}),bounds:{x:0,y:0,width:800,height:500}}}};
      editors.push(editor);return editor;
    }
  });
  const state=factory(()=>env,{subscribe:cb=>{notify=cb;cb(ids);return()=>{}},track(){},createFileName:()=> 'sketch.png',save:async(file,options)=>{
    if(env.failSave)throw Error('upload failed');
    if(options.replaceUploadId!=null&&!ids.includes(options.replaceUploadId))throw Error('replacement target removed');
    const id=options.replaceUploadId??'upload';attachments.push({file,options});
    options.onQueued(id);if(!ids.includes(id))ids.push(id);notify(ids);options.onComplete('success');
  }});
  return{state,env,exported,editors,attachments,get ids(){return [...ids]},setIds:next=>{ids=[...next];notify(ids)}};
}
test('image composition uses full image bounds, retains background on reopen, and preserves ordinary sketch export',async()=>{
  const f=stateFixture(),image={},background={src:'data:image/png;base64,x',width:800,height:500,image};
  assert.equal(f.state.openNew({azraelBackground:background}),true);
  assert.equal(f.state.openNew(),false);
  await f.state.save();
  const options=f.exported[0],calls=[];options.drawBackground({drawImage:(...args)=>calls.push(args)});
  assert.deepEqual({...options.outputBounds},{x:0,y:0,width:800,height:500});
  assert.equal(options.padding,0);assert.deepEqual(calls,[[image,0,0,800,500]]);
  assert.equal(f.attachments[0].file.type,'image/png');
  assert.equal(f.state.openAttachment('upload'),true);
  assert.equal(f.state.getSnapshot().active.azraelBackground,background);
  f.state.discard();f.state.openNew();await f.state.save();
  assert.equal(f.exported[1].padding,36);assert.equal(f.exported[1].backgroundColor,'#ffffff');
  f.state.dispose();
});
test('export failure keeps drawing recoverable and queues no attachment',async()=>{
  const f=stateFixture();f.state.openNew({azraelBackground:{width:10,height:10}});
  const active=f.state.getSnapshot().active;active.editor.export=async()=>{throw Error('tainted canvas')};
  await f.state.save();assert.equal(f.state.getSnapshot().active,active);assert.equal(active.saving,null);assert.equal(f.attachments.length,0);f.state.dispose();
});
test('draft image editing replaces the selected attachment and saves erased and unchanged images',async()=>{
  const f=stateFixture(['photo','other']),background={src:'original',image:{},width:800,height:500};
  assert.equal(f.state.openNew({azraelBackground:background,azraelReplaceUploadId:'photo'}),true);
  const editor=f.editors[0];await f.state.save();
  assert.equal(f.attachments[0].options.replaceUploadId,'photo');assert.deepEqual(f.ids,['photo','other']);
  assert.equal(f.state.openAttachment('photo'),true);assert.equal(f.state.getSnapshot().active.editor,editor);
  assert.equal(f.state.getSnapshot().active.azraelBackground,background);
  editor.replaceDocument({objects:[]});await f.state.save();
  assert.equal(f.exported.length,2);assert.equal(f.attachments[1].options.replaceUploadId,'photo');
  assert.equal(f.state.openAttachment('photo'),true);await f.state.save();
  assert.equal(f.exported.length,3);assert.deepEqual(f.ids,['photo','other']);assert.equal(f.state.getSnapshot().active,null);f.state.dispose();
});
test('untouched photos save while ordinary empty sketches retain their native policy',async()=>{
  const f=stateFixture(['photo']);f.state.openNew({azraelBackground:{image:{},width:80,height:50},azraelReplaceUploadId:'photo'});
  f.editors[0].replaceDocument({objects:[]});await f.state.save();assert.equal(f.attachments.length,1);
  f.state.openNew();f.state.getSnapshot().active.editor.replaceDocument({objects:[]});await f.state.save();
  assert.equal(f.attachments.length,1);assert.notEqual(f.state.getSnapshot().active,null);f.state.dispose();
});
test('replacement failure preserves the original and editable state; vanished targets cannot append',async()=>{
  const f=stateFixture(['photo','other']);
  assert.equal(f.state.openNew({azraelBackground:{},azraelReplaceUploadId:'removed'}),false);
  f.state.openNew({azraelBackground:{image:{},width:80,height:50},azraelReplaceUploadId:'photo'});
  const active=f.state.getSnapshot().active;f.env.failSave=true;await f.state.save();
  assert.equal(f.state.getSnapshot().active,active);assert.deepEqual(f.ids,['photo','other']);assert.equal(f.attachments.length,0);
  f.env.failSave=false;await f.state.save();assert.deepEqual(f.ids,['photo','other']);
  f.state.openAttachment('photo');f.setIds(['other']);assert.equal(f.state.getSnapshot().active,null);f.state.dispose();
});
test('native preview mapper and upload adapter preserve the selected draft image ID',async()=>{
  const text=transformed(injection.COMPOSER_ASSET),ast=ts.createSourceFile('composer.js',text,99,true,1);
  const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='dba');let mapper;
  function visit(node){if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&node.left.getText(ast)==='Ue'&&ts.isArrowFunction(node.right))mapper=node.right;else ts.forEachChild(node,visit)}visit(component);
  assert.ok(mapper);const preview=vm.runInNewContext('('+mapper.getText(ast)+')',{C:null,S:null,x:null,Dba:e=>e.src})({id:'photo',src:'original'});
  assert.equal(preview.azraelUploadId,'photo');
  let queued,completed,nativeItem,nativeOptions;
  const adapter=vm.runInNewContext('('+declaration(text,'oda')+')',{$G:{},Nf:async()=> 'encoded',_x(){},g_:()=> 'conversation'});
  await adapter({get:()=> 'local',value:{}},async(createItem,options)=>{
    nativeOptions=options;nativeItem=await createItem(options.replaceImageId);options.onQueued(nativeItem.id);options.onComplete('success');
  },new File(['png'],'photo.png',{type:'image/png'}),{id:'sketch',replaceUploadId:preview.azraelUploadId,onQueued:id=>{queued=id},onComplete:status=>{completed=status}});
  assert.equal(nativeOptions.replaceImageId,'photo');assert.equal(nativeItem.id,'photo');assert.equal(nativeItem.sketchId,'sketch');assert.equal(queued,'photo');assert.equal(completed,'success');
});
// Use the real native scope hook: separate components receive distinct wrappers
// for the same descriptor/provider node. A shared {} would conceal the bug.
let nativeScopeDeclaration;
function nativeScopes() {
  const text=source('webview/assets/app-initial-97d3534ad35f.js');
  const node={},descriptor={},chain={node};
  const context={chain,VRt:{useContext:()=>context.chain,useRef:()=>({current:null})},
    oq:()=>null,OK:chain=>chain.node,YIt:()=>({conversationId:'conversation'}),GIt:()=>({})};
  nativeScopeDeclaration??=declaration(text,'BRt');
  const hook=vm.runInNewContext('('+nativeScopeDeclaration+')',context);
  const composer=hook(descriptor),attachment=hook(descriptor);
  context.chain={node:{}};const other=hook(descriptor);
  return{composer,attachment,other};
}
let bridgeDeclarations;
function bridgeFixture({canOpen=true,active=null,mount=true,openResult=true,state=null}={}) {
  if(!bridgeDeclarations){
    const text=transformed(injection.COMPOSER_ASSET);
    bridgeDeclarations=['azraelUseImageSketchBridge','azraelRequestImageSketch'].map(name=>declaration(text,name)).join('\n');
  }
  const scopes=nativeScopes(),listeners=new Set(),images=[],opened=[],toasts=[];let cleanup,openCount=0;
  const context={g5:{useEffect:fn=>{cleanup=fn()}},
    window:{addEventListener:(_name,fn)=>listeners.add(fn),removeEventListener:(_name,fn)=>listeners.delete(fn),dispatchEvent:event=>{for(const fn of listeners)fn(event)}},
    CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail}},
    azraelImageSketchToasts:()=>Object.fromEntries(['info','danger'].map(kind=>[kind,message=>{
      const toast={kind,message,closed:false};toasts.push(toast);return{close:()=>{toast.closed=true}};
    }])),
    Image:class{constructor(){images.push(this);this.naturalWidth=80;this.naturalHeight=50}decode(){return new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject})}}
  };
  vm.createContext(context);vm.runInContext(bridgeDeclarations,context);
  if(mount)context.azraelUseImageSketchBridge(scopes.composer,options=>{
    opened.push(options);if(openResult instanceof Error)throw openResult;
    if(openResult)options.azraelOnOpened(true);return openResult;
  },{current:state?{state}:active?{state:{getSnapshot:()=>({active})}}:null},canOpen,'composer');
  return{...scopes,images,opened,toasts,listeners,cleanup:()=>cleanup?.(),
    request:(scope=scopes.attachment,isCurrent=()=>true,locale='en',uploadId)=>context.azraelRequestImageSketch(scope,'data:image/png;base64,x',isCurrent,()=>{openCount++},locale,uploadId),
    get openCount(){return openCount}};
}
const tick=()=>new Promise(setImmediate);

test('distinct native scope wrappers for the same node open the image sketch',async()=>{
  const f=bridgeFixture();assert.notEqual(f.composer,f.attachment);
  assert.equal(f.composer.node,f.attachment.node);
  const result=f.request();assert.equal(f.toasts[0].kind,'info');
  f.images[0].resolve();assert.equal(await result,'opened');
  assert.equal(f.opened.length,1);assert.equal(f.openCount,1);
  assert.equal(f.opened[0].azraelBackground.width,80);assert.equal(f.toasts[0].closed,true);
  f.cleanup();assert.equal(f.listeners.size,0);
});
test('bridge forwards the draft target and reopens its original editable sketch',async()=>{
  const f=bridgeFixture(),result=f.request(f.attachment,()=>true,'en','photo');
  f.images[0].resolve();assert.equal(await result,'opened');assert.equal(f.opened[0].azraelReplaceUploadId,'photo');f.cleanup();
  const saved=stateFixture(['photo']);saved.state.openNew({azraelBackground:{image:{},width:80,height:50},azraelReplaceUploadId:'photo'});await saved.state.save();
  const reopened=bridgeFixture({state:saved.state});assert.equal(await reopened.request(reopened.attachment,()=>true,'en','photo'),'opened');
  assert.equal(reopened.images.length,0);assert.equal(reopened.opened.length,0);assert.equal(saved.editors.length,1);reopened.cleanup();saved.state.dispose();
});

test('unavailable receiver, different node/descriptor and disabled composer report a reason',async()=>{
  for(const options of [{mount:false},{canOpen:false},{other:true},{descriptor:true}]){
    const f=bridgeFixture(options);
    const scope=options.other?f.other:options.descriptor?{node:f.attachment.node,scope:{}}:f.attachment;
    assert.equal(await f.request(scope,()=>true,'ko'),'unavailable');
    assert.equal(f.images.length,0);assert.equal(f.toasts.length,1);assert.equal(f.toasts[0].kind,'danger');
    assert.match(f.toasts[0].message,/입력창/);f.cleanup();
  }
});

test('active and pending sketches report busy without consuming the original request',async()=>{
  const active=bridgeFixture({active:{}});assert.equal(await active.request(),'busy');assert.equal(active.images.length,0);active.cleanup();
  const f=bridgeFixture(),first=f.request();assert.equal(await f.request(),'busy');
  assert.equal(f.images.length,1);f.images[0].resolve();assert.equal(await first,'opened');assert.equal(f.openCount,1);f.cleanup();
});

test('preview cancellation and effect disposal settle requests and prevent stale opening',async()=>{
  for(const unmount of [false,true]){
    const f=bridgeFixture();let current=true;const result=f.request(f.attachment,()=>current);
    if(unmount)f.cleanup();else current=false;
    f.images[0].resolve();assert.equal(await result,'cancelled');await tick();
    assert.equal(f.opened.length,0);assert.equal(f.openCount,0);
    assert.equal(f.toasts[0].closed,true);assert.equal(f.toasts.filter(t=>t.kind==='danger').length,0);f.cleanup();
  }
});

test('image load and native open failures close loading feedback and permit retry',async()=>{
  const f=bridgeFixture(),first=f.request();f.images[0].reject(Error('decode failed'));
  assert.equal(await first,'failed');assert.equal(f.toasts[0].closed,true);assert.equal(f.openCount,0);
  const retry=f.request();f.images[1].resolve();assert.equal(await retry,'opened');assert.equal(f.openCount,1);f.cleanup();
  for(const openResult of [false,Error('open failed')]){
    const rejected=bridgeFixture({openResult}),result=rejected.request();rejected.images[0].resolve();
    assert.equal(await result,'failed');assert.equal(rejected.toasts.filter(t=>t.kind==='danger').length,1);rejected.cleanup();
  }
});

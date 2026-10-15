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

function stateFixture() {
  const exported=[], editors=[], attachments=[];
  let notify;
  const env={composerId:'a',canOpenSketch:true,canEditSketch:true,isDarkMode:false};
  const factory=vm.runInNewContext('('+declaration(transformed(injection.STATE_ASSET),'a')+')',{
    crypto,AbortController,File,URL,Image:class{},o:{default:isDeepStrictEqual},r:()=>{
      let document={objects:[{id:'stroke'}]};const editor={pointerCancel(){},discardPendingTextEdit(){},commitPendingTextEdit(){},replaceDocument(d){document=d},getSnapshot:()=>({document,effectiveDocument:document,hasActiveGesture:false}),export:async options=>{exported.push(options);return{kind:'success',blob:new Blob(['png'],{type:'image/png'}),bounds:{x:0,y:0,width:800,height:500}}}};
      editors.push(editor);return editor;
    }
  });
  const state=factory(()=>env,{subscribe:cb=>(notify=cb,()=>{}),track(){},createFileName:()=> 'sketch.png',save:async(file,options)=>{attachments.push({file,options});options.onQueued('upload');notify(['upload']);options.onComplete('success')}});
  return{state,env,exported,editors,attachments};
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
test('bridge isolates composer scopes, respects cancellation and cleans subscriptions',async()=>{
  const listeners=new Map(),scope={},opened=[],images=[];let cleanup;
  const bridge=vm.runInNewContext('('+declaration(transformed(injection.COMPOSER_ASSET),'azraelUseImageSketchBridge')+')',{
    g5:{useEffect:fn=>{cleanup=fn()}},window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},
    Image:class{constructor(){images.push(this);this.naturalWidth=80;this.naturalHeight=50}decode(){return new Promise(resolve=>this.resolve=resolve)}}
  });
  bridge(scope,options=>{opened.push(options);options.azraelOnOpened(true);return true},{current:null},true,'composer',()=>assert.fail('unexpected load failure'));
  const listener=listeners.get('azrael:image-sketch');
  const other={scope:{},isCurrent:()=>true};listener({detail:other});assert.equal(other.handled,undefined);
  let current=true,count=0;const request={scope,src:'data:image/png;base64,x',isCurrent:()=>current,onOpened:()=>count++};
  listener({detail:request});assert.equal(request.handled,true);current=false;images[0].resolve();await new Promise(setImmediate);assert.equal(opened.length,0);
  current=true;listener({detail:{...request,handled:false}});images[1].resolve();await new Promise(setImmediate);assert.equal(opened.length,1);assert.equal(count,1);assert.equal(opened[0].azraelBackground.width,80);
  cleanup();assert.equal(listeners.size,0);
});

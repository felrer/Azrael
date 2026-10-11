'use strict';
function inject(text, ts) {
  const source = ts.createSourceFile('extension.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), edits = [];
  let classes = 0;
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name?.text === 'sendProviderRequest') {
      classes++;
      for (const m of node.parent.members) {
        if (m.name?.text === 'dispose') edits.push({ start: m.body.getStart(source)+1, end: m.body.getStart(source)+1, text: 'require("./linux-native-supervision.cjs").dispose(this);' });
        if (m.name?.text === 'finishProcessExitIfReady') {
          const old = text.slice(m.body.getStart(source),m.body.end), needle = 'this.teardownProcess()';
          if (old.split(needle).length !== 2) throw new Error('Pinned app-server exit boundary changed');
          edits.push({ start:m.body.getStart(source),end:m.body.end,text:old.replace(needle,'this.teardownProcess();require("./linux-native-supervision.cjs").exited(this)') });
        }
        if (m.name?.text === 'startCodexProcess') {
          const old = text.slice(m.body.getStart(source),m.body.end), pattern=/this\.proc=([a-zA-Z_$][\w$]*),this\.initialized=!1/;
          if (!pattern.test(old)) throw new Error('Pinned app-server assignment changed');
          edits.push({ start:m.body.getStart(source),end:m.body.end,text:old.replace(pattern,'this.proc=$1,require("./linux-native-supervision.cjs").watch(this,$1),this.initialized=!1') });
        }
      }
      return;
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  if (classes!==1 || edits.length!==3) throw new Error('Pinned supervision boundary changed');
  for (const e of edits.sort((a,b)=>b.start-a.start)) text=text.slice(0,e.start)+e.text+text.slice(e.end);
  if (ts.createSourceFile('extension.js',text,ts.ScriptTarget.Latest,false,ts.ScriptKind.JS).parseDiagnostics.length) throw new Error('Invalid Linux supervision transform');
  return clearUiError(wrapStartFailure(text, ts), ts);
}
function wrapStartFailure(text,ts) {
  const source=ts.createSourceFile('extension.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let found;
  function visit(node){
    if(ts.isMethodDeclaration(node)&&node.name?.text==='sendProviderRequest') {
      const method=node.parent.members.find(m=>m.name?.text==='startCodexProcess');
      if(found||!method?.body)throw new Error('Ambiguous app-server start');found=method;return;
    } ts.forEachChild(node,visit);
  }visit(source);
  if(!found)throw new Error('Missing app-server start');
  const begin=found.body.getStart(source),end=found.body.end,body=text.slice(begin,end);
  if(body.includes('finally{if(!this.proc)'))throw new Error('Already wrapped app-server start');
  text=text.slice(0,begin)+'{try'+body+'finally{if(!this.proc)require("./linux-native-supervision.cjs").exited(this)}}'+text.slice(end);
  if(ts.createSourceFile('extension.js',text,ts.ScriptTarget.Latest,false,ts.ScriptKind.JS).parseDiagnostics.length)throw new Error('Invalid start failure transform');
  return text;
}
function clearUiError(text,ts) {
  const source=ts.createSourceFile('extension.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let point;
  function visit(node) {
    if(ts.isPropertyAssignment(node)&&node.name?.text==='onInitialized'&&ts.isArrowFunction(node.initializer)&&ts.isBlock(node.initializer.body)) {
      const body=text.slice(node.initializer.body.getStart(source),node.initializer.body.end);
      if(body.includes('this.broadcastToAllViews(')) {
        if(point!==undefined||body.includes('recoverUi(this)'))throw new Error('Ambiguous or already patched UI initialization');
        point=node.initializer.body.getStart(source)+1;
      }
    }ts.forEachChild(node,visit);
  }visit(source);
  if(point===undefined)throw new Error('Missing UI initialization callback');
  return text.slice(0,point)+'require("./linux-native-supervision.cjs").recoverUi(this);'+text.slice(point);
}
module.exports={inject,wrapStartFailure,clearUiError};

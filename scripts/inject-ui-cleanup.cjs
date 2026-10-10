"use strict";

const COMPOSER_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const PERMISSIONS_ASSET = "webview/assets/permissions-mode-dropdown-66a2c48ceb22.js";
const UI_CLEANUP_ASSETS = [COMPOSER_ASSET, PERMISSIONS_ASSET];
const MARKER = "/*azrael-ui-cleanup-v1*/";

function parse(text, ts) {
  const file = ts.createSourceFile("pinned-ui.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error("UI cleanup asset failed JavaScript parsing.");
  return file;
}
function injectUiCleanup(text, relativePath, ts) {
  if (!UI_CLEANUP_ASSETS.includes(relativePath)) return { text, count: 0 };
  const file = parse(text, ts), edits = [];
  const functions = new Map();
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      if (functions.has(node.name.text)) throw new Error("Duplicate pinned UI function.");
      functions.set(node.name.text, node);
    }
  }
  const marked = text.includes(MARKER);
  function requireFunction(name) {
    const node = functions.get(name);
    if (!node) throw new Error(`Missing pinned UI function: ${name}`);
    return node;
  }
  function replace(owner, anchor, replacement, expected = 1) {
    const start = owner ? owner.getStart(file) : 0, end = owner ? owner.end : text.length;
    const source = text.slice(start, end), occurrences = source.split(anchor).length - 1;
    if (marked) {
      if (occurrences !== (anchor === replacement ? expected : 0) || (replacement && !["null", "void 0"].includes(replacement) && source.split(replacement).length - 1 !== expected))
        throw new Error(`Invalid UI cleanup replacement: ${anchor.slice(0, 80)}`);
      return;
    }
    if (occurrences !== expected) throw new Error(`Pinned UI cleanup anchor changed: ${anchor.slice(0, 80)}`);
    let pos = start;
    for (let i = 0; i < expected; i++) {
      pos = text.indexOf(anchor, pos);
      edits.push({ start: pos, end: pos + anchor.length, replacement });
      pos += anchor.length;
    }
  }
  if (relativePath === COMPOSER_ASSET) {
    const placeholder = requireFunction("mPi");
    if (marked) {
      if (placeholder.body.getText(file) !== '{return "^•⩊•^";}') throw new Error("Invalid cleaned composer placeholder.");
    } else {
      const source = placeholder.body.getText(file);
      if (!source.includes("composer.placeholder.localFollowUp.locally") || !source.includes("if(u!=null)return u")) throw new Error("Pinned placeholder variants changed.");
      edits.push({start:placeholder.body.getStart(file),end:placeholder.body.end,replacement:'{return "^•⩊•^";}'});
    }
    const retired = [["aOa","plan-mode"],["uDa","goal"],["YDa","model"],["sDa","fork"],["vDa","init"],["hOa","reasoning"],["FEa","review-mode"],["HEa","review-mode"]];
    for (const [name,id] of retired) {
      if(marked){if(functions.has(name))throw new Error("Removed UI registration restored: "+name);continue}
      const node=requireFunction(name),source=node.getText(file);
      if(!source.includes('id:\x60'+id+'\x60') || !source.includes("J3(")) throw new Error("Pinned action registration changed: "+name);
      edits.push({start:node.getStart(file),end:node.end,replacement:""});
    }
    for(const [name,body] of [["oOa",'{return e.mode==="default"}'],["sOa",'{return e.mode===\x60plan\x60}'],["dDa",'{return e.mode==="default"}']]){
      if(marked){if(functions.has(name))throw new Error("Removed UI action helper restored: "+name);continue}
      const node=requireFunction(name);if(node.body.getText(file)!==body)throw new Error("Pinned action helper changed: "+name);
      edits.push({start:node.getStart(file),end:node.end,replacement:""});
    }
    // Resolve the native JSX mounts structurally so unrelated toolbar and review services survive.
    const expected = new Map(retired.map(([name])=>[name,name==="HEa"?3:1]));
    const mounts=new Map();
    function visit(node){
      if(ts.isFunctionDeclaration(node)&&retired.some(([name])=>name===node.name?.text))return;
      if(ts.isCallExpression(node)&&node.arguments[0]&&ts.isIdentifier(node.arguments[0])&&expected.has(node.arguments[0].text)){
        const name=node.arguments[0].text,call=node.expression.getText(file);
        if(!/\.jsx\)$/.test(call))throw new Error("Pinned retired component mount changed: "+name);
        mounts.set(name,(mounts.get(name)||0)+1);
        edits.push({start:node.getStart(file),end:node.end,replacement:"null"});return;
      }
      ts.forEachChild(node,visit);
    }
    visit(file);
    for(const [name,count]of expected)if((mounts.get(name)||0)!==(marked?0:count))throw new Error("Pinned retired mount count changed: "+name);
    replace(null,"onEnablePlanMode:d,onOpenGoalEditor:f,","");
    replace(null,"t[86]!==P||t[87]!==d||t[88]!==z","t[86]!==P||t[88]!==z");
    replace(null,"t[86]=P,t[87]=d,t[88]=z","t[86]=P,t[88]=z");
    replace(null,"t[92]!==P||t[93]!==O||t[94]!==f||t[95]!==ze","t[92]!==P||t[93]!==O||t[95]!==ze");
    replace(null,"t[92]=P,t[93]=O,t[94]=f,t[95]=ze","t[92]=P,t[93]=O,t[95]=ze");
    replace(null,"onEnablePlanMode:rc,onOpenGoalEditor:jee,","");
    replace(null,"jee=Jm(()=>{Gi(\x60pendingThreadGoalObjective\x60,\x60\x60),Pa()}),","");
    replace(requireFunction("mDa"),",pDa=e=>e.replace(/^go+(?=a?l?$)/i,\x60go\x60)","");
    replace(null,"var fDa,pDa;","var fDa;");
    replace(requireFunction("dZi"),"\x60command:goal\x60,\x60command:plan-mode\x60,","");
  } else {
    replace(null,"LeftIcon:Dt,rightIconAsset","LeftIcon:azraelApproveIcon,rightIconAsset");
    replace(null,"LeftIcon:bt,","LeftIcon:azraelFullAccessIcon,");
    replace(null,"f=d?\x60warning\x60:\x60tertiary\x60,p=d?gn:\x60text-tertiary\x60","f=\x60tertiary\x60,p=\x60text-tertiary\x60");
    replace(null,"leftIconClassName:l(\x60icon-sm\x60,Tn)","leftIconClassName:l(\x60icon-sm\x60)");
    replace(null,"rightIconClassName:l(\x60icon-xs\x60,Tn)","rightIconClassName:l(\x60icon-xs\x60)");
    replace(null,"let s=i.kind===\x60agent-mode\x60&&i.agentMode===\x60full-access\x60?gn:\x60text-codex-description\x60","let s=\x60text-codex-description\x60");
    replace(null,"className:Tn,children:!vt||q","className:\x60text-codex-description\x60,children:!vt||q");
    replace(null,"className:Tn,children:(0,$.jsx)(a,{id:\x60composer.permissionsDropdown.fullAccess.optionLabel\x60","className:\x60text-default\x60,children:(0,$.jsx)(a,{id:\x60composer.permissionsDropdown.fullAccess.optionLabel\x60");
    replace(requireFunction("on"),"let d=u,f=c.kind===\x60agent-mode\x60&&c.agentMode===\x60full-access\x60","let d=c.kind===\x60agent-mode\x60&&c.agentMode===\x60full-access\x60?azraelFullAccessIcon:u,f=c.kind===\x60agent-mode\x60&&c.agentMode===\x60full-access\x60");
    // Native custom permission profiles use a shared menu row as well.
    replace(requireFunction("on"),"if(f){p=gn;","if(f){p=\x60text-default\x60;");
    replace(requireFunction("on"),"l(\x60icon-sm\x60,gn)","l(\x60icon-sm\x60)");
    replace(requireFunction("on"),"l(\x60icon-xs\x60,gn)","l(\x60icon-xs\x60)");
  }

  if(marked){if(text.split(MARKER).length!==2)throw new Error("Duplicate UI cleanup marker.");return {text,count:0}}
  edits.sort((a,b)=>b.start-a.start);
  let previous=text.length;
  for(const edit of edits){if(edit.end>previous)throw new Error("Overlapping UI cleanup edits: "+text.slice(edit.start,edit.end)+" at "+edit.start+".."+edit.end+" previous "+previous);previous=edit.start;text=text.slice(0,edit.start)+edit.replacement+text.slice(edit.end)}
  if(relativePath===PERMISSIONS_ASSET){
    text+='\nfunction azraelApproveIcon(e){return (0,$.jsx)(\x60span\x60,{style:{display:\x60inline-flex\x60,color:\x60color-mix(in srgb, var(--blue-300) 55%, var(--color-token-description-foreground))\x60},children:(0,$.jsx)(Dt,e)})}\nfunction azraelFullAccessIcon(e){return (0,$.jsx)(\x60span\x60,{style:{display:\x60inline-flex\x60,color:\x60color-mix(in srgb, var(--orange-300) 55%, var(--color-token-description-foreground))\x60},children:(0,$.jsx)(bt,e)})}';
  }
  text=MARKER+text;parse(text,ts);return {text,count:1};
}
module.exports={UI_CLEANUP_ASSETS,COMPOSER_ASSET,PERMISSIONS_ASSET,MARKER,injectUiCleanup};

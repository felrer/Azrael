"use strict";

const COMPOSER_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const PERMISSIONS_ASSET = "webview/assets/permissions-mode-dropdown-66a2c48ceb22.js";
const FAST_MODE_BANNER_ASSET = "webview/assets/home-announcement-state-89426c353877.js";
const TURN_DIFF_ASSET = "webview/assets/sites-end-resource-90d3046b3014.js";
const UI_CLEANUP_ASSETS = [COMPOSER_ASSET, PERMISSIONS_ASSET, FAST_MODE_BANNER_ASSET, TURN_DIFF_ASSET];
const TURN_DIFF_HEADER = 'function azraelTurnDiffHeader({title,linesAdded,linesRemoved,onOpen,single}){return (0,Q.jsxs)(`div`,{className:`group/turn-diff-header relative`,children:[single?(0,Q.jsx)(QE,{onClick:onOpen}):null,(0,Q.jsx)(ca,{padding:`compact`,className:`pointer-events-none relative z-10`,icon:(0,Q.jsx)(`span`,{className:`flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-secondary/92 text-secondary`,children:(0,Q.jsx)(da,{"aria-hidden":!0,asset:Vg,className:`size-4`})}),title:(0,Q.jsxs)(`span`,{className:`inline-flex max-w-full items-center gap-2`,children:[(0,Q.jsx)(`span`,{className:`min-w-0 truncate`,children:title}),(0,Q.jsx)($t,{className:`shrink-0 text-size-chat-sm`,linesAdded,linesRemoved})]})})]})}';
const MARKER = "/*azrael-ui-cleanup-v1*/";
const COMPOSER_EMOTICONS = ["[•ᴗ•]", "( ˘ᵕ˘)b", "ʕᵔᴥᵔʔ", "ʕっ•ᴥ•ʔっ🍯", "^•ᴗ•^", "(づ｡◕‿‿◕｡)づ", "(｡•̀ᴗ-)✧"];
// Persist only a presentation choice; native draft and conversation state stay native.
const PLACEHOLDER_BODY = `{const faces=${JSON.stringify(COMPOSER_EMOTICONS)},key="azrael-composer-emoticon-v1:"+JSON.stringify(e.sessionKey??"new-conversation");mPi.choices??=new Map;let face=mPi.choices.get(key);if(face!=null)return face;try{face=localStorage.getItem(key)}catch{}if(!faces.includes(face)){face=faces[Math.floor(Math.random()*faces.length)];try{localStorage.setItem(key,face)}catch{}}mPi.choices.set(key,face);return face;}`;

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
  if (relativePath === TURN_DIFF_ASSET) {
    const owner = requireFunction("JE"), source = owner.getText(file);
    const start = source.indexOf("let xe=be,Se;"), end = source.indexOf("let Me;", start);
    if (marked) {
      if (!source.includes("je=azraelTurnDiffHeader({title:ie,linesAdded:z,linesRemoved:B,onOpen:()=>ge(W?.path),single:!ce});")) throw new Error("Compact turn diff header changed.");
      if (requireFunction("azraelTurnDiffHeader").getText(file) !== TURN_DIFF_HEADER) throw new Error("Compact turn diff renderer changed.");
    } else {
      if (start < 0 || end < start || !source.slice(start,end).includes("codex.unifiedDiff.revertChangesTooltip")) throw new Error("Pinned turn diff header changed.");
      replace(owner, source.slice(start,end), "let xe=be,je=azraelTurnDiffHeader({title:ie,linesAdded:z,linesRemoved:B,onOpen:()=>ge(W?.path),single:!ce});");
    }
    for (const name of ["eD", "tD"]) replace(requireFunction(name), "flex h-9 w-full cursor-interaction", "flex h-8 w-full cursor-interaction");
  } else if (relativePath === FAST_MODE_BANNER_ASSET) {
    // Disable the recommendation and its estimate query through native eligibility.
    // Manual service-tier selection remains owned by the model picker.
    replace(requireFunction("Ht"), "S=i?.fast===!0&&x!=null&&!f&&m.selectedServiceTier==null&&!m.isLoading", "S=!1");
  } else if (relativePath === COMPOSER_ASSET) {
    const placeholder = requireFunction("mPi");
    if (marked) {
      if (placeholder.body.getText(file) !== PLACEHOLDER_BODY) throw new Error("Invalid cleaned composer placeholder.");
    } else {
      const source = placeholder.body.getText(file);
      if (!source.includes("composer.placeholder.localFollowUp.locally") || !source.includes("if(u!=null)return u")) throw new Error("Pinned placeholder variants changed.");
      edits.push({start:placeholder.getStart(file),end:placeholder.end,replacement:'function mPi(e)'+PLACEHOLDER_BODY});
    }
    replace(requireFunction("bFa"), "Mc=mPi({intl:kn,", "Mc=mPi({sessionKey:[Jr,g_(he.value)],intl:kn,");
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
  if(relativePath===TURN_DIFF_ASSET) text+='\n'+TURN_DIFF_HEADER;
  text=MARKER+text;parse(text,ts);return {text,count:1};
}
module.exports={UI_CLEANUP_ASSETS,COMPOSER_ASSET,PERMISSIONS_ASSET,TURN_DIFF_ASSET,MARKER,COMPOSER_EMOTICONS,injectUiCleanup};

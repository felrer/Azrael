"use strict";

const CAPACITY_RETRY_ASSET = "webview/assets/app-initial-c014f9ee4429.js";
const CAPACITY_RETRY_MARKER = "/*azrael-capacity-retry-stop-v1*/";

// Uses the pinned native admission, retry, timer and button dependencies.
function capacityRetryControls(e) {
  const { conversationId:n, hostId:r, retryDelaySeconds:i, turnId:turn } = e;
  const a=ta(Q), o=J(kg,`2899820207`), s=J(EKe,n), {activeMode:c}=Tme(n);
  const locale=le().locale;
  const key=JSON.stringify([r,n,turn]);
  const stopped=globalThis.__azraelCapacityRetryStops??=new Set();
  const [u]=u7.useState(()=>Date.now()+(i??0)*1000);
  const [d,f]=u7.useState(i), [p,m]=u7.useState(false);
  const [cancelled,setCancelled]=u7.useState(()=>stopped.has(key));
  const submitted=u7.useRef(false);
  const h=o&&d!=null&&!p&&!cancelled&&!stopped.has(key)&&s?.role===`owner`;
  const retry=trigger=>{
    if(trigger===`capacity_retry_automatic`&&stopped.has(key))return;
    if(a.get(fs,{hostId:r,threadId:n})!==`ready`||submitted.current||!SDe(n))return;
    submitted.current=true;m(true);
    COe(a,r,n,{turnTrigger:trigger,collaborationMode:c}).catch(()=>{
      f(null);submitted.current=false;m(false);
    }).finally(()=>ZTe(n));
  };
  pMn(()=>{
    if(stopped.has(key)||submitted.current)return;
    const remaining=Math.max(0,Math.ceil((u-Date.now())/1000));
    if(remaining===0){retry(`capacity_retry_automatic`);return;}
    f(remaining);
  },h?1000:null);
  return d7.jsxs(`div`,{className:`flex flex-wrap items-center gap-2`,children:[
    d7.jsx(mNi,{disabled:p,secondsRemaining:h?d:null,totalSeconds:i,onClick:()=>retry(`capacity_retry_manual`)}),
    h?d7.jsx(Ou,{type:`button`,color:`outline`,onClick:()=>{
      stopped.add(key);setCancelled(true);f(null);
    },"data-azrael-capacity-stop":true,children:locale?.startsWith(`ko`)?`재시도 중단`:`Stop retrying`}):null
  ]});
}

function injectCapacityRetryStop(text,asset) {
  if(asset!==CAPACITY_RETRY_ASSET)return {text,count:0};
  const markers=text.split(CAPACITY_RETRY_MARKER).length-1;
  if(markers>1)throw Error("Duplicate capacity retry stop marker");
  const original="(0,d7.jsx)(CNi,{conversationId:n,hostId:i,retryDelaySeconds:m},g)";
  const patched="(0,d7.jsx)(CNi,{conversationId:n,hostId:i,retryDelaySeconds:m,turnId:a},g)";
  const replacement=capacityRetryControls.toString().replace("capacityRetryControls", "CNi");
  if(markers===1){
    if(!text.includes(replacement)||text.split(patched).length!==2)throw Error("Damaged capacity retry stop transform");
    return {text,count:0};
  }
  if(text.split(original).length!==2)throw Error("Capacity retry stop card anchor must occur once");
  const start=text.indexOf("function CNi(e){"),end=text.indexOf("function wNi(e){",start);
  if(start<0||end<0||text.indexOf("function CNi(e){",start+1)>=0)throw Error("Capacity retry stop function anchor must occur once");
  const native=text.slice(start,end);
  for(const anchor of ["capacity_retry_automatic","capacity_retry_manual","pMn(v,h?1e3:null)","COe(a,r,n", "SDe(n)"])
    if(!native.includes(anchor))throw Error("Capacity retry native contract changed: "+anchor);
  text=text.slice(0,start)+replacement+text.slice(end);
  text=text.replace(original,patched)+"\n"+CAPACITY_RETRY_MARKER+"\n";
  return {text,count:1};
}
module.exports={CAPACITY_RETRY_ASSET,CAPACITY_RETRY_MARKER,capacityRetryControls,injectCapacityRetryStop};

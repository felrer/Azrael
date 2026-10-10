"use strict";
const CONTEXT_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const SETTINGS_ASSET = "webview/assets/personalization-settings-8b2df7633ad3.js";
const { MARKER, runProviderContext } = require("./provider-context-labels.cjs");
function once(text, from, to) {
  if (text.split(from).length !== 2) throw Error("Pinned provider context anchor changed: " + from.slice(0, 100));
  return text.replace(from, to);
}
function policyDescription(p, ko, detail = "full") {
  if (!p) return "";
  const price = p.pricing;
  const tokens = n => n == null ? (ko ? "알 수 없음" : "unknown") : Number(n).toLocaleString();
  const sources = ko ? {provider:"제공자 설정",global:"전역 설정",default:"기본값"} : {provider:"provider setting",global:"global setting",default:"default"};
  const compact = (ko ? "자동 압축: " : "Auto-compaction: ") + tokens(p.autoCompactTokenLimit) + " (" + (sources[p.autoCompactSource]??p.autoCompactSource) + ")";
  const input = (ko ? "입력 토큰" : "Input tokens") + (p.inputTokensEstimated ? (ko ? " (추정)" : " (estimated)") : "") + ": " + tokens(p.inputTokens);
  if (detail === "compaction") return [compact, input].join("\n");
  const pricing = price?.status === "reference" && price.inputTokenThreshold == null ? (ko ? "API 참고: 길이 추가 요금 없음" : "API reference: no length surcharge") : (ko ? {confirmed:"확인됨",reference:"참고", "no-surcharge":"길이 추가 요금 없음",unknown:"알 수 없음"} : {confirmed:"confirmed",reference:"reference","no-surcharge":"no length surcharge",unknown:"unknown"})[price?.status ?? "unknown"];
  return [p.providerId + " / " + p.modelId,
    compact,
    (ko ? "모델 용량: " : "Model capacity: ") + tokens(p.contextWindow),
    (ko ? "안전 한도: " : "Safe cap: ") + tokens(p.safeContextWindow),
    input,
    (ko ? "가격: " : "Pricing: ") + pricing + (price?.inputTokenThreshold == null ? "" : " · " + (price.inclusive ? "≥ " : "> ") + tokens(price.inputTokenThreshold)),
    price?.sourceUrl ?? ""].filter(Boolean).join("\n");
}
function decorateGauge(jsx, node, policy, ko, action = null) {
  if (!node) return node;
  if (!policy) {
    if (!action) return node;
    const span=node.props.children;
    return jsx(node.type,{...node.props,interactive:true,keyboardNavigation:true,tooltipContent:jsx("div",{className:"flex flex-col gap-2",children:[node.props.tooltipContent,action]}),children:jsx(span.type,{...span.props,tabIndex:0})});
  }
  const price = policy.pricing, input = policy.inputTokens;
  const yellow = (price?.status === "confirmed" || price?.status === "reference") && input != null && price.inputTokenThreshold != null && (price.inclusive ? input >= price.inputTokenThreshold : input > price.inputTokenThreshold);
  const tokens = n => n == null ? (ko ? "알 수 없음" : "unknown") : Number(n).toLocaleString(ko ? "ko-KR" : "en-US");
  const usage = limit => {
    const percent = input != null && limit > 0 ? (input / limit * 100).toLocaleString(ko ? "ko-KR" : "en-US", {minimumFractionDigits:1,maximumFractionDigits:1}) + "%" : (ko ? "알 수 없음" : "unknown");
    return tokens(input) + " / " + tokens(limit) + (ko ? " 토큰" : " tokens") + " (" + percent + ")" + (policy.inputTokensEstimated ? (ko ? " · 추정" : " · estimated") : "");
  };
  const rows = [[ko ? "자동 압축 기준" : "Auto-compaction basis", usage(policy.autoCompactTokenLimit)], [ko ? "전체 용량 기준" : "Full capacity basis", usage(policy.contextWindow)]];
  const model = policy.providerId + " / " + policy.modelId;
  const known = price?.status === "confirmed" || price?.status === "reference";
  const pricing = known && price.inputTokenThreshold != null
    ? (price.status === "reference" ? (ko ? "API 장문 요금 기준" : "API long-context pricing threshold") : (ko ? "장문 요금 기준" : "Long-context pricing threshold")) + ": " + tokens(price.inputTokenThreshold) + (ko ? (price.inclusive ? " 토큰 이상" : " 토큰 초과") : (price.inclusive ? " tokens or more" : " tokens exceeded"))
    : price?.status === "no-surcharge" || known && price.inputTokenThreshold == null
      ? (price?.status === "reference" ? (ko ? "API 참고: 길이 추가 요금 없음" : "API reference: no length surcharge") : (ko ? "길이 추가 요금 없음" : "No length surcharge"))
      : (ko ? "요금 기준 알 수 없음" : "Pricing threshold unknown");
  const description = [ko ? "사용량" : "Usage", ...rows.map(([label,value]) => label + ": " + value), (ko ? "모델: " : "Model: ") + model, (ko ? "요금 참고: " : "Pricing reference: ") + pricing].join("\n");
  const row = (label, value) => jsx("div", {style:{display:"grid",gridTemplateColumns:"max-content minmax(0,1fr)",gap:16,alignItems:"baseline"},children:[jsx("span",{children:label}),jsx("span",{style:{textAlign:"right",fontVariantNumeric:"tabular-nums",overflowWrap:"anywhere"},children:value})]});
  const tooltip = jsx("div", {style:{display:"flex",flexDirection:"column",gap:10,textAlign:"left",maxWidth:"min(440px, calc(100vw - 32px))",whiteSpace:"normal"},children:[
    jsx("div",{style:{display:"flex",flexDirection:"column",gap:4},children:[jsx("strong",{children:ko?"사용량":"Usage"}),...rows.map(([label,value])=>row(label,value))]}),
    row(ko?"모델":"Model",model),
    jsx("div",{style:{display:"flex",flexDirection:"column",gap:4},children:[jsx("strong",{children:ko?"요금 참고":"Pricing reference"}),jsx("span",{children:pricing}),price?.sourceUrl ? jsx("a",{href:price.sourceUrl,target:"_blank",rel:"noopener noreferrer",style:{color:"var(--vscode-textLink-foreground)",width:"fit-content"},children:ko?"공식 문서 ↗":"Official documentation ↗"}) : null]}),
    action
  ]});
  const span = node.props.children;
  const css = "[data-azrael-pricing-boundary=true]{color:light-dark(#88732b,#c2ac65)!important}[data-azrael-pricing-boundary=true] svg circle{stroke:currentColor}.vscode-light [data-azrael-pricing-boundary=true]{color:#88732b!important}.vscode-dark [data-azrael-pricing-boundary=true],.dark [data-azrael-pricing-boundary=true]{color:#c2ac65!important}.vscode-high-contrast [data-azrael-pricing-boundary=true]{color:#e8d58a!important}.vscode-high-contrast-light [data-azrael-pricing-boundary=true]{color:#62500d!important}@media(forced-colors:active){[data-azrael-pricing-boundary=true]{color:CanvasText!important;outline:1px solid CanvasText}}";
  return jsx(node.type, {...node.props, interactive:true, keyboardNavigation:true, tooltipContent:tooltip, children:jsx(span.type, {...span.props,
    tabIndex:0,
    "aria-label":description + (yellow ? "\n" + (price.status === "reference" ? (ko ? "API 참고: 장기 컨텍스트 요금 구간" : "API reference: long-context pricing tier") : (ko ? "장기 컨텍스트 요금 구간" : "Long-context pricing tier")) : ""),
    "data-azrael-pricing-boundary":yellow ? "true" : "false",
    children:[jsx("style",{children:css}),span.props.children]})});
}
function renderCompactionAction(React, jsx, Button, store, conversationId, ko, entries, compact) {
  const [, update] = React.useState(0);
  React.useEffect(() => {
    if (conversationId == null) return;
    let entry = entries.get(conversationId);
    if (!entry) entries.set(conversationId, entry = {status:"idle", listeners:new Set()});
    const notify = () => update(n => n + 1);
    entry.listeners.add(notify);
    return () => { entry.listeners.delete(notify); if (!entry.listeners.size && entry.status !== "pending") entries.delete(conversationId); };
  }, [conversationId, entries]);
  const entry = entries.get(conversationId), pending = entry?.status === "pending";
  const status = pending ? (ko ? "압축 요청 중…" : "Requesting compaction…") : entry?.status === "requested" ? (ko ? "압축 요청됨" : "Compaction requested") : entry?.status === "error" ? (ko ? "압축 요청 실패. 다시 시도하세요." : "Compaction request failed. Try again.") : conversationId == null ? (ko ? "대화를 선택하세요." : "Select a chat.") : "";
  const onClick = async event => {
    event.preventDefault();
    event.stopPropagation();
    if (conversationId == null) return;
    let current = entries.get(conversationId);
    if (!current) entries.set(conversationId, current = {status:"idle", listeners:new Set()});
    if (current.status === "pending") return;
    const notify = () => { for (const listener of current.listeners) listener(); };
    current.status = "pending"; notify();
    try { await compact(store, conversationId); current.status = "requested"; }
    catch { current.status = "error"; }
    finally { notify(); if (!current.listeners.size) entries.delete(conversationId); }
  };
  return jsx("div", {className:"flex flex-col gap-2", "data-azrael-context-compaction":conversationId ?? "", children:[
    jsx(Button, {type:"button",color:"secondary",size:"compact",disabled:conversationId == null || pending,onClick,children:pending ? (ko?"요청 중…":"Requesting…") : entry?.status === "error" ? (ko?"압축 다시 시도":"Retry compaction") : (ko?"컨텍스트 압축":"Compact context")}),
    jsx("span", {role:entry?.status === "error" ? "alert" : "status","aria-live":"polite",className:"text-xs text-token-description-foreground",children:status})
  ]});
}
async function savePolicy(client, id, value) {
  if (value !== "" && !/^[1-9]\d*$/.test(value)) throw Error("Enter a positive integer percentage");
  const number = value === "" ? null : Number(value);
  if (number != null && !Number.isSafeInteger(number)) throw Error("Percentage exceeds the supported integer range");
  await client.sendRequest("config/batchWrite", {edits:[{keyPath:"provider_auto_compact." + JSON.stringify(id),value:number == null ? {} : {percentage:number},mergeStrategy:"replace"}],filePath:null,expectedVersion:null,reloadUserConfig:true});
  return client.sendRequest("config/read", {includeLayers:true,cwd:null});
}
function compactionPreview(policy, override, draft) {
  const base = policy.autoCompactBaseTokens ?? policy.contextWindow;
  const defaultTokens = policy.providerId === "anthropic" ? 400000 : null;
  const defaultPercentage = defaultTokens != null && base > 0 ? Math.max(1, Math.round(defaultTokens * 100 / base)) : 95;
  const isTokenDefault = defaultTokens != null && draft == null && override?.percentage == null && override?.token_limit == null;
  const percentage = draft ?? String(override?.percentage ?? (override?.token_limit != null && base > 0 ? Math.max(1, Math.round(override.token_limit * 100 / base)) : defaultPercentage));
  const valid = /^[1-9]\d*$/.test(percentage) && Number.isSafeInteger(Number(percentage));
  const requested = isTokenDefault ? defaultTokens : valid && base > 0 ? Math.max(1, Math.floor(base * (Number(percentage) / 100))) : null;
  const effective = requested == null ? null : policy.safeContextWindow == null ? requested : Math.min(requested, policy.safeContextWindow);
  const max = base > 0 && policy.safeContextWindow != null ? Math.max(1, Math.floor(policy.safeContextWindow * 100 / base)) : 100;
  return {base,percentage,requested,effective,max,isTokenDefault};
}
function renderSettings(React, jsx, client, ko) {
  const [data, setData] = React.useState(null), [error, setError] = React.useState(""), [pending, setPending] = React.useState(false), [drafts, setDrafts] = React.useState({});
  React.useEffect(() => {let live=true;setData(null);setDrafts({});setError("");client.sendRequest("config/read",{includeLayers:true,cwd:null}).then(x=>{if(live)setData(x)},e=>{if(live)setError((ko?"설정을 불러오지 못했습니다: ":"Unable to load settings: ")+String(e.message??e))});return()=>{live=false}},[client]);
  const groups = new Map();
  for (const p of data?.contextPolicies ?? []) {if (!groups.has(p.providerId)) groups.set(p.providerId, []);groups.get(p.providerId).push(p)}
  const action = async (id, value) => {setPending(true);setError("");try {setData(await savePolicy(client,id,value));setDrafts(previous=>{const next={...previous};delete next[id];return next})}catch(e){setError(ko?(e.message==="Enter a positive integer percentage"?"양의 정수 백분율을 입력하세요":e.message==="Percentage exceeds the supported integer range"?"백분율이 지원되는 정수 범위를 초과합니다":"설정을 저장하지 못했습니다: "+String(e.message??e)):String(e.message??e))}finally{setPending(false)}};
  const tokens = n => n == null ? (ko?"알 수 없음":"unknown") : n.toLocaleString();
  const controlStyle = {padding:"6px 8px",maxWidth:"100%",width:240,border:"1px solid var(--vscode-input-border, #888)",borderRadius:4,background:"var(--vscode-input-background)",color:"var(--vscode-input-foreground)"};
  const buttonStyle = {padding:"6px 12px",alignSelf:"flex-start",borderRadius:4,background:"var(--vscode-button-background, #305f9b)",color:"var(--vscode-button-foreground, white)"};
  return jsx("section", {"data-azrael-provider-context":true,className:"flex flex-col gap-3",children:[
    jsx("h2",{children:ko?"제공자 자동 압축":"Provider auto-compaction"}),
    jsx("p",{children:ko?"기본값: Anthropic은 400,000토큰, 그 외 제공자는 길이 추가 요금 없는 기본 용량의 95%이며 안전 한도 이하로 제한됩니다. 변경 사항은 기존 대화의 다음 턴에 적용되며 진행 중인 턴은 바뀌지 않습니다.":"Default: 400,000 tokens for Anthropic; 95% of the no-length-surcharge base for other providers, capped at the safe limit. Changes apply to the next turn in existing chats; the active turn stays unchanged."}),
    jsx("style",{children:"[data-azrael-compaction-slider]{appearance:auto!important;-webkit-appearance:auto!important;height:24px;cursor:pointer;accent-color:var(--vscode-button-background,#305f9b)}[data-azrael-compaction-slider]::-webkit-slider-thumb{appearance:auto!important;-webkit-appearance:auto!important}[data-azrael-compaction-slider]::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--vscode-button-background,#305f9b)}"}),
    error?jsx("p",{role:"alert",children:error}):null,
    ...Array.from(groups,([id, policies])=>{
      const p=policies.find(p=>p.modelId===data.config?.model)??policies[0];
      const override=data.config?.provider_auto_compact?.[id], preview=compactionPreview(p,override,drafts[id]);
      const update=e=>setDrafts(previous=>({...previous,[id]:e.target.value}));
      const fallback=p.autoCompactBaseTokens == null || p.pricing?.status==="unknown" || p.pricing?.status==="no-surcharge" || p.pricing?.inputTokenThreshold==null;
      return jsx("form",{key:id,style:{display:"flex",flexDirection:"column",gap:8,padding:12,border:"1px solid var(--vscode-widget-border, #8886)",borderRadius:8},onSubmit:e=>{e.preventDefault();return action(id,preview.percentage)},children:[
        jsx("h3",{style:{fontWeight:600},children:({openai:"OpenAI",devin:"Devin",anthropic:"Anthropic",google:"Google AI Studio",xai:"xAI",openrouter:"OpenRouter","google-antigravity":"Google Antigravity"})[id]??id}),
        jsx("p",{children:(ko?"미리보기 모델: ":"Preview model: ")+p.modelId}),
        jsx("label",{children:[ko?"자동 압축 백분율 (%)":"Auto-compaction percentage (%)",jsx("input",{style:controlStyle,name:"percentage",type:"text",inputMode:"numeric",pattern:"[1-9][0-9]*",required:true,value:preview.percentage,onChange:update,disabled:pending})]}),
        jsx("label",{children:[(ko?"안전 범위 슬라이더: 1–":"Safe range slider: 1–")+preview.max+"%",jsx("input",{"data-azrael-compaction-slider":true,"aria-label":ko?"자동 압축 백분율 슬라이더":"Auto-compaction percentage slider",type:"range",min:1,max:preview.max,step:1,value:Math.min(preview.max,Math.max(1,Number(preview.percentage)||1)),onChange:update,disabled:pending,style:{display:"block",width:"100%"}})]}),
        jsx("p",{children:(ko?"기본 용량: ":"Base capacity: ")+tokens(preview.base)+(fallback?(ko?" 토큰. 추가 요금 경계가 없거나 알 수 없어 모델 용량을 사용합니다. 가격 상태를 확인하세요.":" tokens. Using model capacity because there is no known length-surcharge boundary; check pricing status."):(ko?" 토큰 (길이 추가 요금 없는 용량).":" tokens (no-length-surcharge capacity)."))}),
        jsx("p",{"aria-live":"polite","data-azrael-compaction-preview":true,children:(ko?"요청: ":"Requested: ")+(preview.isTokenDefault?(ko?"기본값 = ":"default = "):preview.percentage+"% = ")+tokens(preview.requested)+(ko?" 토큰; 적용: ":" tokens; effective: ")+tokens(preview.effective)+(ko?" 토큰; 안전 한도: ":" tokens; safe cap: ")+tokens(p.safeContextWindow)+(preview.requested>preview.effective?(ko?" (안전 한도로 제한됨)":" (capped ot safe limit)"):"")}),
        override?.token_limit!=null&&override.percentage==null?jsx("p",{children:(ko?"기존 토큰 한도 ":"Legacy token limit ")+tokens(override.token_limit)+(ko?"이 저장되어 있습니다. 저장을 누르면 표시된 백분율로 변경됩니다.":" remains stored until Save replaces it with the displayed percentage.")}):null,
        jsx("div",{style:{display:"flex",gap:8,alignItems:"center"},children:[
          jsx("button",{style:buttonStyle,type:"submit",disabled:pending,children:ko?"저장":"Save"}),
          jsx("button",{style:buttonStyle,type:"button",disabled:pending,onClick:()=>action(id,""),children:ko?"기본값으로 재설정":"Reset to default"})
        ]}),
        jsx("p",{style:{whiteSpace:"pre-line"},children:policyDescription(p,ko,"compaction")})
      ]});
    })]});
}
function injectProviderContextControls(text, asset) {
  let count = 0;
  if (asset === CONTEXT_ASSET) {
    text=once(text,"function aCa(e){","function __azraelNativeContextUsage(e){");
    text=once(text,"function XSa(e){","function __azraelNativeContextGauge(e){");
    text=once(text,"function cwa(e){let t=(0,E7.c)(41)","function cwa(e){let t=(0,E7.c)(42)");
    text=once(text,"t[22]!==y||t[23]!==H?", "t[22]!==y||t[23]!==H||t[41]!==h?");
    text=once(text,"(XSa,{contextUsage:y})", "(XSa,{contextUsage:y,conversationId:h})");
    text=once(text,"t[22]=y,t[23]=H,t[24]=W)", "t[22]=y,t[23]=H,t[24]=W,t[41]=h)");
    text += `\n${policyDescription.toString()}\n${decorateGauge.toString()}\n${renderCompactionAction.toString()}\nconst __azraelCompactionEntries=new Map();\nfunction aCa(e){return {...__azraelNativeContextUsage(e),contextPolicy:e?.contextPolicy??null}}\nfunction XSa(e){gw();_A();const ko=st().locale?.startsWith('ko'),store=Ou($),action=renderCompactionAction(wd(),y7.jsx,mw,store,e.conversationId,ko,__azraelCompactionEntries,(store,id)=>Px(store,store.get(hA,id)).compactThread(id));return decorateGauge(y7.jsx,__azraelNativeContextGauge(e),e.contextUsage.contextPolicy,ko,action)}\n`;
    count++;
  } else if (asset === SETTINGS_ASSET) {
    // Include host identity in the parent cache even when hidden instructions leave s null.
    text=once(text,"function Tr(){let e=(0,Ar.c)(10)","function Tr(){let e=(0,Ar.c)(11)");
    text=once(text,"e[8]===s?l=e[9]", "e[8]===s&&e[10]===r?l=e[9]");
    text=once(text,"e[8]=s,e[9]=l),l}", "e[8]=s,e[9]=l,e[10]=r),l}");
    text=once(text,"children:[a,o,null,s,c]", "children:[a,o,null,s,c,(0,$.jsx)(__AzraelContextSettings,{hostId:r})]");
    text += `\n${policyDescription.toString()}\n${savePolicy.toString()}\n${compactionPreview.toString()}\n${renderSettings.toString()}\nfunction __AzraelContextSettings({hostId}){let scope=ee(vt),client=He(scope,hostId),intl=i();return renderSettings(jr,$.jsx,client,intl.locale?.startsWith('ko'))}\n`;
    count++;
  }
  return {text,count};
}
function injectProviderContext(text, asset) {
  return runProviderContext(text, asset, injectProviderContextControls);
}
module.exports={CONTEXT_ASSET,SETTINGS_ASSET,MARKER,injectProviderContext,injectProviderContextControls,policyDescription,decorateGauge,renderCompactionAction,savePolicy};

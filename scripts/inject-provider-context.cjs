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
  const sources = ko ? {model:"모델 설정",provider:"제공자 설정",global:"전역 설정",default:"기본값"} : {model:"model setting",provider:"provider setting",global:"global setting",default:"default"};
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
async function savePolicy(client, id, modelId, value) {
  if (value !== "" && !/^[1-9]\d*$/.test(value)) throw Error("Enter a positive integer percentage");
  const number = value === "" ? null : Number(value);
  if (number != null && !Number.isSafeInteger(number)) throw Error("Percentage exceeds the supported integer range");
  await client.sendRequest("config/batchWrite", {edits:[{keyPath:"provider_auto_compact." + JSON.stringify(id) + ".models." + JSON.stringify(modelId),value:number == null ? {} : {percentage:number},mergeStrategy:"replace"}],filePath:null,expectedVersion:null,reloadUserConfig:true});
  return client.sendRequest("config/read", {includeLayers:true,cwd:null});
}
function compactionPreview(policy, override, draft) {
  const base = policy.autoCompactBaseTokens ?? policy.contextWindow;
  const defaultTokens = policy.providerId === "anthropic" && policy.contextWindow >= 1000000 ? 600000 : null;
  const defaultPercentage = defaultTokens != null && base > 0 ? Math.max(1, Math.round(defaultTokens * 100 / base)) : 95;
  const isTokenDefault = defaultTokens != null && draft == null && override?.percentage == null && override?.token_limit == null;
  const percentage = draft ?? String(override?.percentage ?? (override?.token_limit != null && base > 0 ? Math.max(1, Math.round(override.token_limit * 100 / base)) : defaultPercentage));
  const valid = /^[1-9]\d*$/.test(percentage) && Number.isSafeInteger(Number(percentage));
  const requested = draft == null && override?.percentage == null && override?.token_limit != null ? override.token_limit : isTokenDefault ? defaultTokens : valid && base > 0 ? Math.max(1, Math.floor(base * (Number(percentage) / 100))) : null;
  const effective = requested == null ? null : policy.safeContextWindow == null ? requested : Math.min(requested, policy.safeContextWindow);
  const max = base > 0 && policy.safeContextWindow != null ? Math.max(1, Math.floor(policy.safeContextWindow * 100 / base)) : 100;
  return {base,percentage,requested,effective,max,isTokenDefault};
}
function renderSettings(React, jsx, client, ko, native) {
  const [data, setData] = React.useState(null), [error, setError] = React.useState(""), [pending, setPending] = React.useState(false), [drafts, setDrafts] = React.useState({});
  const [selection, setSelection] = React.useState({}), [notice, setNotice] = React.useState("");
  const generation = React.useRef(0);
  React.useEffect(() => {
    const version = ++generation.current;
    setData(null);setDrafts({});setSelection({});setError("");setNotice("");setPending(false);
    client.sendRequest("config/read",{includeLayers:true,cwd:null}).then(x=>{if(generation.current===version)setData(x)},e=>{if(generation.current===version)setError((ko?"설정을 불러오지 못했습니다: ":"Unable to load settings: ")+String(e.message??e))});
    return()=>{generation.current++};
  },[client]);
  const {Button, Card, Row} = native;
  const groups = new Map();
  for (const p of data?.contextPolicies ?? []) {if (!groups.has(p.providerId)) groups.set(p.providerId, []);if(!groups.get(p.providerId).some(x=>x.modelId===p.modelId))groups.get(p.providerId).push(p)}
  const provider = groups.has(selection.provider) ? selection.provider : (data?.contextPolicies?.find(p=>p.modelId===data.config?.model)?.providerId ?? groups.keys().next().value);
  const policies = groups.get(provider) ?? [];
  const p = policies.find(p=>p.modelId===selection[provider]) ?? policies.find(p=>p.modelId===data.config?.model) ?? policies[0];
  const key = p ? JSON.stringify([provider,p.modelId]) : "";
  const providerEntry = data?.config?.provider_auto_compact?.[provider];
  const modelEntry = providerEntry?.models?.[p?.modelId];
  const providerOverride = providerEntry && (providerEntry.percentage != null || providerEntry.token_limit != null || Object.keys(providerEntry.models ?? {}).length===0) ? providerEntry : undefined;
  const override = modelEntry ?? providerOverride ?? (data?.config?.model_auto_compact_token_limit != null ? {token_limit:data.config.model_auto_compact_token_limit} : undefined);
  const preview = p ? compactionPreview(p,override,drafts[key]) : null;
  const action = async value => {
    if(pending || !p)return;
    const version = generation.current, id=provider, model=p.modelId, savedKey=key;
    setPending(true);setError("");setNotice("");
    try {
      const next = await savePolicy(client,id,model,value);
      if(generation.current!==version)return;
      setData(next);setDrafts(previous=>{const next={...previous};delete next[savedKey];return next});setNotice("saved");
    }catch(e){if(generation.current===version)setError(ko?(e.message==="Enter a positive integer percentage"?"양의 정수 백분율을 입력하세요":e.message==="Percentage exceeds the supported integer range"?"백분율이 지원되는 정수 범위를 초과합니다":"설정을 저장하지 못했습니다: "+String(e.message??e)):String(e.message??e))}
    finally{if(generation.current===version)setPending(false)}
  };
  const tokens = n => n == null ? (ko?"알 수 없음":"Unknown") : n.toLocaleString(ko?"ko-KR":"en-US");
  const short = n => n == null ? "—" : n >= 1000000 ? +(n/1000000).toFixed(2)+"M" : n >= 1000 ? +(n/1000).toFixed(1)+"K" : String(n);
  const names = {openai:"OpenAI",devin:"Devin",anthropic:"Anthropic",google:"Google AI Studio",xai:"xAI",openrouter:"OpenRouter","google-antigravity":"Google Antigravity"};
  const update = e => {setDrafts(previous=>({...previous,[key]:e.target.value}));setNotice("")};
  const selectStyle = {maxWidth:"100%",width:"100%",minWidth:0};
  const price = p?.pricing, knownPrice = price?.status==="confirmed" || price?.status==="reference";
  const priceText = knownPrice && price.inputTokenThreshold != null ? (price.inclusive ? "≥ " : "> ")+short(price.inputTokenThreshold)+(price.status==="reference"?(ko?" · API 참고":" · API reference"):"") : price?.status==="no-surcharge" || knownPrice && price.inputTokenThreshold == null ? (ko?"추가 요금 없음":"No surcharge")+(price.status==="reference"?(ko?" · API 참고":" · API reference"):"") : (ko?"알 수 없음":"Unknown");
  const defaultPreview = p ? compactionPreview(p,{},undefined) : null;
  const metric = (label,value,title) => jsx("div",{className:"flex min-w-0 flex-col gap-1",children:[jsx("span",{className:"text-xs text-token-description-foreground",children:label}),jsx("span",{className:"text-sm font-medium",style:{fontVariantNumeric:"tabular-nums",overflowWrap:"anywhere"},title,children:value})]});
  return jsx("section", {"data-azrael-provider-context":true,className:"flex flex-col gap-4",children:[
    jsx("div",{className:"flex flex-col gap-1",children:[jsx("h2",{className:"text-base font-semibold",children:ko?"자동 압축":"Auto-compaction"}),jsx("p",{className:"text-sm text-token-description-foreground",children:ko?"모델별 압축 기준을 설정합니다. 다음 턴부터 적용됩니다.":"Set a threshold for each model. Applies from the next turn."})]}),
    jsx("style",{children:"[data-azrael-provider-context] .azrael-context-control{border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);color:var(--color-token-foreground);padding:8px 12px;font:inherit;line-height:20px}[data-azrael-provider-context] .azrael-context-control:focus-visible{outline:2px solid var(--color-token-foreground);outline-offset:2px}[data-azrael-provider-context] .azrael-context-control:disabled{opacity:.5}[data-azrael-context-metrics]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}[data-azrael-compaction-slider]{appearance:auto!important;-webkit-appearance:auto!important;height:24px;cursor:pointer;accent-color:var(--color-token-foreground)}[data-azrael-compaction-slider]::-webkit-slider-thumb{appearance:auto!important;-webkit-appearance:auto!important}@media(max-width:480px){[data-azrael-context-metrics]{grid-template-columns:1fr;gap:12px}}"}),
    error?jsx("p",{role:"alert",className:"text-sm",children:error}):null,
    data == null && !error ? jsx("p",{role:"status",className:"text-sm text-token-description-foreground",children:ko?"불러오는 중…":"Loading…"}) : null,
    data != null && !p ? jsx("p",{className:"text-sm text-token-description-foreground",children:ko?"사용 가능한 모델이 없습니다.":"No models available."}) : null,
    p ? jsx("form",{"data-azrael-model-policy":p.modelId,onSubmit:e=>{e.preventDefault();return action(preview.isTokenDefault?"":preview.percentage)},className:"flex flex-col gap-4",children:[
      jsx(Card,{children:[
        jsx(Row,{className:"max-sm:flex-col max-sm:items-stretch max-sm:gap-2",label:ko?"제공자":"Provider",control:jsx("select",{"aria-label":ko?"제공자":"Provider",className:"azrael-context-control",style:selectStyle,value:provider,disabled:pending,onChange:e=>{setSelection(previous=>({...previous,provider:e.target.value}));setNotice("");setError("")},children:Array.from(groups.keys(),id=>jsx("option",{key:id,value:id,children:names[id]??id}))}),controlSizing:"grow"}),
        jsx(Row,{className:"max-sm:flex-col max-sm:items-stretch max-sm:gap-2",label:ko?"모델":"Model",control:jsx("select",{"aria-label":ko?"모델":"Model",className:"azrael-context-control",style:selectStyle,value:p.modelId,title:p.modelId,disabled:pending,onChange:e=>{setSelection(previous=>({...previous,[provider]:e.target.value}));setNotice("");setError("")},children:policies.map(p=>jsx("option",{key:p.modelId,value:p.modelId,children:p.modelId.replace(/^managed\/[^/]+\//,"")}))}),controlSizing:"grow"})
      ]}),
      jsx("div",{"data-azrael-context-metrics":true,className:"px-4",children:[metric(ko?"컨텍스트 용량":"Context window",short(p.contextWindow),tokens(p.contextWindow)),metric(ko?"비용 증가 구간":"Price increases at",priceText,price?.inputTokenThreshold == null ? undefined : tokens(price.inputTokenThreshold)),metric(ko?"기본 압축값":"Default threshold",short(defaultPreview.effective),tokens(defaultPreview.effective))]}),
      jsx(Card,{children:[
        jsx(Row,{label:ko?"자동 압축 기준":"Compaction threshold",description:(ko?"기준 용량 ":"Based on ")+short(preview.base)+(ko?" 토큰":" tokens"),control:jsx("div",{className:"flex items-center gap-2",children:[jsx("input",{className:"azrael-context-control","aria-label":ko?"자동 압축 백분율":"Auto-compaction percentage",style:{width:84,textAlign:"right",fontVariantNumeric:"tabular-nums"},name:"percentage",type:"text",inputMode:"numeric",pattern:"[1-9][0-9]*",required:true,value:preview.percentage,onChange:update,disabled:pending}),jsx("span",{className:"text-sm text-token-description-foreground",children:"%"})]})}),
        jsx("div",{className:"flex flex-col gap-2 px-4 py-3",children:[
          jsx("input",{"data-azrael-compaction-slider":true,"aria-label":ko?"자동 압축 백분율 슬라이더":"Auto-compaction percentage slider",type:"range",min:1,max:preview.max,step:1,value:Math.min(preview.max,Math.max(1,Number(preview.percentage)||1)),onChange:update,disabled:pending,style:{width:"100%"}}),
          jsx("div",{className:"flex items-center justify-between gap-3 text-sm",children:[jsx("span",{className:"text-token-description-foreground",children:ko?"적용될 압축값":"Effective threshold"}),jsx("strong",{"aria-live":"polite","data-azrael-compaction-preview":true,style:{fontVariantNumeric:"tabular-nums"},children:tokens(preview.effective)+(ko?" 토큰":" tokens")})]}),
          preview.requested>preview.effective ? jsx("p",{className:"text-xs text-token-description-foreground",children:(ko?"요청값 ":"Requested ")+tokens(preview.requested)+(ko?" · 안전 한도 ":" · Safe limit ")+tokens(p.safeContextWindow)}) : null
        ]})
      ]}),
      jsx("div",{className:"flex flex-wrap items-center justify-between gap-3",children:[
        jsx(Button,{type:"button",color:"secondary",size:"compact",disabled:pending,onClick:()=>action(""),children:ko?"기본값으로 재설정":"Reset to default"}),
        jsx("div",{className:"flex items-center gap-3",children:[jsx("span",{role:"status","aria-live":"polite",className:"text-xs text-token-description-foreground",children:(notice==="saved"?(ko?"저장됨":"Saved"):"") || (drafts[key]!=null?(ko?"저장되지 않음":"Unsaved"):(modelEntry?.percentage!=null||modelEntry?.token_limit!=null?(ko?"모델 설정":"Model setting"):providerOverride?.percentage!=null||providerOverride?.token_limit!=null?(ko?"제공자 설정 사용":"Using provider setting"):override?.token_limit!=null?(ko?"전역 설정 사용":"Using global setting"):(ko?"기본값":"Default")))}),jsx(Button,{type:"submit",color:"primary",size:"compact",disabled:pending,children:pending?(ko?"저장 중…":"Saving…"):(ko?"저장":"Save")})]})
      ]}),
      price?.sourceUrl ? jsx("a",{className:"text-xs text-token-description-foreground",style:{width:"fit-content",textDecoration:"underline"},href:price.sourceUrl,target:"_blank",rel:"noopener noreferrer",children:ko?"공식 요금 안내 ↗":"Official pricing ↗"}) : null
    ]}) : null
  ]});
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
    text += `\n${policyDescription.toString()}\n${decorateGauge.toString()}\n${renderCompactionAction.toString()}\nconst __azraelCompactionEntries=new Map();\nfunction aCa(e){const usage=__azraelNativeContextUsage(e),policy=e?.contextPolicy??null,input=policy?.inputTokens,limit=policy?.autoCompactTokenLimit;const percent=Number.isFinite(input)&&input>=0&&Number.isFinite(limit)&&limit>0?Math.min(input/limit,1)*100:usage.percent;return {...usage,percent,contextPolicy:policy}}\nfunction XSa(e){gw();_A();const ko=st().locale?.startsWith('ko'),store=Ou($),action=renderCompactionAction(wd(),y7.jsx,mw,store,e.conversationId,ko,__azraelCompactionEntries,(store,id)=>Px(store,store.get(hA,id)).compactThread(id));return decorateGauge(y7.jsx,__azraelNativeContextGauge(e),e.contextUsage.contextPolicy,ko,action)}\n`;
    count++;
  } else if (asset === SETTINGS_ASSET) {
    // Include host identity in the parent cache even when hidden instructions leave s null.
    text=once(text,"function Tr(){let e=(0,Ar.c)(10)","function Tr(){let e=(0,Ar.c)(11)");
    text=once(text,"e[8]===s?l=e[9]", "e[8]===s&&e[10]===r?l=e[9]");
    text=once(text,"e[8]=s,e[9]=l),l}", "e[8]=s,e[9]=l,e[10]=r),l}");
    text=once(text,"children:[a,o,null,s,c]", "children:[a,o,null,s,c,(0,$.jsx)(__AzraelContextSettings,{hostId:r})]");
    text += `\n${policyDescription.toString()}\n${savePolicy.toString()}\n${compactionPreview.toString()}\n${renderSettings.toString()}\nfunction __AzraelContextSettings({hostId}){let scope=ee(vt),client=He(scope,hostId),intl=i();j();$e();Kt();return renderSettings(jr,$.jsx,client,intl.locale?.startsWith('ko'),{Button:G,Card:_t,Row:ut})}\n`;
    count++;
  }
  return {text,count};
}
function injectProviderContext(text, asset) {
  return runProviderContext(text, asset, injectProviderContextControls);
}
module.exports={CONTEXT_ASSET,SETTINGS_ASSET,MARKER,injectProviderContext,injectProviderContextControls,policyDescription,decorateGauge,renderCompactionAction,savePolicy,compactionPreview,renderSettings};

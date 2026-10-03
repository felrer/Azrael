"use strict";
const CONTEXT_ASSET = "webview/assets/app-initial-9cbfb5c07b41.js";
const SETTINGS_ASSET = "webview/assets/personalization-settings-22572f5615f8.js";
const MARKER = "/*azrael-provider-context-v2*/";
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
function decorateGauge(jsx, node, policy, ko) {
  if (!node || !policy) return node;
  const price = policy.pricing, input = policy.inputTokens;
  const yellow = (price?.status === "confirmed" || price?.status === "reference") && input != null && price.inputTokenThreshold != null && (price.inclusive ? input >= price.inputTokenThreshold : input > price.inputTokenThreshold);
  const description = policyDescription(policy, ko) + (yellow ? "\n" + (price.status === "reference" ? (ko ? "API 참고: 장기 컨텍스트 요금 구간" : "API reference: long-context pricing tier") : (ko ? "장기 컨텍스트 요금 구간" : "Long-context pricing tier")) : "");
  const span = node.props.children;
  const css = "[data-azrael-pricing-boundary=true]{color:light-dark(#88732b,#c2ac65)!important}[data-azrael-pricing-boundary=true] svg circle{stroke:currentColor}.vscode-light [data-azrael-pricing-boundary=true]{color:#88732b!important}.vscode-dark [data-azrael-pricing-boundary=true],.dark [data-azrael-pricing-boundary=true]{color:#c2ac65!important}.vscode-high-contrast [data-azrael-pricing-boundary=true]{color:#e8d58a!important}.vscode-high-contrast-light [data-azrael-pricing-boundary=true]{color:#62500d!important}@media(forced-colors:active){[data-azrael-pricing-boundary=true]{color:CanvasText!important;outline:1px solid CanvasText}}";
  return jsx(node.type, {...node.props, tooltipContent:jsx("div", {style:{whiteSpace:"pre-line"},children:[node.props.tooltipContent, jsx("div",{children:description})]}), children:jsx(span.type, {...span.props,
    "aria-label":span.props["aria-label"] + ". " + description,
    "data-azrael-pricing-boundary":yellow ? "true" : "false",
    children:[jsx("style",{children:css}),span.props.children]})});
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
  const percentage = draft ?? String(override?.percentage ?? (override?.token_limit != null && base > 0 ? Math.max(1, Math.round(override.token_limit * 100 / base)) : 95));
  const valid = /^[1-9]\d*$/.test(percentage) && Number.isSafeInteger(Number(percentage));
  const requested = valid && base > 0 ? Math.max(1, Math.floor(base * (Number(percentage) / 100))) : null;
  const effective = requested == null ? null : policy.safeContextWindow == null ? requested : Math.min(requested, policy.safeContextWindow);
  const max = base > 0 && policy.safeContextWindow != null ? Math.max(1, Math.floor(policy.safeContextWindow * 100 / base)) : 100;
  return {base,percentage,requested,effective,max};
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
    jsx("p",{children:ko?"기본값: 길이 추가 요금 없는 기본 용량의 95%, 안전 한도 이하로 제한됩니다. 변경 사항은 기존 대화의 다음 턴에 적용되며 진행 중인 턴은 바뀌지 않습니다.":"Default: 95% of the no-length-surcharge base, capped at the safe limit. Changes apply to the next turn in existing chats; the active turn stays unchanged."}),
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
        jsx("p",{"aria-live":"polite","data-azrael-compaction-preview":true,children:(ko?"요청: ":"Requested: ")+preview.percentage+"% = "+tokens(preview.requested)+(ko?" 토큰; 적용: ":" tokens; effective: ")+tokens(preview.effective)+(ko?" 토큰; 안전 한도: ":" tokens; safe cap: ")+tokens(p.safeContextWindow)+(preview.requested>preview.effective?(ko?" (안전 한도로 제한됨)":" (capped at safe limit)"):"")}),
        override?.token_limit!=null&&override.percentage==null?jsx("p",{children:(ko?"기존 토큰 한도 ":"Legacy token limit ")+tokens(override.token_limit)+(ko?"이 저장되어 있습니다. 저장을 누르면 표시된 백분율로 변경됩니다.":" remains stored until Save replaces it with the displayed percentage.")}):null,
        jsx("div",{style:{display:"flex",gap:8,alignItems:"center"},children:[
          jsx("button",{style:buttonStyle,type:"submit",disabled:pending,children:ko?"저장":"Save"}),
          jsx("button",{style:buttonStyle,type:"button",disabled:pending,onClick:()=>action(id,""),children:ko?"기본값으로 재설정":"Reset to default"})
        ]}),
        jsx("p",{style:{whiteSpace:"pre-line"},children:policyDescription(p,ko,"compaction")})
      ]});
    })]});
}
function injectProviderContext(text, asset) {
  if (text.includes(MARKER)) return {text,count:0};
  let count = 0;
  if (asset === CONTEXT_ASSET) {
    text=once(text,"function Pea(e){","function __azraelNativeContextUsage(e){");
    text=once(text,"function Tea(e){","function __azraelNativeContextGauge(e){");
    text += `\n${policyDescription.toString()}\n${decorateGauge.toString()}\nfunction Pea(e){return {...__azraelNativeContextUsage(e),contextPolicy:e?.contextPolicy??null}}\nfunction Tea(e){return decorateGauge(b7.jsx,__azraelNativeContextGauge(e),e.contextUsage.contextPolicy,ba().locale?.startsWith('ko'))}\n`;
    count++;
  } else if (asset === SETTINGS_ASSET) {
    // Include host identity in the parent cache even when hidden instructions leave s null.
    text=once(text,"function yr(){let e=(0,Cr.c)(9)","function yr(){let e=(0,Cr.c)(10)");
    text=once(text,"e[7]===s?l=e[8]", "e[7]===s&&e[9]===r?l=e[8]");
    text=once(text,"e[7]=s,e[8]=l),l}", "e[7]=s,e[8]=l,e[9]=r),l}");
    text=once(text,"children:[a,o,s,c]", "children:[a,o,s,c,(0,$.jsx)(__AzraelContextSettings,{hostId:r})]");
    text += `\n${policyDescription.toString()}\n${savePolicy.toString()}\n${compactionPreview.toString()}\n${renderSettings.toString()}\nfunction __AzraelContextSettings({hostId}){let scope=o(qe),client=_e(scope,hostId),intl=i();return renderSettings(wr,$.jsx,client,intl.locale?.startsWith('ko'))}\n`;
    count++;
  }
  // Only settings message descriptors/translation values; keep RPC names and URLs intact.
  const labels = new Set(["settings.agent.configuration.chatConfirmation.header","settings.agent.configuration.chatConfirmation.title","settings.configuration.codexDefaults","settings.nav.agent","settings.section.agent","settings.title","settings.codex.title"]);
  text=text.replace(/(id:`([^`]+)`,defaultMessage:`)([^`]*(?:Codex|azrael)[^`]*)(`)|("([^"]+)":`)([^`]*(?:Codex|azrael)[^`]*)(`)/g,(all,start,id,value,end,localStart,localId,localValue,localEnd)=>{
    if (!labels.has(id ?? localId)) return all;
    count++;return (start ?? localStart)+(value ?? localValue).replace(/Codex|azrael/g,"Azrael")+(end ?? localEnd);
  });
  return count ? {text:text+"\n"+MARKER,count} : {text,count:0};
}
module.exports={CONTEXT_ASSET,SETTINGS_ASSET,MARKER,injectProviderContext,policyDescription,decorateGauge,savePolicy};

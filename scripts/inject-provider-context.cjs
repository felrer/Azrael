"use strict";
const CONTEXT_ASSET = "webview/assets/app-initial-9cbfb5c07b41.js";
const SETTINGS_ASSET = "webview/assets/agent-settings-7296007574a6.js";
const MARKER = "/*azrael-provider-context-v1*/";
function once(text, from, to) {
  if (text.split(from).length !== 2) throw Error("Pinned provider context anchor changed: " + from.slice(0, 100));
  return text.replace(from, to);
}
function policyDescription(p, ko) {
  if (!p) return "";
  const price = p.pricing;
  const tokens = n => n == null ? (ko ? "알 수 없음" : "unknown") : Number(n).toLocaleString();
  const sources = ko ? {provider:"제공자 설정",global:"전역 설정",default:"기본값"} : {provider:"provider setting",global:"global setting",default:"default"};
  const pricing = price?.status === "reference" && price.inputTokenThreshold == null ? (ko ? "API 참고: 길이 추가 요금 없음" : "API reference: no length surcharge") : (ko ? {confirmed:"확인됨",reference:"참고", "no-surcharge":"길이 추가 요금 없음",unknown:"알 수 없음"} : {confirmed:"confirmed",reference:"reference","no-surcharge":"no length surcharge",unknown:"unknown"})[price?.status ?? "unknown"];
  return [p.providerId + " / " + p.modelId,
    (ko ? "자동 압축: " : "Auto-compaction: ") + tokens(p.autoCompactTokenLimit) + " (" + (sources[p.autoCompactSource]??p.autoCompactSource) + ")",
    (ko ? "모델 용량: " : "Model capacity: ") + tokens(p.contextWindow),
    (ko ? "안전 한도: " : "Safe cap: ") + tokens(p.safeContextWindow),
    (ko ? "입력 토큰" : "Input tokens") + (p.inputTokensEstimated ? (ko ? " (추정)" : " (estimated)") : "") + ": " + tokens(p.inputTokens),
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
  if (value !== "" && !/^[1-9]\d*$/.test(value)) throw Error("Enter a positive integer token limit");
  const number = value === "" ? null : Number(value);
  if (number != null && !Number.isSafeInteger(number)) throw Error("Token limit exceeds the supported integer range");
  await client.sendRequest("config/batchWrite", {edits:[{keyPath:"provider_auto_compact." + JSON.stringify(id),value:number == null ? {} : {token_limit:number},mergeStrategy:"replace"}],filePath:null,expectedVersion:null,reloadUserConfig:true});
  return client.sendRequest("config/read", {includeLayers:true,cwd:null});
}
function renderSettings(React, jsx, client, ko) {
  const [data, setData] = React.useState(null), [error, setError] = React.useState(""), [pending, setPending] = React.useState(false);
  React.useEffect(() => {let live=true;setData(null);setError("");client.sendRequest("config/read",{includeLayers:true,cwd:null}).then(x=>{if(live)setData(x)},e=>{if(live)setError((ko?"설정을 불러오지 못했습니다: ":"Unable to load settings: ")+String(e.message??e))});return()=>{live=false}},[client]);
  const groups = new Map();
  for (const p of data?.contextPolicies ?? []) {if (!groups.has(p.providerId)) groups.set(p.providerId, []);groups.get(p.providerId).push(p)}
  const selected = data?.contextPolicies?.find(p => p.modelId === data.config?.model) ?? data?.contextPolicies?.[0];
  const action = async (id, value) => {setPending(true);setError("");try {setData(await savePolicy(client,id,value))}catch(e){setError(ko?(e.message==="Enter a positive integer token limit"?"양의 정수 토큰 한도를 입력하세요":e.message==="Token limit exceeds the supported integer range"?"토큰 한도가 지원되는 정수 범위를 초과합니다":"설정을 저장하지 못했습니다: "+String(e.message??e)):String(e.message??e))}finally{setPending(false)}};
  return jsx("section", {"data-azrael-provider-context":true,className:"flex flex-col gap-3",children:[jsx("h2",{children:ko?"제공자 자동 압축":"Provider auto-compaction"}),jsx("p",{children:ko?"기본값: 모델 용량의 95%, 안전 한도 이하로 제한됩니다. 변경 사항은 기존 대화의 다음 턴에 적용되며 진행 중인 턴은 바뀌지 않습니다.":"Default: 95% of model capacity, capped at the safe limit. Changes apply to the next turn in existing chats; the active turn stays unchanged."}),selected?jsx("p",{style:{whiteSpace:"pre-line"},children:(ko?"선택된 모델\n":"Selected model\n")+policyDescription(selected,ko)}):null,error?jsx("p",{role:"alert",children:error}):null,...Array.from(groups,([id, policies])=>jsx("form",{key:id,style:{display:"flex",flexDirection:"column",gap:8,padding:12,border:"1px solid var(--vscode-widget-border, #8886)",borderRadius:8},onSubmit:e=>{e.preventDefault();action(id,new FormData(e.currentTarget).get("limit"))},children:[jsx("h3",{style:{fontWeight:600},children:({openai:"OpenAI",devin:"Devin",anthropic:"Anthropic",google:"Google AI Studio",xai:"xAI",openrouter:"OpenRouter","google-antigravity":"Google Antigravity"})[id]??id}),jsx("label",{children:[ko?"토큰 한도 (빈 값 = 기본 95%)":"Token limit (empty = default 95%)",jsx("input",{style:{display:"block",marginTop:6,padding:"6px 8px",maxWidth:"100%",width:240,border:"1px solid var(--vscode-input-border, #888)",borderRadius:4,background:"var(--vscode-input-background)",color:"var(--vscode-input-foreground)"},key:JSON.stringify(data.config?.provider_auto_compact?.[id]),name:"limit",type:"text",inputMode:"numeric",pattern:"[1-9][0-9]*",defaultValue:data.config?.provider_auto_compact?.[id]?.token_limit??"",disabled:pending}),jsx("p",{children:(ko?"사용자 지정 값은 저장되지만 실제 압축 한도는 이 모델의 안전 한도 ":"The custom value is saved, but the effective compaction limit is capped at this model’s safe limit: ")+((policies.find(p=>p.modelId===selected?.modelId)??policies[0]).safeContextWindow?.toLocaleString()??(ko?"알 수 없음":"unknown"))+(ko?" 토큰을 넘지 않습니다. 모델을 바꾸면 적용 한도도 달라집니다.":" tokens. The effective limit changes when you change models.")})]}),jsx("button",{style:{padding:"6px 12px",alignSelf:"flex-start",borderRadius:4,background:"var(--vscode-button-background, #305f9b)",color:"var(--vscode-button-foreground, white)"},type:"submit",disabled:pending,children:ko?"저장":"Save"}),jsx("button",{style:{padding:"6px 12px",alignSelf:"flex-start",borderRadius:4,background:"var(--vscode-button-secondaryBackground, #8883)",color:"var(--vscode-button-secondaryForeground)"},type:"button",disabled:pending,onClick:()=>action(id,""),children:ko?"기본값으로 재설정":"Reset to default"}),...[policies.find(p=>p.modelId===selected?.modelId)??policies[0]].map(p=>jsx("p",{key:p.modelId,style:{whiteSpace:"pre-line"},children:policyDescription(p,ko)}))]}))]});
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
    text='import{aRt as __azraelContextRpc}from"./app-initial-9cbfb5c07b41.js";import{H_t as __azraelContextIntl}from"./app-initial-9f7d97690e9b.js";'+text;
    text=once(text,"children:[f,p,null,null]", "children:[f,p,(0,Q.jsx)(__AzraelContextSettings,{hostId:a}),null]");
    text += `\n${policyDescription.toString()}\n${savePolicy.toString()}\n${renderSettings.toString()}\nfunction __AzraelContextSettings({hostId}){let scope=n(ie),client=__azraelContextRpc(scope,hostId),intl=__azraelContextIntl();return renderSettings(s(),Q.jsx,client,intl.locale?.startsWith('ko'))}\n`;
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
module.exports={CONTEXT_ASSET,SETTINGS_ASSET,injectProviderContext,policyDescription,decorateGauge,savePolicy};

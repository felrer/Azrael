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
function gaugeProgress(policy, fallback) {
  const input = policy?.inputTokens, limit = policy?.autoCompactTokenLimit, capacity = policy?.contextWindow;
  if (!Number.isFinite(input) || input < 0 || !Number.isFinite(limit) || limit <= 0) return {percent:fallback, secondLap:false};
  const secondLap = policy.autoCompactionEnabled === false && input >= limit && Number.isFinite(capacity) && capacity > limit;
  return {percent:Math.min(1, Math.max(0, secondLap ? (input-limit)/(capacity-limit) : input/limit))*100, secondLap};
}
function responsePerformanceDescription(performance, ko) {
  const unavailable = ko ? "측정값 없음" : "Unavailable";
  if (!performance || typeof performance.turnId !== "string" || !performance.turnId.trim()) return unavailable;
  const {outputTokens,requestDurationMs,completedRequests,unmeasuredRequests} = performance;
  if (![outputTokens,requestDurationMs,completedRequests,unmeasuredRequests].every(n=>Number.isFinite(n)&&n>=0) || !Number.isInteger(completedRequests) || !Number.isInteger(unmeasuredRequests)) return unavailable;
  const partial = unmeasuredRequests > 0 ? (ko ? " · 일부 측정" : " · partial") : "";
  if (completedRequests === 0) return outputTokens === 0 && requestDurationMs === 0 ? (ko ? "측정 대기" : "Waiting for measurement") + partial : unavailable;
  const rate = outputTokens / requestDurationMs * 1000;
  if (requestDurationMs <= 0 || !Number.isFinite(rate)) return unavailable;
  return rate.toLocaleString(ko ? "ko-KR" : "en-US", {minimumFractionDigits:1,maximumFractionDigits:1}) + (ko ? " 토큰/초" : " tokens/s") + partial;
}
function legacyResponsePerformanceGraph(jsx, performance, ko) {
  if (!performance || performance.completedRequests <= 0 || performance.requestDurationMs <= 0 || responsePerformanceDescription(performance,false) === "Unavailable" || performance.graphEstimated !== true || !Array.isArray(performance.minuteSamples) || !performance.minuteSamples.length || performance.minuteSamples.length > 120) return null;
  const samples=performance.minuteSamples;
  if (samples.some((s,i)=>!s || !Number.isSafeInteger(s.minute) || s.minute<0 || !Number.isFinite(s.outputTokens) || s.outputTokens<0 || !Number.isFinite(s.requestDurationMs) || s.requestDurationMs<=0 || !Number.isFinite(s.outputTokens/s.requestDurationMs*1000) || i>0 && s.minute<=samples[i-1].minute) || samples.at(-1).minute-samples[0].minute>=120) return null;
  const label=ko?"분별 TPS · 추정":"TPS by minute · estimated",range=performance.truncatedMinutes?(ko?"최근 120분":"Recent 120 minutes"):(ko?"분별 추이":"Minute trend"),unit=ko?"토큰/초":"tokens/s";
  const formatter=new Intl.NumberFormat(ko?"ko-KR":"en-US",{maximumFractionDigits:1,minimumFractionDigits:1}),format=n=>formatter.format(n);
  const points=samples.map(s=>({minute:s.minute,rate:s.outputTokens/s.requestDurationMs*1000})),first=points[0].minute,last=points.at(-1).minute,max=Math.max(1,...points.map(p=>p.rate));
  const xy=p=>({x:first===last?144:24+(p.minute-first)/(last-first)*240,y:78-p.rate/max*54});
  const segments=[];
  for(const [i,p] of points.entries()){
    const position=xy(p),previous=points[i-1];
    if(previous && p.minute===previous.minute+1){const from=xy(previous);segments.push(jsx("line",{key:"line-"+p.minute,x1:from.x,y1:from.y,x2:position.x,y2:position.y,stroke:"currentColor",strokeWidth:1.5}))}
    segments.push(jsx("circle",{key:"point-"+p.minute,cx:position.x,cy:position.y,r:2.5,fill:"currentColor","data-minute":p.minute,"data-tps":p.rate}));
  }
  const description=[label,range,(ko?"응답 시작 후 분; ":"Minutes since response start; ")+unit,...points.map(p=>(p.minute+1)+(ko?"분: ":" min: ")+format(p.rate)+" "+unit)].join(" · ");
  return jsx("div",{"data-azrael-response-tps-graph":"estimated","aria-label":description,style:{display:"flex",flexDirection:"column",gap:4,minWidth:0},children:[
    jsx("div",{style:{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"},children:[jsx("strong",{children:label}),jsx("span",{className:"text-token-description-foreground",children:range})]}),
    jsx("svg",{viewBox:"0 0 288 104",role:"img","aria-label":description,style:{display:"block",width:"100%",height:"auto",maxHeight:112,color:"var(--vscode-descriptionForeground, currentColor)"},children:[
      jsx("path",{d:"M24 20V78H264",fill:"none",stroke:"currentColor",strokeOpacity:0.3}),
      jsx("text",{x:24,y:13,fontSize:9,fill:"currentColor",children:format(max)+" "+unit}),...segments,
      jsx("text",{x:18,y:81,textAnchor:"end",fontSize:9,fill:"currentColor",children:"0"}),
      jsx("text",{x:first===last?144:24,y:96,textAnchor:first===last?"middle":"start",fontSize:9,fill:"currentColor",children:(first+1)+(ko?"분":" min")}),
      first===last?null:jsx("text",{x:264,y:96,textAnchor:"end",fontSize:9,fill:"currentColor",children:(last+1)+(ko?"분":" min")})
    ]})
  ]});
}
function responsePerformanceGraph(jsx, p, ko, options = {}) {
  if (p?.startedAtUnixMs == null && p?.observedAtUnixMs == null) return legacyResponsePerformanceGraph(jsx,p,ko);
  const minuteMs=60000,windowMs=40*minuteMs,end=p?.observedAtUnixMs,start=end-windowMs;
  if (!p || !Number.isFinite(end) || !Number.isFinite(new Date(end).getTime()) || !Number.isFinite(p.startedAtUnixMs) || !Number.isFinite(new Date(p.startedAtUnixMs).getTime()) || p.startedAtUnixMs>end || typeof p.turnId!=="string" || !p.turnId.trim() || !Array.isArray(p.history) || !Array.isArray(p.minuteSamples)) return null;
  const modes=["standard","fast","ultrafast"],colors={standard:"var(--color-chart-blue)",fast:"color-mix(in srgb, var(--color-chart-orange) 95%, black)",ultrafast:"color-mix(in srgb, var(--color-purple) 95%, white)"},names={standard:"Standard",fast:"Fast",ultrafast:"Ultrafast",unknown:ko?"모드 미상":"Unknown mode"};
  const color=mode=>colors[mode]??"var(--vscode-descriptionForeground, currentColor)",format=n=>n.toLocaleString(ko?"ko-KR":"en-US",{minimumFractionDigits:1,maximumFractionDigits:1});
  const clock=ms=>{const d=new Date(ms);return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")};
  const turns=[...p.history,{turnId:p.turnId,startedAtUnixMs:p.startedAtUnixMs,minuteSamples:p.minuteSamples}],ids=new Set(),points=[],boundaries=[];
  for (const [index,turn] of turns.entries()) {
    if (!turn || typeof turn.turnId!=="string" || !turn.turnId.trim() || ids.has(turn.turnId) || !Number.isFinite(turn.startedAtUnixMs) || turn.startedAtUnixMs>end || !Array.isArray(turn.minuteSamples) || index>0&&turn.startedAtUnixMs<turns[index-1].startedAtUnixMs) return null;
    ids.add(turn.turnId);
    if(turn.startedAtUnixMs>=start) boundaries.push({id:turn.turnId,time:turn.startedAtUnixMs});
    let previous=null;const seen=new Set();
    for(const sample of turn.minuteSamples){
      const mode=sample?.mode??null;
      if(!sample || !Number.isSafeInteger(sample.minute) || sample.minute<0 || !Number.isFinite(sample.outputTokens) || sample.outputTokens<0 || !Number.isFinite(sample.requestDurationMs) || sample.requestDurationMs<=0 || !Number.isFinite(sample.outputTokens/sample.requestDurationMs*1000) || mode!==null&&!modes.includes(mode) || previous&&sample.minute<previous.minute || seen.has(sample.minute+':'+mode)) return null;
      previous=sample;seen.add(sample.minute+':'+mode);
      const time=turn.startedAtUnixMs+sample.minute*minuteMs,right=Math.min(time+minuteMs,end),left=Math.max(time,start),fraction=(right-left)/(right-time);
      if(!Number.isFinite(time)||right<=left||!Number.isFinite(fraction)||fraction<=0)continue;
      points.push({turnId:turn.turnId,minute:sample.minute,mode,time:left,tokens:sample.outputTokens*fraction,duration:sample.requestDurationMs*fraction,rate:sample.outputTokens/sample.requestDurationMs*1000});
    }
  }
  if(!points.length&&!boundaries.length)return null;
  const means=modes.flatMap(mode=>{const samples=points.filter(point=>point.mode===mode),duration=samples.reduce((n,s)=>n+s.duration,0);return duration>0?[{mode,rate:samples.reduce((n,s)=>n+s.tokens,0)/duration*1000}]:[]});
  const max=Math.max(1,...points.map(s=>s.rate)),x=time=>24+(time-start)/windowMs*240,y=rate=>78-rate/max*54;
  const label=ko?"분별 TPS · 추정":"TPS by minute · estimated",range=ko?"최근 40분":"Recent 40 minutes",unit=ko?"토큰/초":"tokens/s",averageLabel=ko?"모드별 평균":"Mode averages";
  const description=[label,range,...points.map(s=>clock(s.time)+" "+names[s.mode??'unknown']+": "+format(s.rate)+" "+unit)].join(" · ");
  const shapes=[],timestampRows=[];
  // Share SVG coordinates with the boundaries, including at the plot edges.
  // Five tabular digits fit in 34 units; close starts use separate rows.
  const timestamps=boundaries.map(b=>{const position=x(b.time),left=position-17;let row=timestampRows.findIndex(right=>right<=left);if(row<0){row=timestampRows.length;timestampRows.push(0)}timestampRows[row]=position+17;return {...b,position,row}});
  const graphHeight=86+Math.max(1,timestampRows.length)*16;
  for(const [i,point] of points.entries()){
    const previous=points[i-1];
    if(previous&&previous.turnId===point.turnId&&previous.mode===point.mode&&point.minute===previous.minute+1)shapes.push(jsx("line",{key:"join-"+i,"data-tps-join":true,x1:x(previous.time),y1:y(previous.rate),x2:x(point.time),y2:y(point.rate),stroke:color(point.mode),strokeWidth:1.5}));
    shapes.push(jsx("circle",{key:"point-"+i,cx:x(point.time),cy:y(point.rate),r:2.5,fill:color(point.mode),"data-minute":point.minute,"data-turn-id":point.turnId,"data-mode":point.mode??"unknown","data-tps":point.rate,children:jsx("title",{children:names[point.mode??'unknown']+": "+format(point.rate)+" "+unit})}));
  }
  return jsx("div",{"data-azrael-response-tps-graph":"estimated","aria-label":description,style:{display:"flex",flexDirection:"column",gap:4,minWidth:0},children:[
    jsx("div",{className:"flex items-center justify-between gap-2 flex-wrap",children:[jsx("strong",{children:label}),jsx("span",{className:"text-token-description-foreground",children:range})]}),
    jsx("svg",{viewBox:"0 0 288 "+graphHeight,role:"img","aria-label":description,style:{display:"block",width:"100%",height:"auto",maxHeight:graphHeight*112/86,overflow:"visible"},children:[
      jsx("path",{d:"M24 20V78H264",fill:"none",stroke:"currentColor",strokeOpacity:0.3}),jsx("text",{x:24,y:13,fontSize:9,fill:"currentColor",children:format(max)+" "+unit}),
      ...boundaries.map(b=>jsx("line",{key:b.id,"data-turn-boundary":b.id,x1:x(b.time),x2:x(b.time),y1:20,y2:78,stroke:"currentColor",strokeOpacity:0.4,strokeDasharray:"3 3"})),
      ...(options.averages?means.map(m=>jsx("line",{key:"average-"+m.mode,"data-mode-average":m.mode,"data-tps":m.rate,x1:24,x2:264,y1:y(m.rate),y2:y(m.rate),stroke:color(m.mode),strokeDasharray:"5 3"})):[]),...shapes,
      jsx("g",{"data-tps-timestamps":true,fontSize:10,fill:"currentColor",textAnchor:"middle",style:{fontVariantNumeric:"tabular-nums"},children:timestamps.map(b=>jsx("text",{key:b.id,"data-turn-timestamp":b.id,"data-timestamp-row":b.row,x:b.position,y:94+b.row*16,children:clock(b.time)}))})]}),
    jsx("div",{style:{display:"flex",gap:8,flexWrap:"wrap",fontSize:11},children:[...modes,"unknown"].filter(mode=>mode!=="unknown"||points.some(s=>s.mode===null)).map(mode=>jsx("span",{key:mode,style:{color:color(mode)},children:names[mode]}))}),
    options.Switch?jsx("div",{className:"flex items-center justify-between gap-4","data-tps-average-toggle":true,children:[jsx("span",{className:"text-sm",children:averageLabel}),jsx(options.Switch,{ariaLabel:averageLabel,checked:options.averages===true,onChange:options.onAveragesChange})]}):null,
    options.averages?jsx("div",{"data-tps-average-labels":true,style:{display:"flex",gap:8,flexWrap:"wrap",fontSize:11},children:means.map(m=>jsx("span",{key:m.mode,style:{color:color(m.mode)},children:names[m.mode]+": "+format(m.rate)+" "+unit}))}):null
  ]});
}
function decorateGauge(jsx, node, policy, ko, action = null, performance = undefined, graph = responsePerformanceGraph(jsx,performance,ko)) {
  if (!node) return node;
  const performanceLabel = ko ? "현재 응답 평균 TPS" : "Current response average TPS";
  const performanceValue = responsePerformanceDescription(performance, ko);
  const performanceDescription = performanceLabel + ": " + performanceValue + (graph?"\n"+graph.props["aria-label"]:"");
  const row = (label, value) => jsx("div", {style:{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:16,alignItems:"baseline"},children:[jsx("span",{children:label}),jsx("span",{style:{textAlign:"right",fontVariantNumeric:"tabular-nums",overflowWrap:"anywhere"},children:value})]});
  if (!policy) {
    if (!action) return node;
    const span=node.props.children;
    return jsx(node.type,{...node.props,interactive:true,keyboardNavigation:true,tooltipContent:jsx("div",{className:"flex flex-col gap-2",children:[node.props.tooltipContent,action,row(performanceLabel,performanceValue),graph]}),children:jsx(span.type,{...span.props,tabIndex:0,"aria-label":[span.props["aria-label"],performanceDescription].filter(Boolean).join("\n")})});
  }
  const price = policy.pricing, input = policy.inputTokens;
  const secondLap = gaugeProgress(policy, null).secondLap;
  const pricingYellow = (price?.status === "confirmed" || price?.status === "reference") && input != null && price.inputTokenThreshold != null && (price.inclusive ? input >= price.inputTokenThreshold : input > price.inputTokenThreshold);
  const yellow = secondLap || pricingYellow;
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
  const lapDescription = secondLap ? (ko ? "자동 압축 꺼짐 · 추가 용량: " : "Auto-compaction off · Additional capacity: ") + tokens(input-policy.autoCompactTokenLimit) + " / " + tokens(policy.contextWindow-policy.autoCompactTokenLimit) + (ko ? " 토큰" : " tokens") : "";
  const description = [ko ? "사용량" : "Usage", ...rows.map(([label,value]) => label + ": " + value), performanceDescription, (ko ? "모델: " : "Model: ") + model, (ko ? "요금 참고: " : "Pricing reference: ") + pricing, lapDescription].filter(Boolean).join("\n");
  const tooltip = jsx("div", {style:{display:"flex",flexDirection:"column",gap:10,textAlign:"left",maxWidth:"min(440px, calc(100vw - 32px))",whiteSpace:"normal"},children:[
    jsx("div",{style:{display:"flex",flexDirection:"column",gap:4},children:[jsx("strong",{children:ko?"사용량":"Usage"}),...rows.map(([label,value])=>row(label,value)),row(performanceLabel,performanceValue),graph]}),
    row(ko?"모델":"Model",model),
    jsx("div",{style:{display:"flex",flexDirection:"column",gap:4},children:[jsx("strong",{children:ko?"요금 참고":"Pricing reference"}),jsx("span",{children:pricing}),price?.sourceUrl ? jsx("a",{href:price.sourceUrl,target:"_blank",rel:"noopener noreferrer",style:{color:"var(--vscode-textLink-foreground)",width:"fit-content"},children:ko?"공식 문서 ↗":"Official documentation ↗"}) : null]}),
    lapDescription ? jsx("span",{className:"text-xs text-token-description-foreground",children:lapDescription}) : null,
    action
  ]});
  const span = node.props.children;
  const css = "[data-azrael-pricing-boundary=true]{color:light-dark(#88732b,#c2ac65)!important}[data-azrael-pricing-boundary=true] svg circle{stroke:currentColor}.vscode-light [data-azrael-pricing-boundary=true]{color:#88732b!important}.vscode-dark [data-azrael-pricing-boundary=true],.dark [data-azrael-pricing-boundary=true]{color:#c2ac65!important}.vscode-high-contrast [data-azrael-pricing-boundary=true]{color:#e8d58a!important}.vscode-high-contrast-light [data-azrael-pricing-boundary=true]{color:#62500d!important}@media(forced-colors:active){[data-azrael-pricing-boundary=true]{color:CanvasText!important;outline:1px solid CanvasText}}";
  return jsx(node.type, {...node.props, interactive:true, keyboardNavigation:true, tooltipContent:tooltip, children:jsx(span.type, {...span.props,
    tabIndex:0,
    "aria-label":description + (pricingYellow ? "\n" + (price.status === "reference" ? (ko ? "API 참고: 장기 컨텍스트 요금 구간" : "API reference: long-context pricing tier") : (ko ? "장기 컨텍스트 요금 구간" : "Long-context pricing tier")) : ""),
    "data-azrael-context-lap":secondLap ? "2" : "1",
    "data-azrael-pricing-boundary":yellow ? "true" : "false",
    children:[jsx("style",{children:css}),span.props.children]})});
}
function useThreadAutoCompaction(React, manager, conversationId, request = (method, params) => manager.sendRequest(method, params)) {
  const [, update] = React.useState(0), ref = React.useRef(null);
  if (ref.current?.manager !== manager || ref.current?.id !== conversationId) ref.current = {manager,id:conversationId,pending:false,error:null,confirmed:null};
  const current = ref.current;
  const read = () => {
    const enabled = manager.getConversation(conversationId)?.latestThreadSettings?.autoCompactionEnabled;
    if (typeof enabled !== "boolean") throw Error("Thread auto-compaction setting unavailable");
    current.confirmed = enabled; return enabled;
  };
  if (conversationId != null && current.confirmed == null && !current.error) { try { read(); } catch { current.error = "read"; } }
  React.useEffect(() => {
    if (conversationId == null) return;
    let active = true;
    const refresh = event => {
      if (!active || ref.current !== current || event?.conversationId != null && event.conversationId !== conversationId) return;
      try { read(); if (current.error === "read") current.error = null; } catch { current.error = "read"; }
      update(n => n + 1);
    };
    let unsubscribe = () => {};
    try { unsubscribe = manager.addConversationHistoryInvalidationListener(refresh); }
    catch { current.error = "read"; update(n => n + 1); }
    if (current.error === "read") retry(); else refresh();
    return () => { active = false; unsubscribe(); };
  }, [manager, conversationId]);
  const save = async enabled => {
    if (conversationId == null || current.pending || typeof enabled !== "boolean") return;
    current.pending = true; current.requested = enabled; current.error = null; update(n => n + 1);
    try {
      await request("thread/settings/update", {threadId:conversationId,autoCompactionEnabled:enabled});
      const result = await request("thread/read", {threadId:conversationId,includeTurns:false});
      if (ref.current !== current) return;
      const acknowledged = result?.thread?.autoCompactionEnabled;
      if (typeof acknowledged !== "boolean") throw Error("Thread setting readback unavailable");
      current.confirmed = acknowledged;
      if (current.confirmed !== enabled) throw Error("Thread setting was not confirmed");
    } catch { if (ref.current === current) current.error = "save"; }
    finally { current.pending = false; if (ref.current === current) update(n => n + 1); }
  };
  async function retry() {
    if (conversationId == null || current.pending || ref.current !== current) return;
    current.pending = true; update(n => n + 1);
    try {
      const result = await request("thread/read",{threadId:conversationId,includeTurns:false});
      if (ref.current !== current) return;
      const enabled = result?.thread?.autoCompactionEnabled;
      if (typeof enabled !== "boolean") throw Error("Thread setting unavailable");
      current.confirmed = enabled; current.error = null;
    } catch { if (ref.current === current) current.error = "read"; }
    finally { current.pending = false; if (ref.current === current) update(n => n + 1); }
  }
  return {enabled:current.confirmed,pending:current.pending,error:current.error,save,retry,retrySave:()=>save(current.requested)};
}
function renderThreadAutoCompaction(jsx, Switch, Button, state, conversationId, ko) {
  const label = ko ? "자동 압축" : "Auto-compaction";
  return jsx("div", {className:"flex flex-col gap-2", "data-azrael-thread-auto-compaction":conversationId??"",children:[
    jsx("div",{className:"flex items-center justify-between gap-4",children:[jsx("span",{className:"text-sm",children:label}),jsx(Switch,{ariaLabel:label,checked:state.enabled!==false,disabled:conversationId==null||state.pending||state.enabled==null,onChange:state.save})]}),
    jsx("span",{className:"text-xs text-token-description-foreground",role:state.error?"alert":"status","aria-live":"polite",children:state.error ? (ko?"자동 압축 설정을 확인하거나 저장하지 못했습니다.":"Could not read or save auto-compaction setting.") : state.pending ? (ko?"저장 중…":"Saving…") : (ko?"이 대화에만 적용":"Applies to this chat. New chats start enabled.")}),
    state.error ? jsx(Button,{type:"button",color:"secondary",size:"compact",onClick:state.error==="read"?state.retry:state.retrySave,disabled:state.pending,children:ko?"다시 시도":"Retry setting"}) : null
  ]});
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
  const defaultTokens = policy.providerId === "openai" && !policy.modelId.startsWith("managed/") && !policy.modelId.startsWith("api/") && policy.pricing?.status === "no-surcharge" ? Math.min(300000, policy.safeContextWindow ?? policy.contextWindow ?? 300000) : policy.providerId === "anthropic" && policy.contextWindow >= 1000000 ? 600000 : null;
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
    if (!/r4n as l9[,}]/.test(text) || !/l4n as d9[,}]/.test(text)) throw Error("Pinned native auto-compaction switch changed");
    text += `\n${policyDescription.toString()}\n${gaugeProgress.toString()}\n${responsePerformanceDescription.toString()}\n${legacyResponsePerformanceGraph.toString()}\n${responsePerformanceGraph.toString()}\n${decorateGauge.toString()}\n${useThreadAutoCompaction.toString()}\n${renderThreadAutoCompaction.toString()}\n${renderCompactionAction.toString()}\nconst __azraelCompactionEntries=new Map();\nfunction aCa(e){const usage=__azraelNativeContextUsage(e),policy=e?.contextPolicy??null;return {...usage,percent:gaugeProgress(policy,usage.percent).percent,contextPolicy:policy,responsePerformance:e?.responsePerformance}}\nfunction XSa(e){gw();_A();l4n();const ko=st().locale?.startsWith('ko'),[averageState,setAverageState]=wd().useState(()=>({id:e.conversationId,enabled:false})),averages=averageState?.id===e.conversationId&&averageState?.enabled===true,graph=wd().useMemo(()=>responsePerformanceGraph(y7.jsx,e.contextUsage.responsePerformance,ko,{averages,Switch:r4n,onAveragesChange:enabled=>setAverageState({id:e.conversationId,enabled})}),[e.contextUsage.responsePerformance,ko,averages,e.conversationId]),store=Ou($),manager=e.conversationId==null?null:store.get(nA,store.get(hA,e.conversationId)),state=useThreadAutoCompaction(wd(),manager,e.conversationId,(method,params)=>Px(store,store.get(hA,e.conversationId)).sendRequest(method,params)),policy=e.contextUsage.contextPolicy?{...e.contextUsage.contextPolicy,autoCompactionEnabled:state.enabled}:null,usage={...e.contextUsage,contextPolicy:policy,percent:gaugeProgress(policy,e.contextUsage.percent).percent},manual=renderCompactionAction(wd(),y7.jsx,mw,store,e.conversationId,ko,__azraelCompactionEntries,(store,id)=>Px(store,store.get(hA,id)).compactThread(id)),action=y7.jsx('div',{className:'flex flex-col gap-3',children:[renderThreadAutoCompaction(y7.jsx,r4n,mw,state,e.conversationId,ko),manual]});return decorateGauge(y7.jsx,__azraelNativeContextGauge({...e,contextUsage:usage}),policy,ko,action,e.contextUsage.responsePerformance,graph)}\n`;
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
module.exports={CONTEXT_ASSET,SETTINGS_ASSET,MARKER,injectProviderContext,injectProviderContextControls,policyDescription,gaugeProgress,responsePerformanceDescription,responsePerformanceGraph,decorateGauge,useThreadAutoCompaction,renderThreadAutoCompaction,renderCompactionAction,savePolicy,compactionPreview,renderSettings};

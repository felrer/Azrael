"use strict";
const assert=require("node:assert/strict"), hs=require("node:fs"), path=require("node:path"), pm=require("node:vm");
const {test}=require("node:test");
const injection=require("./inject-provider-context.cjs");
const root=path.resolve(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434"));
const source=hs.readFileSync(path.join(root,injection.CONTEXT_ASSET),"utf8");
const transformed=injection.injectProviderContext(source,injection.CONTEXT_ASSET).text;
const ts=require(require.resolve("typescript",{paths:[path.resolve(__dirname,"../extensions/azrael-ex")]}));
function declaration(text,name){const Cst=ts.createSourceFile("fixture.js",text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),found=[];function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found.push(n.getText(Cst));ts.forEachChild(n,visit)}visit(Cst);assert.equal(found.length,1,`unique declaration ${name}`);return found[0]}
const jsx=(type,props)=>({type,props});
function gaugeHarness(){const context={gw(){},vsi(){},_A(){},Ou:()=>({}),$:{},mw:"native-button",wd:()=>({useState:()=>[0,()=>{}],useEffect(){}}),y7:{jsx,jsxs:jsx},QSa:{c:n=>Array(n).fill(Symbol.for("react.memo_cache_sentinel"))},st:()=>({locale:"en",formatMessage:(_,{percent})=>"Context usage: "+percent+"%",formatNumber:x=>String(x)}),q:"message",ZSa:()=>{},wr:"number",d5n:"donut",FT:"tooltip",Symbol};
  pm.createContext(context);pm.runInContext(declaration(transformed,"__azraelNativeContextUsage")+declaration(transformed,"__azraelNativeContextGauge")+"\n"+transformed.slice(transformed.lastIndexOf("function policyDescription"),transformed.lastIndexOf("/*azrael-provider-context")),context);return context}
const policy=(input,status="confirmed",inclusive=false)=>({providerId:"openai",modelId:"m",contextWindow:400000,autoCompactBaseTokens:200000,safeContextWindow:380000,autoCompactTokenLimit:361000,autoCompactSource:"default",inputTokens:input,inputTokensEstimated:true,pricing:{status,inputTokenThreshold:272000,inclusive,sourceUrl:"https://example.com/pricing"}});
test("footer cache refreshes active conversation even when usage is unchanged",()=>{
  const footer=declaration(transformed,"cwa");assert.match(footer,/E7\.c\)\(42\)/);assert.match(footer,/t\[22\]!==y\|\|t\[23\]!==H\|\|t\[41\]!==h/);assert.match(footer,/XSa,\{contextUsage:y,conversationId:h\}/);assert.match(footer,/t\[24\]=W,t\[41\]=h/);
  assert.match(declaration(transformed,"XSa"),/Px\(store,store\.get\(hA,id\)\)\.compactThread\(id\)/);
});
test("card compacts ID only, guards duplicate pending clicks, retries errors and keeps thread state separate",async()=>{
  const entries=new Map(),calls=[],draft={text:"unsent draft",attachments:["image.png"]},store={};let resolve,reject;
  const React={useState:()=>[0,()=>{}],useEffect:fn=>fn()},compact=(...args)=>{calls.push(args);return new Promise((yes,no)=>{resolve=yes;reject=no})};
  const render=(id,ko=false)=>injection.renderCompactionAction(React,jsx,"native-button",store,id,ko,entries,compact);
  const event={preventDefault(){},stopPropagation(){}};
  let card=render("a"),button=card.props.children[0];assert.equal(button.type,"native-button");assert.equal(button.props.type,"button");const first=button.props.onClick(event);await button.props.onClick(event);assert.deepEqual(calls,[[store,"a"]]);assert.equal(render("a").props.children[0].props.disabled,true);assert.match(render("a",true).props.children[1].props.children,/요청 중/);assert.equal(render("b").props.children[0].props.disabled,false);resolve();await first;assert.match(render("a").props.children[1].props.children,/requested/);
  const failed=render("a").props.children[0].props.onClick(event);reject(Error("offline"));await failed;card=render("a",true);assert.equal(card.props.children[1].props.role,"alert");assert.match(card.props.children[0].props.children,/다시 시도/);const retry=card.props.children[0].props.onClick(event);resolve();await retry;assert.equal(calls.length,3);
  card=render(null);assert.equal(card.props.children[0].props.disabled,true);await card.props.children[0].props.onClick(event);assert.equal(calls.length,3);assert.deepEqual(draft,{text:"unsent draft",attachments:["image.png"]});
});
test("transformed pinned gauge uses auto-compaction percentage and independent input pricing boundary",()=>{const h=gaugeHarness();for(const [input,status,inclusive,yellow]of [[272000,"confirmed",false,false],[272001,"confirmed",false,true],[272000,"confirmed",true,true],[300000,"reference",false,true],[300000,"no-surcharge",false,false],[300000,"unknown",false,false],[null,"confirmed",false,false]]){const usage=h.aCa({modelContextWindow:400000,last:{totalTokens:400000},contextPolicy:policy(input,status,inclusive)});assert.equal(usage.percent,input==null?100:input/361000*100);assert.equal(usage.usedTokens,400000);const tree=h.XSa({contextUsage:usage});assert.equal(tree.props.children.props.children[1].props.percent,usage.percent);assert.equal(tree.props.children.props["data-azrael-pricing-boundary"],String(yellow));assert.match(tree.props.children.props["aria-label"],/estimated/);assert.match(tree.props.children.props["aria-label"],/Auto-compaction basis: .* \/ 361,000 tokens/);assert.match(tree.props.children.props["aria-label"],/Full capacity basis: .* \/ 400,000 tokens/);const tooltip=tree.props.tooltipContent;assert.equal(tooltip.props.style.textAlign,"left");assert.equal(tooltip.props.children[2].props.children[2].props.href,"https://example.com/pricing");assert.doesNotMatch(JSON.stringify(tooltip),/Context window:|Safe cap:|Model capacity:|Auto-compaction:|default/);}});
test("auto-compaction ratio clamps independently from native capacity metadata",()=>{const h=gaugeHarness();const usage=h.aCa({modelContextWindow:100,last:{totalTokens:125},contextPolicy:policy(1)});assert.equal(usage.percent,1/361000*100);assert.equal(usage.usedTokens,100);assert.equal(usage.contextPolicy.inputTokens,1);assert.equal(h.aCa(null).percent,null);
  const tooltip=h.decorateGauge(jsx,{type:"tooltip",props:{tooltipContent:"old context",children:{type:"span",props:{"aria-label":"old usage",children:"donut"}}}},{...policy(50106),contextWindow:872000,autoCompactTokenLimit:258400,inputTokensEstimated:false},true);
  const text=tooltip.props.children.props["aria-label"];
  assert.match(text,/자동 압축 기준: 50,106 \/ 258,400 토큰 \(19.4%\)/);
  assert.match(text,/전체 용량 기준: 50,106 \/ 872,000 토큰 \(5.7%\)/);
  assert.doesNotMatch(text,/old usage|설정|안전 한도|입력 토큰/);
  const action=jsx("button",{type:"button",children:"Compact context"}),native={type:"tooltip",props:{tooltipContent:"native usage",children:{type:"span",props:{children:"donut"}}}};
  const withoutPolicy=h.decorateGauge(jsx,native,null,false,action);assert.equal(withoutPolicy.props.tooltipContent.props.children[0],"native usage");assert.equal(withoutPolicy.props.tooltipContent.props.children[1],action);assert.equal(withoutPolicy.props.children.props.tabIndex,0);
  const over=h.decorateGauge(jsx,{type:"tooltip",props:{children:{type:"span",props:{children:"donut"}}}},{...policy(300000),autoCompactTokenLimit:200000,contextWindow:400000},false);
  assert.match(over.props.children.props["aria-label"],/150.0%/);});
test("auto-compaction gauge matches tooltip input, saturates at the limit and falls back for unavailable policy",()=>{
  const h=gaugeHarness(),base={modelContextWindow:1000000,last:{totalTokens:900000}};
  for(const [input,limit,percent] of [[247263,600000,41.2105],[0,600000,0],[600000,600000,100],[750000,600000,100],[null,600000,90],[-1,600000,90],[Infinity,600000,90],[247263,null,90],[247263,0,90],[247263,-1,90],[247263,Infinity,90]]){
    const usage=h.aCa({...base,contextPolicy:{...policy(input),contextWindow:1000000,autoCompactTokenLimit:limit}});
    assert.ok(Math.abs(usage.percent-percent)<1e-9);
    assert.equal(h.XSa({contextUsage:usage}).props.children.props.children[1].props.percent,usage.percent);
  }
  assert.equal(h.aCa(base).percent,90);
  assert.equal(h.aCa({last:{totalTokens:247263},contextPolicy:policy(247263)}).percent,247263/361000*100);
});
test("pinned donut circles inherit explicit subdued theme colors and high contrast override",()=>{
  const h={f5n:{c:n=>Array(n).fill(Symbol.for("react.memo_cache_sentinel"))},p5n:{jsx,jsxs:jsx},g5n:0,Oz:100,m5n:12,h5n:120,c5n:{},ru:(...xs)=>xs.filter(Boolean).join(" "),Symbol};pm.createContext(h);pm.runInContext(declaration(source,"u5n")+declaration(source,"d5n"),h);const svg=h.d5n({percent:68});assert.ok(svg.props.children.every(x=>x.props.stroke==="currentColor"));assert.equal(svg.props.children[1].props.className,"");assert.equal(svg.props.children[1].props.strokeDashoffset,32);
  const gauge=gaugeHarness().XSa({contextUsage:{percent:68,usedTokens:272001,contextWindow:400000,contextPolicy:policy(272001)}});const css=gauge.props.children.props.children[0].props.children;assert.match(css,/#88732b,#c2ac65/);assert.match(css,/svg circle\{stroke:currentColor\}/);assert.match(css,/forced-colors:active/);assert.doesNotMatch(css,/editorWarning/);
});
test("API reference without threshold describes no surcharge and localizes pricing/source",()=>{
  const h={...policy(300000,"reference"),pricing:{status:"reference",inputTokenThreshold:null,sourceUrl:"https://example.com/api"}};
  assert.match(injection.policyDescription(h,false),/API reference: no length surcharge/);assert.match(injection.policyDescription(h,true),/API 참고: 길이 추가 요금 없음/);assert.match(injection.policyDescription(h,true),/기본값/);
  const gauge=gaugeHarness().XSa({contextUsage:{percent:75,contextPolicy:h}});assert.equal(gauge.props.children.props["data-azrael-pricing-boundary"],"false");
});
test("model-only overrides preserve exact provider/model key and read back",async()=>{
 const calls=[],config={provider_auto_compact:{anthropic:{percentage:80,models:{sibling:{percentage:70}}}}};
 const client={async sendRequest(method,params){calls.push({method,params});if(method==='config/batchWrite'){config.provider_auto_compact.anthropic.models['managed/anthropic/large']=params.edits[0].value}return{config}}};
 await injection.savePolicy(client,'anthropic','managed/anthropic/large','75');assert.equal(calls[0].params.edits[0].keyPath,'provider_auto_compact."anthropic".models."managed/anthropic/large"');assert.equal(calls[0].params.edits[0].mergeStrategy,'replace');assert.equal(calls[1].method,'config/read');assert.equal(config.provider_auto_compact.anthropic.models.sibling.percentage,70);assert.equal(config.provider_auto_compact.anthropic.percentage,80);
 await injection.savePolicy(client,'anthropic','managed/anthropic/large','');assert.deepEqual(config.provider_auto_compact.anthropic.models['managed/anthropic/large'],{});
 const before=calls.length;for(const v of ['0','1.5','-1','9007199254740992'])await assert.rejects(injection.savePolicy(client,'anthropic','managed/anthropic/large',v));assert.equal(calls.length,before);
 await assert.rejects(injection.savePolicy({sendRequest:async m=>{if(m==='config/read')throw Error('readback failed')}},'p','m','95'),/readback failed/);
});
test("preview uses exact 600K only for Anthropic capacities at least one million",()=>{
 const p={...policy(null),providerId:'anthropic',contextWindow:1048576,autoCompactBaseTokens:1048576,safeContextWindow:996147};let v=injection.compactionPreview(p,{});assert.equal(v.requested,600000);assert.equal(v.effective,600000);assert.equal(v.isTokenDefault,true);
 assert.equal(injection.compactionPreview({...p,contextWindow:200000,autoCompactBaseTokens:200000,safeContextWindow:190000},{}).requested,190000);
 assert.equal(injection.compactionPreview({...p,providerId:'openai'},{}).requested,996147);assert.equal(injection.compactionPreview({...p,safeContextWindow:500000},{}).effective,500000);
 assert.equal(injection.compactionPreview(p,{percentage:50}).requested,524288);assert.equal(injection.compactionPreview(p,{},'50').requested,524288);assert.equal(injection.compactionPreview({...p,autoCompactBaseTokens:1,safeContextWindow:1},{percentage:1}).effective,1);
});
test("OpenAI subscription defaults target exact 300K within capacity and preserve API and overrides",()=>{
 const p={...policy(null),modelId:'gpt-6.1-sol',contextWindow:1000000,autoCompactBaseTokens:1000000,safeContextWindow:950000,pricing:{status:'no-surcharge',inputTokenThreshold:null}};
 for(const [capacity,safe,pct,expected] of [[1000000,950000,'30',300000],[400000,380000,'75',300000],[200000,190000,'95',190000],[872000,828400,'34',300000]]){
  const v=injection.compactionPreview({...p,contextWindow:capacity,autoCompactBaseTokens:capacity,safeContextWindow:safe},{});assert.equal(v.percentage,pct);assert.equal(v.effective,expected);assert.equal(v.isTokenDefault,true);
 }
 assert.equal(injection.compactionPreview(p,{percentage:50}).effective,500000);assert.equal(injection.compactionPreview(p,{token_limit:300001}).effective,300001);assert.equal(injection.compactionPreview(p,{},'31').effective,310000);
 assert.equal(injection.compactionPreview({...p,autoCompactBaseTokens:272000,pricing:{status:'confirmed',inputTokenThreshold:272000}},{}).effective,258400);
 assert.equal(injection.compactionPreview({...p,modelId:'managed/openai/gpt-6.1-sol'},{}).effective,950000);
 assert.equal(injection.compactionPreview({...p,modelId:'api/openai/gpt-6.1-sol'},{}).effective,950000);
});
test("legacy token defaults preserve exact value until edited; stale host reads are ignored",async()=>{
 const p={...policy(null),providerId:'anthropic',contextWindow:1048576,autoCompactBaseTokens:1048576,safeContextWindow:996147};assert.equal(injection.compactionPreview(p,{token_limit:600001}).requested,600001);assert.equal(injection.compactionPreview(p,{token_limit:600001},'57').requested,597688);
 const values=[],effects=[];let cursor=0;const React={useState(v){const j=cursor++;if(!(j in values))values[j]=v;return[values[j],v=>values[j]=typeof v==='function'?v(values[j]):v]},useRef(v){const j=cursor++;return values[j]??(values[j]={current:v})},useEffect(fn,deps){const j=cursor++;if(!effects[j]||effects[j].deps[0]!==deps[0]){effects[j]?.cleanup?.();effects[j]={deps,cleanup:fn()}}}};
 let firstResolve,secondResolve;const first={sendRequest:()=>new Promise(r=>firstResolve=r)},second={sendRequest:()=>new Promise(r=>secondResolve=r)};
 const render=client=>{cursor=0;return injection.renderSettings(React,jsx,client,false,{Card:'card',Row:'row',Button:'button'})};const walk=t=>t==null?[]:Array.isArray(t)?t.flatMap(walk):typeof t==='object'?[t,...walk(t.props?.children),...walk(t.props?.control)]:[];
 render(first);render(second);secondResolve({config:{model:'current'},contextPolicies:[{...p,modelId:'current'}]});await new Promise(r=>setImmediate(r));firstResolve({config:{model:'stale'},contextPolicies:[{...p,modelId:'stale'}]});await new Promise(r=>setImmediate(r));assert.ok(walk(render(second)).some(n=>n.props?.['data-azrael-model-policy']==='current'));assert.ok(!walk(render(second)).some(n=>n.props?.['data-azrael-model-policy']==='stale'));
});
test("Personalization parent cache refreshes provider settings on host changes with hidden instructions",()=>{
  const settings=injection.injectProviderContext(hs.readFileSync(path.join(root,injection.SETTINGS_ASSET),"utf8"),injection.SETTINGS_ASSET).text;
  let selectedHostId="first";const slots=Array(11).fill(Symbol.for("react.memo_cache_sentinel"));
  const h={Ar:{c:n=>{assert.equal(n,11);return slots}},Yt:()=>false,m:()=>false,rt:()=>({selectedHostId}),$:{jsx,jsxs:jsx},it:"title",ir:"about",Pn:"rules",vr:"memory",Er:"instructions",Jt:"layout",__AzraelContextSettings:"provider-settings",Symbol};
  pm.createContext(h);pm.runInContext(declaration(settings,"Tr"),h);
  const first=h.Tr();assert.equal(first.props.children[2],null);assert.equal(first.props.children[5].props.hostId,"first");assert.equal(h.Tr(),first,"unchanged host retains cache");
  selectedHostId="second";const second=h.Tr();assert.notEqual(second,first);assert.equal(second.props.children[2],null);assert.equal(second.props.children[5].props.hostId,"second");assert.equal(h.Tr(),second,"new host retains its updated cache");
});
test("provider controls inject only Personalization and preserve original bindings and instructions",()=>{
  const personal=injection.injectProviderContext(hs.readFileSync(path.join(root,injection.SETTINGS_ASSET),"utf8"),injection.SETTINGS_ASSET).text;
  assert.match(personal,/azrael-provider-context-v2/);assert.match(personal,/scope=ee\(vt\),client=He\(scope,hostId\),intl=i\(\)/);assert.match(personal,/renderSettings\(jr,\$\.jsx/);assert.match(personal,/children:\[a,o,null,s,c,/);assert.equal(declaration(personal,"Er"),declaration(hs.readFileSync(path.join(root,injection.SETTINGS_ASSET),"utf8"),"Er"));assert.doesNotMatch(personal,/import\{aRt as __azraelContextRpc/);
  const asset="webview/assets/agent-settings-4d2487cc749f.js",configuration=injection.injectProviderContext(hs.readFileSync(path.join(root,asset),"utf8"),asset).text;assert.doesNotMatch(configuration,/__AzraelContextSettings|data-azrael-provider-context/);assert.equal(configuration,hs.readFileSync(path.join(root,asset),"utf8"));
});
test("all injected pinned assets are idempotent; targeted English and Korean labels retain RPC/link literals",()=>{for(const asset of [injection.CONTEXT_ASSET,injection.SETTINGS_ASSET,"webview/assets/ko-KR-ebd6264cb102.js"]){const s=hs.readFileSync(path.join(root,asset),"utf8"), first=injection.injectProviderContext(s,asset);assert.ok(first.count>0);assert.equal(injection.injectProviderContext(first.text,asset).count,0);assert.equal(injection.injectProviderContext(first.text,asset).text,first.text);if(asset.includes("ko-KR")){assert.match(first.text,/"settings.configuration.codexDefaults":`Azrael`/);assert.match(first.text,/"settings.agent.configuration.chatConfirmation.header":`Azrael 설정`/);assert.match(first.text,/Codex CLI/);}}assert.throws(()=>injection.injectProviderContext("function aCa(e){}",injection.CONTEXT_ASSET),/anchor/);const settings=hs.readFileSync(path.join(root,injection.SETTINGS_ASSET),"utf8");for(const malformed of [settings.replace("function Tr(){","function Unknown(){"),settings+"function Tr(){let e=(0,Ar.c)(10)"])assert.throws(()=>injection.injectProviderContext(malformed,injection.SETTINGS_ASSET),/anchor/)});
test("combined namespace pipeline parses pinned settings/gauge and caches provider context metadata",()=>{
  const transformer=require("./namespace-azrael-host.cjs"),{createAssetTransformCache}=require("./asset-transform-cache.cjs"),crypto=require("node:crypto");
  const tsPath=path.resolve(process.argv[2]??require.resolve("typescript",{paths:[path.resolve(__dirname,"../extensions/azrael-ex")]})),ts=require(tsPath),sha=x=>crypto.createHash("sha256").update(x).digest("hex");
  const parent=path.resolve(__dirname,"../artifacts/logs/provider-context-policy");hs.mkdirSync(parent,{recursive:true});const directory=hs.mkdtempSync(path.join(parent,"ui-cache-"));
  try{const stats={hits:0,misses:0},options={cacheDirectory:directory,typescriptSha256:sha(hs.readFileSync(tsPath)),typescriptVersion:ts.version,transformRules:transformer.getTransformRules(),statistics:stats},cache=createAssetTransformCache(options);
    for(const asset of [injection.CONTEXT_ASSET,injection.SETTINGS_ASSET]){const s=hs.readFileSync(path.join(root,asset),"utf8"),transform=()=>transformer.transformAsset(s,asset,path.join(root,asset),ts),first=cache.run(asset,s,transform);assert.ok(first.asset.providerContextEdits>0);assert.equal(ts.createSourceFile(asset,first.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0);const Dit=cache.run(asset,s,()=>{throw Error("cache missed")});assert.equal(Dit.text,first.text);assert.equal(Dit.asset.providerContextEdits,first.asset.providerContextEdits)}cache.flush();assert.equal(stats.hits,2);
  }finally{assert.ok(path.resolve(directory).startsWith(parent+path.sep));hs.rmSync(directory,{recursive:true})}
});

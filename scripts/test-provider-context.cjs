"use strict";
const assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path"), vm=require("node:vm");
const {test}=require("node:test");
const injection=require("./inject-provider-context.cjs");
const root=path.resolve(__dirname,"../artifacts/upstream-ui/26.928.31416");
const source=fs.readFileSync(path.join(root,injection.CONTEXT_ASSET),"utf8");
const transformed=injection.injectProviderContext(source,injection.CONTEXT_ASSET).text;
function declaration(text,name){let start=text.indexOf("function "+name+"(");assert.ok(start>=0,name);const next=text.indexOf("function ",start+10);if(text.slice(start-6,start)==="async ")start-=6;return text.slice(start,next<0?undefined:next).split("var Dea")[0].trim()}
const jsx=(type,props)=>({type,props});
function gaugeHarness(){const context={b7:{jsx,jsxs:jsx},Dea:{c:n=>Array(n).fill(Symbol.for("react.memo_cache_sentinel"))},ba:()=>({locale:"en",formatMessage:(_,{percent})=>"Context usage: "+percent+"%",formatNumber:x=>String(x)}),J:"message",Eea:()=>{},eu:"number",LZn:"donut",wE:"tooltip",Symbol};
  vm.createContext(context);vm.runInContext(declaration(transformed,"__azraelNativeContextUsage")+declaration(transformed,"__azraelNativeContextGauge")+"\n"+transformed.slice(transformed.lastIndexOf("function policyDescription"),transformed.lastIndexOf("/*azrael-provider-context")),context);return context}
const policy=(input,status="confirmed",inclusive=false)=>({providerId:"openai",modelId:"m",contextWindow:400000,autoCompactBaseTokens:200000,safeContextWindow:380000,autoCompactTokenLimit:361000,autoCompactSource:"default",inputTokens:input,inputTokensEstimated:true,pricing:{status,inputTokenThreshold:272000,inclusive,sourceUrl:"https://example.com/pricing"}});
test("transformed pinned native gauge preserves percentage and adds independent input pricing boundary",()=>{const h=gaugeHarness();for(const [input,status,inclusive,yellow]of [[272000,"confirmed",false,false],[272001,"confirmed",false,true],[272000,"confirmed",true,true],[300000,"reference",false,true],[300000,"unknown",false,false],[null,"confirmed",false,false]]){const usage=h.Pea({modelContextWindow:400000,last:{totalTokens:400000},contextPolicy:policy(input,status,inclusive)});assert.equal(usage.percent,100);assert.equal(usage.usedTokens,400000);const tree=h.Tea({contextUsage:usage});assert.equal(tree.props.children.props.children[1].props.percent,100);assert.equal(tree.props.children.props["data-azrael-pricing-boundary"],String(yellow));assert.match(tree.props.children.props["aria-label"],/estimated/);assert.match(tree.props.children.props["aria-label"],/Auto-compaction: 361,000/);assert.match(tree.props.children.props["aria-label"],/example.com/);}});
test("native ratio keeps original clamping independently from input token metadata",()=>{const h=gaugeHarness();const usage=h.Pea({modelContextWindow:100,last:{totalTokens:125},contextPolicy:policy(1)});assert.equal(usage.percent,100);assert.equal(usage.usedTokens,100);assert.equal(usage.contextPolicy.inputTokens,1);assert.equal(h.Pea(null).percent,null)});
test("pinned donut circles inherit explicit subdued theme colors and high contrast override",()=>{
  const h={RZn:{c:n=>Array(n).fill(Symbol.for("react.memo_cache_sentinel"))},zZn:{jsx,jsxs:jsx},HZn:0,fB:100,BZn:12,VZn:120,PZn:{},X:(...xs)=>xs.filter(Boolean).join(" "),Symbol};vm.createContext(h);vm.runInContext(declaration(source,"IZn")+declaration(source,"LZn"),h);const svg=h.LZn({percent:68});assert.ok(svg.props.children.every(x=>x.props.stroke==="currentColor"));assert.equal(svg.props.children[1].props.className,"");assert.equal(svg.props.children[1].props.strokeDashoffset,32);
  const gauge=gaugeHarness().Tea({contextUsage:{percent:68,usedTokens:272001,contextWindow:400000,contextPolicy:policy(272001)}});const css=gauge.props.children.props.children[0].props.children;assert.match(css,/#88732b,#c2ac65/);assert.match(css,/svg circle\{stroke:currentColor\}/);assert.match(css,/forced-colors:active/);assert.doesNotMatch(css,/editorWarning/);
});
test("API reference without threshold describes no surcharge and localizes pricing/source",()=>{
  const p={...policy(300000,"reference"),pricing:{status:"reference",inputTokenThreshold:null,sourceUrl:"https://example.com/api"}};
  assert.match(injection.policyDescription(p,false),/API reference: no length surcharge/);assert.match(injection.policyDescription(p,true),/API 참고: 길이 추가 요금 없음/);assert.match(injection.policyDescription(p,true),/기본값/);
  const gauge=gaugeHarness().Tea({contextUsage:{percent:75,contextPolicy:p}});assert.equal(gauge.props.children.props["data-azrael-pricing-boundary"],"false");
});
function settingsHarness(response, ko=false, failure=null) {
  const settings=injection.injectProviderContext(fs.readFileSync(path.join(root,injection.SETTINGS_ASSET),"utf8"),injection.SETTINGS_ASSET).text;
  const values=[],effects=[];let index=0;
  const React={useState(initial){const j=index++;if(!(j in values))values[j]=initial;return[values[j],value=>{values[j]=typeof value==="function"?value(values[j]):value}]},useEffect(fn){const j=index++;if(!effects[j])effects[j]=fn()??true}};
  const requests=[],client={async sendRequest(method,params){requests.push({method,params});if(method==="config/batchWrite"){if(failure)throw Error(failure);response={...response,config:{...response.config,provider_auto_compact:{...response.config.provider_auto_compact,[JSON.parse(params.edits[0].keyPath.slice("provider_auto_compact.".length))]:params.edits[0].value}}};return{status:"ok"}}return response}};
  const h={o:()=>({}),qe:{},_e:()=>client,i:()=>({locale:ko?"ko-KR":"en"}),wr:React,$:{jsx}};vm.createContext(h);
  vm.runInContext(settings.slice(settings.lastIndexOf("function policyDescription"),settings.lastIndexOf("/*azrael-provider-context")),h);
  return {requests,render(){index=0;return h.__AzraelContextSettings({hostId:"local"})}};
}
const forms=tree=>tree.props.children.filter(x=>x?.type==="form");
const input=form=>form.props.children.find(x=>x?.type==="label"&&x.props.children[1].props.type==="text").props.children[1];
const slider=form=>form.props.children.find(x=>x?.type==="label"&&x.props.children[1].props.type==="range").props.children[1];
const preview=form=>form.props.children.find(x=>x?.props?.["data-azrael-compaction-preview"]);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test("Personalization controlled percentage and native slider synchronize selected model previews and cap 500%",async()=>{
  const response={config:{model:"selected",provider_auto_compact:{openai:{token_limit:250000}}},contextPolicies:[{...policy(null),modelId:"first",autoCompactBaseTokens:100000},{...policy(null),modelId:"selected"},{...policy(null,"unknown"),providerId:"openrouter",modelId:"other",autoCompactBaseTokens:400000}]};
  const h=settingsHarness(response);h.render();await settle();let tree=h.render(),rows=forms(tree);
  assert.equal(rows.length,2);assert.match(tree.props.children[1].props.children,/95%/);assert.match(tree.props.children[1].props.children,/next turn/);
  assert.equal(input(rows[0]).props.value,"125");assert.equal(input(rows[1]).props.value,"95");assert.equal(slider(rows[0]).props.max,190);assert.equal(slider(rows[0]).props.value,125);assert.equal(slider(rows[0]).props.step,1);assert.match(rows[0].props.children[1].props.children,/selected/);assert.match(JSON.stringify(rows[0]),/remains stored until Save/);assert.equal(h.requests.length,1);
  input(rows[0]).props.onChange({target:{value:"500"}});rows=forms(h.render());assert.equal(input(rows[0]).props.value,"500");assert.equal(slider(rows[0]).props.value,190);assert.match(preview(rows[0]).props.children,/500% = 1,000,000 tokens; effective: 380,000/);assert.match(preview(rows[0]).props.children,/capped/);
  slider(rows[0]).props.onChange({target:{value:"75"}});rows=forms(h.render());assert.equal(input(rows[0]).props.value,"75");assert.equal(slider(rows[0]).props.value,75);assert.match(preview(rows[0]).props.children,/150,000/);
  assert.match(JSON.stringify(rows[1]),/Using model capacity/);assert.match(tree.props.children.find(x=>x?.type==="style").props.children,/slider-thumb/);
  assert.equal(h.requests.length,1,"editing legacy display does not write until Save");
  await rows[0].props.onSubmit({preventDefault(){}});rows=forms(h.render());assert.equal(h.requests[1].method,"config/batchWrite");assert.equal(h.requests[1].params.edits[0].value.percentage,75);assert.equal(h.requests[2].method,"config/read");assert.equal(input(rows[0]).props.value,"75");assert.doesNotMatch(JSON.stringify(rows[0]),/remains stored until Save/);
  await rows[0].props.children.find(x=>x?.type==="button"&&x.props.type==="button").props.onClick();rows=forms(h.render());assert.equal(input(rows[0]).props.value,"95");assert.equal(Object.keys(h.requests[3].params.edits[0].value).length,0);
});
test("invalid percentage and save/read failures stay visible, with localized validation",async()=>{
  const response={config:{model:"m"},contextPolicies:[policy(null)]},h=settingsHarness(response,true);h.render();await settle();let row=forms(h.render())[0];input(row).props.onChange({target:{value:"0"}});row=forms(h.render())[0];await row.props.onSubmit({preventDefault(){}});assert.equal(h.render().props.children.find(x=>x?.props?.role==="alert").props.children,"양의 정수 백분율을 입력하세요");assert.equal(h.requests.length,1);
  const failed=settingsHarness(response,false,"write rejected");failed.render();await settle();await forms(failed.render())[0].props.onSubmit({preventDefault(){}});assert.equal(failed.render().props.children.find(x=>x?.props?.role==="alert").props.children,"write rejected");assert.equal(failed.requests.length,2);
  const settings=injection.injectProviderContext(fs.readFileSync(path.join(root,injection.SETTINGS_ASSET),"utf8"),injection.SETTINGS_ASSET).text;
  const data=[],React={useState(value){return[value,x=>data.push(x)]},useEffect(fn){fn()}};const v={wr:React,$:{jsx},o:()=>({}),qe:{},i:()=>({locale:"en"}),_e:()=>({sendRequest:async()=>{throw Error("read rejected")}})};vm.createContext(v);vm.runInContext(settings.slice(settings.lastIndexOf("function policyDescription"),settings.lastIndexOf("/*azrael-provider-context")),v);v.__AzraelContextSettings({hostId:"local"});await settle();assert.ok(data.includes("Unable to load settings: read rejected"));
});
test("settings roundtrip writes percentage override and rereads; reset persists empty override",async()=>{
  const settings=injection.injectProviderContext(fs.readFileSync(path.join(root,injection.SETTINGS_ASSET),"utf8"),injection.SETTINGS_ASSET).text;assert.match(settings,/__AzraelContextSettings,\{hostId:r\}/);const h={};vm.createContext(h);vm.runInContext(declaration(settings,"savePolicy"),h);const calls=[];let stored={};const client={async sendRequest(method,params){calls.push({method,params});if(method==="config/batchWrite"){stored=params.edits[0].value;return{status:"ok"}}return{config:{provider_auto_compact:{openai:stored}}}}};
  let result=await h.savePolicy(client,"openai","500");assert.equal(result.config.provider_auto_compact.openai.percentage,500);assert.equal(result.config.provider_auto_compact.openai.token_limit,undefined);assert.equal(calls[0].params.edits[0].keyPath,'provider_auto_compact."openai"');assert.equal(calls[0].params.edits[0].mergeStrategy,"replace");assert.equal(calls[1].method,"config/read");result=await h.savePolicy(client,"openai","");assert.equal(Object.keys(result.config.provider_auto_compact.openai).length,0);const before=calls.length;for(const invalid of ["0","1.5","-1","9007199254740992"])await assert.rejects(h.savePolicy(client,"openai",invalid));assert.equal(calls.length,before);
  await assert.rejects(h.savePolicy({sendRequest:async method=>{if(method==="config/read")throw Error("readback failed")}},"openai","95"),/readback failed/);
});
test("native percentage preview clamps a tiny valid base to at least one token",()=>{
  const settings=injection.injectProviderContext(fs.readFileSync(path.join(root,injection.SETTINGS_ASSET),"utf8"),injection.SETTINGS_ASSET).text;
  const h={};vm.createContext(h);vm.runInContext(declaration(settings,"compactionPreview"),h);
  const preview=h.compactionPreview({...policy(null),autoCompactBaseTokens:1,safeContextWindow:1},{percentage:1});
  assert.equal(preview.requested,1);assert.equal(preview.effective,1);assert.equal(preview.percentage,"1");
});
test("Personalization parent cache refreshes provider settings on host changes with hidden instructions",()=>{
  const settings=injection.injectProviderContext(fs.readFileSync(path.join(root,injection.SETTINGS_ASSET),"utf8"),injection.SETTINGS_ASSET).text;
  let selectedHostId="first";const slots=Array(10).fill(Symbol.for("react.memo_cache_sentinel"));
  const h={Cr:{c:n=>{assert.equal(n,10);return slots}},t:()=>false,Et:()=>({selectedHostId}),$:{jsx,jsxs:jsx},dt:"title",Qn:"about",On:"rules",fr:"memory",br:"instructions",Lt:"layout",__AzraelContextSettings:"provider-settings",Symbol};
  vm.createContext(h);vm.runInContext(declaration(settings,"yr"),h);
  const first=h.yr();assert.equal(first.props.children[2],null);assert.equal(first.props.children[4].props.hostId,"first");assert.equal(h.yr(),first,"unchanged host retains cache");
  selectedHostId="second";const second=h.yr();assert.notEqual(second,first);assert.equal(second.props.children[2],null);assert.equal(second.props.children[4].props.hostId,"second");assert.equal(h.yr(),second,"new host retains its updated cache");
});
test("provider controls inject only Personalization and preserve original bindings and instructions",()=>{
  const personal=injection.injectProviderContext(fs.readFileSync(path.join(root,injection.SETTINGS_ASSET),"utf8"),injection.SETTINGS_ASSET).text;
  assert.match(personal,/azrael-provider-context-v2/);assert.match(personal,/scope=o\(qe\),client=_e\(scope,hostId\),intl=i\(\)/);assert.match(personal,/renderSettings\(wr,\$\.jsx/);assert.match(personal,/children:\[a,o,s,c,/);assert.match(personal,/personal-agents-editor/);assert.doesNotMatch(personal,/import\{aRt as __azraelContextRpc/);
  const asset="webview/assets/agent-settings-7296007574a6.js",configuration=injection.injectProviderContext(fs.readFileSync(path.join(root,asset),"utf8"),asset).text;assert.doesNotMatch(configuration,/__AzraelContextSettings|data-azrael-provider-context/);assert.equal(configuration,fs.readFileSync(path.join(root,asset),"utf8"));
});
test("all injected pinned assets are idempotent; targeted English and Korean labels retain RPC/link literals",()=>{for(const asset of [injection.CONTEXT_ASSET,injection.SETTINGS_ASSET,"webview/assets/ko-KR-669e0b3acfd6.js"]){const s=fs.readFileSync(path.join(root,asset),"utf8"), first=injection.injectProviderContext(s,asset);assert.ok(first.count>0);assert.equal(injection.injectProviderContext(first.text,asset).count,0);assert.equal(injection.injectProviderContext(first.text,asset).text,first.text);if(asset.includes("ko-KR")){assert.match(first.text,/"settings.configuration.codexDefaults":`Azrael`/);assert.match(first.text,/"settings.agent.configuration.chatConfirmation.header":`Azrael 설정`/);assert.match(first.text,/Codex CLI/);}}assert.throws(()=>injection.injectProviderContext("function Pea(e){}",injection.CONTEXT_ASSET),/anchor/)});
test("combined namespace pipeline parses pinned settings/gauge and caches provider context metadata",()=>{
  const transformer=require("./namespace-azrael-host.cjs"),{createAssetTransformCache}=require("./asset-transform-cache.cjs"),crypto=require("node:crypto");
  const tsPath=path.resolve(process.argv[2]??path.join(__dirname,"../artifacts/build/pdf_chrome_20261001_v2/companion/node_modules/typescript/lib/typescript.js")),ts=require(tsPath),sha=x=>crypto.createHash("sha256").update(x).digest("hex");
  const parent=path.resolve(__dirname,"../artifacts/logs/provider-context-policy");fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,"ui-cache-"));
  try{const stats={hits:0,misses:0},options={cacheDirectory:directory,typescriptSha256:sha(fs.readFileSync(tsPath)),typescriptVersion:ts.version,transformRules:transformer.getTransformRules(),statistics:stats},cache=createAssetTransformCache(options);
    for(const asset of [injection.CONTEXT_ASSET,injection.SETTINGS_ASSET]){const s=fs.readFileSync(path.join(root,asset),"utf8"),transform=()=>transformer.transformAsset(s,asset,path.join(root,asset),ts),first=cache.run(asset,s,transform);assert.ok(first.asset.providerContextEdits>0);assert.equal(ts.createSourceFile(asset,first.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0);const hit=cache.run(asset,s,()=>{throw Error("cache missed")});assert.equal(hit.text,first.text);assert.equal(hit.asset.providerContextEdits,first.asset.providerContextEdits)}cache.flush();assert.equal(stats.hits,2);
  }finally{assert.ok(path.resolve(directory).startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true})}
});

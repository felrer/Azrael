"use strict";
const assert=require("node:assert/strict"), hs=require("node:fs"), path=require("node:path"), pm=require("node:vm");
const {test}=require("node:test");
const injection=require("./inject-provider-context.cjs");
const root=path.resolve(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434"));
const source=hs.readFileSync(path.join(root,injection.CONTEXT_ASSET),"utf8");
const transformed=injection.injectProviderContext(source,injection.CONTEXT_ASSET).text;
const ts=require(require.resolve("typescript",{paths:[path.resolve(__dirname,"../extensions/azrael-ex")]}));
function declaration(text,name){const Cst=ts.createSourceFile("fixture.js",text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),found=[];function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found.push(n.getText(Cst));ts.forEachChild(n,visit)}visit(Cst);return found[0]}
const jsx=(type,props)=>({type,props});
function gaugeHarness(){const manager={getConversation:()=>({latestThreadSettings:{autoCompactionEnabled:true}})},context={gw(){},vsi(){},_A(){},l4n(){},r4n:"native-switch",hA:{},nA:{},Px:()=>manager,Ou:()=>({get:atom=>atom===context.nA?manager:"local"}),$:{},mw:"native-button",wd:()=>({useState:()=>[0,()=>{}],useRef:v=>({current:v}),useEffect(){},useMemo:fn=>fn()}),y7:{jsx,jsxs:jsx},QSa:{c:n=>Array(n).fill(Symbol.for("react.memo_cache_sentinel"))},st:()=>({locale:"en",formatMessage:(_,{percent})=>"Context usage: "+percent+"%",formatNumber:x=>String(x)}),q:"message",ZSa:()=>{},wr:"number",d5n:"donut",FT:"tooltip",Symbol};
  pm.createContext(context);pm.runInContext(declaration(transformed,"__azraelNativeContextUsage")+declaration(transformed,"__azraelNativeContextGauge")+"\n"+transformed.slice(transformed.lastIndexOf("function policyDescription"),transformed.lastIndexOf("/*azrael-provider-context")),context);return context}
const policy=(input,status="confirmed",inclusive=false)=>({providerId:"openai",modelId:"m",contextWindow:400000,autoCompactBaseTokens:200000,safeContextWindow:380000,autoCompactTokenLimit:361000,autoCompactSource:"default",inputTokens:input,inputTokensEstimated:true,pricing:{status,inputTokenThreshold:272000,inclusive,sourceUrl:"https://example.com/pricing"}});
test("current response performance forwards measured totals and replaces them on next turn",()=>{
 const h=gaugeHarness(),snapshot={turnId:'turn-a',outputTokens:355,requestDurationMs:2000,completedRequests:2,unmeasuredRequests:0};
 const usage=h.aCa({modelContextWindow:400000,last:{totalTokens:100},contextPolicy:policy(100),responsePerformance:snapshot});
 assert.equal(usage.responsePerformance,snapshot);
 const gauge=h.XSa({conversationId:'a',contextUsage:usage});
 assert.match(gauge.props.children.props['aria-label'],/Current response average TPS: 177\.5 tokens\/s/);
 assert.match(JSON.stringify(gauge.props.tooltipContent),/177\.5 tokens\/s/);
 assert.equal(gauge.props.interactive,true);assert.equal(gauge.props.keyboardNavigation,true);assert.equal(gauge.props.children.props.tabIndex,0);
 const reset=h.aCa({last:{totalTokens:100},contextPolicy:policy(100),responsePerformance:{turnId:'turn-b',outputTokens:0,requestDurationMs:0,completedRequests:0,unmeasuredRequests:0}});
 assert.match(h.XSa({conversationId:'a',contextUsage:reset}).props.children.props['aria-label'],/Waiting for measurement/);
 assert.doesNotMatch(h.XSa({contextUsage:reset}).props.children.props['aria-label'],/177\.5/);
 assert.equal(h.aCa({last:{totalTokens:100}}).responsePerformance,undefined);
});
test("performance displays only finite measured rates, with localized empty and partial states",()=>{
 const describe=injection.responsePerformanceDescription,base={turnId:'a',outputTokens:200,requestDurationMs:2000,completedRequests:1,unmeasuredRequests:0};
 assert.equal(describe(base,false),'100.0 tokens/s');assert.equal(describe({...base,outputTokens:0},false),'0.0 tokens/s');
 assert.equal(describe({...base,unmeasuredRequests:1},true),'100.0 토큰/초 · 일부 측정');
 assert.equal(describe({...base,unmeasuredRequests:1},false),'100.0 tokens/s · partial');
 assert.equal(describe({...base,completedRequests:0,requestDurationMs:0,outputTokens:0},true),'측정 대기');
 for(const value of [null,undefined,{}, {...base,turnId:''}, {...base,requestDurationMs:0},{...base,requestDurationMs:Infinity},{...base,outputTokens:NaN},{...base,outputTokens:-1},{...base,completedRequests:0},{...base,completedRequests:0.5},{...base,unmeasuredRequests:-1}])assert.equal(describe(value,false),'Unavailable');
 const native={type:'tooltip',props:{tooltipContent:'native usage',children:{type:'span',props:{'aria-label':'native usage',children:'donut'}}}},action=jsx('button',{type:'button',children:'Compact context'});
 const tree=injection.decorateGauge(jsx,native,null,true,action,base);
 assert.equal(tree.props.tooltipContent.props.children[1],action);assert.match(tree.props.children.props['aria-label'],/native usage\n현재 응답 평균 TPS: 100\.0 토큰\/초/);
});
test("minute TPS graph distinguishes estimates, gaps, zero and truncated history",()=>{
 const base={turnId:'a',outputTokens:360,requestDurationMs:4000,completedRequests:2,unmeasuredRequests:0,graphEstimated:true,truncatedMinutes:false,minuteSamples:[{minute:0,outputTokens:100,requestDurationMs:1000},{minute:1,outputTokens:160,requestDurationMs:2000},{minute:3,outputTokens:100,requestDurationMs:1000}]};
 const graph=injection.responsePerformanceGraph(jsx,base,false),svg=graph.props.children[1],children=svg.props.children,points=children.filter(n=>n?.type==='circle'),lines=children.filter(n=>n?.type==='line');
 assert.equal(points.length,3);assert.equal(lines.length,1);assert.deepEqual(points.map(n=>n.props['data-tps']),[100,80,100]);
 assert.equal(points[0].props.cx,24);assert.equal(points[2].props.cx,264);assert.match(graph.props['aria-label'],/estimated.*1 min: 100\.0 tokens\/s.*4 min: 100\.0 tokens\/s/);
 assert.match(injection.responsePerformanceGraph(jsx,{...base,truncatedMinutes:true},true).props['aria-label'],/추정.*최근 120분/);
 const zero=injection.responsePerformanceGraph(jsx,{...base,outputTokens:0,minuteSamples:[{minute:4,outputTokens:0,requestDurationMs:1000}]},false);
 const dot=zero.props.children[1].props.children.find(n=>n?.type==='circle');assert.equal(dot.props.cy,78);assert.equal(dot.props.cx,144);assert.match(zero.props['aria-label'],/5 min: 0\.0 tokens\/s/);
 for(const patch of [{minuteSamples:undefined},{minuteSamples:[]},{graphEstimated:false},{completedRequests:0},{minuteSamples:[{minute:-1,outputTokens:1,requestDurationMs:1}]},{minuteSamples:[{minute:0,outputTokens:Infinity,requestDurationMs:1}]},{minuteSamples:[{minute:0,outputTokens:1,requestDurationMs:0}]},{minuteSamples:[base.minuteSamples[1],base.minuteSamples[0]]},{minuteSamples:[base.minuteSamples[0],base.minuteSamples[0]]},{minuteSamples:[base.minuteSamples[0],{minute:120,outputTokens:1,requestDurationMs:1}]}])assert.equal(injection.responsePerformanceGraph(jsx,{...base,...patch},false),null);
 const h=gaugeHarness(),usage=h.aCa({last:{totalTokens:100},contextPolicy:policy(100),responsePerformance:base}),tree=h.XSa({contextUsage:usage});
 assert.match(tree.props.children.props['aria-label'],/Current response average TPS: 90\.0 tokens\/s\nTPS by minute · estimated/);
 let previousDeps,memoValue,calculations=0,locale='en';const nativeReact=h.wd(),nativeIntl=h.st(),nativeGraph=h.responsePerformanceGraph,memoCalls=[];
 h.responsePerformanceGraph=(...args)=>{calculations++;return nativeGraph(...args)};
 h.st=()=>({...nativeIntl,locale});
 h.wd=()=>({...nativeReact,useMemo(fn,deps){memoCalls.push(deps);if(!previousDeps||deps.some((v,i)=>!Object.is(v,previousDeps[i]))){previousDeps=deps;memoValue=fn()}return memoValue}});
 h.XSa({conversationId:'a',contextUsage:usage});h.XSa({conversationId:'b',contextUsage:usage});assert.equal(calculations,2);assert.equal(memoCalls[0][0],base);assert.equal(memoCalls[0][1],false);
 const nextUsage={...usage,responsePerformance:{...base,turnId:'b'}};h.XSa({conversationId:'b',contextUsage:nextUsage});assert.equal(calculations,3);
 locale='ko-KR';const localized=h.XSa({conversationId:null,contextUsage:nextUsage});assert.equal(calculations,4);assert.equal(memoCalls.at(-1)[1],true);assert.match(localized.props.children.props['aria-label'],/분별 TPS · 추정/);
 h.XSa({contextUsage:{...usage,responsePerformance:undefined}});assert.equal(calculations,5);assert.equal(memoCalls.length,5);assert.equal(memoCalls.at(-1)[0],undefined);

});
test("timestamped TPS retains turns, clips weighted mode averages, and marks a waiting turn",()=>{
 const end=new Date(2026,9,23,12,40).getTime(),start=end-40*60000;
 const sample=(minute,outputTokens,requestDurationMs,mode)=>({minute,outputTokens,requestDurationMs,mode});
 const p={turnId:'waiting',startedAtUnixMs:end,observedAtUnixMs:end,outputTokens:0,requestDurationMs:0,completedRequests:0,unmeasuredRequests:0,graphEstimated:true,minuteSamples:[],history:[
  {turnId:'old',startedAtUnixMs:start-30000,minuteSamples:[sample(0,100,1000,'standard'),sample(1,100,3000,'standard'),sample(3,0,1000,'fast'),sample(4,400,1000,'fast'),sample(4,300,1000,'ultrafast'),sample(5,200,1000,null)]},
  {turnId:'prior',startedAtUnixMs:end-60000,minuteSamples:[sample(0,50,1000,'standard')]}
 ]};
 const graph=injection.responsePerformanceGraph(jsx,p,false,{Switch:'native-switch'}),svg=graph.props.children[1],shapes=svg.props.children;
 assert.equal(shapes.filter(n=>n?.type==='circle').length,7);assert.equal(shapes.filter(n=>n?.props['data-tps-join']).length,2);
 assert.equal(shapes.filter(n=>n?.props['data-turn-boundary']).length,2);
 assert.equal(shapes.find(n=>n?.props['data-turn-boundary']==='waiting').props.x1,264);
 assert.equal(shapes.filter(n=>n?.props['data-mode-average']).length,0);
 assert.equal(graph.props.children[4].props.children[1].props.checked,false);
 assert.match(graph.props['aria-label'],/Unknown mode: 200\.0 tokens\/s/);
 const timestamps=graph.props.children[2].props.children;assert.deepEqual(timestamps.map(n=>n.props.children),['12:39','12:40']);
 assert.ok(timestamps.every(n=>/^\d{2}:\d{2}$/.test(n.props.children)));
 const enabled=injection.responsePerformanceGraph(jsx,p,false,{averages:true}),means=enabled.props.children[1].props.children.filter(n=>n?.props['data-mode-average']);
 assert.equal(means.length,3);assert.equal(means.find(n=>n.props['data-mode-average']==='standard').props['data-tps'],200/4500*1000);
 assert.equal(means.find(n=>n.props['data-mode-average']==='fast').props['data-tps'],200);assert.equal(means.find(n=>n.props['data-mode-average']==='ultrafast').props.stroke,'var(--color-purple)');
 assert.match(JSON.stringify(enabled.props.children[5]),/Standard: 44\.4 tokens\/s/);
 assert.match(injection.responsePerformanceGraph(jsx,p,true).props['aria-label'],/최근 40분/);
 const onlyWaiting=injection.responsePerformanceGraph(jsx,{...p,history:[]},false);assert.equal(onlyWaiting.props.children[1].props.children.filter(n=>n?.type==='circle').length,0);
 const current=injection.responsePerformanceDescription(p,false);assert.equal(current,'Waiting for measurement');
 const unmeasured=injection.responsePerformanceGraph(jsx,{...p,graphEstimated:false},false);assert.equal(unmeasured.props.children[1].props.children.filter(n=>n?.type==='circle').length,7);assert.equal(unmeasured.props.children[1].props.children.find(n=>n?.props['data-turn-boundary']==='waiting').props.x1,264);
 const partialMinute=injection.responsePerformanceGraph(jsx,{...p,history:[],startedAtUnixMs:end-90000,minuteSamples:[sample(0,100,1000,'standard'),sample(1,300,1000,'standard')]},false,{averages:true});assert.equal(partialMinute.props.children[1].props.children.find(n=>n?.props['data-mode-average']==='standard').props['data-tps'],200);
 const closeStarts=injection.responsePerformanceGraph(jsx,{...p,history:[0,1,2].map(i=>({turnId:'close-'+i,startedAtUnixMs:end-3000+i*1000,minuteSamples:[]})),graphEstimated:false},false);const closeLabels=closeStarts.props.children[2].props.children;assert.equal(closeLabels.length,4);assert.deepEqual(closeLabels.map(n=>n.props['data-timestamp-row']),[0,1,2,3]);assert.ok(closeLabels.every(n=>/^\d{2}:\d{2}$/.test(n.props.children)));
 for(const patch of [{observedAtUnixMs:NaN},{startedAtUnixMs:end+1},{history:null},{history:[p.history[1],p.history[0]]},{minuteSamples:[sample(-1,1,1,'fast')]},{minuteSamples:[sample(0,1,0,'fast')]},{minuteSamples:[sample(0,1,1,'turbo')]},{minuteSamples:[sample(0,1,1,'fast'),sample(0,1,1,'fast')]}])assert.equal(injection.responsePerformanceGraph(jsx,{...p,...patch},false),null);
 const one=injection.responsePerformanceGraph(jsx,{...p,history:[],startedAtUnixMs:end-1000,minuteSamples:[sample(0,0,1000,'fast')]},false);assert.equal(one.props.children[1].props.children.find(n=>n?.type==='circle').props.cy,78);
 const multimode=injection.responsePerformanceGraph(jsx,{...p,history:[],startedAtUnixMs:end-60000,minuteSamples:[sample(0,100,1000,'standard'),sample(0,200,1000,'fast'),sample(0,300,1000,'ultrafast')]},false,{averages:true});assert.equal(multimode.props.children[1].props.children.filter(n=>n?.type==='circle').length,3);assert.equal(multimode.props.children[1].props.children.filter(n=>n?.props['data-tps-join']).length,0);
 const unknown=injection.responsePerformanceGraph(jsx,{...p,history:[],startedAtUnixMs:end-60000,minuteSamples:[{minute:0,outputTokens:1,requestDurationMs:1000}]},false,{averages:true});assert.equal(unknown.props.children[1].props.children.find(n=>n?.type==='circle').props['data-mode'],'unknown');assert.equal(unknown.props.children[1].props.children.filter(n=>n?.props['data-mode-average']).length,0);
});
test("disabled auto-compaction uses the second capacity lap only at the threshold",()=>{
 for(const [input,enabled,percent,lap] of [[599999,false,599999/600000*100,false],[600000,false,0,true],[800000,false,50,true],[1000000,false,100,true],[1200000,false,100,true],[600000,true,100,false],[800000,true,100,false]]){
  const p={...policy(input,"no-surcharge"),contextWindow:1000000,autoCompactTokenLimit:600000,autoCompactionEnabled:enabled};
  assert.deepEqual(injection.gaugeProgress(p,17),{percent,secondLap:lap});
  const tree=injection.decorateGauge(jsx,{type:"tooltip",props:{children:{type:"span",props:{children:"donut"}}}},p,false);
  assert.equal(tree.props.children.props['data-azrael-context-lap'],lap?'2':'1');assert.equal(tree.props.children.props['data-azrael-pricing-boundary'],String(lap));
 }
 assert.equal(injection.gaugeProgress({...policy(600000),contextWindow:600000,autoCompactTokenLimit:600000,autoCompactionEnabled:false},17).secondLap,false);
});
test("thread switch reads native snapshots, confirms save/readback, guards pending and isolates stale completion",async()=>{
 const ref={current:null},calls=[],threads=new Map([['a',false],['b',true]]),listeners=new Set();let resolveWrite,fail=false;
 const React={useState:()=>[0,()=>{}],useRef:()=>ref,useEffect(){}},manager={getConversation:id=>({latestThreadSettings:{autoCompactionEnabled:threads.get(id)}}),addConversationHistoryInvalidationListener:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},async sendRequest(method,params){calls.push({method,params});if(method==='thread/settings/update'){if(fail)throw Error('offline');await new Promise(r=>resolveWrite=r);threads.set(params.threadId,params.autoCompactionEnabled);return{}}return{thread:{autoCompactionEnabled:threads.get(params.threadId)}}}};
 const render=id=>injection.useThreadAutoCompaction(React,manager,id);
 let state=render('a');assert.equal(state.enabled,false);const save=state.save(true);await state.save(true);assert.equal(calls.length,1);assert.equal(render('a').pending,true);assert.equal(render('b').enabled,true);resolveWrite();await save;assert.equal(render('b').enabled,true);
 state=render('a');assert.equal(state.enabled,true);fail=true;await state.save(false);state=render('a');assert.equal(state.enabled,true);assert.equal(state.error,'save');assert.equal(injection.renderThreadAutoCompaction(jsx,'native-switch','native-button',state,'a',false).props.children[1].props.role,'alert');fail=false;const retry=state.retrySave();resolveWrite();await retry;assert.equal(render('a').enabled,false);
 const read=calls.find(e=>e.method==='thread/read');assert.deepEqual(read.params,{threadId:'a',includeTurns:false});assert.ok(calls.filter(e=>e.method==='thread/settings/update').every(e=>Object.keys(e.params).sort().join(',')==='autoCompactionEnabled,threadId'));
 assert.equal(render('b').enabled,true);state=render(null);assert.equal(injection.renderThreadAutoCompaction(jsx,'native-switch','native-button',state,null,false).props.children[0].props.children[1].props.disabled,true);
});
test("unavailable thread reads expose errors and retry with authoritative readback",async()=>{
 const ref={current:null},React={useState:()=>[0,()=>{}],useRef:()=>ref,useEffect(){}},calls=[];let fail=true;
 const manager={getConversation:()=>({latestThreadSettings:{}}),async sendRequest(method,params){calls.push({method,params});if(fail)throw Error('offline');return{thread:{autoCompactionEnabled:false}}}};
 const render=()=>injection.useThreadAutoCompaction(React,manager,'a');let state=render();assert.equal(state.error,'read');assert.equal(state.enabled,null);await state.retry();assert.equal(render().error,'read');fail=false;await render().retry();assert.equal(render().enabled,false);assert.equal(render().error,null);assert.ok(calls.every(e=>e.method==='thread/read'));
});
test("live confirmed thread settings repaint gauge without changing token metadata",()=>{
 const h=gaugeHarness(),usage=h.aCa({modelContextWindow:1000000,last:{totalTokens:800000},contextPolicy:{...policy(800000,'no-surcharge'),contextWindow:1000000,autoCompactTokenLimit:600000}});let enabled=true;
 h.Ou=()=>({get:atom=>atom===h.nA?{getConversation:()=>({latestThreadSettings:{autoCompactionEnabled:enabled}})}:"local"});assert.equal(h.XSa({conversationId:'a',contextUsage:usage}).props.children.props.children[1].props.percent,100);enabled=false;const gauge=h.XSa({conversationId:'a',contextUsage:usage});assert.equal(gauge.props.children.props.children[1].props.percent,50);assert.equal(gauge.props.children.props['data-azrael-context-lap'],'2');
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
  const h={Ar:{c:n=>{return slots}},Yt:()=>false,m:()=>false,rt:()=>({selectedHostId}),$:{jsx,jsxs:jsx},it:"title",ir:"about",Pn:"rules",vr:"memory",Er:"instructions",Jt:"layout",__AzraelContextSettings:"provider-settings",Symbol};
  pm.createContext(h);pm.runInContext(declaration(settings,"Tr"),h);
  const first=h.Tr();assert.equal(first.props.children[2],null);assert.equal(first.props.children[5].props.hostId,"first");assert.equal(h.Tr(),first,"unchanged host retains cache");
  selectedHostId="second";const second=h.Tr();assert.notEqual(second,first);assert.equal(second.props.children[2],null);assert.equal(second.props.children[5].props.hostId,"second");assert.equal(h.Tr(),second,"new host retains its updated cache");
});
test("provider controls inject only Personalization and preserve original bindings and instructions",()=>{

  const asset="webview/assets/agent-settings-4d2487cc749f.js",configuration=injection.injectProviderContext(hs.readFileSync(path.join(root,asset),"utf8"),asset).text;assert.equal(configuration,hs.readFileSync(path.join(root,asset),"utf8"));
});
test("all injected pinned assets are idempotent; targeted English and Korean labels retain RPC/link literals",()=>{for(const asset of [injection.CONTEXT_ASSET,injection.SETTINGS_ASSET,"webview/assets/ko-KR-ebd6264cb102.js"]){const s=hs.readFileSync(path.join(root,asset),"utf8"), first=injection.injectProviderContext(s,asset);assert.equal(injection.injectProviderContext(first.text,asset).text,first.text);}assert.throws(()=>injection.injectProviderContext("function aCa(e){}",injection.CONTEXT_ASSET),/anchor/);const settings=hs.readFileSync(path.join(root,injection.SETTINGS_ASSET),"utf8");for(const malformed of [settings.replace("function Tr(){","function Unknown(){"),settings+"function Tr(){let e=(0,Ar.c)(10)"])assert.throws(()=>injection.injectProviderContext(malformed,injection.SETTINGS_ASSET),/anchor/)});
test("combined namespace pipeline parses pinned settings/gauge and caches provider context metadata",()=>{
  const transformer=require("./namespace-azrael-host.cjs"),{createAssetTransformCache}=require("./asset-transform-cache.cjs"),crypto=require("node:crypto");
  const tsPath=path.resolve(process.argv[2]??require.resolve("typescript",{paths:[path.resolve(__dirname,"../extensions/azrael-ex")]})),ts=require(tsPath),sha=x=>crypto.createHash("sha256").update(x).digest("hex");
  const parent=path.resolve(__dirname,"../artifacts/logs/provider-context-policy");hs.mkdirSync(parent,{recursive:true});const directory=hs.mkdtempSync(path.join(parent,"ui-cache-"));
  try{const stats={hits:0,misses:0},options={cacheDirectory:directory,typescriptSha256:sha(hs.readFileSync(tsPath)),typescriptVersion:ts.version,transformRules:transformer.getTransformRules(),statistics:stats},cache=createAssetTransformCache(options);
    for(const asset of [injection.CONTEXT_ASSET,injection.SETTINGS_ASSET]){const s=hs.readFileSync(path.join(root,asset),"utf8"),transform=()=>transformer.transformAsset(s,asset,path.join(root,asset),ts),first=cache.run(asset,s,transform);assert.equal(ts.createSourceFile(asset,first.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0);const Dit=cache.run(asset,s,()=>{throw Error("cache missed")});assert.equal(Dit.text,first.text);}cache.flush();assert.equal(stats.hits,2);
  }finally{assert.ok(path.resolve(directory).startsWith(parent+path.sep));hs.rmSync(directory,{recursive:true})}
});

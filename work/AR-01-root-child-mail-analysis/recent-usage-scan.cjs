// Read-only local rollout audit. Output is a bounded aggregate, never a raw transcript.
const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const home = 'C:/Users/felre/.azrael-ex';
const since = Date.parse('2026-10-13T00:00:00+09:00');
const until = Date.now();
const db = new DatabaseSync(home + '/state_5.sqlite', { readOnly: true });
const threads = db.prepare('SELECT id,thread_source,agent_path,created_at_ms,rollout_path,model_provider FROM threads').all();
const byId = new Map(threads.map(t => [t.id, t]));
const selectedNames = new Set(['request_parent', 'await_parent_response', 'respond_to_request', 'send_message', 'followup_task', 'wait_agent']);
const report = { observedAt: new Date(until).toISOString(), since: new Date(since).toISOString(), scope: home, files: 0, bytes: 0, parseErrors: 0, fileErrors: [], ownCallExclusions: 0, calls: {}, daily: {}, childThreads: new Set(), rootThreads: new Set(), guidance: { structured: new Set(), fallback: new Set() }, structuredCalls: [], decisionMail: [], toolNames: new Set(), dbRequests: db.prepare('SELECT count(*) n FROM parent_requests').get().n, dbWaits: db.prepare('SELECT count(*) n FROM parent_response_waits').get().n };
const seen = new Set();
const ownCalls = new Map();
function compact(s, max=420) { return String(s || '').replace(/\s+/g, ' ').slice(0,max); }
function remember(list, value, max) { list.push(value); list.sort((a,b)=>b.timestamp.localeCompare(a.timestamp)); if(list.length>max) list.length=max; }
async function scan(file) {
  let threadId, meta, lineNo=0;
  report.files++; report.bytes += fs.statSync(file).size;
  for await (const line of readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) {
    lineNo++;
    if (!line.includes('session_meta') && !line.includes('function_call') && !line.includes('custom_tool_call') && !line.includes('parent_request_guidance')) continue;
    let e; try { e=JSON.parse(line); } catch {report.parseErrors++; continue;}
    // Forks may append inherited parent metadata after the child's authoritative header.
    if(e.type==='session_meta') { if(!meta) {meta=e.payload; threadId=meta.id || meta.session_id;} continue; }
    const t=byId.get(threadId); if(!t) continue;
    const ts=Date.parse(e.timestamp); if(!(ts>=since && ts<=until)) continue;
    const text=line.includes('parent_request_guidance') ? line : '';
    if(t.thread_source==='subagent' && text){
      if(text.includes('request_parent') && text.includes('await_parent_response')) report.guidance.structured.add(threadId);
      if(text.includes('PARTIAL') && /unavailable|unsupported|not available/.test(text)) report.guidance.fallback.add(threadId);
    }
    const p=e.payload;
    if(e.type!=='response_item' || !p) continue;
    if(p.type==='function_call_output' || p.type==='custom_tool_call_output') {
      const call=ownCalls.get(threadId+'|'+p.call_id); if(call && ['request_parent','await_parent_response','respond_to_request'].includes(call.tool)) call.output=compact(typeof p.output==='string'?p.output:JSON.stringify(p.output),900);
      continue;
    }
    if(!['function_call','custom_tool_call'].includes(p.type)) continue;
    if(t.thread_source==='subagent' && ts < Date.parse(meta.timestamp)) { report.ownCallExclusions++; continue; }
    const name=String(p.name||'').split(/[.:]/).pop();
    if(!selectedNames.has(name)) continue;
    const key=threadId+'|'+(p.call_id||e.timestamp+'|'+p.name);
    if(seen.has(key)) continue; seen.add(key);
    const role=t.thread_source==='subagent'?'child':'root';
    report[role==='child'?'childThreads':'rootThreads'].add(threadId);
    const countKey=role+':'+name;report.calls[countKey]=(report.calls[countKey]||0)+1;
    const day=new Date(ts+9*3600000).toISOString().slice(0,10);
    const daily=report.daily[day]??={};daily[countKey]=(daily[countKey]||0)+1;
    report.toolNames.add(p.name);
    let args;try{args=JSON.parse(p.arguments||p.input||'{}');}catch{args={raw:compact(p.arguments||p.input)}}
    const call={threadId,agentPath:t.agent_path,provider:t.model_provider,tool:name,namespace:p.namespace,timestamp:e.timestamp,file,line:lineNo,args};
    ownCalls.set(key,call);
    if(['request_parent','await_parent_response','respond_to_request'].includes(name)) report.structuredCalls.push(call);
    if(role==='child' && name==='send_message' && /root|\.\.|parent/.test(String(args.target)) && /승인|판단|결정|응답|approval|permission|decision|blocked|confirm/i.test(args.message||'')) {
      remember(report.decisionMail,{threadId,agentPath:t.agent_path,timestamp:e.timestamp,target:args.target,message:compact(args.message),file,line:lineNo},24);
    }
  }
}
(async()=>{
 for(let day=13;day<=19;day++) {
   const dir=home+`/sessions/2026/10/${day}`;
   for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.jsonl')).sort()) {
     try{await scan(path.join(dir,f));}catch(error){report.fileErrors.push({file:f,error:String(error)});}
   }
 }
 for(const k of ['childThreads','rootThreads','toolNames']) report[k]=[...report[k]];
 for(const k of ['structured','fallback']) report.guidance[k]=[...report.guidance[k]];
 const out=path.resolve(__dirname,'../../artifacts/logs/parent-request-usage-20261019/usage.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({out,...report,structuredCalls:report.structuredCalls.slice(0,5),decisionMail:report.decisionMail.slice(0,3),childThreads:report.childThreads.length,rootThreads:report.rootThreads.length,guidance:{structured:report.guidance.structured.length,fallback:report.guidance.fallback.length}},null,2));
})();

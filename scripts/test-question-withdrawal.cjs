"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {QUESTION_WITHDRAWAL_ASSETS, QUESTION_WITHDRAWAL_MARKER, QUESTION_BOUNDARY, injectQuestionWithdrawal} = require("./inject-question-withdrawal.cjs");
const root = path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434");
const sources = QUESTION_WITHDRAWAL_ASSETS.map(asset => {
  const input = fs.readFileSync(path.join(root, asset), "utf8"), result = injectQuestionWithdrawal(input, asset);
  assert.equal(result.count, 1);
  assert.deepEqual(injectQuestionWithdrawal(result.text, asset), {text: result.text, count: 0});
  assert.throws(() => injectQuestionWithdrawal(input + QUESTION_WITHDRAWAL_MARKER, asset), /Incomplete/);
  const damaged = result.text.replace(asset === QUESTION_WITHDRAWAL_ASSETS[0] ? "withdrawn:e.withdrawn" : "철회된 질문", "missing-required-output");
  assert.throws(() => injectQuestionWithdrawal(damaged, asset), /Incomplete/);
  assert.throws(() => injectQuestionWithdrawal(result.text + QUESTION_WITHDRAWAL_MARKER, asset), /Duplicate/);
  assert.throws(() => injectQuestionWithdrawal("changed upstream", asset), /exactly once/);
  return result.text;
});
assert.deepEqual(injectQuestionWithdrawal("unrelated", "unknown.js"), {text: "unrelated", count: 0});
function fn(source, name) {
  const start = source.indexOf("function " + name + "("), end = source.indexOf("function ", start + 9);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}
const context = vm.createContext({Eje: (id, i) => JSON.stringify(["request_user_input_async", id, i])});
vm.runInContext(["qv", "Jv", "Lit"].map(name => fn(sources[0], name)).join("\n"), context);
const item = {id: "original", type: "agentMessage", questions: [{title:"First",withdrawn:true},{title:"Second"},{title:"Third",withdrawn:true}]};
context.item = item;
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(vm.runInContext("Jv(item).map(q=>[q.id,q.questionIndex,q.title])", context)), [[JSON.stringify(["request_user_input_async","original",1]),1,"Second"]]);
assert.equal(vm.runInContext("Jv(item,true).length", context), 3);
assert.equal(vm.runInContext("Lit([item]).length", context), 1);
item.questions[1].withdrawn = true;
assert.equal(vm.runInContext("Lit([item]).length", context), 0);
assert.equal(vm.runInContext("Jv({...item,questions:[]}).length", context), 0);
// Exercise the native reconciler: it owns selection closure and stale draft removal.
const oldIds = item.questions.map((_, i) => context.Eje(item.id, i));
const selected = {selectedQuestionKey:{entityKey:"history",itemId:oldIds[1]},questionIds:oldIds};
const values = new Map(oldIds.map(id=>[id,{draft:"unsent",title:"old",draftBaseline:"",lastSubmission:null,turnId:"turn"}]));
let panel=selected, listed=oldIds;
Object.assign(context, {
  D_t:()=>({answersByQuestionItemId:new Map}),pt:(_scope,fn)=>fn(),
  HD:{resolve:()=>({get:()=>new Map([["thread",panel]])})},
  BD:{resolve:()=>({get:()=>listed})}, VD:{resolve:(_n,_c,key)=>({get:()=>values.get(key.itemId)})},
  RD:(_scope,_key,value)=>{panel=value},
  scope:{node:{},chain:{},set(atom,key,value){if(atom===context.BD)listed=value;else values.set(key.itemId,value)}},
  key:{hostId:"local",threadId:"thread",entityKey:"history"},turn:{turnId:"turn",items:[item]}
});
vm.runInContext(fn(sources[0], "rRt")+";rRt(scope,key,turn)",context);
assert.equal(panel,null);assert.equal(listed.length,0);assert.ok([...values.values()].every(v=>v===null));
item.questions[1].withdrawn=false;listed=oldIds;panel=selected;
vm.runInContext("rRt(scope,key,turn)",context);
assert.equal(panel.selectedQuestionKey.itemId,oldIds[1]);assert.deepEqual(plain(panel.questionIds),[oldIds[1]]);
assert.equal(values.get(oldIds[1]).title,"Second");
assert.ok(sources[0].includes("e=>qv(e)?[e.id,...Jv(e,!0).map(e=>e.id)]"),"reply parser retains withdrawn IDs");
assert.ok(sources[0].includes("d&&qv(n)?w.push(...Jv(n,!0).map"),"projection retains history");
// Historical replies still belong to their original question after withdrawal.
context.BAe = text => JSON.parse(text.slice(34,-35));
context.reply = {id:"reply",type:"userMessage",content:[{type:"text",text:"<send_user_message_question_reply>\n"+JSON.stringify([{questionItemId:oldIds[0],question:"First",answer:"Saved answer"}])+"\n</send_user_message_question_reply>"}]};
vm.runInContext(fn(sources[0], "D_t"), context);
assert.equal(vm.runInContext("D_t([item,reply]).answersByQuestionItemId.get(reply.content&&JSON.parse(reply.content[0].text.slice(34,-35))[0].questionItemId)", context),"Saved answer");
assert.ok(vm.runInContext("D_t([item,reply]).replyItemIds.has('reply')", context));
const boundary=vm.createContext({oO:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},Ji:{},Be:()=>item,__azraelActiveQuestionItem:()=>{},props:{historyEntityKey:"history",item:{type:"assistant-message",searchItemId:oldIds[0],content:"Old title",requestUserInputAsync:{sourceItemId:item.id,questionIndex:0}}}});
vm.runInContext(QUESTION_BOUNDARY,boundary);
assert.equal(vm.runInContext("__azraelQuestionBoundary(props).type",boundary),"details");
assert.equal(vm.runInContext("__azraelQuestionBoundary(props).props.children[0].props.children",boundary),"철회된 질문");
assert.equal(vm.runInContext("__azraelQuestionBoundary(props).props.children[1].props.children",boundary),"First");
item.questions[0].withdrawn=false;
boundary.props.item.requestUserInputAsync.withdrawn=true;
assert.equal(vm.runInContext("__azraelQuestionBoundary(props).type===__azraelActiveQuestionItem",boundary),true,"authoritative source wins over stale projection");
boundary.props.item={type:"assistant-message",content:"Ordinary question?"};
assert.equal(vm.runInContext("__azraelQuestionBoundary(props).type===__azraelActiveQuestionItem",boundary),true,"ordinary text is never question detection");
console.log("Question withdrawal: pinned guards, idempotency, stable partial indexes, history/replies, native panel/draft reconciliation passed");

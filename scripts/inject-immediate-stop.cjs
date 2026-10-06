"use strict";
const { createImmediateStopCoordinator } = require("./immediate-stop.cjs");
const IMMEDIATE_STOP_ASSET = "webview/assets/app-initial-efe028fd535e.js";
const IMMEDIATE_STOP_MARKER = "/*azrael-immediate-stop-v1*/";

function once(text, before, after) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw Error(`Immediate stop anchor must occur once (found ${count}): ${before.slice(0, 90)}`);
  return text.replace(before, after);
}

function injectImmediateStop(text, asset) {
  if (asset !== IMMEDIATE_STOP_ASSET) return { text, count: 0 };
  const patches = [
    ["async function oOn(e,t){let n=e.observeRequest();try{return await sOn(e,n,t)}catch(e){throw n.cancel(),e}}", "async function oOn(e,t){let n=e.observeRequest();return __azraelImmediateStop.trackStart(e.manager,e.conversationId,e.clientUserMessageId,async()=>{try{return await sOn(e,n,t)}catch(e){throw n.cancel(),e}})}"],
    ["let i=()=>LSn({logger:this.logger,", "let i=()=>__azraelImmediateStop.stop(this,e,n,t===`user-stop`,__azraelExpectedTurnId=>LSn({logger:this.logger,"],
    ["conversationState:this.conversations.get(e),expectedTurnId:n,sendInterruptRequest:(e,t)=>this.sendRequest(`turn/interrupt`,{threadId:e,turnId:t}),updateConversationState:(e,t)=>this.updateConversationState(e,t)});if(n!=null)return i();",
      "conversationState:this.conversations.get(e),expectedTurnId:__azraelExpectedTurnId,sendInterruptRequest:(e,r)=>t===`user-stop`&&n==null?__azraelImmediateStop.interrupt(this,e,r,(e,t)=>this.sendRequest(`turn/interrupt`,{threadId:e,turnId:t}),(m,id)=>{let s=m.getConversation(id);return s==null?null:gZ(s).at(-1)??null}):this.sendRequest(`turn/interrupt`,{threadId:e,turnId:r}),updateConversationState:(e,t)=>this.updateConversationState(e,t)}),(m,id)=>{let s=m.getConversation(id);return s==null?null:gZ(s).at(-1)??null});if(n!=null)return i();"]
  ];
  const bootstrap = `\n${IMMEDIATE_STOP_MARKER}\nvar __azraelImmediateStop=(${createImmediateStopCoordinator.toString()})();\n`;
  const markers = text.split(IMMEDIATE_STOP_MARKER).length - 1;
  if (markers > 1) throw Error("Duplicate immediate stop marker");
  if (markers === 1) {
    for (const [before, after] of patches) {
      if (text.includes(before) || text.split(after).length - 1 !== 1) throw Error("Damaged immediate stop marked anchor");
    }
    if (text.split(bootstrap).length - 1 !== 1) throw Error("Damaged immediate stop marked bootstrap");
    return { text, count: 0 };
  }
  for (const [before, after] of patches) text = once(text, before, after);
  text += bootstrap;
  return { text, count: 1 };
}
module.exports = { IMMEDIATE_STOP_ASSET, IMMEDIATE_STOP_MARKER, injectImmediateStop };

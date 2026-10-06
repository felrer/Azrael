"use strict";

const { inheritThreadBranchSelection } = require("./thread-branch.cjs");
const { createProviderModelCatalog } = require("./provider-model-picker.cjs");
const THREAD_BRANCH_ASSET = "webview/assets/app-initial-efe028fd535e.js";
const THREAD_BRANCH_MARKER = "/*azrael-thread-branch-v1*/";

function once(text, before, after) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`Thread branch anchor must occur once (found ${count}): ${before.slice(0, 90)}`);
  return text.replace(before, after);
}

function injectThreadBranch(text, asset) {
  if (asset !== THREAD_BRANCH_ASSET) return { text, count: 0 };
  const markers = text.split(THREAD_BRANCH_MARKER).length - 1;
  if (markers === 1) return { text, count: 0 };
  if (markers > 1) throw new Error("Duplicate thread branch marker");
  text = once(text, "let p=o.getConversation(l.sourceConversationId),m=null;",
    "let p=o.getConversation(l.sourceConversationId);l=await __azraelInheritBranch(l,p,r,async()=>" +
    "(await __azraelBranchCatalog.query(o.getHostId(),()=>o,100,undefined,{priority:`background`})).data);let m=null;");
  text = once(text, "threadSource:t.threadSource??`user`,model:t.model??void 0,config:",
    "threadSource:t.threadSource??`user`,model:t.model??void 0,modelProvider:t.modelProvider??void 0,deferGoalContinuation:t.deferGoalContinuation??void 0,config:");
  text = once(text, "{conversationId:b,model:null,serviceTier:y.serviceTier,reasoningEffort:null,workspaceRoots:",
    "{conversationId:b,model:l.model??null,serviceTier:y.serviceTier,reasoningEffort:l.reasoningEffort??null,workspaceRoots:");
  text = once(text, "...l.reasoningEffort==null?{}:{effort:l.reasoningEffort}", "...l.reasoningEffort===void 0?{}:{effort:l.reasoningEffort}");
  text += `\n${THREAD_BRANCH_MARKER}\nvar __azraelBranchCatalog=globalThis.__azraelProviderCatalogV1??=((${createProviderModelCatalog.toString()})());\nvar __azraelInheritBranch=(${inheritThreadBranchSelection.toString()});\n`;
  return { text, count: 1 };
}

module.exports = { THREAD_BRANCH_ASSET, THREAD_BRANCH_MARKER, injectThreadBranch };

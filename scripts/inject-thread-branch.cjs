"use strict";

const { inheritThreadBranchSelection } = require("./thread-branch.cjs");
const { createProviderModelCatalog } = require("./provider-model-picker.cjs");
const THREAD_BRANCH_ASSET = "webview/assets/app-initial-97d3534ad35f.js";
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
  text = once(text, "let f=o.getConversation(c.sourceConversationId),p=null;",
    "let f=o.getConversation(c.sourceConversationId);c=await __azraelInheritBranch(c,f,r,async()=>" +
    "(await __azraelBranchCatalog.query(o.getHostId(),()=>o,100,undefined,{priority:`background`})).data);let p=null;");
  text = once(text, "threadSource:t.threadSource??`user`,model:t.model??void 0,config:",
    "threadSource:t.threadSource??`user`,model:t.model??void 0,modelProvider:t.modelProvider??void 0,deferGoalContinuation:t.deferGoalContinuation??void 0,config:");
  text = once(text, "{conversationId:y,model:null,serviceTier:v.serviceTier,reasoningEffort:null,workspaceRoots:",
    "{conversationId:y,model:c.model??null,serviceTier:v.serviceTier,reasoningEffort:c.reasoningEffort??null,workspaceRoots:");
  text = once(text, "...c.reasoningEffort==null?{}:{effort:c.reasoningEffort}", "...c.reasoningEffort===void 0?{}:{effort:c.reasoningEffort}");
  text += `\n${THREAD_BRANCH_MARKER}\nvar __azraelBranchCatalog=globalThis.__azraelProviderCatalogV1??=((${createProviderModelCatalog.toString()})());\nvar __azraelInheritBranch=(${inheritThreadBranchSelection.toString()});\n`;
  return { text, count: 1 };
}

module.exports = { THREAD_BRANCH_ASSET, THREAD_BRANCH_MARKER, injectThreadBranch };

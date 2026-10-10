"use strict";

const QUEUED_COMPACTION_CORE_ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const QUEUED_COMPACTION_PRESENTATION_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const QUEUED_COMPACTION_LIST_ASSET = "webview/assets/queued-message-list-616ed03f7f35.js";
const QUEUED_COMPACTION_EXPECTED_COUNTS = Object.freeze({ core: 1, presentation: 1, list: 1 });

// Selecting an inline command clears its text before awaiting the host RPC.
// Keep custody of that action so a second submit cannot send the remaining
// draft and attachments while the compaction request is still in flight.
const COMPOSER_COMPACTION_HELPERS = `const __azraelCompactActions=new WeakMap;
function __azraelCompactAction(controller,action){let pending=__azraelCompactActions.get(controller);if(pending)return pending;pending=Promise.resolve().then(action).finally(()=>{if(__azraelCompactActions.get(controller)===pending)__azraelCompactActions.delete(controller)});__azraelCompactActions.set(controller,pending);return pending}
function __azraelRunSlashSelection(command,controller,action){return command.id===\`compact\`?__azraelCompactAction(controller,action):action()}
async function __azraelSubmitCompaction(scope,controller,threadId,hostId,text,override){if(threadId==null)throw Error(\`Context compaction requires an existing conversation\`);await __azraelCompactAction(controller,async()=>{await Px(scope,hostId).compactThread(threadId);if(override==null&&controller.getText()===text)controller.setText(text.replace(/^\\s*\\/compact[ \\t]*/,\`\`))})}`;

function apply(text, owner, edits, version = 1) {
  const marker = `/*azrael-queued-compaction-${owner}-v${version}*/`;
  if (Array.from({ length: version - 1 }, (_, index) => index + 1).some(old => text.includes(`/*azrael-queued-compaction-${owner}-v${old}*/`))) {
    throw new Error(`Stale queued-compaction ${owner} transform; use the pinned original asset`);
  }
  const count = text.split(marker).length - 1;
  if (count === 1) return { text, count: 0 };
  if (count !== 0) throw new Error(`Duplicate queued-compaction ${owner} marker`);
  for (const [anchor, replacement] of edits) {
    const found = text.split(anchor).length - 1;
    if (found !== 1) throw new Error(`Pinned queued-compaction ${owner} anchor must occur exactly once: found ${found}: ${anchor.slice(0, 90)}`);
    text = text.replace(anchor, replacement.replace("$MARKER", marker));
  }
  return { text, count: 1 };
}

function injectQueuedCompactionCore(text) {
  return apply(text, "core", [[
    "i(t);try{await e.sendRequest(`thread/compact/start`,{threadId:t})}catch(e){throw a(t),e}",
    "$MARKERif(e.turnCoordinator.serverQueue?.isEnabled(t)!==!0)throw Error(`Queued context compaction is unavailable on this host`);await e.turnCoordinator.loadMessages(t);if((e.turnCoordinator.readState()?.[t]?.length??0)!==0)throw Error(`Existing queued messages must complete or be cancelled before queuing context compaction`);await e.sendRequest(`thread/queue/add`,{threadId:t,input:[],clientUserMessageId:crypto.randomUUID(),kind:`contextCompaction`})",
  ]]);
}

function injectQueuedCompactionPresentation(text) {
  const result = apply(text, "presentation", [
    ["u=r=>t.getConversation(r)?.ephemeral!==!0&&(i?Gf(e,`1189013788`):Gf(e,`2120612410`)&&Sy(n(),`threadQueue`))", "u=r=>t.getConversation(r)?.ephemeral!==!0&&(i?Gf(e,`1189013788`):Sy(n(),`threadQueue`))"],
    ["function ysn(e,t,n){let{rawText:r,appInput:i}=Apt({input:n.input})", "function ysn(e,t,n){$MARKERif(n.kind===`contextCompaction`)return{id:n.id,text:`컨텍스트 압축`,context:{queuedOperationKind:`contextCompaction`,prompt:``,addedFiles:[],fileAttachments:[],ideContext:null,imageAttachments:[]},cwd:e.getConversationCwd(t)??`/`,createdAt:0};let{rawText:r,appInput:i}=Apt({input:n.input})"],
    ["if(r){i.get(hx).danger(a.formatMessage({id:`composer.compactSlashCommand.disabledInProgressToast`,defaultMessage:`Compact is disabled while a chat is in progress`,description:`Toast shown when the compact slash command is used while a task is already in progress`}),{errorAnalytics:{toastId:`composer.compactSlashCommand.disabledInProgressToast`}});return}n!=null&&await", "n!=null&&await"],
    ["await I2i(r,{queryRange:{from:t,to:u.range.to},replacementRange:u.range},{clearReplacementRange:()=>n.clearSuggestion(u),insertMention:e=>{e.onSelectFromInlineSlash(u)},openSubmenu:e=>{n.setSuggestionSource(e,u)},replaceQuery:e=>{n.completeSuggestionQuery(e,u)}})", "await __azraelRunSlashSelection(e,n,()=>I2i(r,{queryRange:{from:t,to:u.range.to},replacementRange:u.range},{clearReplacementRange:()=>n.clearSuggestion(u),insertMention:e=>{e.onSelectFromInlineSlash(u)},openSubmenu:e=>{n.setSuggestionSource(e,u)},replaceQuery:e=>{n.completeSuggestionQuery(e,u)}}))"],
    ["if(e.get(dq))return;d();", "if(e.get(dq))return;d();if(__azraelCompactActions.has(p))return;if(!be&&t==null&&ue.type===`local`&&/^\\s*\\/compact(?=\\s|$)/.test(Se??p.getText())){try{await __azraelSubmitCompaction(e,p,m??y?.localConversationId,E,Se??p.getText(),Se)}catch(error){C(error)}return}"],
    // Preserve the declaration of every comma-separated local after h. Leaving
    // the original comma after a throw turns the initializer into its operand.
    ["y=async(e,n,a,o,s,c)=>{let d=await _(e),g=a?.messageId", "y=async(e,n,a,o,s,c)=>{let d=await _(e);if(d.items.find(e=>e.id===a?.messageId)?.kind===`contextCompaction`)throw Error(`Queued compaction cannot be edited`);let g=a?.messageId"],
    ["clientUserMessageId:s?.clientUserMessageId??T.id})).queuedSubmission", "clientUserMessageId:s?.clientUserMessageId??T.id,kind:s?.kind??T.context.queuedOperationKind??`userInput`})).queuedSubmission"],
    ["if(t.isConversationStreaming(e)){if(h=await i({...d,serverQueuedMessageId:c.id},c.clientUserMessageId,m),", "if(t.isConversationStreaming(e)){if(c.kind===`contextCompaction`)return null;if(h=await i({...d,serverQueuedMessageId:c.id},c.clientUserMessageId,m),"],
    ["let{turn:r}=await t.sendRequest(`thread/queue/start`,{threadId:e,queuedSubmissionId:n});h={status:`sent`,messageId:n,turnId:r.id}", "let{turn:r,skipped:i}=await t.sendRequest(`thread/queue/start`,{threadId:e,queuedSubmissionId:n});if(i!==!0&&r==null)throw Error(`Queue start returned no turn without skipping`);h=i?{status:`sent`,messageId:n}:{status:`sent`,messageId:n,turnId:r.id}"],
  ], 3);
  if (result.count) result.text += "\n" + COMPOSER_COMPACTION_HELPERS + "\n";
  // A marker proves that a transform ran, not that its declarations survived.
  // Check reused assets too: the enqueue guard must end before the local let.
  const declaration = "throw Error(`Queued compaction cannot be edited`);let g=a?.messageId";
  if (result.text.split(declaration).length - 1 !== 1) {
    throw new Error("Invalid queued-compaction presentation enqueue declaration; use the pinned original asset");
  }
  if (result.text.split(COMPOSER_COMPACTION_HELPERS).length !== 2 || !result.text.includes("await __azraelRunSlashSelection(e,n,()=>I2i(") || !result.text.includes("if(__azraelCompactActions.has(p))return;if(!be&&t==null&&ue.type===`local`&&/^\\s*\\/compact(?=\\s|$)/.test(Se??p.getText()))")) {
    throw new Error("Invalid queued-compaction composer isolation; use the pinned original asset");
  }
  return result;
}

function injectQueuedCompactionList(text) {
  const edits = [[
    "isSendNowDisabled:l||u&&H(e.context),onEditMessage:m,onDeleteMessage:h,onOpenInSideChatMessage:g,onSendNowMessage:_,onQueueingChange:v},e.clientUserMessageId??e.id)",
    "$MARKERisSendNowDisabled:l||u&&H(e.context)||e.context.queuedOperationKind===`contextCompaction`,onEditMessage:e.context.queuedOperationKind===`contextCompaction`?void 0:m,onDeleteMessage:h,onOpenInSideChatMessage:e.context.queuedOperationKind===`contextCompaction`?void 0:g,onSendNowMessage:_,onQueueingChange:v},e.clientUserMessageId??e.id)",
  ], [
    "className:`sr-only select-none`,role:`status`,children:(0,$.jsx)(c,{id:`composer.queuedMessage.sending`,defaultMessage:`Sending`,description:`Status of a locally saved message waiting for the app server to accept it`})",
    "className:`text-text-tertiary text-xs select-none shrink-0`,role:`status`,\"aria-live\":`polite`,children:(0,$.jsx)(c,{id:`azrael.queuedMessage.awaitingAcceptance`,defaultMessage:`전송 대기 중`,description:`Status of a locally saved message waiting for the engine to accept it`})",
  ]];
  const result = apply(text, "list", edits, 2);
  // Reused assets must contain every complete replacement, not only the marker.
  for (const [, replacement] of edits) {
    const expected = replacement.replace("$MARKER", "/*azrael-queued-compaction-list-v2*/");
    if (result.text.split(expected).length - 1 !== 1) {
      throw new Error("Invalid queued-compaction list replacement; use the pinned original asset");
    }
  }
  return result;
}

module.exports = { QUEUED_COMPACTION_CORE_ASSET, QUEUED_COMPACTION_PRESENTATION_ASSET, QUEUED_COMPACTION_LIST_ASSET, QUEUED_COMPACTION_EXPECTED_COUNTS, injectQueuedCompactionCore, injectQueuedCompactionPresentation, injectQueuedCompactionList };

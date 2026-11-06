"use strict";

// Also embedded in the native webview; keep this closure free of Node dependencies.
function createApprovalProjection({ registry = () => ({ teams: [] }), schedule = queueMicrotask, turns = c => c.turns ?? [], parent = c => c?.parentThreadId ?? c?.source?.subAgent?.thread_spawn?.parent_thread_id } = {}) {
  const managers = new Set();
  const queued = new Set();
  let reconciling = false;
  const isApproval = r => ["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval", "mcpServer/elicitation/request"].includes(r?.method);
  function owner(manager, threadId) {
    if (registry() == null) return null;
    const hostId = manager.params?.hostId;
    if (typeof hostId !== "string" || !hostId) return null;
    const teams = registry()?.teams?.filter(t => t.hostId === hostId) ?? [];
    const seen = new Set();
    let current = threadId;
    while (current && !seen.has(current)) {
      seen.add(current);
      const team = teams.find(t => t.leadId === current || t.memberIds?.includes(current));
      if (team) return team.leadId;
      const conversation = manager.conversations.get(current);
      if (!conversation) return null;
      const ancestor = parent(conversation);
      if (!ancestor) return current;
      current = ancestor;
    }
    return null;
  }
  function sync(manager) {
    if (reconciling) return;
    reconciling = true;
    try {
      const desired = new Map();
      for (const [threadId, conversation] of manager.conversations) {
        const leadId = owner(manager, threadId);
        for (const request of conversation.requests ?? []) {
          if (request.__azraelTeamApproval || request.completed === true || !isApproval(request) || leadId === threadId) continue;
          const lead = manager.conversations.get(leadId);
          if (!lead) continue; // Never turn an unavailable owner into an approval.
          const id = "azrael-team-approval:" + JSON.stringify([manager.params.hostId, threadId, request.id]);
          const turn = turns(conversation).find(t => t.turnId === request.params.turnId);
          const projectedTurnId = turn ? id + ":turn" : request.params.turnId;
          const meta = request.params._meta;
          const mirror = { ...request, __azraelTeamApprovalHidden: false, id, params: { ...request.params, turnId: projectedTurnId, reason: `Session ${threadId}${request.params.reason ? ": " + request.params.reason : ""}`, ...(request.method === "mcpServer/elicitation/request" ? {message:`Session ${threadId}\n${request.params.message ?? ""}`, ...(Array.isArray(meta?.tool_params_display) ? {_meta:{...meta,tool_params_display:meta.tool_params_display.map(p=>p.name==="app"?{...p,value:`${p.value} · Session ${threadId}`}:p)}} : {})} : {}) }, __azraelTeamApproval: { hostId: manager.params.hostId, threadId, requestId: request.id, method: request.method, leadId, turn: turn ? { turnId: projectedTurnId, params:{cwd:turn.params?.cwd}, items:request.method === "item/fileChange/requestApproval" ? turn.items.filter(i=>i.type==="fileChange"&&i.id===request.params.itemId) : [] } : null } };
          if (!desired.has(leadId)) desired.set(leadId, []);
          desired.get(leadId).push(mirror);
        }
      }
      for (const [threadId, conversation] of manager.conversations) {
        const leadId = owner(manager, threadId);
        const requests = (conversation.requests ?? []).filter(r => !r.__azraelTeamApproval).map(r => {
          const hidden = isApproval(r) && leadId !== threadId;
          if (!!r.__azraelTeamApprovalHidden === hidden) return r;
          const { __azraelTeamApprovalHidden: _, ...native } = r;
          return hidden ? { ...native, __azraelTeamApprovalHidden: true } : native;
        }).concat(desired.get(threadId) ?? []);
        if (JSON.stringify(requests) !== JSON.stringify(conversation.requests)) manager.updateConversationState(threadId, state => { state.requests = requests; }, { broadcastPatchesToFollowers: false });
      }
    } finally { reconciling = false; }
  }
  function observe(manager) {
    managers.add(manager);
    if (reconciling || queued.has(manager)) return;
    queued.add(manager);
    schedule(() => { queued.delete(manager); sync(manager); });
  }
  function refresh() { for (const manager of managers) observe(manager); }
  return { owner, observe, sync, refresh, isApproval };
}

function approvalSelectorInputs(requests, turns) {
  const visible = requests.filter(r => !r.__azraelTeamApprovalHidden);
  return [visible, turns.concat(visible.flatMap(r => r.__azraelTeamApproval?.turn ? [r.__azraelTeamApproval.turn] : []))];
}

function approvalResponseOrigin(context, conversationId, requestId) {
  const request = context.getConversationRequests(conversationId).find(r => r.id === requestId);
  const source = request?.__azraelTeamApproval;
  if (!source) return { conversationId, requestId };
  if (source.leadId !== conversationId || source.hostId !== context.hostId) return null;
  const original = context.getConversationRequests(source.threadId).find(r => r.id === source.requestId && r.method === source.method && r.completed !== true && !r.__azraelTeamApproval);
  return original ? { conversationId: source.threadId, requestId: source.requestId } : null;
}

module.exports = { createApprovalProjection, approvalSelectorInputs, approvalResponseOrigin };

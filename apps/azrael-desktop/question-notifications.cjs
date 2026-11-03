"use strict";

// Only host-delivered native events create reminders. Renderer text cannot
// manufacture a question or resolve one before the engine accepts its reply.
function createQuestionNotifications({ Notification, activate, onError = () => {} }) {
  const panels = new Map();
  let disposed = false;
  function state(panel) {
    if (!panels.has(panel)) panels.set(panel, { pending: new Map(), seen: new Set() });
    return panels.get(panel);
  }
  const key = (host, thread, id) => JSON.stringify([host, thread, id]);
  function remove(s, id) {
    const record = s.pending.get(id);
    if (!record) return;
    s.pending.delete(id);
    try { record.notification.close(); } catch (error) { onError(error); }
  }
  function show(panel, s, id, hostId, threadId) {
    if (disposed || s.seen.has(id)) return;
    s.seen.add(id);
    try {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title: "Azrael · Agent 질문", body: "Agent가 답변을 기다리고 있습니다. 클릭하여 대화를 열어주세요.", silent: false });
      const record = { notification, hostId, threadId };
      s.pending.set(id, record);
      notification.on("click", () => {
        if (!disposed && s.pending.get(id) === record) activate(panel, hostId, threadId);
      });
      notification.on("failed", (_event, error) => { remove(s, id); onError(error); });
      notification.show();
    } catch (error) { remove(s, id); onError(error); }
  }
  function observe(panel, envelope) {
    if (disposed || !envelope) return;
    const hostId = envelope.hostId;
    if (typeof hostId !== "string" || !hostId) return;
    if (envelope.type === "codex-app-server-fatal-error") {
      const s = panels.get(panel);
      if (s) for (const [id, record] of s.pending) if (record.hostId === hostId) remove(s, id);
      return;
    }
    if (!["mcp-request", "mcp-notification"].includes(envelope.type)) return;
    const message = envelope.type === "mcp-request" ? envelope.request : envelope.notification ?? envelope;
    const p = message?.params, threadId = p?.threadId;
    const s = state(panel);
    if (envelope.type === "mcp-request") {
      if (message?.method === "item/tool/requestUserInput" && typeof threadId === "string" && threadId && message.id != null) {
        show(panel, s, key(hostId, threadId, ["request", message.id]), hostId, threadId);
      }
      return;
    }
    if (message?.method === "serverRequest/resolved") {
      // Request IDs are scoped to the host connection. Some pinned versions
      // omit threadId from the resolved event.
      for (const [id, record] of s.pending) {
        const identity = JSON.parse(id)[2];
        if (record.hostId === hostId && identity[0] === "request" && identity[1] === p?.requestId && (!threadId || record.threadId === threadId)) remove(s, id);
      }
    }
    if (typeof threadId !== "string" || !threadId) return;
    if (["thread/closed", "thread/archived", "thread/deleted"].includes(message?.method)) {
      for (const [id, record] of s.pending) if (record.hostId === hostId && record.threadId === threadId) remove(s, id);
    }
    if (message?.method !== "item/completed") return;
    const item = p.item;
    if (item?.type === "agentMessage" && Array.isArray(item.questions) && typeof item.id === "string") {
      item.questions.forEach((question, index) => {
        const id = key(hostId, threadId, ["request_user_input_async", item.id, index]);
        if (question.withdrawn === true) { s.seen.add(id); remove(s, id); }
        else show(panel, s, id, hostId, threadId);
      });
    }
    if (item?.type === "userMessage" && Array.isArray(item.content)) {
      for (const input of item.content) {
        if (input.type !== "text" || typeof input.text !== "string") continue;
        let text = input.text.trim();
        if (text.startsWith("# Context from my IDE setup:\n")) text = text.split("\n## My request for Codex:\n").at(-1).trim();
        const prefix = "<send_user_message_question_reply>", suffix = "</send_user_message_question_reply>";
        if (!text.startsWith(prefix) || !text.endsWith(suffix)) continue;
        try {
          const replies = JSON.parse(text.slice(prefix.length, -suffix.length));
          for (const reply of Array.isArray(replies) ? replies : [replies]) {
            const identity = JSON.parse(reply.questionItemId);
            if (!Array.isArray(identity) || identity[0] !== "request_user_input_async") continue;
            const id = key(hostId, threadId, identity);
            s.seen.add(id); remove(s, id);
          }
        } catch { /* Invalid reply text does not settle a reminder. */ }
      }
    }
  }
  function disposePanel(panel) {
    const s = panels.get(panel);
    if (s) for (const id of s.pending.keys()) remove(s, id);
    panels.delete(panel);
  }
  return { observe(panel, envelope) { try { observe(panel, envelope); } catch (error) { onError(error); } }, disposePanel, dispose() { disposed = true; for (const panel of panels.keys()) disposePanel(panel); } };
}
module.exports = { createQuestionNotifications };

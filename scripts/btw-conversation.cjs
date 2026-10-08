"use strict";

// Serialized into the pinned UI. State belongs to the UI lifetime, never to the
// parent transcript, queue, settings, or agent mailbox.
function createBtwController() {
  const children = new Map(), parents = new Map(), pending = new Set();
  const key = (host, parent) => JSON.stringify([host, parent]);
  const parse = text => /^\s*\/btw(?:\s+([\s\S]*?))?\s*$/.exec(text);
  const references = messages => {
    // At most 2,000 UTF-16 units (under 6 KiB of UTF-8) per injected fragment.
    const result = []; let remaining = 2000;
    for (const message of (messages ?? []).slice(-20).reverse()) {
      if (!["user", "assistant"].includes(message.role) || typeof message.text !== "string") continue;
      const text = message.text.slice(-remaining);
      if (text) result.unshift({ role: message.role, text });
      remaining -= text.length; if (!remaining) break;
    }
    return result;
  };
  function forget(id) {
    const entry = children.get(id); children.delete(id);
    if (entry && parents.get(entry.key) === entry) parents.delete(entry.key);
  }
  async function submit(options) {
    const { conversationId, hostId, manager, openPanel, text, literal = false } = options;
    const current = children.get(conversationId), command = literal ? null : parse(text);
    if (!current && !command) return false;
    if (literal && !current) return false;
    if (options.hasAttachments) throw Error("/btw는 텍스트 질문만 지원합니다. 첨부를 제거한 뒤 다시 보내 주세요.");
    const parentId = current?.parentId ?? conversationId;
    if (!parentId || !manager.getConversation(parentId)) throw Error("/btw를 사용하려면 본 작업의 대화가 열려 있어야 합니다.");
    const sessionKey = key(hostId, parentId), previous = current ?? parents.get(sessionKey);
    if (pending.has(sessionKey)) throw Error("별도 질문을 준비 중입니다. 잠시 후 다시 보내 주세요.");
    if (current && options.isResponseInProgress) throw Error("별도 답변이 완료된 뒤 후속 질문을 보내 주세요.");
    const previousState = previous && manager.getConversation(previous.id);
    if (previousState?.threadRuntimeStatus?.type === "running" || previousState?.turns?.some(turn => turn.status === "inProgress")) {
      throw Error("별도 답변이 진행 중입니다. 완료하거나 별도 답변을 중지한 뒤 다시 보내 주세요.");
    }
    const question = command ? command[1]?.trim() ?? "" : text.trim();
    if (!question && !command) throw Error("질문을 입력해 주세요.");
    pending.add(sessionKey);
    let created;
    try {
      const history = references(previous ? await manager.readRecentThreadMessages(previous.id, { maxItems: 20, maxTextLength: 20000 }) : []);
      const id = await openPanel({
        ...options, parentId, previousId: previous?.id, question,
        onDiscard: forget,
        async prepare(id) {
          created = id;
          const entry = { id, parentId, hostId, manager, key: sessionKey };
          children.set(id, entry);
          if (previous) await manager.copyEphemeralConversationHistory(previous.id, id);
          if (history.length) await manager.sendRequest("thread/inject_items", {
            threadId: id, items: [{ type: "message", role: "user", content: [{ type: "input_text", text:
              "Earlier /btw questions and answers are reference-only context. Only the next user question is active.\n" + JSON.stringify(history) }] }],
          });
          if (question) await manager.sendFollowUpMessage(id, { prompt: question });
        },
      });
      if (!id) throw Error("별도 질문 패널을 열지 못했습니다.");
      parents.set(sessionKey, children.get(id));
      if (previous && previous.id !== id) {
        try { await manager.discardConversationFromCache(previous.id); forget(previous.id); }
        catch (error) { manager.logger?.warning("Failed to discard replaced /btw thread", { safe: { conversationId: previous.id }, sensitive: { error } }); }
      }
      return true;
    } catch (error) {
      if (created) forget(created);
      throw error;
    } finally { pending.delete(sessionKey); }
  }
  async function transfer(id, selectedText) {
    const entry = children.get(id);
    if (!entry) throw Error("별도 질문을 다시 열어 주세요.");
    const messages = await entry.manager.readRecentThreadMessages(id, { maxItems: 20, maxTextLength: Number.MAX_SAFE_INTEGER });
    const answer = selectedText?.trim() || messages?.findLast(message => message.role === "assistant")?.text;
    if (!answer) throw Error("전달할 답변이 없습니다.");
    // The native follow-up coordinator owns ordinary parent admission/steering.
    // This is the only path in this controller that sends to the parent.
    await entry.manager.sendFollowUpMessage(entry.parentId, { prompt: answer });
  }
  return { submit, transfer, forget, lookup: id => children.get(id), matches: text => parse(text) !== null };
}

// The native Side chat component owns Markdown, composer, stop, tab movement,
// focus and close behavior. This wrapper adds only the explicit transfer control.
function createBtwPanel(React, jsx, Button, NativeSideChat, controller) {
  return function BtwPanel(props) {
    const entry = controller.lookup(props.conversationId);
    const container = React.useRef(null);
    const [, update] = React.useState(0);
    const [selected, select] = React.useState("");
    const [status, setStatus] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    React.useEffect(() => {
      if (!entry) return;
      const unsubscribe = entry.manager.addConversationCallback(entry.id, () => update(n => n + 1));
      const selection = () => {
        const value = globalThis.getSelection?.();
        select(value && !value.isCollapsed && container.current?.contains(value.anchorNode) && container.current?.contains(value.focusNode) ? value.toString() : "");
      };
      document.addEventListener("selectionchange", selection);
      return () => { unsubscribe?.(); document.removeEventListener("selectionchange", selection); };
    }, [entry]);
    const messages = entry?.manager.readRecentThreadMessages(entry.id, { maxItems: 20, maxTextLength: 20000 }) ?? [];
    const answer = messages.findLast(message => message.role === "assistant")?.text;
    const state = entry?.manager.getConversation(entry.id);
    const running = state?.threadRuntimeStatus?.type === "running" || state?.turns?.some(turn => turn.status === "inProgress");
    const transfer = async () => {
      setBusy(true); setStatus(null);
      try { await controller.transfer(entry.id, selected); setStatus("본 작업에 전달했습니다."); }
      catch (error) { setStatus(error.message); }
      finally { setBusy(false); }
    };
    return jsx.jsxs("div", { ref: container, className: "flex h-full min-h-0 flex-col", "data-azrael-btw-panel": true, children: [
      jsx.jsxs("div", { className: "flex flex-wrap items-center gap-2 border-b border-default px-4 py-2", children: [
        jsx.jsx("span", { className: "mr-auto text-sm text-secondary", children: "/btw · 도구 없는 별도 질문" }),
        jsx.jsx(Button, { color: "secondary", size: "default", disabled: busy || running || (!selected && !answer), onClick: transfer,
          children: busy ? "전달 중…" : selected ? "선택한 내용을 본 작업에 전달" : "답변을 본 작업에 전달" }),
        status ? jsx.jsx("span", { role: "status", className: "w-full text-sm text-secondary", children: status }) : null,
      ] }),
      jsx.jsx("div", { className: "flex min-h-0 flex-1 flex-col", children: jsx.jsx(NativeSideChat, props) }),
    ] });
  };
}

module.exports = { createBtwController, createBtwPanel };

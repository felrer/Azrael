import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { ChatSession } from "../src/chatSession";

class MockServer extends EventEmitter {
  calls: Array<{ method: string; params: any }> = [];
  replies: Array<{ id: number | string; result: unknown }> = [];
  errors: Array<{ id: number | string; code: number }> = [];
  queue: Array<{ id: string; kind: string; input: any[]; clientUserMessageId: string }> = [];
  nextQueueId = 1;
  skipNext = false;
  async start(): Promise<unknown> { return {}; }
  async request(method: string, params: any): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === "model/list") return { data: [
      { id: "catalog-1", model: "new-model", modelProvider: "openai", displayName: "New model", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "high" }, { reasoningEffort: "low" }], defaultReasoningEffort: "high" },
      { id: "catalog-2", model: "new-model", modelProvider: "devin", displayName: "Devin", supportedReasoningEfforts: [] },
      { id: "catalog-3", model: "claude", modelProvider: "azrael-managed", displayName: "Claude", supportedReasoningEfforts: [] },
    ], nextCursor: null };
    if (method === "thread/list") return { data: [{ id: "old", preview: "Previous task", model: "new-model", modelProvider: "openai" }], nextCursor: null };
    if (method === "thread/start") return { thread: { id: "new", modelProvider: params.modelProvider }, approvalPolicy: params.approvalPolicy, sandbox: { type: "dangerFullAccess" } };
    if (method === "thread/read") return { thread: { id: params.threadId } };
    if (method === "thread/resume") return { thread: { id: params.threadId, model: params.model ?? "new-model", modelProvider: params.modelProvider ?? "openai" }, approvalPolicy: params.approvalPolicy, sandbox: { type: "dangerFullAccess" } };
    if (method === "thread/turns/list") return { data: [{ id: "running-old", status: "inProgress" }], nextCursor: null };
    if (method === "thread/unsubscribe") return { status: "unsubscribed" };
    if (method === "thread/settings/update") {
      queueMicrotask(() => this.emit("notification", "thread/settings/updated", {
        threadId: params.threadId,
        threadSettings: { model: params.model, approvalPolicy: params.approvalPolicy, sandboxPolicy: params.sandboxPolicy },
      }));
      return {};
    }
    if (method === "thread/items/list") return { data: [{ item: { id: "prior", type: "agentMessage", text: "Earlier" } }], nextCursor: null };
    if (method === "thread/queue/add") {
      const queuedSubmission = { id: `queue-${this.nextQueueId++}`, kind: params.kind, input: params.input, clientUserMessageId: params.clientUserMessageId };
      this.queue.push(queuedSubmission); return { queuedSubmission };
    }
    if (method === "thread/queue/list") return { data: this.queue.slice(Number(params.cursor ?? 0)), nextCursor: null };
    if (method === "thread/queue/delete") return { deleted: this.queue.splice(this.queue.findIndex(entry => entry.id === params.queuedSubmissionId), 1).length > 0 };
    if (method === "thread/queue/reorder") { this.queue.sort((a, b) => params.queuedSubmissionIds.indexOf(a.id) - params.queuedSubmissionIds.indexOf(b.id)); return {}; }
    if (method === "thread/queue/start") {
      assert.equal(this.queue[0]?.id, params.queuedSubmissionId);
      this.queue.shift();
      if (this.skipNext) { this.skipNext = false; return { turn: null, skipped: true }; }
      return { turn: { id: "turn-1" }, skipped: false };
    }
    if (method === "turn/interrupt") return {};
    throw new Error("unexpected method");
  }
  respond(id: number | string, result: unknown): void { this.replies.push({ id, result }); }
  respondError(id: number | string, code: number): void { this.errors.push({ id, code }); }
  dispose(): void {}
}

test("chat selects server models, starts and resumes threads, streams, interrupts and approves", async () => {
  const wire = new MockServer();
  const chat = new ChatSession(wire, "/project");
  await chat.start();
  assert.deepEqual(chat.state.models.map(model => model.id), ["catalog-1", "catalog-2", "catalog-3"]);
  assert.equal(chat.state.selectedModel, "catalog-1");
  await chat.openThread("old");
  assert.equal(chat.state.items[0].text, "Earlier");
  assert.equal(chat.state.turnId, "running-old");
  await chat.newThread();
  assert.deepEqual(wire.calls.find(call => call.method === "thread/start")?.params, { cwd: "/project", model: "new-model", modelProvider: "openai", approvalPolicy: "never", sandbox: "danger-full-access" });
  await chat.send("hello");
  assert.deepEqual(wire.calls.find(call => call.method === "thread/queue/add")?.params.input, [{ type: "text", text: "hello", text_elements: [] }]);
  assert.equal(wire.calls.filter(call => call.method === "thread/queue/start").length, 1);
  wire.emit("notification", "item/agentMessage/delta", { threadId: "new", turnId: "turn-1", itemId: "answer", delta: "Hel" });
  wire.emit("notification", "item/agentMessage/delta", { threadId: "new", turnId: "turn-1", itemId: "answer", delta: "lo" });
  assert.equal(chat.state.items.at(-1)?.text, "Hello");
  await chat.stop();
  assert.ok(wire.calls.some(call => call.method === "turn/interrupt" && call.params.turnId === "turn-1"));
  wire.emit("serverRequest", "approve-1", "item/commandExecution/requestApproval", { threadId: "new", turnId: "turn-1", itemId: "cmd", command: "echo hi" });
  assert.deepEqual(wire.replies, [{ id: "approve-1", result: { decision: "accept" } }]);
  wire.emit("serverRequest", "approve-2", "item/fileChange/requestApproval", { threadId: "new", turnId: "turn-1", itemId: "patch" });
  assert.deepEqual(wire.replies[1], { id: "approve-2", result: { decision: "accept" } });
  wire.emit("serverRequest", "approve-3", "item/permissions/requestApproval", { threadId: "new", turnId: "turn-1", itemId: "permission", permissions: { network: { enabled: true } } });
  assert.deepEqual(wire.replies[2], { id: "approve-3", result: { permissions: { network: { enabled: true } }, scope: "turn" } });
  assert.equal(chat.state.approvals.length, 0);
  chat.dispose();
});

test("switching an existing thread resumes with catalog provider before the next turn", async () => {
  const wire = new MockServer();
  const chat = new ChatSession(wire, "/project");
  await chat.start();
  await chat.openThread("old");
  wire.emit("notification", "turn/completed", { threadId: "old", turn: { id: "running-old", status: "completed" } });
  await new Promise(resolve => setImmediate(resolve));
  chat.selectModel("catalog-2");
  await chat.send("use Devin");
  const resumed = wire.calls.filter(call => call.method === "thread/resume");
  assert.deepEqual(resumed.at(-1)?.params, { threadId: "old", model: "new-model", modelProvider: "devin", excludeTurns: true, approvalPolicy: "never", sandbox: "danger-full-access" });
  assert.ok(wire.calls.some(call => call.method === "thread/queue/add" && call.params.threadId === "old"));
  assert.ok(wire.calls.findIndex(call => call.method === "thread/resume" && call.params.modelProvider === "devin") < wire.calls.findIndex(call => call.method === "thread/queue/add"));
  chat.dispose();
});

test("new Claude thread uses its catalog provider without parsing the model ID", async () => {
  const wire = new MockServer();
  const chat = new ChatSession(wire, "/project");
  await chat.start();
  chat.selectModel("catalog-3");
  await chat.newThread();
  assert.deepEqual(wire.calls.find(call => call.method === "thread/start")?.params, {
    cwd: "/project", model: "claude", modelProvider: "azrael-managed", approvalPolicy: "never", sandbox: "danger-full-access"
  });
  chat.dispose();
});

test("Full access readback is required before any provider can enqueue work", async () => {
  for (const modelId of ["catalog-1", "catalog-2", "catalog-3"]) {
    const wire = new MockServer();
    const request = wire.request.bind(wire);
    wire.request = async (method, params) => method === "thread/start"
      ? { thread: { id: "new", modelProvider: params.modelProvider }, approvalPolicy: "on-request", sandbox: { type: "workspaceWrite" } }
      : request(method, params);
    const chat = new ChatSession(wire, "/project");
    await chat.start();
    chat.selectModel(modelId);
    await assert.rejects(chat.send("must not run"), /did not activate Full access/);
    assert.equal(wire.calls.some(call => call.method === "thread/queue/add"), false);
    chat.dispose();
  }
});

test("a turn waits for the Full access settings request without requiring a change event", async () => {
  const wire = new MockServer();
  const request = wire.request.bind(wire);
  let acceptSettings!: () => void;
  const settingsAccepted = new Promise<void>(resolve => { acceptSettings = resolve; });
  wire.request = async (method, params) => method === "thread/settings/update"
    ? (wire.calls.push({ method, params }), await settingsAccepted, {}) : request(method, params);
  const chat = new ChatSession(wire, "/project");
  await chat.start();
  await chat.newThread();
  const pending = chat.send("after permissions");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wire.calls.some(call => call.method === "thread/queue/add"), false);
  const settings = wire.calls.find(call => call.method === "thread/settings/update")?.params;
  assert.deepEqual({ approvalPolicy: settings.approvalPolicy, sandboxPolicy: settings.sandboxPolicy }, {
    approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" }
  });
  acceptSettings();
  await pending;
  assert.equal(wire.calls.filter(call => call.method === "thread/queue/add").length, 1);
  chat.dispose();
});

test("resuming a turn that began before Full access does not auto-approve its pending request", async () => {
  const wire = new MockServer();
  const chat = new ChatSession(wire, "/project");
  await chat.start();
  await chat.openThread("old");
  wire.emit("serverRequest", "old-approval", "item/commandExecution/requestApproval", {
    threadId: "old", turnId: "running-old", itemId: "cmd", command: "echo old"
  });
  assert.equal(wire.replies.length, 0);
  assert.equal(chat.state.approvals[0].detail, "echo old");
  chat.approve("old-approval", "decline");
  chat.dispose();
});

test("malformed events and unknown server requests are visible or rejected without raw data", async () => {
  const wire = new MockServer();
  const chat = new ChatSession(wire, "/project");
  await chat.start();
  await chat.newThread();
  wire.emit("notification", "item/agentMessage/delta", { threadId: "new", itemId: "x", delta: { token: "private" } });
  assert.match(chat.state.error ?? "", /Invalid message stream/);
  assert.doesNotMatch(chat.state.error ?? "", /private/);
  wire.emit("serverRequest", "bad", "something/unknown", { token: "private" });
  assert.deepEqual(wire.errors, [{ id: "bad", code: -32601 }]);
  wire.emit("disconnect", new Error("secret"));
  assert.equal(chat.state.status, "Disconnected");
  assert.doesNotMatch(JSON.stringify(chat.state), /secret/);
  chat.dispose();
});

test("catalog rows without provider identity cannot start a misrouted thread", async () => {
  const wire = new MockServer();
  const request = wire.request.bind(wire);
  wire.request = async (method, params) => method === "model/list"
    ? { data: [{ id: "ambiguous", model: "claude", displayName: "Claude" }], nextCursor: null }
    : request(method, params);
  const chat = new ChatSession(wire, "/project");
  await chat.start();
  assert.match(chat.state.error ?? "", /catalog.*provider identity/i);
  await assert.rejects(chat.newThread(), /Select a model/);
  assert.equal(wire.calls.some(call => call.method === "thread/start"), false);
  chat.dispose();
});

test("duplicate catalog IDs cannot silently select the wrong provider", async () => {
  const wire = new MockServer();
  wire.request = async (method) => method === "model/list" ? { data: [
    { id: "shared", model: "same", modelProvider: "openai", displayName: "First" },
    { id: "shared", model: "same", modelProvider: "devin", displayName: "Second" },
  ], nextCursor: null } : { data: [], nextCursor: null };
  const chat = new ChatSession(wire, "/project");
  await chat.start();
  assert.match(chat.state.error ?? "", /duplicate model IDs/);
  assert.equal(chat.state.models.length, 0);
  chat.dispose();
});

test("manual model refresh requests fresh first page and paginates without another refresh", async () => {
  const wire = new MockServer();
  const original = wire.request.bind(wire);
  wire.request = async (method, params) => {
    if (method !== "model/list") return original(method, params);
    wire.calls.push({ method, params });
    const row = params.cursor
      ? { id: "new", model: "newest", modelProvider: "openai", displayName: "Newly available" }
      : { id: "existing", model: "existing", modelProvider: "openai", displayName: "Existing" };
    return { data: [row], nextCursor: params.cursor ? null : "next" };
  };
  const chat = new ChatSession(wire, "/project");
  await chat.start();
  wire.calls.length = 0;
  await chat.refreshModels(true);
  assert.deepEqual(wire.calls.filter(call => call.method === "model/list").map(call => call.params), [
    { cursor: null, includeHidden: false, refresh: true },
    { cursor: "next", includeHidden: false },
  ]);
  assert.deepEqual(chat.state.models.map(model => model.id), ["existing", "new"]);
  chat.dispose();
});

test("active turn keeps message and compaction in durable order; cancel and reorder use queue IDs", async () => {
  const wire = new MockServer();
  const chat = new ChatSession(wire, "/project");
  await chat.start(); await chat.newThread();
  wire.emit("notification", "turn/started", { threadId: "new", turn: { id: "busy" } });
  await chat.send("first"); await chat.compact(); await chat.send("last");
  assert.deepEqual(chat.state.queue.map(entry => [entry.kind, entry.text]), [["userInput", "first"], ["contextCompaction", "Compact context"], ["userInput", "last"]]);
  assert.equal(wire.calls.filter(call => call.method === "thread/queue/start").length, 0);
  await chat.moveQueued(chat.state.queue[2].id, -1);
  assert.deepEqual(wire.queue.map(entry => entry.kind), ["userInput", "userInput", "contextCompaction"]);
  await chat.cancelQueued(chat.state.queue[1].id);
  assert.deepEqual(wire.queue.map(entry => entry.kind), ["userInput", "contextCompaction"]);
  wire.emit("notification", "turn/completed", { threadId: "new", turn: { id: "busy", status: "completed" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wire.calls.filter(call => call.method === "thread/queue/start").length, 1);
  wire.emit("notification", "turn/completed", { threadId: "new", turn: { id: "turn-1", status: "completed" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wire.calls.filter(call => call.method === "thread/queue/start").length, 2);
  chat.dispose();
});

test("restart lists persisted queue and continues after a skipped compaction", async () => {
  const wire = new MockServer();
  wire.queue.push({ id: "persisted-1", kind: "contextCompaction", input: [], clientUserMessageId: "one" }, { id: "persisted-2", kind: "userInput", input: [{ type: "text", text: "saved" }], clientUserMessageId: "two" });
  wire.skipNext = true;
  const chat = new ChatSession(wire, "/project");
  await chat.start();
  await chat.openThread("old");
  assert.deepEqual(chat.state.queue.map(entry => entry.text), ["Compact context", "saved"]);
  wire.emit("notification", "turn/completed", { threadId: "old", turn: { id: "running-old", status: "completed" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(wire.calls.filter(call => call.method === "thread/queue/start").map(call => call.params.queuedSubmissionId), ["persisted-1", "persisted-2"]);
  chat.dispose();
});

test("child-agent updates display bounded status without prompts or state messages", async () => {
  const wire = new MockServer();
  const chat = new ChatSession(wire, "/project");
  await chat.start(); await chat.newThread();
  wire.emit("notification", "item/started", { threadId: "new", item: { id: "agent-tool", type: "collabAgentToolCall", tool: "spawnAgent", status: "inProgress", prompt: "credential-secret", agentsStates: { one: { status: "running", message: "token-secret" } } } });
  wire.emit("notification", "item/updated", { threadId: "new", item: { id: "agent-tool", type: "collabAgentToolCall", tool: "spawnAgent", status: "completed", agentsStates: { one: { status: "completed", message: "token-secret" } } } });
  wire.emit("notification", "item/completed", { threadId: "new", item: { id: "agent-activity", type: "subAgentActivity", kind: "completed", agentPath: "/secret/path" } });
  assert.deepEqual(chat.state.items.map(entry => entry.text), ["Spawn agent: completed (completed)", "Agent completed"]);
  assert.doesNotMatch(JSON.stringify(chat.state), /credential-secret|token-secret|secret\/path/);
  chat.dispose();
});

test("pending messages and compaction pin model and effort until the queue is empty", async () => {
  const wire = new MockServer();
  const chat = new ChatSession(wire, "/project");
  await chat.start(); await chat.newThread();
  wire.emit("notification", "turn/started", { threadId: "new", turn: { id: "busy" } });
  await chat.send("saved under OpenAI");
  await chat.compact();
  assert.equal(chat.state.modelSelectionLocked, true);
  assert.throws(() => chat.selectModel("catalog-2"), /pending queue/);
  assert.throws(() => chat.selectModel("catalog-1", "low"), /pending queue/);
  assert.equal(chat.state.selectedModel, "catalog-1");
  assert.equal(chat.state.selectedEffort, "high");
  assert.deepEqual(wire.calls.filter(call => call.method === "thread/settings/update").map(call => call.params.model), ["new-model"]);
  for (const entry of [...chat.state.queue]) await chat.cancelQueued(entry.id);
  assert.equal(chat.state.modelSelectionLocked, false);
  chat.selectModel("catalog-2");
  assert.equal(chat.state.selectedModel, "catalog-2");
  chat.dispose();
});

test("failed provider turn retains safe error cause and pauses pending work", async () => {
  const wire = new MockServer();
  const chat = new ChatSession(wire, "/project");
  await chat.start(); await chat.newThread();
  wire.emit("notification", "turn/started", { threadId: "new", turn: { id: "busy" } });
  await chat.send("queued work");
  wire.emit("notification", "turn/completed", { threadId: "new", turn: {
    id: "busy", status: "failed", error: { message: "secret provider payload", codexErrorInfo: "unauthorized" },
  } });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(chat.state.error ?? "", /Authentication expired/);
  assert.doesNotMatch(chat.state.error ?? "", /secret provider payload/);
  assert.equal(wire.calls.filter(call => call.method === "thread/queue/start").length, 0);
  assert.equal(chat.state.queue.length, 1);
  wire.emit("notification", "turn/completed", { threadId: "new", turn: {
    id: "unsupported-model", status: "failed", error: { message: "The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.", codexErrorInfo: "badRequest" },
  } });
  assert.match(chat.state.error ?? "", /unavailable to this ChatGPT account/);
  wire.emit("notification", "turn/completed", { threadId: "new", turn: {
    id: "another", status: "failed", error: { message: "another secret", codexErrorInfo: "other" },
  } });
  assert.match(chat.state.error ?? "", /diagnostics/);
  assert.doesNotMatch(chat.state.error ?? "", /connection|another secret/i);
  chat.dispose();
});

test("chat shows bounded command and file results after approval", async () => {
  const wire = new MockServer();
  const chat = new ChatSession(wire, "/project");
  await chat.start(); await chat.newThread();
  wire.emit("notification", "item/completed", { threadId: "new", item: {
    id: "command-result", type: "commandExecution", command: "echo done", status: "completed", exitCode: 0, aggregatedOutput: "done\n",
  } });
  wire.emit("notification", "item/completed", { threadId: "new", item: {
    id: "file-result", type: "fileChange", status: "completed", changes: [{ path: "src/main.ts", kind: "update", diff: "private diff" }],
  } });
  assert.deepEqual(chat.state.items.map(entry => entry.text), ["echo done\ncompleted, exit 0\ndone\n", "completed\nsrc/main.ts"]);
  assert.doesNotMatch(JSON.stringify(chat.state.items), /private diff/);
  chat.dispose();
});

test("reopening a failed turn shows its cause without replaying saved queue", async () => {
  const wire = new MockServer();
  const original = wire.request.bind(wire);
  wire.queue.push({ id: "saved-1", kind: "userInput", input: [{ type: "text", text: "next" }], clientUserMessageId: "saved" });
  wire.request = async (method, params) => method === "thread/turns/list"
    ? { data: [{ id: "failed-1", status: "failed", error: { message: "private", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } } } }] }
    : original(method, params);
  const chat = new ChatSession(wire, "/project");
  await chat.start(); await chat.openThread("old");
  assert.match(chat.state.error ?? "", /response stream was interrupted/);
  assert.doesNotMatch(chat.state.error ?? "", /private/);
  assert.equal(wire.calls.filter(call => call.method === "thread/queue/start").length, 0);
  chat.dispose();
});

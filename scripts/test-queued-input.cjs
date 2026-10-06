"use strict";

const assert = require("node:assert/strict");
const vs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const cm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { injectQueuedCompactionPresentation } = require("./inject-queued-compaction.cjs");

const root = process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.930.61225");
const filename = path.join(root, "webview/assets/app-initial-532d60c9b397.js");
const source = injectQueuedCompactionPresentation(vs.readFileSync(filename, "utf8")).text;
const Ost = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(Ost.parseDiagnostics.length, 0);
const declarations = new Map(Ost.statements.filter(ts.isFunctionDeclaration).map(node => [node.name?.text, node.getText(Ost)]));

function fixture(adapterSource = declarations.get("wen"), initialItems = []) {
  const calls = [];
  // Exercise the actual pinned serializer and native queue adapter. These valid
  // fixtures do not test schema validation, prompt rendering or image transport.
  const context = cm.createContext({
    Error, JSON, Map, Set, Promise, yS: value => value,
    Ust: { default: (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) },
    // The full bundle has a nonzero-arity outer D binding. A lost local D
    // declaration can therefore misclassify ordinary text as app input.
    D: function upstreamHelper(value) {},
    Wst: "codex-untrusted-app-input:", Gst: "Could not use app content",
    Lst: "App input requires confirmation before legacy delivery",
    Kst: "Respond to the user input in the context of our conversation.",
    Xst: { safeParse: value => ({ success: true, data: value }), parse: value => value },
    $E: () => [], qE: value => value, YE: () => [], Rv: () => false,
    gD: () => "", mD: value => value.prompt, U0t: () => [], jfe: () => {},
    jst: value => value.text ?? "", Zv: () => [], Nv: value => value,
    n_: "local", kO: () => false, UD: () => false, Gg: () => true, ob: () => true,
    lUe: () => false, bm: async () => false, J_: () => {}, uy: value => value,
    _ne: () => null, Yct: "interrupted", EE: class extends Error {},
    MO: { default: (left, right) => JSON.stringify(left) === JSON.stringify(right) },
    mp: { warning: () => {} },
  });
  for (const name of ["Ast", "Vst", "Hst", "zst", "ey", "P4t", "Een", "Den", "wen"]) {
    assert.ok(declarations.has(name), `pinned declaration ${name}`);
    cm.runInContext(name === "wen" ? adapterSource : declarations.get(name), context);
  }
  const manager = {
    getHostId: () => "local", getConversation: () => ({}),
    getStreamRole: () => ({ role: "owner" }),
    addNotificationCallback: () => () => {},
    sendRequest: async (method, params) => {
      calls.push({ method, params });
      if (method === "thread/queue/list") return { data: initialItems, nextCursor: null };
      if (method === "thread/queue/add") return { queuedSubmission: { id: params.clientUserMessageId, clientUserMessageId: params.clientUserMessageId, input: params.input } };
      throw Error(`Unexpected request: ${method}`);
    },
  };
  const queue = context.wen({ scope: {}, manager, appServerVersion: () => ({}) });
  return { queue, calls, context };
}

test("the previous declaration-breaking transform reproduces false app confirmation", async () => {
  const fixed = "throw Error(`Queued compaction cannot be edited`);let v=a?.messageId";
  const broken = "throw Error(`Queued compaction cannot be edited`),v=a?.messageId";
  const adapter = declarations.get("wen");
  assert.equal(adapter.split(fixed).length - 1, 1);
  for (const prompt of ["완료", "**Chrome**의 탭·로그인 세션이 대상입니다"]) {
    const f = fixture(adapter.replace(fixed, broken));
    await assert.rejects(f.queue.enqueue("thread", message({ prompt })), /requires confirmation/);
    assert.equal(f.calls.filter(call => call.method === "thread/queue/add").length, 0);
  }
});

test("marked presentation assets must retain the enqueue local declaration", () => {
  assert.equal(injectQueuedCompactionPresentation(source).count, 0);
  const malformed = source.replace(
    "throw Error(`Queued compaction cannot be edited`);let v=a?.messageId",
    "throw Error(`Queued compaction cannot be edited`),v=a?.messageId",
  );
  assert.notEqual(malformed, source);
  assert.throws(() => injectQueuedCompactionPresentation(malformed), /enqueue declaration/);
});

function message(extra = {}) {
  return {
    id: "completion-id", text: "완료", createdAt: 1,
    context: {
      prompt: "완료", fileAttachments: [], pastedTextAttachments: [],
      imageAttachments: [], addedFiles: [], commentAttachments: [],
      mcpAppModelContextAttachments: [], ...extra,
    },
  };
}

test("plain completion with open-page instructions reaches the native queue", async () => {
  const f = fixture();
  const m = message({ additionalContext: {
    codex_apps_open_page_instructions: { kind: "application", value: "No page is visible." },
  } });
  const result = await f.queue.enqueue("thread", m);
  assert.equal(result.serverAccepted, true);
  const request = f.calls.find(call => call.method === "thread/queue/add");
  assert.equal(request.params.clientUserMessageId, m.id);
  assert.deepEqual(JSON.parse(JSON.stringify(request.params.input)), [{ type: "text", text: "완료", text_elements: [] }]);
});

test("Chrome reply preserves Markdown and reaches the native queue once", async () => {
  const f = fixture();
  const prompt = "**Chrome**의 탭·로그인 세션이 대상입니다";
  const m = message({ prompt });
  const result = await f.queue.enqueue("thread", m);
  assert.equal(result.serverAccepted, true);
  const requests = f.calls.filter(call => call.method === "thread/queue/add");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].params.clientUserMessageId, m.id);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].params.input)), [
    { type: "text", text: prompt, text_elements: [] },
  ]);
});

test("context compaction remains uneditable without disrupting ordinary enqueue", async () => {
  const f = fixture(undefined, [{ id: "compaction-id", kind: "contextCompaction", input: [] }]);
  await assert.rejects(f.queue.enqueue("thread", message(), { messageId: "compaction-id" }), /compaction cannot be edited/);
  assert.equal(f.calls.filter(call => call.method !== "thread/queue/list").length, 0);
});

test("reviewed app message content is eligible for queue delivery", async () => {
  const f = fixture();
  const result = await f.queue.enqueue("thread", message({
    mcpAppModelContextAttachments: [{ id: "reviewed", kind: "message", untrusted: false, text: "Reviewed content", imageAttachments: [] }],
  }));
  assert.equal(result.serverAccepted, true);
  assert.equal(f.calls.filter(call => call.method === "thread/queue/add").length, 1);
});

test("unreviewed app context and app-initiated messages retain confirmation", async () => {
  for (const extra of [
    { mcpAppModelContextAttachments: [{ id: "raw-context", kind: "context", untrusted: true, text: "External context", imageAttachments: [] }] },
    { untrustedAppMessage: { kind: "message", source: "mcp_app", text: "External instruction" } },
  ]) {
    const f = fixture();
    await assert.rejects(f.queue.enqueue("thread", message(extra)), /requires confirmation/);
    assert.equal(f.calls.filter(call => call.method === "thread/queue/add").length, 0);
  }
});

test("restoring serialized unreviewed app input cannot bypass confirmation", async () => {
  const f = fixture();
  const m = message({ untrustedAppMessage: { kind: "message", source: "mcp_app", text: "External instruction" } });
  const serialized = f.context.Een("local", m).input;
  await assert.rejects(f.queue.restore("thread", {
    message: message(), serverSubmission: { id: "old", clientUserMessageId: "old-client", input: serialized },
  }), /requires confirmation/);
  assert.equal(f.calls.filter(call => call.method === "thread/queue/add").length, 0);
});

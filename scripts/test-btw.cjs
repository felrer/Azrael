"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { createBtwController } = require("./btw-conversation.cjs");
const { BTW_ASSETS, BTW_MARKER, INSTRUCTIONS, injectBtw } = require("./inject-btw.cjs");
const { injectComposerDraft } = require("./inject-composer-draft.cjs");
const { transformAsset } = require("./namespace-azrael-host.cjs");
const root = path.resolve(__dirname, "../artifacts/upstream-ui/26.930.61225");
const originals = BTW_ASSETS.map(asset => fs.readFileSync(path.join(root, asset), "utf8"));
const patched = originals.map((source, i) => transformAsset(source, BTW_ASSETS[i], BTW_ASSETS[i], ts));
function declaration(source, name) {
  const ast = ts.createSourceFile("pinned.js", source, 99, true, ts.ScriptKind.JS);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === name);
  assert.ok(node, name); return node.getText(ast);
}
function fixture() {
  const controller = createBtwController(), requests = [], openings = [], disposed = [];
  const parent = { cwd: "/workspace", latestModel: "managed/anthropic/current", threadRuntimeStatus: { type: "running" }, turns: [{ status: "inProgress" }] };
  const states = new Map([["parent", parent]]), messages = new Map(); let next = 0;
  const manager = {
    getConversation: id => states.get(id), getHostId: () => "local",
    readRecentThreadMessages: id => messages.get(id) ?? [],
    copyEphemeralConversationHistory: (old, id) => { messages.set(id, structuredClone(messages.get(old) ?? [])); return true; },
    sendRequest: async (method, params) => requests.push({ method, params }),
    sendFollowUpMessage: async (id, { prompt }) => { requests.push({ method: "follow-up", id, prompt }); messages.set(id, [...messages.get(id) ?? [], { role: "user", text: prompt }, { role: "assistant", text: "Answer: " + prompt }]); },
    discardConversationFromCache: async id => { disposed.push(id); states.delete(id); },
  };
  const openPanel = async options => {
    openings.push(options); const id = "side-" + ++next;
    states.set(id, { ephemeral: true, sideConversation: true, threadRuntimeStatus: { type: "idle" }, turns: [] });
    await options.prepare(id); return id;
  };
  const submit = overrides => controller.submit({ conversationId: "parent", hostId: "local", manager, openPanel, text: "/btw Why?", ...overrides });
  return { controller, parent, states, messages, manager, requests, openings, disposed, submit };
}

test("all integrated pinned assets parse, report coverage and guard version, duplicate anchors and idempotence", () => {
  for (let i = 0; i < BTW_ASSETS.length; i++) {
    assert.equal(patched[i].asset.btwEdits, 1);
    assert.equal(ts.createSourceFile(BTW_ASSETS[i], patched[i].text, 99, true, 1).parseDiagnostics.length, 0);
    const input = i === 1 ? injectComposerDraft(originals[i]).text : originals[i];
    const result = injectBtw(input, BTW_ASSETS[i]);
    assert.deepEqual(injectBtw(result.text, BTW_ASSETS[i]), { text: result.text, count: 0 });
    assert.throws(() => injectBtw("", BTW_ASSETS[i]), /anchor/);
    assert.throws(() => injectBtw(input + input, BTW_ASSETS[i]), /anchor/);
    assert.throws(() => injectBtw(result.text + BTW_MARKER, BTW_ASSETS[i]), /Duplicate/);
  }
  assert.deepEqual(injectBtw("unchanged", "future.js"), { text: "unchanged", count: 0 });
});

test("active parent stays unchanged; every follow-up forks that parent, carries isolated reference history, and discards the old side", async () => {
  const h = fixture(), before = structuredClone(h.parent);
  assert.equal(await h.submit({ isResponseInProgress: true }), true);
  assert.equal(await h.submit({ conversationId: "side-1", text: "Explain more" }), true);
  assert.deepEqual(h.openings.map(o => [o.parentId, o.previousId, o.question]), [["parent", undefined, "Why?"], ["parent", "side-1", "Explain more"]]);
  assert.deepEqual(h.parent, before);
  assert.equal(h.requests.some(r => r.id === "parent" || r.params?.threadId === "parent"), false);
  const reference = h.requests.find(r => r.method === "thread/inject_items");
  assert.equal(reference.params.threadId, "side-2");
  assert.match(reference.params.items[0].content[0].text, /Answer: Why\?/);
  assert.deepEqual(h.disposed, ["side-1"]);
  assert.equal(h.controller.lookup("side-1"), undefined);
  assert.equal(h.controller.lookup("side-2").parentId, "parent");
  assert.deepEqual(h.messages.get("side-2").map(m => m.text), ["Why?", "Answer: Why?", "Explain more", "Answer: Explain more"]);
});

test("only explicit transfer uses ordinary parent follow-up admission, with selection or latest answer", async () => {
  const h = fixture(); await h.submit();
  await h.controller.transfer("side-1", "Selected answer");
  await h.controller.transfer("side-1");
  assert.deepEqual(h.requests.filter(r => r.id === "parent").map(r => r.prompt), ["Selected answer", "Answer: Why?"]);
  h.controller.forget("side-1");
  await assert.rejects(h.controller.transfer("side-1"), /다시 열어/);
});

test("ordinary/literal prompts bypass the command; empty /btw opens without inference and child literal follow-up remains isolated", async () => {
  const h = fixture();
  for (const text of ["ordinary", "/btwOther", "Please explain /btw", "/btw question"]) assert.equal(await h.submit({ text, literal: true }), false);
  assert.equal(await h.submit({ text: "/btw" }), true); assert.deepEqual(h.requests, []);
  await h.submit({ conversationId: "side-1", text: "literal follow-up", literal: true });
  assert.equal(h.requests.at(-1).id, "side-2");
});

test("attachment, overlapping side answer, unavailable parent and preparation failure never send to parent", async () => {
  const h = fixture();
  await assert.rejects(h.submit({ hasAttachments: true }), /텍스트/);
  await assert.rejects(h.submit({ conversationId: null }), /열려 있어야/);
  await h.submit(); h.states.get("side-1").threadRuntimeStatus.type = "running";
  await assert.rejects(h.submit({ conversationId: "side-1", text: "next", isResponseInProgress: true }), /완료/);
  await assert.rejects(h.submit(), /진행 중/);
  h.states.get("side-1").threadRuntimeStatus.type = "idle";
  await assert.rejects(h.submit({ openPanel: async () => { throw Error("fork failed"); } }), /fork failed/);
  assert.equal(h.requests.some(r => r.id === "parent"), false);
  assert.ok(h.controller.lookup("side-1"), "failed replacement preserves previous side");
});

test("cached reference history is bounded, and repeated submission cannot race another fork", async () => {
  const h = fixture(); await h.submit();
  h.messages.set("side-1", Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "x".repeat(5000) })));
  let release;
  const pending = h.submit({ openPanel: async options => { await new Promise(r => { release = r; }); return h.openings[0].prepare ? (await options.prepare("side-x"), "side-x") : null; } });
  await Promise.resolve(); await Promise.resolve();
  await assert.rejects(h.submit(), /準備|준비/); release(); await pending;
  const item = h.requests.find(r => r.method === "thread/inject_items").params.items[0];
  const history = JSON.parse(item.content[0].text.split("\n")[1]);
  assert.ok(history.length <= 20); assert.equal(history.reduce((n, m) => n + m.text.length, 0), 2000);
});

test("actual native side creator forwards tool-free RPC, selected helper model and task boundary", async () => {
  const requests = [], manager = { getConversation: () => ({ modelProvider: "azrael-managed" }) };
  const context = { al: () => false, Jje: async () => ["/workspace"], hg: async () => ({ instructions: "inherited task instructions" }), zqe: () => false,
    SBi: "ordinary side instructions", zu: () => manager,
    jqe: async (_scope, _host, params) => { requests.push(params); return { conversationId: "child", synchronization: { status: "complete" } }; } };
  vm.createContext(context); vm.runInContext(declaration(patched[2].text, "bBi"), context);
  await context.bBi({ scope: {}, sourceConversationId: "parent", hostId: "local", cwd: "/workspace", sideQuestion: true, collaborationMode: { mode: "default", settings: { model: "managed/anthropic/current", reasoning_effort: "high" } } });
  const request = requests[0];
  assert.equal(request.sideQuestion, true); assert.equal(request.ephemeral, true); assert.equal(request.sideConversation, true);
  assert.equal(request.addForkedSyntheticItem, false); assert.equal(request.model, "managed/anthropic/current"); assert.equal(request.modelProvider, undefined);
  assert.equal(request.reasoningEffort, "high"); assert.equal(request.developerInstructions, INSTRUCTIONS);
  assert.equal(request.developerInstructions.includes("inherited task instructions"), false);
});

test("actual native fork request preserves ephemeral/excludeTurns, sends sideQuestion and has no goal continuation", async () => {
  const context = { u$: x => x, Uwn: x => x, ct: "native side-conversation boundary" };
  vm.createContext(context); vm.runInContext(declaration(patched[0].text, "tTn"), context);
  const native = context.tTn({ getHostId: () => "local", requestClient: { getAppServerVersion: () => "0.160.1" }, getConversation: () => ({ cwd: "/workspace" }) },
    { sourceConversationId: "parent", sideQuestion: true, sideConversation: true, ephemeral: true, model: "managed/anthropic/current" },
    { readTokenBudgetThread: () => false, readConfig: async () => ({}) }, { mapThreadTurns: x => x });
  const { request } = await native.prepareRequest();
  assert.equal(request.sideQuestion, true); assert.equal(request.ephemeral, true); assert.equal(request.excludeTurns, true);
  assert.equal(request.threadId, "parent"); assert.equal(request.deferGoalContinuation, undefined);
});

test("unacknowledged older engine forks are discarded before side inference, while ordinary forks retain their behavior", async () => {
  const requests = [], ctx = {};
  vm.createContext(ctx); vm.runInContext(declaration(patched[0].text, "__azraelCheckBtwFork"), ctx);
  const manager = { sendRequest: async (method, params) => requests.push({ method, params }) };
  await assert.rejects(ctx.__azraelCheckBtwFork(manager, { sideQuestion: true }, { thread: { id: "unsupported" } }), /지원하지/);
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ method: "thread/unsubscribe", params: { threadId: "unsupported" } }]);
  await ctx.__azraelCheckBtwFork(manager, { sideQuestion: true }, { sideQuestion: true, thread: { id: "supported" } });
  await ctx.__azraelCheckBtwFork(manager, {}, { thread: { id: "ordinary" } });
  assert.equal(requests.length, 1);
});

test("expired /btw panels cannot recreate an ordinary tool-enabled side chat", () => {
  const notices = []; let forks = 0;
  const ctx = { Rg: { c: size => Array(size).fill(Symbol.for("react.memo_cache_sentinel")) }, zg: { useState: () => [false, () => {}] },
    qs: {}, ne: {}, Jn: {}, pe: {}, ht: {}, p: () => ({ get: () => ({ danger: message => notices.push(message) }) }),
    w: () => ({}), A: () => undefined, Ta: () => ({ tabById$: {} }),
    $: { jsx: (type, props) => ({ type, props }) }, k: "label", kt: "button", en: "banner", fn: "page", Eg: {},
    os: () => { forks++; }, __azraelBtw: { lookup: id => id === "side" ? {} : undefined } };
  vm.createContext(ctx); vm.runInContext(declaration(patched[3].text, "Dg"), ctx);
  const panel = ctx.Dg({ conversationId: "side", sourceConversationId: "parent", presentation: "banner" });
  panel.props.customCtas.props.onClick();
  assert.equal(forks, 0); assert.match(notices[0], /\/btw/);
});

test("actual composer routes /btw before queue, goal, history and steering and clears only its owned draft", async () => {
  const composer = injectBtw(injectComposerDraft(originals[1]).text, BTW_ASSETS[1]).text;
  const names = ["Jfa", "__azraelComposerSnapshot", "__azraelComposerMatches"], code = names.map(n => declaration(composer, n)).join("\n");
  let text = "/btw explain", routed = 0, cleared = 0, admission = 0; const errors = [];
  const ctx = { performance, PS: () => ({ u: () => ({}), e: e => { throw e; }, d() {} }), WJ: "blocked", vG: "attachments", rG: { drafts$: "drafts" },
    Sp: () => "parent", $W: x => x, tG: { default: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    kG: 1, rW: 2, nW: 3, NU: 4, RU: 5, ZU: 6, XU: 7, lOe: x => x,
    __azraelBtw: { lookup: () => undefined, matches: text => /^\s*\/btw(?:\s|$)/.test(text) }, __azraelTryBtw: async () => { routed++; return true; } };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const scope = { value: {}, get: atom => atom === "drafts" ? { parent: {} } : atom === "attachments" ? {} : undefined };
  const submit = () => ctx.Jfa({ scope, composerController: { getText: () => text, getPersistedText: () => text }, clearStopTurnConfirmation() {},
    conversationId: "parent", submitTarget: { type: "local" }, clearComposerUi: () => { text = ""; cleared++; }, options: {},
    prepareGoalSubmit: () => { admission++; }, appendPromptToHistory: () => { admission++; }, handleSubmitError: e => errors.push(e) });
  await submit(); assert.deepEqual(errors, []); assert.equal(routed, 1); assert.equal(cleared, 1); assert.equal(admission, 0);
  text = "/btw another"; ctx.__azraelTryBtw = async () => { text = "new draft"; return true; };
  await submit(); assert.equal(text, "new draft"); assert.equal(cleared, 1);
  text = "/btw failure"; ctx.__azraelTryBtw = async () => { throw Error("fork failed"); };
  await submit(); assert.equal(text, "/btw failure"); assert.equal(cleared, 1); assert.match(errors.at(-1).message, /fork failed/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const util = require("node:util");
const test = require("node:test");
const crypto = require("node:crypto");
const { COMPOSER_DRAFT_ASSET, MARKER, injectComposerDraft } = require("./inject-composer-draft.cjs");
const repo = path.resolve(__dirname, "..");
const ts = require(path.join(repo, "extensions/azrael-ex/node_modules/typescript"));
const original = fs.readFileSync(path.join(repo, "artifacts/upstream-ui/26.928.31416", COMPOSER_DRAFT_ASSET), "utf8");
const transformed = injectComposerDraft(original).text;
const ast = ts.createSourceFile("composer.js", transformed, 99, true, 1);
assert.equal(ast.parseDiagnostics.length, 0);
const declarations = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(n => [n.name.text, n.getText(ast)]));

// Execute the entire production submission function, clear function, retention
// function and comparison functions. Only platform/controller/atom/RPC adapters
// are simulated; assertions exercise the callbacks supplied to the real submit.
function fixture({ type = "local", text = "A", beforePreparation, submission, sidechat, fresh = false, current = true } = {}) {
  const attachmentFields = ["imageAttachments", "imageCommentDrafts", "appshotContexts", "fileAttachments", "pastedTextAttachments", "uploadedFileAttachments", "addedFiles", "mcpAppModelContextAttachments", "selectedTextAttachments", "responseTextAnnotations", "attachmentOrder"];
  const attachments = Object.fromEntries(attachmentFields.map(k => [k, []]));
  const atoms = new Map([...["PW", "hU", "mU", "GH", "XH"].map(k => [k, []]), ["cU", 0]]);
  let editor = text, draft = { prompt: text, pullRequestChecks: [] }, retained, callback, restores = 0, clears = 0, unsubscribes = 0;
  const events = [], errors = [];
  const scope = {
    value: { kind: "local", conversationId: "thread" },
    get(atom) {
      if (atom === "drafts") return { thread: draft };
      if (atom === "EW") return attachments;
      if (atom === "yW" || atom === "vW") return retained;
      return atoms.get(atom);
    },
    set(atom, key, value) {
      if (atom === "vW") retained = value;
      else atoms.set(atom, arguments.length === 3 ? value : key);
    },
    watch() { return () => { unsubscribes++; }; },
  };
  const controller = {
    view: { isDestroyed: false },
    getText: () => editor, getPersistedText: () => editor, getPlainText: () => editor,
    getMentionedComputerUseApps: () => [], getMentionedBrowserFamilies: () => [], getComputerUseAppMentions: () => [],
    setText(value) { editor = value; if (value !== "") draft = { prompt: value, pullRequestChecks: [] }; events.push(["text", value]); },
  };
  const noop = () => {};
  const context = vm.createContext({
    Symbol, JSON, performance, Em: () => "thread", KTe: () => "thread", mW: { drafts$: "drafts" }, pW: { default: (a, b) => util.isDeepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null))) },
    ...Object.fromEntries(["EW", "PW", "hU", "mU", "GH", "XH", "cU", "lU", "vW", "yW", "eJ", "Vg", "RA", "zA"].map(k => [k, k])),
    _S: () => ({ u: x => x, d: noop }), Oat: () => false, cua: x => x, Nca: async () => [],
    dEe: "dEe", lua: () => ["sidechat"],
    QX: ({ context, text, messageId }) => ({ id: messageId ?? "input-A", text, context }),
    WXe: noop, gg: { abort: noop, fail: noop }, bk: noop, fua: noop, pua: noop, Van: noop,
    ed: {}, t_: { warning: noop, debug: noop },
    hEe: class extends Error {}, jE: class extends Error {}, ME: class extends Error {}, XX: class extends Error {},
    f7: noop, k7i: noop, Y8i: noop, rZ: noop, $vr: noop, H2n: noop,
    L9n() { for (const k of attachmentFields) attachments[k] = []; if (!retained) draft = undefined; },
    uW(_e, value, _text, options) { if (!retained || options?.discardRetainedDraft) draft = value; },
  });
  for (const name of ["dW", "$9n", "eer", "rer", "D9n", "F7i", "__azraelComposerSnapshot", "__azraelComposerMatches", "uua"]) vm.runInContext(declarations.get(name), context);
  const clear = context.F7i({ scope, composerController: controller, attachmentGeneration: { current: 0 }, fileAttachments: [], pastedTextAttachments: [], commentAttachments: [], clearPendingAppshotCaptures: noop, setComments: noop, setPendingFileAttachments: noop, setPriorConversation: noop });
  const f = {
    attachments, atoms, controller, context, scope, events, errors,
    text: () => editor, retained: () => retained, clears: () => clears, restores: () => restores, unsubscribes: () => unsubscribes,
    edit(value) { controller.setText(value); },
    added(flags) { assert(callback, "submission callback is available"); callback(flags); },
    async run() {
      await context.uua({
        scope, composerController: controller, clearStopTurnConfirmation: noop,
        clearComposerUi(nt) { clears++; clear({ submittedContext: nt }); },
        retainComposerPrompt: () => context.D9n(scope),
        restoreComposerDraft(item) { restores++; controller.setText(item.text); },
        buildLocalContextForPrompt: async prompt => ({ prompt, ...attachments, ideContext: null }),
        prepareGoalSubmit: async () => { await beforePreparation?.(f); return { status: "continue" }; },
        submitTarget: { type, cwd: "fixture", submit: async (...args) => { callback = args.at(-1); return submission ? submission(f, args) : (callback(), { messageResult: { status: "queued" } }); } },
        conversationId: fresh ? null : "thread", followUp: fresh ? null : { type: "local", localConversationId: "thread" }, isResponseInProgress: true,
        isCurrentSubmission: () => current, isElectron: sidechat != null,
        openSideChatFromComposer: async () => sidechat(f), handleSideChatOpenError: e => errors.push(e),
        defaultFollowUpSubmitAction: "queue", submitButtonMode: "queue", canQueueFollowUp: false,
        appendPromptToHistory: noop, resetHistorySelection: noop, focusComposer: noop, setIsSubmitting: noop,
        invalidateRateLimit: noop, handleEditedQueuedMessageSubmitted: async () => {}, logMessageSent: noop,
        handleSubmitError: e => errors.push(e), options: {}, prompts: [], mentionedThreadReferences: [],
      });
    },
  };
  if (sidechat) atoms.set("dEe", true);
  return f;
}

test("unchanged early callback clears once; duplicate callback and final success are safe", async () => {
  const f = fixture({ submission: async f => { f.added(); f.added({ locallyAccepted: true }); f.added({ requestDispatched: true }); return { messageResult: { status: "queued" } }; } });
  await f.run(); assert.equal(f.text(), ""); assert.equal(f.clears(), 1); assert.equal(f.retained(), undefined); assert.equal(f.unsubscribes(), 1);
});
test("preparation edits survive the first callback and final success", async () => {
  const f = fixture({ beforePreparation: f => f.edit("B") });
  await f.run(); assert.equal(f.text(), "B"); assert.equal(f.clears(), 0); assert.equal(f.retained(), undefined);
});
test("delayed native enqueue preserves a newer draft", async () => {
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const f = fixture({ submission: async () => { entered(); await new Promise(resolve => { release = resolve; }); return { messageResult: { status: "queued" } }; } });
  const running = f.run(); await waiting; f.edit("B"); release(); await running;
  assert.equal(f.text(), "B"); assert.equal(f.clears(), 0);
});
for (const field of ["fileAttachments", "imageAttachments", "imageCommentDrafts", "mcpAppModelContextAttachments"]) {
  for (const operation of ["add", "remove", "change"]) test(`${field} ${operation} protects the editable draft`, async () => {
    const f = fixture({ beforePreparation: f => {
      if (operation === "remove") f.attachments[field].pop();
      else if (operation === "change") f.attachments[field][0].payload = "B";
      else f.attachments[field].push({ id: "B", payload: "B" });
    } });
    if (operation !== "add") f.attachments[field].push({ id: "A", payload: "A" });
    await f.run(); assert.equal(f.clears(), 0); assert.equal(f.text(), "A");
  });
}
test("unchanged failure restores A after early clear", async () => {
  const f = fixture({ submission: async f => { f.added(); throw Error("rejected"); } });
  await f.run(); assert.equal(f.text(), "A"); assert.equal(f.restores(), 1); assert.equal(f.errors.length, 1);
});
test("failure after clear preserves B and safely abandons A retention", async () => {
  const f = fixture({ submission: async f => { f.added(); f.edit("B"); throw Error("rejected"); } });
  await f.run(); assert.equal(f.text(), "B"); assert.equal(f.restores(), 0); assert.equal(f.retained(), undefined);
});
test("app context added after clear survives acceptance without D9n clearing it", async () => {
  const f = fixture({ submission: async f => { f.added(); f.attachments.mcpAppModelContextAttachments.push({ id: "B", kind: "context" }); f.added({ requestDispatched: true }); return { messageResult: { status: "queued" } }; } });
  await f.run(); assert.equal(f.attachments.mcpAppModelContextAttachments[0].id, "B"); assert.equal(f.clears(), 1); assert.equal(f.retained(), undefined);
});
test("attachment-only edit after clear prevents failure restoration over the new draft", async () => {
  const f = fixture({ submission: async f => { f.added(); f.attachments.mcpAppModelContextAttachments.push({ id: "B", kind: "context" }); throw Error("rejected"); } });
  await f.run(); assert.equal(f.text(), ""); assert.equal(f.restores(), 0); assert.equal(f.attachments.mcpAppModelContextAttachments[0].id, "B"); assert.equal(f.retained(), undefined);
});
test("an older retention callback cannot abandon a newer same-thread owner", () => {
  const f = fixture(), releaseA = f.context.D9n(f.scope);
  f.edit("B"); const releaseB = f.context.D9n(f.scope), ownerB = f.retained();
  assert.equal(releaseA(true, false), false); assert.equal(f.retained(), ownerB);
  assert.equal(releaseA(false, false), false); assert.equal(f.retained(), ownerB);
  assert.equal(releaseB(true, false), false); assert.equal(f.retained(), undefined); assert.equal(f.text(), "B");
});
test("ordinary success and worktree completion preserve preparation edits", async () => {
  for (const type of ["local", "worktree"]) {
    const f = fixture({ type, beforePreparation: f => f.edit("B"), submission: async () => null });
    await f.run(); assert.equal(f.text(), "B"); assert.equal(f.clears(), 0); assert.equal(f.errors.length, 0);
  }
});
test("sidechat completion compares the pre-await snapshot", async () => {
  const f = fixture({ sidechat: f => { f.edit("B"); return true; } });
  await f.run(); assert.equal(f.text(), "B"); assert.equal(f.clears(), 0); assert.equal(f.errors.length, 0);
});
test("fresh-thread success clears unchanged draft and preserves newer draft", async () => {
  for (const edited of [false, true]) {
    const f = fixture({ fresh: true, beforePreparation: f => { if (edited) f.edit("B"); }, submission: async () => null });
    await f.run(); assert.equal(f.text(), edited ? "B" : ""); assert.equal(f.clears(), edited ? 0 : 1); assert.equal(f.errors.length, 0);
  }
});
test("existing current-submission guard still blocks superseded submission", async () => {
  let submitted = false;
  const f = fixture({ current: false, submission: async () => { submitted = true; return null; } });
  await f.run(); assert.equal(submitted, false); assert.equal(f.clears(), 0); assert.equal(f.text(), "A");
});
test("snapshot detects app selection changes", () => {
  const f = fixture(), snapshot = f.context.__azraelComposerSnapshot(f.scope, f.controller);
  f.atoms.set("hU", [{ id: "B" }]); assert.equal(f.context.__azraelComposerMatches(f.scope, f.controller, snapshot), false);
});

test("queued and failed follow-ups remain visible during the optimistic send window", () => {
  let selector;
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === "ela") selector = node.right.arguments[1].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(selector, "pinned queue visibility selector exists");
  const select = vm.runInNewContext(`(${selector})`, { WX: "messages", yRr: "admitted", $ca: "elapsed" });
  for (const message of [
    { id: "submitted", submission: { status: "queued" } },
    { id: "submitted", submission: { status: "pending" }, pausedReason: "failed before dispatch" },
    { id: "submitted", submission: { status: "outcome-unknown" }, pausedReason: "unconfirmed" },
  ]) {
    const item = { ...message, submissionIntent: "send-now", createdAt: Date.now() };
    const get = key => key === "messages" ? [item] : key === "admitted" ? "submitted" : false;
    assert.equal(select("thread", { get })[0], item);
  }
  const sending = { id: "submitted", submission: { status: "sending" }, submissionIntent: "send-now" };
  assert.equal(select("thread", { get: key => key === "messages" ? [sending] : key === "admitted" ? "submitted" : false }).length, 0);
});
test("pinned transform fails closed for missing, repeated and partial anchors", () => {
  assert.throws(() => injectComposerDraft(original.replace("async function uua({", "async function changed({")), /anchor/);
  assert.throws(() => injectComposerDraft(original + "async function uua({"), /anchor/);
  assert.throws(() => injectComposerDraft(transformed.replace("__azraelClear(nt)", "l(nt)")), /partial/);
  assert.throws(() => injectComposerDraft(transformed + MARKER), /partial/);
  assert.equal(injectComposerDraft(transformed).count, 0);
});
test("namespace integrates draft protection and fingerprints its source for cache invalidation", () => {
  const host = require("./namespace-azrael-host.cjs");
  const result = host.transformAsset(original, COMPOSER_DRAFT_ASSET, "composer.js", ts);
  assert.equal(result.asset.composerDraftEdits, 1);
  assert.equal(host.getTransformRules()["inject-composer-draft.cjs"], crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "inject-composer-draft.cjs"))).digest("hex"));
});

"use strict";

const assert = require("node:assert/strict");
const hs = require("node:fs");
const path = require("node:path");
const pm = require("node:vm");
const util = require("node:util");
const test = require("node:test");
const crypto = require("node:crypto");
const { COMPOSER_DRAFT_ASSET, MARKER, injectComposerDraft } = require("./inject-composer-draft.cjs");
const { injectQueuedCompactionPresentation } = require("./inject-queued-compaction.cjs");
const repo = path.resolve(__dirname, "..");
const ts = require(path.join(repo, "extensions/azrael-ex/node_modules/typescript"));
const original = hs.readFileSync(path.join(repo, "artifacts/upstream-ui/26.930.61225", COMPOSER_DRAFT_ASSET), "utf8");
const draftOnly = injectComposerDraft(original).text;
const transformed = injectQueuedCompactionPresentation(draftOnly).text;
const Cst = ts.createSourceFile("composer.js", transformed, 99, true, 1);
assert.equal(Cst.parseDiagnostics.length, 0);
const declarations = new Map(Cst.statements.filter(ts.isFunctionDeclaration).map(n => [n.name.text, n.getText(Cst)]));
const baselineAst = ts.createSourceFile("baseline-composer.js", draftOnly, 99, true, 1);
const baselineSubmit = baselineAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === "Jfa").getText(baselineAst);

// Execute the entire production submission function, clear function, retention
// function and comparison functions. Only platform/controller/atom/RPC adapters
// are simulated; assertions exercise the callbacks supplied to the real submit.
function fixture({ type = "local", text = "A", beforePreparation, submission, sidechat, fresh = false, current = true, isolation = true, compact, options = {} } = {}) {
  const attachmentFields = ["imageAttachments", "imageCommentDrafts", "appshotContexts", "fileAttachments", "pastedTextAttachments", "uploadedFileAttachments", "addedFiles", "mcpAppModelContextAttachments", "selectedTextAttachments", "responseTextAnnotations", "attachmentOrder"];
  const attachments = Object.fromEntries(attachmentFields.map(k => [k, []]));
  const atoms = new Map([...["kG", "rW", "nW", "NU", "RU"].map(k => [k, []]), ["XU", 0]]);
  let editor = text, draft = { prompt: text, pullRequestChecks: [] }, retained, callback, restores = 0, clears = 0, unsubscribes = 0;
  const events = [], errors = [], compactions = [], submissions = [];
  const scope = {
    value: { kind: "local", conversationId: "thread" },
    get(atom) {
      if (atom === "drafts") return { thread: draft };
      if (atom === "vG") return attachments;
      if (atom === "lG" || atom === "cG") return retained;
      return atoms.get(atom);
    },
    set(atom, key, value) {
      if (atom === "cG") retained = value;
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
  const context = pm.createContext({
    Symbol, JSON, performance, WeakMap, Sp: () => "thread", lOe: () => "thread", rG: { drafts$: "drafts" }, tG: { default: (a, b) => util.isDeepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null))) },
    Hx: (_scope, host) => ({ compactThread: async id => { compactions.push({ host, id }); await compact?.(); } }),
    ...Object.fromEntries(["vG", "kG", "rW", "nW", "NU", "RU", "XU", "ZU", "cG", "lG", "WJ", "Gp", "Dj", "zA"].map(k => [k, k])),
    PS: () => ({ u: x => x, d: noop }), _ot: () => false, Kfa: x => x, _da: async () => [],
    cFe: "cFe", qfa: () => ["sidechat"],
    jQ: ({ context, text, messageId }) => ({ id: messageId ?? "input-A", text, context }),
    Kwe: noop, Jg: { abort: noop, fail: noop }, eA: noop, Xfa: noop, Zfa: noop, kan: noop,
    Md: {}, mp: { warning: noop, debug: noop },
    hFe: class extends Error {}, EE: class extends Error {}, DE: class extends Error {}, kQ: class extends Error {},
    l7: noop, pta: noop, N9i: noop, IQ: noop, uxr: noop, X6n: noop,
    Gnr() { for (const k of attachmentFields) attachments[k] = []; if (!retained) draft = undefined; },
    QW(_e, value, _text, options) { if (!retained || options?.discardRetainedDraft) draft = value; },
  });
  for (const name of ["$W", "srr", "crr", "drr", "Fnr", "yta", "__azraelComposerSnapshot", "__azraelComposerMatches", "Jfa"]) pm.runInContext(declarations.get(name), context);
  pm.runInContext("const __azraelCompactActions=new WeakMap", context);
  for (const name of ["THi", "__azraelCompactAction", "__azraelRunSlashSelection", "__azraelSubmitCompaction"]) pm.runInContext(declarations.get(name), context);
  if (!isolation) pm.runInContext(baselineSubmit, context);
  const clear = context.yta({ scope, composerController: controller, attachmentGeneration: { current: 0 }, fileAttachments: [], pastedTextAttachments: [], commentAttachments: [], clearPendingAppshotCaptures: noop, setComments: noop, setPendingFileAttachments: noop, setPriorConversation: noop });
  const f = {
    attachments, atoms, controller, context, scope, events, errors, compactions, submissions,
    text: () => editor, retained: () => retained, clears: () => clears, restores: () => restores, unsubscribes: () => unsubscribes,
    edit(value) { controller.setText(value); },
    added(flags = {}) { assert(callback, "submission callback is available"); callback(flags); },
    async run() {
      await context.Jfa({
        scope, composerController: controller, clearStopTurnConfirmation: noop,
        clearComposerUi(nt) { clears++; clear({ submittedContext: nt }); },
        retainComposerPrompt: options => context.Fnr(scope, options),
        restoreComposerDraft(item) { restores++; controller.setText(item.text); },
        buildLocalContextForPrompt: async prompt => ({ prompt, ...attachments, ideContext: null }),
        prepareGoalSubmit: async () => { await beforePreparation?.(f); return { status: "continue" }; },
        submitTarget: { type, cwd: "fixture", submit: async (...args) => { submissions.push(args); callback = args.at(-1); return submission ? submission(f, args) : (callback(), { messageResult: { status: "queued" } }); } },
        conversationId: fresh ? null : "thread", followUp: fresh ? null : { type: "local", localConversationId: "thread" }, isResponseInProgress: true,
        isCurrentSubmission: () => current, isElectron: sidechat != null,
        openSideChatFromComposer: async () => sidechat(f), handleSideChatOpenError: e => errors.push(e),
        defaultFollowUpSubmitAction: "queue", submitButtonMode: "queue", canQueueFollowUp: false,
        appendPromptToHistory: noop, resetHistorySelection: noop, focusComposer: noop, setIsSubmitting: noop,
        invalidateRateLimit: noop, handleEditedQueuedMessageSubmitted: async () => {}, logMessageSent: noop,
        handleSubmitError: e => errors.push(e), options, prompts: [], mentionedThreadReferences: [],
      });
    },
  };
  if (sidechat) atoms.set("cFe", true);
  return f;
}

test("the pinned ordinary submit previously delivered /compact with draft attachments", async () => {
  const f = fixture({ text: "/compact keep this draft", isolation: false });
  f.attachments.fileAttachments.push({ path: "draft-only.txt" });
  await f.run();
  assert.equal(f.submissions.length, 1);
  assert.match(JSON.stringify(f.submissions), /\/compact keep this draft/);
  assert.match(JSON.stringify(f.submissions), /draft-only\.txt/);
  assert.equal(f.compactions.length, 0);
});

for (const text of ["/compact", "/compact keep this draft", "  /compact\nkeep this draft"]) {
  test(`compact submit isolates user input and keeps attachments: ${JSON.stringify(text)}`, async () => {
    const f = fixture({ text });
    f.attachments.fileAttachments.push({ path: "draft-only.txt" });
    f.attachments.imageAttachments.push({ id: "draft-image" });
    const saved = JSON.stringify(f.attachments);
    await f.run();
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.compactions, [{ host: undefined, id: "thread" }]);
    assert.equal(f.submissions.length, 0);
    assert.equal(f.clears(), 0);
    assert.equal(f.text(), text.replace(/^\s*\/compact[ \t]*/, ""));
    assert.equal(JSON.stringify(f.attachments), saved);
  });
}

test("inline compaction owns the submit while its command is removed and RPC awaits", async () => {
  let release;
  const f = fixture({ text: "/compact keep this draft", compact: () => new Promise(resolve => { release = resolve; }) });
  f.attachments.fileAttachments.push({ path: "draft-only.txt" });
  const pending = f.context.__azraelRunSlashSelection({ id: "compact" }, f.controller, () => f.context.THi(
    { type: "action", run: () => f.context.Hx(f.scope).compactThread("thread") },
    { replacementRange: { from: 0, to: 9 } },
    { clearReplacementRange: () => f.edit("keep this draft") },
  ));
  await Promise.resolve();
  assert.equal(f.text(), "keep this draft");
  await f.run();
  assert.equal(f.submissions.length, 0);
  assert.equal(f.compactions.length, 1);
  release(); await pending;
  assert.equal(f.attachments.fileAttachments.length, 1);
  await f.run();
  assert.equal(f.submissions.length, 1, "explicit later submit still works");
});

test("duplicate compact submits enqueue once and newer edits survive", async () => {
  let release;
  const f = fixture({ text: "/compact draft A", compact: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.run();
  await Promise.resolve();
  f.edit("draft B");
  await f.run();
  assert.equal(f.submissions.length, 0);
  assert.equal(f.compactions.length, 1);
  release(); await pending;
  assert.equal(f.text(), "draft B");
});

test("failed compact preserves the command, text and attachments for retry", async () => {
  const f = fixture({ text: "/compact keep this draft", compact: async () => { throw Error("compaction failed"); } });
  f.attachments.fileAttachments.push({ path: "draft-only.txt" });
  await f.run();
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0].message, /compaction failed/);
  assert.equal(f.submissions.length, 0);
  assert.equal(f.text(), "/compact keep this draft");
  assert.equal(f.attachments.fileAttachments.length, 1);
  await f.run();
  assert.equal(f.compactions.length, 2, "failed pending gate is released");
});

test("compact on a new conversation reports an error without submitting attachments", async () => {
  const f = fixture({ text: "/compact", fresh: true });
  f.attachments.fileAttachments.push({ path: "draft-only.txt" });
  await f.run();
  assert.equal(f.compactions.length, 0);
  assert.equal(f.submissions.length, 0);
  assert.match(f.errors[0].message, /existing conversation/);
  assert.equal(f.text(), "/compact");
  assert.equal(f.attachments.fileAttachments.length, 1);
});

test("compact prompt override does not change the editable draft or attachments", async () => {
  const f = fixture({ text: "keep this draft", options: { promptRawOverride: "/compact" } });
  f.attachments.fileAttachments.push({ path: "draft-only.txt" });
  await f.run();
  assert.equal(f.compactions.length, 1);
  assert.equal(f.submissions.length, 0);
  assert.equal(f.text(), "keep this draft");
  assert.equal(f.attachments.fileAttachments.length, 1);
});

for (const [text, options] of [["/compactness", {}], ["ordinary /compact mention", {}], ["/compact", { literalPrompt: true }]]) {
  test(`ordinary or literal input remains a message: ${JSON.stringify([text, options])}`, async () => {
    const f = fixture({ text, options });
    await f.run();
    assert.equal(f.compactions.length, 0);
    assert.equal(f.submissions.length, 1);
  });
}

test("unchanged early callback clears once; duplicate callback and final success are safe", async () => {
  const f = fixture({ submission: async f => { f.added(); f.added({ locallyAccepted: true }); f.added({ requestDispatched: true }); return { messageResult: { status: "queued" } }; } });
  await f.run(); assert.deepEqual(f.errors, []); assert.equal(f.text(), ""); assert.equal(f.clears(), 1); assert.equal(f.retained(), undefined); assert.equal(f.unsubscribes(), 1);
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
test("app context added after clear survives acceptance without err clearing it", async () => {
  const f = fixture({ submission: async f => { f.added(); f.attachments.mcpAppModelContextAttachments.push({ id: "B", kind: "context" }); f.added({ requestDispatched: true }); return { messageResult: { status: "queued" } }; } });
  await f.run(); assert.equal(f.attachments.mcpAppModelContextAttachments[0].id, "B"); assert.equal(f.clears(), 1); assert.equal(f.retained(), undefined);
});
test("attachment-only edit after clear prevents failure restoration over the new draft", async () => {
  const f = fixture({ submission: async f => { f.added(); f.attachments.mcpAppModelContextAttachments.push({ id: "B", kind: "context" }); throw Error("rejected"); } });
  await f.run(); assert.equal(f.text(), ""); assert.equal(f.restores(), 0); assert.equal(f.attachments.mcpAppModelContextAttachments[0].id, "B"); assert.equal(f.retained(), undefined);
});
test("an older retention callback cannot abandon a newer same-thread owner", () => {
  const f = fixture(), releaseA = f.context.Fnr(f.scope);
  f.edit("B"); const releaseB = f.context.Fnr(f.scope), ownerB = f.retained();
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
  f.atoms.set("rW", [{ id: "B" }]); assert.equal(f.context.__azraelComposerMatches(f.scope, f.controller, snapshot), false);
});

test("locally held follow-ups remain visible during the optimistic send window", () => {
  let selector;
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(Cst) === "Rda" && ts.isCallExpression(node.right) && node.right.arguments.length > 1 && ts.isArrowFunction(node.right.arguments[1])) selector = node.right.arguments[1].getText(Cst);
    ts.forEachChild(node, visit);
  }
  visit(Cst);
  assert.ok(selector, "pinned queue visibility selector exists");
  const select = pm.runInNewContext(`(${selector})`, { CQ: "messages", uBr: "admitted", Lda: "elapsed" });
  for (const message of [
    { id: "submitted", submission: { status: "pending" } },
    { id: "submitted", submission: { status: "sending" } },
    { id: "local-id", submissionOptions: { clientUserMessageId: "submitted" }, submission: { status: "sending" } },
    { id: "submitted", submission: { status: "queued" } },
    { id: "submitted", submission: { status: "pending" }, pausedReason: "failed before dispatch" },
    { id: "submitted", submission: { status: "outcome-unknown" }, pausedReason: "unconfirmed" },
  ]) {
    const item = { ...message, submissionIntent: "send-now", createdAt: Date.now() };
    const get = key => key === "messages" ? [item] : key === "admitted" ? "submitted" : false;
    assert.equal(select("thread", { get })[0], item);
  }
  for (const status of ["pending", "sending"]) {
    for (const elapsed of [false, true]) {
      const items = ["A", "B", "C"].map(id => ({ id, submission: { status }, submissionIntent: "send-now", createdAt: 0 }));
      const get = key => key === "messages" ? items : key === "admitted" ? "A" : elapsed;
      assert.deepEqual(Array.from(select("thread", { get }), item => item.id), ["A", "B", "C"]);
      items.shift(); // Accepted removal by the queue owner controls visibility.
      assert.deepEqual(Array.from(select("thread", { get }), item => item.id), items.map(item => item.id));
    }
  }
  const legacy = { id: "submitted", submissionIntent: "send-now", createdAt: 0 };
  assert.equal(select("thread", { get: key => key === "messages" ? [legacy] : key === "admitted" ? "submitted" : false }).length, 0);
});
test("pinned transform fails closed for missing, repeated and partial anchors", () => {
  for (const version of [1, 2]) assert.throws(() => injectComposerDraft(original + `/*azrael-composer-draft-v${version}*/`), /Outdated/);
  assert.throws(() => injectComposerDraft(original.replace("async function Jfa({", "async function changed({")), /anchor/);
  assert.throws(() => injectComposerDraft(original + "async function Jfa({"), /anchor/);
  assert.throws(() => injectComposerDraft(transformed.replace("__azraelClear(st)", "l(st)")), /partial/);
  assert.throws(() => injectComposerDraft(transformed + MARKER), /partial/);
  assert.equal(injectComposerDraft(transformed).count, 0);
});
test("namespace integrates draft protection and fingerprints its source for cache invalidation", () => {
  const host = require("./namespace-azrael-host.cjs");
  const result = host.transformAsset(original, COMPOSER_DRAFT_ASSET, "composer.js", ts);
  assert.equal(result.asset.composerDraftEdits, 1);
  assert.equal(host.getTransformRules()["inject-composer-draft.cjs"], crypto.createHash("sha256").update(hs.readFileSync(path.join(__dirname, "inject-composer-draft.cjs"))).digest("hex"));
});

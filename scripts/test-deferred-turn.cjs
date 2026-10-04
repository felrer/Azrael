"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { rewriteJavaScript, transformAsset } = require("./namespace-azrael-host.cjs");
const patch = require("./inject-deferred-turn.cjs");
const waitHelpers = require("./root-resume-wait.cjs");

const root = process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.928.31416");
const inputs = [
  [patch.DEFERRED_REDUCER_ASSET, patch.injectDeferredTurn, 6],
  [patch.DEFERRED_PRESENTATION_ASSET, patch.injectDeferredPresentation, 8],
  ["out/extension.js", patch.injectDeferredHostNotification, 1],
  [patch.DEFERRED_WAIT_RENDERER_ASSET, patch.injectDeferredWaitRenderer, 2],
  [patch.DEFERRED_THREAD_ASSET, patch.injectDeferredThread, 4],
  [patch.DEFERRED_TURN_ASSET, patch.injectDeferredTurnView, 3],
  [patch.DEFERRED_COLLAPSED_ASSET, patch.injectDeferredCollapsed, 2],
].map(([asset, inject, count]) => {
  const file = path.join(root, asset);
  const source = rewriteJavaScript(fs.readFileSync(file, "utf8"), file, ts).text;
  return { file, source, result: inject(source), inject, count };
});

const astCache = new Map();
function sourceAst(source) {
  if (!astCache.has(source)) astCache.set(source, ts.createSourceFile("fixture.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
  return astCache.get(source);
}

function functionContaining(source, marker) {
  const ast = sourceAst(source);
  const position = source.indexOf(marker);
  assert.notEqual(position, -1);
  let found;
  function visit(node) {
    if (node.pos <= position && node.end >= position) {
      if (ts.isFunctionDeclaration(node)) found = node;
      ts.forEachChild(node, visit);
    }
  }
  visit(ast);
  assert.ok(found);
  return source.slice(found.getStart(ast), found.end);
}

function functionNamed(source, name) {
  const ast = sourceAst(source);
  const found = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(found, name);
  return source.slice(found.getStart(ast), found.end);
}

test("deferred anchors match the pinned host, parse, and fail closed", () => {
  for (const { file, source, result, inject, count } of inputs) {
    assert.equal(result.count, count, file);
    assert.equal(ts.createSourceFile(file, result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
    assert.throws(() => inject(result.text), /anchor must occur exactly once/);
    assert.throws(() => inject("anchor missing"), /anchor must occur exactly once/);
    assert.notEqual(source, result.text);
  }
});

test("deferred updates the current turn without terminal side effects and drains before replay", () => {
  const reducer = vm.runInNewContext(`(${functionContaining(inputs[0].result.text, "case`turn/deferred`:")})`, { H: x => x, ...waitHelpers });
  const turn = { turnId: "turn-1", status: "inProgress", error: { message: "stale" }, items: [] };
  const conversation = { turns: [turn] }, conversations = new Map([["thread-1", conversation]]), calls = [];
  let draining = true, replay;
  const manager = {
    logger: { error: () => calls.push("error") },
    broadcastConversationSnapshot: () => calls.push("snapshot"),
    onNotification: () => calls.push("replay"),
  };
  const notificationContext = {
    itemStreamState: { drainBefore: callback => { if (draining) replay = callback; return draining; } },
    threadStore: { conversations },
    updateTurnState: (_thread, _id, update) => { calls.push("update"); update(turn); },
  };
  const event = { method: "turn/deferred", params: { threadId: "thread-1", turn: { id: "turn-1", durationMs: 4250, startedAt: 12 } } };
  const environment = { manager, notificationContext };
  assert.equal(reducer(environment, event), "deferred");
  assert.deepEqual(calls, []);
  draining = false;
  replay();
  assert.deepEqual(calls, ["replay"]);
  assert.equal(reducer(environment, event), "handled");
  assert.deepEqual(calls, ["replay", "update", "snapshot"]);
  assert.equal(turn.status, "deferred");
  assert.equal(turn.durationMs, 4250);
  assert.equal(turn.turnStartedAtMs, 12000);
  assert.equal(turn.error, null);
  assert.equal(conversation.turns.length, 1);
});

test("presentation projects deferred duration and a frozen waiting divider", () => {
  const source = inputs[1].result.text;
  const status = vm.runInNewContext(`(${functionNamed(source, "Ont")})`);
  const duration = vm.runInNewContext(`(${functionNamed(source, "Hmt")})`);
  const divider = vm.runInNewContext(`(${functionNamed(source, "$mt")})`, waitHelpers);
  assert.equal(status("deferred"), "deferred");
  assert.equal(duration({ turnStartedAtMs: 12000, durationMs: 4250 }), 16250);
  assert.deepEqual(JSON.parse(JSON.stringify(divider({ items: [{ type: "agent-message" }], status: "deferred", workStartedAtMs: 12000, finalAssistantStartedAtMs: 16250 })[1])),
    { type: "worked-for", status: "worked", startedAtMs: 12000, completedAtMs: 16250 });
  assert.deepEqual(JSON.parse(JSON.stringify(divider({ items: [], status: "deferred", workStartedAtMs: null, finalAssistantStartedAtMs: null })[0])),
    { type: "worked-for", status: "pausedUnknown", startedAtMs: 0, completedAtMs: 0 });
  assert.match(source, /case`pausedUnknown`:l=`작업 시간 확인 불가`/);
  assert.match(source, /case`azraelWaitUnknown`:l=`재개 대기 이력 · 대기 시간 확인 불가`/);
  assert.ok(source.includes("durationMs"));
});

function reservation(overrides = {}) {
  return { reservationId: "reservation-1", revision: 1, waitStartedAtMs: 20000, waitEndedAtMs: null,
    resumeAtMs: 80000, state: "waiting", canWakeEarly: false, ...overrides };
}

function clockHook() {
  let now = 20000, state, callback, interval;
  const slots = Array(7).fill(Symbol.for("react.memo_cache_sentinel"));
  const hook = vm.runInNewContext(`(${functionNamed(inputs[1].result.text, "cki")})`, {
    uki: { c: () => slots }, Gn: () => ({ locale: "ko-KR" }),
    dki: { useState: init => { state ??= init(); return [state, value => { state = value; }]; } },
    lki: () => now, Date: { now: () => now },
    Ymn: (fn, delay) => { callback = fn; interval = delay; }, Uyi: ms => `${Math.floor(ms / 1000)}초`,
  });
  return {
    render: item => hook(item),
    advance: ms => { now += ms; if (interval != null) callback(); },
    interval: () => interval,
  };
}

test("waiting uses the existing clock hook, then freezes after early resume or cancellation", () => {
  const clock = clockHook(), wait = reservation({ canWakeEarly: true });
  let item = waitHelpers.azraelRootResumeWaitItem(wait);
  assert.equal(clock.render(item).elapsedMs, 0);
  assert.equal(clock.interval(), 1000);
  clock.advance(12000);
  assert.equal(waitHelpers.azraelRootResumeWaitLabel(wait, clock.render(item).elapsedMs),
    "재개까지 최대 60초 대기 · 현재 12초 대기함 · 자식 작업 완료 시 조기 재개");
  const ended = { ...wait, state: "resumed", revision: 3, waitEndedAtMs: 66000 };
  item = waitHelpers.azraelRootResumeWaitItem(ended);
  assert.equal(clock.render(item).elapsedMs, 46000);
  assert.equal(clock.interval(), null);
  clock.advance(600000);
  assert.equal(clock.render(item).elapsedMs, 46000);
  assert.equal(waitHelpers.azraelRootResumeWaitLabel(ended, 46000), "46초 대기 후 재개됨");
  assert.equal(waitHelpers.azraelRootResumeWaitLabel({ ...ended, state: "cancelled" }, 46000), "46초 대기 후 예약 취소됨");
});

test("repeated reservations have independent clocks and completed history has no running divider", () => {
  const divider = vm.runInNewContext(`(${functionNamed(inputs[1].result.text, "$mt")})`, waitHelpers);
  const first = divider({ items: [], status: "deferred", workStartedAtMs: 12000, finalAssistantStartedAtMs: 20000,
    rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }) });
  const secondWait = reservation({ reservationId: "reservation-2", waitStartedAtMs: 90000, resumeAtMs: 150000 });
  let second = divider({ items: [], status: "deferred", workStartedAtMs: 66000, finalAssistantStartedAtMs: 90000, rootResumeWait: secondWait });
  assert.deepEqual(Array.from(first, x => x.completedAtMs), [20000, 66000]);
  assert.deepEqual(Array.from(second, x => x.startedAtMs), [66000, 90000]);
  const workClock = clockHook();
  assert.equal(workClock.render(second[0]).elapsedMs, 24000);
  assert.equal(workClock.interval(), null);
  workClock.advance(3600000);
  assert.equal(workClock.render(second[0]).elapsedMs, 24000);
  second = divider({ items: [], status: "deferred", workStartedAtMs: 66000, finalAssistantStartedAtMs: 90000,
    rootResumeWait: { ...secondWait, revision: 3, state: "resumed", waitEndedAtMs: 100000 } });
  assert.equal(second[1].completedAtMs - second[1].startedAtMs, 10000);
  assert.ok([...first, ...second].every(x => x.completedAtMs != null && x.status !== "working" && x.status !== "azraelWaiting"));
});

test("late and duplicate reservation notifications cannot restart a finished wait or change its endpoints", () => {
  const reducer = vm.runInNewContext(`(${functionContaining(inputs[0].result.text, "case`turn/deferred`:")})`, { H: x => x, ...waitHelpers });
  const turn = { turnId: "old-turn", status: "deferred", durationMs: 8000, rootResumeWait: reservation() };
  const env = {
    manager: { broadcastConversationSnapshot: () => {} },
    notificationContext: { itemStreamState: { drainBefore: () => false },
      threadStore: { conversations: new Map([["thread", { turns: [turn] }]]) },
      updateTurnState: (_thread, id, update) => { assert.equal(id, turn.turnId); update(turn); } },
  };
  const emit = wait => reducer(env, { method: "turn/rootResumeWait/updated", params: { threadId: "thread", turnId: "old-turn", wait } });
  emit(reservation({ revision: 2, state: "claimed", waitEndedAtMs: 66000 }));
  emit(reservation({ revision: 3, state: "resumed", waitStartedAtMs: 21000, waitEndedAtMs: 67000 }));
  assert.equal(turn.rootResumeWait.waitStartedAtMs, 20000);
  assert.equal(turn.rootResumeWait.waitEndedAtMs, 66000);
  emit(reservation());
  emit(reservation({ revision: 4 }));
  emit(reservation({ reservationId: "unrelated", revision: 9 }));
  assert.equal(turn.rootResumeWait.state, "resumed");
  assert.equal(turn.rootResumeWait.revision, 3);
  turn.status = "interrupted";
  reducer(env, { method: "turn/deferred", params: { threadId: "thread", turn: { id: "old-turn", durationMs: 1, startedAt: 99 } } });
  assert.equal(turn.status, "interrupted");
  assert.equal(turn.durationMs, 8000);
});

test("history hydration retains wait metadata including missing historical boundaries", () => {
  const hydrate = vm.runInNewContext(`(${functionNamed(inputs[0].result.text, "Kyn")})`, {
    qyn: x => x, Yyn: x => x == null ? null : x * 1000, re: () => ({}), Wt: () => [],
  });
  const wait = reservation({ revision: 3, state: "resumed", waitEndedAtMs: 66000 });
  const history = hydrate({ threadId: "thread", turns: [{ id: "old-turn", items: [], status: "deferred", startedAt: 12,
    completedAt: null, durationMs: 8000, rootResumeWait: wait }], permissions: {} });
  assert.equal(history[0].rootResumeWait, wait);
  const item = waitHelpers.azraelRootResumeWaitItem(history[0].rootResumeWait);
  const clock = clockHook();
  assert.equal(clock.render(item).elapsedMs, 46000);
  assert.equal(clock.interval(), null);
  const unknown = reservation({ state: "resumed", waitStartedAtMs: null, waitEndedAtMs: null });
  assert.equal(waitHelpers.azraelRootResumeWaitLabel(unknown, 0), "재개됨 · 대기 시간 확인 불가");
  assert.equal(waitHelpers.azraelRootResumeWaitItem(unknown).status, "azraelWaitEnded");
});

test("blocked and processing reservations freeze elapsed time independently of the scheduled deadline", () => {
  for (const state of ["claimed", "blocked", "cancelled"]) {
    const wait = reservation({ state, waitEndedAtMs: 32000 });
    const clock = clockHook(), item = waitHelpers.azraelRootResumeWaitItem(wait);
    assert.equal(clock.render(item).elapsedMs, 12000);
    assert.equal(clock.interval(), null);
    clock.advance(3600000);
    assert.equal(clock.render(item).elapsedMs, 12000);
  }
  assert.equal(waitHelpers.azraelRootResumeWaitLabel(reservation(), 12000), "60초 대기 예정 · 현재 12초 대기함");
  assert.equal(waitHelpers.azraelRootResumeWaitLabel(reservation({ state: "blocked", waitEndedAtMs: 32000 }), 12000), "재개 차단됨 · 12초 대기");
});

test("divider preserves Codex secondary text and border styling while forwarding waiting metadata", () => {
  const source = inputs[1].result.text;
  const slots = Array(14).fill(Symbol.for("react.memo_cache_sentinel"));
  const render = vm.runInNewContext(`(${functionNamed(source, "ski")})`, {
    uki: { c: () => slots }, A7: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    oki: "clock-label", L3: "chat-padding", xa: (...values) => values.filter(Boolean).join(" "),
  });
  const waiting = waitHelpers.azraelRootResumeWaitItem(reservation());
  const result = render(waiting), container = result.props.children;
  assert.match(container.props.className, /text-size-chat text-secondary/);
  assert.equal(container.props.children[1].props.className, "w-full border-t border-default");
  assert.equal(container.props.children[0].props.rootResumeWait, waiting.rootResumeWait);
  const processing = { ...waiting, rootResumeWait: reservation({ revision: 2, state: "claimed", waitEndedAtMs: 32000 }) };
  assert.equal(render(processing).props.children.props.children[0].props.rootResumeWait.state, "claimed");
});

test("active activity projection cannot resurrect a deferred source turn or discard its waiting divider", () => {
  const presentation = inputs[1].result.text;
  const context = {
    ...waitHelpers, $ft: () => ({ replyItemIds: new Set() }), hpt: () => [], vpt: x => x,
    af: () => false, BZe: () => null, HS: () => null,
    Exe: () => null, uht: { default: (items, predicate) => items.findLast(predicate) },
  };
  const declarations = ["Ont", "$mt", "azraelOriginalWorkDivider", "eht", "ipt", "iht", "nht", "tht", "apt", "Hmt", "GS"]
    .map(name => functionNamed(presentation, name)).join("\n");
  const project = vm.runInNewContext(`${declarations}\nGS`, context);
  const env = { _p: () => [], op: () => false, ae: x => x,
    Uo: (turn, requests, options) => project(turn, requests, { ...options, includeAeonProjection: false, includeTurnDiff: false }) };
  const patched = vm.runInNewContext(`(${functionNamed(inputs[4].result.text, "cp")})`, env);
  const original = vm.runInNewContext(`(${functionNamed(inputs[4].source, "cp")})`, env);
  const sourceTurn = { status: "deferred", turnId: "old-turn", turnStartedAtMs: 12000, durationMs: 8000,
    firstTurnWorkItemStartedAtMs: 12000, finalAssistantStartedAtMs: null, params: { input: [], threadId: "thread" },
    items: [], rootResumeWait: reservation() };
  const segment = { key: "segment", itemIds: [], state: "active", presentation: "voice-work", startedAtMs: 12000, completedAtMs: null };
  const props = { requests: [], generatedImages: [], preserveServerUserMessages: false };
  const before = original(props, sourceTurn, segment, {}, false);
  assert.equal(before.turn.status, "inProgress");
  assert.equal(before.turn.durationMs, null);
  assert.equal(before.turnState.items.length, 0);
  const after = patched(props, sourceTurn, segment, {}, false);
  assert.equal(after.turn.status, "deferred");
  assert.equal(after.turn.durationMs, 8000);
  assert.equal(after.voiceWorkActivity, "terminal");
  assert.equal(after.turnState.items[0].status, "worked");
  assert.equal(after.turnState.items[0].completedAtMs, 20000);
  assert.equal(after.turnState.items[1].rootResumeWait, sourceTurn.rootResumeWait);
  const ended = patched(props, { ...sourceTurn, rootResumeWait: reservation({ state: "resumed", revision: 3, waitEndedAtMs: 66000 }) }, segment, {}, false);
  const clock = clockHook();
  assert.equal(clock.render(ended.turnState.items[1]).elapsedMs, 46000);
  assert.equal(clock.interval(), null);
});

test("interrupted work with a native measured duration uses a fixed stopped divider", () => {
  const divider = vm.runInNewContext(`(${functionNamed(inputs[1].result.text, "ipt")})`);
  const stopped = divider({ status: "cancelled", hasStartedWork: true, workStartedAtMs: 12000, workedCompletedAtMs: 20000 });
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.completedAtMs, 20000);
  const clock = clockHook();
  assert.equal(clock.render(stopped).elapsedMs, 8000);
  assert.equal(clock.interval(), null);
});

test("complete host transform pipeline includes every waiting asset and preserves pinned anchors", () => {
  for (const input of inputs) {
    const asset = path.relative(root, input.file).replaceAll("\\", "/");
    const transformed = transformAsset(fs.readFileSync(input.file, "utf8"), asset, input.file, ts);
    assert.ok(transformed.asset, asset);
    assert.equal(transformed.asset.deferredTurnEdits, input.count, asset);
    assert.equal(ts.createSourceFile(asset, transformed.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0, asset);
  }
});

test("final completed work has its own fixed duration alongside earlier frozen reservation history", () => {
  const source = inputs[1].result.text;
  const declarations = ["$mt", "azraelOriginalWorkDivider", "eht", "ipt", "iht", "nht", "tht", "rht"]
    .map(name => functionNamed(source, name)).join("\n");
  const divide = vm.runInNewContext(`${declarations}\n$mt`, waitHelpers);
  const items = divide({ items: [{ type: "exec" }, { type: "assistant-message", phase: "final_answer" }],
    status: "complete", workStartedAtMs: 100000, finalAssistantStartedAtMs: 110000 });
  const work = items.find(x => x.type === "worked-for");
  assert.equal(work.status, "worked");
  const clock = clockHook();
  assert.equal(clock.render(work).elapsedMs, 10000);
  assert.equal(clock.interval(), null);
  clock.advance(3600000);
  assert.equal(clock.render(work).elapsedMs, 10000);
});

test("collapsed chat summary forwards waiting metadata and updates when the reservation state changes", () => {
  const slots = Array(17).fill(Symbol.for("react.memo_cache_sentinel"));
  const render = vm.runInNewContext(`(${functionNamed(inputs[6].result.text, "C")})`, {
    T: { c: () => slots }, E: { jsx: (type, props) => ({ type, props }) }, h: "clock-label",
  });
  const item = waitHelpers.azraelRootResumeWaitItem(reservation());
  assert.equal(render({ workedForItem: item }).props.rootResumeWait.state, "waiting");
  const changed = { ...item, rootResumeWait: reservation({ revision: 2, state: "claimed", waitEndedAtMs: 32000 }) };
  assert.equal(render({ workedForItem: changed }).props.rootResumeWait.state, "claimed");
});

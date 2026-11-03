"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createQuestionNotifications } = require("./question-notifications.cjs");
function fixture({ supported = true, fail = false } = {}) {
  const shown = [], navigation = [], errors = [], panel = {};
  class Notification extends EventEmitter {
    static isSupported() { return supported; }
    constructor(options) { super(); this.options = options; shown.push(this); }
    show() { if (fail) throw Error("OS unavailable"); }
    close() { this.closed = true; }
  }
  const owner = createQuestionNotifications({ Notification, activate: (...args) => navigation.push(args), onError: error => errors.push(error) });
  const emit = (method, params) => owner.observe(panel, { type: "mcp-notification", hostId: "local", method, params });
  const questions = (values, itemId = "questions") => emit("item/completed", { threadId: "thread", item: { type: "agentMessage", id: itemId, questions: values } });
  return { owner, panel, emit, questions, shown, navigation, errors };
}
test("native synchronous requests notify once and resolved requests cannot navigate", () => {
  const f = fixture();
  const envelope = { type: "mcp-request", hostId: "local", request: { id: 7, method: "item/tool/requestUserInput", params: { threadId: "thread", questions: [{ question: "Choose" }] } } };
  f.owner.observe(f.panel, envelope); f.owner.observe(f.panel, envelope);
  assert.equal(f.shown.length, 1); assert.equal(f.shown[0].options.silent, false);
  f.shown[0].emit("click"); assert.deepEqual(f.navigation, [[f.panel, "local", "thread"]]);
  f.emit("serverRequest/resolved", { requestId: 7 });
  assert.equal(f.shown[0].closed, true);
  f.shown[0].emit("click"); assert.equal(f.navigation.length, 1); f.owner.dispose();
});
test("async questions survive turn completion; withdrawal and accepted partial replies remove matching reminders", () => {
  const f = fixture(); f.questions([{ title: "First" }, { title: "Second" }]);
  f.questions([{ title: "First" }, { title: "Second" }]); assert.equal(f.shown.length, 2);
  f.emit("turn/completed", { threadId: "thread", turn: { status: "completed" } });
  assert.ok(f.shown.every(n => !n.closed));
  f.emit("item/completed", { threadId: "thread", item: { type: "userMessage", content: [{ type: "text", text: '<send_user_message_question_reply>' + JSON.stringify([{ questionItemId: JSON.stringify(["request_user_input_async", "questions", 0]), question: "First", answer: "Yes" }]) + '</send_user_message_question_reply>' }] } });
  assert.equal(f.shown[0].closed, true); assert.ok(!f.shown[1].closed);
  f.questions([{ title: "First" }, { title: "Second", withdrawn: true }]);
  assert.equal(f.shown.length, 2); assert.equal(f.shown[1].closed, true);
  for (const n of f.shown) n.emit("click"); assert.equal(f.navigation.length, 0); f.owner.dispose();
});
test("host boundaries isolate removal and fatal transport errors disable stale activation", () => {
  const f = fixture(); f.questions([{ title: "Question" }]);
  f.owner.observe(f.panel, { type: "mcp-notification", hostId: "other", method: "thread/closed", params: { threadId: "thread" } });
  assert.ok(!f.shown[0].closed);
  f.owner.observe(f.panel, { type: "codex-app-server-fatal-error", hostId: "local" });
  assert.equal(f.shown[0].closed, true); f.shown[0].emit("click"); assert.equal(f.navigation.length, 0);
  f.questions([{ title: "New" }], "next"); f.emit("thread/archived", { threadId: "thread" });
  assert.equal(f.shown[1].closed, true); f.owner.dispose();
});
test("panel and app disposal close reminders and ignore subsequent events", () => {
  const f = fixture(); f.questions([{ title: "Question" }]);
  f.owner.disposePanel(f.panel); assert.equal(f.shown[0].closed, true);
  f.shown[0].emit("click"); assert.equal(f.navigation.length, 0);
  f.questions([{ title: "New" }], "next"); f.owner.dispose();
  assert.equal(f.shown[1].closed, true); f.questions([{ title: "Later" }], "later"); assert.equal(f.shown.length, 2);
});
test("unavailable and failed OS delivery cannot block host message delivery", () => {
  for (const options of [{ supported: false }, { fail: true }]) {
    const f = fixture(options); assert.doesNotThrow(() => f.questions([{ title: "Question" }]));
    if (options.fail) { assert.equal(f.errors.length, 1); assert.equal(f.shown[0].closed, true); }
    else assert.equal(f.shown.length, 0);
    f.owner.dispose();
  }
});

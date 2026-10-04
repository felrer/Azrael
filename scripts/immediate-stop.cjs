"use strict";

// This factory is serialized into the pinned webview; keep its dependencies local.
function createImmediateStopCoordinator(options = {}) {
  const managers = new WeakMap();
  const now = options.now ?? (() => Date.now());
  const schedule = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const unschedule = options.clearTimeout ?? (id => clearTimeout(id));
  const deadlineMs = options.deadlineMs ?? 20000;
  const retryMs = options.retryMs ?? 25;
  const terminal = new Set(["completed", "interrupted", "failed"]);
  const timeout = () => Error("Stop timed out waiting for the selected turn");

  function bounded(promise, deadline) {
    return new Promise((resolve, reject) => {
      const remaining = deadline - now();
      if (remaining <= 0) { reject(timeout()); return; }
      const timer = schedule(() => reject(timeout()), remaining);
      Promise.resolve(promise).then(value => { unschedule(timer); resolve(value); }, error => {
        unschedule(timer); reject(error);
      });
    });
  }

  function trackStart(manager, conversationId, messageId, run) {
    let conversations = managers.get(manager);
    if (!conversations) managers.set(manager, conversations = new Map());
    let pending = conversations.get(conversationId);
    if (!pending) conversations.set(conversationId, pending = []);
    const record = { messageId, result: null };
    pending.push(record);
    // Register the token before invoking native code, including synchronous failures.
    let result;
    try { result = run(); } catch (error) { result = Promise.reject(error); }
    record.result = Promise.resolve(result).finally(() => {
      const index = pending.indexOf(record);
      if (index !== -1) pending.splice(index, 1);
      if (!pending.length && conversations.get(conversationId) === pending) conversations.delete(conversationId);
    });
    // The native caller and stop each receive failures; bookkeeping never leaks a rejection.
    record.result.catch(() => {});
    return record.result;
  }

  async function stop(manager, conversationId, expectedTurnId, userStop, runExpectedId, readLatestTurn) {
    if (!userStop || expectedTurnId != null) return runExpectedId(expectedTurnId);
    const record = managers.get(manager)?.get(conversationId)?.at(-1);
    const snapshot = readLatestTurn?.(manager, conversationId);
    let turnId;
    if (record) {
      const result = await bounded(record.result, now() + deadlineMs);
      turnId = result?.turn?.id;
      if (!turnId) throw Error("Stop could not determine the accepted turn ID");
    } else {
      if (snapshot?.status === "deferred") throw Error("Stop target is deferred and cannot be interrupted");
      if (snapshot && snapshot.turnId == null && !terminal.has(snapshot.status)) {
        throw Error("Stop target is pending and its accepted turn ID is unconfirmed");
      }
      if (snapshot?.status === "inProgress") turnId = snapshot.turnId;
    }
    if (turnId == null) return runExpectedId(expectedTurnId);
    function state() {
      const turn = readLatestTurn(manager, conversationId);
      if (!turn || turn.turnId !== turnId) throw Error("Stop target is missing or a newer turn replaced it");
      if (turn.status === "deferred") throw Error("Stop target is deferred and cannot be interrupted");
      if (turn.status !== "inProgress" && !terminal.has(turn.status)) throw Error("Stop target state is unconfirmed");
      return turn.status;
    }
    if (readLatestTurn) state();
    const result = await runExpectedId(turnId);
    if (readLatestTurn && result == null && !terminal.has(state())) {
      throw Error("Stop did not confirm termination of the selected turn");
    }
    return result;
  }

  async function interrupt(manager, threadId, turnId, send, readTurn) {
    const deadline = now() + deadlineMs;
    let acknowledged = false;
    function state() {
      const turn = readTurn(manager, threadId, turnId);
      if (!turn || turn.turnId !== turnId) throw Error("Stop target is missing or a newer turn replaced it");
      if (turn.status === "deferred") throw Error("Stop target is deferred and cannot be interrupted");
      if (!terminal.has(turn.status) && turn.status !== "inProgress") throw Error("Stop target has an unknown state");
      return turn.status;
    }
    for (;;) {
      if (now() >= deadline) throw timeout();
      if (terminal.has(state())) return;
      if (!acknowledged) {
        try { await bounded(send(threadId, turnId), deadline); acknowledged = true; }
        catch (error) {
          if ((error?.message ?? String(error)) !== "no active turn to interrupt") {
            // Native XSn treats these errors as success/retarget signals. Hide those
            // signals behind a distinct error so the selected target stays fixed.
            if (/expected active turn id|ExpectedTurnMismatch/.test(error?.message ?? String(error))) {
              throw Error("Stop target changed on the server", { cause: error });
            }
            throw error;
          }
        }
      }
      if (terminal.has(state())) return;
      await bounded(new Promise(resolve => schedule(resolve, retryMs)), deadline);
    }
  }
  return { trackStart, stop, interrupt };
}

module.exports = { createImmediateStopCoordinator };

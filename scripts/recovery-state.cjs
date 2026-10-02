"use strict";

const { createHash, randomUUID } = require("node:crypto");
const STORAGE_KEY = "azrael.resumeReceipts.v1";
const LIMIT = 64;
const unresolved = (receipt) => receipt && ["dispatching", "unknown"].includes(receipt.phase);

// Classify exact known messages without putting arbitrary engine text in logs.
const continuationTimeouts = new Map([
  ["Fatal error: native inference helper became idle", "legacy_helper_idle"],
  ["Fatal error: native inference produced no output frames for 120s", "legacy_output_idle"],
  ["Fatal error: native inference request exceeded its deadline", "engine_deadline"],
  ...["provider_headers_timeout", "provider_stream_idle", "provider_request_deadline"].map(code =>
    [`Fatal error: native inference helper failed (${code})`, code]),
]);
const diagnosticErrors = new Map([
  ...continuationTimeouts,
  ["Fatal error: native inference helper unresponsive (no protocol frames for 120s)", "helper_unresponsive"],
  ["Fatal error: native inference helper failed (provider_failure)", "provider_failure"],
]);
const diagnosticError = error => !error ? "none" :
  error.codexErrorInfo === "usageLimitExceeded" ? "usage_limit_exceeded" : diagnosticErrors.get(error.message) ?? "other";
const knownStatus = (value, allowed) => allowed.includes(value) ? value : "unknown";

function admitsContinuation(thread, latest) {
  if (["idle", "notLoaded"].includes(thread.status?.type)) return true;
  // Usage exhaustion has a structured category; explicit user requests may retry
  // with the engine's current account. Native timeout failures still use Other.
  // Match only known terminal errors; transport silence alone is not admission.
  return thread.status?.type === "systemError" && latest?.status === "failed" &&
    (latest.error?.codexErrorInfo === "usageLimitExceeded" ||
      (latest.error?.codexErrorInfo === "other" && continuationTimeouts.has(latest.error.message)));
}

function isContinuation(params) {
  if (params.toolOutput != null || !Array.isArray(params.input)) return false;
  return params.input.length === 0 || (params.input.length === 1 && params.input[0].type === "text" &&
    typeof params.input[0].text === "string" &&
    /^(continue|resume|계속|계속해|계속해주세요|이어서 진행)[.!\s]*$/i.test(params.input[0].text.trim()));
}

function fingerprint(value) {
  const canonical = (item) => Array.isArray(item) ? item.map(canonical) :
    item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

class RecoveryState {
  constructor({ store, rpc, changed = () => {}, log = () => {}, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    this.store = store;
    this.rpc = rpc;
    this.changed = changed;
    this.log = record => {
      try { log({ ...record, generation: this.generation }); }
      catch { this.droppedDiagnostics += 1; }
    };
    this.droppedDiagnostics = 0;
    this.now = now;
    this.pause = pause;
    this.states = new Map();
    this.inflight = new Map();
    this.queues = new Map();
    this.writes = Promise.resolve();
    this.generation = 0;
    const records = store.get(STORAGE_KEY, []);
    if (!Array.isArray(records) || records.length > LIMIT || records.some(r =>
      !r || typeof r.threadId !== "string" || typeof r.operationId !== "string" ||
      !["dispatching", "unknown", "accepted", "finished"].includes(r.phase))) {
      throw new Error("재개 기록을 읽을 수 없습니다. 저장소를 확인해주세요.");
    }
    this.receipts = new Map(records.map(r => [r.threadId, r]));
    for (const r of records) if (r.phase !== "finished") this.setStage(r.threadId, "disconnected", r.turnId);
  }

  setStage(threadId, phase, turnId) {
    if (!threadId) return;
    const previous = this.states.get(threadId);
    if (!previous && this.states.size >= LIMIT) {
      const removable = [...this.states].find(([id, s]) => ["completed", "interrupted", "idle"].includes(s.phase) && !unresolved(this.receipts.get(id)));
      if (removable) this.states.delete(removable[0]);
      else return;
    }
    const state = { threadId, phase, turnId: turnId ?? previous?.turnId, updatedAt: this.now() };
    this.states.set(threadId, state);
    if (previous?.phase !== phase) this.log({ event: "recovery.phase", threadId, turnId: state.turnId,
      previousPhase: previous?.phase ?? "none", phase,
      elapsedSinceUpdateMs: previous ? Math.max(0, state.updatedAt - previous.updatedAt) : 0,
      droppedDiagnostics: this.droppedDiagnostics });
    this.changed();
  }

  persist(threadId, receipt) {
    const write = this.writes.then(async () => {
      const next = new Map(this.receipts);
      if (!next.has(threadId) && next.size >= LIMIT) {
        const removable = [...next].find(([, r]) => r.phase === "finished");
        if (!removable) throw new Error("미완료 재개 기록이 가득 찼습니다. 먼저 기존 작업 상태를 확인해주세요.");
        next.delete(removable[0]);
      }
      next.set(threadId, { ...receipt, threadId, updatedAt: this.now() });
      try { await this.store.update(STORAGE_KEY, [...next.values()]); }
      catch { throw new Error("재개 기록 저장에 실패했습니다. 저장소를 확인한 뒤 다시 시도해주세요."); }
      this.receipts = next;
    });
    this.writes = write.catch(() => {});
    return write;
  }

  coalesce(key, action) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = Promise.resolve().then(action).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  serial(threadId, action) {
    const generation = this.generation;
    const previous = this.queues.get(threadId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => {
      this.checkGeneration(generation);
      return action();
    }).finally(() => { if (this.queues.get(threadId) === next) this.queues.delete(threadId); });
    this.queues.set(threadId, next);
    return next;
  }

  checkGeneration(generation) {
    if (generation !== this.generation) throw new Error("연결이 변경되었습니다. 상태를 다시 확인해주세요.");
  }

  async dispatchStart(params, generation) {
    try { return await this.rpc("turn/start", params); }
    catch (error) {
      const outcome = (result, turnId) => this.log({ event: "recovery.send_reconciliation",
        threadId: params.threadId, outcome: result, turnId });
      if (error.rpcError) { outcome("rpc_rejected"); throw error; }
      if (generation !== this.generation) { outcome("generation_changed"); throw error; }
      if (typeof params.clientUserMessageId !== "string" || !params.clientUserMessageId.length) {
        outcome("missing_client_id"); throw error;
      }
      const deadline = this.now() + 5000;
      let turn;
      // Acceptance can precede history visibility. Read only the latest bounded
      // page, within one deadline and a hard attempt cap; never replay mutation.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (generation !== this.generation) { outcome("generation_changed"); throw error; }
        const remaining = Math.min(5000, deadline - this.now());
        if (remaining <= 0) break;
        let page;
        try {
          page = await this.rpc("thread/turns/list", { threadId: params.threadId,
            limit: 20, sortDirection: "desc", itemsView: "full" }, remaining);
        } catch {
          outcome(generation === this.generation ? "read_failed" : "generation_changed");
          throw error;
        }
        if (generation !== this.generation) { outcome("generation_changed"); throw error; }
        if (this.now() > deadline) break;
        if (!Array.isArray(page?.data)) { outcome("malformed_result"); throw error; }
        turn = page.data.slice(0, 20).find(turn => Array.isArray(turn?.items) && turn.items.some(item =>
          item?.type === "userMessage" && item.clientId === params.clientUserMessageId));
        if (turn) break;
        const delay = Math.min(100, deadline - this.now());
        if (attempt === 19 || delay <= 0) break;
        await this.pause(delay);
      }
      if (!turn) { outcome("no_match"); throw error; }
      if (typeof turn.id !== "string" || !turn.id.length ||
        !["inProgress", "completed", "interrupted", "failed"].includes(turn.status)) {
        outcome("malformed_result"); throw error;
      }
      const observed = this.states.get(params.threadId);
      const terminalPhase = { completed: "completed", interrupted: "interrupted", failed: "error" }[turn.status];
      if (terminalPhase) this.setStage(params.threadId, terminalPhase, turn.id);
      else if (observed?.turnId !== turn.id || !["waiting", "responding", "tool", "approval", "input",
        "completed", "interrupted", "error"].includes(observed.phase)) {
        this.setStage(params.threadId, "waiting", turn.id);
      }
      outcome("matched", turn.id);
      return { turn };
    }
  }

  markStartUncertain(threadId) {
    const observed = this.states.get(threadId);
    // Delivery uncertainty does not erase execution already observed for a turn.
    if (!observed?.turnId || ["starting", "recovering", "unknown"].includes(observed.phase)) {
      this.setStage(threadId, "unknown");
    }
  }

  async snapshot(threadId, deadline = Infinity) {
    const remaining = () => {
      const ms = Math.min(20000, deadline - this.now());
      if (ms <= 0) throw new Error("중단 완료를 확인하지 못했습니다. 새 작업은 시작하지 않았습니다.");
      return ms;
    };
    const { thread } = await this.rpc("thread/read", { threadId, includeTurns: false }, remaining());
    const page = await this.rpc("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "summary" }, remaining());
    const latest = page.data?.[0];
    const active = thread.status?.type === "active";
    if (active && latest?.status !== "inProgress") throw new Error("실행 상태가 갱신 중입니다. 상태를 다시 확인해주세요.");
    const phase = active ? (thread.status.activeFlags?.includes("waitingOnApproval") ? "approval" :
      thread.status.activeFlags?.includes("waitingOnUserInput") ? "input" : "waiting") :
      thread.status?.type === "systemError" || latest?.status === "failed" ? "error" :
        latest?.status === "interrupted" ? "interrupted" : latest?.status === "completed" ? "completed" : "idle";
    this.setStage(threadId, phase, latest?.id);
    return { thread, latest, active };
  }

  async refresh(threadId) {
    this.setStage(threadId, "recovering");
    try {
      const snapshot = await this.snapshot(threadId);
      const receipt = this.receipts.get(threadId);
      if (unresolved(receipt) && snapshot.active) {
        // This is an attachment receipt, not proof of which request created the
        // live turn. No input is replayed to establish the attachment.
        await this.persist(threadId, { ...receipt, phase: "accepted", turnId: snapshot.latest.id, attached: true });
      } else if (unresolved(receipt)) this.setStage(threadId, "unknown", receipt.turnId);
      else if (receipt?.phase === "accepted" && !snapshot.active) await this.persist(threadId, { ...receipt, phase: "finished" });
      return snapshot;
    } catch (error) {
      this.setStage(threadId, error.rpcError ? "error" : "disconnected");
      throw error;
    }
  }

  resume(params) {
    return this.coalesce(`resume:${params.threadId}:${fingerprint(params)}`, () => this.serial(params.threadId, async () => {
      this.setStage(params.threadId, "recovering");
      try {
        const result = await this.rpc("thread/resume", params);
        await this.refresh(params.threadId);
        return result;
      } catch (error) {
        this.setStage(params.threadId, error.rpcError ? "error" : "disconnected");
        throw error;
      }
    }));
  }

  start(params) {
    if (!isContinuation(params)) {
      return this.serial(params.threadId, async () => {
        const generation = this.generation;
        this.setStage(params.threadId, "starting");
        let result;
        try { result = await this.dispatchStart(params, generation); }
        catch (error) {
          if (error.rpcError) this.setStage(params.threadId, "error");
          else this.markStartUncertain(params.threadId);
          throw error;
        }
        const observed = this.states.get(params.threadId);
        if (observed?.turnId !== result.turn.id || observed.phase === "starting") this.setStage(params.threadId, "waiting", result.turn.id);
        return result;
      });
    }
    // All continuation inputs for one thread share admission, including a play
    // click racing a typed continue. New instructions keep native steering.
    return this.coalesce(`start:${params.threadId}`, () => this.serial(params.threadId, () => this.continueOnce(params)));
  }

  async continueOnce(params, reviewedUnknown = false) {
    const threadId = params.threadId;
    const generation = this.generation;
    const { thread, latest, active } = await this.refresh(threadId);
    this.checkGeneration(generation);
    const decision = (outcome, reason, snapshot = { thread, latest }) => this.log({
      event: "recovery.admission", threadId, turnId: snapshot.latest?.id, outcome, reason,
      threadStatus: knownStatus(snapshot.thread.status?.type, ["active", "idle", "notLoaded", "systemError"]),
      turnStatus: knownStatus(snapshot.latest?.status, ["inProgress", "completed", "failed", "interrupted"]),
      errorKind: diagnosticError(snapshot.latest?.error), reviewedUnknown,
    });
    if (active) { decision("attached", "active_turn"); return { turn: latest }; }
    if (!admitsContinuation(thread, latest)) {
      decision("blocked", "terminal_state_not_admitted");
      throw new Error("엔진 상태를 확인한 뒤 재개해주세요.");
    }
    const previous = this.receipts.get(threadId);
    if (unresolved(previous) && !reviewedUnknown) {
      decision("blocked", "previous_dispatch_unresolved");
      throw new Error("이전 재개 요청의 결과가 불명확합니다. Azrael 실행 상태에서 기록을 확인한 뒤 새 재개를 선택해주세요.");
    }
    if (thread.status.type === "notLoaded") {
      await this.rpc("thread/resume", { threadId });
      const resumed = await this.snapshot(threadId);
      this.checkGeneration(generation);
      if (resumed.active) { decision("attached", "active_after_resume", resumed); return { turn: resumed.latest }; }
      if (resumed.thread.status?.type === "notLoaded" || !admitsContinuation(resumed.thread, resumed.latest)) {
        decision("blocked", "resume_not_ready", resumed);
        throw new Error("스레드 복구가 완료되지 않았습니다.");
      }
    }
    // The pinned UI represents its play action with empty input, but this
    // engine rejects EmptyInput. Materialize the user's continuation intent
    // only after continuation admission; attachment to live work never adds input.
    if (params.input.length === 0) params = { ...params, input: [{ type: "text", text: "continue" }] };
    const receipt = { threadId, operationId: randomUUID(), fingerprint: fingerprint(params),
      baselineTurnId: latest?.id ?? null, phase: "dispatching", turnId: null };
    await this.persist(threadId, receipt);
    this.checkGeneration(generation);
    decision("admitted", "terminal_state_confirmed");
    this.setStage(threadId, "starting");
    this.log({ event: "recovery.dispatch", threadId, operationId: receipt.operationId });
    try {
      const result = await this.dispatchStart(params, generation);
      const observed = this.states.get(threadId);
      const finished = observed?.turnId === result.turn.id && ["completed", "interrupted", "error"].includes(observed.phase);
      await this.persist(threadId, { ...receipt, phase: finished ? "finished" : "accepted", turnId: result.turn.id });
      this.log({ event: "recovery.accepted", threadId, turnId: result.turn.id,
        operationId: receipt.operationId, alreadyFinished: finished });
      if (!finished && (observed?.turnId !== result.turn.id || observed.phase === "starting")) this.setStage(threadId, "waiting", result.turn.id);
      return result;
    } catch (error) {
      this.markStartUncertain(threadId);
      this.log({ event: "recovery.outcome_unknown", threadId, operationId: receipt.operationId });
      await this.persist(threadId, { ...receipt, phase: "unknown" }).catch(() => {});
      throw error;
    }
  }

  recover(threadId, reviewedUnknown = false) {
    return this.coalesce(`start:${threadId}`, () => this.serial(threadId, async () => {
      const generation = this.generation;
      const snapshot = await this.refresh(threadId);
      if (snapshot.active) {
        this.setStage(threadId, "interrupting", snapshot.latest.id);
        await this.rpc("turn/interrupt", { threadId, turnId: snapshot.latest.id });
        const deadline = this.now() + 10000;
        while (true) {
          this.checkGeneration(generation);
          const current = await this.snapshot(threadId, deadline);
          if (!current.active && current.thread.status?.type === "idle") break;
          if (this.now() >= deadline) throw new Error("중단 완료를 확인하지 못했습니다. 새 작업은 시작하지 않았습니다.");
          await this.pause(250);
        }
      }
      this.checkGeneration(generation);
      return this.continueOnce({ threadId, input: [{ type: "text", text: "continue" }] }, reviewedUnknown);
    }));
  }

  observe(message) {
    const { method, params: p } = message;
    const id = p?.threadId ?? p?.thread?.id;
    if (!id || !this.states.has(id)) return;
    const turnId = p.turnId ?? p.turn?.id;
    const currentId = this.states.get(id)?.turnId;
    if (method !== "turn/started" && turnId && currentId && turnId !== currentId) return;
    const terminal = ["completed", "interrupted", "error", "idle"].includes(this.states.get(id)?.phase);
    if (terminal && method?.startsWith("item/")) return;
    if (method === "turn/started") this.setStage(id, "waiting", p.turn.id);
    else if (method === "turn/completed") {
      this.log({ event: "recovery.turn_terminal", threadId: id, turnId: p.turn.id,
        status: knownStatus(p.turn.status, ["completed", "interrupted", "failed"]),
        errorKind: diagnosticError(p.turn.error) });
      this.setStage(id, p.turn.status === "completed" ? "completed" : p.turn.status === "interrupted" ? "interrupted" : "error", p.turn.id);
      const receipt = this.receipts.get(id);
      if (receipt?.turnId === p.turn.id) void this.persist(id, { ...receipt, phase: "finished" }).catch(() => {
        this.log({ event: "recovery.storage_error", threadId: id });
      });
    } else if (method === "item/started") {
      const type = p.item?.type;
      this.setStage(id, ["agentMessage", "reasoning"].includes(type) ? "responding" : type === "userMessage" ? "waiting" : "tool", p.turnId);
    } else if (method === "item/completed") this.setStage(id, "waiting", p.turnId);
    else if (method?.endsWith("requestApproval")) this.setStage(id, "approval", p.turnId);
    else if (method === "item/tool/requestUserInput") this.setStage(id, "input", p.turnId);
    else if ((/^item\/(agentMessage|reasoning)\//.test(method) && method.endsWith("Delta")) || method === "item/agentMessage/delta") this.setStage(id, "responding", p.turnId);
    else if (method === "item/mcpToolCall/progress" || /^item\/[^/]+\/outputDelta$/.test(method)) this.setStage(id, "tool", p.turnId);
    else if (method === "serverRequest/resolved") this.setStage(id, "waiting");
    else if (method === "thread/status/changed") {
      if (p.status?.type === "systemError") this.setStage(id, "error");
      else if (p.status?.type === "notLoaded" && !terminal) this.setStage(id, "disconnected");
    }
  }

  disconnect() {
    this.generation += 1;
    for (const [id, state] of this.states) {
      if (!["completed", "idle", "interrupted"].includes(state.phase)) this.setStage(id, "disconnected");
    }
  }

  list() {
    return [...this.states.values()].map(state => ({ ...state,
      delayed: ["starting", "waiting", "responding", "tool", "recovering", "interrupting"].includes(state.phase) && this.now() - state.updatedAt >= 90000,
      uncertain: unresolved(this.receipts.get(state.threadId)),
    })).sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

module.exports = { RecoveryState, STORAGE_KEY, isContinuation };

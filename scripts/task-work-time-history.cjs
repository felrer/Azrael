"use strict";

// Serialized into the webview. Query metadata, never hydrate message bodies.
function azraelCreateTaskTimeHistory(manager, threadId, options = {}) {
  let state = { turns: [], loading: false, complete: false, error: null, availability: "idle" };
  let disposed = false, pending = null, refreshAgain = false;
  const listeners = new Set();
  const publish = next => {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener();
  };
  const refresh = () => {
    if (disposed) return Promise.resolve();
    if (pending) { refreshAgain = true; return pending; }
    if (typeof manager?.listThreadTurns !== "function" || typeof threadId !== "string" || !threadId) {
      publish({ ...state, loading: false, availability: "unavailable", error: null });
      return Promise.resolve();
    }
    publish({ ...state, loading: true, error: null });
    pending = Promise.resolve().then(async () => {
      try {
        const turns = [], ids = new Set(), cursors = new Set();
        let cursor = null, pages = 0;
        do {
          if (++pages > 1000) throw Error("Turn metadata pagination limit exceeded");
          const { response } = await manager.listThreadTurns(threadId,
            { cursor, limit: 100, itemsView: "notLoaded", sortDirection: "asc",
              requestOptions: { priority: "background", source: "tail_history", timeoutMs: 15000 } });
          if (disposed) return;
          if (!Array.isArray(response?.data)) throw Error("Invalid turn metadata page");
          for (const turn of response.data) {
            if (typeof turn.id !== "string" || !turn.id) throw Error("Invalid turn identity");
            if (!ids.has(turn.id)) {
              ids.add(turn.id);
              turns.push({ turnId: turn.id, rootTurnId: turn.rootTurnId ?? null,
                parentTurnId: turn.parentTurnId ?? null, turnTrigger: turn.turnTrigger ?? null,
                turnStartedAtMs: Number.isFinite(turn.startedAt) ? turn.startedAt * 1000 : null,
                turnStartedAtPrecisionMs: 1000,
                durationMs: turn.durationMs ?? null, status: turn.status,
                rootResumeWait: turn.rootResumeWait ?? null });
            }
          }
          cursor = response.nextCursor ?? null;
          if (cursor != null) {
            if (typeof cursor !== "string" || cursors.has(cursor)) throw Error("Invalid turn metadata cursor");
            cursors.add(cursor);
          }
        } while (cursor != null);
        publish({ turns, loading: false, complete: true, error: null, availability: "ready" });
      } catch (error) {
        if (disposed) return;
        const message = String(error?.message ?? error);
        const availability = /thread not loaded|thread .+ is not materialized yet; thread\/turns\/list is unavailable before first user message/i.test(message) ? "notLoaded" :
          /ephemeral threads do not support thread\/turns\/list/i.test(message) ? "unsupported" : "unavailable";
        // Diagnose at the existing manager boundary without logging message bodies.
        const diagnostic = { conversationId: threadId, hostId: options.hostId ?? null,
          outcome: availability, method: "thread/turns/list", errorCode: error?.code ?? error?.error?.code ?? null };
        try { manager.logger?.info?.("azrael_task_time_history", diagnostic); options.onDiagnostic?.(diagnostic); } catch {}
        publish({ ...state, loading: false, availability,
          error: availability === "unavailable" ? message : null });
      } finally {
        pending = null;
        if (refreshAgain && !disposed) { refreshAgain = false; refresh(); }
      }
    });
    return pending;
  };
  return { getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    refresh, dispose: () => { disposed = true; listeners.clear(); } };
}

function azraelMergeTaskTimeTurns(history, live) {
  const result = history.map(turn => ({ ...turn }));
  const indices = new Map(result.map((turn, index) => [turn.turnId, index]));
  const terminal = status => ["completed", "interrupted", "failed"].includes(status);
  for (const turn of live) {
    if (!turn?.turnId) continue;
    const index = indices.get(turn.turnId);
    const normalized = { turnId: turn.turnId, rootTurnId: turn.rootTurnId ?? null,
      parentTurnId: turn.parentTurnId ?? null, turnTrigger: turn.turnTrigger ?? null,
      turnStartedAtMs: turn.turnStartedAtMs ?? null,
      turnStartedAtPrecisionMs: turn.turnStartedAtPrecisionMs,
      durationMs: turn.durationMs ?? null, status: turn.status,
      rootResumeWait: turn.rootResumeWait ?? null };
    if (index == null) { indices.set(turn.turnId, result.length); result.push(normalized); continue; }
    const saved = result[index];
    // A partially loaded or stale active UI turn must not revive terminal history.
    const useSaved = terminal(saved.status) && !terminal(normalized.status) ||
      saved.status === "deferred" && normalized.status === "inProgress";
    const merged = useSaved ? { ...saved } : { ...saved, ...normalized,
      rootTurnId: normalized.rootTurnId ?? saved.rootTurnId ?? null,
      parentTurnId: normalized.parentTurnId ?? saved.parentTurnId ?? null,
      turnTrigger: normalized.turnTrigger ?? saved.turnTrigger ?? null,
      turnStartedAtMs: normalized.turnStartedAtMs ?? saved.turnStartedAtMs,
      turnStartedAtPrecisionMs: normalized.turnStartedAtMs == null ||
        normalized.turnStartedAtMs === saved.turnStartedAtMs ?
        saved.turnStartedAtPrecisionMs : normalized.turnStartedAtPrecisionMs,
      durationMs: normalized.durationMs ?? saved.durationMs };
    // Attribution is immutable for a turn and independent of clock/status
    // freshness. Fill missing history fields without reviving its active state.
    for (const field of ["rootTurnId", "parentTurnId", "turnTrigger"]) {
      merged[field] = saved[field] ?? normalized[field] ?? null;
      if (saved[field] != null && normalized[field] != null && saved[field] !== normalized[field]) merged.metadataPartial = true;
    }
    const oldWait = saved.rootResumeWait, newWait = normalized.rootResumeWait;
    if (newWait == null) merged.rootResumeWait = oldWait;
    else if (oldWait == null) merged.rootResumeWait = newWait;
    else if (oldWait.reservationId === newWait.reservationId) {
      const ended = oldWait.waitEndedAtMs != null || ["resumed", "cancelled"].includes(oldWait.state);
      const incomingOpen = ["waiting", "claimed"].includes(newWait.state) && newWait.waitEndedAtMs == null;
      merged.rootResumeWait = oldWait.revision >= newWait.revision || ended && incomingOpen ? oldWait :
        { ...newWait, waitStartedAtMs: oldWait.waitStartedAtMs ?? newWait.waitStartedAtMs,
          waitEndedAtMs: oldWait.waitEndedAtMs ?? newWait.waitEndedAtMs };
    } else {
      // Revisions belong to a reservation, so never compare them across IDs.
      const oldStart = oldWait.waitStartedAtMs, newStart = newWait.waitStartedAtMs;
      const knownOrder = Number.isFinite(oldStart) && Number.isFinite(newStart) && oldStart !== newStart;
      merged.rootResumeWait = !useSaved && knownOrder && newStart > oldStart ? newWait : oldWait;
      if (!knownOrder) merged.metadataPartial = true;
    }
    result[index] = merged;
  }
  // Keep persisted order authoritative; insert missing live turns beside their
  // shared live anchors instead of blindly appending old turns after new history.
  const ordered = history.map(turn => turn.turnId).filter(id => indices.has(id));
  const liveIds = live.filter(turn => turn?.turnId && indices.has(turn.turnId)).map(turn => turn.turnId);
  const present = new Set(ordered);
  for (let i = 0; i < liveIds.length; i++) {
    const id = liveIds[i];
    if (present.has(id)) continue;
    const record = result[indices.get(id)];
    const following = liveIds.slice(i + 1).find(candidate => present.has(candidate));
    let position = following == null ? -1 : ordered.indexOf(following);
    if (position < 0 && Number.isFinite(record.turnStartedAtMs)) {
      position = ordered.findIndex(candidate => {
        const next = result[indices.get(candidate)];
        return Number.isFinite(next.turnStartedAtMs) && next.turnStartedAtMs > record.turnStartedAtMs;
      });
    }
    if (position < 0) position = ordered.length;
    const parentPosition = record.parentTurnId == null ? -1 : ordered.indexOf(record.parentTurnId);
    if (parentPosition >= position) {
      position = parentPosition + 1;
      record.metadataPartial = true;
    }
    ordered.splice(position, 0, id); present.add(id);
  }
  return ordered.map(id => result[indices.get(id)]);
}

module.exports = { azraelCreateTaskTimeHistory, azraelMergeTaskTimeTurns };

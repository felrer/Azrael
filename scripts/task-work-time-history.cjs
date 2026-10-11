"use strict";

// Serialized into the webview. Query metadata, never hydrate message bodies.
function azraelCreateTaskTimeHistory(manager, threadId) {
  let state = { turns: [], loading: false, complete: false, error: null };
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
    publish({ ...state, loading: true, error: null });
    pending = Promise.resolve().then(async () => {
      try {
        const turns = [], ids = new Set(), cursors = new Set();
        let cursor = null;
        do {
          const { response } = await manager.listThreadTurns(threadId,
            { cursor, limit: 100, itemsView: "notLoaded", sortDirection: "asc" });
          if (disposed) return;
          if (!Array.isArray(response?.data)) throw Error("Invalid turn metadata page");
          for (const turn of response.data) {
            if (typeof turn.id !== "string" || !turn.id) throw Error("Invalid turn identity");
            if (!ids.has(turn.id)) {
              ids.add(turn.id);
              turns.push({ turnId: turn.id, rootTurnId: turn.rootTurnId ?? null,
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
        publish({ turns, loading: false, complete: true, error: null });
      } catch (error) {
        publish({ ...state, loading: false, error: String(error.message ?? error) });
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
    const normalized = { turnId: turn.turnId, turnStartedAtMs: turn.turnStartedAtMs ?? null,
      turnStartedAtPrecisionMs: turn.turnStartedAtPrecisionMs,
      durationMs: turn.durationMs ?? null, status: turn.status,
      rootResumeWait: turn.rootResumeWait ?? null };
    if (index == null) { indices.set(turn.turnId, result.length); result.push(normalized); continue; }
    const saved = result[index];
    // A partially loaded or stale active UI turn must not revive terminal history.
    const useSaved = terminal(saved.status) && !terminal(normalized.status) ||
      saved.status === "deferred" && normalized.status === "inProgress";
    const merged = useSaved ? { ...saved } : { ...saved, ...normalized,
      turnStartedAtMs: normalized.turnStartedAtMs ?? saved.turnStartedAtMs,
      turnStartedAtPrecisionMs: normalized.turnStartedAtMs == null ||
        normalized.turnStartedAtMs === saved.turnStartedAtMs ?
        saved.turnStartedAtPrecisionMs : normalized.turnStartedAtPrecisionMs,
      durationMs: normalized.durationMs ?? saved.durationMs };
    const oldWait = saved.rootResumeWait, newWait = normalized.rootResumeWait;
    merged.rootResumeWait = newWait == null ? oldWait : oldWait == null ? newWait :
      oldWait.reservationId === newWait.reservationId && oldWait.revision > newWait.revision ? oldWait : newWait;
    result[index] = merged;
  }
  return result;
}

module.exports = { azraelCreateTaskTimeHistory, azraelMergeTaskTimeTurns };

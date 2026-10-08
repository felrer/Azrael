"use strict";

// These functions are injected into the pinned UI and exercised directly by
// source fixtures. Keep them self-contained: the host has no CommonJS loader.
function azraelHasDeferredBoundary(turn) {
  const wait = turn.rootResumeWait;
  return wait != null && (wait.state === "waiting" || wait.state === "claimed" ||
    wait.state === "resumed" || Number.isFinite(wait.waitStartedAtMs));
}

function azraelNormalizeDeferredTurn(turn) {
  if (turn.status !== "inProgress" || !azraelHasDeferredBoundary(turn)) return turn;
  // An active snapshot's duration is not the engine's measurement at defer.
  // Keep it unavailable until authoritative deferred metadata arrives.
  return { ...turn, status: "deferred", durationMs: null, finalAssistantStartedAtMs: null };
}

// One journal per native manager. Missing historical turns are never synthesized:
// the normal loader supplies their canonical location before this journal applies.
function azraelDeferredJournal(manager) {
  let journal = azraelDeferredJournals.get(manager);
  if (journal == null) {
    journal = { records: new Map(), flushing: false };
    azraelDeferredJournals.set(manager, journal);
  }
  return journal;
}

function azraelDeferredLog(manager, record, outcome, pages = 0) {
  manager.logger?.info?.("azrael_deferred_recovery", {
    safe: { event: "deferred_recovery", outcome, pages, revision: record.wait?.revision ?? 0 },
    sensitive: { conversationId: record.conversationId, turnId: record.turnId,
      reservationId: record.wait?.reservationId ?? null },
  });
}

function azraelMergeEndedRootResumeWait(current, incoming) {
  if (current == null || incoming == null || incoming.reservationId !== current.reservationId ||
      incoming.revision <= current.revision || incoming.state === "waiting" ||
      !Number.isFinite(incoming.waitEndedAtMs)) return current;
  return azraelMergeRootResumeWait(current, incoming);
}

function azraelFlushDeferred(manager, conversationId) {
  const journal = azraelDeferredJournals.get(manager);
  if (journal == null || journal.flushing) return;
  journal.flushing = true;
  try {
    for (const [key, record] of journal.records) {
      if (record.conversationId !== conversationId) continue;
      const conversation = manager.getConversation(conversationId);
      const turn = conversation == null ? null : record.findTurn(conversation, t => t.turnId === record.turnId);
      if (turn == null) continue;
      if (["completed", "interrupted", "failed"].includes(turn.status)) {
        const ended = azraelMergeEndedRootResumeWait(turn.rootResumeWait, record.wait);
        if (ended !== turn.rootResumeWait) {
          record.context.updateTurnState(conversationId, record.turnId, target => { target.rootResumeWait = ended; });
        }
        journal.records.delete(key);
        azraelDeferredLog(manager, record, "terminal");
        continue;
      }
      const merged = azraelMergeRootResumeWait(turn.rootResumeWait, record.wait);
      if (record.wait != null && merged?.reservationId !== record.wait.reservationId) {
        journal.records.delete(key);
        azraelDeferredLog(manager, record, "reservation_mismatch");
        continue;
      }
      const fields = { rootResumeWait: merged };
      const normalized = azraelNormalizeDeferredTurn({ ...turn, rootResumeWait: merged });
      if (normalized.status !== turn.status) Object.assign(fields, {
        status: normalized.status, durationMs: normalized.durationMs,
        finalAssistantStartedAtMs: normalized.finalAssistantStartedAtMs,
      });
      const metadata = record.metadata;
      if (metadata != null) {
        Object.assign(fields, { status: "deferred", error: null,
          durationMs: metadata.durationMs, finalAssistantStartedAtMs: null });
        if (Number.isFinite(metadata.startedAt)) fields.turnStartedAtMs = metadata.startedAt * 1000;
      }
      if (Object.entries(fields).some(([field, value]) => turn[field] !== value)) {
        record.context.updateTurnState(conversationId, record.turnId, target => Object.assign(target, fields));
      }
      // Native state updates use immutable drafts; reread the committed turn.
      const appliedConversation = manager.getConversation(conversationId);
      const applied = appliedConversation == null ? null : record.findTurn(appliedConversation, t => t.turnId === record.turnId);
      if (Number.isFinite(applied?.durationMs) && applied.status === "deferred") {
        journal.records.delete(key);
        azraelDeferredLog(manager, record, "applied");
      }
    }
  } finally { journal.flushing = false; }
}

function azraelReceiveDeferred(manager, context, findTurn, conversationId, nativeThreadId, turnId, wait, metadata) {
  const journal = azraelDeferredJournal(manager);
  const key = JSON.stringify([conversationId, turnId]);
  const conversation = manager.getConversation(conversationId);
  const turn = conversation == null ? null : findTurn(conversation, t => t.turnId === turnId);
  if (turn != null && ["completed", "interrupted", "failed"].includes(turn.status)) {
    const ended = azraelMergeEndedRootResumeWait(turn.rootResumeWait, wait);
    if (ended !== turn.rootResumeWait) {
      context.updateTurnState(conversationId, turnId, target => { target.rootResumeWait = ended; });
      azraelDeferredLog(manager, { conversationId, turnId, wait: ended }, "terminal_wait_applied");
    }
    journal.records.delete(key);
    return;
  }
  let record = journal.records.get(key);
  const currentWait = record?.wait ?? turn?.rootResumeWait;
  const merged = azraelMergeRootResumeWait(currentWait, wait);
  if (wait != null && currentWait != null && merged === currentWait &&
      (metadata == null || wait.reservationId !== currentWait.reservationId)) {
    azraelDeferredLog(manager, { conversationId, turnId, wait }, "stale");
    return;
  }
  if (metadata?.rootResumeWait != null && currentWait != null &&
      metadata.rootResumeWait.reservationId !== currentWait.reservationId) return;
  if (record == null) {
    record = { conversationId, nativeThreadId, turnId, context, findTurn, wait: merged,
      metadata: null, inFlight: null };
    journal.records.set(key, record);
  } else record.wait = merged;
  if (metadata != null) {
    record.metadata = { ...metadata, durationMs: Number.isFinite(metadata.durationMs) ? metadata.durationMs : null };
  }
  azraelFlushDeferred(manager, conversationId);
  if (record.metadata != null || !journal.records.has(key) || !azraelHasDeferredBoundary({ rootResumeWait: record.wait }) || record.inFlight != null) return;
  if (typeof manager.listThreadTurns !== "function") {
    azraelDeferredLog(manager, record, "query_unavailable");
    return;
  }
  // Fetch once per event opportunity; failures and missing pages never poll.
  record.inFlight = (async () => {
    let cursor = null, pages = 0;
    const seen = new Set();
    try {
      for (;;) {
        const { response } = await manager.listThreadTurns(nativeThreadId,
          { cursor, limit: 100, itemsView: "notLoaded", sortDirection: "desc" });
        pages++;
        if (journal.records.get(key) !== record) return;
        const candidate = response?.data?.find(t => t.id === turnId);
        if (candidate != null) {
          if (candidate.status !== "deferred" || !Number.isFinite(candidate.durationMs) ||
              (candidate.rootResumeWait != null && candidate.rootResumeWait.reservationId !== record.wait?.reservationId)) {
            azraelDeferredLog(manager, record, "metadata_unavailable", pages);
            return;
          }
          record.wait = azraelMergeRootResumeWait(record.wait, candidate.rootResumeWait);
          record.metadata = candidate;
          azraelFlushDeferred(manager, conversationId);
          manager.broadcastConversationSnapshot(conversationId);
          azraelDeferredLog(manager, record, "query_resolved", pages);
          return;
        }
        const next = response?.nextCursor;
        if (!Array.isArray(response?.data) || response.data.length === 0 || next == null || seen.has(next)) {
          azraelDeferredLog(manager, record, "metadata_missing", pages);
          return;
        }
        seen.add(next);
        cursor = next;
      }
    } catch {
      azraelDeferredLog(manager, record, "query_failed", pages);
    } finally { record.inFlight = null; }
  })();
}

const azraelDeferredJournals = new WeakMap();

function azraelMergeRootResumeWait(current, incoming) {
  if (incoming == null) return current ?? null;
  if (current == null) return incoming;
  if (current.reservationId !== incoming.reservationId || incoming.revision <= current.revision) return current;
  if (current.state === "resumed" || current.state === "cancelled" ||
    (current.waitEndedAtMs != null && incoming.state === "waiting")) return current;
  return {
    ...incoming,
    waitStartedAtMs: current.waitStartedAtMs ?? incoming.waitStartedAtMs,
    waitEndedAtMs: current.waitEndedAtMs ?? incoming.waitEndedAtMs,
  };
}

function azraelRootResumeWaitItem(wait) {
  if (wait == null) return null;
  const running = wait.state === "waiting" && wait.waitStartedAtMs != null && wait.waitEndedAtMs == null;
  return {
    type: "worked-for",
    status: running ? "azraelWaiting" : "azraelWaitEnded",
    startedAtMs: wait.waitStartedAtMs ?? 0,
    completedAtMs: running ? null : wait.waitEndedAtMs ?? wait.waitStartedAtMs ?? 0,
    rootResumeWait: wait,
  };
}

function azraelRootResumeWaitLabel(wait, elapsedMs) {
  const elapsed = wait.waitStartedAtMs == null ||
    (wait.state !== "waiting" && wait.waitEndedAtMs == null)
    ? null : Math.floor(Math.max(0, elapsedMs) / 1000);
  const duration = elapsed == null ? "대기 시간 확인 불가" : `${elapsed}초 대기`;
  switch (wait.state) {
    case "waiting": {
      if (wait.waitStartedAtMs == null) return "재개 대기 · 대기 시간 확인 불가";
      const planned = Math.ceil(Math.max(0, wait.resumeAtMs - wait.waitStartedAtMs) / 1000);
      const schedule = wait.canWakeEarly ? `재개까지 최대 ${planned}초 대기` : `${planned}초 대기 예정`;
      const progress = elapsed == null ? duration : `현재 ${elapsed}초 대기함`;
      return `${schedule} · ${progress}${wait.canWakeEarly ? " · 자식 작업 완료 시 조기 재개" : ""}`;
    }
    case "claimed": return `재개 처리 중 · ${duration}`;
    case "resumed": return elapsed == null ? `재개됨 · ${duration}` : `${duration} 후 재개됨`;
    case "cancelled": return elapsed == null ? `예약 취소됨 · ${duration}` : `${duration} 후 예약 취소됨`;
    case "blocked": return `재개 차단됨 · ${duration}`;
    case "preparing": return "재개 예약 준비 중";
    default: return "재개 대기 상태 확인 불가";
  }
}

module.exports = { azraelDeferredJournals, azraelDeferredJournal, azraelDeferredLog, azraelMergeEndedRootResumeWait,
  azraelFlushDeferred, azraelReceiveDeferred, azraelHasDeferredBoundary, azraelNormalizeDeferredTurn,
  azraelMergeRootResumeWait, azraelRootResumeWaitItem, azraelRootResumeWaitLabel };

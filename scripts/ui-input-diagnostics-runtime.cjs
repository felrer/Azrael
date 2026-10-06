"use strict";

// Serialized into the UI asset. No imports, timers, raw state, or error logging.
function createUiInputDiagnostics(send, now = () => Date.now()) {
  const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const nonempty = value => (typeof value === "string" || Array.isArray(value)) && value.length > 0;
  const repeat = new Map(), renders = new Map();
  let windowStart = now(), emitted = 0, dropped = 0;
  function emit(event, fields, key) {
    try {
      const time = now();
      if (time - windowStart >= 60000) { windowStart = time; emitted = 0; }
      if (key != null && repeat.has(key)) return;
      if (emitted >= 100) { dropped++; return; }
      emitted++;
      // Callers construct fields exclusively from admitted UUIDs, fixed enums,
      // counts and booleans. No arbitrary caller objects are serialized.
      const result = send({ event, ...fields, droppedCount: dropped }); dropped = 0;
      if (result && typeof result.catch === "function") result.catch(() => {});
      if (key != null) { repeat.set(key, true); if (repeat.size > 512) repeat.delete(repeat.keys().next().value); }
    } catch (_) {}
  }
  function snapshot(load) {
    const limited = {};
    try {
      const turns = load();
      if (!Array.isArray(turns)) { emit("snapshot_skipped", { malformedCount: 1, scanLimited: false }, "snapshot-invalid"); return null; }
      const ids = new Map(); let malformed = 0, scanned = 0;
      const add = (id, kind, content) => {
        if (!nonempty(content)) return;
        if (!uuid(id)) { malformed++; return; }
        if (!ids.has(id)) { if (ids.size >= 500) throw limited; ids.set(id, new Set()); }
        ids.get(id).add(kind);
      };
      for (const turn of turns) {
        if (++scanned > 10000) throw limited;
        if (!turn || typeof turn !== "object") { malformed++; continue; }
        add(turn.params?.clientUserMessageId, "params", turn.params?.input);
        if (!Array.isArray(turn.items)) { malformed++; continue; }
        for (const item of turn.items) {
          if (++scanned > 10000) throw limited;
          if (!item || typeof item !== "object") { malformed++; continue; }
          if (item.type === "userMessage") add(item.clientId, "user", item.content);
          if (item.type === "steeringUserMessage") add(item.clientUserMessageId, "steering", item.input);
        }
      }
      if (malformed) emit("snapshot_malformed", { malformedCount: malformed, scanLimited: false }, "snapshot-malformed:" + malformed);
      return ids;
    } catch (failure) { emit("snapshot_skipped", { malformedCount: 0, scanLimited: failure === limited, snapshotFailed: failure !== limited }, failure === limited ? "snapshot-limit" : "snapshot-failed"); return null; }
  }
  function compare(thread, before, after, mutationKind = "ordinary", historyInvalidationType = null) {
    try {
      if (!uuid(thread) || before == null || after == null) return;
      const mutation = ["ordinary", "history", "optimized_history"].includes(mutationKind) ? mutationKind : "ordinary";
      const invalidation = historyInvalidationType === "entityKeys" ? "entityKeys" : historyInvalidationType === "other" ? "other" : null;
      for (const [id, kinds] of before) {
        const next = after.get(id), prevKey = [...kinds].sort().join(","), nextKey = next == null ? "" : [...next].sort().join(",");
        const beforeKinds = ["params", "user", "steering"].filter(kind => kinds.has(kind)), afterKinds = ["params", "user", "steering"].filter(kind => next?.has(kind));
        const fields = { threadId: thread, clientId: id, beforeRepresentationCount: kinds.size, afterRepresentationCount: next?.size ?? 0, beforeKinds, afterKinds, mutationKind: mutation, historyInvalidationType: invalidation };
        if (next == null) emit("state_removed", fields, thread + id + "removed" + prevKey + mutation + invalidation);
        else if (prevKey !== nextKey) emit("representation_changed", fields, thread + id + prevKey + nextKey + mutation + invalidation);
      }
    } catch (_) {}
  }
  function queue(thread, id, accepted, persisted) {
    try { if (uuid(thread) && uuid(id)) emit("queue_consumed", { threadId: thread, clientId: id, source: "queue_consumed", receiptAccepted: accepted === true, persistenceSucceeded: persisted === true }); } catch (_) {}
  }
  function render(turn, aeon, hidden, opening, hideCallback = null, inputClassified = null, linkedSteering = null) {
    try {
      const id = turn.params?.clientUserMessageId, thread = turn.params?.threadId;
      if (!uuid(id) || !uuid(thread)) return;
      let users = 0, steering = 0, malformed = 0;
      if (!Array.isArray(turn.items) || turn.items.length > 10000) return;
      for (const item of turn.items) {
        if (!item || typeof item !== "object") { malformed++; continue; }
        if (item.type === "userMessage" && item.clientId === id) users++;
        if (item.type === "steeringUserMessage" && item.clientUserMessageId === id) steering++;
      }
      const reason = value => typeof value === "boolean" ? value : null;
      const shouldHideCallback = reason(hideCallback), inputClassifier = reason(inputClassified), linkedOpeningSteering = reason(linkedSteering);
      const input = nonempty(turn.params?.input), signature = [!!aeon, !!hidden, !!opening, input, users, steering, malformed, shouldHideCallback, inputClassifier, linkedOpeningSteering].join(","), key = thread + id;
      if (renders.get(key) === signature) return;
      renders.set(key, signature); if (renders.size > 256) renders.delete(renders.keys().next().value);
      if (!opening && input) emit("opening_suppressed", { threadId: thread, clientId: id, aeonClassified: !!aeon, inputHidden: !!hidden, openingPresent: !!opening, inputNonempty: input, matchingUserCount: users, matchingSteeringCount: steering, malformedCount: malformed, shouldHideCallback, inputClassifier, linkedOpeningSteering });
    } catch (_) {}
  }
  return { snapshot, compare, queue, render };
}
module.exports = { createUiInputDiagnostics };

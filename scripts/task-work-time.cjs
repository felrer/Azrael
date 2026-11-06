"use strict";

// Kept self-contained so the UI injector can serialize this function verbatim.
function azraelTaskTimeGroups(turns, nowMs) {
  const validMs = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const seen = new Set();
  const groups = [];
  let group;
  let intervals;
  let occupiedEnd;
  let measuredFloor;
  let reservations;
  let roots;
  const owners = new Map();
  const finish = () => {
    if (!group) return;
    intervals.sort((a, b) => a[0] - b[0]);
    let end = -1;
    for (const [start, stop] of intervals) {
      const addition = Math.max(0, stop - Math.max(start, end));
      const total = group.durationMs + addition;
      if (Number.isFinite(total)) group.durationMs = total;
      else {
        group.durationMs = Number.MAX_VALUE;
        group.partial = true;
      }
      end = Math.max(end, stop);
    }
    // A contradictory coarse placement cannot erase measured sequential work.
    group.durationMs = Math.max(group.durationMs, measuredFloor);
    group.resumeCount = reservations.size;
    group.eligible = group.resumeCount >= 3;
    group.firstTurnId = group.turnIds[0];
    group.lastTurnId = group.turnIds.at(-1);
  };
  for (const turn of Array.isArray(turns) ? turns : []) {
    if (!turn || typeof turn.turnId !== "string" || !turn.turnId.trim() || seen.has(turn.turnId)) continue;
    seen.add(turn.turnId);
    const parent = owners.get(turn.parentTurnId);
    const continuation = turn.turnTrigger === "root_resume" && parent === group &&
      typeof turn.rootTurnId === "string" && turn.rootTurnId.trim() &&
      roots?.has(turn.rootTurnId);
    if (!group || !continuation) {
      finish();
      group = { id: turn.turnId, turnIds: [], durationMs: 0, partial: false, userWaitUnmeasured: false, active: false, turns: [] };
      intervals = [];
      occupiedEnd = 0;
      measuredFloor = 0;
      reservations = new Set();
      roots = new Set();
      groups.push(group);
    }
    group.turnIds.push(turn.turnId);
    group.turns.push(turn);
    owners.set(turn.turnId, group);
    roots.add(turn.rootTurnId || turn.turnId);
    if (turn.metadataPartial) group.partial = true;
    const timing = turn.userWaitTiming;
    const measured = timing != null && Number.isSafeInteger(timing.revision) && timing.revision >= 0 &&
      Array.isArray(timing.requests) && Array.isArray(timing.blockedIntervals);
    const workStartedAtMs = measured && validMs(timing.startedAtMs) ? timing.startedAtMs : turn.turnStartedAtMs;
    const workPrecisionMs = measured && validMs(timing.startedAtMs) ? 0 : turn.turnStartedAtPrecisionMs;
    if (!measured) {
      group.userWaitUnmeasured = true;
      if (timing != null) group.partial = true;
    }
    const registration = turn.rootResumeWait;
    if (registration && typeof registration.reservationId === "string" && registration.reservationId.trim() &&
        validMs(registration.waitStartedAtMs) && ["waiting", "claimed", "resumed", "cancelled", "blocked"].includes(registration.state)) {
      reservations.add(registration.reservationId);
    }
    const addInterval = (start, end) => {
      if (validMs(start) && validMs(end)) {
        const stop = Math.max(start, end);
        intervals.push([start, stop]);
        occupiedEnd = Math.max(occupiedEnd, stop);
      }
      else group.partial = true;
    };
    // Subtract only blocked work; automatic resume waits remain counted.
    const addWork = (start, end) => {
      if (!validMs(start) || !validMs(end)) { group.partial = true; return 0; }
      const stop = Math.max(start, end);
      const blocks = [];
      if (measured) for (const block of timing.blockedIntervals) {
        if (!block || !validMs(block.startedAtMs) ||
            block.endedAtMs != null && (!validMs(block.endedAtMs) || block.endedAtMs < block.startedAtMs)) {
          group.partial = true;
          continue;
        }
        const left = Math.max(start, block.startedAtMs);
        const right = Math.min(stop, block.endedAtMs ?? stop);
        if (right > left) blocks.push([left, right]);
      }
      blocks.sort((a, b) => a[0] - b[0]);
      let cursor = start, excluded = 0;
      for (const [left, right] of blocks) {
        if (left > cursor) addInterval(cursor, left);
        excluded += Math.max(0, right - Math.max(cursor, left));
        cursor = Math.max(cursor, right);
      }
      if (cursor < stop) addInterval(cursor, stop);
      // Coarse placement uses elapsed boundaries even when fully blocked.
      occupiedEnd = Math.max(occupiedEnd, stop);
      return excluded;
    };
    const wait = turn.rootResumeWait;
    const openWait = wait && (wait.state === "waiting" || wait.state === "claimed");
    const waitBoundary = openWait || (wait && validMs(wait.waitStartedAtMs));
    const terminal = ["completed", "interrupted", "failed"].includes(turn.status);
    const liveWork = !terminal && !waitBoundary && ["inProgress", "in_progress"].includes(turn.status);
    if (liveWork) {
      group.active = true;
      addWork(workStartedAtMs, nowMs);
    } else if (terminal || turn.status === "deferred" || waitBoundary) {
      if (validMs(workStartedAtMs) && validMs(turn.durationMs)) {
        let start = workStartedAtMs;
        const precision = workPrecisionMs;
        if (validMs(precision) && precision > 0) {
          const limit = start + precision;
          const fits = candidate => validMs(candidate) && candidate >= start && candidate < limit && candidate >= occupiedEnd;
          // Exact wait starts can locate preceding work inside its coarse bucket.
          const anchored = wait && validMs(wait.waitStartedAtMs) ? wait.waitStartedAtMs - turn.durationMs : null;
          if (fits(anchored)) start = anchored;
          else {
            const sequential = Math.max(start, occupiedEnd);
            if (fits(sequential)) start = sequential;
            else group.partial = true;
          }
          if (wait && validMs(wait.waitStartedAtMs) && start + turn.durationMs > wait.waitStartedAtMs) group.partial = true;
        }
        const excluded = addWork(start, start + turn.durationMs);
        if (validMs(precision) && precision > 0) {
          const floor = measuredFloor + Math.max(0, turn.durationMs - excluded);
          measuredFloor = Number.isFinite(floor) ? floor : Number.MAX_VALUE;
          if (!Number.isFinite(floor)) group.partial = true;
        }
      } else group.partial = true;
    } else group.partial = true;
    if (wait) {
      if (validMs(wait.waitEndedAtMs)) addInterval(wait.waitStartedAtMs, wait.waitEndedAtMs);
      else if (openWait && !terminal) {
        group.active = true;
        addInterval(wait.waitStartedAtMs, nowMs);
      } else group.partial = true;
    } else if (turn.status === "deferred") group.partial = true;
  }
  finish();
  return groups;
}

function azraelTaskTimeLabel(durationMs, locale = "ko") {
  const seconds = typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
    ? Math.floor(durationMs / 1000) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  const english = !/^ko/i.test(locale);
  const units = english ? ["h", "m", "s"] : ["시간", "분", "초"];
  const parts = [];
  if (hours) parts.push(hours + units[0]);
  if (minutes) parts.push(minutes + units[1]);
  if (!hours && (remainder || !parts.length)) parts.push(remainder + units[2]);
  return parts.join(" ");
}

// Self-contained for serialization into the native per-turn Worked renderer.
// Unlike group accounting this takes work elapsed time only, never resume waits.
function azraelUserWaitDuration(durationMs, startedAtMs, timing) {
  const validMs = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const measured = timing != null && Number.isSafeInteger(timing.revision) && timing.revision >= 0 &&
    Array.isArray(timing.requests) && Array.isArray(timing.blockedIntervals);
  const result = { durationMs: validMs(durationMs) ? durationMs : null,
    userWaitUnmeasured: !measured, partial: !validMs(durationMs) || timing != null && !measured };
  if (result.durationMs == null || !measured || !timing.blockedIntervals.length) return result;
  if (validMs(timing.startedAtMs)) startedAtMs = timing.startedAtMs;
  if (!validMs(startedAtMs)) return { ...result, durationMs: null, partial: true };
  const end = startedAtMs + durationMs;
  if (!validMs(end)) return { ...result, durationMs: null, partial: true };
  const blocks = [];
  for (const block of timing.blockedIntervals) {
    if (!block || !validMs(block.startedAtMs) ||
        block.endedAtMs != null && (!validMs(block.endedAtMs) || block.endedAtMs < block.startedAtMs)) {
      result.partial = true;
      continue;
    }
    const left = Math.max(startedAtMs, block.startedAtMs);
    const right = Math.min(end, block.endedAtMs ?? end);
    if (right > left) blocks.push([left, right]);
  }
  blocks.sort((a, b) => a[0] - b[0]);
  let cursor = startedAtMs, excluded = 0;
  for (const [left, right] of blocks) {
    excluded += Math.max(0, right - Math.max(cursor, left));
    cursor = Math.max(cursor, right);
  }
  result.durationMs = Math.max(0, durationMs - excluded);
  return result;
}

module.exports = { azraelTaskTimeGroups, azraelTaskTimeLabel, azraelUserWaitDuration };

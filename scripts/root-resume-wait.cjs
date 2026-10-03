"use strict";

// These functions are injected into the pinned UI and exercised directly by
// source fixtures. Keep them self-contained: the host has no CommonJS loader.
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

module.exports = { azraelMergeRootResumeWait, azraelRootResumeWaitItem, azraelRootResumeWaitLabel };

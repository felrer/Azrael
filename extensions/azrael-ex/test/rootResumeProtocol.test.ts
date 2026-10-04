import assert from "node:assert/strict";
import test from "node:test";
import { isActiveRootResumeState, parseRootResumeMessage, parseRootResumeResponse } from "../src/rootResumeProtocol";

const reservation = {
  id: "reservation-1",
  rootThreadId: "root-thread",
  originatingTurnId: "origin-turn",
  rootTurnId: "root-turn",
  callId: "call-1",
  resumeTurnId: "resume-turn",
  resumeAtMs: 1_800_000_000_000,
  createdAtMs: 1_799_999_000_000,
  updatedAtMs: 1_799_999_500_000,
  revision: 7,
  state: "waiting",
  agentTasks: [{ threadId: "child-thread", agentPath: "/root/worker", turnId: "child-turn" }],
  reason: "하위 작업 결과 대기",
  wakeReason: null,
  lastError: null
};

test("root resume response strictly parses the complete camelCase DTO", () => {
  const parsed = parseRootResumeResponse({ reservations: [reservation] });
  assert.deepEqual(parsed, { reservations: [reservation] });
});

test("root resume response tolerates additive fields but rejects missing and malformed fields", () => {
  assert.deepEqual(parseRootResumeResponse({ reservations: [], extra: true }).reservations, []);
  const missing = structuredClone(reservation) as Record<string, unknown>;
  delete missing.callId;
  assert.throws(() => parseRootResumeResponse({ reservations: [missing] }), /Invalid root resume reservation/);
  assert.throws(() => parseRootResumeResponse({ reservations: [{ ...reservation, revision: 1.5 }] }), /revision/);
  assert.throws(() => parseRootResumeResponse({ reservations: [{ ...reservation, state: "paused" }] }), /state/);
  assert.throws(() => parseRootResumeResponse({ reservations: [{ ...reservation, wakeReason: "poll" }] }), /wakeReason/);
  assert.equal(parseRootResumeResponse({ reservations: [{ ...reservation, agentTasks: [{ ...reservation.agentTasks[0], extra: true }] }] }).reservations.length, 1);
  assert.throws(() => parseRootResumeResponse({ reservations: [{ ...reservation, finalOutputJsonSchema: undefined }] }), /finalOutputJsonSchema/);
});

test("root resume response preserves an optional JSON output schema", () => {
  const finalOutputJsonSchema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
  const parsed = parseRootResumeResponse({ reservations: [{ ...reservation, finalOutputJsonSchema }] });
  assert.deepEqual(parsed.reservations[0].finalOutputJsonSchema, finalOutputJsonSchema);
});

test("root resume UI messages require an exact id and revision for mutations", () => {
  assert.deepEqual(parseRootResumeMessage({ action: "list" }), { action: "list" });
  assert.deepEqual(parseRootResumeMessage({ action: "resume", reservationId: "reservation-1", revision: 7 }), {
    action: "resume", reservationId: "reservation-1", revision: 7
  });
  assert.deepEqual(parseRootResumeMessage({ action: "cancel", reservationId: "reservation-1", revision: 7 }), {
    action: "cancel", reservationId: "reservation-1", revision: 7
  });
  assert.equal(parseRootResumeMessage({ action: "resume", reservationId: "reservation-1" }), undefined);
  assert.equal(parseRootResumeMessage({ action: "cancel", reservationId: "", revision: 7 }), undefined);
  assert.equal(parseRootResumeMessage({ action: "cancel", reservationId: "reservation-1", revision: -1 }), undefined);
  assert.equal(parseRootResumeMessage({ action: "list", revision: 7 }), undefined);
});

test("only actionable reservation states remain visible", () => {
  assert.equal(isActiveRootResumeState("preparing"), true);
  assert.equal(isActiveRootResumeState("waiting"), true);
  assert.equal(isActiveRootResumeState("claimed"), true);
  assert.equal(isActiveRootResumeState("blocked"), true);
  assert.equal(isActiveRootResumeState("resumed"), false);
  assert.equal(isActiveRootResumeState("cancelled"), false);
});

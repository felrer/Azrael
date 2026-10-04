import assert from "node:assert/strict";
import test from "node:test";
import { parseDevinScreen } from "../src/devinUsage";

const NOW = Date.parse("2026-09-13T00:00:00.000Z");
const EXACT_SCREEN = [
  " Daily   ■■  0% used  · resets in 4h 55m",
  " Weekly  ■■  0% used  · resets Sep 13, 5:00 PM (UTC+9)",
].join("\n");

test("exact Devin usage lines preserve zero and parse relative and timezone resets", () => {
  const snapshot = parseDevinScreen(EXACT_SCREEN, NOW);
  assert.ok(snapshot);
  assert.equal(snapshot.updatedAt, NOW);
  assert.deepEqual(snapshot.daily, {
    usedPercent: 0,
    windowDurationMins: 1440,
    resetsAt: Date.parse("2026-09-13T04:55:00.000Z") / 1000,
  });
  assert.deepEqual(snapshot.weekly, {
    usedPercent: 0,
    windowDurationMins: 10080,
    resetsAt: Date.parse("2026-09-13T08:00:00.000Z") / 1000,
  });
});

test("fractional percentages and UTC offsets with minutes are parsed", () => {
  const snapshot = parseDevinScreen([
    "Daily 12.5% used · resets in 1d 2h 3m",
    "Weekly 99.9% used · resets Sep 14, 1:30 AM (UTC-3:30)",
  ].join("\n"), NOW);
  assert.ok(snapshot);
  assert.equal(snapshot.daily?.usedPercent, 12.5);
  assert.equal(snapshot.daily?.resetsAt, NOW / 1000 + 93_780);
  assert.equal(snapshot.weekly?.usedPercent, 99.9);
  assert.equal(snapshot.weekly?.resetsAt, Date.parse("2026-09-14T05:00:00.000Z") / 1000);
});

test("unknown or invalid percentages fail closed", () => {
  assert.equal(parseDevinScreen("Daily — used\nWeekly 0% used", NOW), null);
  assert.equal(parseDevinScreen("Daily 101% used\nWeekly 0% used", NOW), null);
  assert.equal(parseDevinScreen("Daily 0% used\nWeekly 100.1% used", NOW), null);
  assert.equal(parseDevinScreen("Daily -1% used\nWeekly 0% used", NOW), null);
});

test("invalid reset values remain unavailable without discarding valid usage", () => {
  const snapshot = parseDevinScreen([
    "Daily 0% used · resets in soon",
    "Weekly 0% used · resets Sep 44, 17:90 PM (UTC+9)",
  ].join("\n"), NOW);
  assert.ok(snapshot);
  assert.equal(snapshot.daily?.resetsAt, null);
  assert.equal(snapshot.weekly?.resetsAt, null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDevinStatus } from "../src/devinProtocol";

test("Devin response rejects malformed state and only exposes display fields", () => {
  assert.throws(() => parseDevinStatus({ enabled: true, loggedIn: "yes" }));
  assert.deepEqual(parseDevinStatus({ enabled: true, loggedIn: true, email: "test@example.com", plan: "Pro", unexpected: "discard" }),
    { enabled: true, loggedIn: true, email: "test@example.com", plan: "Pro" });
});

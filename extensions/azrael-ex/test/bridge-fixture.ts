import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

if (process.env.FIXTURE_PID_FILE) writeFileSync(process.env.FIXTURE_PID_FILE, String(process.pid));
const sensitiveOutput = "credential-must-not-escape https://private.invalid/token arbitrary/private-method";
if (process.env.FIXTURE_MODE === "invalid-message" || process.env.FIXTURE_MODE === "invalid-connected") {
  process.stderr.write(sensitiveOutput);
  process.stdout.write(JSON.stringify(process.env.FIXTURE_MODE === "invalid-message" ? [sensitiveOutput] : { method: "azrael/connected", params: { codexHome: sensitiveOutput } }) + "\n");
} else if (["native-error", "unsafe-error", "native-protocol-error"].includes(process.env.FIXTURE_MODE ?? "")) {
  process.stderr.write(sensitiveOutput);
  process.stdout.write(JSON.stringify({ method: "azrael/bridgeError", params: { schema: 1, phase: "connect", code: process.env.FIXTURE_MODE === "native-protocol-error" ? "protocol_error" : "permission_denied", retryable: false, ...(process.env.FIXTURE_MODE === "unsafe-error" ? { protocolReason: sensitiveOutput } : {}) } }) + "\n", () => process.exit(1));
} else process.stdout.write(`${JSON.stringify({ method: "azrael/connected", params: { codexHome: "C:/fixture", serverVersion: "0.154.0-alpha.6.2" } })}\n`);
createInterface({ input: process.stdin }).once("line", line => {
  if (process.env.FIXTURE_MODE === "business-error") {
    process.stdout.write(JSON.stringify({ id: JSON.parse(line).id, error: { message: "Account switch is blocked by an active turn." } }) + "\n");
    return;
  }
  if (process.env.FIXTURE_MODE === "invalid") process.stdout.write(`${sensitiveOutput}\n`);
  else if (process.env.FIXTURE_MODE !== "hang") process.exit(7);
});
if (process.env.FIXTURE_MODE === "invalid" || process.env.FIXTURE_MODE === "hang") setInterval(() => undefined, 10_000);

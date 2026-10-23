import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

if (process.env.FIXTURE_PID_FILE) writeFileSync(process.env.FIXTURE_PID_FILE, String(process.pid));
if (process.env.FIXTURE_MODE === "native-error" || process.env.FIXTURE_MODE === "unsafe-error") {
  process.stdout.write(JSON.stringify({ method: "azrael/bridgeError", params: { schema: 1, phase: "connect", code: "permission_denied", retryable: false, ...(process.env.FIXTURE_MODE === "unsafe-error" ? { secret: "credential-must-not-escape" } : {}) } }) + "\n", () => process.exit(1));
} else process.stdout.write(`${JSON.stringify({ method: "azrael/connected", params: { codexHome: "C:/fixture", serverVersion: "0.154.0-alpha.6.2" } })}\n`);
createInterface({ input: process.stdin }).once("line", line => {
  if (process.env.FIXTURE_MODE === "business-error") {
    process.stdout.write(JSON.stringify({ id: JSON.parse(line).id, error: { message: "Account switch is blocked by an active turn." } }) + "\n");
    return;
  }
  if (process.env.FIXTURE_MODE === "invalid") process.stdout.write("not-json\n");
  else if (process.env.FIXTURE_MODE !== "hang") process.exit(7);
});
if (process.env.FIXTURE_MODE === "invalid" || process.env.FIXTURE_MODE === "hang") setInterval(() => undefined, 10_000);

import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

if (process.env.FIXTURE_PID_FILE) writeFileSync(process.env.FIXTURE_PID_FILE, String(process.pid));
process.stdout.write(`${JSON.stringify({ method: "azrael/connected", params: { codexHome: "C:/fixture", serverVersion: "0.154.0-alpha.6.2" } })}\n`);
createInterface({ input: process.stdin }).once("line", () => {
  if (process.env.FIXTURE_MODE === "invalid") process.stdout.write("not-json\n");
  else if (process.env.FIXTURE_MODE !== "hang") process.exit(7);
});
if (process.env.FIXTURE_MODE === "invalid" || process.env.FIXTURE_MODE === "hang") setInterval(() => undefined, 10_000);

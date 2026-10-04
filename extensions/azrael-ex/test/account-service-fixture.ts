import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const attemptFile = requiredEnv("FIXTURE_ATTEMPT_FILE");
const codexHome = requiredEnv("FIXTURE_CODEX_HOME");
const mode = process.env.FIXTURE_MODE ?? "service";
const attempt = existsSync(attemptFile) ? Number(readFileSync(attemptFile, "utf8")) + 1 : 1;
writeFileSync(attemptFile, String(attempt));

if (mode === "always-fail" || (mode === "first-failure" && attempt === 1)) process.exit(1);

process.stdout.write(`${JSON.stringify({
  method: "azrael/connected",
  params: {
    codexHome: mode === "identity-mismatch" ? `${codexHome}-other` : codexHome,
    serverVersion: mode === "version-mismatch" ? "0.0.0" : (process.env.FIXTURE_SERVER_VERSION ?? "0.154.0-alpha.6.2")
  }
})}\n`);
if (mode === "early-notification") {
  process.stdout.write(`${JSON.stringify({ method: "azrael/account/updated", params: { state: accountResponse(codexHome).state } })}\n`);
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line) as { id: number; params?: { action?: string } };
  const action = request.params?.action ?? "unknown";
  if (process.env.FIXTURE_REQUEST_LOG) appendFileSync(process.env.FIXTURE_REQUEST_LOG, `${attempt}:${action}\n`);
  if (["mutation-disconnect", "instance-mismatch", "delayed-reconnect"].includes(mode) && action === "switch") process.exit(9);
  const responseHome = mode === "state-home-mismatch" ? `${codexHome}-other` : codexHome;
  const reply = () => process.stdout.write(`${JSON.stringify({ id: request.id, result: accountResponse(responseHome) })}\n`);
  if (mode === "delayed-reconnect" && attempt > 1 && action === "list") setTimeout(reply, 250);
  else reply();
});

function accountResponse(home: string): { state: Record<string, unknown>; login: null; usage: null; usageProfileId: null } {
  return {
    state: {
      instanceId: mode === "instance-mismatch" && attempt > 1 ? "other-instance" : "fixture-instance",
      revision: 1,
      codexHome: home,
      profiles: [],
      currentAccount: null,
      activeProfileId: null,
      pendingProfileId: null,
      isSwitching: false,
      hasActiveTurns: false,
      loginPending: false,
      lastError: null
    },
    login: null,
    usage: null,
    usageProfileId: null
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

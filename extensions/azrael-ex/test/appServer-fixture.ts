import { createInterface } from "node:readline";

const mode = process.env.FIXTURE_MODE ?? "normal";
const lines = createInterface({ input: process.stdin });
let initialized = false;
let requestCount = 0;
let mutationCount = 0;

lines.on("line", (line) => {
  const message = JSON.parse(line) as { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: unknown };
  if (message.method === "initialize") {
    if (message.id !== 1 || !message.params ||
      (message.params as { clientInfo?: { name?: string } }).clientInfo?.name !== "azrael" ||
      (message.params as { capabilities?: { experimentalApi?: boolean } }).capabilities?.experimentalApi !== true) process.exit(3);
    send({ id: message.id, result: { userAgent: "fixture" } });
    return;
  }
  if (message.method === "initialized") { initialized = true; send({ method: "fixture/ready", params: { initialized } }); return; }
  if (!initialized) process.exit(4);
  if (message.method === "fixture/roundtrip") {
    requestCount++;
    send({ id: message.id, result: { received: message.params, requestCount } });
    send({ method: "fixture/event", params: { ok: true } });
  } else if (message.method === "fixture/serverRequest") {
    send({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { command: "echo fixture" } });
  } else if (message.id === "approval-1") {
    send({ method: "fixture/replied", params: { result: message.result, error: message.error } });
  } else if (message.method === "fixture/mutate") {
    mutationCount++;
    if (mode === "disconnect") process.exit(7);
    if (mode === "invalid") process.stdout.write("{broken\n");
    if (mode === "oversized") process.stdout.write("x".repeat(2048));
  } else if (message.method === "fixture/count") {
    send({ id: message.id, result: { mutationCount } });
  } else if (message.method === "fixture/notification") {
    send({ method: "fixture/notified", params: message.params });
  }
});

function send(message: object): void { process.stdout.write(`${JSON.stringify(message)}\n`); }

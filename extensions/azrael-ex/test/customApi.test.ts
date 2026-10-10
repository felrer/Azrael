import test from "node:test";
import assert from "node:assert/strict";
import { CustomApiService, parseApiConnections, CustomApiConnection, CustomApiRequest } from "../src/customApiService";
import { CustomApiManagement, customApiHtml } from "../src/customApiManagement";

const connection: CustomApiConnection = { id: "a".repeat(32), name: "Local API", baseUrl: "http://localhost:4321/v1", protocol: "chat", enabled: true,
  timeoutMs: 180000, maxConcurrent: 1, stream: false, auth: { kind: "secret" }, models: [{ id: "vendor/model", name: "Model", contextWindow: 40000, maxOutputTokens: 4000, supportsTools: false, sendThinkingParameter: false, enableThinking: false, parallelToolCalls: false }] };
if (process.argv.includes("--api-config")) {
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const request = JSON.parse(input);
    if (request.id === "timeout") { setTimeout(() => {}, 60000); return; }
    if (request.id === "error") { process.stderr.write("SECRET_RAW_SERVER_ERROR"); process.exitCode = 1; return; }
    if (process.argv.some(arg => arg.includes("private-key"))) { process.exitCode = 2; return; }
    process.stdout.write(JSON.stringify(request.action === "discover" ? { modelIds: ["vendor/model"] } : { connections: [{ ...connection, apiKey: "private-key" }] }));
  });
} else {
  test("public API snapshots strip secrets and reject malformed identities", () => {
    assert.deepEqual(parseApiConnections([{ ...connection, apiKey: "secret", auth: { kind: "secret", value: "secret" } }]), [connection]);
    assert.deepEqual(parseApiConnections([{ ...connection, apiKey: "private-key" }]), [connection]);
    assert.equal(parseApiConnections([{ ...connection, models: [{ ...connection.models[0], sendThinkingParameter: undefined }] }])[0].models[0].sendThinkingParameter, false);
    assert.throws(() => parseApiConnections([{ ...connection, id: "bad" }]));
    assert.throws(() => parseApiConnections([connection, connection]));
  });
  test("helper uses private stdin, safe errors, bounded cancellation and only public response", async () => {
    const service = new CustomApiService({ ...process.env, AZRAEL_PROVIDER_BUN: process.execPath, AZRAEL_PROVIDER_INFERENCE_HELPER: __filename }, 1500);
    assert.deepEqual(await service.request({ action: "upsert", connection, apiKey: "private-key" }), { connections: [connection] });
    assert.deepEqual(await service.request({ action: "discover", id: connection.id }), { modelIds: ["vendor/model"] });
    await assert.rejects(service.request({ action: "list", id: "error" }), error => !String(error).includes("SECRET_RAW_SERVER_ERROR"));
    await assert.rejects(service.request({ action: "list", id: "timeout" }));
    const pending = service.request({ action: "list", id: "timeout" }); service.dispose(); await assert.rejects(pending);
  });
  test("management preserves failed saves, does not discover on read, deletes and disables explicitly", async () => {
    const requests: CustomApiRequest[] = []; let fail = false;
    const backend = { enabled: true, dispose() {}, async request(request: CustomApiRequest) {
      requests.push(request); if (fail) throw Error("SECRET");
      return { connections: request.action === "delete" ? [] : request.connection ? [request.connection as CustomApiConnection] : [connection] };
    } };
    const manager = new CustomApiManagement(backend, { text: async () => undefined, choose: async () => undefined, checks: async () => undefined, confirm: async () => true }, () => {});
    await manager.refresh(); assert.deepEqual(requests.map(r => r.action), ["list"]);
    fail = true; await manager.handle({ action: "apiToggle", accountId: connection.id });
    assert.equal(manager.connections[0].enabled, true); assert.ok(manager.error); assert.ok(!manager.error.includes("SECRET"));
    fail = false; await manager.handle({ action: "apiToggle", accountId: connection.id }); assert.equal(manager.connections[0].enabled, false);
    await manager.handle({ action: "apiDelete", accountId: connection.id }); assert.deepEqual(manager.connections, []);
    assert.ok(customApiHtml(manager).includes("등록된 API 연결이 없습니다"));
  });
  test("new connection starts with blank endpoint and manual slash model registration requires verified limits", async () => {
    const requests: CustomApiRequest[] = [], prompts: Array<[string, string | undefined, boolean | undefined]> = [];
    const texts = ["My API", "http://localhost:1234/v1", "private-key", "180000", "1", "vendor/model", "Model", "64000", "8000"];
    const choices = ["chat", "secret", "사용 안 함", "사용", "모델 추가"];
    const backend = { enabled: true, dispose() {}, async request(request: CustomApiRequest) { requests.push(request); return { connections: [{ ...request.connection!, id: connection.id } as CustomApiConnection] }; } };
    const manager = new CustomApiManagement(backend, { text: async (prompt, value, password) => { prompts.push([prompt, value, password]); return texts.shift(); }, choose: async () => choices.shift(), checks: async () => ["도구 호출 지원을 직접 확인함"], confirm: async () => true }, () => {});
    await manager.handle({ action: "apiAdd" }); assert.equal(prompts[1][1], ""); assert.equal(prompts[2][2], true);
    assert.equal(requests[0].apiKey, "private-key"); assert.equal(manager.connections[0].models.length, 0);
    await manager.handle({ action: "apiModels", accountId: connection.id });
    const model = manager.connections[0].models[0]; assert.equal(model.id, "vendor/model"); assert.equal(model.contextWindow, 64000); assert.equal(model.maxOutputTokens, 8000); assert.equal(model.supportsTools, true);
    assert.equal(model.sendThinkingParameter, false);
    assert.ok(requests.every(r => r.action === "upsert"));
  });
  test("thinking parameter transmission checkbox is independent from enable_thinking and preserves edit defaults", async () => {
    let saved: CustomApiConnection = connection;
    const text = ["vendor/model", "Model", "40000", "4000"];
    const choices = ["모델 수정", "vendor/model"];
    let checkboxReads = 0;
    const backend = { enabled: true, dispose() {}, async request(request: CustomApiRequest) {
      if (request.connection) saved = request.connection as CustomApiConnection;
      return { connections: [saved] };
    } };
    const manager = new CustomApiManagement(backend, { text: async () => text.shift(), choose: async () => choices.shift(), checks: async (_title, options) => {
      assert.equal(options.find(item => item.label === "thinking 파라미터 전송 (지원 서버만)")?.picked, checkboxReads++ > 0);
      return ["thinking 파라미터 전송 (지원 서버만)"];
    }, confirm: async () => true }, () => {});
    await manager.refresh(); await manager.handle({ action: "apiModels", accountId: connection.id });
    assert.equal(saved.models[0].sendThinkingParameter, true); assert.equal(saved.models[0].enableThinking, false);
    text.push("vendor/model", "Model", "40000", "4000"); choices.push("모델 수정", "vendor/model");
    await manager.handle({ action: "apiModels", accountId: connection.id }); assert.equal(checkboxReads, 2);
  });
  test("editing secret connection omits blank replacement key and cancelled editing performs no write", async () => {
    const requests: CustomApiRequest[] = [];
    const text = ["Changed", connection.baseUrl, "", "180000", "1"];
    const choices = ["chat", "secret", "사용 안 함", "사용"];
    const backend = { enabled: true, dispose() {}, async request(request: CustomApiRequest) {
      requests.push(request); return { connections: request.connection ? [request.connection as CustomApiConnection] : [connection] };
    } };
    const manager = new CustomApiManagement(backend, { text: async () => text.shift(), choose: async () => choices.shift(), checks: async () => [], confirm: async () => true }, () => {});
    await manager.refresh(); await manager.handle({ action: "apiEdit", accountId: connection.id });
    assert.equal(requests[1].action, "upsert"); assert.equal(requests[1].apiKey, undefined); assert.equal(manager.connections[0].name, "Changed");
    await manager.handle({ action: "apiEdit", accountId: connection.id }); assert.equal(requests.length, 2); assert.equal(manager.connections[0].name, "Changed");
  });
}

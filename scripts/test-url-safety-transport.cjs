"use strict";
// Offline contract checks: every HTTPS operation is an EventEmitter mock.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { ANCHOR, CURRENT_ANCHOR, STABLE_ANCHOR, TARGET_ANCHOR, MARKER, injectUrlSafetyTransport } = require("./inject-url-safety-transport.cjs");
const source = fs.readFileSync(path.join(__dirname, "url-safety-transport.cjs"), "utf8");

function fixture(scenario = {}, env = {}) {
  const calls = [], logs = [], delegated = [];
  const timeout = new AbortController();
  const module = { exports: {} };
  const https = { request(url, options, callback) {
    const request = new EventEmitter();
    const call = { url, options, request, destroyed: false };
    calls.push(call);
    request.destroy = error => { call.destroyed = true; queueMicrotask(() => request.emit("error", error)); };
    options.signal.addEventListener("abort", () => request.destroy(options.signal.reason), { once: true });
    request.end = body => {
      call.body = body;
      queueMicrotask(() => {
        if (options.signal.aborted) return request.destroy(options.signal.reason);
        if (scenario.error) return request.emit("error", scenario.error);
        if (scenario.pending) return;
        const incoming = new EventEmitter();
        incoming.statusCode = scenario.status ?? 200;
        incoming.headers = scenario.headers ?? { "content-type": "application/json" };
        callback(incoming);
        for (const chunk of scenario.chunks ?? [Buffer.from(scenario.body ?? '{"safe":true}')]) incoming.emit("data", chunk);
        if (scenario.aborted) incoming.emit("aborted");
        else incoming.emit("end");
      });
    };
    return request;
  } };
  vm.runInNewContext(source, {
    module, require(name) { assert.equal(name, "node:https"); return https; },
    process: { env }, Buffer, Headers, Response, AbortController, Date,
    AbortSignal: { any: AbortSignal.any.bind(AbortSignal), timeout(ms) { assert.equal(ms, 15000); return timeout.signal; } },
  }, { filename: "url-safety-transport.cjs" });
  const fallbackResult = { delegated: true };
  const fallback = (...args) => { delegated.push(args); return fallbackResult; };
  const options = { method: "POST", headers: { authorization: "Bearer secret-test-token", "chatgpt-account-id": "secret-account", "x-host-header": "kept" }, body: '{"url":"https://secret.example/private"}' };
  const run = (url = module.exports.ENDPOINT, opts = options, configuredProxy = false) => module.exports.fetchUrlSafety(url, opts, fallback, (...args) => { logs.push(args); if (scenario.loggerThrows) throw new Error("logger unavailable"); }, configuredProxy);
  return { calls, logs, delegated, run, options, fallbackResult, timeout, endpoint: module.exports.ENDPOINT };
}

test("exact endpoint and POST preserve host credentials and return safe true/false verbatim", async () => {
  for (const safe of [true, false]) {
    const f = fixture({ body: JSON.stringify({ safe }) });
    const response = await f.run();
    assert.deepEqual(await response.json(), { safe });
    assert.equal(f.calls.length, 1);
    const call = f.calls[0];
    assert.equal(call.url, f.endpoint);
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.agent, false);
    assert.equal(call.body, f.options.body);
    assert.equal(call.options.headers.authorization, f.options.headers.authorization);
    assert.equal(call.options.headers["chatgpt-account-id"], "secret-account");
    assert.equal(call.options.headers["x-host-header"], "kept");
    assert.equal(call.options.headers["accept-encoding"], "identity");
    assert.equal(call.options.headers["content-length"], String(Buffer.byteLength(call.body)));
  }
});

test("URL variants and other methods delegate identical arguments", async () => {
  const f = fixture();
  for (const url of [f.endpoint + "?x=1", f.endpoint + "/", f.endpoint.replace("https:", "http:"), "https://other.example/backend-api/ecosystem/url_safe", new URL(f.endpoint)]) {
    assert.equal(await f.run(url), f.fallbackResult);
    assert.equal(f.delegated.at(-1)[0], url);
    assert.equal(f.delegated.at(-1)[1], f.options);
  }
  for (const method of ["GET", "post", undefined]) {
    const options = { ...f.options, method };
    assert.equal(await f.run(f.endpoint, options), f.fallbackResult);
    assert.equal(f.delegated.at(-1)[1], options);
  }
  assert.equal(f.calls.length, 0);
});

test("configured and uppercase/lowercase environment proxies preserve upstream", async () => {
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    const f = fixture({}, { [name]: "http://secret-proxy.example" });
    assert.equal(await f.run(), f.fallbackResult);
    assert.equal(f.calls.length, 0);
    assert.equal(f.delegated[0][1], f.options);
  }
  const f = fixture();
  assert.equal(await f.run(f.endpoint, f.options, true), f.fallbackResult);
  assert.equal(f.calls.length, 0);
});

test("HTTP error and redirect stay single responses without redirect, cookie, or challenge handling", async () => {
  for (const status of [302, 403, 429, 500]) {
    const body = "secret challenge HTML";
    const f = fixture({ status, body, headers: { location: "https://other.example", "set-cookie": "secret-cookie", authorization: "secret", "content-type": "text/html", "cf-ray": "ray-id", "cf-mitigated": "challenge", "retry-after": "5" } });
    const response = await f.run();
    assert.equal(response.status, status);
    assert.equal(response.ok, false);
    assert.equal(await response.text(), body);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("authorization"), null);
    assert.equal(response.headers.get("cf-ray"), "ray-id");
    assert.equal(response.headers.get("retry-after"), "5");
    assert.equal(f.calls.length, 1);
    assert.equal(f.delegated.length, 0);
    assert.equal(f.logs[0][2].challenge, true);
  }
});

test("network errors propagate and never fall back to another transport", async () => {
  const error = new Error("secret URL and credential in native error");
  const f = fixture({ error });
  await assert.rejects(f.run(), actual => actual === error);
  assert.equal(f.delegated.length, 0);
  assert.equal(f.logs[0][2].outcome, "failed");
  assert.ok(!JSON.stringify(f.logs).includes("secret"));
});

test("caller cancellation and 15-second timeout cancel native request", async () => {
  for (const kind of ["caller", "timeout", "already-aborted"]) {
    const f = fixture({ pending: true });
    const caller = new AbortController();
    if (kind === "already-aborted") caller.abort();
    const result = f.run(f.endpoint, { ...f.options, signal: caller.signal });
    if (kind === "caller") caller.abort();
    if (kind === "timeout") f.timeout.abort(new Error("timeout"));
    await assert.rejects(result);
    assert.equal(f.calls[0].destroyed, true);
    assert.equal(f.logs[0][2].outcome, "aborted");
  }
});

test("64KiB response boundary is accepted and oversized streamed response destroys request", async () => {
  const accepted = fixture({ chunks: [Buffer.alloc(65536, 65)] });
  assert.equal((await (await accepted.run()).arrayBuffer()).byteLength, 65536);
  const f = fixture({ chunks: [Buffer.alloc(65536), Buffer.alloc(1)] });
  await assert.rejects(f.run(), /exceeds limit/);
  assert.equal(f.calls[0].destroyed, true);
});

test("invalid or oversized request body is rejected before HTTPS", async () => {
  for (const body of [undefined, Buffer.from("{}"), "x".repeat(65537), "한".repeat(22000)]) {
    const f = fixture();
    await assert.rejects(f.run(f.endpoint, { ...f.options, body }), /Invalid URL safety request body/);
    assert.equal(f.calls.length, 0);
  }
});

test("interrupted response and unexpected compression fail closed", async () => {
  for (const scenario of [{ aborted: true }, { headers: { "content-encoding": "gzip" } }, { status: 199 }, { status: 600 }]) {
    const f = fixture(scenario);
    await assert.rejects(f.run(), /interrupted|encoding|status/);
    assert.equal(f.delegated.length, 0);
  }
});

test("malformed JSON remains malformed for existing downstream parser", async () => {
  const f = fixture({ body: '{"safe":' });
  const response = await f.run();
  await assert.rejects(response.json(), SyntaxError);
});

test("transport logs contain only approved metadata and logger failure does not change verdict", async () => {
  const f = fixture({ loggerThrows: true });
  assert.deepEqual(await (await f.run()).json(), { safe: true });
  assert.ok(!JSON.stringify(f.logs).includes("secret"));
  assert.deepEqual(Object.keys(f.logs[0][2]).sort(), ["challenge", "durationMs", "status", "transport"]);
});

test("stale host encoding and content length are replaced with actual UTF-8 size", async () => {
  const f = fixture();
  const body = '{"url":"https://example.com/한"}';
  await f.run(f.endpoint, { ...f.options, body, headers: { ...f.options.headers, "accept-encoding": "gzip", "content-length": "1" } });
  assert.equal(f.calls[0].options.headers["accept-encoding"], "identity");
  assert.equal(f.calls[0].options.headers["content-length"], String(Buffer.byteLength(body)));
});

test("pinned real host injector replaces one anchor, remains idempotent, and preserves surrounding policy", () => {
  const filename = path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434")), "out/extension.js");
  const original = fs.readFileSync(filename, "utf8");
  assert.equal(original.split(TARGET_ANCHOR).length - 1, 1);
  const patched = injectUrlSafetyTransport(original);
  assert.equal(patched.count, 1);
  assert.equal(patched.text.split(MARKER).length - 1, 1);
  const start = original.indexOf(TARGET_ANCHOR);
  assert.equal(patched.text.slice(0, start), original.slice(0, start));
  const suffix = original.slice(start + TARGET_ANCHOR.length);
  assert.ok(patched.text.endsWith(suffix));
  assert.deepEqual(injectUrlSafetyTransport(patched.text), { text: patched.text, count: 0 });
});

test("legacy host shape fixture routes URL safety and preserves surrounding text", () => {
  const prefix = "function J(){return XC}async function legacyRequest(){";
  const suffix = "{return h}return null}";
  const original = prefix + CURRENT_ANCHOR + suffix;
  assert.equal(original.split(CURRENT_ANCHOR).length - 1, 1);
  const patched = injectUrlSafetyTransport(original);
  assert.equal(patched.count, 1);
  assert.equal(patched.text.split(MARKER).length - 1, 1);
  assert.equal(patched.text.slice(0, prefix.length), prefix);
  assert.equal(patched.text.slice(-suffix.length), suffix);
  assert.ok(patched.text.includes("(level,event,safe)=>J()[level](event,{safe,sensitive:{}})"));
  assert.deepEqual(injectUrlSafetyTransport(patched.text), { text: patched.text, count: 0 });
});

test("injector refuses missing, duplicated, altered anchor or corrupt marker", () => {
  for (const input of ["", ANCHOR + ANCHOR, ANCHOR.replace("headers:p", "headers:q"), MARKER + ANCHOR, MARKER + MARKER]) {
    assert.throws(() => injectUrlSafetyTransport(input), /anchor|marker/);
  }
});

test("stable official host preserves response classification and identity retry policy", () => {
  const filename = path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434")), "out/extension.js");
  const original = fs.readFileSync(filename, "utf8");
  assert.equal(original.split(TARGET_ANCHOR).length - 1, 1);
  const patched = injectUrlSafetyTransport(original);
  assert.equal(patched.count, 1);
  const start = original.indexOf(TARGET_ANCHOR);
  assert.equal(patched.text.slice(0, start), original.slice(0, start));
  assert.ok(patched.text.endsWith(original.slice(start + TARGET_ANCHOR.length)));
  assert.ok(patched.text.includes("Authenticated principal changed"));
  assert.ok(patched.text.includes("(level,event,safe)=>ie()[level](event,{safe,sensitive:{}})"));
  assert.ok(patched.text.includes(",y=!g.ok&&h?await w6e(g):null"));
  assert.deepEqual(injectUrlSafetyTransport(patched.text), { text: patched.text, count: 0 });
});

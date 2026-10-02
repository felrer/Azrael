"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

// Synthetic guards and pinned source compatibility, without a prepared host.
const originalRoot = path.resolve(__dirname, "../artifacts/upstream-ui/26.928.31416");
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const transformer = require("./namespace-azrael-host.cjs");

test("namespace transforms preserve URLs, filter workspace history and reject unsupported anchors", () => {
  const originalBundle = fs.readFileSync(path.join(originalRoot, "out/extension.js"), "utf8");
  const originalRecentThreadBundle = fs.readFileSync(path.join(originalRoot,
    "webview/assets/app-initial-9f7d97690e9b.js"), "utf8");
  assert.equal(transformer.getTransformRules()["inject-composer-draft.cjs"],
    crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "inject-composer-draft.cjs"))).digest("hex"),
    "composer draft transform must invalidate cached assets when its source changes");
  const externalUrls = [
    "https://example.test/openai.chatgpt/openai-codex/chatgpt.route",
    "http://example.test/openai.chatgpt",
    "wss://example.test/openai-codex",
    "ws://example.test/chatgpt.route",
  ];
  for (const url of externalUrls) assert.equal(transformer.rewriteValue(url), url, `external URL changed: ${url}`);
  const synthetic = 'const a=vscode.workspace.getConfiguration("chatgpt");const auth="chatgpt";const url="https://chatgpt.com/auth";const external="https://example.test/openai.chatgpt/openai-codex/chatgpt.route";const provider="codex.chatSessionProvider";const home="CODEX_HOME";const pipe=`\\\\.\\pipe\\codex-ipc-${id}`;const httpsTemplate=`https://example.test/openai.chatgpt/${id}/openai-codex`;const wsTemplate=`wss://example.test/chatgpt.route/${id}`;';
  const rewritten = transformer.rewriteJavaScript(synthetic, "namespace-fixture.js", ts).text;
  assert(rewritten.includes('getConfiguration("azrael")'));
  assert(rewritten.includes('auth="chatgpt"'));
  assert(rewritten.includes("https://chatgpt.com/auth"));
  assert(rewritten.includes("https://example.test/openai.chatgpt/openai-codex/chatgpt.route"));
  assert(rewritten.includes("https://example.test/openai.chatgpt/${id}/openai-codex"));
  assert(rewritten.includes("wss://example.test/chatgpt.route/${id}"));
  assert(rewritten.includes("codex.chatSessionProvider"));
  assert(rewritten.includes('home="CODEX_HOME"'));
  assert(rewritten.includes("azrael-ipc-${id}"), "template IPC prefix was not rewritten");

  const recentThreadListFixture = [
    'function listRecent(client,params,background){return client.sendRequest(`thread/list`,params,',
    'background?{priority:`background`,source:`recent_threads`}:{source:`recent_threads`});}',
    'function listCollab(client,params){return client.sendRequest(`thread/list`,params,',
    '{priority:`background`,source:`collab_hydration`});}',
  ].join("");
  const markedRecentThreadListFixture = transformer.markRecentThreadListRequest(
    recentThreadListFixture, "recent-thread-list-fixture.js", ts,
  );
  assert.equal(markedRecentThreadListFixture.count, 1,
    "synthetic recent thread/list request count differed");

  const bridgeFixture = [
    'class Bridge{sendProviderRequest(provider,id,method,params,prewarm,delivery){',
    'let request={id:id,method:method,params:params};return request;}}',
  ].join("");
  const filteredBridgeFixture = transformer.injectWorkspaceThreadListBridgeFilter(
    bridgeFixture, "thread-list-bridge-fixture.js", ts,
  );
  assert.equal(filteredBridgeFixture.count, 1, "synthetic app-server bridge count differed");

  function runThreadListFixture(workspaceFolders, expression, params, background = false) {
    let vscodeRequireCount = 0;
    const client = { sendRequest: (...args) => args[1] };
    const context = {
      client,
      params,
      background,
      require(request) {
        assert.equal(request, "vscode", "workspace filter required an unexpected module");
        vscodeRequireCount += 1;
        return { workspace: { workspaceFolders } };
      },
    };
    const source = `${markedRecentThreadListFixture.text};${filteredBridgeFixture.text};${expression}`;
    const result = vm.runInNewContext(source, context, { filename: "thread-list-fixture.js" });
    return { result, vscodeRequireCount };
  }

  const recentListExpression = 'new Bridge().sendProviderRequest("provider","request-id","thread/list",' +
    'listRecent(client,params,background),false,false).params';
  const oneRoot = runThreadListFixture(
    [{ uri: { scheme: "file", fsPath: "C:\\work\\one" } }],
    recentListExpression,
    { limit: 50 },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(oneRoot.result.cwd)), ["C:\\work\\one"],
    "single-root workspace was not added to thread/list");
  assert.equal(oneRoot.vscodeRequireCount, 1);
  assert.equal(oneRoot.result.__azraelWorkspaceThreadList, undefined,
    "internal workspace marker escaped the app-server bridge");

  // null/omitted selects the server's default provider; [] includes Devin too.
  for (const providerParams of [{}, { modelProviders: null }, { modelProviders: ["openai"] }]) {
    for (const background of [false, true]) {
      const params = { limit: 25, cursor: "next-page", archived: false, ...providerParams };
      const snapshot = JSON.stringify(params);
      const allProviders = runThreadListFixture(
        [{ uri: { scheme: "file", fsPath: "C:\\work\\one" } }],
        recentListExpression, params, background,
      );
      assert.deepEqual(JSON.parse(JSON.stringify(allProviders.result)), {
        ...params, modelProviders: [], cwd: ["C:\\work\\one"],
      }, "recent chats must include every provider while preserving pagination and archive filters");
      assert.equal(JSON.stringify(params), snapshot, "recent-list input parameters were mutated");
    }
  }

  const multiRoot = runThreadListFixture([
    { uri: { scheme: "file", fsPath: "C:\\work\\one" } },
    { uri: { scheme: "untitled", fsPath: "ignored" } },
    { uri: { scheme: "file", fsPath: "D:\\work\\two" } },
  ], recentListExpression, { limit: 25, cwd: ["stale"] }, true);
  assert.deepEqual(JSON.parse(JSON.stringify(multiRoot.result)), {
    limit: 25,
    modelProviders: [],
    cwd: ["C:\\work\\one", "D:\\work\\two"],
  }, "multi-root file workspaces did not replace thread/list cwd");

  const emptyRoots = runThreadListFixture(undefined, recentListExpression, { limit: 10 });
  assert.deepEqual(JSON.parse(JSON.stringify(emptyRoots.result.cwd)), [],
    "empty workspace did not fail closed with an empty cwd list");

  const unmarkedParams = { limit: 10, modelProviders: ["openai"] };
  const unmarked = runThreadListFixture(
    [{ uri: { scheme: "file", fsPath: "C:\\work\\one" } }],
    'new Bridge().sendProviderRequest("provider","request-id","thread/list",' +
      'listCollab(client,params),false,false).params',
    unmarkedParams,
  );
  assert.equal(unmarked.result, unmarkedParams, "unmarked thread/list parameters were changed");
  assert.equal(unmarked.vscodeRequireCount, 0,
    "unmarked thread/list evaluated workspace filtering");

  assert.throws(
    () => transformer.markRecentThreadListRequest(
      'client.sendRequest(`thread/list`,params,{source:`recent_threads`});',
      "recent-thread-list-guard-mismatch.js", ts,
    ),
    /expected 1 conditional recent_threads request.*unsupported/,
    "changed recent thread/list option shape did not fail transformation",
  );
  assert.throws(
    () => transformer.injectWorkspaceThreadListBridgeFilter(
      'class Bridge{sendProviderRequest(provider,id,method,params){return {id,method,params};}}',
      "thread-list-bridge-guard-mismatch.js", ts,
    ),
    /expected 1 request params boundary, found 0/,
    "changed app-server bridge shape did not fail transformation",
  );
  const pinnedBridgeTransform = transformer.injectWorkspaceThreadListBridgeFilter(
    originalBundle, "pinned-original-extension.js", ts,
  );
  assert.equal(pinnedBridgeTransform.count, 1,
    "pinned official host bridge did not match the guarded transformation");
  const pinnedRecentThreadTransform = transformer.markRecentThreadListRequest(
    originalRecentThreadBundle, "pinned-original-recent-thread-list.js", ts,
  );
  assert.equal(pinnedRecentThreadTransform.count, 1,
    "pinned recent-thread list did not match the guarded transformation");
});

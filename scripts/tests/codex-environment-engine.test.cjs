"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { stringifyToml, pathState } = require("../sync-codex-environment.cjs");
const { createEnvironmentEngine, inspect, localPlans } = require("../lib/codex-environment-engine.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-engine-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const home = path.join(root, "home"); fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "config.toml"), 'model = "fixture"\n');
  const server = path.join(root, "engine.cjs"), calls = path.join(root, "calls.jsonl");
  fs.writeFileSync(server, `
const fs=require('node:fs'),path=require('node:path');
if(process.argv.includes('--help')) { console.log('--strict-config --listen'); process.exit(0); }
if(!process.argv.includes('--strict-config'))process.exit(10);
if(process.env.AZRAEL_EX_MANAGEMENT_SOCKET)process.exit(11);
const home=process.env.CODEX_HOME, mode=process.env.TEST_MODE;
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(process.env.TEST_CALLS,JSON.stringify(m)+'\\n');
if(!m.id)return;
if(mode==='timeout'&&m.method==='config/read')return;
if(mode==='exit')process.exit(7);
if(mode==='malformed'){process.stdout.write('invalid JSON\\n');return;}
if(m.method==='initialize')return send({id:m.id,result:{codexHome:mode==='identity'?path.dirname(home):home}});
if(m.method==='config/read'){
 if(mode==='rpc')return send({id:m.id,error:{code:-1,message:'typed configuration rejected'}});
 if(mode==='warning')send({method:'configWarning',params:{summary:'using defaults'}});
 return send({id:m.id,result:{config:{},layers:[{name:{type:'user',file:path.join(home,'config.toml')}}]}});
}
if(m.method==='experimentalFeature/list')return send({id:m.id,result:{data:[{name:'fixture',enabled:true}],nextCursor:null}});
if(m.method==='plugin/list'){
 const inventory=JSON.parse(fs.readFileSync(process.env.TEST_INVENTORY,'utf8'));
 for(const market of inventory.marketplaces)for(const plugin of market.plugins)plugin.installed=fs.existsSync(path.join(home,'plugins/cache',market.name,plugin.name,plugin.localVersion));
 return send({id:m.id,result:inventory});
}
process.exit(12);
});
rl.on('close',()=>{if(mode==='late-warning')send({method:'configWarning',params:{summary:'late fallback'}});if(mode==='hang')setInterval(()=>{},1000);});
`);
  return { root, home, calls, async engine(mode = "ok", extraEnv = {}) {
    const options = { prefix: [server], env: { ...process.env, TEST_MODE: mode, TEST_CALLS: calls, ...extraEnv }, exitTimeoutMs: mode === "hang" ? 150 : 1000 };
    // Capability probing uses the product's ordinary budget. Only the RPC
    // inspection has a short test deadline; a slow --help is not that test.
    const engine = await createEnvironmentEngine(process.execPath, options);
    if (mode !== "timeout") return engine;
    return { ...engine, validate: home => inspect(process.execPath, home, { ...options, kind: engine.kind, timeoutMs: 3000 }) };
  } };
}

test("strict stdio validation uses only configuration RPC and closes its owned process", async t => {
  const f = fixture(t), engine = await f.engine();
  assert.equal(engine.kind, "app-server");
  assert.equal((await engine.validate(f.home)).features[0].name, "fixture");
  const methods = fs.readFileSync(f.calls, "utf8").trim().split('\n').map(line => JSON.parse(line).method);
  assert.deepEqual(methods, ["initialize", "initialized", "config/read", "experimentalFeature/list"]);
});
for (const [mode, message] of [["identity", /identity mismatch/], ["warning", /configWarning/], ["late-warning", /configWarning/], ["rpc", /typed configuration rejected/], ["malformed", /JSON/], ["timeout", /timeout/], ["exit", /exited/], ["hang", /did not exit/]]) {
  test(`native ${mode} fails without CLI fallback`, async t => {
    const f = fixture(t), engine = await f.engine(mode);
    await assert.rejects(engine.validate(f.home), message);
    if (mode === "timeout") {
      const methods = fs.readFileSync(f.calls, "utf8").trim().split('\n').map(line => JSON.parse(line).method);
      assert(methods.includes("config/read"), "timeout must occur after the native configuration request was received");
    }
  });
}

function pluginFixture(t) {
  const f = fixture(t), market = path.join(f.root, "market"), source = path.join(market, "plugins", "sample");
  fs.mkdirSync(path.join(market, ".agents", "plugins"), { recursive: true });
  fs.mkdirSync(path.join(source, ".codex-plugin"), { recursive: true });
  const entry = { name: "sample", source: { source: "local", path: "./plugins/sample" }, policy: { installation: "AVAILABLE" } };
  const plugin = { name: "sample", version: "1.0.0", skills: "./skills" };
  const native = { id: "sample@fixture", name: "sample", source: { type: "local", path: source }, localVersion: "1.0.0", enabled: true, installPolicy: "AVAILABLE", availability: "AVAILABLE", disabledReason: null };
  const inventory = { marketplaces: [{ name: "fixture", path: market, plugins: [native] }] };
  const save = () => { fs.writeFileSync(path.join(market, ".agents", "plugins", "marketplace.json"), JSON.stringify({ name: "fixture", plugins: [entry] })); fs.writeFileSync(path.join(source, ".codex-plugin", "plugin.json"), JSON.stringify(plugin)); };
  const plans = () => { save(); return localPlans(f.home, ["sample@fixture"], new Map([["fixture", market]]), inventory, { directoryHash: p => crypto.createHash("sha256").update(fs.readFileSync(path.join(p, ".codex-plugin", "plugin.json"))).digest("hex") }); };
  return { ...f, market, source, entry, plugin, native, inventory, plans };
}
test("local payload plan pins native policy, canonical identity, version and SHA", t => {
  const f = pluginFixture(t), [plan] = f.plans();
  assert.equal(plan.source, f.source); assert.equal(plan.version, "1.0.0"); assert.match(plan.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.destination, path.join(f.home, "plugins/cache/fixture/sample/1.0.0"));
});
for (const [name, mutate, message] of [
  ["native policy", f => { f.inventory.marketplaces = []; }, /policy/],
  ["denied installation", f => { f.native.installPolicy = "NOT_AVAILABLE"; }, /policy/],
  ["Git source", f => { f.entry.source.source = "git"; }, /non-local/],
  ["NPM source", f => { f.native.source.type = "npm"; }, /non-local/],
  ["absolute source", f => { f.entry.source.path = f.source; }, /source path/],
  ["different native path", f => { f.native.source.path = f.market; }, /differs/],
  ["version mismatch", f => { f.native.localVersion = "2"; }, /version/],
  ["unsupported metadata", f => { f.plugin.commands = "./commands"; }, /metadata/],
  ["unsupported source metadata", f => { f.entry.source.ref = "moving"; }, /metadata/],
  ["escaping source", f => { f.entry.source.path = ".."; }, /escapes/],
  ["command migration", f => { fs.mkdirSync(path.join(f.source, "commands")); }, /migration/],
  ["cache reuse", f => { fs.mkdirSync(path.join(f.home, "plugins/cache/fixture/sample"), { recursive: true }); }, /fresh/],
]) test(`local plan rejects ${name}`, t => { const f = pluginFixture(t); mutate(f); assert.throws(f.plans, message); });

test("local copy proves installed state with no install/auth/model RPC", async t => {
  const f = pluginFixture(t), [plan] = f.plans(), inventoryFile = path.join(f.root, "inventory.json");
  fs.writeFileSync(inventoryFile, JSON.stringify({ ...f.inventory, marketplaceLoadErrors: [] }));
  const engine = await f.engine("ok", { TEST_INVENTORY: inventoryFile });
  const hash = p => crypto.createHash("sha256").update(fs.readFileSync(path.join(p, ".codex-plugin", "plugin.json"))).digest("hex");
  const results = await engine.materialize(f.home, ["sample@fixture"], new Map([["fixture", f.market]]), {
    directoryHash: hash, copyDirectory: (source, destination) => fs.cpSync(source, destination, { recursive: true }),
  });
  assert.equal(results[0].result.nativeInstalledVerified, true);
  assert.equal(hash(plan.destination), plan.sourceSha256);
  const methods = fs.readFileSync(f.calls, "utf8").trim().split('\n').map(line => JSON.parse(line).method);
  assert(methods.every(method => ["initialize", "initialized", "config/read", "experimentalFeature/list", "plugin/list"].includes(method)));
});

test("local copy rejects changed copied payload before installed validation", async t => {
  const f = pluginFixture(t); f.plans();
  const inventoryFile = path.join(f.root, "inventory.json"); fs.writeFileSync(inventoryFile, JSON.stringify({ ...f.inventory, marketplaceLoadErrors: [] }));
  const engine = await f.engine("ok", { TEST_INVENTORY: inventoryFile });
  await assert.rejects(engine.materialize(f.home, ["sample@fixture"], new Map([["fixture", f.market]]), {
    directoryHash: p => fs.readFileSync(path.join(p, ".codex-plugin", "plugin.json"), "utf8"),
    copyDirectory: (source, destination) => { fs.cpSync(source, destination, { recursive: true }); fs.appendFileSync(path.join(destination, ".codex-plugin", "plugin.json"), " "); },
  }), /changed during materialization/);
});

test("exact selected native engine rejects malformed and unknown typed config", { skip: !process.env.AZRAEL_CONFIG_TEST_ENGINE }, async t => {
  const f = fixture(t), engine = await createEnvironmentEngine(process.env.AZRAEL_CONFIG_TEST_ENGINE);
  await engine.validate(f.home);
  for (const invalid of ['model = ["wrong-type"]\n', 'unknown_environment_adapter_key = true\n', '[features]\nunknown_environment_adapter_feature = true\n']) {
    fs.writeFileSync(path.join(f.home, "config.toml"), invalid);
    await assert.rejects(engine.validate(f.home));
  }
});

test("committed native validation failure rolls back the managed transaction", { skip: !process.env.AZRAEL_CONFIG_TEST_ENGINE || process.platform !== "win32" }, t => {
  const f = fixture(t), source = path.join(f.root, "source"), state = path.join(f.root, "state");
  fs.mkdirSync(source); fs.mkdirSync(path.join(state, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(source, "config.toml"), stringifyToml({ notify: [process.execPath], mcp_servers: { node_repl: { command: process.execPath, env: {
    CODEX_CLI_PATH: process.env.AZRAEL_CONFIG_TEST_ENGINE, NODE_REPL_NODE_PATH: process.execPath, NODE_REPL_NODE_MODULE_DIRS: f.root, NODE_REPL_TRUSTED_CODE_PATHS: f.root,
    NODE_REPL_TRUSTED_SERVICES: "{}", SKY_CUA_NATIVE_PIPE_DIRECTORY: "\\\\.\\pipe\\azrael-config-contract-fixture",
  } } } }));
  fs.writeFileSync(path.join(state, "config.toml"), stringifyToml({ model: "fixture", projects: { [state]: { trust_level: "trusted" } } }));
  // This project layer is encountered only after commit, when the selected
  // native server runs with cwd=state. Staged validation uses its private cwd.
  fs.writeFileSync(path.join(state, ".codex", "config.toml"), 'model = ["invalid typed project config"]\n');
  const manifest = path.join(f.root, "snapshot.json");
  fs.writeFileSync(manifest, JSON.stringify({ schema: 1, config: { rootKeys: ["notify"], tables: ["mcp_servers.node_repl", "mcp_servers.node_repl.env"], tableKeys: {}, protectedRootKeys: ["model"] }, agentRoles: [], generatedAgentRoles: [], personalSkills: [], copyGlobalInstructions: false }));
  const before = fs.readFileSync(path.join(state, "config.toml"), "utf8"), sourceBefore = pathState(source);
  const env = { ...process.env }; delete env.AZRAEL_EX_WINDOW_CONTEXT;
  const result = spawnSync(process.execPath, [path.resolve(__dirname, "../sync-codex-environment.cjs"), "--source-home", source, "--state-root", state, "--engine", process.env.AZRAEL_CONFIG_TEST_ENGINE, "--manifest", manifest, "--mode", "apply"], { env, encoding: "utf8", windowsHide: true, timeout: 60000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /invalid type.*sequence|expected a string/s);
  const backups = path.join(state, "azrael", "codex-environment-backups");
  assert.equal(fs.readdirSync(backups).length, 1, "commit must have begun before native validation rejected it");
  assert.equal(fs.readFileSync(path.join(state, "config.toml"), "utf8"), before);
  assert.equal(fs.existsSync(path.join(state, "azrael/codex-environment/snapshot.json")), false);
  assert.deepEqual(pathState(source), sourceBefore);
});

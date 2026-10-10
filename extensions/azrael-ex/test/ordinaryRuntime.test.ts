import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

function findRuntimeSource(): string {
  let directory = __dirname;
  for (;;) {
    const candidate = path.join(directory, "scripts", "ordinary-runtime.cjs");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error("Could not locate scripts/ordinary-runtime.cjs from the test tree.");
    directory = parent;
  }
}

const runtimeSource = findRuntimeSource();

test("ordinary runtime preserves Windows Path when the host appends bundled tools", () => {
  const fixture = makeRuntimeFixture();
  const inheritedPath = "C:\\Windows\\System32;C:\\custom tools\\bin";
  try {
    for (const key of ["Path", "path", "PATH"]) {
      const sourceEnv = { [key]: inheritedPath };
      const runtimeModule = { exports: {} as any };
      runInNewContext(fs.readFileSync(runtimeSource, "utf8"), {
        require: createRequire(fixture.modulePath),
        module: runtimeModule,
        exports: runtimeModule.exports,
        __filename: fixture.modulePath,
        __dirname: fixture.directory,
        process: { platform: "win32", env: sourceEnv },
      });
      const env = runtimeModule.exports.process.env;
      assert.equal(env.PATH, inheritedPath);
      assert.deepEqual(Object.keys(env).filter(name => name.toUpperCase() === "PATH"), ["PATH"]);
      assert.equal(env.PATH + ";C:\\extension\\bin", inheritedPath + ";C:\\extension\\bin");
      assert.deepEqual(sourceEnv, { [key]: inheritedPath }, "host environment must remain unchanged");
    }
  } finally {
    cleanupRuntimeFixture(fixture.directory);
  }
});

function makeRuntimeFixture(): { directory: string; modulePath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-ordinary-runtime-"));
  const engine = path.join(directory, "codex.exe");
  const bridge = path.join(directory, "azrael-bridge.exe");
  fs.writeFileSync(engine, "fixture");
  fs.writeFileSync(bridge, "fixture");
  fs.copyFileSync(runtimeSource, path.join(directory, "azrael-runtime.cjs"));
  fs.copyFileSync(path.join(path.dirname(runtimeSource), "devin-native-host.cjs"), path.join(directory, "devin-native-host.cjs"));
  fs.copyFileSync(path.join(path.dirname(runtimeSource), "provider-accounts-host.cjs"), path.join(directory, "provider-accounts-host.cjs"));
  fs.copyFileSync(path.join(path.dirname(runtimeSource), "platform-runtime.cjs"), path.join(directory, "platform-runtime.cjs"));
  fs.copyFileSync(path.join(path.dirname(runtimeSource), "azrael-platforms.json"), path.join(directory, "azrael-platforms.json"));
  fs.writeFileSync(path.join(directory, "azrael-runtime.json"), JSON.stringify({
    schema: 1,
    engine,
    bridge,
    engineVersion: "0.157.1",
    codexHome: path.join(directory, "state"),
  }));
  return { directory, modulePath: path.join(directory, "azrael-runtime.cjs") };
}

function cleanupRuntimeFixture(directory: string): void {
  const target = path.resolve(directory);
  const owner = path.resolve(os.tmpdir());
  const relative = path.relative(owner, target);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "fixture must remain within the temporary directory");
  assert(path.basename(target).startsWith("azrael-ordinary-runtime-"), "unexpected fixture directory");
  const assertUnlinked = (entry: string): void => {
    const stat = fs.lstatSync(entry);
    assert(!stat.isSymbolicLink(), "fixture must not contain symbolic links or junctions");
    if (stat.isDirectory()) for (const name of fs.readdirSync(entry)) assertUnlinked(path.join(entry, name));
  };
  assertUnlinked(target);
  const realOwner = fs.realpathSync.native(owner);
  const realRelative = path.relative(realOwner, fs.realpathSync.native(target));
  assert(realRelative && !realRelative.startsWith("..") && !path.isAbsolute(realRelative), "resolved fixture must remain within its owner");
  fs.rmSync(target, { recursive: true });
  assert(!fs.existsSync(target), "fixture cleanup must remove its directory");
}

test("ordinary runtime keeps process.env unchanged and reuses one socket per host", () => {
  const fixture = makeRuntimeFixture();
  const originalCodexHome = process.env.CODEX_HOME;
  const originalSocket = process.env.AZRAEL_EX_MANAGEMENT_SOCKET;
  const originalProviderHelper = process.env.AZRAEL_PROVIDER_ACCOUNTS_HELPER;
  const originalProviderBun = process.env.AZRAEL_PROVIDER_BUN;
  const originalOpencodexHome = process.env.OPENCODEX_HOME;
  try {
    process.env.CODEX_HOME = "unchanged-codex-home";
    process.env.AZRAEL_EX_MANAGEMENT_SOCKET = "unchanged-socket";
    process.env.AZRAEL_PROVIDER_ACCOUNTS_HELPER = "ambient-helper";
    process.env.AZRAEL_PROVIDER_BUN = "ambient-bun";
    process.env.OPENCODEX_HOME = "ambient-opencodex-home";
    const loaded = require(fixture.modulePath);
    const first = loaded.runtime;
    const second = require(fixture.modulePath).runtime;

    assert.strictEqual(first, second);
    assert.equal(first.socket, second.socket);
    assert.equal(first.env.CODEX_HOME, path.join(fixture.directory, "state"));
    assert.equal(first.env.AZRAEL_EX_MANAGEMENT_SOCKET, first.socket);
    assert.equal(process.env.CODEX_HOME, "unchanged-codex-home");
    assert.equal(process.env.AZRAEL_EX_MANAGEMENT_SOCKET, "unchanged-socket");
    assert.equal(first.env.AZRAEL_PROVIDER_ACCOUNTS_HELPER, undefined);
    assert.equal(first.env.AZRAEL_PROVIDER_BUN, undefined);
    assert.equal(first.env.OPENCODEX_HOME, undefined);
    assert.equal(process.env.AZRAEL_PROVIDER_ACCOUNTS_HELPER, "ambient-helper");
    assert.equal(process.env.AZRAEL_PROVIDER_BUN, "ambient-bun");
    assert.equal(process.env.OPENCODEX_HOME, "ambient-opencodex-home");
    assert.notStrictEqual(loaded.process, process);
    assert.strictEqual(loaded.process.env, first.env);
    assert.equal(loaded.process.pid, process.pid);
    loaded.process.env.AZRAEL_PROCESS_PROXY_TEST = "private";
    assert.equal(first.env.AZRAEL_PROCESS_PROXY_TEST, "private");
    assert.equal(process.env.AZRAEL_PROCESS_PROXY_TEST, undefined, "process proxy writes must not mutate the extension host environment");

    if (process.platform === "win32") {
      const drive = path.parse(fixture.modulePath).root.slice(0, 1);
      const alternateDriveCase = `${drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase()}${fixture.modulePath.slice(1)}`;
      const alternate = require(alternateDriveCase);
      assert.strictEqual(alternate.runtime, first, "drive-letter case variants must share one host runtime");
      assert.strictEqual(alternate.process, loaded.process, "drive-letter case variants must share one process proxy");
      assert.equal(alternate.runtime.socket, first.socket);
    }

    const childSocket = execFileSync(process.execPath, ["-e", "process.stdout.write(require(process.argv[1]).runtime.socket)", fixture.modulePath], {
      encoding: "utf8",
      env: { ...process.env },
    });
    assert.notEqual(childSocket, first.socket, "separate extension hosts must receive distinct sockets");
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    if (originalSocket === undefined) delete process.env.AZRAEL_EX_MANAGEMENT_SOCKET;
    else process.env.AZRAEL_EX_MANAGEMENT_SOCKET = originalSocket;
    if (originalProviderHelper === undefined) delete process.env.AZRAEL_PROVIDER_ACCOUNTS_HELPER;
    else process.env.AZRAEL_PROVIDER_ACCOUNTS_HELPER = originalProviderHelper;
    if (originalProviderBun === undefined) delete process.env.AZRAEL_PROVIDER_BUN;
    else process.env.AZRAEL_PROVIDER_BUN = originalProviderBun;
    if (originalOpencodexHome === undefined) delete process.env.OPENCODEX_HOME;
    else process.env.OPENCODEX_HOME = originalOpencodexHome;
    cleanupRuntimeFixture(fixture.directory);
  }
});

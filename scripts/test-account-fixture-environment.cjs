const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const autoSwitchOnly of [false, true]) {
  test(`synthetic ${autoSwitchOnly ? 'ordinary auto-switch' : 'host account'} route isolates inherited selection files and window context`, async () => {
    const { accountFixtureEnvironment } = await import('./account-fixture-environment.mjs');
    const inherited = Object.freeze({
      CODEX_HOME: 'user-home',
      AZRAEL_EX_MANAGEMENT_SOCKET: 'user-socket',
      AZRAEL_EX_ACCOUNT_STATE_FILE: 'user-window-selection',
      AZRAEL_EX_ACCOUNT_DEFAULT_FILE: 'user-default-selection',
      AZRAEL_EX_WINDOW_CONTEXT: 'user-window-context',
      PATH: 'existing-tool-path',
    });
    const fixture = accountFixtureEnvironment(inherited, {
      stateDirectory: 'disposable-home', socketPath: 'disposable-socket',
      baseUrl: 'http://127.0.0.1:12345', autoSwitchOnly,
    });
    assert.equal(fixture.CODEX_HOME, 'disposable-home');
    assert.equal(Object.hasOwn(fixture, 'AZRAEL_EX_ACCOUNT_STATE_FILE'), false);
    assert.equal(Object.hasOwn(fixture, 'AZRAEL_EX_ACCOUNT_DEFAULT_FILE'), false);
    assert.equal(Object.hasOwn(fixture, 'AZRAEL_EX_WINDOW_CONTEXT'), false);
    assert.equal(fixture.AZRAEL_EX_MANAGEMENT_SOCKET, autoSwitchOnly ? undefined : 'disposable-socket');
    assert.equal(fixture.CODEX_REFRESH_TOKEN_URL_OVERRIDE, 'http://127.0.0.1:12345/oauth/token');
    assert.equal(fixture.CODEX_REVOKE_TOKEN_URL_OVERRIDE, 'http://127.0.0.1:12345/oauth/revoke');
    assert.equal(fixture.HTTPS_PROXY, 'http://127.0.0.1:12345');
    assert.equal(fixture.PATH, inherited.PATH);
    assert.equal(inherited.AZRAEL_EX_ACCOUNT_STATE_FILE, 'user-window-selection');
    assert.equal(inherited.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, 'user-default-selection');
    assert.equal(inherited.AZRAEL_EX_WINDOW_CONTEXT, 'user-window-context');
    assert.equal(inherited.AZRAEL_EX_MANAGEMENT_SOCKET, 'user-socket');
  });
}

for (const autoSwitchOnly of [false, true]) {
  test(`startPair shares the isolated engine environment with its bridge (auto-switch=${autoSwitchOnly})`, async () => {
    const { accountFixtureEnvironment } = await import('./account-fixture-environment.mjs');
    const source = fs.readFileSync(path.join(__dirname, 'check-accounts.mjs'), 'utf8');
    const start = source.indexOf('async function startPair(label) {');
    const end = source.indexOf('\nasync function stopPair(pair)', start);
    assert(start >= 0 && end > start);
    const inherited = Object.freeze({ CODEX_HOME: 'user-home', AZRAEL_EX_WINDOW_CONTEXT: 'user-window',
      AZRAEL_EX_ACCOUNT_STATE_FILE: 'user-selection', AZRAEL_EX_ACCOUNT_DEFAULT_FILE: 'user-default', PATH: 'tool-path' });
    const stateDirectory = path.resolve('disposable-home');
    const launches = [];
    const context = {
      process: { env: inherited }, accountFixtureEnvironment, pairNumber: 0,
      stateDirectory, socketPath: 'disposable-socket', backend: { baseUrl: 'http://127.0.0.1:12345' },
      autoSwitchOnly, accountControlsOnly: !autoSwitchOnly, standaloneAppServer: false,
      enginePath: 'engine-fixture', bridgePath: 'bridge-fixture', fixtureModel: 'model-fixture', fixtureModelsPath: 'models-fixture',
      stderrSections: [], stderrCapture() {}, resolve: path.resolve,
      spawn(executable, args, options) { const child = {}; launches.push({ executable, args, options, child }); return child; },
      JsonLinePeer: class {
        async request() {}
        notify() {}
        async notification() { return { codexHome: stateDirectory, serverVersion: 'fixture' }; }
      },
      async stopChild() { throw Error('Unexpected synthetic launch failure'); },
    };
    await vm.runInNewContext(source.slice(start, end) + '\nstartPair("environment regression")', context);
    assert.equal(launches.length, autoSwitchOnly ? 1 : 2);
    const environment = launches[0].options.env;
    assert.notEqual(environment, inherited);
    assert.equal(environment.CODEX_HOME, stateDirectory);
    assert.equal(Object.hasOwn(environment, 'AZRAEL_EX_WINDOW_CONTEXT'), false);
    assert.equal(Object.hasOwn(environment, 'AZRAEL_EX_ACCOUNT_STATE_FILE'), false);
    if (!autoSwitchOnly) {
      assert.equal(launches[1].executable, 'bridge-fixture');
      assert.equal(launches[1].options.env, environment);
      assert.equal(environment.AZRAEL_EX_MANAGEMENT_SOCKET, 'disposable-socket');
    }
    assert.equal(inherited.AZRAEL_EX_WINDOW_CONTEXT, 'user-window');
    assert.equal(inherited.CODEX_HOME, 'user-home');
    assert.equal(inherited.AZRAEL_EX_ACCOUNT_STATE_FILE, 'user-selection');
    assert.equal(inherited.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, 'user-default');
  });
}

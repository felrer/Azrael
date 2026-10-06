const assert = require('node:assert/strict');
const { test } = require('node:test');

for (const autoSwitchOnly of [false, true]) {
  test(`synthetic ${autoSwitchOnly ? 'ordinary auto-switch' : 'host account'} route isolates inherited selection files`, async () => {
    const { accountFixtureEnvironment } = await import('./account-fixture-environment.mjs');
    const inherited = Object.freeze({
      CODEX_HOME: 'user-home',
      AZRAEL_EX_MANAGEMENT_SOCKET: 'user-socket',
      AZRAEL_EX_ACCOUNT_STATE_FILE: 'user-window-selection',
      AZRAEL_EX_ACCOUNT_DEFAULT_FILE: 'user-default-selection',
      PATH: 'existing-tool-path',
    });
    const fixture = accountFixtureEnvironment(inherited, {
      stateDirectory: 'disposable-home', socketPath: 'disposable-socket',
      baseUrl: 'http://127.0.0.1:12345', autoSwitchOnly,
    });
    assert.equal(fixture.CODEX_HOME, 'disposable-home');
    assert.equal(Object.hasOwn(fixture, 'AZRAEL_EX_ACCOUNT_STATE_FILE'), false);
    assert.equal(Object.hasOwn(fixture, 'AZRAEL_EX_ACCOUNT_DEFAULT_FILE'), false);
    assert.equal(fixture.AZRAEL_EX_MANAGEMENT_SOCKET, autoSwitchOnly ? undefined : 'disposable-socket');
    assert.equal(fixture.CODEX_REFRESH_TOKEN_URL_OVERRIDE, 'http://127.0.0.1:12345/oauth/token');
    assert.equal(fixture.CODEX_REVOKE_TOKEN_URL_OVERRIDE, 'http://127.0.0.1:12345/oauth/revoke');
    assert.equal(fixture.HTTPS_PROXY, 'http://127.0.0.1:12345');
    assert.equal(fixture.PATH, inherited.PATH);
    assert.equal(inherited.AZRAEL_EX_ACCOUNT_STATE_FILE, 'user-window-selection');
    assert.equal(inherited.AZRAEL_EX_MANAGEMENT_SOCKET, 'user-socket');
  });
}

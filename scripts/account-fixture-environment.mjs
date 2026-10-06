export function accountFixtureEnvironment(environment, { stateDirectory, socketPath, baseUrl, autoSwitchOnly }) {
  const fixture = {
    ...environment,
    CODEX_HOME: stateDirectory,
    AZRAEL_EX_MANAGEMENT_SOCKET: socketPath,
    CODEX_REFRESH_TOKEN_URL_OVERRIDE: `${baseUrl}/oauth/token`,
    CODEX_REVOKE_TOKEN_URL_OVERRIDE: `${baseUrl}/oauth/revoke`,
    HTTPS_PROXY: baseUrl,
    ALL_PROXY: baseUrl,
    NO_PROXY: '127.0.0.1,localhost',
  };
  // Every synthetic route owns its selection files inside the disposable home.
  delete fixture.AZRAEL_EX_ACCOUNT_STATE_FILE;
  delete fixture.AZRAEL_EX_ACCOUNT_DEFAULT_FILE;
  if (autoSwitchOnly) delete fixture.AZRAEL_EX_MANAGEMENT_SOCKET;
  return fixture;
}

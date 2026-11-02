# Azrael desktop source app

Status: Windows x64 source-app fixture verified in light and dark themes.
Live-account and distribution acceptance remain separate.

This Electron host loads the existing prepared Azrael UI and native engine. It
adds a read-only text panel and an interactive terminal. It does not build a
second chat or history implementation. The [architecture contract](../../docs/architecture/standalone-app.md)
and [work record](../../work/FG-01-standalone-app-ui-research/01-plan.md) distinguish
implemented source from verified behavior.

## Source execution

Use an existing prepared Azrael host directory containing `package.json`,
`integrated-azrael-entry.cjs`, `out/azrael-runtime.cjs`, its engine, and webview
assets. The app does not modify that directory. It is not a distributable app
package yet.

```powershell
cd apps/azrael-desktop
npm.cmd ci
node node_modules/electron/install.js
npm.cmd start -- --host C:/path/to/prepared-azrael --workspace C:/path/to/workspace
```

`--state` selects app-specific UI storage. Otherwise Electron's per-user app
storage is used. The prepared runtime remains the owner of engine state and
account policy; choosing app UI storage does not migrate accounts or conversations.
`--theme light`, `--theme dark` and `--theme system` select presentation.

Open text files with **파일 열기** or the existing conversation file links. The
panel shows literal Markdown/code, supports reload and line navigation, and never
writes the document. **터미널** starts PowerShell through the native engine's PTY
API using its configured execution policy. Hiding the panel preserves its
session; **종료** terminates it.

## Diagnostics and verification

App diagnostics are in `<state>/logs/desktop.ndjson`, rotated at 4 MiB with one
previous file. Renderer/host diagnostics may include workspace paths; do not
publish raw logs without reviewing their contents.

`node verify.cjs --host C:/path/to/prepared-azrael --theme both` uses a task-owned
profile and synthetic ChatGPT credentials. It never submits a model turn. It records
actual Electron exit and renderer results under the project's artifact lifecycle.
Its test state uses a shorter `artifacts/dt/<unique>` path because Windows AF_UNIX
socket addresses have a fixed length. A failed or pending run is not acceptance;
its native descendants must be verified stopped before owner-based cleanup.
The fixture backend runs in a separate Worker on a loopback-only ephemeral port.
Test-only request guards redirect the original host's localhost API there and
reject external HTTP. Both themes exercise draft input/clearing without sending,
the existing empty chat history, dialogs, literal text, native images and PTY.
The terminal fixture uses PowerShell without loading user profiles; production
keeps normal shell startup. Earlier captures behind the login screen are not
acceptance. A rendered synthetic session does not verify live login or model use.
The verified run includes actual draft typing/clearing, an empty history response,
PTY keyboard input/output, frontend resize, hidden output retention, explicit close
and normal application exit. The existing Windows setup card remains visible;
its wizard and model execution were not exercised.

Linux/macOS execution, distribution packaging, installation and live account
login acceptance remain separate from Windows source-app verification.

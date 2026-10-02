# azrael-ex

azrael-ex is a stability-first Visual Studio Code extension for Pi coding sessions. It provides a sandboxed chat Webview, ordered tool activity, explicit tool approval, safe Markdown, workspace citations, and read-only inline command output.

## Workspace-bound sessions

**azrael-ex: Open Chat** binds each new session to exactly one open local (`file:`) VS Code workspace folder. The folder is selected in this order: the active editor's folder, the only open local folder, the previously remembered folder URI, then a native QuickPick for an ambiguous multi-root window. Empty windows and remote/virtual workspace URIs are rejected.

The selected folder is resolved to its filesystem realpath and receives an opaque `workspaceId`. A live panel is keyed by the immutable `workspaceId + sessionId`; changing the active editor never moves an existing session. Relative file links and the Pi execution `cwd` use that same binding. Before a persisted Pi JSONL session is opened, its header `id` and `cwd` are checked against the panel binding.

Workspace metadata is host-only in VS Code `workspaceState`; the Webview persists only opaque workspace/session identities. New Pi session data is stored beneath the extension's `globalStorageUri/sessions/<opaque-workspace-session-key>` directory, while legacy session directories remain readable in place. A profile-scoped Session Broker owns the Core process and session-specific Pi Hosts running on the packaged pinned Node runtime; the Extension Host attaches panels to that broker and keeps only the VS Code-facing authentication, catalog, and UI coordination surfaces.

Untrusted workspaces have limited support. azrael-ex will not create a live session, send a prompt, load project resources, or approve tools until the workspace is trusted. Removing the bound folder or revoking trust fails closed and does not rebind the session to another folder. `azrael-ex.development` keeps the deterministic UI fixture on a separate command and runtime path.

## Local development

```powershell
npm install
npm run build
```

Press `F5` from this folder using an Extension Development Host configuration, then run **azrael-ex: Open Chat**.

The production command requires a trusted local workspace. Authentication is implemented and documented separately from workspace binding.

The extension does not patch VS Code chrome, execute links inside the Webview, expose raw tool payloads, or provide an interactive terminal.

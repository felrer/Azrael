# Azrael standalone app

Status: `partial`. The Windows source host, read-only panel, native PTY bridge and reused image overlay are implemented and accepted in an isolated synthetic fixture in light/dark themes. Live-account, populated-history and distribution acceptance remain separate in the [work record](../../work/FG-01-standalone-app-ui-research/01-plan.md).

## Scope and presentation

The standalone application connects to the existing Azrael engine and preserves the existing chat/composer behavior and OpenAI-style presentation. It reuses **채팅 기록** for conversation navigation and state rather than creating a separate session index. Existing questions, approvals, queues, account/provider state and recovery retain their owners. The [UI presentation contract](ui-presentation.md) owns common appearance and interaction.

The central conversation is complemented by a detail panel opened on demand. The panel contains a read-only text viewer for `.txt`, `.md`, source code and other text files, plus an interactive terminal. Markdown is viewed as text. It does not execute document HTML or enable editing. The existing Codex image viewer is reused; a second image-viewer implementation is outside this scope.

New diff/PR review, artifact management, browser panes, free docking, detached windows, full IDE editing and new scheduling/remote-handoff UI are deferred. This does not retire existing Azrael behavior.

## Detail panel

Opening a text file displays its resolved path and literal text. Later file selections take precedence over older pending reads. Failed reads remain visible as errors. Reload reads the same file again; the viewer never writes it. Line/column links may focus the corresponding text location. Binary content and unsupported encodings produce an explanatory error instead of corrupted or executable content.

The terminal accepts keyboard input, streams output, and follows panel dimensions through its host transport. Hiding the panel preserves its session. Explicit terminal termination and application disposal release that session. Terminal exit and transport failure are distinct visible outcomes. A panel close is not an instruction to interrupt an agent turn.

The renderer receives bounded host methods for reading a file and creating, writing, resizing and closing its terminal. The host owns OS operations and terminal lifetime; the document renderer receives no Node.js or shell execution API. Arbitrary text is assigned as text rather than inserted as HTML.

## Host and platform boundaries

The initial standalone implementation and native acceptance target is **Windows x64**. Shared UI structure remains portable; Linux x64 and macOS ARM64 standalone acceptance are subsequent work. The existing [multi-platform contract](multi-platform.md) continues to own the extension's support matrix and is not evidence of standalone support.

The current pinned renderer requires its host RPC, initialization state, local assets, theme and storage services. Its reused conversation/history/image paths must actually execute in the new host before reuse is accepted. The host must preserve engine identity, private state, window registration and recovery under the [runtime contract](azrael-runtime.md). A management-only account bridge cannot substitute for the chat connection.

The work record owns unresolved host implementation choices, actual protocol evidence and verification. Choosing a framework or adding an adapter cannot silently change permissions, create duplicate execution owners or migrate account/conversation data.

The standalone host gives each app window its own native window registration and account-selection files. It clears inherited launcher window/management/account-selection environment before registering that window. Its terminal uses the same engine startup configuration and window context as the existing chat host. Account capture used for isolated tests is not a production startup operation.

Startup reuses the integrated host's [incompatible-engine admission and dialog](azrael-runtime.md#비호환-엔진-시작-안내) before initializing chat or account connections. Explicit retry runs a fresh native check. Dismissing the dialog stops this app, without another generic error dialog or terminating existing engines or VS Code windows. The existing engine version is shown as unavailable when its storage lease contains no version information.

The host supplies the existing renderer's theme inputs through one owned stylesheet and the native body theme attribute. The renderer retains its own palette and theme state. During shutdown the host releases terminal connections, ends its native proxy input and flushes UI state, then exits. Native window leases observe that host identity ending; the host must not wait for the dependent proxy before exiting. Verification separately checks the private native shutdown identity and process tree.

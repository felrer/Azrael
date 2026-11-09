# Conversation Input drafts

<!-- architecture: {"id":"arch.conversation-input.drafts","feature":"conversation-input","layers":["ui","host"]} -->

## New-chat drafts

Status: `current` in source — pinned host persistence checks on Windows; packaging and installed-window acceptance pending.

Unsent new-chat drafts on the home screen and in new-chat panels are saved separately by the host's workspace project ID. Reopening the same project restores its draft; another project has its own draft. Windows without a project use a separate projectless scope. Existing conversation drafts retain their native conversation identity. This is shared host behavior for Windows, Linux and macOS; native Linux/macOS acceptance is unverified.

The native composer and persisted-record merge remain in use. Initial synchronization, later broadcasts and draft writes resolve the workspace through the provider's `fetchWrapper.extensionFetchHandler.getWorkspaceProject()`; the webview provider does not own that method. Initial synchronization includes other persisted preferences, so this owner boundary also preserves session flag restoration. Initial synchronization and later broadcasts expose only the current project's new-chat entries. Old global new-chat drafts remain stored but are not restored because their project ownership is unknown. Legacy conversation drafts still migrate through the native store. No input is submitted by saving or restoring a draft.

### Submitted draft custody

Status: `current` in source; Windows pinned-function fixtures cover submission and persistence. Installed-window and Linux/macOS acceptance remain separate in [the work record](../../../../work/CQ-01-sent-draft-restoration-diagnosis/01-plan.md).

After successful submission, the composer consumes the submitted text from the editor and its saved draft so revisiting the session restores only unsent work. Document-change tracking distinguishes new typing, including retyping the same text, from selection, attachment, automatic-context and saved-metadata changes. When only those other states change before clearing, the composer clears the submitted text while preserving the changed state. Saved cleanup uses conditional record updates, matches the submitted persisted prompt and preserves changed non-text draft fields; it cannot overwrite a different saved prompt. A successful release prevents the native retained-draft watcher from re-inserting a saved prompt into the editor. A newer typed or saved draft remains protected, including typing before persistence completes. Failed submissions retain their retry draft; restoring into the visible editor still requires ownership of its complete editable state. Document subscriptions are released at submission termination. These shared webview semantics apply to Windows, Linux and macOS. Preservation feature: `ui.composer-draft`. The [fix record](../../../../work/FJ-01-sent-request-composer-analysis/01-plan.md) distinguishes source verification from installed acceptance.

### Session creation at submission

Status: `partial` — source creation/admission fixtures and native composer-effect rendering pass on Windows in both themes. Packaging, installed-window resume and native Linux/macOS acceptance remain separate.

Editing or restoring a new-chat draft keeps the project-scoped persisted draft and creates no native session. Text entry, deletion, paste, attachment changes, model changes and navigation retain the existing draft ownership. The shared thread-creation boundary releases unused prewarm input readers without preparing or starting a thread. Local and cloud-prototype composer prewarming use this boundary. A valid first submission uses the native conversation creation and request admission flow, including current model and permission settings, draft custody, failure handling and pending submission identity. Creating the session at submission adds its preparation time to the first send.

Existing conversations, queued requests and submitted pending conversations retain their native list and resume behavior. A blank title or preview does not identify an unsent session. Stored user conversations are preserved; ambiguous existing entries are not automatically hidden or deleted. The preservation inventory connects this boundary through `ui.submit-only-thread`, alongside `ui.project-drafts` and `ui.composer-draft`.

# Conversation Input session flags

<!-- architecture: {"id":"arch.conversation-input.session-flags","feature":"conversation-input","layers":["ui","host","engine"]} -->

## Session flags

Status: `current` in source — native row rendering and interactions verified in light and dark themes; build and installation pending.

Local sessions in the recent-chat menu and the new-chat screen's recent-chat preview have a Flag toggle immediately before the time or native hover actions, with extra spacing before Archive. Unset flags show only an outlined flag, without a button background or tile border, when the row is hovered or contains keyboard focus. The button sits above the native trailing action rail so the whole visible icon receives pointer input, including its right edge. Keyboard focus retains its visible outline. Set flags show a filled red flag even without hover. Clicking again clears the flag; flag actions do not navigate, close the menu or archive the session.

The chat-type dropdown contains a persisted **Flagged only** checkbox item beneath All chats, Cloud chats and Local chats. It combines with the existing type, environment and title-search filters while preserving native ordering. Saved local conversations with a matching host and conversation flag are included, along with the currently open local conversation even when it is unflagged. Its current identity follows the native active-row route, including a pending local thread with that identity. Other cloud and pending items without a saved conversation are excluded. Clearing a flag immediately removes a non-current row from the filtered list; the current row remains visible without acquiring a flag. The preview shares the same flags and updates immediately.

Flags use the native persisted UI preference store, keyed by host and conversation ID. They preserve menu ordering and other hosts' flags. Restoring this store shares the project's draft synchronization path; its native method ownership is covered by `scripts/test-project-drafts.cjs` as well as the flag behavior checks. The button exposes its pressed state and supports keyboard activation. Native time, running indicators and Archive keep their existing behavior.

`scripts/verify-session-flags-render.mjs` exercises the production Flag helper with the pinned native React, preference atom, row components and CSS. Host services and localization are synthetic; installed VS Code and real host persistence remain separate checks.

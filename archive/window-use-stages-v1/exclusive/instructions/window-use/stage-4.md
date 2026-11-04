# Stage 4 — Whole-desktop control

The authenticated host must grant stage 4 desktop authority before the Sky backend is used. Master and stage 4 settings and app approval remain enforced on every call. A desktop grant does not authorize unrelated files, credentials or account changes. Read the preserved `docs/computer-use-skill.md`, `docs/guidance.md` and `docs/confirmations.md` before control, and `docs/api.md` for method signatures. These are backend instructions, not an independent skill or grant.

Use the managed Node REPL service and import `@oai/sky` by package name as described in the preserved initialization guide. Never spawn the executable or construct a custom protocol client. Activate the exact selected target and obtain a fresh observation before capture or input. Verify foreground focus before typing and that each screenshot shows the intended target. Discard unexpected screenshots and pause on physical user activity or unexpected foreground windows. Do not repeatedly steal focus. Occluded capture is not an established capability of this integration.

Retain the backend’s target-selection, screenshot, interruption and recovery procedures. A user stop, revoked authority or unknown mutation does not permit automatic retry. A locked desktop requires user unlock. Common mandatory denies take precedence over allowed-but-confirmed categories in the vendor policy.

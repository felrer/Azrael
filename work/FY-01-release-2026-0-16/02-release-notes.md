# Azrael 2026.0.16 — Windows x64

Verified local build: `win016-ez01-paint-r8-20261102`. This release packages the existing 2026.0.16 engine and integrated VS Code host; it does not include the later 2026.0.17 or 2026.0.18 work.

## Installation

Download `Azrael-2026.0.16-windows-x64.zip`, verify it against `SHA256SUMS.txt`, extract it, and follow the included `README.txt` / `install.ps1`. VS Code is required. Existing account and conversation state is preserved. The installer refuses an occupied destination and does not close or reload your windows.

## Scope and known limitations

- Windows x64 distribution only. Existing Linux/macOS releases are unchanged.
- Legacy redistribution: this exact 2026.0.16 engine does not expose the newer built-in maintenance CLI. It does not provide the newer maintenance installation/capability workflow.
- Includes the selected Window Use virtual-input implementation. Actual virtual drawing/text input in modern Microsoft Paint was not accepted; do not assume support for that application or all desktop apps.
- Source/engine and isolated exact-host acceptance for this build are recorded separately from live-provider and clean-machine testing. Full upstream regression acceptance is not claimed.
- Third-party redistribution evidence gaps are listed in the included provenance and README.

## Provenance

The GitHub tag identifies existing repository commit `e9bbdc4441abbf1975a6c8019240a96c5e88b4eb`; it is not a claim that all binary source bytes are represented by that commit. `release-manifest.json` records the exact build fingerprint and binary hashes. The original verified host VSIX SHA-256 is `31f709fe57d95083f04395903fb624a6c4fee8f213ad583b3b957c781d52f7da`.


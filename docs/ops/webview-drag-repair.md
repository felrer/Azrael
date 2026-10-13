# Webview drag repair

The repair tool handles the desktop host's pointer-event state remaining disabled after a drag terminates. The composer preparation transform separately clears stale drag indicators. Full gray-screen failures, renderer crashes and actual conversation-card acceptance require their own evidence; this repair does not certify those symptoms.

The tool is independent of Azrael packaging and does not automatically alter the installed editor. Its guarded monitor transformation is verified against Windows VS Code 1.138.0 and 1.140.0 source; native execution evidence is a copied Windows 1.138.0 host. Other versions require a compatibility check and isolated native acceptance. Linux/macOS application is refused.

1. Select the exact `resources/app/out/vs/workbench/workbench.desktop.main.js` under the intended VS Code host. Some Windows installations put `resources` inside a version-named directory.
2. Run the read-only check: `node scripts/patch-vscode-webview-drag.cjs --workbench <absolute-bundle-path>`.
3. With authorization to modify that host, close its windows and run the same command with `--apply`. The tool refuses an active selected host or pre-existing recovery files. Keep the adjacent `.azrael-drag-original` and `.azrael-drag-receipt.json` together. It verifies the written SHA256 and preserves the complete original bundle.
4. Start the selected host. Test text, HTML, links and saved file references dropped on the modal title/outside the composer; immediately click inside the Webview without relying on an intervening mousemove. Verify ordinary attachment drops, Shift behavior, cancellation, nested region movement and more than one Webview. Source tests are `node --test scripts/test-webview-drag.cjs scripts/test-local-file-drop.cjs`.
5. To revert, close that host and use the same command with `--restore`. The host and backup must still match the receipt. Preserve recovery files until the restoration and application state are verified. An editor update can replace the bundle; the tool refuses to restore the old bundle over a changed version.

The modified Windows 1.138.0 isolated host displays VS Code's installation-integrity warning. The tool intentionally preserves product configuration and checksums, rather than hiding that modification. This is a material limitation of local host repair; an upstream host fix is preferable to treating the bundle patch as a normal extension update. If application is interrupted or recovery files disagree, inspect the recorded paths and hashes; do not overwrite a newer host or delete the recovery copy to force reapplication.

Use an isolated host copy/profile/extensions directory and synthetic content for repeated native verification. Keep user credentials and conversations out of the fixture, retain results/screenshots in `artifacts/logs/`, and clean the stopped fixture through the build playbook. Source behavior, native host behavior and installed Azrael acceptance are separate gates.

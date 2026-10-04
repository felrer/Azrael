# Selected-window native acceptance fixture

This harness validates the native component through the real Azrael backend and policy modules.
Installed VS Code profile/host end-to-end acceptance is separate and belongs to root.

Compile only, with no GUI or native desktop operation:

```powershell
./scripts/test-selected-window-native.ps1 -CompileOnly
```

After explicit root GO, with a freshly recorded read-only desktop baseline and unique artifacts path:

```text
node scripts/test-selected-window-native.cjs --go --receipt <absolute final-candidate-receipt.json> --baseline <absolute desktop-state.json> --artifacts <new absolute directory>
```

The receipt's exact release supplies the manifest-verified native executable. The fixture is a compiled
WinForms application using installed .NET Framework libraries; it starts without activation, initially
minimized. Commands are cooperatively dispatched on its UI thread through token-protected stdin JSON.
Only its exact HWND/PID/process creation/executable identity can receive native targeted operations.
The native list operation and baseline helper are read-only. Every native operation compares baseline
foreground, cursor visibility/position, last input tick, and existing Code process/window identities.
Any change aborts further acceptance operations. No physical input, focus restoration, cursor change,
system setting, or user Code mutation is available in this harness.

An owned nonactivating occluder covers only the fixture's ticking colored canvas. Saved PNGs are the
selected HWND capture only. Fixture image inspection reads those files and decodes its drawn binary
counter, verifies its canvas colors, and rejects occluder pixels. UIA capabilities report unsupported
when the exact fixture element/pattern is not exposed; exposed patterns must produce actual fixture
effects. Coverage includes first minimized restore, later minimize/pause/resume, policy/native stale IDs,
real bounded resize macro and Stop cancellation after the first delivered native resize. Cancellation
does not promise rollback of the already delivered resize.

Cleanup sends the fixture's authenticated shutdown command. It never force-kills the fixture or Code.
A fixture that cannot exit cooperatively is reported and left running. Backend disposal uses the existing
owned-child lifecycle module. Evidence and selected-window PNGs stay in the supplied artifact directory.
Baseline helper invocations can take several seconds; any user input during that interval aborts the run.

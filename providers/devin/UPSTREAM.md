# Vendored Devin cloud-direct transport

This directory contains the minimum local import closure needed for the Devin
cloud-direct Connect-RPC transport from
[`lidge-jun/opencodex`](https://github.com/lidge-jun/opencodex), pinned to commit
`9f7397ed1582d95c6c1fcf4ae9951213b3fa2d19` (2026-09-14).

The runtime entry point is
`vendor/src/adapters/devin/cloud-direct/chat.ts`. Its transitive local imports
are `metadata.ts`, `auth.ts`, `catalog.ts`, `wire.ts`, `src/lib/abort.ts`, and
`src/oauth/devin/api-base.ts`. `cloud-direct/index.ts` is retained as the
original public export surface and contains the complete embedded MIT notice
for `rsvedant/opencode-windsurf-auth`, from which the cloud-direct files were
derived. Credential access is implemented by the existing native Devin owner;
opencodex browser OAuth and credential stores are not imported.

The opencodex project MIT license is preserved as `LICENSE.opencodex`.
Copyright and license headers in the cloud-direct sources are preserved.

## Source integrity

Hashes below are SHA-256 over the exact LF-normalized file content in the
pinned Git commit. The Git blob column is the commit's exact object ID.

| Upstream path | Git blob | Upstream SHA-256 | Vendored SHA-256 |
| --- | --- | --- | --- |
| `src/adapters/devin/cloud-direct/auth.ts` | `4aa4e02a579037d1d680636cffa59c8b610aac35` | `e242e467e6b19d11a604a796518b1acc9f6bc241f88fd6772beb591f16fb13da` | `6ea27359cab10590bc4cf23ba86082d64c15aaba5cebea551e6cc247e6bce6d6` |
| `src/adapters/devin/cloud-direct/catalog.ts` | `f7638d16607e728d70475f2f36f401e1dd107dd8` | `68b53afffd3b75b7bdf4773e957c01df7da1816e7377edb675a36178f8f3a2b0` | `df93a9569f73d99df00adc4deb436d1dd73ac511e3c5d540902eb66d0787363d` |
| `src/adapters/devin/cloud-direct/chat.ts` | `294d6ea84334acb98d4629bc5aa4dbb153cd631e` | `3c785735379fb4c6877567717b6e459fb4f600d15db5f1d307be274ca976e71e` | `486e208528382cbb813675b8c369e0a98475b29440585352a59c430f149fc8a8` |
| `src/adapters/devin/cloud-direct/index.ts` | `98dfcea9de2f2e6361bb62e41ccf701e71a52d4a` | `777f47bd056016004239613b20e496066a4784226fc149cfc51b6876f74c5881` | `1c2a70b7495169fc12b1d38a33c2bab17c62b6674f7eda7a93a530391ad74c1f` |
| `src/adapters/devin/cloud-direct/metadata.ts` | `7f7499c2bc9ac35dff970e987dd3dc41a02451e9` | `c9d3555b620d637cf66cbe90ab1da542ba65c0929e7767c8b5d222f419da5164` | `7716ea754a3e4a44f6849c9559f6bab30a0378d6ffa0b546582381e8d122772e` |
| `src/adapters/devin/cloud-direct/wire.ts` | `cc8b732eb1484bbc65454a51834f3040f782ec9c` | `e7d6496aa0e10a55804b44796d87fccefdfb84d8cf999257cf4a56e9b9d51977` | `bb83a6e6b7ed0cf82e87741a4669865671fea1b79f6f67403f633b72e5ed7410` |
| `src/lib/abort.ts` | `79f638e8115d8ee6e35be49aa0cf3da211587c66` | `9ae6d9c51033c534f9f6b34777bc114dddbcd0b544db2555872cc8c525f1766b` | `9ae6d9c51033c534f9f6b34777bc114dddbcd0b544db2555872cc8c525f1766b` |
| `src/oauth/devin/api-base.ts` | `684ed632cec926e110f0a58f9cd6c4b0bdda8294` | `2126e88e9d866b04cc35861705139f31fc2a1ab4994ef88771cf52b870a686a0` | `2126e88e9d866b04cc35861705139f31fc2a1ab4994ef88771cf52b870a686a0` |
| `LICENSE` | `b034f41c97718c48889f7d3c2123533b341fd3ce` | `34012a5529ad1e574e84457a609f9ea3df03c63d7c42c7e5f74ec14f438ed346` | same as upstream |

## Local patches

The import patches replace relative `.js` import specifiers with `.ts` in
`auth.ts`, `catalog.ts`, `chat.ts`, `metadata.ts`, and `index.ts`. This lets the pinned Node
runtime load the source tree directly with TypeScript stripping while keeping
the original directory layout. On 2026-09-18, `decodeChatFrame` was also changed
to emit a frame's finish event after its content, regardless of protobuf field
order. This prevents a same-frame final tool delta or signature from appearing
after the terminal event. Later-frame content and incomplete streams still fail.
The follow-up structural live capture reproduced GPT-6 Astra Low returning text
and a clean Connect EOS without field 5. The transport now validates EOS JSON,
rejects post-EOS data and incomplete framing, and supplies one finish event for
visible text/tool calls only when no explicit finish was received. Explicit
incomplete reasons and cancellation are not overridden; tool argument validation
remains in the native mapper. Deterministic fixtures live in
`tests/decoder.test.mjs` and `tests/transport.test.mjs`.
The inference decoder opts into strict protobuf framing in `wire.ts`, including
eager field validation before consumers can stop iteration. Catalog/auth retain
their existing parsing mode. Explicit StopReason ERROR fails. Cancellation uses
the locked reader rather than cancelling its locked body, with listener cleanup
on all exits. These changes prevent corrupt frames or cancellation from being
mistaken for successful EOS completion.

Native integration follow-up (2026-09-18): `chat.ts` exposes an optional
`skipCatalogPreflight` for engine-resolved models; it defaults to false for
other callers. The native helper sets it because it is a fresh process for
every inference and cannot reuse the vendor's in-memory catalog. Server
authorization failures still propagate. The local transport also reports only
phase, byte count and decoded event kind through `onProgress`, and distinguishes
header and stream idle errors. The helper sends bounded progress frames and an
absolute request deadline independently of buffered executable tool output.
These are local integration changes, not claims about upstream behavior.

Provider HTTP failures and Connect error trailers retain separately typed
diagnostics from the original response before user-facing message enrichment.
`errors.ts` reduces codes and anchored message templates to fixed safe enums,
and accepts only complete lowercase hexadecimal trace IDs of 16–64 characters.
The helper revalidates each optional field before forwarding it. Raw messages,
bodies, URLs and stacks remain outside the helper boundary; local exceptions
and timeouts do not receive provider-response diagnostics. This observational
reason does not change denial classification or timeout precedence.

## Runtime boundary

The closure has no package dependency. It uses Node built-ins (`crypto`,
`zlib`, `fs`, `os`, and `path`) plus Node's web globals (`fetch`,
`ReadableStream`, `AbortSignal`, and `DOMException`). It is loadable by the
verified Node 26.7.0 runtime using built-in TypeScript stripping; the
source intentionally remains TypeScript and is not a standalone JavaScript
artifact. Type stripping does not type-check the files.

Importing the module performs no network access. Calling catalog, JWT, or chat
functions does. The native authentication owner reads only the required
credential fields and sends them over the private helper pipe; callers must
never print or persist those values in diagnostics or conversation history.

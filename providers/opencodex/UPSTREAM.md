# OpenCodex account helper provenance

`vendor/src` originates from `lidge-jun/opencodex` commit `9f7397ed1582d95c6c1fcf4ae9951213b3fa2d19` (package version 2.54.0, MIT). `package.json`, `bun.lock`, and `LICENSE.opencodex` are copied without modification. Narrow account-selection and OpenRouter usage patches are applied to the source import.

The complete 1,136-file upstream `src` import has Git tree object `fbdc3ee52e3ecde4fa5e4a5cf630ccae98a73698`. The patched vendor tree manifest digest is `a7ff6113f52727bde0a9a5b76b476b33e0e059b2ea45478bec8c8e267b571a60`, computed as SHA-256 over the concatenation of sorted `relative/path NUL lowercase-file-sha256 LF` records.

| Artifact | SHA-256 |
| --- | --- |
| `package.json` | `0173ad6b33338fbbd7be5fe3a95dd6a584b0ed51810d3c834ae2038f4ed9e471` |
| `bun.lock` | `9e11456ec851027f5d59b0582f205a699f61fb24dfc7955d77a6171e74189f75` |
| `LICENSE.opencodex` | `34012a5529ad1e574e84457a609f9ea3df03c63d7c42c7e5f74ec14f438ed346` |

## Local source patches

Account-selection behavior remains unchanged unless the helper supplies the new option. The OpenRouter quota patch corrects normal no-cap usage responses for all callers of that imported probe; its spend fields are display evidence, separate from routing quota.

| Path | Upstream SHA-256 | Patched SHA-256 | Patch |
| --- | --- | --- | --- |
| `vendor/src/oauth/store.ts` | `0e79d7afa4e4219fd6208e7013dea78a71d6cf66a9234b554ff60a5aca9d1d24` | `779ca696cdd2aa33dd2a7caadc3139011e042b99f22769be20dfd3a6ece118df` | Adds `saveCredential(..., { preserveSelection: true })`; a new account is inserted or updated inside the existing serialized store mutation while the prior usable selection and its revision are retained in that same commit. |
| `vendor/src/providers/api-keys.ts` | `926c5004b355edec7434afdef1e28fdbb9b01b7071a0ad3e3f02f13b7185e190` | `b13c6fe6e2c88bffd8cf19a541a9e7bb75783a42dfd2f80eec0d52dd9ba8a620` | Adds `addProviderApiKey(..., { preserveSelection: true })`; the key is added through the existing serialized config mutation without replacing an existing active key. |
| `vendor/src/providers/quota.ts` | `f0a40c740b7976e5162a716dc78e2a41f72694deee043e4c5d31832c4488bd95` | `68f005f39be85128451cadeb7ce99a87f9910744eb8a2ff06a91108bfd63851f` | Preserves OpenRouter lifetime/period USD spend and nullable key cap; zero is a cap, null is uncapped, and only authoritative remaining-cap data supplies routing evidence. |
| `vendor/src/providers/quota-types.ts` | `c090ab2a1ea06e67f2d5c6997fdaa6ebf848ca0e3deb2170b1e1a8c7992d9fbe` | `b15a2202ca066e1c0e4c29a714a5a704e3b0f46de98537c793371379e1af191c` | Adds typed, display-only OpenRouter spend and key-cap fields. |

Additional provider prompt patches are included in the reviewed manifest above.

| Path | Current SHA-256 | Patch |
| --- | --- | --- |
| `vendor/src/adapters/google.ts` | `3c0633277af0febc3572d17df66d01da7844383ad08fcb938e6fc4f3f76df7a3` | Keeps intermediate progress concise while allowing task-appropriate final answers. |
| `vendor/src/adapters/tool-catalog-nudge.ts` | `72c991170264438adf65fd02c12ea6547879e844947221826eec437b90ed190f` | Retains exact patch marker requirements while removing the duplicate JavaScript rewriting explanation. |

## Local runtime boundary

`helper.ts`, `inference.ts`, `catalog.ts`, `inference-config.ts`, and `inference-mapping.mjs` are local Azrael adapters, outside the vendored source manifest above. Runtime dependency installation uses the pinned project Bun 1.4.2 executable with `bun install --frozen-lockfile`; no global package installation is required. Importing these local modules performs no provider network request. Runtime calls validate the isolated `OPENCODEX_HOME` under `CODEX_HOME/azrael/providers/opencodex` before operating on account/configuration data.

`helper.ts` retains upstream account-management ownership. `inference.ts` supplies the bounded native inference protocol and managed model catalog. `catalog.ts` discovers OpenRouter text/tool models with the imported outbound request, bounded discovery parser and metadata helpers. It keeps a size-bounded, identity-scoped cache under `OPENCODEX_HOME/catalog`; normal freshness is five minutes and transient-failure fallback expires after 24 hours. Explicit refresh bypasses freshness; authoritative empty rosters and permanent authentication failures retire old IDs. Google AI Studio and xAI retain their configured catalog. Sanitized catalog states travel separately from model entries. The inference path reuses the vendored Google/OpenAI Chat request builders and stream parsers. The local stream observer validates clean provider terminals, rejects unsupported media before parser artifact side effects, and retains provider-private replay fields that the vendored OpenAI Chat parser otherwise reduces to text. No local agent loop or tool executor is introduced; Codex owns tools, permissions, and conversation history.

`inference-mapping.mjs` adapts the existing Devin native protocol mapping for stable exact tool identities and scoped replay envelopes. `inference-config.ts` shares the managed key-auth transport eligibility check with account presentation. OAuth, forwarding, disabled providers, and Google Vertex/Cloud Code Assist are outside this inference boundary. The account UI reports runtime connectivity only when configured inference-helper and Bun files are present; this does not establish successful inference.

Non-secret auxiliary bindings at `CODEX_HOME/azrael/providers/sessions/<thread>.json` pin each provider's account and endpoint/credential continuity fingerprint, with immutable turn snapshots. Reads and writes are size-bounded and schema-validated; writes are atomic. Forks inherit only provider pins selected from the retained native model history, never ancestor turn records or duplicate conversations. Private reasoning/tool metadata replays only for matching provider, model, thread, account, turn, and tool identity/arguments; public reasoning remains available when switching. Unsupported history/input causes an explicit error. Local mapping/configuration changes do not change the vendored tree digest.

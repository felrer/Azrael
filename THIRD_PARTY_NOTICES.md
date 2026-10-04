# Third-party notices

The root MIT license covers Azrael-owned code and instructions. It does not
replace the conditions of imported source code, dependencies or assets.

| Component | Source and retained license |
| --- | --- |
| Codex-based Azrael engine | `engine/` contains the imported source and its `LICENSE` (Apache-2.0), `NOTICE` and dependency notices; `SOURCE.json` identifies the exact source snapshot. |
| Historical engine submodule | `upstream/codex/` retains its Apache-2.0 `LICENSE` and `NOTICE`. |
| OpenCodex provider source | `providers/opencodex/LICENSE.opencodex` and `providers/opencodex/UPSTREAM.md` retain the MIT license and source attribution. |
| Devin transport import | `providers/devin/LICENSE.opencodex`, `UPSTREAM.md` and source headers retain OpenCodex and derived transport attribution. |
| Node/Bun and npm dependencies | Distribution must retain the licenses shipped with each selected runtime and production dependency. Exact versions are recorded by lockfiles and release manifests. |
| Gyeonggi Millennium Batang | Unchanged official Regular/Bold WOFF files in `extensions/azrael-ex/media/fonts/`; `NOTICE.md` retains the source and use conditions, and `provenance.json` pins their hashes. Consolas is system supplied. |

The pinned official OpenAI extension UI under ignored `artifacts/upstream-ui/`
points to OpenAI terms in its `LICENSE.md`. Public release packaging must not
include this UI without established redistribution permission. Local integrated
host preparation is separate from publicly distributable packaging. A copied
code-mode-host executable also requires its own provenance and applicable
redistribution terms; source availability alone does not establish binary rights.

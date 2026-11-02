# Third-party source notices

This directory vendors only the required maintained source/header/license closure; it contains no third-party binary and no MouseMux code. Build commands do not fetch dependencies.

| Component | Pinned official source | License | Included closure |
| --- | --- | --- | --- |
| MinHook | [TsudaKageyu/minhook v1.3.4](https://github.com/TsudaKageyu/minhook/tree/v1.3.4) | [BSD-style license and bundled HDE notices](vendor/minhook/LICENSE.txt) | Public header, buffer/hook/trampoline C and headers, x64 HDE only |
| JSON for Modern C++ | [nlohmann/json v3.11.3](https://github.com/nlohmann/json/releases/tag/v3.11.3) | [MIT](vendor/json/LICENSE.MIT) | Amalgamated single_include/nlohmann/json.hpp |

[vendor/provenance.json](vendor/provenance.json) records the exact official raw source URL and SHA-256 for every vendored file. Files are unmodified upstream contents. MinHook's bundled HDE source retains Vyacheslav Patkov's notices. Distributions including these compiled components must carry the linked license texts and notices.

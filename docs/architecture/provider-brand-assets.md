# Provider brand assets

Status: `current` in source. Account headers use original assets from the providers’ official sites. Geometry, image pixels and aspect ratios are retained; no logo is traced or generated. The OpenAI inline SVG uses its original `currentColor`. Other assets are embedded as their original bytes in data URLs, with official light/dark variants where provided.

The registry is `extensions/azrael-ex/src/providerBrandAssets.ts`. It is self-contained in compiled account views and requires no network requests or runtime media paths. Generic unknown-provider icons remain neutral. Google, Gemini CLI and Antigravity have separate identities. Logos and trademarks belong to their respective owners and identify configured services; they are not Azrael branding.

| Provider / variant | Official source | SHA-256 of original bytes |
| --- | --- | --- |
| openai / light | [Original](https://developers.openai.com/) | `57fea7e36a45cef8ebd63fb51b1ab617f4de3874a4ab7797ba603bdd6ba89707` |
| anthropic / light | [Original](https://cdn.prod.website-files.com/67ce28cfec624e2b733f8a52/67d31dd7aa394792257596c5_webclip.png) | `c91922918edeef31af5e969413c0eecf583707d14588de3fecc1d649b4303bf7` |
| google / light | [Original](https://www.gstatic.com/marketing-cms/assets/images/33/52/d31eb4894f69969b24d075e0d33c/favicon.png=s256) | `55919b9ce182e5c228c00bd29f976c84c226a9ff9cdb2d25549a08fe38072814` |
| google-antigravity / light | [Original](https://antigravity.google/assets/image/antigravity-logo.png) | `193ba1805de11c23cd0c7a1df92aa0a886708e57350f6f7766100afe5befed73` |
| google-gemini-cli / light | [Original](https://geminicli.com/icon.png) | `351e9f5b1bf863d738cd7be4ed040a625a1419450ae7fc490143e4042b7c2438` |
| devin / light | [Original](https://devin.ai/favicon.svg) | `fe0753d2e3823bc1eb8a37943234fac63733b8c9e8abff0ca0402a6c7ddcd682` |
| devin / dark | [Original](https://devin.ai/assets/images/new-home/proactive-issues/devin.svg) | `dd7a3120f6247843c3aee74d28f936c656d231b5a7a8b36c680465f52b4e5a28` |
| openrouter / light | [Original](https://openrouter.ai/brand/logos/transparent/glyph/svg/glyph-ink.svg) | `91be6b8a91745f089bfe42b89a5cbcd4b666fca6473610f9a6c11a31bd7523bc` |
| openrouter / dark | [Original](https://openrouter.ai/brand/logos/transparent/glyph/svg/glyph-cloud.svg) | `385bbf00cd5718ad652fdfc05b4b4e7d0ea3a834cfd807e1133d3bee2b9a7c81` |
| xai / light | [Original](https://docs.x.ai/_next/static/media/favicon-light.1u6watcuoe8mg.svg?dpl=0d42258ef5d109dd8837600d6e2ce0e49ff2acf8) | `f441eef32955dabf2ded0bb66bf5674a53afb81557d9281c00735dd245dfdc86` |
| xai / dark | [Original](https://docs.x.ai/_next/static/media/favicon-dark.0-f2gt9doy0_1.svg?dpl=0d42258ef5d109dd8837600d6e2ce0e49ff2acf8) | `986c5af775f7b550d41cf44e20d981407b30e7f24fa231e8434c5ec3db9c5307` |

For a brand refresh, replace a registry entry with the unmodified official asset and update its source and decoded-byte hash here. Preserve intrinsic SVG view boxes and image proportions. Re-run the production account renderer in standalone/embedded light and dark themes; recapture the README account image and the Window Use preview that embeds it.

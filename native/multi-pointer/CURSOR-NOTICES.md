# Cursor asset notices

## Fluent model cursor

The adopted model body in cursor-assets.hpp derives from Microsoft Fluent UI System Icons,
`assets/Cursor/SVG/ic_fluent_cursor_16_filled.svg`, pinned at commit `9eb184e96268d3293462f9d9d19225b4c7b07774`.

[Upstream SVG](https://github.com/microsoft/fluentui-system-icons/blob/9eb184e96268d3293462f9d9d19225b4c7b07774/assets/Cursor/SVG/ic_fluent_cursor_16_filled.svg) (SHA-256 `b107bfe61b65166d2cbd5f8316168d88a993fbf1ad3f4c5dbc53f5ea9e2fc164`).
[Upstream license](https://github.com/microsoft/fluentui-system-icons/blob/9eb184e96268d3293462f9d9d19225b4c7b07774/LICENSE).

Modifications: approved preview variant `fluent16-w90-white` reconstructs the body
with 90% width and circular corner radius 1; its circular arcs are converted offline
to cubic Beziers with sweeps at most 90 degrees. Native rendering supplies the
preview's white outline and uniform scale separately.

### MIT license

```text
MIT License

Copyright (c) 2020 Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## LAIO palette

All 12 families and six tones (72 RGB colors) are copied exactly from the registered
`appDefaults` and `eventVariantDefaults` embedded in the approved preview.
No runtime user overrides are included. Registered defaults source:

`C:/Users/felre/Desktop/Life-All-In-One/apps/laio_app/lib/services/color_palette_service.dart`

Source SHA-256: `dbe1fec89c84b49f8014f6b4b35a8a0df87bd60b913f9acbbb422326ceb7cecf`.
Design reference: `C:/Users/felre/Desktop/Life-All-In-One/docs/design/app/color-system.md`.

## User cursor redraw and preview provenance

The user paths are the approved preview's seven-fillet geometric redraw of the
approximate Windows native arrow style. `C:/Windows/Cursors/aero_arrow.cur` was used as a
visual reference (SHA-256 `06678bbf954f0bece61062633dc63a52a34a6f3c27ac7108f28c0f0d26bb22a7`). No Windows cursor binary or
embedded reference image is copied into these native assets; this redraw does not
claim an exact pixel match to the Windows cursor.

Frozen geometry and palette source: `work/EZ-01-window-use-multipointer-review/cursor-motion-preview.html`.
Preview SHA-256: `cc60b5b2effdf8719ac4e92e99b17994e73617919370c720cd208593fb87732c`.

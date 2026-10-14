"use strict";

// Shared by source preparation and compiled standalone/embedded account views.
const CASCADIA_FAMILY = '"Azrael Cascadia Mono"';
const FALLBACKS = '"Azrael Gyeonggi Title", "Malgun Gothic", "Segoe UI Emoji", monospace';
const DEFAULT_NORMAL_FONT_FAMILY = `${CASCADIA_FAMILY}, ${FALLBACKS}`;
const NORMAL_FONT_FAMILY = `Consolas, ${DEFAULT_NORMAL_FONT_FAMILY}`;
const FONT_FAMILY = '"Azrael Consolas Space", ' + NORMAL_FONT_FAMILY;
// Keep half-width advances, but restore Consolas's Windows vertical metrics.
// usWinAscent=1884, usWinDescent=514, unitsPerEm=2048; overrides are doubled
// because size-adjust also scales them. An uncorrected first face halves the
// text run/caret metrics and raises model-name glyphs inside centered controls.
const SPACE_FONT_FACE = '@font-face{font-family:"Azrael Consolas Space";src:local("Consolas");unicode-range:U+0020;size-adjust:50%;ascent-override:183.984375%;descent-override:50.1953125%;line-gap-override:0%;font-style:normal;font-weight:100 900;font-display:swap}';
const FONT_PLATFORM_SCRIPT = 'document.documentElement.dataset.azraelFontPlatform=(navigator.userAgentData?.platform??navigator.platform??"").toLowerCase().includes("win")?"win32":"other";';
const FONT_PLATFORM_CSS = `:root{--azrael-normal-content-font-family:${DEFAULT_NORMAL_FONT_FAMILY};--azrael-content-font-family:var(--azrael-normal-content-font-family)}
:root[data-azrael-font-platform="win32"]{--azrael-normal-content-font-family:${NORMAL_FONT_FAMILY};--azrael-content-font-family:"Azrael Consolas Space",var(--azrael-normal-content-font-family)}`;

module.exports = { CASCADIA_FAMILY, DEFAULT_NORMAL_FONT_FAMILY, NORMAL_FONT_FAMILY, FONT_FAMILY, SPACE_FONT_FACE, FONT_PLATFORM_SCRIPT, FONT_PLATFORM_CSS };

"use strict";

// The pinned extension stylesheet consumes VS Code host inputs. Its final body
// rule is transparent, so the native host must also provide the document canvas.
// Colors retain the desktop shell's neutral palette; accents use the pinned
// OpenAI stylesheet's blue/red/green/orange/yellow/purple 400 and 500 values.
function themeCss(dark) {
  const foreground = dark ? "#ececec" : "#242424";
  const surface = dark ? "#171717" : "#ffffff";
  const elevated = dark ? "#262626" : "#ffffff";
  const border = dark ? "#353535" : "#e5e5e5";
  const muted = dark ? "#aaaaaa" : "#6e6e6e";
  const hover = dark ? "#2b2b2b" : "#f3f3f3";
  const accent = dark ? "#0285ff" : "#0169cc";
  const variables = {
    "font-family": '"Segoe WPC", "Segoe UI", sans-serif',
    "font-size": "13px", "font-weight": "400",
    "editor-font-family": 'Consolas, "Courier New", monospace',
    "editor-font-size": "12px", "editor-font-weight": "400",
    foreground, "editor-foreground": foreground, "editor-background": surface,
    "sideBar-background": surface, "descriptionForeground": muted,
    "disabledForeground": dark ? "#777777" : "#9b9b9b",
    "focusBorder": dark ? "#8a8a8a" : "#666666",
    "panel-border": border, "widget-border": dark ? "#404040" : "#dddddd",
    "widget-shadow": "#00000030",
    "input-background": dark ? elevated : "#f5f5f5", "input-foreground": foreground,
    "input-border": border, "input-placeholderForeground": muted,
    "dropdown-background": elevated, "dropdown-foreground": foreground, "dropdown-border": border,
    "button-background": foreground, "button-foreground": surface,
    "button-hoverBackground": dark ? "#d5d5d5" : "#424242",
    "button-secondaryBackground": hover, "button-secondaryForeground": foreground,
    "button-secondaryHoverBackground": dark ? "#353535" : "#e8e8e8",
    "menu-background": elevated, "menu-foreground": foreground, "menu-border": border,
    "menu-selectionBackground": hover, "menu-selectionForeground": foreground,
    "list-hoverBackground": hover, "list-activeSelectionBackground": dark ? "#3b3b3b" : "#e6e6e6",
    "list-activeSelectionForeground": foreground,
    "list-inactiveSelectionBackground": hover, "list-inactiveSelectionForeground": foreground,
    "badge-background": dark ? "#353535" : "#e8e8e8", "badge-foreground": foreground,
    "editorWidget-background": elevated, "editorWidget-foreground": foreground, "editorWidget-border": border,
    "textCodeBlock-background": dark ? "#212121" : "#f5f5f5",
    "textLink-foreground": accent, "textLink-activeForeground": accent,
    "errorForeground": dark ? "#fa423e" : "#e02e2a",
    "editorWarning-foreground": dark ? "#fb6a22" : "#e25507",
    "editor-selectionBackground": dark ? "#0285ff40" : "#0169cc26",
    "editor-findMatchBackground": dark ? "#ffc30040" : "#e0ac0040",
    "charts-blue": accent, "charts-red": dark ? "#fa423e" : "#e02e2a",
    "charts-green": dark ? "#04b84c" : "#00a240", "charts-orange": dark ? "#fb6a22" : "#e25507",
    "charts-yellow": dark ? "#ffc300" : "#e0ac00", "charts-purple": dark ? "#924ff7" : "#8046d9",
    "scrollbarSlider-background": dark ? "#ffffff29" : "#00000029",
    "scrollbarSlider-hoverBackground": dark ? "#ffffff40" : "#00000040",
    "scrollbarSlider-activeBackground": dark ? "#ffffff59" : "#00000059",
  };
  const declarations = Object.entries(variables).map(([key, value]) => `--vscode-${key}:${value}`).join(";");
  return `:root{color-scheme:${dark ? "dark" : "light"};${declarations};--app-color-text-secondary:var(--vscode-descriptionForeground);--app-color-border:var(--vscode-panel-border);--app-color-border-light:var(--vscode-panel-border);--app-color-border-heavy:var(--vscode-widget-border)}html{background-color:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);font-weight:var(--vscode-font-weight)}body{font-size:var(--vscode-font-size)}`;
}

function themeAttributes(dark) {
  const variant = dark ? "dark" : "light";
  return {
    html: { "data-codex-window-type": "extension", "data-theme": variant },
    body: { "data-vscode-theme-kind": `vscode-${variant}`, class: `vscode-${variant}` },
  };
}

// Execute before the renderer initializes where possible, and again on native
// theme changes. Other body classes and existing native theme listeners survive.
function applyTheme(dark) {
  const attributes = themeAttributes(dark);
  return `(() => {const attributes=${JSON.stringify(attributes)};const root=document.documentElement;let style=document.getElementById('azrael-desktop-theme');if(!style){style=document.createElement('style');style.id='azrael-desktop-theme';const nonce=document.querySelector('style[nonce]')?.nonce;if(nonce)style.nonce=nonce;document.head.append(style);}style.textContent=${JSON.stringify(themeCss(dark))};for(const [key,value] of Object.entries(attributes.html))root.setAttribute(key,value);const applyBody=()=>{if(!document.body)return;document.body.setAttribute('data-vscode-theme-kind',attributes.body['data-vscode-theme-kind']);document.body.classList.remove('vscode-dark','vscode-light','vscode-high-contrast','vscode-high-contrast-light');document.body.classList.add(attributes.body.class);};if(document.body)applyBody();else document.addEventListener('DOMContentLoaded',applyBody,{once:true});})()`;
}

module.exports = { themeCss, themeAttributes, applyTheme };

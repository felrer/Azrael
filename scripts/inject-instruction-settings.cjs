"use strict";

const INSTRUCTION_SETTINGS_ASSETS = ["webview/assets/use-visible-settings-sections-e0e40d34ba3b.js", "webview/assets/settings-page-94cbae2cfc9d.js"];
const MARKER = "/*azrael-instruction-settings-v1*/";
const PAGE_ANCHOR = '}let Fe;e[77]';
const HOST_ANCHOR = 'case"open-vscode-command":{';

function AzraelInstructionSettings() {
  const target = Q.useRef(null);
  Q.useEffect(() => {
    const element = target.current;
    if (!element) return;
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    const clientId = crypto.randomUUID();
    let mounted = true, busy = false, sequence = 0, requestId = "", timer;
    const send = (action, message) => {
      requestId = String(++sequence);
      azraelInstructionBridge.dispatchMessage("azrael-instructions", { clientId, requestId, action, message });
    };
    const payload = () => ({ version: root.querySelector("select")?.value,
      componentIds: [...root.querySelectorAll("input[data-component]:checked")].map(e => e.dataset.component) });
    const unsubscribe = azraelInstructionBridge.subscribe("azrael-instructions-state", message => {
      if (!mounted || message.clientId !== clientId || message.requestId !== requestId || typeof message.html !== "string") return;
      root.innerHTML = message.html;
      busy = root.querySelector('main[aria-busy="true"]') !== null;
    });
    const onClick = event => {
      const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
      if (!(button instanceof HTMLElement) || button.disabled || busy) return;
      busy = true;
      send(button.dataset.action, { ...payload(), path: button.dataset.path });
    };
    const onChange = event => {
      if (!(event.target instanceof HTMLElement) || event.target.dataset.action !== "selectVersion") return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (mounted && !busy) { busy = true; send("selectVersion", payload()); } }, 150);
    };
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.innerHTML = '<p role="status">지침 문서를 불러오는 중…</p>';
    send("mount");
    return () => { mounted = false; clearTimeout(timer); send("unmount"); unsubscribe(); root.removeEventListener("click", onClick); root.removeEventListener("change", onChange); root.innerHTML = ""; };
  }, []);
  return (0, $.jsx)("div", { ref: target, style: { width: "100%", minWidth: 0 }, "data-azrael-instruction-settings": true });
}

function once(text, from, to) {
  if (text.split(from).length !== 2) throw new Error("Pinned instruction settings anchor changed: " + from);
  return text.replace(from, to);
}

function injectInstructionSettings(text, relativePath) {
  if (![...INSTRUCTION_SETTINGS_ASSETS, "out/extension.js"].includes(relativePath)) return { text, count: 0 };
  if (text.includes(MARKER)) return { text, count: 0 };
  if (relativePath === "out/extension.js") return { text: once(text, HOST_ANCHOR,
    'case"azrael-instructions":{await Ge.commands.executeCommand("azrael.instructionsEmbedded",e,r,this.findPanelByWebview(e));break}' + MARKER + HOST_ANCHOR), count: 1 };
  if (relativePath === INSTRUCTION_SETTINGS_ASSETS[0]) {
    // Registration happens before visibility selection, so route fallback recognizes the section.
    text = once(text, 'Ue=Dt.map(e=>', 'Ue=Dt.flatMap(e=>e.slug===`personalization`?[e,{slug:`azrael-instructions`}]:[e]).map(e=>');
    text = once(text, 'case`general-settings`:case`personalization`:', 'case`azrael-instructions`:case`general-settings`:case`personalization`:');
    text = once(text, 'personalization:{component:Yi,commandAsset:Mr,navigation:{assets:{16:Mr,20:Ar},ariaHidden:!1}},',
      '"azrael-instructions":{component:azraelInstructionIcon,commandAsset:azraelInstructionAsset16,navigation:{assets:{16:azraelInstructionAsset16,20:azraelInstructionAsset20},ariaHidden:!1}},personalization:{component:Yi,commandAsset:Mr,navigation:{assets:{16:Mr,20:Ar},ariaHidden:!1}},');
    // Reuse the pinned platform icon factory and JSX runtime with owned monochrome geometry.
    const body = '<path d="M5 2.5h7l3 3v12H5z M12 2.5v3h3 M8 8h4 M8 11h4 M8 14h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>';
    const asset = size => {
      const scale = size / 20, bounds = { x: 4.35 * scale, y: 1.85 * scale, width: 11.3 * scale, height: 16.3 * scale };
      return JSON.stringify({ name: `azrael-instructions-light-${size}`, canvas: { width: size, height: size, viewBox: `0 0 ${size} ${size}`, frame: { x: 0, y: 0, width: size, height: size }, inkBounds: bounds, visualBounds: bounds }, paint: { kind: "monochrome" }, optical: { shape: "non-circular", bounds, center: { x: size / 2, y: size / 2 }, insets: { top: bounds.y, right: bounds.x, bottom: bounds.y, left: bounds.x }, anchors: { frame: { x: size / 2, y: size / 2 }, ink: { x: size / 2, y: size / 2 }, foreground: { x: size / 2, y: size / 2 } } }, capabilities: ["icon"], body: `<g transform="scale(${scale})">${body}</g>` });
    };
    text = once(text, 'ua={"general-settings":', `azraelInstructionAsset16=O(${asset(16)}),azraelInstructionAsset20=O(${asset(20)}),ua={"general-settings":`);
    text += '\n' + MARKER + '\nvar azraelInstructionAsset16,azraelInstructionAsset20;function azraelInstructionIcon(props){return(0,j().jsx)("svg",{width:20,height:20,viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:1.3,...props,children:(0,j().jsx)("path",{d:"M5 2.5h7l3 3v12H5z M12 2.5v3h3 M8 8h4 M8 11h4 M8 14h4"})})}';
    return { text, count: 1 };
  }
  const instructionContent = 'if(ne===`azrael-instructions`){Ne=(0,$.jsx)(AzraelInstructionSettings,{});}let Fe;e[77]';
  const accountTail = 'if(ne===`usage`)Ne=(0,$.jsx)(AzraelAccountSettings,{});let Fe;e[77]';
  text = text.includes('/*azrael-account-settings-v1*/')
    ? once(text, accountTail, 'if(ne===`usage`)Ne=(0,$.jsx)(AzraelAccountSettings,{});' + instructionContent)
    : once(text, PAGE_ANCHOR, '}' + instructionContent);
  text = once(text, '.agent.personalization.pets.', '.agent.personalization.azrael-instructions.pets.');
  text = once(text, '`agent`,`personalization`,`pets`', '`agent`,`personalization`,`azrael-instructions`,`pets`');
  text = once(text, 'o=Be(e.slug,O,!1),s=e.slug===', 'o=e.slug===`azrael-instructions`?{id:`azrael.settings.instructions`,defaultMessage:`지침 문서`}:Be(e.slug,O,!1),s=e.slug===');
  const label = 'label:(0,Z.jsx)(He,{codexMicroDeviceModel:D,showChatGptDataControlsLabel:!1,showEnterpriseUsageLabel:O,slug:e.slug})';
  text = once(text, label, 'label:e.slug===`azrael-instructions`?`지침 문서`:(0,Z.jsx)(He,{codexMicroDeviceModel:D,showChatGptDataControlsLabel:!1,showEnterpriseUsageLabel:O,slug:e.slug})');
  text = once(text, 'f=P?(0,Z.jsx)(He,', 'f=e.slug===`azrael-instructions`?`지침 문서`:P?(0,Z.jsx)(He,');
  return { text: 'import{N0t as azraelInstructionBridge}from"./app-initial-4bd9e54bcd58.js";' + text + '\n' + MARKER + '\n' + AzraelInstructionSettings.toString(), count: 1 };
}

module.exports = { INSTRUCTION_SETTINGS_ASSETS, MARKER, injectInstructionSettings, AzraelInstructionSettings };

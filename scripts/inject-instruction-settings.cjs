"use strict";

const INSTRUCTION_SETTINGS_ASSETS = ["webview/assets/use-visible-settings-sections-4b8b7ed73a1e.js", "webview/assets/settings-page-76344c84191c.js"];
const MARKER = "/*azrael-instruction-settings-v1*/";
const PAGE_ANCHOR = "}let Fe;e[77]";
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
  if (text.split(MARKER).length > 2) throw new Error("Duplicate instruction settings marker");
  if (text.includes(MARKER)) return { text, count: 0 };
  if (relativePath === "out/extension.js") {
    const sidebarAnchor = /e\.push\(kt\.commands\.registerCommand\("(?:chatgpt|azrael)\.openSidebar",Au\)\)/g;
    const registrations = text.match(sidebarAnchor);
    if (registrations?.length !== 1) throw new Error("Pinned instruction settings sidebar registration anchor changed");
    text = once(text, registrations[0], registrations[0] + ',e.push(kt.commands.registerCommand("azrael.openSettingsPanel",()=>Pe.showSettings({section:"general-settings"})))');
    return { text: once(text, HOST_ANCHOR,
      "case\"azrael-instructions\":{await Ge.commands.executeCommand(\"azrael.instructionsEmbedded\",e,r,this.findPanelByWebview(e));break}" + MARKER + HOST_ANCHOR), count: 1 };
  }
  if (relativePath === INSTRUCTION_SETTINGS_ASSETS[0]) {
    // Registration happens before visibility selection, so route fallback recognizes the section.
    text = once(text, "Ue=bt.map(e=>", "Ue=bt.flatMap(e=>e.slug===`personalization`?[e,{slug:`azrael-instructions`}]:[e]).map(e=>");
    text = once(text, 'case`general-settings`:case`personalization`:', 'case`azrael-instructions`:case`general-settings`:case`personalization`:');
    text = once(text, "personalization:{component:Ji,commandAsset:Or,navigation:{assets:{16:Or,20:Er},ariaHidden:!1}},",
      "\"azrael-instructions\":{component:azraelInstructionIcon,commandAsset:Or,navigation:{assets:{16:Or,20:Er},ariaHidden:!1}},personalization:{component:Ji,commandAsset:Or,navigation:{assets:{16:Or,20:Er},ariaHidden:!1}},");
    // Reuse initialized platform icon assets; O is a bundle value, not a factory.
    text += '\n' + MARKER + '\nfunction azraelInstructionIcon(props){return(0,m().jsx)("svg",{width:20,height:20,viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:1.3,...props,children:(0,m().jsx)("path",{d:"M5 2.5h7l3 3v12H5z M12 2.5v3h3 M8 8h4 M8 11h4 M8 14h4"})})}';
    return { text, count: 1 };
  }
  const instructionContent = "if(x===`azrael-instructions`){Pe=(0,$.jsx)(AzraelInstructionSettings,{});}let Fe;e[77]";
  const accountTail = "if(x===`usage`)Pe=(0,$.jsx)(AzraelAccountSettings,{});let Fe;e[77]";
  text = text.includes('/*azrael-account-settings-v1*/')
    ? once(text, accountTail, "if(x===`usage`)Pe=(0,$.jsx)(AzraelAccountSettings,{});" + instructionContent)
    : once(text, PAGE_ANCHOR, '}' + instructionContent);
  text = once(text, '.agent.personalization.pets.', '.agent.personalization.azrael-instructions.pets.');
  text = once(text, '`agent`,`personalization`,`pets`', '`agent`,`personalization`,`azrael-instructions`,`pets`');
  text = once(text, "c=nt(e.slug,E,!1),l=e.slug===", "c=e.slug===`azrael-instructions`?{id:`azrael.settings.instructions`,defaultMessage:`지침 문서`}:nt(e.slug,E,!1),l=e.slug===");
  const label = "label:(0,Z.jsx)(Ue,{codexMicroDeviceModel:T,showChatGptDataControlsLabel:!1,showEnterpriseUsageLabel:E,slug:e.slug})";
  text = once(text, label, "label:e.slug===`azrael-instructions`?`지침 문서`:(0,Z.jsx)(Ue,{codexMicroDeviceModel:T,showChatGptDataControlsLabel:!1,showEnterpriseUsageLabel:E,slug:e.slug})");
  text = once(text, "f=F?(0,Z.jsx)(Ue,", "f=e.slug===`azrael-instructions`?`지침 문서`:F?(0,Z.jsx)(Ue,");
  return { text: 'import{A3t as azraelInstructionBridge}from"./app-initial-5120fa5fe295.js";' + text + '\n' + MARKER + '\n' + AzraelInstructionSettings.toString(), count: 1 };
}

module.exports = { INSTRUCTION_SETTINGS_ASSETS, MARKER, injectInstructionSettings, AzraelInstructionSettings };

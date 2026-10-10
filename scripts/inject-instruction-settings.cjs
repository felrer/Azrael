"use strict";

const INSTRUCTION_SETTINGS_ASSETS = ["webview/assets/use-visible-settings-sections-7686bdcccd03.js", "webview/assets/settings-page-f0054e44de3c.js"];
const MARKER = "/*azrael-instruction-settings-v1*/";
const PAGE_ANCHOR = "}let B;e[72]";
const HOST_ANCHOR = 'case"open-vscode-command":{';

function azraelSettingsText(locale, english, korean) {
  return typeof locale === "string" && /^ko(?:[-_]|$)/i.test(locale) ? korean : english;
}

function AzraelInstructionNavigationIcon(props) {
  return (0, Z.jsx)("svg", { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, ...props,
    children: (0, Z.jsx)("path", { d: "M11.5 2.75H5.5a1.5 1.5 0 0 0-1.5 1.5v11.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-8.5Zm0 0v4.5H16M7 10h6M7 13h6" }) });
}

function AzraelInstructionSettings() {
  const locale = s().locale;
  const target = Q.useRef(null);
  Q.useEffect(() => {
    const element = target.current;
    if (!element) return;
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    const clientId = crypto.randomUUID();
    let mounted = true, busy = false, sequence = 0, requestId = "", timer;
    const send = (action, message) => {
      requestId = String(++sequence);
      azraelInstructionBridge.dispatchMessage("azrael-instructions", { clientId, requestId, action, message, locale });
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
    root.innerHTML = '<p role="status">' + azraelSettingsText(locale, "Loading instruction documents…", "지침 문서를 불러오는 중…") + '</p>';
    send("mount");
    return () => { mounted = false; clearTimeout(timer); send("unmount"); unsubscribe(); root.removeEventListener("click", onClick); root.removeEventListener("change", onChange); root.innerHTML = ""; };
  }, [locale]);
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
    const sidebarAnchor = /e\.push\(Mt\.commands\.registerCommand\("(?:chatgpt|azrael)\.openSidebar",Ru\)\)/g;
    const registrations = text.match(sidebarAnchor);
    if (registrations?.length !== 1) throw new Error("Pinned instruction settings sidebar registration anchor changed");
    text = once(text, registrations[0], registrations[0] + ',e.push(Mt.commands.registerCommand("azrael.openSettingsPanel",()=>Pe.showSettings({section:"general-settings"})))');
    return { text: once(text, HOST_ANCHOR,
      "case\"azrael-instructions\":{await je.commands.executeCommand(\"azrael.instructionsEmbedded\",e,r,this.findPanelByWebview(e));break}" + MARKER + HOST_ANCHOR), count: 1 };
  }
  if (relativePath === INSTRUCTION_SETTINGS_ASSETS[0]) {
    // Registration happens before visibility selection, so route fallback recognizes the section.
    text = once(text, "We=Qe.map(e=>", "We=Qe.flatMap(e=>e.slug===`personalization`?[e,{slug:`azrael-instructions`}]:[e]).map(e=>");
    text = once(text, 'case`general-settings`:case`personalization`:', 'case`azrael-instructions`:case`general-settings`:case`personalization`:');
    text = once(text, "personalization:{component:Ki,commandAsset:wr,navigation:{assets:{16:wr,20:Er},ariaHidden:!1}},",
      "\"azrael-instructions\":{component:azraelInstructionIcon,commandAsset:wr,navigation:{assets:{16:wr,20:Er},ariaHidden:!1}},personalization:{component:Ki,commandAsset:wr,navigation:{assets:{16:wr,20:Er},ariaHidden:!1}},");
    // Reuse initialized platform icon assets and the native JSX getter.
    text += '\n' + MARKER + '\nfunction azraelInstructionIcon(props){return(0,t().jsx)("svg",{width:20,height:20,viewBox:"0 0 20 20",fill:"none",stroke:"currentColor",strokeWidth:1.3,...props,children:(0,t().jsx)("path",{d:"M5 2.5h7l3 3v12H5z M12 2.5v3h3 M8 8h4 M8 11h4 M8 14h4"})})}';
    return { text, count: 1 };
  }
  const instructionContent = "if(y===`azrael-instructions`){Me=(0,$.jsx)(AzraelInstructionSettings,{});}let B;e[72]";
  const accountTail = "if(y===`usage`)Me=(0,$.jsx)(AzraelAccountSettings,{});let B;e[72]";
  text = text.includes('/*azrael-account-settings-v1*/')
    ? once(text, accountTail, "if(y===`usage`)Me=(0,$.jsx)(AzraelAccountSettings,{});" + instructionContent)
    : once(text, PAGE_ANCHOR, '}' + instructionContent);
  text = once(text, '.appshots.agent.personalization.pets.', '.appshots.agent.personalization.azrael-instructions.pets.');
  text = once(text, '.voice.storage.agent.personalization.pets.', '.voice.storage.agent.personalization.azrael-instructions.pets.');
  text = once(text, "s=Xe(e.slug,w,!1),c=e.slug===", "s=e.slug===`azrael-instructions`?{id:`azrael.settings.instructions`,defaultMessage:azraelSettingsText(T.locale,`Instruction Documents`,`지침 문서`)}:Xe(e.slug,w,!1),c=e.slug===");
  const label = "label:(0,Z.jsx)(qe,{codexMicroDeviceModel:C,showChatGptDataControlsLabel:!1,showEnterpriseUsageLabel:w,slug:e.slug})";
  text = once(text, label, "label:e.slug===`azrael-instructions`?azraelSettingsText(T.locale,`Instruction Documents`,`지침 문서`):(0,Z.jsx)(qe,{codexMicroDeviceModel:C,showChatGptDataControlsLabel:!1,showEnterpriseUsageLabel:w,slug:e.slug})");
  text = once(text, "f=A?(0,Z.jsx)(qe,", "f=e.slug===`azrael-instructions`?azraelSettingsText(T.locale,`Instruction Documents`,`지침 문서`):A?(0,Z.jsx)(qe,");
  text = once(text, 'icon:16 in a?', 'icon:e.slug===`azrael-instructions`?(0,Z.jsx)(AzraelInstructionNavigationIcon,{className:t?`text-codex-icon-active`:void 0}):16 in a?');
  text = once(text, 'iconAssetSource:i?void 0:r.navigation', 'iconAssetSource:e.slug===`azrael-instructions`?void 0:i?void 0:r.navigation');
  return { text: 'import{X9t as azraelInstructionBridge}from"./app-initial-c014f9ee4429.js";' + text + '\n' + MARKER + '\n' + azraelSettingsText.toString() + '\n' + AzraelInstructionSettings.toString() + '\n' + AzraelInstructionNavigationIcon.toString(), count: 1 };
}

module.exports = { INSTRUCTION_SETTINGS_ASSETS, MARKER, injectInstructionSettings, AzraelInstructionSettings, AzraelInstructionNavigationIcon, azraelSettingsText };

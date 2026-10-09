"use strict";

const ACCOUNT_SETTINGS_ASSET = "webview/assets/settings-page-76344c84191c.js";
const MARKER = "/*azrael-account-settings-v1*/";
const HOST_ANCHOR = 'case"open-vscode-command":{';
const HOST_PATCH = "case\"azrael-accounts\":{await Ge.commands.executeCommand(\"azrael.accountsEmbedded\",e,r,this.findPanelByWebview(e));break}" + MARKER + HOST_ANCHOR;
const PAGE_ANCHOR = "}let Fe;e[77]";
const PAGE_PATCH = "}if(x===`usage`)Pe=(0,$.jsx)(AzraelAccountSettings,{});let Fe;e[77]";

// Share the account module's markup and actions, with CSS isolated from settings.
// The mount ID rejects stale updates after navigating away and back.
function AzraelAccountSettings() {
  const target = Q.useRef(null);
  Q.useEffect(() => {
    const element = target.current;
    if (!element) return;
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    const clientId = crypto.randomUUID();
    const send = (action, message) => azraelAccountBridge.dispatchMessage("azrael-accounts", { clientId, action, message });
    const unsubscribe = azraelAccountBridge.subscribe("azrael-accounts-html", message => {
      if (message.clientId === clientId && typeof message.html === "string") {
        root.innerHTML = message.html;
        root.querySelector('button[data-ticket-confirming="true"]')?.focus();
      }
    });
    const onClick = event => {
      const button = event.target instanceof Element ? event.target.closest('button[data-action], [role="button"][data-action="toggleUsage"]') : null;
      if (!(button instanceof HTMLElement) || button.disabled) return;
      send("action", { action: button.dataset.action, profileId: button.dataset.profile, providerId: button.dataset.provider,
        accountId: button.dataset.account, workspaceAccountId: button.dataset.workspace, kind: button.dataset.kind, creditId: button.dataset.credit, month: button.dataset.month });
    };
    const onChange = event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "checkbox" || input.dataset.action !== "setAutoSwitch" || input.disabled) return;
      const enabled = input.checked;
      input.disabled = true;
      send("action", { action: input.dataset.action, profileId: input.dataset.profile, providerId: input.dataset.provider,
        accountId: input.dataset.account, workspaceAccountId: input.dataset.workspace, enabled });
    };
    const onKeyDown = event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const summary = event.target;
      if (!(summary instanceof HTMLElement) || summary.dataset.action !== "toggleUsage" || summary.getAttribute("role") !== "button") return;
      event.preventDefault();
      summary.click();
    };
    const onToggle = event => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement) || !details.classList.contains("ticket-details")) return;
      send("action", { action: "ticketDetails", profileId: details.dataset.profile, workspaceAccountId: details.dataset.workspace, open: details.open });
    };
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("change", onChange);
    root.addEventListener("toggle", onToggle, true);
    root.innerHTML = '<p role="status">계정 및 사용량을 불러오는 중…</p>';
    send("mount");
    return () => { send("unmount"); unsubscribe(); root.removeEventListener("click", onClick); root.removeEventListener("keydown", onKeyDown); root.removeEventListener("change", onChange); root.removeEventListener("toggle", onToggle, true); root.innerHTML = ""; };
  }, []);
  return (0, $.jsx)("div", { ref: target, style: { width: "100%", minWidth: 0 }, "data-azrael-account-settings": true });
}

function once(text, from, to) {
  if (text.split(from).length !== 2) throw new Error("Pinned account settings anchor changed: " + from);
  return text.replace(from, to);
}

function injectAccountSettings(text, relativePath) {
  if (!["out/extension.js", ACCOUNT_SETTINGS_ASSET].includes(relativePath)) return { text, count: 0 };
  if (text.split(MARKER).length > 2) throw new Error("Duplicate account settings marker");
  if (text.includes(MARKER)) return { text, count: 0 };
  if (relativePath === "out/extension.js") return { text: once(text, HOST_ANCHOR, HOST_PATCH), count: 1 };
  text = once(text, 'e.key===(S?`personal`:`settings`)?(0,Z.jsx)(fr,{canCollapse:x,externalTooltip:$e,hideLabels:F}):null', 'null');
  const imported = 'import{A3t as azraelAccountBridge}from"./app-initial-5120fa5fe295.js";';
  return { text: imported + once(text, PAGE_ANCHOR, PAGE_PATCH) + "\n" + MARKER + "\n" + AzraelAccountSettings.toString(), count: 1 };
}

module.exports = { ACCOUNT_SETTINGS_ASSET, MARKER, injectAccountSettings, AzraelAccountSettings };

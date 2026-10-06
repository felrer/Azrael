"use strict";

const DESIGN_ASSETS = ["webview/assets/app-initial-5120fa5fe295.js", "webview/assets/use-visible-settings-sections-4b8b7ed73a1e.js", "webview/assets/settings-page-76344c84191c.js", "out/extension.js"];
const MARKER = "/*azrael-student-design-v1*/";
const AVATAR = "function c_i(e){let t=(0,u_i.c)(11),n,r,i,a;t[0]===e?(n=t[1],r=t[2],i=t[3],a=t[4]):({seed:i,className:n,palette:a,...r}=e,t[0]=e,t[1]=n,t[2]=r,t[3]=i,t[4]=a);let o=a===void 0?`codex`:a,s=Xv()===!0,c=o===`chatgpt`?10:f_i.length,l=f_i[l_i(i,c)],u=s?l.dark:l.light,d;t[5]===n?d=t[6]:(d=ni(`size-3.5 shrink-0`,n),t[5]=n,t[6]=d);let f;return t[7]!==u||t[8]!==r||t[9]!==d?(f=(0,d_i.jsx)(`img`,{className:d,alt:``,draggable:!1,src:u,...r}),t[7]=u,t[8]=r,t[9]=d,t[10]=f):f=t[10],f}";

// Host owns all assignments. The store only reads snapshots and sends preference changes.
function createDesignStore(bridge, clientId, timing = globalThis) {
  let state = { enabled: false, students: [], assignments: {}, loading: true, saving: false, error: null };
  let timer, disposed = false;
  const listeners = new Set();
  const cancelTimer = () => { if (timer !== undefined) timing.clearTimeout(timer); timer = undefined; };
  const publish = next => { state = next; for (const listener of listeners) listener(); };
  const receive = message => {
    if (disposed || message.clientId !== clientId || typeof message.enabled !== "boolean" || !Array.isArray(message.students) || !message.assignments || typeof message.assignments !== "object") return;
    cancelTimer();
    publish({ enabled: message.enabled, students: message.students, assignments: message.assignments, loading: false, saving: false, error: typeof message.error === "string" ? message.error : null });
  };
  const unsubscribe = bridge.subscribe("azrael-design-state", receive);
  const send = (action, enabled) => {
    if (disposed && action !== "unsubscribe") return;
    cancelTimer();
    if (action !== "unsubscribe") {
      timer = timing.setTimeout(() => {
        timer = undefined;
        if (!disposed) publish({ ...state, loading: false, saving: false, error: "디자인 설정 응답을 받지 못했습니다. 다시 불러오기를 눌러 확인해 주세요." });
      }, 10000);
      timer?.unref?.();
    }
    try { bridge.dispatchMessage("azrael-design", { clientId, action, ...(action === "setEnabled" ? { enabled } : {}) }); }
    catch (error) { cancelTimer(); if (!disposed) publish({ ...state, loading: false, saving: false, error: String(error.message ?? error) }); }
  };
  send("subscribe");
  return { getSnapshot: () => state, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setEnabled: enabled => { if (disposed || state.loading || state.saving) return; publish({ ...state, saving: true, error: null }); send("setEnabled", enabled); },
    retry: () => { if (disposed || state.loading || state.saving) return; publish({ ...state, loading: true, error: null }); send("subscribe"); },
    dispose: () => { if (disposed) return; disposed = true; cancelTimer(); send("unsubscribe"); unsubscribe(); listeners.clear(); } };
}

function AzraelStudentAvatar(props) {
  const react = q();
  const state = useAzraelDesignState();
  const { seed, className, palette, ...rest } = props;
  const id = typeof seed === "string" && Object.prototype.hasOwnProperty.call(state.assignments, seed) ? state.assignments[seed] : null;
  const student = id == null ? null : state.students.find(item => item.id === id);
  const url = typeof student?.url === "string" ? student.url : null;
  const [failed, setFailed] = react.useState(null);
  if (!url || failed === url) return (0, d_i.jsx)(azraelOriginalAvatar, props);
  return (0, d_i.jsx)("img", { ...rest, className: ni("size-3.5 shrink-0", className), alt: "", draggable: false, src: url,
    onError: event => { setFailed(url); rest.onError?.(event); } });
}

function AzraelDesignSettings() {
  const state = useAzraelDesignState();
  return (0, $.jsxs)("section", { "data-azrael-design-settings": true, "aria-busy": state.loading || state.saving, children: [
    (0, $.jsx)("h2", { children: "디자인" }),
    (0, $.jsxs)("label", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
      (0, $.jsx)("input", { type: "checkbox", checked: state.enabled, disabled: state.loading || state.saving,
        onChange: event => azraelDesignStore.setEnabled(event.target.checked) }), "학생 아이콘 사용" ] }),
    (0, $.jsx)("p", { children: "기본값은 꺼짐입니다. 켠 뒤 새로 생성되는 Subagent에만 학생 아이콘이 무작위로 배정됩니다. 끄거나 다시 켜도 이전에 배정된 아이콘은 유지됩니다." }),
    state.loading ? (0, $.jsx)("p", { role: "status", children: "디자인 설정을 불러오는 중…" }) : null,
    state.saving ? (0, $.jsx)("p", { role: "status", children: "저장 중…" }) : null,
    state.error ? (0, $.jsxs)("div", { role: "alert", children: [state.error, (0, $.jsx)("button", { type: "button", disabled: state.loading || state.saving, onClick: () => azraelDesignStore.retry(), children: "다시 불러오기" })] }) : null,
    (0, $.jsx)("p", { children: "학생 100명 · 아이콘 미리보기" }),
    (0, $.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: state.students.slice(0, 12).map(student =>
      (0, $.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
        (0, $.jsx)("img", { src: student.url, width: 20, height: 20, alt: "", draggable: false }), student.nameKo ] }, student.id)) })
  ] });
}

function once(text, from, to) {
  if (text.split(from).length !== 2) throw new Error("Pinned student design anchor changed: " + from);
  return text.replace(from, to);
}

function observeStudentCreated(message, commands) {
  const item = message?.params?.item;
  if (message?.method !== "item/completed" || item?.type !== "collabAgentToolCall" || item.tool !== "spawnAgent" || item.status !== "completed" || !Array.isArray(item.receiverThreadIds)) return;
  for (const id of new Set(item.receiverThreadIds)) {
    if (typeof id !== "string" || id.length === 0 || id.trim() !== id) continue;
    try { Promise.resolve(commands.executeCommand("azrael.studentCreated", id)).catch(error => console.warn("Azrael student creation observation failed", error)); }
    catch (error) { console.warn("Azrael student creation observation failed", error); }
  }
}

function injectStudentDesign(text, relativePath, vp) {
  if (DESIGN_ASSETS.includes(relativePath) && text.split(MARKER).length > 2) throw new Error("Duplicate student design marker");
  if (!DESIGN_ASSETS.includes(relativePath) || text.includes(MARKER)) return { text, count: 0 };
  if (relativePath === DESIGN_ASSETS[3]) {
    text = once(text, 'case"open-vscode-command":{', "case\"azrael-design\":{await Ge.commands.executeCommand(\"azrael.designEmbedded\",e,r,this.findPanelByWebview(e));break}case\"open-vscode-command\":{");
    vp ??= require(require.resolve("typescript", { paths: [require("node:path").resolve(__dirname, "../extensions/azrael-ex")] }));
    const source = vp.createSourceFile(relativePath, text, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
    const methods = [];
    const visit = node => {
      if (vp.isMethodDeclaration(node) && node.name?.text === "routeIncomingMessage") methods.push(node);
      vp.forEachChild(node, visit);
    };
    visit(source);
    const method = methods[0];
    if (methods.length !== 1 || !method.body || method.parameters.length !== 2 || !vp.isIdentifier(method.parameters[0].name)) throw new Error("Pinned student design anchor changed: routeIncomingMessage");
    const position = method.body.getStart(source) + 1;
    text = text.slice(0, position) + `azraelObserveStudentCreated(${method.parameters[0].name.text},Ge.commands);` + text.slice(position);
    return { text: text + '\n' + MARKER + '\n' + observeStudentCreated.toString().replace('function observeStudentCreated(', 'function azraelObserveStudentCreated('), count: 1 };
  }
  if (relativePath === DESIGN_ASSETS[0]) {
    text = once(text, AVATAR, AVATAR.replace("function c_i(e)", 'function azraelOriginalAvatar(e)') + "function c_i(e){return(0,d_i.jsx)(AzraelStudentAvatar,e)}");
    text = once(text, 'Dm as A3t,', 'Dm as A3t,');
    // The pinned bundle initializes through lazy functions across cyclic imports.
    // Calling them during module evaluation reaches dependencies before they exist.
    return { text: text + '\n' + MARKER + '\n' + createDesignStore.toString() + '\n' + AzraelStudentAvatar.toString() + "\nvar azraelDesignStore;function useAzraelDesignState(){Om();azraelDesignStore??=createDesignStore(Dm,crypto.randomUUID());return q().useSyncExternalStore(azraelDesignStore.subscribe,azraelDesignStore.getSnapshot,azraelDesignStore.getSnapshot)}window.addEventListener(\"pagehide\",()=>azraelDesignStore?.dispose(),{once:true});export{azraelDesignStore,useAzraelDesignState};", count: 1 };
  }
  if (!text.includes('/*azrael-instruction-settings-v1*/')) throw new Error("Student design requires instruction settings injection first");
  if (relativePath === DESIGN_ASSETS[1]) {
    text = once(text, 'e.slug===`personalization`?[e,{slug:`azrael-instructions`}]:[e]', 'e.slug===`personalization`?[e,{slug:`azrael-instructions`},{slug:`azrael-design`}]:[e]');
    text = once(text, 'case`azrael-instructions`:case`general-settings`:', 'case`azrael-design`:case`azrael-instructions`:case`general-settings`:');
    // Reuse the existing personalization platform icon at both native sizes.
    text = once(text, "personalization:{component:Ji,commandAsset:Or,", "\"azrael-design\":{component:Ji,commandAsset:Or,navigation:{assets:{16:Or,20:Er},ariaHidden:!1}},personalization:{component:Ji,commandAsset:Or,");
    return { text: text + '\n' + MARKER, count: 1 };
  }
  text = once(text, "if(x===`azrael-instructions`){Pe=(0,$.jsx)(AzraelInstructionSettings,{});}let Fe;e[77]", "if(x===`azrael-instructions`){Pe=(0,$.jsx)(AzraelInstructionSettings,{});}if(x===`azrael-design`){Pe=(0,$.jsx)(AzraelDesignSettings,{});}let Fe;e[77]");
  text = once(text, '.personalization.azrael-instructions.pets.', '.personalization.azrael-instructions.azrael-design.pets.');
  text = once(text, '`personalization`,`azrael-instructions`,`pets`', '`personalization`,`azrael-instructions`,`azrael-design`,`pets`');
  text = once(text, 'c=e.slug===`azrael-instructions`?', 'c=e.slug===`azrael-design`?{id:`azrael.settings.design`,defaultMessage:`디자인`}:e.slug===`azrael-instructions`?');
  text = once(text, 'label:e.slug===`azrael-instructions`?', 'label:e.slug===`azrael-design`?`디자인`:e.slug===`azrael-instructions`?');
  text = once(text, 'f=e.slug===`azrael-instructions`?', 'f=e.slug===`azrael-design`?`디자인`:e.slug===`azrael-instructions`?');
  return { text: 'import{azraelDesignStore,useAzraelDesignState}from"./app-initial-5120fa5fe295.js";' + text + '\n' + MARKER + '\n' + AzraelDesignSettings.toString(), count: 1 };
}

module.exports = { DESIGN_ASSETS, MARKER, injectStudentDesign, createDesignStore, AzraelStudentAvatar, AzraelDesignSettings, observeStudentCreated };

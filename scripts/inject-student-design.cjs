"use strict";

const DESIGN_ASSETS = ["webview/assets/app-initial-5120fa5fe295.js", "webview/assets/use-visible-settings-sections-4b8b7ed73a1e.js", "webview/assets/settings-page-76344c84191c.js", "out/extension.js"];
const MARKER = "/*azrael-student-design-v1*/";

function AzraelDesignNavigationIcon(props) {
  return (0, Z.jsxs)("svg", { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, ...props,
    children: [(0, Z.jsx)("path", { d: "M10 2.75a7.25 7.25 0 1 0 0 14.5h1a1.75 1.75 0 0 0 1.4-2.8 1.25 1.25 0 0 1 1-2h1.1a2.75 2.75 0 0 0 2.75-2.75A7 7 0 0 0 10 2.75Z" }),
      ...[[6.25, 8], [9, 5.75], [12.5, 6.25], [14.25, 9]].map(([cx, cy]) => (0, Z.jsx)("circle", { cx, cy, r: .65, fill: "currentColor", stroke: "none" }, `${cx}-${cy}`))] });
}
const AVATAR = "function c_i(e){let t=(0,u_i.c)(11),n,r,i,a;t[0]===e?(n=t[1],r=t[2],i=t[3],a=t[4]):({seed:i,className:n,palette:a,...r}=e,t[0]=e,t[1]=n,t[2]=r,t[3]=i,t[4]=a);let o=a===void 0?`codex`:a,s=Xv()===!0,c=o===`chatgpt`?10:f_i.length,l=f_i[l_i(i,c)],u=s?l.dark:l.light,d;t[5]===n?d=t[6]:(d=ni(`size-3.5 shrink-0`,n),t[5]=n,t[6]=d);let f;return t[7]!==u||t[8]!==r||t[9]!==d?(f=(0,d_i.jsx)(`img`,{className:d,alt:``,draggable:!1,src:u,...r}),t[7]=u,t[8]=r,t[9]=d,t[10]=f):f=t[10],f}";

// Host owns all assignments. The store only reads snapshots and sends preference changes.
function createDesignStore(bridge, clientId, timing = globalThis) {
  let state = { enabled: false, chatFont: "gyeonggi-consolas", students: [], assignments: {}, loading: true, saving: false, error: null };
  let timer, disposed = false;
  const listeners = new Set();
  const cancelTimer = () => { if (timer !== undefined) timing.clearTimeout(timer); timer = undefined; };
  const publish = next => { state = next; for (const listener of listeners) listener(); };
  const receive = message => {
    if (disposed || message.clientId !== clientId || typeof message.enabled !== "boolean" || !Array.isArray(message.students) || !message.assignments || typeof message.assignments !== "object") return;
    cancelTimer();
    const chatFont = message.chatFont === "openai" ? "openai" : "gyeonggi-consolas";
    globalThis.document?.documentElement?.setAttribute("data-azrael-chat-font", chatFont);
    publish({ enabled: message.enabled, chatFont, students: message.students, assignments: message.assignments, loading: false, saving: false, error: typeof message.error === "string" ? message.error : null });
  };
  const unsubscribe = bridge.subscribe("azrael-design-state", receive);
  const send = (action, value) => {
    if (disposed && action !== "unsubscribe") return;
    cancelTimer();
    if (action !== "unsubscribe") {
      timer = timing.setTimeout(() => {
        timer = undefined;
        if (!disposed) publish({ ...state, loading: false, saving: false, error: {
          en: "Design settings did not respond. Select Reload to try again.",
          ko: "디자인 설정 응답을 받지 못했습니다. 다시 불러오기를 눌러 확인해 주세요." } });
      }, 10000);
      timer?.unref?.();
    }
    try { bridge.dispatchMessage("azrael-design", { clientId, action, ...(action === "setEnabled" ? { enabled: value } : action === "setChatFont" ? { chatFont: value } : {}) }); }
    catch (error) { cancelTimer(); if (!disposed) publish({ ...state, loading: false, saving: false, error: String(error.message ?? error) }); }
  };
  send("subscribe");
  return { getSnapshot: () => state, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setEnabled: enabled => { if (disposed || state.loading || state.saving) return; publish({ ...state, saving: true, error: null }); send("setEnabled", enabled); },
    setChatFont: chatFont => { if (disposed || state.loading || state.saving || !["openai", "gyeonggi-consolas"].includes(chatFont)) return; publish({ ...state, saving: true, error: null }); send("setChatFont", chatFont); },
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

function pickStudentPreview(students, previousId, random = Math.random) {
  const others = students.filter(student => student.id !== previousId);
  const pool = others.length ? others : students;
  return pool.length ? pool[Math.floor(random() * pool.length)].id : null;
}

function AzraelDesignSettings() {
  initAzraelSettingsCard();
  initAzraelSettingsRow();
  initAzraelSwitch();
  initAzraelFontChoice();
  const locale = te().locale;
  const t = (english, korean) => azraelSettingsText(locale, english, korean);
  const state = useAzraelDesignState();
  const [previewId, setPreviewId] = Q.useState(null);
  const [failedId, setFailedId] = Q.useState(null);
  const student = state.students.find(item => item.id === previewId);
  Q.useEffect(() => {
    if (!state.loading && state.students.length && !student) setPreviewId(previous => pickStudentPreview(state.students, previous));
  }, [state.loading, state.students, student]);
  const busy = state.loading || state.saving;
  const draw = () => setPreviewId(previous => pickStudentPreview(state.students, previous));
  return (0, $.jsx)(Tt, { title: t("Design", "디자인"), children: (0, $.jsxs)("div", {
    className: "flex flex-col gap-10", "data-azrael-design-settings": true, "aria-busy": busy, children: [
      (0, $.jsx)(AzraelSettingsCard, { children: (0, $.jsx)(AzraelSettingsRow, {
        label: t("Chat and input font", "채팅 및 입력란 폰트"),
        description: t("Choose the font for chat messages and the input field. Default: Gyeonggi + Consolas.", "채팅 메시지와 입력란에 사용할 폰트를 선택합니다. 기본값은 경기천년체 + Consolas입니다."),
        control: ariaProps => (0, $.jsx)(AzraelFontChoice, {
          ariaLabelledBy: ariaProps["aria-labelledby"], ariaLabel: t("Chat and input font", "채팅 및 입력란 폰트"),
          selectedId: state.chatFont, variant: "inset", onSelect: value => azraelDesignStore.setChatFont(value),
          options: [{ id: "openai", label: t("OpenAI default", "OpenAI 기본 폰트"), disabled: busy },
            { id: "gyeonggi-consolas", label: t("Gyeonggi + Consolas", "경기천년체 + Consolas"), disabled: busy }] })
      }) }),
      (0, $.jsx)(AzraelSettingsCard, { children: (0, $.jsx)(AzraelSettingsRow, {
        label: t("Use student photos for new subagents", "새 subagent에 학생 사진 사용"),
        description: t("Randomly assign student photos to newly created subagents. Off by default; existing photo assignments are retained.", "켜면 새로 생성되는 subagent에 학생 사진을 무작위로 배정합니다. 기본값은 꺼짐이며, 이미 배정된 사진은 유지됩니다."),
        control: ariaProps => (0, $.jsx)(AzraelSwitch, { ...ariaProps, checked: state.enabled,
          disabled: busy || state.students.length === 0, onChange: enabled => azraelDesignStore.setEnabled(enabled) })
      }) }),
      (0, $.jsxs)("section", { className: "flex flex-col gap-4", "aria-labelledby": "azrael-student-preview-title", children: [
        (0, $.jsxs)("div", { className: "flex flex-col gap-1", children: [
          (0, $.jsx)("h2", { id: "azrael-student-preview-title", className: "text-lg font-semibold text-default", children: t("Photo preview", "사진 미리보기") }),
          (0, $.jsx)("p", { className: "text-sm text-secondary", children: t("Preview one random student photo at a time. The preview does not change photo assignments or settings.", "학생 사진을 한 장씩 무작위로 확인하세요. 미리보기는 사진 배정이나 설정을 바꾸지 않습니다.") })
        ] }),
        (0, $.jsx)(AzraelSettingsCard, { children: (0, $.jsx)(AzraelSettingsRow, {
          label: (0, $.jsxs)("div", { className: "flex items-center gap-4", children: [
            (0, $.jsx)("div", { className: "flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary",
              style: { width: "calc(var(--spacing) * 20 / 3)", height: "calc(var(--spacing) * 20 / 3)" }, children:
              student && failedId !== previewId ? (0, $.jsx)("img", { src: student.url, alt: student.nameEn,
                className: "size-full object-contain", draggable: false, onError: () => setFailedId(previewId) })
                : (0, $.jsx)("span", { className: "px-2 text-center text-xs text-secondary", children:
                  state.loading ? t("Loading…", "불러오는 중…") : student ? t("Unable to load photo", "사진을 불러오지 못했습니다") : t("No preview", "미리보기 없음") }) }),
            (0, $.jsx)("div", { className: "flex min-w-0 flex-col gap-1", "aria-live": "polite", children:
              (0, $.jsx)("span", { className: "text-sm font-medium text-default", children: student?.nameEn ?? t("Student photo", "학생 사진") }) })
          ] }),
          control: () => (0, $.jsx)(pe, { color: "secondary", size: "default", disabled: state.loading || !state.students.length,
            onClick: draw, children: t("Draw again", "다시 뽑기") })
        }) })
      ] }),
      state.loading || state.saving ? (0, $.jsx)("p", { className: "text-sm text-secondary", role: "status", children:
        state.loading ? t("Loading design settings…", "디자인 설정을 불러오는 중…") : t("Saving…", "저장 중…") }) : null,
      state.error ? (0, $.jsxs)("div", { className: "flex flex-wrap items-center gap-3 text-sm text-secondary", role: "alert", children: [
        (0, $.jsx)("span", { children: typeof state.error === "string" ? state.error : t(state.error.en, state.error.ko) }),
        (0, $.jsx)(pe, { color: "ghost", size: "toolbar", disabled: busy, onClick: () => azraelDesignStore.retry(), children: t("Reload", "다시 불러오기") })
      ] }) : null
    ]
  }) });
}

function once(text, from, to) {
  if (text.split(from).length !== 2) throw new Error("Pinned student design anchor changed: " + from);
  return text.replace(from, to);
}

function observeStudentCreated(message, commands) {
  const item = message?.params?.item;
  if (message?.method !== "item/completed") return;
  // V2 creation emits a completed activity item with kind "started".
  // Both native spawn paths share the host's durable, per-thread decision.
  const ids = item?.type === "subAgentActivity" && item.kind === "started" ? [item.agentThreadId]
    : item?.type === "collabAgentToolCall" && item.tool === "spawnAgent" && item.status === "completed" && Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : [];
  for (const id of new Set(ids)) {
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
    // Subscribe at native bridge initialization even if no subagent avatar or settings page renders.
    text = once(text, 'Dm=Em.getInstance(),B2e((e,t)=>{Dm.dispatchMessage(e,t)})', 'Dm=Em.getInstance(),B2e((e,t)=>{Dm.dispatchMessage(e,t)}),queueMicrotask(()=>{azraelDesignStore??=createDesignStore(Dm,crypto.randomUUID())})');
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
  text = once(text, 'c=e.slug===`azrael-instructions`?', 'c=e.slug===`azrael-design`?{id:`azrael.settings.design`,defaultMessage:azraelSettingsText(O.locale,`Design`,`디자인`)}:e.slug===`azrael-instructions`?');
  text = once(text, 'label:e.slug===`azrael-instructions`?', 'label:e.slug===`azrael-design`?azraelSettingsText(O.locale,`Design`,`디자인`):e.slug===`azrael-instructions`?');
  text = once(text, 'f=e.slug===`azrael-instructions`?', 'f=e.slug===`azrael-design`?azraelSettingsText(O.locale,`Design`,`디자인`):e.slug===`azrael-instructions`?');
  text = once(text, 'icon:e.slug===`azrael-instructions`?', 'icon:e.slug===`azrael-design`?(0,Z.jsx)(AzraelDesignNavigationIcon,{className:t?`text-codex-icon-active`:void 0}):e.slug===`azrael-instructions`?');
  text = once(text, 'iconAssetSource:e.slug===`azrael-instructions`?', 'iconAssetSource:e.slug===`azrael-design`?void 0:e.slug===`azrael-instructions`?');
  return { text: 'import{azraelDesignStore,useAzraelDesignState,d3 as AzraelSettingsCard,f3 as initAzraelSettingsCard,y3 as AzraelSettingsRow,x3 as initAzraelSettingsRow}from"./app-initial-5120fa5fe295.js";import{r4 as AzraelSwitch,a4 as initAzraelSwitch,Tf as AzraelFontChoice,Ef as initAzraelFontChoice}from"./app-initial-532d60c9b397.js";' + text + '\n' + MARKER + '\n' + pickStudentPreview.toString() + '\n' + AzraelDesignSettings.toString() + '\n' + AzraelDesignNavigationIcon.toString(), count: 1 };
}

module.exports = { DESIGN_ASSETS, MARKER, injectStudentDesign, createDesignStore, AzraelStudentAvatar, AzraelDesignSettings, pickStudentPreview, observeStudentCreated, AzraelDesignNavigationIcon };

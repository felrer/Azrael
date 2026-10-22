"use strict";

const INSTRUCTION_SETTINGS_ASSETS = ["webview/assets/use-visible-settings-sections-7686bdcccd03.js", "webview/assets/settings-page-f0054e44de3c.js"];
const MARKER = "/*azrael-instruction-settings-v1*/";
const PAGE_ANCHOR = "}let B;e[72]";
const HOST_ANCHOR = 'case"open-vscode-command":{';

function azraelSettingsText(locale, english, korean) {
  return typeof locale === "string" && /^ko(?:[-_]|$)/i.test(locale) ? korean : english;
}

// Serialized into the native and standalone clients. No filesystem or credentials.
function instructionClientTools(root) {
    const drafts = new Map(), filters = new Map(), disclosures = new Map();
    const versionChoices = new Map();
    let listScroll = 0, previousDetail = false, selectedId = '';
    const scroller = () => {
        let node = root.host;
        while (node) {
            if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(root.ownerDocument.defaultView.getComputedStyle(node).overflowY))
                return node;
            node = node.parentElement;
        }
        return root.ownerDocument?.scrollingElement;
    };
    const suggest = (name) => {
        const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/, '');
        return /[^\x00-\x7f]/.test(name) || !ascii ? (ascii || 'skill') + '-' + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12) : ascii;
    };
    const value = (name, scope = root) => scope.querySelector('[data-field="' + name + '"]')?.value;
    const capture = () => {
        const editor = root.querySelector('[data-editor-id]');
        if (editor?.dataset.editorId)
            drafts.set(editor.dataset.editorId, [...editor.querySelectorAll('[data-field],textarea[data-file-path]')].map(e => ({ field: e.dataset.field, path: e.dataset.filePath, value: e.value })));
        for (const e of root.querySelectorAll('[data-filter]'))
            filters.set(e.dataset.filter, e.value);
        for (const e of root.querySelectorAll('details'))
            disclosures.set(e.dataset.disclosure ?? e.querySelector('summary')?.textContent, e.open);
        for (const e of root.querySelectorAll('[data-version-controls]'))
            if (!e.closest('[data-library-browse][hidden]'))
                versionChoices.set(e.dataset.versionControls, { from: value('from-digest', e), to: value('to-digest', e) });
        const browse = root.querySelector('[data-library-browse]');
        if (browse && !browse.hidden)
            listScroll = scroller()?.scrollTop ?? 0;
        previousDetail = !!browse?.hidden;
    };
    const filter = () => {
        const search = root.querySelector('[data-filter="search"]')?.value.toLowerCase() ?? '';
        const kind = root.querySelector('[data-filter="kind"]')?.value;
        const sharing = root.querySelector('[data-filter="sharing"]')?.value;
        const source = root.querySelector('[data-filter="source"]')?.value;
        const state = root.querySelector('[data-filter="state"]')?.value;
        let count = 0;
        for (const e of root.querySelectorAll('.library-entry')) {
            e.hidden = !(e.dataset.name.toLowerCase().includes(search) && (!kind || e.dataset.kind === kind) && (!sharing || e.dataset.sharing === sharing) && (!source || e.dataset.source === source) && (!state || e.dataset.state === state));
            if (!e.hidden)
                count++;
        }
        const counter = root.querySelector('[data-result-count]'), empty = root.querySelector('[data-no-results]');
        if (counter)
            counter.textContent = String(count);
        if (empty)
            empty.hidden = count > 0;
        const catalog = root.querySelector('[data-catalog]');
        if (catalog)
            catalog.dataset.layout = root.querySelector('[data-filter="layout"]')?.value ?? 'list';
    };
    const file = (target) => {
        if (target?.dataset.field === 'create-name') {
            const installation = root.querySelector('[data-field="create-installation-name"]');
            if (installation && (!installation.value || installation.dataset.suggested === installation.value)) {
                installation.value = target.value.trim() ? suggest(target.value) : '';
                installation.dataset.suggested = installation.value;
            }
        }
        if (target?.dataset.field !== 'file-path')
            return;
        for (const e of root.querySelectorAll('[data-file-panel]'))
            e.hidden = e.dataset.filePanel !== target.value;
    };
    const restore = () => {
        const editor = root.querySelector('[data-editor-id]');
        const draft = drafts.get(editor?.dataset.editorId);
        if (draft)
            for (const e of editor.querySelectorAll('[data-field],textarea[data-file-path]')) {
                const saved = draft.find((d) => d.field === e.dataset.field && d.path === e.dataset.filePath);
                if (saved)
                    e.value = saved.value;
            }
        for (const e of root.querySelectorAll('[data-filter]'))
            if (filters.has(e.dataset.filter))
                e.value = filters.get(e.dataset.filter);
        for (const e of root.querySelectorAll('details')) {
            const key = e.dataset.disclosure ?? e.querySelector('summary')?.textContent;
            if (disclosures.has(key))
                e.open = disclosures.get(key);
        }
        for (const e of root.querySelectorAll('[data-version-controls]')) {
            const saved = versionChoices.get(e.dataset.versionControls);
            if (saved)
                for (const [field, choice] of [['from-digest', saved.from], ['to-digest', saved.to]]) {
                    const select = e.querySelector('[data-field="' + field + '"]');
                    if (select && [...select.options].some(o => o.value === choice))
                        select.value = choice;
                }
        }
        file(root.querySelector('[data-field="file-path"]'));
        filter();
        const browse = root.querySelector('[data-library-browse]'), scroll = scroller();
        if (browse && previousDetail !== browse.hidden) {
            if (scroll)
                scroll.scrollTop = browse.hidden ? 0 : listScroll;
            if (!browse.hidden && selectedId)
                [...root.querySelectorAll('button[data-action="librarySelect"]')].find(e => e.dataset.id === selectedId)?.focus({ preventScroll: true });
        }
    };
    const error = (failure) => {
        let alert = root.querySelector('[data-client-error]');
        if (!alert) {
            alert = root.ownerDocument.createElement('p');
            alert.setAttribute('role', 'alert');
            root.append(alert);
        }
        alert.textContent = failure instanceof Error ? failure.message : String(failure);
    };
    const payload = (button) => {
        const action = button.dataset.action, id = button.dataset.id;
        const revision = Number(root.querySelector('[data-library-revision]')?.dataset.libraryRevision);
        if (action === 'librarySelect') {
            selectedId = id;
            return { id };
        }
        if (action === 'libraryImport' || action === 'libraryOpenInstalled')
            return id ? { id } : {};
        if (action === 'librarySetSkillEnabled')
            return { id, enabled: button.dataset.enabled === 'true' };
        if (action === 'libraryPlanDelete')
            return { id, removeInstallation: !!button.closest('[data-delete-id]')?.querySelector('[data-field="remove-installation"]')?.checked };
        if (action === 'librarySetSource') {
            const sourceMode = value('source-mode'), sourceProject = value('source-project');
            if (sourceMode === 'project' && !sourceProject)
                throw new Error('Select a source project / 소스 프로젝트를 선택하세요.');
            return { sourceMode, ...(sourceMode === 'project' ? { sourceProject } : {}) };
        }
        if (action === 'librarySetProject')
            return { project: value('project') };
        if (action === 'libraryPlanMigrate')
            return { id };
        if (action === 'libraryPlanAcquire') {
            const scope = button.closest('[data-version-controls]') ?? [...root.querySelectorAll('.library-reading [data-version-controls]')].find(e => e.dataset.versionControls === id);
            if (!scope)
                throw new Error('Select an available version / 사용 가능한 버전을 선택하세요.');
            return { id, digest: value('to-digest', scope), ...(root.querySelector('[data-field=install-enabled]') ? { enabled: !!root.querySelector('[data-field=install-enabled]').checked } : {}) };
        }
        if (action === 'libraryCompare' || action === 'libraryInspectVersion') {
            const scope = button.closest('[data-version-controls]');
            return action === 'libraryCompare' ? { id, fromDigest: value('from-digest', scope), toDigest: value('to-digest', scope) } : { id, digest: value('to-digest', scope) };
        }
        if (['libraryApply', 'libraryAcquire', 'libraryPublish', 'libraryStartTask', 'libraryDelete', 'libraryMigrate'].includes(action))
            return { token: button.dataset.token };
        if (action === 'libraryCreate') {
            const name = value('create-name'), kind = value('create-kind'), sharing = value('create-sharing');
            if (!name?.trim())
                throw new Error('Enter a resource name / 리소스 이름을 입력하세요.');
            const explicit = value('create-installation-name')?.trim();
            const identifier = explicit || suggest(name);
            if (kind === 'skill' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identifier))
                throw new Error('Use lowercase ASCII letters, numbers and hyphens / 영문 소문자, 숫자, 하이픈을 사용하세요.');
            const path = kind === 'skill' ? 'SKILL.md' : kind === 'agent-role' ? 'role.toml' : kind === 'playbook' ? 'PLAYBOOK.md' : 'CONTEXT.md';
            const content = kind === 'skill' ? '---\nname: ' + identifier + '\ndescription: Describe this skill.\n---\n\n# ' + name + '\n' : kind === 'agent-role' ? 'description = ' + JSON.stringify(name) + '\ndeveloper_instructions = """\nDescribe this agent role.\n"""\n' : '# ' + name + '\n';
            return kind === 'task-profile' ? { name, kind, sharing, profile: { model: '', dependencies: [] } } : { name, kind, sharing, files: [{ path, encoding: 'utf8', content }] };
        }
        if (action === 'librarySave') {
            const editor = root.querySelector('[data-editor-id]');
            const json = value('profile', editor);
            const result = { id, name: value('name', editor), sharing: value('sharing', editor), revision };
            if (json !== undefined)
                result.profile = JSON.parse(json);
            else
                result.files = [...editor.querySelectorAll('textarea[data-file-path]')].map(e => ({ path: e.dataset.filePath, encoding: e.dataset.encoding, content: e.value }));
            return result;
        }
        if (action === 'libraryPlanApply')
            return { ids: [id], ...(root.querySelector('[data-field=install-enabled]') ? { enabled: !!root.querySelector('[data-field=install-enabled]').checked } : {}) };
        if (action === 'libraryPlanPublish') {
            const repository = value('publish-repository');
            if (!repository)
                throw new Error('Select a publish repository / 게시 대상 저장소를 선택하세요.');
            return { ids: [id], version: value('publish-version'), repository };
        }
        if (action === 'libraryPrepareTask')
            return { id, model: value('model'), provider: value('provider') || undefined, reasoningEffort: value('reasoningEffort') || undefined };
        if (action === 'libraryConnect' || action === 'libraryRemoteRefresh' || action === 'libraryRemoteImport') {
            const scope = button.closest('[data-connection]');
            return action === 'libraryConnect' ? { sharing: button.dataset.sharing, repository: value('repository', scope), branch: value('branch', scope) } : action === 'libraryRemoteImport' ? { sharing: button.dataset.sharing, repository: value('repository', scope), version: value('remote-version', scope) } : { sharing: button.dataset.sharing, repository: value('repository', scope) };
        }
        return {};
    };
    return { capture, restore, filter, file, payload, error };
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
    const tools = instructionClientTools(root);
    const send = (action, message) => {
      requestId = String(++sequence);
      azraelInstructionBridge.dispatchMessage("azrael-instructions", { clientId, requestId, action, message, locale });
    };
    const payload = () => ({ version: root.querySelector("#instruction-version")?.value,
      componentIds: [...root.querySelectorAll("input[data-component]:checked")].map(e => e.dataset.component) });
    const unsubscribe = azraelInstructionBridge.subscribe("azrael-instructions-state", message => {
      if (!mounted || message.clientId !== clientId || message.requestId !== requestId || typeof message.html !== "string") return;
      tools.capture(); root.innerHTML = message.html; tools.restore();
      busy = root.querySelector('main[aria-busy="true"]') !== null;
    });
    const onClick = event => {
      const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
      if (!(button instanceof HTMLElement) || button.disabled || busy) return;
      try {
        const message = button.dataset.action.startsWith("library") ? tools.payload(button) : { ...payload(), path: button.dataset.path };
        busy = true; send(button.dataset.action, message);
      } catch (error) { tools.error(error); }
    };
    const onChange = event => {
      tools.filter(); tools.file(event.target);
      if (!(event.target instanceof HTMLElement) || event.target.dataset.action !== "selectVersion") return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (mounted && !busy) { busy = true; send("selectVersion", payload()); } }, 150);
    };
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    const onInput = () => tools.filter();
    root.addEventListener("input", onInput);
    root.innerHTML = '<p role="status">' + azraelSettingsText(locale, "Loading instruction documents…", "지침 문서를 불러오는 중…") + '</p>';
    send("mount");
    return () => { mounted = false; clearTimeout(timer); send("unmount"); unsubscribe(); root.removeEventListener("click", onClick); root.removeEventListener("change", onChange); root.removeEventListener("input", onInput); root.innerHTML = ""; };
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
  return { text: 'import{X9t as azraelInstructionBridge}from"./app-initial-c014f9ee4429.js";' + text + '\n' + MARKER + '\n' + azraelSettingsText.toString() + '\n' + instructionClientTools.toString() + '\n' + AzraelInstructionSettings.toString() + '\n' + AzraelInstructionNavigationIcon.toString(), count: 1 };
}

module.exports = { INSTRUCTION_SETTINGS_ASSETS, MARKER, injectInstructionSettings, AzraelInstructionSettings, AzraelInstructionNavigationIcon, azraelSettingsText, instructionClientTools };

"use strict";

// Shared by the injected query and presentation chunks. The factory is serialized
// into the pinned webview; keep it independent of Node and module-scope state.
function createProviderModelCatalog() {
  const hosts = new Map();
  const labels = { openai: "OpenAI", api: "API", devin: "Devin", anthropic: "Anthropic", openrouter: "OpenRouter", google: "Google AI Studio", "google-antigravity": "Google Antigravity", xai: "xAI" };
  const empty = Object.freeze({ loading: false, providers: [], updatedAt: 0, error: false });
  function host(id) {
    if (!hosts.has(id)) hosts.set(id, { snapshot: empty, listeners: new Set(), force: false, pending: null, result: null, refreshAfterPending: false });
    return hosts.get(id);
  }
  function publish(id, update) {
    const item = host(id);
    item.snapshot = { ...item.snapshot, ...update };
    for (const listener of item.listeners) listener();
  }
  function providerFor(id) {
    if (id.startsWith("api/")) return "api";
    if (id.startsWith("devin/")) return "devin";
    if (id.startsWith("managed/")) return id.split("/")[1] || "other";
    return "openai";
  }
  function title(option) {
    if (typeof option.label === "string") return option.label;
    return option.label?.props?.displayName ?? option.id;
  }
  function groups(options, query, providers = []) {
    const needle = query.trim().toLocaleLowerCase();
    const rows = new Map();
    rows.set("api", { id: "api", label: "API", total: 0, options: [] });
    for (const option of options) {
      const id = providerFor(option.id);
      if (!rows.has(id)) rows.set(id, { id, label: labels[id] ?? id, total: 0, options: [] });
      const group = rows.get(id);
      group.total++;
      if (!needle || `${title(option)} ${option.id} ${group.label}`.toLocaleLowerCase().includes(needle)) group.options.push(option);
    }
    for (const status of providers) {
      if (/^api-[a-f0-9]{32}$/.test(status.providerId)) {
        const group = rows.get("api");
        const severity = { empty: 0, ready: 1, stale: 2, error: 3 };
        if (!group.status || (severity[status.state] ?? 0) > (severity[group.status.state] ?? 0)) group.status = { ...status, providerId: "api" };
        continue;
      }
      if (!rows.has(status.providerId)) rows.set(status.providerId, { id: status.providerId, label: labels[status.providerId] ?? status.providerId, total: 0, options: [] });
      rows.get(status.providerId).status = status;
    }
    const order = ["openai", "api", "devin", "anthropic", "openrouter", "google", "google-antigravity", "xai"];
    return [...rows.values()].sort((a, b) => {
      const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.label.localeCompare(b.label);
    }).filter(group => !needle || group.options.length > 0);
  }
  async function query(id, client, pageSize, invalidate, requestOptions) {
    const item = host(id);
    // Read-only consumers (such as branching) share discovery without retiring
    // the picker's refresh callback.
    if (invalidate !== undefined) item.invalidate = invalidate;
    if (item.pending) return item.pending;
    if (item.result && !item.force) return item.result;
    const force = item.force;
    item.force = false;
    publish(id, { loading: true, error: false });
    item.pending = (async () => {
      // Assign the shared promise before a synchronous client-lookup failure
      // reaches finally, otherwise that rejected promise would stay cached.
      await Promise.resolve();
      try {
        const data = [], seenIds = new Set(), cursors = new Set();
        let cursor = null, providers = [];
        for (let page = 0; page < 100; page++) {
          const result = await client().sendRequest("model/list", {
            includeHidden: true, cursor, limit: Math.min(Math.max(pageSize || 100, 1), 500),
            ...(force && cursor === null ? { refresh: true } : {}),
          }, requestOptions);
          if (!Array.isArray(result?.data)) throw new Error("invalid_model_catalog");
          if (cursor === null && Array.isArray(result.providerCatalogs)) providers = result.providerCatalogs;
          for (const model of result.data) {
            if (typeof model?.model !== "string") throw new Error("invalid_model_catalog");
            if (!seenIds.has(model.model)) {
              seenIds.add(model.model);
              const tagged = { ...model, __azraelCatalogHost: id };
              // Account catalogs may lag behind Astra's API capabilities. The
              // native tier resolver needs this row to retain the selected tier.
              if (model.model === "gpt-6-astra" && !(model.serviceTiers ?? []).some(tier => tier.id === "ultrafast")) {
                tagged.serviceTiers = [...(model.serviceTiers ?? []), {
                  id: "ultrafast", name: "Ultrafast", description: "Ultrafast processing",
                }];
              }
              data.push(tagged);
            }
          }
          if (data.length > 10000) throw new Error("model_catalog_limit");
          cursor = result.nextCursor;
          if (cursor == null) {
            publish(id, { loading: false, providers, updatedAt: Date.now(), error: false });
            item.result = { data, nextCursor: null, providerCatalogs: providers };
            return item.result;
          }
          if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) throw new Error("invalid_model_cursor");
          cursors.add(cursor);
        }
        throw new Error("model_catalog_page_limit");
      } catch (error) {
        publish(id, { loading: false, error: true });
        // Do not pass upstream response/error text into the webview diagnostics.
        throw new Error("모델 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
      } finally {
        item.pending = null;
        if (item.refreshAfterPending) {
          item.refreshAfterPending = false;
          item.force = true;
          Promise.resolve(item.invalidate?.()).catch(() => publish(id, { loading: false, error: true }));
        }
      }
    })();
    return item.pending;
  }
  return {
    query, groups, title, providerFor,
    efforts(models, id, fallback) {
      if (!id?.startsWith("managed/") && !id?.startsWith("api/")) return fallback();
      const model = models?.find(model => model.model === id);
      const allowed = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
      const efforts = (model?.supportedReasoningEfforts ?? []).filter(option => allowed.includes(option.reasoningEffort));
      const defaultEffort = efforts.some(option => option.reasoningEffort === model?.defaultReasoningEffort)
        ? model.defaultReasoningEffort : efforts[0]?.reasoningEffort ?? null;
      Object.defineProperties(efforts, {
        __azraelManagedEfforts: { value: true },
        __azraelDefaultEffort: { value: defaultEffort },
      });
      return efforts;
    },
    modelEffort(model, previous, fallback) {
      const choices = this.efforts([model], model.model, () => null);
      return choices === null ? fallback() : this.selectEffort(previous, choices, fallback);
    },
    selectEffort(previous, efforts, fallback) {
      if (!efforts.__azraelManagedEfforts) return fallback();
      return efforts.some(option => option.reasoningEffort === previous) ? previous : efforts.__azraelDefaultEffort;
    },
    tag(result, id) {
      // Runs after the query library's structural sharing so even an empty
      // selected array retains the scope needed by loading/error presentation.
      if (Array.isArray(result.data?.models)) Object.defineProperty(result.data.models, "__azraelCatalogHost", { value: id, configurable: true });
      return result;
    },
    singleHost: () => hosts.size === 1 ? hosts.keys().next().value : undefined,
    snapshot: id => id == null ? empty : host(id).snapshot,
    subscribe(id, listener) { if (id == null) return () => {}; const item = host(id); item.listeners.add(listener); return () => item.listeners.delete(listener); },
    retry(id) {
      if (id == null) return;
      const item = host(id);
      if (item.snapshot.loading || !item.invalidate) return;
      item.force = true;
      Promise.resolve(item.invalidate()).catch(() => publish(id, { loading: false, error: true }));
    },
    sessionCreated(id) {
      if (id == null) return;
      const item = host(id);
      item.force = true;
      if (item.pending) { item.refreshAfterPending = true; return; }
      if (item.invalidate) Promise.resolve(item.invalidate()).catch(() => publish(id, { loading: false, error: true }));
    },
    notification(event) {
      if (event?.method === "account/updated") this.sessionCreated(event.hostId);
    },
  };
}

// Existing menu items continue to own model/effort selection and disabled states.
function renderProviderModelList(React, jsx, Menu, catalog, props) {
  const hostId = props.hostId ?? props.options.find(option => option.catalogHost)?.catalogHost ?? catalog.singleHost();
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState({});
  const [snapshot, setSnapshot] = React.useState(() => catalog.snapshot(hostId));
  const root = React.useRef(null);
  React.useEffect(() => {
    const update = () => setSnapshot(catalog.snapshot(hostId));
    const unsubscribe = catalog.subscribe(hostId, update);
    update();
    return unsubscribe;
  }, [catalog, hostId]);
  // Filtering moves rows under a stationary cursor. The browser then emits hover
  // boundary and synthetic move events; Radix item handlers react by focusing the
  // menu content or the row now under the cursor, blurring the search field
  // mid-typing. Ignore those while the field has focus; a real pointer move
  // (changed coordinates) still lets items take focus as usual.
  React.useEffect(() => {
    const element = root.current;
    if (!element?.addEventListener) return undefined;
    const last = {};
    const guard = event => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      const point = `${event.clientX},${event.clientY}`;
      const moved = point !== last[event.type];
      last[event.type] = point;
      if (!element.ownerDocument?.activeElement?.matches?.("[data-azrael-model-search]")) return;
      if (event.type === "pointermove" || event.type === "mousemove") { if (!moved) event.stopPropagation(); return; }
      event.stopPropagation();
    };
    const types = ["pointermove", "mousemove", "pointerout", "pointerover", "mouseout", "mouseover"];
    for (const type of types) element.addEventListener(type, guard, true);
    return () => { for (const type of types) element.removeEventListener(type, guard, true); };
  }, []);
  const groups = catalog.groups(props.options, query, snapshot.providers);
  const selectedProvider = catalog.providerFor(props.options.find(option => option.selected)?.id ?? "");
  const search = query.trim().length > 0;
  const statusText = group => {
    if (snapshot.loading) return "불러오는 중…";
    if (group.status?.state === "stale") return "갱신 실패 · 이전 목록";
    if (group.status?.state === "error") return "목록 조회 실패";
    if (group.status?.state === "empty") return "사용 가능한 채팅 모델 없음";
    return "";
  };
  return jsx("div", {
    ref: root, "data-azrael-provider-models": true,
    onKeyDownCapture: event => {
      if (!["Tab", "ArrowDown", "ArrowUp"].includes(event.key)) return;
      if (event.target.matches?.("[data-azrael-model-search]") && event.key !== "Tab") return;
      const menu = root.current?.closest('[role="menu"]') ?? root.current;
      const items = Array.from(menu?.querySelectorAll('[role^="menuitem"]:not([data-disabled]):not([data-interactive="false"]),[data-azrael-model-search],[data-azrael-model-refresh]:not(:disabled),[data-azrael-api-manage]') ?? [])
        .filter(item => !item.closest('[inert],[hidden],[aria-hidden="true"]'));
      const current = items.findIndex(item => item === event.target || item.contains(event.target));
      if (current < 0 || items.length === 0) return;
      const backwards = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey);
      event.preventDefault(); event.stopPropagation();
      items[(current + (backwards ? -1 : 1) + items.length) % items.length].focus();
    },
    children: [
      jsx("style", { children: ".azrael-model-search{position:sticky;top:0;z-index:2;background:var(--vscode-menu-background,var(--color-token-main-surface-primary));padding:6px 4px}.azrael-model-search input{box-sizing:border-box;width:100%;min-width:240px;border:1px solid var(--vscode-input-border,#8886);border-radius:7px;padding:7px 9px;background:var(--vscode-input-background,transparent);color:inherit;font:inherit;outline-offset:2px}.azrael-model-status{font-size:12px;opacity:.8;padding:4px 8px}.azrael-provider-heading{display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px;font-weight:600}.azrael-model-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:2px 4px}.azrael-model-toolbar button{border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;padding:4px}.azrael-model-toolbar button:disabled{opacity:.5;cursor:default}" }),
      jsx("div", { className: "azrael-model-search", children: [
        jsx("input", {
          type: "search", value: query, "data-azrael-model-search": true, placeholder: "모델 이름 또는 ID 검색", "aria-label": "모델 이름 또는 ID 검색",
          onChange: event => setQuery(event.target.value),
          onPointerMove: event => event.stopPropagation(),
          onKeyDown: event => {
            if (event.key === "Escape") return;
            event.stopPropagation();
            if (event.key === "ArrowDown") {
              event.preventDefault();
              Array.from(root.current?.querySelectorAll('[data-azrael-model-option]:not([data-disabled])') ?? [])
                .find(item => !item.closest('[inert],[hidden],[aria-hidden="true"]'))?.focus();
            }
          },
        }),
        jsx("div", { className: "azrael-model-toolbar", children: [
          jsx("span", { role: "status", "aria-live": "polite", className: "azrael-model-status", children: snapshot.loading ? "모델 목록 불러오는 중…" : snapshot.error ? "목록 갱신 실패 · 다시 시도해 주세요" : search ? `${groups.reduce((sum, group) => sum + group.options.length, 0)}개 검색됨` : "공급자별 모델" }),
          jsx("button", { type: "button", "data-azrael-model-refresh": true, disabled: snapshot.loading || hostId == null, onClick: event => { event.preventDefault(); event.stopPropagation(); catalog.retry(hostId); }, onKeyDown: event => { if (event.key !== "Escape") event.stopPropagation(); }, children: snapshot.error || snapshot.providers.some(provider => ["error", "stale"].includes(provider.state)) ? "다시 시도" : "새로고침" }),
        ] }),
      ] }),
      ...groups.map(group => {
        const open = search || (expanded[group.id] ?? group.id === selectedProvider);
        const status = statusText(group);
        return jsx("div", { role: "group", "aria-label": group.label, children: [
          jsx(Menu.Item, {
            "aria-expanded": open, "data-azrael-provider": group.id,
            onSelect: event => { event.preventDefault(); setExpanded(previous => ({ ...previous, [group.id]: !open })); },
            children: jsx("span", { className: "azrael-provider-heading", children: [jsx("span", { children: `${open ? "▾" : "▸"} ${group.label}` }), jsx("span", { children: search ? `${group.options.length}/${group.total}` : String(group.total) })] }),
          }),
          status ? jsx("div", { className: "azrael-model-status", role: "status", children: status }) : null,
          group.id === "api" && group.total === 0 ? jsx("div", { className: "azrael-model-status", role: "status", children: "등록된 API 모델이 없습니다." }) : null,
          ...(open ? group.options.map(option => props.renderOption({ ...option, __azraelModelOption: true })) : []),
        ] }, group.id);
      }),
      groups.length === 0 ? jsx("div", { className: "azrael-model-status", role: "status", children: search ? "검색 결과가 없습니다." : snapshot.loading ? "모델 목록을 불러오는 중입니다." : "표시할 모델이 없습니다." }) : null,
      jsx("div", { className: "azrael-model-toolbar", children: jsx("button", { type: "button", "data-azrael-api-manage": true, onClick: event => { event.preventDefault(); event.stopPropagation(); globalThis.__azraelOpenApiConnections?.(); }, onKeyDown: event => { if (event.key !== "Escape") event.stopPropagation(); }, children: "API 연결 관리" }) }),
    ],
  });
}

module.exports = { createProviderModelCatalog, renderProviderModelList };

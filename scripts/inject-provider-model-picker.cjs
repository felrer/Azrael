"use strict";

const { createProviderModelCatalog, renderProviderModelList } = require("./provider-model-picker.cjs");
const { renderAstraSpeedToggle } = require("./astra-speed-toggle.cjs");
const PROVIDER_PICKER_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const PROVIDER_QUERY_ASSET = "webview/assets/app-initial-c014f9ee4429.js";
const PROVIDER_PICKER_ASSETS = [PROVIDER_PICKER_ASSET, PROVIDER_QUERY_ASSET];
const MARKER = "/*azrael-provider-model-picker-xQ*/";

function once(text, before, after, expected = 1) {
  const count = text.split(before).length - 1;
  if (count !== expected) throw new Error(`Pinned provider-model picker anchor must occur ${expected} times (found ${count}): ${before.slice(0, 90)}`);
  return text.split(before).join(after);
}
function bootstrap() {
  return `\nvar __azraelProviderCatalog=globalThis.__azraelProviderCatalogV1??=((${createProviderModelCatalog.toString()})());\n`;
}
function injectProviderModelPicker(text, asset) {
  if (!PROVIDER_PICKER_ASSETS.includes(asset)) return { text, count: 0 };
  const markerCount = text.split(MARKER).length - 1;
  if (markerCount === 1) return { text, count: 0 };
  if (markerCount > 1) throw new Error("Duplicate provider model-picker marker");
  if (asset === PROVIDER_QUERY_ASSET) {
    // zJe pinned event bus is lazy. Register only after its singleton exists;
    // module-level subscriptions run before the Webview bootstrap initializes it.
    text = once(text, "vm=_m.getInstance(),j4e((e,t)=>{vm.dispatchMessage(e,t)})",
      "vm=_m.getInstance(),globalThis.__azraelOpenApiConnections=()=>vm.dispatchMessage(\"open-vscode-command\",{command:\"azrael.apiConnections\"}),vm.subscribe(\"mcp-notification\",event=>__azraelProviderCatalog.notification(event)),j4e((e,t)=>{vm.dispatchMessage(e,t)})");
    text = once(text,
      "Bp(f,i).sendRequest(`model/list`,{includeHidden:!0,cursor:null,limit:s},{priority:t})",
      "__azraelProviderCatalog.query(i,()=>Bp(f,i),s,()=>d.invalidateQueries({queryKey:g}),{priority:t})");
    const select = "Cbe({additionalAvailableModels:new Set(e),apiKeyDaybreakSupported:h,authMethod:t,availableModels:v.availableModels,defaultModel:v.defaultModel,enabledReasoningEfforts:_,hasConfiguredModelCatalog:r,includeUltraReasoningEffort:y,isCustomModelProvider:o,models:n,useHiddenModels:v.useHiddenModels})";
    text = once(text, select, `__azraelProviderCatalog.tag(${select},i)`);
    text += bootstrap();
  } else {
    text = once(text, "emitRequestLifecycleEvent(e){for(let t of this.requestLifecycleListeners)",
      "emitRequestLifecycleEvent(e){if(e.type===`completed`&&e.method===`thread/start`)__azraelProviderCatalog.sessionCreated(e.hostId);for(let t of this.requestLifecycleListeners)");
    const visible = "function IJr({additionalAvailableModels:e,apiKeyDaybreakSupported:t,authMethod:n,availableModels:r,hasConfiguredModelCatalog:i,isCustomModelProvider:a,model:o,useHiddenModels:s}){let c=o.availableAccessPrograms?.cyber;return";
    text = once(text, visible, visible.replace("{let c=", "{if(!o.hidden&&(o.model.startsWith(`managed/`)||o.model.startsWith(`devin/`)||o.model.startsWith(`api/`)))return!0;let c="));
    const effortOptions = "t=(n===`copilot`?[e.find(e=>e.reasoningEffort===`medium`)??{reasoningEffort:`medium`,description:`medium effort`}]:e).filter(({reasoningEffort:e})=>yC(e)&&a.has(e))";
    text = once(text, effortOptions, "t=(i.model.startsWith(`managed/`)||i.model.startsWith(`api/`))?e.filter(({reasoningEffort:e})=>yC(e)&&e!==`persistent`):" + effortOptions.slice(2));
    const efforts = "function dQ(e,t){let n=e?.find(e=>e.model===t);return n==null?Pzt.map(e=>({description:``,reasoningEffort:e})):n.supportedReasoningEfforts.filter(e=>yC(e.reasoningEffort)&&e.reasoningEffort!==`persistent`)}";
    text = once(text, efforts, "function dQ(e,t){return __azraelProviderCatalog.efforts(e,t,()=>{" + efforts.slice(efforts.indexOf("let n="), -1) + "})}");
    const selection = "function Z6r(e,t){return yC(e)&&t.some(t=>t.reasoningEffort===e)?e:s2e(e,t.map(e=>e.reasoningEffort))}";
    text = once(text, selection, "function Z6r(e,t){return __azraelProviderCatalog.selectEffort(e,t,()=>" + selection.slice(selection.indexOf("return ") + 7, -1) + ")}");
    // Provider-default effort stays null; the compact trigger uses the neutral icon.
    text = once(text, "function rca(e){return ica[e]}", "function rca(e){return ica[e==null?`none`:e]}");
    text = once(text, "a=r.flatMap(({reasoningEffort:e})=>", "a=(r??[]).flatMap(({reasoningEffort:e})=>");
    text = once(text, "(a.length>0?a:[`medium`]).map(e=>({id:`${n}:${e}`",
      "((n.startsWith(`managed/`)||n.startsWith(`api/`))?a:a.length?a:[`medium`]).map(e=>({id:`${n}:${e}`");
    text = once(text, "G=R===void 0||R", "G=(R===void 0||R)&&(!(p?.startsWith(`managed/`)||p?.startsWith(`api/`))||dQ(h,p).length>0)");
    const powerReset = "function _Jr({canInitializePowerPicker:e,fallbackPowerSelection:t,menuView:n,selectedPowerSelection:r,showXHighInSimplePicker:i}){";
    text = once(text, powerReset, powerReset + "if(r?.model?.startsWith(`managed/`)||r?.model?.startsWith(`api/`))return;");
    text = once(text, "let kt=TX(Ot,Tt==null?void 0:`${Tt.model}:${Tt.defaultReasoningEffort}`)",
      "let kt=TX(Ot,(Oe.startsWith(`managed/`)||Oe.startsWith(`api/`))?`${Oe}:${__azraelProviderCatalog.efforts(yt,Oe,()=>[]).__azraelDefaultEffort??null}`:Tt==null?void 0:`${Tt.model}:${Tt.defaultReasoningEffort}`)");
    // Native max/ultra translations remain; provider-default null gets a label.
    for (const [key, count] of [["l.reasoningEffort", 1], ["u.reasoningEffort", 1], ["n", 1], ["Ze", 1], ["bt", 2], ["e.reasoningEffort", 1], ["t", 1], ["w", 1]]) {
      text = once(text, `P8[${key}]`, `__azraelReasoningLabel(${key})`, count);
    }
    text = once(text, "toa[e.reasoningEffort]", "toa[e.reasoningEffort]??__azraelReasoningLabel(e.reasoningEffort)");
    text = once(text, "id:t.model,isLocked:t.model===u,label:", "id:t.model,catalogHost:t.__azraelCatalogHost,isLocked:t.model===u,label:");
    text = once(text, "Te={beforeModels:he,defaultOption:Ce,options:we}", "Te={beforeModels:he,defaultOption:Ce,options:we,providerGroups:!0,catalogHost:g?.__azraelCatalogHost}");
    // The unified native options keep their original selection/lock callbacks.
    // Include the model catalog in the compiled memo dependency for host tagging.
    text = once(text, "function lCa(e){let t=(0,uCa.c)(134)", "function lCa(e){let t=(0,uCa.c)(135)");
    text = once(text, "t[59]!==he||t[60]!==Ce||t[61]!==we?", "t[59]!==he||t[60]!==Ce||t[61]!==we||t[134]!==g?");
    text = once(text, "t[59]=he,t[60]=Ce,t[61]=we,t[62]=Te", "t[59]=he,t[60]=Ce,t[61]=we,t[134]=g,t[62]=Te");
    text = once(text, "function ssa(e){let t=(0,dsa.c)(130)", "function ssa(e){let t=(0,dsa.c)(131)");
    text = once(text, "He=c.options.map(e)", "He=c.providerGroups?(0,K8.jsx)(__AzraelProviderModelList,{hostId:c.catalogHost,options:c.options,renderOption:e}):c.options.map(e)");
    text = once(text, "t[99]!==D||t[100]!==c.options||t[101]!==h", "t[99]!==D||t[100]!==c||t[101]!==h");
    text = once(text, "t[99]=D,t[100]=c.options,t[101]=h,t[102]=He", "t[99]=D,t[100]=c,t[101]=h,t[102]=He");
    text = once(text, "if(!(t instanceof HTMLElement)||e.key===`Tab`", "if(!(t instanceof HTMLElement)||t.closest(`[data-azrael-provider-models]`)||e.key===`Tab`");
    text = once(text, '"data-model-selected":e.selected||void 0,disabled:e.disabled,', '"data-model-selected":e.selected||void 0,"data-azrael-model-option":e.__azraelModelOption||void 0,disabled:e.disabled,');
    const nativeEffort = "t.supportedReasoningEfforts.find(e=>{let{reasoningEffort:t}=e;return t===j})?.reasoningEffort??t.defaultReasoningEffort";
    text = once(text, nativeEffort, `__azraelProviderCatalog.modelEffort(t,j,()=>${nativeEffort})`);
    // Override only Astra's speed control after the native compiled memo blocks.
    // Both the two-tier toggle and the multi-tier submenu become one cycling item.
    text = once(text, "let ae;t[69]!==m||t[70]!==a",
      "if(l?.model===`gpt-6-astra`&&o!=null){re=null;ie=(0,W8.jsx)(__AzraelAstraSpeedToggle,{selectedServiceTier:u,onSelectServiceTier:o,disabled:I||f,hidden:I,maximum:L,intl:m})}let ae;t[69]!==m||t[70]!==a");
    text += bootstrap() + `
function __azraelReasoningLabel(e){return P8[e]??{id:"azrael.reasoning.automatic",defaultMessage:"Automatic",description:"Provider default reasoning effort when no explicit effort is selected"}}
function __AzraelProviderModelList(props){return (${renderProviderModelList.toString()}) (G8,K8.jsx,PR,__azraelProviderCatalog,props)}
function __AzraelAstraSpeedToggle(props){return (${renderAstraSpeedToggle.toString()})(W8.jsx,PR,{standard:BXt,fast:HXt},R8,props)}
`;
  }
  return { text: text + "\n" + MARKER, count: 1 };
}
module.exports = { PROVIDER_PICKER_ASSET, PROVIDER_QUERY_ASSET, PROVIDER_PICKER_ASSETS, PROVIDER_PICKER_MARKER: MARKER, injectProviderModelPicker };

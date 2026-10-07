"use strict";

const { createProviderModelCatalog, renderProviderModelList } = require("./provider-model-picker.cjs");
const { renderAstraSpeedToggle } = require("./astra-speed-toggle.cjs");
const PROVIDER_PICKER_ASSET = "webview/assets/app-initial-532d60c9b397.js";
const PROVIDER_QUERY_ASSET = "webview/assets/app-initial-5120fa5fe295.js";
const PROVIDER_PICKER_ASSETS = [PROVIDER_PICKER_ASSET, PROVIDER_QUERY_ASSET];
const MARKER = "/*azrael-provider-model-picker-v1*/";

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
    // The pinned event bus is lazy. Register only after its singleton exists;
    // module-level subscriptions run before the Webview bootstrap initializes it.
    text = once(text, "Dm=Em.getInstance(),B2e((e,t)=>{Dm.dispatchMessage(e,t)})",
      "Dm=Em.getInstance(),Dm.subscribe(\"mcp-notification\",event=>__azraelProviderCatalog.notification(event)),B2e((e,t)=>{Dm.dispatchMessage(e,t)})");
    text = once(text,
      "zu(f,i).sendRequest(`model/list`,{includeHidden:!0,cursor:null,limit:s},{priority:n})",
      "__azraelProviderCatalog.query(i,()=>zu(f,i),s,()=>d.invalidateQueries({queryKey:nPt(i,t,s)}),{priority:n})");
    const select = "KUe({additionalAvailableModels:new Set(e),authMethod:t,availableModels:m.availableModels,defaultModel:m.defaultModel,enabledReasoningEfforts:p,hasConfiguredModelCatalog:r,includeUltraReasoningEffort:h,isCustomModelProvider:o,models:n,useHiddenModels:m.useHiddenModels})";
    text = once(text, select, `__azraelProviderCatalog.tag(${select},i)`);
    text += bootstrap();
  } else {
    text = once(text, "emitRequestLifecycleEvent(e){for(let t of this.requestLifecycleListeners)",
      "emitRequestLifecycleEvent(e){if(e.type===`completed`&&e.method===`thread/start`)__azraelProviderCatalog.sessionCreated(e.hostId);for(let t of this.requestLifecycleListeners)");
    const visible = "function ibr({additionalAvailableModels:e,authMethod:t,availableModels:n,hasConfiguredModelCatalog:r,isCustomModelProvider:i,model:a,useHiddenModels:o}){return";
    text = once(text, visible, visible.replace("{return", "{if(!a.hidden&&(a.model.startsWith(`managed/`)||a.model.startsWith(`devin/`)))return!0;return"));
    const effortOptions = "n=(t===`copilot`?[e.find(e=>e.reasoningEffort===`medium`)??{reasoningEffort:`medium`,description:`medium effort`}]:e).filter(({reasoningEffort:e})=>ZC(e)&&i.has(e))";
    text = once(text, effortOptions, "n=r.model.startsWith(`managed/`)?e.filter(({reasoningEffort:e})=>ZC(e)&&e!==`persistent`):" + effortOptions.slice(2));
    const efforts = "function HQ(e,t){let n=e?.find(e=>e.model===t);return n==null?UPt.map(e=>({description:``,reasoningEffort:e})):n.supportedReasoningEfforts.filter(e=>ZC(e.reasoningEffort)&&e.reasoningEffort!==`persistent`)}";
    text = once(text, efforts, "function HQ(e,t){return __azraelProviderCatalog.efforts(e,t,()=>{" + efforts.slice(efforts.indexOf("let n="), -1) + "})}");
    const selection = "function NVr(e,t){return ZC(e)&&t.some(t=>t.reasoningEffort===e)?e:S5e(e,t.map(e=>e.reasoningEffort))}";
    text = once(text, selection, "function NVr(e,t){return __azraelProviderCatalog.selectEffort(e,t,()=>" + selection.slice(selection.indexOf("return ") + 7, -1) + ")}");
    // Provider-default effort stays null; the compact trigger uses the neutral icon.
    text = once(text, "function UQi(e){return WQi[e]}", "function UQi(e){return WQi[e==null?`none`:e]}");
    text = once(text, "a=r.flatMap(({reasoningEffort:e})=>", "a=(r??[]).flatMap(({reasoningEffort:e})=>");
    text = once(text, "(a.length>0?a:[`medium`]).map(e=>({id:`${n}:${e}`",
      "(n.startsWith(`managed/`)?a:a.length?a:[`medium`]).map(e=>({id:`${n}:${e}`");
    text = once(text, "ne=R===void 0||R", "ne=(R===void 0||R)&&(!p?.startsWith(`managed/`)||HQ(h,p).length>0)");
    const powerReset = "function Ryr({canInitializePowerPicker:e,fallbackPowerSelection:t,menuView:n,selectedPowerSelection:r,showXHighInSimplePicker:i}){";
    text = once(text, powerReset, powerReset + "if(r?.model?.startsWith(`managed/`))return;");
    text = once(text, "let pt=YJ(ft,lt==null?void 0:`${lt.model}:${lt.defaultReasoningEffort}`)",
      "let pt=YJ(ft,Ee.startsWith(`managed/`)?`${Ee}:${__azraelProviderCatalog.efforts(we,Ee,()=>[]).__azraelDefaultEffort??null}`:lt==null?void 0:`${lt.model}:${lt.defaultReasoningEffort}`)");
    // Native max/ultra translations remain; provider-default null gets a label.
    for (const [key, count] of [["l.reasoningEffort", 2], ["n", 1], ["Xe", 1], ["it", 2], ["e.reasoningEffort", 1], ["t", 1], ["w", 1]]) {
      text = once(text, `F8[${key}]`, `__azraelReasoningLabel(${key})`, count);
    }
    text = once(text, "VZi[e.reasoningEffort]", "VZi[e.reasoningEffort]??__azraelReasoningLabel(e.reasoningEffort)");
    text = once(text, "id:t.model,isLocked:t.model===u,label:", "id:t.model,catalogHost:t.__azraelCatalogHost,isLocked:t.model===u,label:");
    text = once(text, "Ce={beforeModels:me,defaultOption:xe,options:Se}", "Ce={beforeModels:me,defaultOption:xe,options:Se,providerGroups:!0,catalogHost:g?.__azraelCatalogHost}");
    // The unified native options keep their original selection/lock callbacks.
    // Include the model catalog in the compiled memo dependency for host tagging.
    text = once(text, "function xra(e){let t=(0,Sra.c)(131)", "function xra(e){let t=(0,Sra.c)(132)");
    text = once(text, "t[56]!==me||t[57]!==xe||t[58]!==Se?", "t[56]!==me||t[57]!==xe||t[58]!==Se||t[131]!==g?");
    text = once(text, "t[56]=me,t[57]=xe,t[58]=Se,t[59]=Ce", "t[56]=me,t[57]=xe,t[58]=Se,t[131]=g,t[59]=Ce");
    text = once(text, "function mQi(e){let t=(0,vQi.c)(129)", "function mQi(e){let t=(0,vQi.c)(130)");
    text = once(text, "Ue=c.options.map(e)", "Ue=c.providerGroups?(0,q8.jsx)(__AzraelProviderModelList,{hostId:c.catalogHost,options:c.options,renderOption:e}):c.options.map(e)");
    text = once(text, "t[98]!==D||t[99]!==c.options||t[100]!==h", "t[98]!==D||t[99]!==c||t[100]!==h");
    text = once(text, "t[98]=D,t[99]=c.options,t[100]=h,t[101]=Ue", "t[98]=D,t[99]=c,t[100]=h,t[101]=Ue");
    text = once(text, "if(!(t instanceof HTMLElement))return;if(e.key===`Enter`", "if(!(t instanceof HTMLElement)||t.closest(`[data-azrael-provider-models]`))return;if(e.key===`Enter`");
    text = once(text, '"data-model-selected":e.selected||void 0,disabled:e.disabled,', '"data-model-selected":e.selected||void 0,"data-azrael-model-option":e.__azraelModelOption||void 0,disabled:e.disabled,');
    const nativeEffort = "t.supportedReasoningEfforts.find(e=>{let{reasoningEffort:t}=e;return t===j})?.reasoningEffort??t.defaultReasoningEffort";
    text = once(text, nativeEffort, `__azraelProviderCatalog.modelEffort(t,j,()=>${nativeEffort})`);
    // Override only Astra's speed control after the native compiled memo blocks.
    // Both the two-tier toggle and the multi-tier submenu become one cycling item.
    text = once(text, "let ae;t[69]!==m||t[70]!==F",
      "if(l?.model===`gpt-6-astra`&&o!=null){re=null;ie=(0,G8.jsx)(__AzraelAstraSpeedToggle,{selectedServiceTier:u,onSelectServiceTier:o,disabled:F||f,hidden:F,maximum:I,intl:m})}let ae;t[69]!==m||t[70]!==F");
    text += bootstrap() + `
function __azraelReasoningLabel(e){return F8[e]??{id:"azrael.reasoning.automatic",defaultMessage:"Automatic",description:"Provider default reasoning effort when no explicit effort is selected"}}
function __AzraelProviderModelList(props){return (${renderProviderModelList.toString()}) (K8,q8.jsx,nB,__azraelProviderCatalog,props)}
function __AzraelAstraSpeedToggle(props){return (${renderAstraSpeedToggle.toString()})(G8.jsx,nB,{standard:DGt,fast:kGt},z8,props)}
`;
  }
  return { text: text + "\n" + MARKER, count: 1 };
}
module.exports = { PROVIDER_PICKER_ASSET, PROVIDER_QUERY_ASSET, PROVIDER_PICKER_ASSETS, PROVIDER_PICKER_MARKER: MARKER, injectProviderModelPicker };

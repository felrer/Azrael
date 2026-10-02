"use strict";

const { createProviderModelCatalog, renderProviderModelList } = require("./provider-model-picker.cjs");
const PROVIDER_PICKER_ASSET = "webview/assets/app-initial-9cbfb5c07b41.js";
const PROVIDER_QUERY_ASSET = "webview/assets/app-initial-4bd9e54bcd58.js";
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
    text = once(text,
      "Ru(f,i).sendRequest(`model/list`,{includeHidden:!0,cursor:null,limit:s},{priority:n})",
      "__azraelProviderCatalog.query(i,()=>Ru(f,i),s,()=>d.invalidateQueries({queryKey:nMt(i,t,s)}),{priority:n})");
    const select = "mIe({additionalAvailableModels:new Set(e),authMethod:t,availableModels:m.availableModels,defaultModel:m.defaultModel,enabledReasoningEfforts:p,hasConfiguredModelCatalog:r,includeUltraReasoningEffort:h,isCustomModelProvider:o,models:n,useHiddenModels:m.useHiddenModels})";
    text = once(text, select, `__azraelProviderCatalog.tag(${select},i)`);
    text += bootstrap();
  } else {
    text = once(text, "emitRequestLifecycleEvent(e){for(let t of this.requestLifecycleListeners)",
      "emitRequestLifecycleEvent(e){if(e.type===`completed`&&e.method===`thread/start`)__azraelProviderCatalog.sessionCreated(e.hostId);for(let t of this.requestLifecycleListeners)");
    const visible = "function q_r({additionalAvailableModels:e,authMethod:t,availableModels:n,hasConfiguredModelCatalog:r,isCustomModelProvider:i,model:a,useHiddenModels:o}){return";
    text = once(text, visible, visible.replace("{return", "{if(!a.hidden&&(a.model.startsWith(`managed/`)||a.model.startsWith(`devin/`)))return!0;return"));
    const effortOptions = "n=(t===`copilot`?[e.find(e=>e.reasoningEffort===`medium`)??{reasoningEffort:`medium`,description:`medium effort`}]:e).filter(({reasoningEffort:e})=>WC(e)&&i.has(e))";
    text = once(text, effortOptions, "n=r.model.startsWith(`managed/`)?e.filter(({reasoningEffort:e})=>WC(e)&&e!==`persistent`):" + effortOptions.slice(2));
    const efforts = "function uZ(e,t){let n=e?.find(e=>e.model===t);return n==null?LNt.map(e=>({description:``,reasoningEffort:e})):n.supportedReasoningEfforts.filter(e=>WC(e.reasoningEffort)&&e.reasoningEffort!==`persistent`)}";
    text = once(text, efforts, "function uZ(e,t){return __azraelProviderCatalog.efforts(e,t,()=>{" + efforts.slice(efforts.indexOf("let n="), -1) + "})}");
    const selection = "function Hzr(e,t){return WC(e)&&t.some(t=>t.reasoningEffort===e)?e:CGe(e,t.map(e=>e.reasoningEffort))}";
    text = once(text, selection, "function Hzr(e,t){return __azraelProviderCatalog.selectEffort(e,t,()=>" + selection.slice(selection.indexOf("return ") + 7, -1) + ")}");
    text = once(text, "a=r.flatMap(({reasoningEffort:e})=>", "a=(r??[]).flatMap(({reasoningEffort:e})=>");
    text = once(text, "(a.length>0?a:[`medium`]).map(e=>({id:`${n}:${e}`",
      "(n.startsWith(`managed/`)?a:a.length?a:[`medium`]).map(e=>({id:`${n}:${e}`");
    text = once(text, "te=R===void 0||R", "te=(R===void 0||R)&&(!p?.startsWith(`managed/`)||uZ(h,p).length>0)");
    const powerReset = "function D_r({canInitializePowerPicker:e,fallbackPowerSelection:t,menuView:n,selectedPowerSelection:r,showXHighInSimplePicker:i}){";
    text = once(text, powerReset, powerReset + "if(r?.model?.startsWith(`managed/`))return;");
    text = once(text, "let pt=aJ(ft,lt==null?void 0:`${lt.model}:${lt.defaultReasoningEffort}`)",
      "let pt=aJ(ft,Ee.startsWith(`managed/`)?`${Ee}:${et.__azraelDefaultEffort??null}`:lt==null?void 0:`${lt.model}:${lt.defaultReasoningEffort}`)");
    // Native max/ultra translations remain; provider-default null gets a label.
    for (const [key, count] of [["l.reasoningEffort", 2], ["n", 1], ["Xe", 1], ["it", 2], ["e.reasoningEffort", 1], ["t", 1], ["w", 1]]) {
      text = once(text, `z8[${key}]`, `__azraelReasoningLabel(${key})`, count);
    }
    text = once(text, "JJi[e.reasoningEffort]", "JJi[e.reasoningEffort]??__azraelReasoningLabel(e.reasoningEffort)");
    text = once(text, "id:t.model,isLocked:t.model===u,label:", "id:t.model,catalogHost:t.__azraelCatalogHost,isLocked:t.model===u,label:");
    text = once(text, "Se={beforeModels:pe,defaultOption:be,options:xe}", "Se={beforeModels:pe,defaultOption:be,options:xe,providerGroups:!0,catalogHost:g?.__azraelCatalogHost}");
    // The unified native options keep their original selection/lock callbacks.
    // Include the model catalog in the compiled memo dependency for host tagging.
    text = once(text, "function Rea(e){let t=(0,zea.c)(131)", "function Rea(e){let t=(0,zea.c)(132)");
    text = once(text, "t[56]!==pe||t[57]!==be||t[58]!==xe?", "t[56]!==pe||t[57]!==be||t[58]!==xe||t[131]!==g?");
    text = once(text, "t[56]=pe,t[57]=be,t[58]=xe,t[59]=Se", "t[56]=pe,t[57]=be,t[58]=xe,t[131]=g,t[59]=Se");
    text = once(text, "function xYi(e){let t=(0,TYi.c)(129)", "function xYi(e){let t=(0,TYi.c)(129)");
    text = once(text, "He=c.options.map(e)", "He=c.providerGroups?(0,Z8.jsx)(__AzraelProviderModelList,{hostId:c.catalogHost,options:c.options,renderOption:e}):c.options.map(e)");
    text = once(text, "t[98]!==D||t[99]!==c.options||t[100]!==h", "t[98]!==D||t[99]!==c||t[100]!==h");
    text = once(text, "t[98]=D,t[99]=c.options,t[100]=h,t[101]=He", "t[98]=D,t[99]=c,t[100]=h,t[101]=He");
    text = once(text, "if(!(t instanceof HTMLElement))return;if(e.key===`Enter`", "if(!(t instanceof HTMLElement)||t.closest(`[data-azrael-provider-models]`))return;if(e.key===`Enter`");
    text = once(text, '"data-model-selected":e.selected||void 0,disabled:e.disabled,', '"data-model-selected":e.selected||void 0,"data-azrael-model-option":e.__azraelModelOption||void 0,disabled:e.disabled,');
    const nativeEffort = "t.supportedReasoningEfforts.find(e=>{let{reasoningEffort:t}=e;return t===j})?.reasoningEffort??t.defaultReasoningEffort";
    text = once(text, nativeEffort, `__azraelProviderCatalog.modelEffort(t,j,()=>${nativeEffort})`);
    text += bootstrap() + `
ym.subscribe("mcp-notification",event=>__azraelProviderCatalog.notification(event));
function __azraelReasoningLabel(e){return z8[e]??{id:"azrael.reasoning.automatic",defaultMessage:"Automatic",description:"Provider default reasoning effort when no explicit effort is selected"}}
function __AzraelProviderModelList(props){return (${renderProviderModelList.toString()}) (X8,Z8.jsx,yz,__azraelProviderCatalog,props)}
`;
  }
  return { text: text + "\n" + MARKER, count: 1 };
}
module.exports = { PROVIDER_PICKER_ASSET, PROVIDER_QUERY_ASSET, PROVIDER_PICKER_ASSETS, PROVIDER_PICKER_MARKER: MARKER, injectProviderModelPicker };

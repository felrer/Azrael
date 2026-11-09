"use strict";

const AUTH_SHELL_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const MARKER = "/*azrael-auth-shell-v1*/";

// Keep the native editor, submit tooltip and picker components. Only their
// availability changes; connection recovery never calls the submission callback.
function useModelAdmission(React, catalog, props) {
  const models = Array.isArray(props.models) ? props.models : props.models?.models;
  const id = props.executionTargetHostId ?? models?.__azraelCatalogHost ?? catalog.singleHost();
  const [, update] = React.useState(0);
  React.useEffect(() => catalog.subscribe(id, () => update(value => value + 1)), [catalog, id]);
  const selected = props.selectedModel;
  const model = typeof selected === "string" ? selected : selected?.model ?? selected?.slug;
  const reason = catalog.admission(id, model);
  if (!reason) return props;
  return { ...props, submitDisabled: true, modelPickerDisabled: catalog.admission(id) != null || props.modelPickerDisabled,
    submissionBlocked: true, preparedPromptSubmissionBlocked: true,
    passiveSubmissionBlocked: true, modelConnectionBlockReason: reason,
    onSubmit: () => { throw new Error(reason); } };
}

function useSubmitAdmission(React, catalog, props) {
  const id = props.executionTargetHostId ?? catalog.singleHost();
  const [, update] = React.useState(0);
  React.useEffect(() => catalog.subscribe(id, () => update(value => value + 1)), [catalog, id]);
  const reason = catalog.admission(id);
  return reason ? { ...props, submitDisabled: true, disabledReason: reason,
    handleSubmit: () => { throw new Error(reason); },
    onResume: () => { throw new Error(reason); } } : props;
}

function injectAuthShell(text, asset) {
  if (asset !== AUTH_SHELL_ASSET) return { text, count: 0 };
  if (text.includes(MARKER)) return { text, count: 0 };
  const once = (before, after) => {
    if (text.split(before).length !== 2) throw Error(`Pinned auth shell anchor must occur once: ${before.slice(0, 80)}`);
    text = text.replace(before, after);
  };
  // Route admission belongs to the shell, not to Mgn's truthful account state.
  // Rendering does not wait for auth initialization or depend on OpenAI login.
  const start = text.indexOf("function Ski(e){"), end = text.indexOf("function Cki(){", start);
  if (start < 0 || end < start || text.indexOf("function Ski(e){", start + 1) >= 0) throw Error("Pinned auth shell route anchor must occur once");
  text = text.slice(0, start) + "function Ski(e){let n=Lu().pathname;return n===`/login`||n.startsWith(`/login/`)?(0,b2.jsx)(eu,{to:`/settings/usage`,replace:!0}):(0,b2.jsx)(_ki,{routes:e.routes})}" + text.slice(end);
  once('function Ypa(e){"use forget";', 'function Ypa(e){"use forget";e=__azraelUseModelAdmission(e);');
  once("function ewa(e){let t=", "function ewa(e){e=__azraelUseSubmitAdmission(e);let t=");
  once("function lCa(e){let t=", "function lCa(e){e=__azraelUsePickerAdmission(e);let t=");
  once("async sendRequest(e,t,n){if(this.dispatchMessage", "async sendRequest(e,t,n){if([`turn/start`,`thread/compact/start`].includes(e)){let r=__azraelProviderCatalog.admission(this.hostId,t?.model);if(r)throw Error(r)}if(this.dispatchMessage");
  // Preserve the native account UI and managed OAuth flow instead of exposing
  // the upstream root login page as another execution-authentication owner.
  text += `\nfunction __azraelUseModelAdmission(props){return (${useModelAdmission.toString()})(T5,__azraelProviderCatalog,props)}\nfunction __azraelUseSubmitAdmission(props){return (${useSubmitAdmission.toString()})(D7,__azraelProviderCatalog,props)}\nfunction __azraelUsePickerAdmission(props){let state=(${useSubmitAdmission.toString()})(G8,__azraelProviderCatalog,{...props,executionTargetHostId:props.models?.__azraelCatalogHost??props.modelOptions?.__azraelCatalogHost});return state.submitDisabled?{...props,disabled:true,reasoningEffortDisabled:true,reasoningEffortTooltip:state.disabledReason}:props}\n${MARKER}\n`;
  return { text, count: 1 };
}

module.exports = { AUTH_SHELL_ASSET, injectAuthShell, useModelAdmission, useSubmitAdmission };

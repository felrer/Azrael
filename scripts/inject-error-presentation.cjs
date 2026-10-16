"use strict";
const { describeTurnError } = require("../extensions/azrael-ex/src/errorPresentation.js");
const ERROR_PRESENTATION_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const ERROR_PRESENTATION_MARKER = "/*azrael-error-presentation-v1*/";
const ORIGINAL = 'function Zdn(e){if(e.willRetry||e.errorInfo===`misalignmentPolicyViolation`||utn({codexErrorInfo:e.errorInfo,message:e.message})!=null)return null;let t=yNe(e.message,Qdn);return t?.success?t.data.error.message:e.message}';
function replacement() {
  return ERROR_PRESENTATION_MARKER + describeTurnError.toString().replace("function describeTurnError(", "function azraelDescribeConversationError(") +
    'function Zdn(e){if(e.willRetry||e.errorInfo===`misalignmentPolicyViolation`||utn({codexErrorInfo:e.errorInfo,message:e.message})!=null)return null;let t=yNe(e.message,Qdn);return azraelDescribeConversationError({message:t?.success?t.data.error.message:e.message,codexErrorInfo:e.errorInfo})}';
}
function injectErrorPresentation(text, asset) {
  if (asset !== ERROR_PRESENTATION_ASSET) return { text, count: 0 };
  const markers = text.split(ERROR_PRESENTATION_MARKER).length - 1;
  if (markers > 1) throw Error("Duplicate error presentation marker");
  const patched = replacement();
  if (markers === 1) {
    if (!text.includes(patched) || text.includes(ORIGINAL)) throw Error("Damaged error presentation transform");
    return { text, count: 0 };
  }
  if (text.split(ORIGINAL).length !== 2) throw Error("Error presentation anchor must occur once");
  return { text: text.replace(ORIGINAL, patched), count: 1 };
}
module.exports = { ERROR_PRESENTATION_ASSET, ERROR_PRESENTATION_MARKER, injectErrorPresentation };

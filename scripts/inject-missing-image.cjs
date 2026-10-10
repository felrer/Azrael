"use strict";

const HOST_ASSET = "out/extension.js";
const LOADER_ASSET = "webview/assets/app-initial-c014f9ee4429.js";
const ATTACHMENT_ASSET = "webview/assets/user-message-attachments-f6a72702c1d3.js";
const ASSETS = [HOST_ASSET, LOADER_ASSET, ATTACHMENT_ASSET];
const MARKER = "/*azrael-missing-image-v1*/";

// Keep file absence distinct from access, transport and cancellation errors.
const RULES = {
 [HOST_ASSET]: [[
  'let n=await Ql({raw:WX(e),readUri:async i=>An.workspace.fs.readFile(i)}),o=await pA(n);',
  'let n=await Ql({fileNotFoundValue:null,raw:WX(e),readUri:async i=>An.workspace.fs.readFile(i)});'+MARKER+'if(n==null)return{contentsBase64:null,fileNotFound:!0};let o=await pA(n);'
 ]],
 [LOADER_ASSET]: [
  ['async function nw(e,t,n,r,i,a){let o=await Zwt(e,t,n,r,i,a);','async function nw(e,t,n,r,i,a,b){'+MARKER+'let o=await Zwt(e,t,n,r,i,a,b);'],
  ['async function Zwt(e,t,n,r,i,a){','async function Zwt(e,t,n,r,i,a,b){'],
  ['});return s.contentsBase64?{base64:s.contentsBase64,mimeType:$wt(o)}:null}catch(e){return vh.warning(`Failed to inline local image`,','});if(s.fileNotFound===!0){b?.();return null}return s.contentsBase64?{base64:s.contentsBase64,mimeType:$wt(o)}:null}catch(e){return vh.warning(`Failed to inline local image`,']
 ],
 [ATTACHMENT_ASSET]: [
  ['let[he,ge]=(0,In.useState)(me),I=','let[azraelMissingSource,azraelSetMissingSource]=(0,In.useState)(null);'+MARKER+'let[he,ge]=(0,In.useState)(me),I='],
  ['return ge(null),Je(e,j,k,void 0,r).then(e=>{t||ge(e)})','return ge(null),azraelSetMissingSource(null),Je(e,j,k,void 0,r,void 0,()=>{t||azraelSetMissingSource({src:n,hostId:j,conversationId:r})}).then(e=>{t||ge(e)})'],
  ['(0,In.useEffect)(G,Te),_e){','(0,In.useEffect)(G,Te),azraelMissingSource?.src===n&&azraelMissingSource.hostId===j&&azraelMissingSource.conversationId===r){return(0,$.jsx)(`div`,{className:`flex size-16 items-center justify-center rounded-lg border border-strong px-1 text-center text-[10px] leading-3 text-text/60`,role:`img`,"aria-label":"파일 없음",children:"파일 없음"})}if(_e){']
 ]
};

function occurrences(text, needle) { return text.split(needle).length - 1; }

function injectMissingImage(text, relativePath) {
  const rules = RULES[relativePath];
  if (!rules) return { text, count: 0 };
  if (text.includes(MARKER)) {
    if (occurrences(text, MARKER) !== 1 || !rules.every(([, replacement]) => occurrences(text, replacement) === 1)) {
      throw new Error(`Invalid missing-image transformation: ${relativePath}`);
    }
    return { text, count: 0 };
  }
  for (const [anchor, replacement] of rules) {
    const count = occurrences(text, anchor);
    if (count !== 1) throw new Error(`Pinned missing-image anchor must be unique: ${relativePath} (${count})`);
    text = text.replace(anchor, replacement);
  }
  return { text, count: 1 };
}

module.exports = { HOST_ASSET, LOADER_ASSET, ATTACHMENT_ASSET, ASSETS, MARKER, injectMissingImage };

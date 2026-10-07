"use strict";

const HOST_ASSET = "out/extension.js";
const LOADER_ASSET = "webview/assets/app-initial-5120fa5fe295.js";
const ATTACHMENT_ASSET = "webview/assets/user-message-attachments-8dd14a23c621.js";
const ASSETS = [HOST_ASSET, LOADER_ASSET, ATTACHMENT_ASSET];
const MARKER = "/*azrael-missing-image-v1*/";

// Keep file absence distinct from access, transport and cancellation errors.
const RULES = {
  [HOST_ASSET]: [
    ['let n=await jl({raw:bX(e),readUri:async i=>wn.workspace.fs.readFile(i)}),o=await oA(n);',
      `let n=await jl({fileNotFoundValue:null,raw:bX(e),readUri:async i=>wn.workspace.fs.readFile(i)});${MARKER}if(n==null)return{contentsBase64:null,fileNotFound:!0};let o=await oA(n);`],
  ],
  [LOADER_ASSET]: [
    ['async function BC(e,t,n,r,i,a){let o=await mSt(e,t,n,r,i,a);',
      `async function BC(e,t,n,r,i,a,b){${MARKER}let o=await mSt(e,t,n,r,i,a,b);`],
    ['async function mSt(e,t,n,r,i,a){', 'async function mSt(e,t,n,r,i,a,b){'],
    ['});return s.contentsBase64?{base64:s.contentsBase64,mimeType:gSt(o)}:null}catch(e){return Eh.warning(`Failed to inline local image`,',
      '});if(s.fileNotFound===!0){b?.();return null}return s.contentsBase64?{base64:s.contentsBase64,mimeType:gSt(o)}:null}catch(e){return Eh.warning(`Failed to inline local image`,'],
  ],
  [ATTACHMENT_ASSET]: [
    ['let[be,xe]=(0,yn.useState)(ye),N=',
      `let[azraelMissingSource,azraelSetMissingSource]=(0,yn.useState)(null);${MARKER}let[be,xe]=(0,yn.useState)(ye),N=`],
    ['return xe(null),ke(e,O,D,void 0,r).then(e=>{t||xe(e)})',
      'return xe(null),azraelSetMissingSource(null),ke(e,O,D,void 0,r,void 0,()=>{t||azraelSetMissingSource({src:n,hostId:O,conversationId:r})}).then(e=>{t||xe(e)})'],
    ['(0,yn.useEffect)(W,G),Se){',
      '(0,yn.useEffect)(W,G),azraelMissingSource?.src===n&&azraelMissingSource.hostId===O&&azraelMissingSource.conversationId===r){return(0,$.jsx)(`div`,{className:`flex size-20 items-center justify-center rounded-lg border border-strong px-1 text-center text-xs text-text/60`,role:`img`,"aria-label":"파일 없음",children:"파일 없음"})}if(Se){'],
  ],
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

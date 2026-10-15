"use strict";

const EDITOR_ASSET = "webview/assets/editor-5445e38990c9.js";
const STATE_ASSET = "webview/assets/composer-state-ce2239a4a82f.js";
const HOST_ASSET = "webview/assets/composer-host-68250d08cc40.js";
const COMPOSER_ASSET = "webview/assets/app-initial-7a199c66e670.js";
const ATTACHMENT_ASSET = "webview/assets/user-message-attachments-f6a72702c1d3.js";
const OVERLAY_ASSET = "webview/assets/overlay-89a80bed72d0.js";
const IMAGE_SKETCH_ASSETS = [EDITOR_ASSET, STATE_ASSET, HOST_ASSET, COMPOSER_ASSET, ATTACHMENT_ASSET, OVERLAY_ASSET];
const MARKER = "/*azrael-image-sketch-v1*/";

function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw Error("Image sketch pinned contract changed: " + before.slice(0, 90));
  return text.replace(before, after);
}

const EDITOR_PATCHES = [
  ["onRequestClose:d,onDone:ee}=e", "onRequestClose:d,onDone:ee,azraelBackground}=e"],
  // Native canvas coordinates use the image's logical dimensions. Its own fit
  // transform and object-fit:contain use the same centered aspect ratio.
  ["backgroundColor:L,clipboardScope:g,editor:a,surfaceSize:v,readOnly:M",
    "backgroundColor:azraelBackground?`transparent`:L,clipboardScope:g,editor:a,surfaceSize:azraelBackground?{width:azraelBackground.width,height:azraelBackground.height}:v,readOnly:M"],
  ["children:[Se,Ie,ze,Q]", "children:[azraelBackground?(0,$.jsx)(`img`,{src:azraelBackground.src,alt:``,draggable:!1,className:`pointer-events-none absolute inset-0 h-full w-full object-contain`,referrerPolicy:`no-referrer`}):null,Se,Ie,ze,Q]"],
];

const STATE_PATCHES = [
  ["let s=a.at(-1);return s==null?", "let s=n.azraelBackground?null:a.at(-1);return s==null?"],
  ["undoRetentionCount:0,openOptions:{...n}", "undoRetentionCount:0,azraelBackground:n.azraelBackground,openOptions:{...n}"],
  ["r.editor.export({backgroundColor:i.isDarkMode?`#212121`:`#ffffff`,padding:36,scale:1,mimeType:`image/png`})",
    "r.editor.export(r.azraelBackground?{outputBounds:{x:0,y:0,width:r.azraelBackground.width,height:r.azraelBackground.height},padding:0,scale:1,mimeType:`image/png`,drawBackground:ctx=>ctx.drawImage(r.azraelBackground.image,0,0,r.azraelBackground.width,r.azraelBackground.height)}:{backgroundColor:i.isDarkMode?`#212121`:`#ffffff`,padding:36,scale:1,mimeType:`image/png`})"],
];
const HOST_PATCHES = [
  ["editor:c.editor,isDarkMode:o,canSave:a", "editor:c.editor,azraelBackground:c.azraelBackground,isDarkMode:o,canSave:a"],
];

// Register against the native composer scope, never a global "active" thread.
function azraelUseImageSketchBridge(scope, open, stateRef, canOpen, composerId, reportFailure) {
  g5.useEffect(() => {
    let disposed = false, pending = false;
    const listener = event => {
      const request = event.detail;
      if (!request || request.scope !== scope || request.handled || !canOpen || pending || stateRef.current?.state.getSnapshot().active) return;
      request.handled = true;
      pending = true;
      const current = () => { const valid = !disposed && request.isCurrent(); if (!valid) pending = false; return valid; };
      const image = new Image();
      image.referrerPolicy = 'no-referrer';
      if (/^https?:/i.test(request.src)) image.crossOrigin = 'anonymous';
      image.src = request.src;
      image.decode().then(() => {
        if (!current()) return;
        if (!image.naturalWidth || !image.naturalHeight) throw Error('Image has no dimensions');
        const accepted = open({ azraelBackground: { src: request.src, image, width: image.naturalWidth, height: image.naturalHeight },
          isRequestCurrent: current, azraelOnOpened: accepted => { pending = false; if (accepted && current()) request.onOpened(); } });
        if (!accepted) { pending = false; reportFailure(); }
      }).catch(() => { pending = false; if (current()) reportFailure(); });
    };
    window.addEventListener('azrael:image-sketch', listener);
    return () => { disposed = true; window.removeEventListener('azrael:image-sketch', listener); };
  }, [scope, open, stateRef, canOpen, composerId]);
}

function azraelRequestImageSketch(scope, src, isCurrent, onOpened) {
  const detail = { scope, src, isCurrent, onOpened, handled: false };
  window.dispatchEvent(new CustomEvent('azrael:image-sketch', { detail }));
  return detail.handled;
}

function azraelImageSketchIcon(jsx) {
  return jsx('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, className: 'icon-sm', 'aria-hidden': true,
    children: jsx('path', { d: 'M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6 5-2' }) });
}

const COMPOSER_PATCHES = [
  ["let w=Jm(C),T;t[17]===w", "let w=Jm(C);azraelUseImageSketchBridge(l,w,m,a,r,()=>l.get(hx).danger(u.formatMessage({id:`azrael.sketch.imageLoadError`,defaultMessage:`Image sketch couldn't be opened. Please try again.`})));let T;t[17]===w"],
  ["m.current.state.openNew(t),m.current.state.getSnapshot().active!=null&&c?.()",
    "(t.azraelOnOpened??(()=>{}))(m.current.state.openNew(t)),m.current.state.getSnapshot().active!=null&&c?.()"],
  ["}).catch(()=>{i===h.current&&r()&&l.get(hx).danger", "}).catch(()=>{t.azraelOnOpened?.(!1);i===h.current&&r()&&l.get(hx).danger"],
  ["I=S&&n!=null,L,R,z,B,V;", "I=S&&n!=null,L,R,z,B,V;let azraelSketchScope=Ou(Dh),azraelSketchPreview=(0,b8.useRef)({});(0,b8.useEffect)(()=>()=>{azraelSketchPreview.current={open:!1}},[]);"],
  ["let H=P>0?P-1:null", "azraelSketchPreview.current={open:A,src:L?.src};let H=P>0?P-1:null"],
  ["image:{...L.overlayImage,imageRef:e=>Sh(M,L.overlayImage?.imageRef)(e)}", "image:{...L.overlayImage,azraelSketch:{scope:azraelSketchScope,src:L.src,isCurrent:()=>azraelSketchPreview.current.open&&azraelSketchPreview.current.src===L.src,onOpened:()=>z(!1)},imageRef:e=>Sh(M,L.overlayImage?.imageRef)(e)}"],
  ["editButton:fe,onPreviousImage:pe,onNextImage:me,portalContainer:l", "editButton:fe,toolbarActions:[{ariaLabel:E.locale?.startsWith(`ko`)?`사진 위에 그리기`:`Sketch on image`,icon:azraelImageSketchIcon(x8.jsx),onClick:()=>azraelRequestImageSketch(azraelSketchScope,L.src,()=>azraelSketchPreview.current.open&&azraelSketchPreview.current.src===L.src,()=>z(!1))}],onPreviousImage:pe,onNextImage:me,portalContainer:l"],
];

const ATTACHMENT_PATCHES = [
  ["P=b??fe,F=x??pe,me;", "P=b??fe,F=x??pe,me;let azraelSketchOpen=(0,In.useRef)(P);azraelSketchOpen.current=P;(0,In.useEffect)(()=>()=>{azraelSketchOpen.current=!1},[]);"],
  ["let R=ve&&L,z;", "let azraelSketchSource=(0,In.useRef)(I);azraelSketchSource.current=I;let R=ve&&L,z;"],
  ["editButton:Le,triggerContent:Ie", "editButton:Le,toolbarActions:M?[{ariaLabel:O.locale?.startsWith(`ko`)?`사진 위에 그리기`:`Sketch on image`,icon:azraelImageSketchIcon($.jsx),onClick:()=>azraelRequestImageSketch(D,I,()=>azraelSketchOpen.current&&azraelSketchSource.current===I,()=>F(!1))}]:void 0,triggerContent:Ie"],
  ["image:{alt:H,availableImageCount:E,imageRef:ie", "image:{azraelSketch:M?{scope:D,src:I,isCurrent:()=>azraelSketchOpen.current&&azraelSketchSource.current===I,onOpened:()=>F(!1)}:void 0,alt:H,availableImageCount:E,imageRef:ie"],
];
const OVERLAY_PATCHES = [
  ["let L;t[57]!==k||t[58]!==j.zoom", "if(n.azraelSketch){let title=I,request=n.azraelSketch;I=(...args)=>(0,E.jsxs)(`div`,{className:`flex min-w-0 items-center gap-2`,children:[title?.(...args),(0,E.jsx)(Fe,{uniform:!0,\"aria-label\":y.locale?.startsWith(`ko`)?`사진 위에 그리기`:`Sketch on image`,onClick:()=>azraelRequestImageSketch(request.scope,request.src,request.isCurrent,request.onOpened),children:azraelImageSketchIcon(E.jsx)})]})}let L;t[57]!==k||t[58]!==j.zoom"],
];

function injectImageSketch(text, asset) {
  const patches = ({ [EDITOR_ASSET]: EDITOR_PATCHES, [STATE_ASSET]: STATE_PATCHES, [HOST_ASSET]: HOST_PATCHES,
    [COMPOSER_ASSET]: COMPOSER_PATCHES, [ATTACHMENT_ASSET]: ATTACHMENT_PATCHES, [OVERLAY_ASSET]: OVERLAY_PATCHES })[asset];
  if (!patches) return { text, count: 0 };
  const marked = text.includes(MARKER);
  if (text.split(MARKER).length > 2) throw Error("Duplicate image sketch marker");
  for (const [before, after] of patches) {
    if (marked) {
      if (text.split(after).length !== 2) throw Error("Damaged image sketch transform");
    } else text = replaceOnce(text, before, after);
  }
  const helpers = asset === COMPOSER_ASSET ? [azraelUseImageSketchBridge,azraelRequestImageSketch,azraelImageSketchIcon].map(f=>f.toString()).join("\n") : [ATTACHMENT_ASSET,OVERLAY_ASSET].includes(asset) ? [azraelRequestImageSketch,azraelImageSketchIcon].map(f=>f.toString()).join("\n") : "";
  if (marked && helpers && !text.includes(helpers)) throw Error("Damaged image sketch helper");
  if (!marked && helpers) text += "\n" + helpers;
  return marked ? { text, count: 0 } : { text: text + "\n" + MARKER + "\n", count: 1 };
}

module.exports = { IMAGE_SKETCH_ASSETS, EDITOR_ASSET, STATE_ASSET, HOST_ASSET, COMPOSER_ASSET, ATTACHMENT_ASSET, OVERLAY_ASSET, MARKER, EDITOR_PATCHES, injectImageSketch };

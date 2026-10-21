// Static preview documents run with an opaque origin and no script permissions.
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function buildPreviewDocument({html='',css='',title='디자인 미리보기',stateId='normal',background='#ffffff',safeArea={}}={}) {
  // Parsed in an inert template. Only local visual markup survives into the frame.
  const template=document.createElement('template'); template.innerHTML=html;
  const clean = parent => {
    for (const el of [...parent.children]) {
      if (['SCRIPT','IFRAME','FRAME','OBJECT','EMBED','LINK','META','BASE','STYLE','TEMPLATE','NOSCRIPT'].includes(el.tagName.toUpperCase())) {el.remove();continue;}
      for (const attr of [...el.attributes]) {
        const name=attr.name.toLowerCase(),value=attr.value.trim();
        if (name.startsWith('on') || ['srcdoc','action','formaction','target','ping','download','autofocus','is','nonce','http-equiv'].includes(name) || (['href','xlink:href'].includes(name) && !value.startsWith('#')) || (name==='src' && !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);/i.test(value)) || name==='srcset') el.removeAttribute(attr.name);
      }
      clean(el);
    }
  }; clean(template.content);
  const insets=['top','right','bottom','left'].map(side=>`--preview-safe-${side}:${Number.isFinite(safeArea[side])?Math.max(0,Math.min(512,safeArea[side])):0}px`).join(';');
  const color=/^#[0-9a-f]{6}$/i.test(background)?background:'#ffffff';
  const safeCss=String(css).replace(/</g,'\\3c ');
  return `<!doctype html><html lang="ko" data-preview-state="${escape(stateId)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style>:root{${insets}}html,body{margin:0;min-height:100%;background:${color}}*{box-sizing:border-box}</style><style>${safeCss}</style></head><body data-preview-state="${escape(stateId)}">${template.innerHTML}</body></html>`;
}

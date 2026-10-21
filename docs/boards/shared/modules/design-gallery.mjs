import { buildPreviewDocument } from '../preview-document.mjs';

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const dimension = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 1;

/** HTML and CSS are isolated in sandboxed documents; all card copy is plain text. */
export function mountDesignGallery(root, { onSelect } = {}) {
  let props = {}, signature, cards = [], destroyed = false;
  root.classList.add('dg-root');
  function preview(item, background, width, height, representative) {
    const wrap = element('div', representative ? 'dg-preview' : 'dg-swatch-scroll');
    const slot = element('div', 'dg-slot');
    const iframe = element('iframe', 'dg-iframe');
    iframe.setAttribute('sandbox', ''); iframe.loading = 'lazy'; iframe.tabIndex = -1;
    iframe.title = `${item.title} — ${background.name ?? '대표 미리보기'}`;
    iframe.width = width; iframe.height = height;
    iframe.style.width = `${width}px`; iframe.style.height = `${height}px`;
    iframe.srcdoc = buildPreviewDocument({ html: item.html, css: item.css, title: item.title, stateId: props.stateId, background: background.color });
    slot.append(iframe); wrap.append(slot);
    if (representative) cards.push({ wrap, slot, iframe, width, height });
    else { slot.style.width = `${width}px`; slot.style.height = `${height}px`; }
    return wrap;
  }
  function layout() {
    if (destroyed) return;
    for (const { wrap, slot, iframe, width, height } of cards) {
      const scale = Math.max(.001, Math.min(Math.max(1, wrap.clientWidth - 32) / width, 280 / height));
      slot.style.width = `${width * scale}px`; slot.style.height = `${height * scale}px`;
      iframe.style.transform = `scale(${scale})`;
    }
  }
  function update(next) {
    if (destroyed) return;
    props = next ?? {};
    const nextSignature = JSON.stringify([props.items, props.backgrounds, props.sample, props.stateId]);
    if (signature !== nextSignature) {
      signature = nextSignature; cards = [];
      const width = dimension(props.sample?.width ?? 320), height = dimension(props.sample?.height ?? 180);
      const backgrounds = props.backgrounds ?? [];
      const items = (props.items ?? []).map(item => {
        const article = element('article', 'dg-card'); article.dataset.item = item.id;
        const heading = element('h3', 'dg-heading');
        const button = element('button', 'dg-select', item.title); button.type = 'button'; button.dataset.select = item.id;
        heading.append(button); article.append(heading);
        if (item.description) article.append(element('p', 'dg-description', item.description));
        article.append(preview(item, backgrounds[0] ?? { color: '#ffffff' }, width, height, true));
        const samples = element('div', 'dg-samples');
        for (const background of backgrounds) {
          const sample = element('section', 'dg-sample');
          sample.append(element('p', 'dg-sample-label', `${background.name} · 1:1 · ${width} × ${height} CSS px`), preview(item, background, width, height, false));
          samples.append(sample);
        }
        article.append(samples);
        if (item.note) article.append(element('p', 'dg-note', item.note));
        return article;
      });
      const grid = element('div', 'dg-grid'); grid.append(...items);
      root.replaceChildren(items.length ? grid : element('p', 'dg-empty', '디자인 대안을 추가하면 여기에 표시됩니다.'));
      layout();
    }
    for (const article of root.querySelectorAll('.dg-card')) {
      const selected = article.dataset.item === props.selectedId;
      article.classList.toggle('dg-selected', selected);
      article.querySelector('.dg-select').setAttribute('aria-pressed', String(selected));
    }
  }
  const click = event => {
    const button = event.target.closest?.('button[data-select]');
    if (button && root.contains(button)) onSelect?.(button.dataset.select);
  };
  root.addEventListener('click', click);
  const observer = new ResizeObserver(layout); observer.observe(root);
  update({});
  return { update, destroy() {
    destroyed = true; observer.disconnect(); root.removeEventListener('click', click);
    root.replaceChildren(); root.classList.remove('dg-root'); cards = [];
  } };
}

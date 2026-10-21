import { buildPreviewDocument } from '../preview-document.mjs';

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const dimension = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 1;

/** Controlled device preview. onChange receives only the changed settings field. */
export function mountDevicePreview(root, { onChange } = {}) {
  let props = {}, device, lastDocument, lastOptions = {}, destroyed = false;
  root.classList.add('dp-root');
  const toolbar = element('div', 'dp-toolbar');
  const controls = {};
  for (const [key, title, type] of [
    ['deviceId', '기기', 'select'], ['stateId', '상태', 'select'],
    ['zoom', '배율', 'select'], ['background', '배경', 'color'],
    ['showSafeArea', '안전 영역 표시', 'checkbox']
  ]) {
    const label = element('label', type === 'checkbox' ? 'dp-check' : 'dp-control');
    const control = element(type === 'select' ? 'select' : 'input');
    if (type !== 'select') control.type = type;
    control.dataset.setting = key;
    if (type === 'checkbox') label.append(control, document.createTextNode(title));
    else label.append(element('span', '', title), control);
    controls[key] = control;
    toolbar.append(label);
  }
  const readout = element('p', 'dp-readout');
  readout.setAttribute('aria-live', 'polite');
  const viewport = element('div', 'dp-viewport');
  const stage = element('div', 'dp-stage');
  const slot = element('div', 'dp-slot');
  const frame = element('div', 'dp-frame');
  const iframe = element('iframe', 'dp-iframe');
  iframe.setAttribute('sandbox', '');
  const overlay = element('div', 'dp-safe-area');
  overlay.setAttribute('aria-hidden', 'true');
  const empty = element('p', 'dp-empty', '미리 볼 HTML을 선택하세요.');
  frame.append(iframe, overlay); slot.append(frame); stage.append(slot); viewport.append(stage, empty);
  root.replaceChildren(toolbar, readout, viewport);

  function options(key, values) {
    const signature = JSON.stringify(values);
    if (lastOptions[key] === signature) return;
    lastOptions[key] = signature;
    controls[key].replaceChildren(...values.map(([value, title]) => {
      const option = element('option', '', title); option.value = value; return option;
    }));
  }
  function layout() {
    if (destroyed || !device || !props.content) return;
    const width = dimension(device.width), height = dimension(device.height);
    const zoom = props.settings?.zoom ?? 'fit';
    const scale = zoom === '100' ? 1 : zoom === '50' ? .5 :
      Math.max(.001, Math.min(1, (viewport.clientWidth - 40) / width, (viewport.clientHeight - 40) / height));
    slot.style.width = `${width * scale}px`; slot.style.height = `${height * scale}px`;
    frame.style.width = `${width}px`; frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
    readout.textContent = `${width} × ${height} CSS px · ${Math.round(scale * 100)}%`;
  }
  function update(next) {
    if (destroyed) return;
    props = next ?? {};
    const settings = props.settings ?? {};
    device = (props.devices ?? []).find(item => item.id === settings.deviceId) ?? props.devices?.[0];
    options('deviceId', (props.devices ?? []).map(item => [item.id, item.name]));
    options('stateId', (props.states ?? []).map(item => [item.id, item.name]));
    options('zoom', [['fit', '맞춤'], ['100', '100%'], ['50', '50%']]);
    const values = { deviceId: device?.id ?? '', stateId: settings.stateId ?? props.states?.[0]?.id ?? '', zoom: settings.zoom ?? 'fit', background: settings.background ?? '#ffffff' };
    for (const [key, value] of Object.entries(values)) if (controls[key].value !== value) controls[key].value = value;
    controls.showSafeArea.checked = !!settings.showSafeArea;
    const ready = !!(props.content && device);
    for (const [key, control] of Object.entries(controls)) control.disabled = !ready || (key === 'stateId' && !props.states?.length);
    stage.hidden = !ready; empty.hidden = ready;
    overlay.hidden = !settings.showSafeArea;
    if (ready) {
      for (const side of ['top', 'right', 'bottom', 'left']) overlay.style[side] = `${Math.max(0, Number(device.safeArea?.[side]) || 0)}px`;
      const doc = buildPreviewDocument({ ...props.content, stateId: values.stateId, background: values.background, safeArea: device.safeArea });
      if (doc !== lastDocument) { iframe.srcdoc = doc; lastDocument = doc; }
      iframe.title = props.content.title ? `${props.content.title} — ${device.name}` : `${device.name} 미리보기`;
      layout();
    } else {
      iframe.removeAttribute('srcdoc'); lastDocument = undefined; readout.textContent = '미리보기 없음';
    }
  }
  const change = event => {
    const key = event.target.dataset.setting;
    if (key && !event.target.disabled) onChange?.({ [key]: key === 'showSafeArea' ? event.target.checked : event.target.value });
  };
  toolbar.addEventListener('change', change);
  const observer = new ResizeObserver(layout); observer.observe(viewport);
  update({});
  return { update, destroy() {
    destroyed = true; observer.disconnect(); toolbar.removeEventListener('change', change);
    root.replaceChildren(); root.classList.remove('dp-root');
  } };
}

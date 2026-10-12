import { createItem } from './model.mjs';

// Use DOM text nodes for every document value, including titles, notes and paths.
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'style') { for (const [property, setting] of Object.entries(value)) { if (property.startsWith('--')) node.style.setProperty(property, setting); else node.style[property] = setting; } }
    else if (key in node && !key.startsWith('aria') && key !== 'role') node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const button = (text, action, attributes = {}) => el('button', { type: 'button', onclick: action, ...attributes }, text);
const field = (label, input, className = '') => el('label', { class: `field ${className}` }, el('span', {}, label), input);
const clone = value => structuredClone(value);

export async function mountBoard(root) {
  let state, doc, token, dirty = false, busy = false, notice = '', noticeError = false;
  let page = 'board', activeId = null, filter = '', theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  let preview = '', handoff = null, camera = { x: 28, y: 28, scale: .75 };
  const selected = new Set();
  document.documentElement.dataset.theme = theme;

  async function request(path, body) {
    const response = await fetch(`/api/${path}`, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, 'X-Board-Storage': encodeURIComponent(state.storage.root) }, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(`${data.error || '요청에 실패했습니다.'}${data.requestId ? ` (요청 ${data.requestId})` : ''}`);
      error.conflict = response.status === 409;
      throw error;
    }
    return data;
  }
  function accept(next) {
    state = next; doc = clone(next.document); dirty = false;
    if (!doc.items.some(item => item.id === activeId)) activeId = null;
    for (const id of selected) if (!doc.items.some(item => item.id === id)) selected.delete(id);
    preview = ''; handoff = null;
  }
  function status() {
    const node = root.querySelector('[data-testid="save-status"]');
    if (node) { node.textContent = busy ? '처리 중…' : dirty ? '저장하지 않은 변경' : doc.revision === 0 ? '아직 저장하지 않음' : `저장됨 · v${doc.revision}`; node.className = `status ${dirty ? 'dirty' : ''}`; }
    const saveButton = root.querySelector('[data-testid="save"]');
    if (saveButton) saveButton.disabled = busy || (!dirty && doc.revision !== 0);
    const exportButton = root.querySelector('[data-testid="export"]');
    if (exportButton) exportButton.disabled = busy || dirty || doc.revision === 0 || !selected.size;
  }
  function changed() { dirty = true; preview = ''; handoff = null; status(); }
  async function perform(path, body, message, replace = true) {
    if (busy) return;
    busy = true; notice = ''; render();
    try {
      const next = await request(path, body);
      if (replace) accept(next);
      else { state = next; if (path === 'export') { preview = next.preview; handoff = next.handoff; } }
      notice = message; noticeError = false;
    } catch (error) {
      notice = `${error.conflict ? '다른 화면에서 저장 내용이 변경되었습니다. 편집 내용은 유지됩니다. 최신 내용을 다시 불러오려면 아래 버튼을 누르세요. ' : '편집 내용은 유지됩니다. '}${error.message}`;
      noticeError = true;
    } finally { busy = false; render(); }
  }
  const save = () => perform('save', { document: clone(doc), expectedRevision: state.document.revision }, '저장했습니다.');
  function discardDecision(action) {
    return !dirty || confirm(`저장하지 않은 변경이 있습니다. ${action} 현재 편집 내용을 버릴까요?`);
  }
  async function reload() {
    if (!discardDecision('최신 내용을 불러오면')) return;
    busy = true; render();
    try { accept(await request('state')); notice = '최신 내용을 불러왔습니다.'; noticeError = false; }
    catch (error) { notice = error.message; noticeError = true; }
    finally { busy = false; render(); }
  }
  function navigate(next) { page = next; render(); }
  function category(item) { return doc.categories.find(value => value.id === item.categoryId); }
  function visibleItems() { return doc.items.filter(item => !filter || item.categoryId === filter); }
  function itemCheck(item, rerender = false) {
    return el('input', { type: 'checkbox', checked: selected.has(item.id), 'aria-label': `${item.title || '제목 없는 항목'} 전달 선택`, onchange: event => {
      if (event.target.checked) selected.add(item.id); else selected.delete(item.id);
      preview = ''; handoff = null;
      if (rerender) render(); else root.querySelectorAll('[data-selection-count]').forEach(node => { node.textContent = `전달 선택 ${selected.size}개`; });
    } });
  }
  function selectItem(id) { activeId = id; render(); }
  function add() {
    const item = createItem(state.definition);
    item.categoryId = filter || doc.categories[0]?.id || '';
    doc.items.push(item); activeId = item.id; changed(); render();
    root.querySelector('[data-testid="item-title"]')?.focus();
  }
  function header() {
    return el('header', { class: 'topbar' }, el('div', {}, el('h1', {}, doc.title), el('p', {}, state.definition.description)),
      el('div', { class: 'actions' }, el('span', { class: 'status', role: 'status', 'aria-live': 'polite', 'data-testid': 'save-status' }),
        button(theme === 'light' ? '어두운 테마' : '밝은 테마', () => { theme = theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; render(); }, { 'aria-label': '테마 전환' }),
        button('보드', () => navigate('board'), { 'aria-pressed': page === 'board' }),
        button('설정·백업', () => navigate('settings'), { 'aria-pressed': page === 'settings' }),
        button('전달', () => navigate('handoff'), { 'aria-pressed': page === 'handoff' }),
        button('저장', save, { class: 'primary', disabled: busy || (!dirty && doc.revision !== 0), 'data-testid': 'save' })));
  }
  function filterSelect() {
    return el('select', { value: filter, 'aria-label': '분류 필터', onchange: event => { filter = event.target.value; render(); } },
      el('option', { value: '' }, '모든 분류'), doc.categories.map(value => el('option', { value: value.id, selected: filter === value.id }, value.name)));
  }
  function sidebar() {
    const items = visibleItems();
    return el('aside', { class: 'sidebar', 'aria-label': '항목 목록' },
      el('div', { class: 'section-head' }, el('h2', {}, `항목 ${items.length}`), button('+ 추가', add, { 'data-testid': 'add-item' })),
      el('div', { class: 'filter' }, filterSelect()),
      el('div', { class: 'item-list' }, items.length ? items.map(item => el('div', { class: `list-row ${activeId === item.id ? 'active' : ''}` }, itemCheck(item), itemButton(item))) : el('div', { class: 'empty' }, '아직 항목이 없습니다.', el('p', {}, '추가 버튼으로 시작하세요.'))),
      el('p', { class: 'footnote', 'data-selection-count': '' }, `전달 선택 ${selected.size}개`), el('p', { class: 'footnote' }, '체크박스는 전달할 항목을 선택합니다. 분류 필터와 별도로 유지됩니다.'));
  }
  function itemButton(item) {
    return button('', () => selectItem(item.id), { 'aria-label': `${item.title || '제목 없는 항목'} 편집` });
  }
  function decorateList() {
    root.querySelectorAll('.list-row>button').forEach((node, index) => {
      const item = visibleItems()[index];
      node.append(el('span', { class: 'dot', style: { backgroundColor: category(item)?.color || '#888' } }), el('span', { class: 'name' }, item.title || '제목 없는 항목'));
    });
  }
  function inspector() {
    const item = doc.items.find(value => value.id === activeId);
    if (!item) return el('aside', { class: 'inspector' }, el('h2', {}, '항목 편집'), el('div', { class: 'empty' }, '목록이나 지도에서 항목을 선택하세요.', el('p', {}, '위치와 크기도 직접 입력할 수 있습니다.')));
    const text = (label, key, tag = 'input', className = '') => field(label, el(tag, { value: item[key], maxLength: key === 'title' ? 200 : 5000, required: key === 'title', 'data-testid': `item-${key}`, oninput: event => {
      item[key] = event.target.value; changed();
      if (key === 'title') {
        const card = root.querySelector(`[data-item-id="${item.id}"] strong`); if (card) card.textContent = item.title || '제목 없는 항목';
        const list = root.querySelector('.list-row.active .name'); if (list) list.textContent = item.title || '제목 없는 항목';
      }
    } }), className);
    const number = (label, object, key, min = 0, max, specified) => field(label, el('input', { type: 'number', step: 'any', value: object[key], min, ...(max == null ? {} : { max }), onchange: event => {
      const value = event.target.valueAsNumber;
      if (!Number.isFinite(value) || value < min || (max != null && value > max)) { event.target.value = object[key]; return; }
      object[key] = value; if (specified) specified(event); changed(); render();
    } }));
    const fields = state.definition.fields.map(definition => {
      const label = `${definition.label} · ${item.specifiedFields.includes(definition.id) ? '직접 지정' : '기본값'}`;
      const specify = event => {
        if (!item.specifiedFields.includes(definition.id)) item.specifiedFields.push(definition.id);
        const labelNode = event.target.closest('label')?.querySelector('span');
        if (labelNode) labelNode.textContent = `${definition.label} · 직접 지정`;
      };
      if (definition.type === 'select') return field(label, el('select', { onchange: event => { item.values[definition.id] = event.target.value; specify(event); changed(); } }, definition.options.map(option => el('option', { value: option.value, selected: item.values[definition.id] === option.value }, option.label))));
      if (definition.type === 'number') return number(label, item.values, definition.id, definition.min ?? -Number.MAX_VALUE, definition.max, specify);
      if (definition.type === 'boolean') return field(label, el('input', { type: 'checkbox', checked: item.values[definition.id], 'aria-label': definition.label, onchange: event => { item.values[definition.id] = event.target.checked; specify(event); changed(); } }));
      return field(label, el('input', { type: 'text', value: item.values[definition.id], maxLength: 2000, oninput: event => { item.values[definition.id] = event.target.value; specify(event); changed(); } }));
    });
    return el('aside', { class: 'inspector' }, el('div', { class: 'section-head' }, el('h2', {}, '항목 편집'), button('삭제', () => {
      if (!confirm(`“${item.title || '제목 없는 항목'}”을 삭제할까요? 저장을 누르면 파일에 반영됩니다.`)) return;
      doc.items = doc.items.filter(value => value.id !== item.id); selected.delete(item.id); activeId = null; changed(); render();
    }, { class: 'danger', 'data-testid': 'remove-item' })),
      el('div', { class: 'inspector-form' }, text('제목', 'title'), field('분류', el('select', { onchange: event => { item.categoryId = event.target.value; changed(); render(); } }, doc.categories.map(value => el('option', { value: value.id, selected: item.categoryId === value.id }, value.name)))), fields,
        el('div', { class: 'pair' }, number('X 위치', item.position, 'x', -100000, 100000), number('Y 위치', item.position, 'y', -100000, 100000)),
        el('div', { class: 'pair' }, number('너비', item.size, 'width', 32, 1000), number('높이', item.size, 'height', 32, 1000)), text('메모', 'note', 'textarea', 'wide')),
      el('p', { class: 'hint' }, '지도 확대율과 관계없이 원래 좌표로 저장합니다.'));
  }
  function map() {
    const viewport = el('div', { class: 'viewport', 'aria-label': '항목 배치 지도', 'data-testid': 'map' });
    const world = el('div', { class: 'world', style: { width: `${doc.map.width}px`, height: `${doc.map.height}px` } });
    function transform() { world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`; const zoom = root.querySelector('[data-zoom]'); if (zoom) zoom.textContent = `${Math.round(camera.scale * 100)}%`; }
    function zoom(factor, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
      const scale = Math.min(2.5, Math.max(.2, camera.scale * factor));
      camera.x = x - (x - camera.x) * scale / camera.scale; camera.y = y - (y - camera.y) * scale / camera.scale; camera.scale = scale; transform();
    }
    for (const item of visibleItems()) {
      const card = el('button', { type: 'button', class: `map-card ${activeId === item.id ? 'selected' : ''}`, 'data-item-id': item.id,
        style: { left: `${item.position.x}px`, top: `${item.position.y}px`, width: `${item.size.width}px`, height: `${item.size.height}px`, '--category': category(item)?.color || '#888' },
        onclick: () => selectItem(item.id), 'aria-label': `${item.title || '제목 없는 항목'} 편집` }, el('strong', {}, item.title || '제목 없는 항목'), el('small', {}, category(item)?.name || ''), el('small', {}, item.note));
      card.addEventListener('pointerdown', event => {
        if (busy || event.button !== 0) return;
        event.stopPropagation(); card.setPointerCapture(event.pointerId);
        const start = { x: event.clientX, y: event.clientY, px: item.position.x, py: item.position.y }; let moved = false;
        const move = next => {
          if (Math.hypot(next.clientX - start.x, next.clientY - start.y) < 3 && !moved) return;
          moved = true;
          item.position.x = Math.round(Math.max(0, Math.min(doc.map.width - item.size.width, start.px + (next.clientX - start.x) / camera.scale)));
          item.position.y = Math.round(Math.max(0, Math.min(doc.map.height - item.size.height, start.py + (next.clientY - start.y) / camera.scale)));
          card.style.left = `${item.position.x}px`; card.style.top = `${item.position.y}px`; changed();
        };
        const end = () => { card.removeEventListener('pointermove', move); card.removeEventListener('pointerup', end); card.removeEventListener('pointercancel', end); if (moved) { activeId = item.id; render(); } };
        card.addEventListener('pointermove', move); card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
      });
      world.append(card);
    }
    viewport.append(world);
    if (!visibleItems().length) viewport.append(el('div', { class: 'map-empty' }, doc.items.length ? '이 분류에는 표시할 항목이 없습니다.' : '생각을 항목으로 추가하고 원하는 곳에 배치하세요.'));
    viewport.addEventListener('pointerdown', event => {
      if (event.target.closest('.map-card') || event.button !== 0) return;
      viewport.setPointerCapture(event.pointerId); const start = { x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
      const move = next => { camera.x = start.cx + next.clientX - start.x; camera.y = start.cy + next.clientY - start.y; transform(); };
      const end = () => { viewport.removeEventListener('pointermove', move); viewport.removeEventListener('pointerup', end); viewport.removeEventListener('pointercancel', end); };
      viewport.addEventListener('pointermove', move); viewport.addEventListener('pointerup', end); viewport.addEventListener('pointercancel', end);
    });
    viewport.addEventListener('wheel', event => { event.preventDefault(); const rect = viewport.getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
    transform();
    return el('main', { class: 'map-area' }, el('div', { class: 'map-toolbar' }, el('div', {}, el('h2', {}, '공간 배치'), el('small', {}, '항목을 끌어 배치 · 빈 공간을 끌어 이동')),
      el('div', { class: 'actions' }, button('−', () => zoom(1 / 1.2), { 'aria-label': '축소' }), el('span', { class: 'muted', 'data-zoom': '' }, `${Math.round(camera.scale * 100)}%`), button('+', () => zoom(1.2), { 'aria-label': '확대' }), button('맞춤', () => {
        camera.scale = Math.max(.2, Math.min(1, (viewport.clientWidth - 48) / doc.map.width, (viewport.clientHeight - 48) / doc.map.height)); camera.x = 24; camera.y = 24; transform();
      }))), viewport, el('small', {}, `${doc.map.width} × ${doc.map.height} ${doc.map.unit} · 좌측 상단이 원점`));
  }
  function copyPath(path) {
    const input = el('input', { value: path, readOnly: true, 'aria-label': '파일 경로' });
    return el('div', { class: 'path' }, input, button('복사', async () => {
      try { await navigator.clipboard.writeText(path); notice = '경로를 복사했습니다.'; noticeError = false; render(); }
      catch { input.focus(); input.select(); if (!input.parentElement.querySelector('.copy-hint')) input.parentElement.append(el('span', { class: 'muted copy-hint', role: 'status' }, 'Ctrl+C / ⌘C로 복사')); }
    }));
  }
  function settings() {
    const rootInput = el('input', { value: state.storage.root, 'aria-label': '저장 폴더 절대 경로' });
    return el('main', { class: 'drawer' }, el('h2', {}, '설정·백업'), el('p', {}, '분류와 저장 위치를 관리하고 저장된 버전으로 돌아갈 수 있습니다.'),
      el('section', { class: 'settings-section' }, field('보드 제목', el('input', { value: doc.title, maxLength: 200, required: true, oninput: event => { doc.title = event.target.value; root.querySelector('h1').textContent = doc.title; changed(); } }))),
      el('section', { class: 'settings-section' }, el('div', { class: 'section-head' }, el('h3', {}, '분류'), button('+ 분류 추가', () => {
        doc.categories.push({ id: `category-${crypto.randomUUID()}`, name: '새 분류', color: '#5c8dc7' }); changed(); render();
      })), doc.categories.map(value => el('div', { class: 'category-row' }, el('input', { type: 'color', value: value.color, 'aria-label': `${value.name} 색상`, oninput: event => { value.color = event.target.value; changed(); } }),
        el('input', { type: 'text', value: value.name, maxLength: 80, required: true, 'aria-label': '분류 이름', oninput: event => { value.name = event.target.value; changed(); } }))), el('p', { class: 'footnote' }, '분류 변경도 저장 버튼을 눌러 반영합니다.')),
      el('section', { class: 'settings-section' }, el('h3', {}, '저장 위치'), el('p', { class: 'footnote' }, '절대 경로를 입력하세요. 선택한 폴더의 보드를 불러옵니다. 기존 자료는 이동하지 않습니다.'),
        el('div', { class: 'settings-row' }, rootInput, button('위치 변경', () => {
          if (!rootInput.value.trim() || !discardDecision('저장 위치를 바꾸면')) return;
          if (!confirm('선택한 폴더의 보드로 전환할까요?')) return;
          perform('storage', { root: rootInput.value.trim() }, '저장 위치를 변경했습니다.');
        })), el('div', { class: 'paths' }, field('보드 파일', copyPath(state.storage.documentPath)), field('진단 로그', copyPath(state.storage.logPath)))),
      el('section', { class: 'settings-section' }, el('div', { class: 'section-head' }, el('h3', {}, '백업'), button('현재 저장본 백업', () => perform('backup', { expectedRevision: state.document.revision }, '백업을 만들었습니다.', false))),
        dirty ? el('p', { class: 'footnote' }, '백업은 마지막 저장본으로 만듭니다. 현재 편집 내용은 먼저 저장하세요.') : null,
        state.backups.length ? state.backups.map(value => el('div', { class: 'settings-row' }, el('div', { class: 'row-info' }, `버전 ${value.revision}`, el('p', {}, `${value.createdAt} · ${value.id}`)), button('복원', () => {
          if (!discardDecision('백업을 복원하면')) return;
          if (!confirm(`버전 ${value.revision} 백업으로 복원할까요? 현재 저장본은 먼저 백업됩니다.`)) return;
          perform('restore', { backupId: value.id, expectedRevision: state.document.revision }, '백업을 복원했습니다.');
        }))) : el('div', { class: 'empty' }, '아직 백업이 없습니다.')),
      el('section', { class: 'settings-section' }, el('h3', {}, '최신 저장본'), el('p', { class: 'footnote' }, '다른 화면에서 저장한 내용을 불러옵니다. 현재 편집 내용은 확인 후 버립니다.'), button('다시 불러오기', reload)));
  }
  function handoffPanel() {
    const chosen = doc.items.filter(item => selected.has(item.id));
    const localPreview = chosen.map(item => `${item.title || '제목 없는 항목'}\n분류: ${category(item)?.name || ''}\n${state.definition.fields.map(value => `${value.label}: ${item.values[value.id]} (${item.specifiedFields.includes(value.id) ? '직접 지정' : '기본값'})`).join('\n')}\n위치: ${item.position.x}, ${item.position.y} · 크기: ${item.size.width} × ${item.size.height}\n${item.note}`).join('\n\n---\n\n');
    return el('main', { class: 'drawer' }, el('h2', {}, '작업에 전달'), el('p', {}, '전달할 항목을 선택하고 결과를 확인하세요. 결과 파일을 만든 뒤 경로를 대화에 붙여 넣으세요.'),
      el('div', { class: 'actions' }, button('모두 선택', () => { doc.items.forEach(item => selected.add(item.id)); preview = ''; handoff = null; render(); }), button('선택 해제', () => { selected.clear(); preview = ''; handoff = null; render(); }), el('span', { class: 'selection-count' }, `선택 ${selected.size}개`)),
      el('div', { class: 'handoff-list' }, doc.items.length ? doc.items.map(item => el('label', {}, itemCheck(item, true), item.title || '제목 없는 항목')) : el('div', { class: 'empty' }, '보드에서 항목을 추가하세요.')),
      el('h3', {}, '미리보기'), el('pre', { class: 'preview', 'data-testid': 'handoff-preview' }, preview || localPreview || '전달할 항목을 선택하면 여기에 표시됩니다.'),
      dirty ? el('p', { class: 'footnote' }, '저장하지 않은 변경이 있습니다. 먼저 저장한 뒤 결과를 만들어 주세요.') : null,
      el('div', { class: 'settings-row' }, el('div', { class: 'row-info' }, '선택한 항목의 전달 파일', el('p', {}, '자동 첨부나 작업 시작 없이 JSON과 Markdown을 생성합니다.')), button('결과 만들기', () => perform('export', { expectedRevision: state.document.revision, itemIds: [...selected] }, '전달 결과를 만들었습니다.', false), { class: 'primary', disabled: dirty || doc.revision === 0 || !selected.size, 'data-testid': 'export' })),
      handoff ? el('div', { class: 'paths' }, field('Markdown 경로', copyPath(handoff.markdownPath)), field('JSON 경로', copyPath(handoff.jsonPath))) : null,
      state.handoffs.length ? el('section', { class: 'settings-section' }, el('h3', {}, '이전 전달 결과'), state.handoffs.map(value => el('div', { class: 'settings-row' }, el('div', { class: 'row-info' }, `버전 ${value.revision} · ${value.createdAt}`, copyPath(value.markdownPath))))) : null,
      el('details', { class: 'rules' }, el('summary', {}, '보드 해석 지침'), el('pre', {}, state.rules)));
  }
  function render() {
    const shell = el('div', { class: 'app-shell', 'aria-busy': busy }, header());
    if (notice) shell.append(el('div', { class: `notice ${noticeError ? 'error' : ''}`, role: noticeError ? 'alert' : 'status' }, el('span', {}, notice), noticeError ? button('최신 내용 불러오기', reload) : button('닫기', () => { notice = ''; render(); }, { class: 'flat' })));
    shell.append(page === 'board' ? el('div', { class: 'workspace' }, sidebar(), map(), inspector()) : page === 'settings' ? settings() : handoffPanel());
    root.replaceChildren(shell); if (page === 'board') decorateList();
    if (busy) root.querySelectorAll('button,input,select,textarea').forEach(node => { node.disabled = true; });
    status();
  }
  window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
  try { ({ token } = await request('session')); accept(await request('state')); render(); }
  catch (error) { root.replaceChildren(el('main', { class: 'startup' }, el('h1', {}, '보드를 불러오지 못했습니다.'), el('p', { role: 'alert' }, error.message), button('다시 시도', () => location.reload()))); }
}

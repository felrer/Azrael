// Native host input only: no product settings or account content is recreated.
export function createDialogs({ bridge }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'azrael-dialog';
  const form = document.createElement('form');
  const title = document.createElement('h2');
  title.id = 'azrael-dialog-title';
  dialog.setAttribute('aria-labelledby', title.id);
  const prompt = document.createElement('p');
  prompt.className = 'azrael-dialog-prompt';
  prompt.id = 'azrael-dialog-prompt';
  const input = document.createElement('input');
  input.className = 'azrael-dialog-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-describedby', 'azrael-dialog-prompt azrael-dialog-error');
  const list = document.createElement('div');
  list.className = 'azrael-dialog-list';
  list.setAttribute('role', 'listbox');
  list.id = 'azrael-dialog-items';
  const error = document.createElement('p');
  error.id = 'azrael-dialog-error';
  error.className = 'azrael-dialog-error';
  error.setAttribute('role', 'status');
  error.setAttribute('aria-live', 'polite');
  const buttons = document.createElement('div');
  buttons.className = 'azrael-dialog-buttons';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '취소';
  const accept = document.createElement('button');
  accept.type = 'submit';
  accept.className = 'azrael-dialog-accept';
  accept.textContent = '확인';
  buttons.append(cancel, accept);
  form.append(title, prompt, input, list, error, buttons);
  dialog.append(form);
  document.body.append(dialog);
  let current, previousFocus, selected = new Set(), filtered = [], focused = 0, busy = false;

  function setBusy(value) { busy = value; accept.disabled = value; }
  async function respond(action, payload = {}) {
    if (!current || (busy && action === 'accept')) return;
    const id = current.id;
    if (action === 'accept') setBusy(true);
    try { await bridge.respondDialog({ id, action, ...payload }); }
    catch { if (current?.id === id) { error.textContent = '요청을 처리하지 못했습니다. 다시 시도해 주세요.'; setBusy(false); } }
  }
  function close() {
    current = undefined;
    input.value = '';
    selected.clear();
    list.replaceChildren();
    error.textContent = '';
    setBusy(false);
    if (dialog.open) dialog.close();
    previousFocus?.focus?.();
  }
  function highlight() {
    const rows = [...list.querySelectorAll('[role="option"]')];
    for (const [index, row] of rows.entries()) {
      row.classList.toggle('is-focused', index === focused);
      row.setAttribute('aria-selected', String(current.options.canPickMany ? selected.has(filtered[index].index) : index === focused));
      const check = row.querySelector('input');
      if (check) check.checked = selected.has(filtered[index].index);
    }
    if (rows[focused]) {
      input.setAttribute('aria-activedescendant', rows[focused].id);
      rows[focused].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function renderItems() {
    const search = input.value.toLocaleLowerCase().trim();
    filtered = current.items.filter(item => {
      if (item.kind === -1) return false;
      const text = [item.label, current.options.matchOnDescription && item.description, current.options.matchOnDetail && item.detail].filter(Boolean).join(' ').toLocaleLowerCase();
      return item.alwaysShow || !search || text.includes(search);
    });
    focused = Math.min(focused, Math.max(0, filtered.length - 1));
    list.replaceChildren();
    for (const [index, item] of filtered.entries()) {
      const row = document.createElement('div');
      row.className = 'azrael-dialog-option';
      row.id = `azrael-dialog-option-${index}`;
      row.setAttribute('role', 'option');
      if (current.options.canPickMany) {
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.tabIndex = -1;
        check.setAttribute('aria-hidden', 'true');
        row.append(check);
      }
      const content = document.createElement('div');
      content.className = 'azrael-dialog-option-content';
      const label = document.createElement('span');
      label.className = 'azrael-dialog-option-label';
      label.textContent = item.label;
      content.append(label);
      for (const [key, className] of [['description', 'azrael-dialog-description'], ['detail', 'azrael-dialog-detail']]) {
        if (item[key]) { const text = document.createElement('span'); text.className = className; text.textContent = item[key]; content.append(text); }
      }
      row.append(content);
      row.addEventListener('mousedown', event => event.preventDefault());
      row.addEventListener('click', () => {
        focused = index;
        if (current.options.canPickMany) {
          if (selected.has(item.index)) selected.delete(item.index); else selected.add(item.index);
          highlight(); input.focus();
        } else { highlight(); void respond('accept', { indices: [item.index] }); }
      });
      list.append(row);
    }
    if (!filtered.length) { const empty = document.createElement('p'); empty.className = 'azrael-dialog-empty'; empty.textContent = '일치하는 항목이 없습니다.'; list.append(empty); }
    highlight();
  }
  function submit() {
    if (!current) return;
    if (current.kind === 'input') void respond('accept', { value: input.value });
    else {
      const indices = current.options.canPickMany ? [...selected] : filtered[focused] ? [filtered[focused].index] : [];
      if (current.options.canPickMany || indices.length) void respond('accept', { indices });
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); submit(); });
  cancel.addEventListener('click', () => void respond('cancel'));
  dialog.addEventListener('cancel', event => { event.preventDefault(); void respond('cancel'); });
  dialog.addEventListener('keydown', event => {
    // Keep shell-level Escape from closing the detail panel behind this modal.
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void respond('cancel'); return; }
    if (current?.kind !== 'pick') return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length) focused = (focused + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
      highlight();
    } else if (event.key === ' ' && event.ctrlKey && current.options.canPickMany && filtered[focused]) {
      event.preventDefault();
      const index = filtered[focused].index;
      if (selected.has(index)) selected.delete(index); else selected.add(index);
      highlight();
    }
  });
  input.addEventListener('input', () => {
    if (!current) return;
    setBusy(false);
    if (current.kind === 'pick') { focused = 0; renderItems(); }
    else void respond('change', { value: input.value });
  });
  return {
    handleAction(action) {
      if (action?.type !== 'dialog') return false;
      if (action.action === 'close') { if (current?.id === action.id) close(); return true; }
      if (action.action === 'validation') {
        if (current?.id === action.id) {
          error.textContent = action.error || '';
          error.dataset.severity = String(action.severity ?? 3);
          input.setAttribute('aria-invalid', String(!!action.blocked));
          setBusy(false);
        }
        return true;
      }
      if (action.action !== 'show' || !['input', 'pick'].includes(action.kind)) return false;
      if (current) close();
      previousFocus = document.activeElement;
      current = { ...action, options: action.options ?? {}, items: action.items ?? [] };
      selected = new Set(current.items.filter(item => item.picked && item.kind !== -1).map(item => item.index));
      focused = 0;
      title.textContent = current.options.title || (current.kind === 'pick' ? '항목 선택' : '입력');
      prompt.textContent = current.options.prompt || (current.kind === 'pick' && current.options.canPickMany ? '여러 항목을 선택할 수 있습니다. Ctrl+Space로 선택을 전환합니다.' : '');
      prompt.hidden = !prompt.textContent;
      input.type = current.kind === 'input' && current.options.password ? 'password' : 'text';
      input.placeholder = current.options.placeHolder || '';
      input.value = current.kind === 'input' ? current.options.value ?? '' : '';
      input.setAttribute('aria-label', current.options.prompt || current.options.placeHolder || title.textContent);
      input.setAttribute('aria-invalid', 'false');
      input.setAttribute('role', current.kind === 'pick' ? 'combobox' : 'textbox');
      if (current.kind === 'pick') { input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-autocomplete', 'list'); }
      else { input.removeAttribute('aria-controls'); input.removeAttribute('aria-expanded'); input.removeAttribute('aria-autocomplete'); input.removeAttribute('aria-activedescendant'); }
      list.hidden = current.kind !== 'pick';
      list.setAttribute('aria-multiselectable', String(!!current.options.canPickMany));
      if (current.kind === 'pick') renderItems();
      dialog.showModal();
      input.focus();
      if (current.kind === 'input') {
        const selection = current.options.valueSelection;
        if (Array.isArray(selection)) input.setSelectionRange(selection[0], selection[1]); else input.select();
        void respond('change', { value: input.value });
      }
      return true;
    },
    dispose() { if (current) void respond('cancel'); close(); dialog.remove(); },
  };
}

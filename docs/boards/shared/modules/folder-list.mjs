const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Controlled one-level folder/list navigation. No persistence or document mutation. */
export function mountFolderList(root, {onNavigate, onAction}) {
  let state = {document: {folders: [], lists: [], items: []}, scope: 'all'};
  const instance = `folders-${crypto.randomUUID()}`;
  let dragging = null, destination = null, suppressClick = false;
  root.classList.add('catalog-folders');
  function emit(action) { onAction(action); }
  const entityAt = target => target.closest('[data-entity]');
  const focusEntity = (type,id) => root.querySelector(`[data-entity="${type}"][data-id="${CSS.escape(id)}"] button`)?.focus();
  function clearDrop() {
    root.querySelectorAll('.drop-before,.drop-after,.drop-inside').forEach(el=>el.classList.remove('drop-before','drop-after','drop-inside'));
    destination = null;
  }
  function finishDrag() {
    clearDrop(); dragging=null;root.classList.remove('is-dragging');
    root.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));
  }
  function announce(message) { root.querySelector('[data-folder-status]').textContent=message; }
  function edit(type, entity = null) {
    const isFolder = type === 'folder';
    const dialog = document.createElement('dialog');
    dialog.className = 'catalog-dialog';
    dialog.setAttribute('aria-labelledby', `${instance}-dialog-title`);
    dialog.innerHTML = `<form><h2 id="${instance}-dialog-title">${isFolder?'폴더':'목록'} ${entity?'설정':'추가'}</h2><label class="field">이름<input name="name" required maxlength="80" value="${esc(entity?.name ?? '')}"></label>${isFolder?'':`<label class="field">폴더<select name="folderId"><option value="">폴더 밖</option>${state.document.folders.map(f=>`<option value="${esc(f.id)}" ${entity?.folderId===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select></label>`}<p class="muted">${isFolder?'폴더를 삭제해도 소속 목록과 카드는 유지되며, 목록은 폴더 밖으로 이동합니다.':'목록을 삭제해도 카드는 유지되며, 미분류로 이동합니다.'}</p><p role="alert" class="widget-error"></p><div class="widget-actions">${entity?'<button type="button" data-delete class="danger">삭제</button><span class="widget-spacer"></span>':''}<button type="button" data-cancel>취소</button><button type="submit" class="primary">적용</button></div></form>`;
    root.append(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dialog.querySelector('[data-cancel]').onclick = close;
    dialog.querySelector('[data-delete]')?.addEventListener('click', () => {
      if (!confirm(isFolder?'폴더만 삭제하고 소속 목록은 폴더 밖에 유지할까요?':'목록만 삭제하고 소속 카드는 미분류로 이동할까요?')) return;
      try { emit({type:`${type}.delete`, id:entity.id}); close(); } catch(e) { dialog.querySelector('[role=alert]').textContent=e.message; }
    });
    dialog.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const name = dialog.querySelector('[name=name]').value.trim();
      if (!name) return;
      const action = {type:`${type}.${entity?'update':'create'}`, name};
      if (entity) action.id = entity.id;
      if (!isFolder) action.folderId=dialog.querySelector('[name=folderId]').value || null;
      try { emit(action); close(); } catch(error) { dialog.querySelector('[role=alert]').textContent=error.message; }
    };
    dialog.showModal(); dialog.querySelector('input').focus();
  }
  function update(next) {
    finishDrag();
    state=next;
    const {document:doc, scope}=state;
    const count = id => doc.items.filter(i => id==='all'||(id==='unassigned'?i.listId===null:i.listId===id)).length;
    const nav = (id,name) => `<button type="button" class="folder-nav ${scope===id?'active':''}" data-nav="${esc(id)}" aria-current="${scope===id?'page':'false'}"><span>${esc(name)}</span><small>${count(id)}</small></button>`;
    const attrs = (type,id) => `draggable="true" data-entity="${type}" data-id="${esc(id)}" title="드래그로 이동 · 우클릭으로 설정"`;
    const row = list => `<div class="folder-list-row" ${attrs('list',list.id)}>${nav(list.id,list.name)}</div>`;
    root.innerHTML=`<p id="${instance}-help" class="widget-sr-only">드래그로 순서와 폴더를 변경합니다. 우클릭 또는 Shift+F10으로 설정을 열고 Alt+위·아래 화살표로 순서를 변경합니다.</p><p class="widget-sr-only" data-folder-status role="status" aria-live="polite"></p><div class="widget-heading"><h2>목록</h2><button type="button" data-add-folder aria-label="폴더 추가">＋ 폴더</button></div>${nav('all','전체 카드')}${nav('unassigned','미분류')}<div class="folder-root" data-drop-root>${doc.lists.filter(l=>l.folderId===null).map(row).join('')}</div>${doc.folders.map(f=>`<section class="catalog-folder"><div class="folder-heading" ${attrs('folder',f.id)}><button type="button" class="folder-toggle" data-toggle="${esc(f.id)}" aria-expanded="${!f.collapsed}" aria-controls="${instance}-${esc(f.id)}"><span aria-hidden="true">${f.collapsed?'▸':'▾'}</span><strong>${esc(f.name)}</strong><small>${doc.lists.filter(l=>l.folderId===f.id).length}</small></button></div><div class="folder-children" data-drop-folder="${esc(f.id)}" id="${instance}-${esc(f.id)}" ${f.collapsed?'hidden':''}>${doc.lists.filter(l=>l.folderId===f.id).map(row).join('')||'<p class="widget-empty">아직 목록이 없습니다.</p>'}</div></section>`).join('')}<button type="button" class="widget-wide" data-add-list>＋ 목록 추가</button>`;
    root.querySelectorAll('[data-entity] button').forEach(el=>el.setAttribute('aria-describedby',`${instance}-help`));
  }
  const click = e => {
    const b=e.target.closest('button'); if(!b||!root.contains(b))return;
    if(suppressClick)return;
    const d=b.dataset;
    if(d.nav)onNavigate(d.nav);
    else if('addFolder'in d)edit('folder');
    else if('addList'in d)edit('list');
    else if(d.toggle){const f=state.document.folders.find(f=>f.id===d.toggle);emit({type:'folder.update',id:f.id,collapsed:!f.collapsed});root.querySelector(`[data-toggle="${CSS.escape(f.id)}"]`)?.focus();}
  };
  const settings = e => {
    const row=entityAt(e.target);if(!row||!root.contains(row))return;
    e.preventDefault();
    const {entity:type,id}=row.dataset;
    const value=state.document[type==='folder'?'folders':'lists'].find(item=>item.id===id);
    focusEntity(type,id);edit(type,value);
  };
  const keydown = e => {
    if(e.target.closest('dialog'))return;
    if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))return settings(e);
    const row=entityAt(e.target);if(!row||!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();const {entity:type,id}=row.dataset;
    emit({type:`${type}.move`,id,direction:e.key==='ArrowUp'?-1:1});
    focusEntity(type,id);announce('순서를 변경했습니다.');
  };
  const dragstart = e => {
    const row=entityAt(e.target);if(!row||!e.dataTransfer)return;
    dragging={type:row.dataset.entity,id:row.dataset.id};
    e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragging.id);
    row.classList.add('dragging');root.classList.add('is-dragging');
  };
  const dragover = e => {
    if(!dragging)return;
    clearDrop();
    const row=entityAt(e.target), {type,id}=dragging;
    let marker,edge,action;
    if(row&&row.dataset.entity===type) {
      const targetId=row.dataset.id;if(targetId===id)return;
      const values=state.document[type==='folder'?'folders':'lists'];
      const target=values.find(item=>item.id===targetId);
      const after=e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;
      const peers=type==='folder'?values:values.filter(item=>item.folderId===target.folderId);
      const beforeId=after?(peers[peers.indexOf(target)+1]?.id??null):targetId;
      action={type:`${type}.move`,id,beforeId,...(type==='list'?{folderId:target.folderId}:{})};
      marker=row;edge=after?'after':'before';
    } else if(type==='list') {
      const folder=row?.dataset.entity==='folder'?row.dataset.id:e.target.closest('[data-drop-folder]')?.dataset.dropFolder;
      const atRoot=e.target.closest('[data-drop-root]');
      if(folder||atRoot) {
        action={type:'list.move',id,folderId:folder??null,beforeId:null};
        marker=folder?root.querySelector(`[data-entity="folder"][data-id="${CSS.escape(folder)}"]`):atRoot;
        edge='inside';
      }
    }
    if(!action)return;
    e.preventDefault();e.dataTransfer.dropEffect='move';
    destination=action;marker.classList.add(`drop-${edge}`);
  };
  const drop = e => {
    if(!destination)return;
    e.preventDefault();const action=destination,source=dragging;
    finishDrag();suppressClick=true;setTimeout(()=>{suppressClick=false;},0);
    emit(action);focusEntity(source.type,source.id);announce('이동했습니다. 저장을 눌러 반영하세요.');
  };
  const dragleave = e => {if(!root.contains(e.relatedTarget))clearDrop();};
  const events={click,contextmenu:settings,keydown,dragstart,dragover,drop,dragleave,dragend:finishDrag};
  for(const [name,handler] of Object.entries(events))root.addEventListener(name,handler);
  return {update,destroy(){for(const [name,handler] of Object.entries(events))root.removeEventListener(name,handler);finishDrag();root.replaceChildren();root.classList.remove('catalog-folders');}};
}

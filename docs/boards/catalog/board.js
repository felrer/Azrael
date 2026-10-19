import {applyCatalogAction} from '/shared/catalog-model.mjs';
import {mountFolderList} from '/shared/modules/folder-list.mjs';
import {mountCardBrowser} from '/shared/modules/card-browser.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const app=document.querySelector('#app');
let state, draft, token, baseline='', pending=false, undo=[], redo=[], selectedIds=[];
let filters={query:'',kind:'all',status:'all',scope:'all'};
let folders,cards,modal;
const invalidEdits=new Map();
const editKey=(id,name)=>JSON.stringify([id,name]);
const editValue=(item,name,value)=>invalidEdits.get(editKey(item.id,name))?.value??value;
const $=id=>document.getElementById(id);
const dirty=()=>draft&&(invalidEdits.size>0||JSON.stringify(draft)!==baseline);

async function request(path,payload){
  const response=await fetch(`/api/${path}`,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Board-Token':token,'X-Board-Storage':encodeURIComponent(state.storage.root)},body:JSON.stringify(payload)});
  const body=await response.json();
  if(!response.ok)throw new Error(`${body.error??'요청에 실패했습니다.'}${body.requestId?` · 요청 ID ${body.requestId}`:''}`);
  return body;
}
function notice(message,error=false){const box=$('catalog-notice');box.hidden=false;box.classList.toggle('error',error);$('notice-text').textContent=message;}
function adopt(next){state=next;draft=structuredClone(next.document);baseline=JSON.stringify(draft);invalidEdits.clear();undo=[];redo=[];selectedIds=selectedIds.filter(id=>draft.items.some(i=>i.id===id));if(!['all','unassigned',...draft.lists.map(l=>l.id)].includes(filters.scope))filters.scope='all';}
function commit(action, preserveInspector=false){
  if(pending)return;
  try{const next=applyCatalogAction(draft,action);if(JSON.stringify(next)===JSON.stringify(draft))return;undo.push(structuredClone(draft));if(undo.length>100)undo.shift();redo=[];draft=next;for(const [key,edit] of invalidEdits)if(!draft.items.some(i=>i.id===edit.id))invalidEdits.delete(key);selectedIds=selectedIds.filter(id=>draft.items.some(i=>i.id===id));if(!['all','unassigned',...draft.lists.map(l=>l.id)].includes(filters.scope))filters.scope='all';render(preserveInspector);}
  catch(error){notice(error.message,true);throw error;}
}
function safeCommit(action){try{commit(action);}catch{/* The error remains visible and the draft is intact. */}}
async function perform(path,payload,message){
  if(pending)return false;
  pending=true;render();if(modal){modal.inert=true;modal.querySelector('[data-modal-error]')?.remove();}
  try{const next=await request(path,payload);if(['save','restore','storage'].includes(path))adopt(next);else state=next;notice(message);return true;}
  catch(error){notice(error.message,true);if(modal){const message=document.createElement('p');message.className='widget-error';message.dataset.modalError='';message.setAttribute('role','alert');message.textContent=error.message;modal.append(message);}return false;}
  finally{pending=false;if(modal)modal.inert=false;render();}
}
function history(direction){if(pending)return;if(invalidEdits.size&&direction==='undo'){invalidEdits.clear();render();return;}const from=direction==='undo'?undo:redo,to=direction==='undo'?redo:undo;if(!from.length)return;to.push(structuredClone(draft));draft=from.pop();selectedIds=selectedIds.filter(id=>draft.items.some(i=>i.id===id));if(!['all','unassigned',...draft.lists.map(l=>l.id)].includes(filters.scope))filters.scope='all';render();}
function listOptions(value){return `<option value="" ${value===null?'selected':''}>미분류</option>${draft.lists.map(l=>`<option value="${esc(l.id)}" ${l.id===value?'selected':''}>${esc(l.name)}</option>`).join('')}`;}
function inspector(){
  const panel=$('catalog-inspector');
  if(!selectedIds.length){panel.innerHTML='<div class="catalog-empty-inspector"><div class="inspector-symbol" aria-hidden="true">◇</div><h2>카드 살펴보기</h2><p>카드를 선택하면 이름과 분류,<br>태그와 메모를 편집할 수 있습니다.</p></div>';return;}
  const item=draft.items.find(i=>i.id===selectedIds[0]),single=selectedIds.length===1;
  panel.innerHTML=`<h2>${single?'카드 상세':`${selectedIds.length}개 카드 선택`}</h2><p class="selection-description">${single?esc(item.id):'검색 결과에 숨겨진 카드도 선택에 포함됩니다.'}</p><form id="item-form">${single?`<label>카드 이름<input name="title" value="${esc(editValue(item,'title',item.title))}" required maxlength="200"></label><label>종류<select name="kind"><option value="building" ${item.kind==='building'?'selected':''}>건물</option><option value="prop" ${item.kind==='prop'?'selected':''}>소품</option></select></label><label>검토 상태<select name="status">${[['unreviewed','미검토'],['approved','승인'],['hold','보류']].map(([id,label])=>`<option value="${id}" ${item.status===id?'selected':''}>${label}</option>`).join('')}</select></label>`:''}<label class="wide">${single?'소속 목록':'선택 카드 이동'}<select name="listId">${single?listOptions(item.listId):'<option value="__choose__">이동할 목록 선택</option>'+listOptions(undefined)}</select></label>${single?`<label class="wide">태그<input name="tags" value="${esc(editValue(item,'tags',item.tags.join(', ')))}" placeholder="쉼표로 구분"></label><label class="wide">메모<textarea name="note" maxlength="5000">${esc(editValue(item,'note',item.note))}</textarea></label>`:''}<p class="catalog-footnote wide">변경 내용은 이 화면에 보관됩니다. 상단의 저장을 눌러 파일에 기록하세요.</p><div class="wide"><button type="button" id="clear-selection" class="widget-wide">선택 해제</button><button type="button" id="delete-items" class="danger">${single?'카드 삭제':`선택 ${selectedIds.length}개 삭제`}</button></div></form>`;
  $('item-form').onsubmit=e=>e.preventDefault();
  const markField=(control,error)=>{
    control.setAttribute('aria-invalid',String(Boolean(error)));
    let message=control.parentElement.querySelector('[data-field-error]');
    if(!message){message=document.createElement('span');message.dataset.fieldError='';message.className='widget-error';message.id=`item-${control.name}-error`;message.setAttribute('role','alert');control.parentElement.append(message);control.setAttribute('aria-describedby',message.id);}
    message.textContent=error??'';
  };
  if(single)for(const name of ['title','tags','note']){const edit=invalidEdits.get(editKey(item.id,name));if(edit)markField($('item-form').elements[name],edit.error);}
  $('item-form').oninput=e=>{
    const {name,value}=e.target;if(!['title','tags','note'].includes(name)||pending)return;
    const key=editKey(item.id,name),fieldValue=name==='tags'?[...new Set(value.split(',').map(t=>t.trim()).filter(Boolean))]:value;
    invalidEdits.delete(key);
    try{commit({type:'item.update',id:item.id,changes:{[name]:fieldValue}},true);markField(e.target);}
    catch(error){invalidEdits.set(key,{id:item.id,value,error:error.message});markField(e.target,error.message);}
    render(true);
  };
  $('item-form').onchange=e=>{
    const {name,value}=e.target;if(!name)return;
    if(name==='listId'){if(value==='__choose__')return;safeCommit({type:'item.assign',ids:[...selectedIds],listId:value||null});}
    else if(name==='kind'||name==='status')safeCommit({type:'item.update',id:item.id,changes:{[name]:value}});
  };
  $('clear-selection').onclick=()=>{selectedIds=[];render();};
  $('delete-items').onclick=()=>{if(confirm(`선택한 카드 ${selectedIds.length}개를 삭제할까요? 저장 전에는 되돌릴 수 있습니다.`))safeCommit({type:'item.delete',ids:[...selectedIds]});};
}
function render(preserveInspector=false){
  if(!draft)return;
  $('catalog-content').inert=pending;
  $('catalog-toolbar').inert=pending;
  $('save-status').textContent=pending?'처리 중…':invalidEdits.size?'입력 오류 · 편집 내용 보관 중':dirty()?'저장하지 않은 변경 있음':draft.revision===0?'더미 초안 · 아직 파일에 저장 안 됨':`저장됨 · 버전 ${draft.revision}`;
  $('save').disabled=pending||(!dirty()&&draft.revision>0);$('undo').disabled=pending||(!undo.length&&!invalidEdits.size);$('redo').disabled=pending||!redo.length;
  $('storage-path').textContent=state.storage.root;
  $('scope-title').textContent=filters.scope==='all'?'모든 카드':filters.scope==='unassigned'?'미분류':draft.lists.find(l=>l.id===filters.scope)?.name??'모든 카드';
  folders.update({document:draft,scope:filters.scope});
  cards.update({items:draft.items,lists:draft.lists,selectedIds,filters});
  if(!preserveInspector)inspector();
}
function closeModal(){if(modal){modal.close();modal.remove();modal=null;}}
function openSettings(){
  if(pending)return;
  closeModal();modal=document.createElement('dialog');modal.className='catalog-dialog';modal.setAttribute('aria-labelledby','settings-title');
  modal.innerHTML=`<h2 id="settings-title">저장 위치와 백업</h2><p class="muted">저장 위치를 바꾸면 해당 폴더의 카탈로그를 불러옵니다. 기존 파일은 이동하거나 삭제하지 않습니다.</p><form id="storage-form"><label>저장 폴더<input name="root" value="${esc(state.storage.root)}" required></label><button type="submit">저장 위치 변경</button></form><div class="catalog-settings-paths"><code>원본: ${esc(state.storage.documentPath)}</code><code>백업: ${esc(state.storage.backupDirectory)}</code><code>전달 결과: ${esc(state.storage.exportDirectory)}</code><code>진단 로그: ${esc(state.storage.logPath)}</code></div><hr class="catalog-divider"><h3>저장된 버전의 백업</h3><p class="muted">백업에는 파일에 저장된 내용이 포함됩니다.</p><button type="button" id="create-backup" ${draft.revision===0?'disabled':''}>현재 저장본 백업</button><div>${state.backups.map(b=>`<div class="backup-entry"><span>버전 ${esc(b.revision)}<br>${esc(b.createdAt)}<br>${esc(b.id)}</span><button type="button" data-restore="${esc(b.id)}">복원</button></div>`).join('')||'<p class="muted">아직 백업이 없습니다.</p>'}</div><div class="widget-actions"><span class="widget-spacer"></span><button type="button" id="settings-close">닫기</button></div>`;
  document.body.append(modal);modal.showModal();
  modal.addEventListener('cancel',e=>{e.preventDefault();if(!pending)closeModal();});
  $('settings-close').onclick=closeModal;
  $('storage-form').onsubmit=async e=>{e.preventDefault();const root=e.target.elements.root.value.trim();if(!root)return;if(dirty()&&!confirm('저장하지 않은 변경을 버리고 다른 저장 위치를 불러올까요?'))return;if(await perform('storage',{root},'저장 위치를 변경했습니다.'))openSettings();};
  $('create-backup').onclick=async()=>{if(await perform('backup',{expectedRevision:state.document.revision},'저장본을 백업했습니다.'))openSettings();};
  modal.querySelectorAll('[data-restore]').forEach(b=>b.onclick=async()=>{if(!confirm(`백업 ${b.dataset.restore}으로 현재 카탈로그를 교체할까요? 현재 저장본은 복원 전에 백업되며, 저장하지 않은 편집은 버려집니다.`))return;if(await perform('restore',{backupId:b.dataset.restore,expectedRevision:state.document.revision},'백업을 복원했습니다.'))openSettings();});
}
function openHandoff(){
  if(pending)return;
  if(dirty()||draft.revision===0){notice('전달 전에 변경 내용을 저장하세요.',true);return;}
  closeModal();modal=document.createElement('dialog');modal.className='catalog-dialog';modal.setAttribute('aria-labelledby','handoff-title');
  modal.innerHTML=`<h2 id="handoff-title">결과 전달</h2><p class="muted">${draft.items.length?`저장된 버전 ${draft.revision}에서 ${selectedIds.length?`선택한 ${selectedIds.length}개 카드`:'전체 카드'}와 분류, 메모를 고정된 결과 파일로 만듭니다.`:'전달할 카드가 없습니다. 카드를 추가하고 저장한 뒤 전달본을 만드세요.'}</p><div id="handoff-paths">${state.handoffs.map(h=>`<code>${esc(h.markdownPath)}</code>`).join('')}</div><p class="muted">생성된 결과 경로를 대화에 전달하면 에이전트가 읽을 수 있습니다.</p><div class="widget-actions"><button type="button" id="handoff-close">닫기</button><button type="button" class="primary" id="handoff-create" ${draft.items.length?'':'disabled'}>전달본 만들기</button></div>`;
  document.body.append(modal);modal.showModal();
  modal.addEventListener('cancel',e=>{e.preventDefault();if(!pending)closeModal();});$('handoff-close').onclick=closeModal;
  $('handoff-create').onclick=async()=>{if(!draft.items.length)return;if(await perform('export',{expectedRevision:state.document.revision,itemIds:selectedIds.length?[...selectedIds]:draft.items.map(item=>item.id)},'전달본을 만들었습니다. 결과 경로를 대화에 전달하세요.')){const paths=modal.querySelector('#handoff-paths');paths.replaceChildren();for(const h of state.handoffs){const code=document.createElement('code');code.textContent=h.markdownPath;paths.append(code);}}};
}
function mount(){
  app.className='catalog-app';
  app.innerHTML=`<header class="catalog-header"><div class="catalog-brand"><span class="catalog-mark" aria-hidden="true">▧</span><div><h1>카탈로그 작업 공간 <span class="dummy-badge">더미 데이터</span></h1><p>목록으로 정리하고, 카드에 생각을 기록하세요.</p></div></div><div class="catalog-toolbar" id="catalog-toolbar"><span id="save-status" data-testid="save-status" class="catalog-status" role="status" aria-live="polite"></span><button id="undo" title="Ctrl+Z">되돌리기</button><button id="redo" title="Ctrl+Shift+Z">다시 실행</button><button id="theme" data-testid="theme" aria-label="화면 테마 변경">테마</button><button id="reload" data-testid="reload">새로 불러오기</button><button id="handoff">전달</button><button id="save" data-testid="save" class="primary">저장</button></div></header><div id="catalog-notice" class="catalog-notice" role="alert" hidden><span id="notice-text"></span><button id="dismiss-notice" aria-label="알림 닫기">×</button></div><div id="catalog-content" class="catalog-layout"><aside class="catalog-sidebar"><nav id="folder-list" aria-label="카탈로그 목록"></nav><div class="catalog-storage">현재 저장 위치<code id="storage-path"></code><button id="settings">저장 위치 · 백업</button><p class="catalog-footnote">실제 에셋과 연결되지 않은 예제입니다.</p></div></aside><main class="catalog-main"><div class="catalog-main-heading"><div><h2 id="scope-title">모든 카드</h2><p>검색과 필터를 바꿔도 선택은 유지됩니다.</p></div><button id="add-item" class="primary">＋ 카드 추가</button></div><div id="card-browser"></div></main><aside id="catalog-inspector" class="catalog-inspector" aria-label="선택 카드 상세"></aside></div>`;
  folders=mountFolderList($('folder-list'),{onNavigate:scope=>{filters={...filters,scope};render();},onAction:commit});
  cards=mountCardBrowser($('card-browser'),{onSelect:ids=>{selectedIds=ids;render();},onFilterChange:next=>{filters=next;cards.update({items:draft.items,lists:draft.lists,selectedIds,filters});}});
  $('save').onclick=()=>{if(invalidEdits.size){notice('입력 오류가 있는 카드의 이름·태그·메모를 수정한 뒤 저장하세요. 입력한 내용은 카드별로 보관 중입니다.',true);return;}perform('save',{document:draft,expectedRevision:state.document.revision},'카탈로그를 저장했습니다.');};
  $('undo').onclick=()=>history('undo');$('redo').onclick=()=>history('redo');
  $('reload').onclick=async()=>{if(dirty()&&!confirm('저장하지 않은 변경을 버리고 저장본을 다시 불러올까요?'))return;pending=true;render();try{adopt(await request('state'));notice('저장본을 다시 불러왔습니다.');}catch(e){notice(e.message,true);}finally{pending=false;render();}};
  $('theme').onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';$('theme').textContent=dark?'밝은 테마':'어두운 테마';};
  if(!document.documentElement.dataset.theme)document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  $('theme').textContent=document.documentElement.dataset.theme==='dark'?'어두운 테마':'밝은 테마';
  $('settings').onclick=openSettings;$('handoff').onclick=openHandoff;$('dismiss-notice').onclick=()=>{$('catalog-notice').hidden=true;};
  $('add-item').onclick=()=>{const id=`item-${crypto.randomUUID()}`;safeCommit({type:'item.create',id,title:'새 카드',listId:['all','unassigned'].includes(filters.scope)?null:filters.scope});if(draft.items.some(i=>i.id===id)){selectedIds=[id];render();$('item-form')?.elements.title?.focus();}};
  render();
}
window.addEventListener('beforeunload',e=>{if(dirty()||pending){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if(modal||pending||e.target.closest('input,textarea,select,[contenteditable=true]'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();history(e.shiftKey?'redo':'undo');}});
try{token=(await request('session')).token;adopt(await request('state'));mount();}
catch(error){app.replaceChildren();const box=document.createElement('div');box.className='startup';box.setAttribute('role','alert');const text=document.createElement('p');text.textContent=`카탈로그를 불러오지 못했습니다. ${error.message}`;const retry=document.createElement('button');retry.textContent='다시 시도';retry.onclick=()=>location.reload();box.append(text,retry);app.append(box);}
